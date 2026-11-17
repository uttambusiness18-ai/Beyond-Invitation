import { NextResponse } from "next/server";
import { listOrderHelpRequests } from "@/lib/order-help";
import { orderHelpErrorResponse, orderHelpHeaders } from "@/lib/order-help-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const result = await listOrderHelpRequests(new URL(request.url).searchParams.get("cursor"));
    return NextResponse.json(result, { headers: orderHelpHeaders });
  } catch (error) {
    return orderHelpErrorResponse(error);
  }
}
