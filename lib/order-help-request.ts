import "server-only";

import { NextResponse } from "next/server";
import { ORDER_HELP_STATUSES, ORDER_HELP_TOPICS, type OrderHelpStatus, type OrderHelpTopic } from "@/lib/order-help-types";

export class OrderHelpError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "OrderHelpError";
  }
}

export const orderHelpHeaders = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

export function orderHelpErrorResponse(error: unknown) {
  return NextResponse.json(
    { error: error instanceof OrderHelpError ? error.message : "Order help is temporarily unavailable. Please try again." },
    { status: error instanceof OrderHelpError ? error.status : 503, headers: orderHelpHeaders },
  );
}

export function checkHelpOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    throw new OrderHelpError("Open this website to send or update an order help request.", 403);
  }
}

export function helpUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new OrderHelpError("Select a valid order or help request.");
  }
  return value.toLowerCase();
}

export function helpTimestamp(value: unknown): string {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !Number.isFinite(Date.parse(value))) {
    throw new OrderHelpError("Refresh the help requests and try again.");
  }
  return value;
}

export function helpStatus(value: unknown): OrderHelpStatus {
  if (!ORDER_HELP_STATUSES.some(({ value: status }) => status === value)) {
    throw new OrderHelpError("Choose a valid request status.");
  }
  return value as OrderHelpStatus;
}

export function helpSubmission(body: Record<string, unknown>) {
  const orderId = helpUuid(body.orderId);
  const requestId = helpUuid(body.requestId);
  if (!ORDER_HELP_TOPICS.some(({ value }) => value === body.topic)) {
    throw new OrderHelpError("Choose a help topic.");
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const characterCount = Array.from(message).length;
  if (characterCount < 10 || characterCount > 3000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) {
    throw new OrderHelpError("Describe the issue using 10 to 3,000 characters.");
  }
  return { orderId, requestId, topic: body.topic as OrderHelpTopic, message };
}

/** Bound streamed data too; content-length is not trusted. */
export async function readHelpBody(request: Request): Promise<Record<string, unknown>> {
  const limit = 16 * 1024;
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new OrderHelpError("Send the help request as JSON.", 415);
  }
  if (Number(request.headers.get("content-length")) > limit) {
    throw new OrderHelpError("This help request is too large.", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new OrderHelpError("Enter the help request details.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new OrderHelpError("This help request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new OrderHelpError("Enter valid help request details.");
  }
}
