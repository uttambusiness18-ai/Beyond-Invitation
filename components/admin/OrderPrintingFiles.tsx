"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import type { PrintingFile } from "@/lib/order-printing-types";
import { isPrintingFile, openPrintingDownload, PrintingFileList } from "@/components/OrderPrintingMatter";
import styles from "@/components/OrderPrintingMatter.module.css";

export default function OrderPrintingFiles(props: { orderId: string; canManageFiles: boolean }) {
  return <OrderPrintingFilesPanel key={`${props.orderId}:${props.canManageFiles}`} {...props} />;
}

function OrderPrintingFilesPanel({ orderId, canManageFiles }: { orderId: string; canManageFiles: boolean }) {
  const [files, setFiles] = useState<PrintingFile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const endpoint = `/api/admin/orders/${encodeURIComponent(orderId)}/printing-matter`;

  const load = useCallback(async () => {
    if (!canManageFiles || active.current) return;
    const controller = new AbortController();
    active.current = controller; setBusy(true); setError("");
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(endpoint, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Printing files could not be loaded. Please try again.");
      if (!Array.isArray(result?.files) || !result.files.every(isPrintingFile)) throw new Error("The uploaded files could not be loaded. Please try again.");
      if (alive.current && active.current === controller) { setFiles(result.files); setLoaded(true); }
    } catch (caught) {
      if (alive.current && active.current === controller) setError(controller.signal.aborted ? "Loading the files took too long. Please try again." : caught instanceof Error ? caught.message : "Printing files could not be loaded.");
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) { active.current = null; if (alive.current) setBusy(false); }
    }
  }, [canManageFiles, endpoint]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; active.current?.abort(); active.current = null; };
  }, [load]);

  async function download(file: PrintingFile) {
    if (!canManageFiles || active.current) return;
    const controller = new AbortController();
    active.current = controller; setBusy(true); setError(""); setDownloadingId(file.id);
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(endpoint, {
        method: "POST", cache: "no-store", credentials: "same-origin", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "download", fileId: file.id }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "The file could not be downloaded. Please try again.");
      if (alive.current && active.current === controller) openPrintingDownload(result?.url, file.fileName);
    } catch (caught) {
      if (alive.current && active.current === controller) setError(controller.signal.aborted ? "Opening the file took too long. Please try again." : caught instanceof Error ? caught.message : "The file could not be downloaded.");
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        if (alive.current) { setBusy(false); setDownloadingId(null); }
      }
    }
  }

  return <section className={styles.admin} aria-label="Customer printing matter" aria-busy={busy}>
    <div className={styles.historyHeading}><h3>Printing matter{loaded ? ` (${files.length})` : ""}</h3>
      {canManageFiles && <button type="button" className={styles.refresh} disabled={busy} onClick={() => void load()}><RefreshCw size={14} className={busy && !downloadingId ? styles.spin : undefined} aria-hidden="true" />{busy && !downloadingId ? "Loading…" : "Refresh files"}</button>}
    </div>
    <p className={styles.adminIntro}>Customer wording and artwork for this order. These are submitted files; confirm the final printing proof with the customer.</p>
    {!canManageFiles ? <p className={styles.adminIntro}><Link href="/sign-in?next=%2Fadmin%2Forders" className={styles.adminSignIn}>Sign in with a staff account to view printing files.</Link></p> : <>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {loaded && (files.length ? <PrintingFileList files={files} downloadingId={downloadingId} disabled={busy} onDownload={file => void download(file)} /> : <p className={styles.empty}>No printing files have been submitted for this order.</p>)}
      {!loaded && busy && <p role="status" className={styles.empty}>Loading customer files…</p>}
    </>}
  </section>;
}
