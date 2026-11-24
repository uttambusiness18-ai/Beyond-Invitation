import { NextResponse } from "next/server";
import { downloadAdminPrintingFile, listAdminPrintingFiles } from "@/lib/order-printing";
import { OrderPrintingError, printingErrorResponse, printingHeaders, readPrintingRequest } from "@/lib/order-printing-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    return NextResponse.json(await listAdminPrintingFiles((await context.params).id), { headers: printingHeaders });
  } catch (error) { return printingErrorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const body = await readPrintingRequest(request);
    if (body.action !== "download") throw new OrderPrintingError("Choose a printing file to download.");
    return NextResponse.json(await downloadAdminPrintingFile((await context.params).id, body.fileId), { headers: printingHeaders });
  } catch (error) { return printingErrorResponse(error); }
}
