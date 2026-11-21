import "server-only";

import { randomUUID } from "node:crypto";
import { isValidIndianMobile, normaliseMobile } from "@/lib/contact";
import type { ContactEnquiry, ContactEnquiryPage } from "@/lib/contact-enquiry-types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const TABLE = "website_contact_enquiries";
const COLUMNS = "id,name,mobile,email,source,requirement,sub_requirement,quantity,event_date,budget_per_unit,total_budget,message,created_at";
const PAGE_SIZE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

type Submission = Omit<ContactEnquiry, "id" | "createdAt">;
type EnquiryRow = {
  id: string; name: string; mobile: string; email: string; source: string;
  requirement: string; sub_requirement: string; quantity: number | null;
  event_date: string | null; budget_per_unit: number | null; total_budget: number | null;
  message: string; created_at: string;
};

export class ContactEnquiryError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "ContactEnquiryError";
  }
}

export const contactEnquiryHeaders = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

function text(value: unknown, label: string, max: number) {
  if (value == null) return "";
  if (typeof value !== "string") throw new ContactEnquiryError(`Enter a valid ${label}.`);
  const result = value.trim();
  if (result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) {
    throw new ContactEnquiryError(`Keep ${label} to ${max.toLocaleString("en-IN")} characters.`);
  }
  return result;
}

function number(value: unknown, label: string, maximum: number, integer = false): number | null {
  if (value == null || value === "" || (typeof value === "string" && !value.trim())) return null;
  if (typeof value !== "string" && typeof value !== "number") throw new ContactEnquiryError(`Enter a valid ${label}.`);
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim())) throw new ContactEnquiryError(`Enter a valid ${label}.`);
  const result = Number(value);
  if (!Number.isFinite(result) || result < (integer ? 1 : 0) || result > maximum || (integer && !Number.isInteger(result))) {
    throw new ContactEnquiryError(`Enter a valid ${label}.`);
  }
  return integer ? result : Math.round(result * 100) / 100;
}

export function validateContactEnquiry(body: Record<string, unknown>): { requestId?: string; data: Submission } {
  let requestId: string | undefined;
  if (body.requestId !== undefined) {
    if (typeof body.requestId !== "string" || !UUID.test(body.requestId)) throw new ContactEnquiryError("Refresh the contact form and try again.");
    requestId = body.requestId.toLowerCase();
  }
  const name = text(body.name, "name", 100);
  const mobile = normaliseMobile(text(body.mobile, "mobile number", 30));
  const email = text(body.email, "email address", 254);
  if (!name || !mobile) throw new ContactEnquiryError("Name and mobile number are required.");
  if (!isValidIndianMobile(mobile)) throw new ContactEnquiryError("Enter a 10-digit mobile number.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ContactEnquiryError("Enter a valid email address.");

  const requirementAliases: Record<string, string> = {
    "Shagun Envelopes": "Sagun Envelopes", "Rakhi Cards": "Rakhi Packaging Item",
    "Rakhi Boxes": "Rakhi Packaging Item", "Rakhi Packaging": "Rakhi Packaging Item", "Rakhi Packaging Items": "Rakhi Packaging Item",
  };
  const rawRequirement = text(body.requirement, "requirement", 100);
  const requirement = requirementAliases[rawRequirement] || rawRequirement;
  if (!["Wedding Cards", "Sagun Envelopes", "Rakhi Packaging Item"].includes(requirement)) throw new ContactEnquiryError("Choose a valid requirement.");
  const subAliases: Record<string, string> = {
    "None of the Above": "None Of The Above", "None of The Above": "None Of The Above",
    "Hindu Wedding Card": "Hindu Wedding Cards", "Muslim Wedding Card": "Muslim Wedding Cards",
    "Christian Wedding Card": "Christian Wedding Cards", "General Wedding Card": "General Wedding Cards",
  };
  const rawSub = text(body.subRequirement, "card type", 100);
  const subRequirement = requirement === "Wedding Cards" ? subAliases[rawSub] || rawSub : "";
  if (requirement === "Wedding Cards" && !["None Of The Above", "Hindu Wedding Cards", "Muslim Wedding Cards", "Christian Wedding Cards", "General Wedding Cards"].includes(subRequirement)) {
    throw new ContactEnquiryError("Choose a card type for Wedding Cards.");
  }
  const quantity = number(body.quantity, "quantity", 1_000_000_000, true);
  const budgetPerUnit = number(body.budgetPerUnit, "budget per piece", 1_000_000_000_000);
  let totalBudget = number(body.totalBudget, "total budget", 1_000_000_000_000);
  if (quantity !== null && budgetPerUnit !== null) {
    const calculated = Math.round(quantity * budgetPerUnit * 100) / 100;
    if (!Number.isFinite(calculated) || calculated > 1_000_000_000_000 || (totalBudget !== null && Math.abs(totalBudget - calculated) > 0.001)) {
      throw new ContactEnquiryError("Check the quantity and budget, then try again.");
    }
    totalBudget = calculated;
  }
  const eventDate = text(body.eventDate, "event date", 10);
  if (eventDate && (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || !Number.isFinite(Date.parse(`${eventDate}T00:00:00Z`)) || new Date(`${eventDate}T00:00:00Z`).toISOString().slice(0, 10) !== eventDate)) {
    throw new ContactEnquiryError("Choose a valid event date.");
  }
  return { requestId, data: {
    name, mobile, email, source: "Website", requirement, subRequirement, quantity, eventDate,
    budgetPerUnit, totalBudget, message: text(body.message, "message", 2000),
  } };
}

/** Limit the actual streamed body as well as the untrusted Content-Length header. */
export async function readContactEnquiryBody(request: Request): Promise<Record<string, unknown>> {
  const limit = 16 * 1024;
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new ContactEnquiryError("Send the enquiry as JSON.", 415);
  if (Number(request.headers.get("content-length")) > limit) throw new ContactEnquiryError("This enquiry is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ContactEnquiryError("Enter your enquiry details.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ContactEnquiryError("This enquiry is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch { throw new ContactEnquiryError("Enter valid enquiry details."); }
}

function present(row: EnquiryRow): ContactEnquiry {
  return {
    id: row.id, name: row.name, mobile: row.mobile, email: row.email, source: row.source,
    requirement: row.requirement, subRequirement: row.sub_requirement, quantity: row.quantity,
    eventDate: row.event_date || "", budgetPerUnit: row.budget_per_unit, totalBudget: row.total_budget,
    message: row.message, createdAt: row.created_at,
  };
}

export async function saveContactEnquiry(body: Record<string, unknown>): Promise<{ enquiry: ContactEnquiry; created: boolean }> {
  const { requestId, data } = validateContactEnquiry(body);
  const id = requestId || randomUUID();
  const db = getSupabaseAdminClient();
  const { data: inserted, error } = await db.from(TABLE).insert({
    id, name: data.name, mobile: data.mobile, email: data.email, source: data.source,
    requirement: data.requirement, sub_requirement: data.subRequirement, quantity: data.quantity,
    event_date: data.eventDate || null, budget_per_unit: data.budgetPerUnit,
    total_budget: data.totalBudget, message: data.message,
  }).select(COLUMNS).single();
  if (!error && inserted) return { enquiry: present(inserted as EnquiryRow), created: true };
  if (error?.code !== "23505" || !requestId) throw new Error("Contact enquiry could not be saved.");

  const { data: existing, error: readError } = await db.from(TABLE).select(COLUMNS).eq("id", id).maybeSingle();
  if (readError || !existing) throw new Error("Contact enquiry receipt could not be checked.");
  const enquiry = present(existing as EnquiryRow);
  if ((Object.keys(data) as (keyof Submission)[]).some((field) => enquiry[field] !== data[field])) {
    throw new ContactEnquiryError("This enquiry reference has already been used. Refresh the contact form and try again.", 409);
  }
  return { enquiry, created: false };
}

function decodeCursor(cursor: string) {
  try {
    if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof value.id !== "string" || !UUID.test(value.id) || typeof value.createdAt !== "string" || !TIMESTAMP.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) throw new Error();
    return { id: value.id.toLowerCase() as string, createdAt: value.createdAt as string };
  } catch { throw new ContactEnquiryError("This page reference is invalid. Refresh the contact enquiries."); }
}

export async function listContactEnquiries(cursor?: string | null): Promise<ContactEnquiryPage> {
  const after = cursor ? decodeCursor(cursor) : null;
  let query = getSupabaseAdminClient().from(TABLE).select(COLUMNS)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE + 1);
  if (after) query = query.or(`created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`);
  const { data, error } = await query;
  if (error) throw new Error("Contact enquiries could not be loaded.");
  const rows = (data ?? []) as EnquiryRow[];
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    enquiries: page.map(present),
    nextCursor: rows.length > PAGE_SIZE && last ? Buffer.from(JSON.stringify({ createdAt: last.created_at, id: last.id })).toString("base64url") : null,
  };
}
