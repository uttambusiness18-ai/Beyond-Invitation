import { NextResponse } from "next/server";
import { customerPrintingAction } from "@/lib/order-printing";
import { printingErrorResponse, printingHeaders, readPrintingRequest } from "@/lib/order-printing-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    return NextResponse.json(await customerPrintingAction(await readPrintingRequest(request)), { headers: printingHeaders });
  } catch (error) { return printingErrorResponse(error); }
}
