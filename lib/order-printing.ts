import "server-only";

import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getPaymentReceipt } from "@/lib/payment-receipt";
import { OrderPrintingError, printingUploadMetadata, printingUuid } from "@/lib/order-printing-request";
import { PRINTING_CONTENT_TYPES, PRINTING_MAX_FILE_BYTES, type PrintingFile } from "@/lib/order-printing-types";

const TABLE = "website_order_printing_files";
const BUCKET = "website_order_printing";
const COLUMNS = "id,order_id,storage_path,file_name,size_bytes,content_type,notes,state,created_at,completed_at,expires_at";
type PrintingRow = {
  id: string; order_id: string; storage_path: string; file_name: string; size_bytes: number;
  content_type: string; notes: string; state: "pending" | "ready" | "cancelled" | "rejected";
  created_at: string; completed_at: string | null; expires_at: string;
};
const unavailable = () => new OrderPrintingError("Printing files are temporarily unavailable. Please try again.", 503);
const expired = () => new OrderPrintingError("This upload has expired or was cancelled. Choose the file again.", 410);

function present(row: PrintingRow): PrintingFile {
  return { id: row.id, fileName: row.file_name, sizeBytes: row.size_bytes,
    contentType: row.content_type, notes: row.notes, createdAt: row.completed_at || row.created_at };
}

/** Inspect ZIP metadata before inflating only the small content-types document. */
function isDocx(bytes: Buffer): boolean {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) return false;
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) { eocd = at; break; }
  }
  if (eocd < 0 || bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0) return false;
  const entries = bytes.readUInt16LE(eocd + 10);
  const directorySize = bytes.readUInt32LE(eocd + 12);
  let offset = bytes.readUInt32LE(eocd + 16);
  if (!entries || entries > 4096 || bytes.readUInt16LE(eocd + 8) !== entries || offset + directorySize !== eocd) return false;
  let totalUncompressed = 0;
  let hasDocument = false;
  let hasContentType = false;
  const names = new Set<string>();
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > eocd || bytes.readUInt32LE(offset) !== 0x02014b50) return false;
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20);
    const uncompressed = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const entryEnd = offset + 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    if (entryEnd > eocd || flags & 1 || ![0, 8].includes(method) || local + 30 > bytes.length) return false;
    totalUncompressed += uncompressed;
    if (totalUncompressed > 200 * 1024 * 1024 || uncompressed > 100 * 1024 * 1024) return false;
    const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (names.has(name) || /(?:^|\/)\.\.(?:\/|$)|\\|^\//.test(name) || /vbaproject\.bin$/i.test(name)) return false;
    names.add(name);
    if (bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 6) & 1 || bytes.readUInt16LE(local + 8) !== method) return false;
    const localNameLength = bytes.readUInt16LE(local + 26);
    const start = local + 30 + localNameLength + bytes.readUInt16LE(local + 28);
    if (start + compressed > bytes.length || bytes.toString("utf8", local + 30, local + 30 + localNameLength) !== name) return false;
    if (name === "word/document.xml") hasDocument = uncompressed > 0 && uncompressed <= 10 * 1024 * 1024;
    if (name === "[Content_Types].xml") {
      if (!uncompressed || uncompressed > 256 * 1024) return false;
      const data = bytes.subarray(start, start + compressed);
      const xml = (method === 0 ? data : inflateRawSync(data, { maxOutputLength: 256 * 1024 })).toString("utf8");
      hasContentType = /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\.main\+xml/.test(xml)
        && !/macroEnabled|vbaProject/i.test(xml);
    }
    offset = entryEnd;
  }
  return offset === eocd && hasDocument && hasContentType;
}

/** Byte-level type checks, not a malware scan or a print-readiness approval. */
export function printingFileMatches(value: Uint8Array, contentType: string): boolean {
  const bytes = Buffer.from(value);
  if (!bytes.length || bytes.length > PRINTING_MAX_FILE_BYTES) return false;
  try {
    if (contentType === PRINTING_CONTENT_TYPES.pdf) {
      return /^%PDF-[12]\.\d/.test(bytes.toString("ascii", 0, 8)) && bytes.subarray(-2048).includes(Buffer.from("%%EOF"));
    }
    if (contentType === PRINTING_CONTENT_TYPES.jpg) {
      return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    }
    if (contentType === PRINTING_CONTENT_TYPES.png) {
      return bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        && bytes.toString("ascii", 12, 16) === "IHDR"
        && bytes.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]));
    }
    return contentType === PRINTING_CONTENT_TYPES.docx && isDocx(bytes);
  } catch { return false; }
}

/** Only a server-created storage URL reaches this fetch. Bound bytes even if storage metadata lies. */
async function readStoredBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(25000) });
  if (!response.ok || !response.body) throw unavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PRINTING_MAX_FILE_BYTES) {
        await reader.cancel();
        throw new OrderPrintingError("Choose a file up to 20 MB.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

async function loadFile(db: SupabaseClient, orderId: string, fileId: string): Promise<PrintingRow> {
  const { data, error } = await db.from(TABLE).select(COLUMNS).eq("order_id", orderId).eq("id", fileId).maybeSingle();
  if (error) throw unavailable();
  if (!data) throw new OrderPrintingError("This printing file could not be found for this order.", 404);
  return data as PrintingRow;
}

async function listFiles(db: SupabaseClient, orderId: string): Promise<{ files: PrintingFile[] }> {
  const { data, error } = await db.from(TABLE).select(COLUMNS).eq("order_id", orderId).eq("state", "ready")
    .order("completed_at", { ascending: false }).order("id", { ascending: false }).limit(10);
  if (error) throw unavailable();
  return { files: ((data ?? []) as PrintingRow[]).map(present) };
}

async function downloadFile(db: SupabaseClient, orderId: string, fileId: string): Promise<{ url: string }> {
  const row = await loadFile(db, orderId, fileId);
  if (row.state !== "ready") throw new OrderPrintingError("This file has not finished uploading.", 409);
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(row.storage_path, 60, { download: row.file_name });
  if (error || !data?.signedUrl) throw unavailable();
  return { url: data.signedUrl };
}

/** Safe to retry. Keep tombstones until upload capabilities expire, even after removing an object. */
async function stopUpload(db: SupabaseClient, row: PrintingRow, state: "cancelled" | "rejected") {
  if (row.state === "ready") throw new OrderPrintingError("Submitted files are kept with your order. Upload a new file to send a revision.", 409);
  const { data, error } = await db.from(TABLE).update({ state }).eq("order_id", row.order_id).eq("id", row.id)
    .eq("state", "pending").select("id").maybeSingle();
  if (error) throw unavailable();
  if (!data) {
    const current = await loadFile(db, row.order_id, row.id);
    if (current.state === "ready") throw new OrderPrintingError("This file has already been submitted.", 409);
  }
  // Failure to remove is harmless to access control; later cleanup retries after token expiry.
  await db.storage.from(BUCKET).remove([row.storage_path]);
}

async function cleanupExpired(db: SupabaseClient, orderId: string) {
  const before = new Date().toISOString();
  const { data, error } = await db.from(TABLE).select("id,storage_path").eq("order_id", orderId)
    .neq("state", "ready").lt("expires_at", before).limit(50);
  if (error || !data?.length) return;
  const result = await db.storage.from(BUCKET).remove(data.map(row => row.storage_path));
  if (result.error) return;
  await db.from(TABLE).delete().eq("order_id", orderId).neq("state", "ready").lt("expires_at", before).in("id", data.map(row => row.id));
}

export async function customerPrintingAction(
  body: Record<string, unknown>,
  db = getSupabaseAdminClient(),
  receiptReader = getPaymentReceipt,
  readBytes = readStoredBytes,
): Promise<Record<string, unknown>> {
  const orderId = printingUuid(body.orderId);
  // Receipt capability is intentionally separate from tracking-only links.
  const receipt = await receiptReader(orderId, body.receiptToken);
  if (receipt.id !== orderId || receipt.paymentStatus !== "paid") {
    throw new OrderPrintingError("Printing files can be uploaded after payment is confirmed.", 409);
  }
  if (body.action === "list") return listFiles(db, orderId);
  if (body.action === "prepare") {
    const input = printingUploadMetadata(body);
    await cleanupExpired(db, orderId);
    const fileId = randomUUID();
    const path = `${orderId}/${fileId}.${input.extension}`;
    const { data, error } = await db.rpc("reserve_website_order_printing_file", {
      p_order_id: orderId, p_file_id: fileId, p_storage_path: path, p_file_name: input.fileName,
      p_size_bytes: input.sizeBytes, p_content_type: input.contentType, p_notes: input.notes,
    });
    if (error?.message === "PRINTING_FILE_LIMIT") throw new OrderPrintingError("This order has reached its 10-file upload limit. Unfinished or cancelled uploads release their slots after two hours. Contact us if you need to send more files.", 409);
    if (error || !data) throw unavailable();
    const result = await db.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
    if (result.error || !result.data?.signedUrl) {
      await stopUpload(db, data as PrintingRow, "cancelled");
      throw unavailable();
    }
    return { fileId, uploadUrl: result.data.signedUrl, contentType: input.contentType };
  }
  if (!["complete", "cancel", "download"].includes(String(body.action))) throw new OrderPrintingError("Choose a valid printing file action.");
  const fileId = printingUuid(body.fileId);
  if (body.action === "download") return downloadFile(db, orderId, fileId);
  const row = await loadFile(db, orderId, fileId);
  if (body.action === "cancel") {
    await stopUpload(db, row, "cancelled");
    return {};
  }
  if (row.state === "ready") return { file: present(row) };
  if (row.state !== "pending" || Date.parse(row.expires_at) <= Date.now()) throw expired();
  const bucket = db.storage.from(BUCKET);
  const infoResult = await bucket.info(row.storage_path);
  if (infoResult.error || !infoResult.data) {
    const status = Number((infoResult.error as { status?: unknown; statusCode?: unknown } | null)?.statusCode
      ?? (infoResult.error as { status?: unknown } | null)?.status);
    if (!infoResult.data && (!infoResult.error || status === 400 || status === 404)) {
      throw new OrderPrintingError("The file has not finished uploading. Try uploading it again.", 409);
    }
    throw unavailable();
  }
  if (Number(infoResult.data.size) !== row.size_bytes || infoResult.data.contentType !== row.content_type) {
    await stopUpload(db, row, "rejected");
    throw new OrderPrintingError("The uploaded file does not match the selected file. Choose it again.");
  }
  const link = await bucket.createSignedUrl(row.storage_path, 60);
  if (link.error || !link.data?.signedUrl) throw unavailable();
  let bytes: Uint8Array;
  try { bytes = await readBytes(link.data.signedUrl); }
  catch (error) {
    if (error instanceof OrderPrintingError && error.status === 413) await stopUpload(db, row, "rejected");
    throw error;
  }
  if (bytes.byteLength !== row.size_bytes || !printingFileMatches(bytes, row.content_type)) {
    await stopUpload(db, row, "rejected");
    throw new OrderPrintingError("This file could not be verified as a PDF, Word document, JPG or PNG. Export it again and retry.");
  }
  const { data, error } = await db.rpc("complete_website_order_printing_file", { p_order_id: orderId, p_file_id: fileId });
  if (error?.message === "PRINTING_UPLOAD_EXPIRED") throw expired();
  if (error || !data) throw unavailable();
  return { file: present(data as PrintingRow) };
}

export async function listAdminPrintingFiles(orderId: unknown) {
  // Match the existing admin order dashboard's access model.
  return listFiles(getSupabaseAdminClient(), printingUuid(orderId));
}

export async function downloadAdminPrintingFile(orderId: unknown, fileId: unknown) {
  return downloadFile(getSupabaseAdminClient(), printingUuid(orderId), printingUuid(fileId));
}
