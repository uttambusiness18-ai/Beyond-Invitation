import { NextResponse } from "next/server";
import {
  ContactEnquiryError, contactEnquiryHeaders, readContactEnquiryBody, saveContactEnquiry,
} from "@/lib/contact-enquiries";
import type { ContactEnquiry } from "@/lib/contact-enquiry-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The admin inbox is the durable receipt; ERP forwarding is optional. */
async function forwardToErp(enquiry: ContactEnquiry) {
  const erpUrl = process.env.ERPNEXT_URL?.trim();
  const apiKey = process.env.ERPNEXT_API_KEY?.trim();
  const apiSecret = process.env.ERPNEXT_API_SECRET?.trim();
  if (!erpUrl || !apiKey || !apiSecret) return;
  const doctype = process.env.ERPNEXT_LEAD_DOCTYPE?.trim() || "Lead";
  if (doctype.toLowerCase() === "contact") {
    console.error("Contact enquiry saved; ERP forwarding requires the Lead or CRM Lead doctype.");
    return;
  }
  const fields = {
    requirement: process.env.ERPNEXT_LEAD_REQUIREMENT_FIELD || "custom_requirement",
    subRequirement: process.env.ERPNEXT_LEAD_SUB_REQUIREMENT_FIELD || "custom_sub_requirement",
    quantity: process.env.ERPNEXT_LEAD_QUANTITY_REQUIRED_FIELD || "custom_quantity_required",
    budgetPerUnit: process.env.ERPNEXT_LEAD_BUDGET_PER_UNIT_FIELD || "custom_budget_per_unit",
    totalBudget: process.env.ERPNEXT_LEAD_BUDGET_TOTAL_FIELD || "custom_budget_total",
    eventDate: process.env.ERPNEXT_LEAD_FUNCTION_DATE_FIELD || "custom_function_date",
    message: process.env.ERPNEXT_LEAD_SPECIAL_REMARK_FIELD || "custom_special_requirement_and_remark",
  };
  const payload = Object.fromEntries(Object.entries({
    lead_name: enquiry.name, first_name: enquiry.name,
    email_id: enquiry.email || undefined, email: enquiry.email || undefined,
    mobile_no: enquiry.mobile, phone: enquiry.mobile,
    [fields.requirement]: enquiry.requirement,
    [fields.subRequirement]: enquiry.subRequirement || undefined,
    [fields.quantity]: enquiry.quantity ?? undefined,
    [fields.budgetPerUnit]: enquiry.budgetPerUnit ?? undefined,
    [fields.totalBudget]: enquiry.totalBudget ?? undefined,
    [fields.eventDate]: enquiry.eventDate || undefined,
    [fields.message]: enquiry.message || undefined,
  }).filter(([, value]) => value !== undefined));
  try {
    const response = await fetch(`${erpUrl.replace(/\/$/, "")}/api/resource/${encodeURIComponent(doctype)}`, {
      method: "POST",
      headers: { Authorization: `token ${apiKey}:${apiSecret}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) console.error("Contact enquiry saved; optional ERP forwarding failed with status", response.status);
    await response.body?.cancel();
  } catch {
    // Never expose credentials, customer details, or a false submission failure.
    console.error("Contact enquiry saved; optional ERP forwarding was unavailable.");
  }
}

export async function POST(request: Request) {
  try {
    const body = await readContactEnquiryBody(request);
    if (typeof body.website === "string" && body.website.length > 0) {
      return NextResponse.json({ success: true }, { headers: contactEnquiryHeaders });
    }
    const { enquiry, created } = await saveContactEnquiry(body);
    // A retry returns the original receipt and never creates another CRM lead.
    if (created) await forwardToErp(enquiry);
    return NextResponse.json({ success: true, message: "Enquiry received successfully.", id: enquiry.id }, { headers: contactEnquiryHeaders });
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof ContactEnquiryError ? error.message : "We could not save your enquiry. Please try again.",
    }, { status: error instanceof ContactEnquiryError ? error.status : 503, headers: contactEnquiryHeaders });
  }
}
