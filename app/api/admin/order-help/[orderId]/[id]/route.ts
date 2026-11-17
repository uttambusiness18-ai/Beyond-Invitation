import { NextResponse } from "next/server";
import { updateOrderHelpRequest } from "@/lib/order-help";
import { checkHelpOrigin, orderHelpErrorResponse, orderHelpHeaders, readHelpBody } from "@/lib/order-help-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ orderId: string; id: string }> }) {
  try {
    checkHelpOrigin(request);
    const { orderId, id } = await context.params;
    const saved = await updateOrderHelpRequest(orderId, id, await readHelpBody(request));
    return NextResponse.json({ request: saved }, { headers: orderHelpHeaders });
  } catch (error) {
    return orderHelpErrorResponse(error);
  }
}
