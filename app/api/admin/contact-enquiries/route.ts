import { NextResponse } from "next/server";
import { ContactEnquiryError, contactEnquiryHeaders, listContactEnquiries } from "@/lib/contact-enquiries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const result = await listContactEnquiries(new URL(request.url).searchParams.get("cursor"));
    return NextResponse.json(result, { headers: contactEnquiryHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof ContactEnquiryError ? error.message : "Contact enquiries are temporarily unavailable. Please try again." },
      { status: error instanceof ContactEnquiryError ? error.status : 503, headers: contactEnquiryHeaders },
    );
  }
}
