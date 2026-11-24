"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ChevronDown, Download, FileText, LoaderCircle, Printer, RefreshCw, Upload } from "lucide-react";
import { PRINTING_ACCEPT, PRINTING_MAX_FILES, printingFileError, type PrintingFile } from "@/lib/order-printing-types";
import styles from "./OrderPrintingMatter.module.css";

type Props = { orderId: string; receiptToken?: string | null };
type Busy = "loading" | "preparing" | "uploading" | "confirming" | "downloading" | null;
type PendingUpload = { id: string; name: string };

class PrintingRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function isPrintingFile(value: unknown): value is PrintingFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Record<string, unknown>;
  return typeof file.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(file.id) &&
    ["fileName", "contentType", "notes", "createdAt"].every(key => typeof file[key] === "string") &&
    typeof file.sizeBytes === "number" && Number.isSafeInteger(file.sizeBytes) && file.sizeBytes > 0 &&
    Number.isFinite(Date.parse(file.createdAt as string));
}

function fileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function uploadedDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export function PrintingFileList({ files, downloadingId, disabled, onDownload }: {
  files: PrintingFile[]; downloadingId: string | null; disabled: boolean; onDownload: (file: PrintingFile) => void;
}) {
  return <ul className={styles.files}>
    {files.map(file => <li key={file.id} className={styles.file}>
      <div className={styles.fileTop}>
        <FileText size={19} className={styles.fileIcon} aria-hidden="true" />
        <div className={styles.fileInfo}>
          <span className={styles.fileName}>{file.fileName}</span>
          <p className={styles.fileMeta}>{fileSize(file.sizeBytes)} · Uploaded <time dateTime={file.createdAt}>{uploadedDate(file.createdAt)} IST</time></p>
        </div>
        <button type="button" className={styles.download} disabled={disabled} onClick={() => onDownload(file)} aria-label={`Download ${file.fileName}`}>
          {downloadingId === file.id ? <LoaderCircle size={14} className={styles.spin} aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
          {downloadingId === file.id ? "Opening…" : "Download"}
        </button>
      </div>
      {file.notes && <p className={styles.fileNotes}><strong>Instructions</strong>{file.notes}</p>}
    </li>)}
  </ul>;
}

/** An attachment link opens separately so the current form and guest capability stay in place. */
export function openPrintingDownload(value: unknown, fileName: string) {
  if (typeof value !== "string") throw new Error("The download could not be opened. Please try again.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("The download could not be opened. Please try again.");
  const link = document.createElement("a");
  link.href = url.href;
  link.download = fileName;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.referrerPolicy = "no-referrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function requestPrinting(body: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch("/api/orders/printing-matter", {
    method: "POST", cache: "no-store", credentials: "same-origin", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new PrintingRequestError(
    typeof result?.error === "string" ? result.error : "Printing files are temporarily unavailable. Please try again.", response.status,
  );
  if (!result || typeof result !== "object") throw new Error("The result could not be confirmed. Please try again.");
  return result;
}

function uploadToStorage(url: string, contentType: string, file: File, signal: AbortSignal, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const destination = new URL(url);
    if (destination.protocol !== "https:" || destination.username || destination.password) {
      reject(new Error("The upload could not be started. Please try again."));
      return;
    }
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const finish = (error?: Error) => {
      signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    request.open("PUT", url);
    request.timeout = 180_000;
    request.withCredentials = false;
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    request.onload = () => finish(request.status >= 200 && request.status < 300 ? undefined : new Error("The file could not be uploaded. Please try again."));
    request.onerror = () => finish(new Error("The upload was interrupted. Check your connection and try again."));
    request.ontimeout = () => finish(new Error("The upload took too long. Check your connection and try again."));
    request.onabort = () => finish(new DOMException("Upload cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { finish(new DOMException("Upload cancelled", "AbortError")); return; }
    const body = new FormData();
    body.append("cacheControl", "0");
    body.append("", new Blob([file], { type: contentType }), file.name);
    request.send(body);
  });
}

export default function OrderPrintingMatter(props: Props) {
  // Changing the selected order must discard old form state and abort its requests.
  return <OrderPrintingMatterForm key={`${props.orderId}:${props.receiptToken || "account"}`} {...props} />;
}

function OrderPrintingMatterForm({ orderId, receiptToken }: Props) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<PrintingFile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const fileHint = useId();
  const notesHint = useId();
  const access = { orderId, ...(receiptToken ? { receiptToken } : {}) };

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; active.current?.abort(); active.current = null; };
  }, []);

  function begin(state: Busy) {
    if (active.current) return null;
    const controller = new AbortController();
    active.current = controller;
    setBusy(state); setError("");
    return controller;
  }

  function finish(controller: AbortController) {
    if (active.current === controller) {
      active.current = null;
      if (alive.current) { setBusy(null); setDownloadingId(null); }
    }
  }

  async function loadFiles() {
    const controller = begin("loading");
    if (!controller) return;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const result = await requestPrinting({ ...access, action: "list" }, controller.signal);
      if (!Array.isArray(result.files) || !result.files.every(isPrintingFile)) throw new Error("The uploaded files could not be loaded. Please try again.");
      if (alive.current && active.current === controller) { setFiles(result.files); setLoaded(true); }
    } catch (caught) {
      if (alive.current && active.current === controller) setError(controller.signal.aborted ? "Loading the files took too long. Please try again." : caught instanceof Error ? caught.message : "The files could not be loaded.");
    } finally { clearTimeout(timeout); finish(controller); }
  }

  function toggle() {
    setOpen(value => !value);
    if (!open && !loaded) void loadFiles();
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!pending) {
      const validation = file ? printingFileError(file.name, file.size) : "Choose a file to upload.";
      if (validation) { setError(validation); input.current?.focus(); return; }
    }
    const controller = begin(pending ? "confirming" : "preparing");
    if (!controller) return;
    const timeout = setTimeout(() => controller.abort(), 240_000);
    let preparedId: string | null = pending?.id ?? null;
    let confirming = Boolean(pending);
    setSuccess(""); setProgress(0);
    try {
      if (!pending && file) {
        const prepared = await requestPrinting({ ...access, action: "prepare", fileName: file.name, sizeBytes: file.size, notes: notes.trim() }, controller.signal);
        if (typeof prepared.fileId !== "string" || typeof prepared.uploadUrl !== "string" || typeof prepared.contentType !== "string") throw new Error("The upload could not be started. Please try again.");
        preparedId = prepared.fileId;
        if (alive.current) setBusy("uploading");
        await uploadToStorage(prepared.uploadUrl, prepared.contentType, file, controller.signal, value => { if (alive.current) setProgress(value); });
        confirming = true;
        if (alive.current) { setPending({ id: prepared.fileId, name: file.name }); setBusy("confirming"); }
      }
      const result = await requestPrinting({ ...access, action: "complete", fileId: preparedId }, controller.signal);
      if (!isPrintingFile(result.file) || result.file.id !== preparedId) throw new Error("The upload confirmation could not be checked. Please retry confirmation.");
      if (alive.current && active.current === controller) {
        const saved = result.file as PrintingFile;
        setFiles(current => [saved, ...current.filter(item => item.id !== saved.id)]);
        setPending(null); setFile(null); setNotes("");
        if (input.current) input.current.value = "";
        setSuccess(`${saved.fileName} has been sent to our team for review.`);
      }
    } catch (caught) {
      const terminal = caught instanceof PrintingRequestError && caught.status < 500 && caught.status !== 429;
      if (preparedId && (!confirming || terminal)) {
        // Cancel removes only unfinished reservations; a confirmed revision is never deleted.
        void requestPrinting({ ...access, action: "cancel", fileId: preparedId }).catch(() => undefined);
        if (alive.current && active.current === controller) {
          setPending(null);
          if (confirming) { setFile(null); if (input.current) input.current.value = ""; }
        }
      }
      if (alive.current && active.current === controller) setError(controller.signal.aborted
        ? confirming ? "The file was uploaded, but confirmation took too long. Retry confirmation below." : "The upload took too long. Please try again."
        : caught instanceof Error ? caught.message : "The upload could not be completed. Please try again.");
    } finally { clearTimeout(timeout); finish(controller); }
  }

  async function download(selected: PrintingFile) {
    const controller = begin("downloading");
    if (!controller) return;
    setDownloadingId(selected.id);
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const result = await requestPrinting({ ...access, action: "download", fileId: selected.id }, controller.signal);
      if (alive.current && active.current === controller) openPrintingDownload(result.url, selected.fileName);
    } catch (caught) {
      if (alive.current && active.current === controller) setError(controller.signal.aborted ? "Opening the download took too long. Please try again." : caught instanceof Error ? caught.message : "The file could not be downloaded.");
    } finally { clearTimeout(timeout); finish(controller); }
  }

  const atLimit = files.length >= PRINTING_MAX_FILES;
  const uploadBusy = busy === "preparing" || busy === "uploading" || busy === "confirming";
  const progressLabel = busy === "preparing" ? "Preparing your upload…" : busy === "uploading" ? `Uploading your file: ${progress}%` : "Checking and saving your file…";

  return <section className={styles.panel} aria-label="Order printing matter">
    <button type="button" className={styles.toggle} aria-controls={panelId} aria-expanded={open} onClick={toggle} disabled={uploadBusy}>
      <span className={styles.icon}><Printer size={21} strokeWidth={1.5} aria-hidden="true" /></span>
      <span className={styles.toggleText}><strong>Upload printing matter (optional)</strong><small>Buying cards without printing? You can skip this.</small></span>
      <ChevronDown className={styles.chevron} size={18} aria-hidden="true" />
    </button>
    <div id={panelId} hidden={!open} className={styles.body}>
      <p className={styles.intro}>If you need printing, share your invitation wording, artwork or reference design. Our team will review your files and confirm printing charges and the final proof with you. Cards without printing do not need an upload.</p>
      {error && <div role="alert" className={styles.error}><p>{error}</p>{!loaded && !busy && <button type="button" onClick={() => void loadFiles()}>Try loading files again</button>}</div>}
      {success && <p role="status" className={styles.success}>{success}</p>}
      {pending && !uploadBusy && <div className={styles.notice}><p>Confirm the upload of <strong>{pending.name}</strong> before adding another file.</p><button type="button" className={styles.secondary} style={{ marginTop: 10 }} disabled={Boolean(busy)} onClick={() => void submit()}>Retry confirmation</button></div>}
      {loaded && !pending && !atLimit && <form className={styles.form} onSubmit={submit} aria-busy={uploadBusy}>
        <label className={styles.fileLabel}><span><Upload size={17} aria-hidden="true" />Choose a printing file</span>
          <input ref={input} className={styles.fileInput} type="file" accept={PRINTING_ACCEPT} disabled={Boolean(busy)} aria-describedby={fileHint}
            onChange={event => { const selected = event.target.files?.[0] ?? null; setFile(selected); setError(selected ? printingFileError(selected.name, selected.size) || "" : ""); setSuccess(""); }} />
          <span id={fileHint} className={styles.hint}>PDF, Word (.docx), JPG or PNG. Up to 20 MB per file, {PRINTING_MAX_FILES} files per order.</span>
        </label>
        <label className={styles.label}>Instructions for this file <span className={styles.hint}>Optional</span>
          <textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={2000} rows={3} disabled={Boolean(busy)} aria-describedby={notesHint}
            placeholder="For example: Bengali wording for design AC-557, or use this artwork for the main insert." />
          <span id={notesHint} className={styles.hint}>Include the design number if your order contains more than one design. {notes.length.toLocaleString("en-IN")}/2,000 characters.</span>
        </label>
        <div className={styles.actions}><button type="submit" className={styles.primary} disabled={Boolean(busy) || !file}>
          {uploadBusy ? <LoaderCircle size={16} className={styles.spin} aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
          {uploadBusy ? "Uploading…" : "Upload for review"}
        </button></div>
      </form>}
      {atLimit && !pending && <p className={styles.notice}>You have uploaded {PRINTING_MAX_FILES} files for this order. Contact our team if you need to send more.</p>}
      {uploadBusy && <div role="status" className={styles.progress} style={{ marginTop: 14 }}><p>{progressLabel}</p>{busy === "uploading" && <progress max={100} value={progress} aria-label="File upload progress" />}</div>}
      <div className={styles.history} aria-busy={busy === "loading"}>
        <div className={styles.historyHeading}><h3>Submitted files{loaded ? ` (${files.length})` : ""}</h3>
          <button type="button" className={styles.refresh} disabled={Boolean(busy)} onClick={() => void loadFiles()}><RefreshCw size={13} className={busy === "loading" ? styles.spin : undefined} aria-hidden="true" />{busy === "loading" ? "Loading…" : "Refresh"}</button>
        </div>
        {loaded && (files.length ? <PrintingFileList files={files} downloadingId={downloadingId} disabled={Boolean(busy)} onDownload={selected => void download(selected)} /> : <p className={styles.empty}>No files submitted. Upload only if you need printing; you can also return to this order later.</p>)}
        {files.length > 0 && <p className={styles.hint} style={{ marginTop: 12 }}>Previous uploads stay with your order. If you send a revision, mention which file it replaces in the instructions.</p>}
      </div>
    </div>
  </section>;
}
