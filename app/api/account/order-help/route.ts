import { NextResponse } from "next/server";
import { createOrderHelpRequest } from "@/lib/order-help";
import { checkHelpOrigin, orderHelpErrorResponse, orderHelpHeaders, readHelpBody } from "@/lib/order-help-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    checkHelpOrigin(request);
    const saved = await createOrderHelpRequest(await readHelpBody(request));
    return NextResponse.json({ request: saved }, { status: 201, headers: orderHelpHeaders });
  } catch (error) {
    return orderHelpErrorResponse(error);
  }
}
