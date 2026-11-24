import "server-only";

import { NextResponse } from "next/server";
import { FulfillmentAdminError } from "@/lib/admin-auth";
import { PaymentReceiptError } from "@/lib/payment-receipt";
import { PRINTING_CONTENT_TYPES, printingFileError } from "@/lib/order-printing-types";

export class OrderPrintingError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "OrderPrintingError";
  }
}

export const printingHeaders = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Vary": "Cookie",
};

export function printingErrorResponse(error: unknown) {
  if (error instanceof OrderPrintingError || error instanceof PaymentReceiptError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: printingHeaders });
  }
  if (error instanceof FulfillmentAdminError) {
    return NextResponse.json({ error: error.status === 401 ? "Sign in with a staff account to view printing files." : "Your account does not have access to printing files." }, { status: error.status, headers: printingHeaders });
  }
  return NextResponse.json({ error: "Printing files are temporarily unavailable. Please try again." }, { status: 503, headers: printingHeaders });
}

export function printingUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new OrderPrintingError("Choose a valid order or printing file.");
  }
  return value.toLowerCase();
}

export function printingUploadMetadata(body: Record<string, unknown>) {
  const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
  const sizeBytes = typeof body.sizeBytes === "number" ? body.sizeBytes : 0;
  const message = printingFileError(fileName, sizeBytes);
  if (message) throw new OrderPrintingError(message, sizeBytes > 20 * 1024 * 1024 ? 413 : 400);
  if (body.notes !== undefined && typeof body.notes !== "string") throw new OrderPrintingError("Enter valid printing instructions.");
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (Array.from(notes).length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(notes)) {
    throw new OrderPrintingError("Keep printing instructions to 2,000 characters.");
  }
  const extension = fileName.split(".").pop()!.toLowerCase() as keyof typeof PRINTING_CONTENT_TYPES;
  return { fileName, sizeBytes, notes, extension, contentType: PRINTING_CONTENT_TYPES[extension] };
}

/** Tokens stay in a bounded request body. Every POST, including reads, is same-origin. */
export async function readPrintingRequest(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new OrderPrintingError("Open this website to manage your printing files.", 403);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new OrderPrintingError("Send printing details as JSON.", 415);
  }
  const limit = 16 * 1024;
  if (Number(request.headers.get("content-length")) > limit) throw new OrderPrintingError("These printing details are too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new OrderPrintingError("Enter the printing file details.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new OrderPrintingError("These printing details are too large.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new OrderPrintingError("Enter valid printing file details.");
  }
}
