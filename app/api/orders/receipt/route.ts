import { NextResponse } from "next/server";
import { getPaymentReceipt, PaymentReceiptError } from "@/lib/payment-receipt";
import { OrderTrackingError } from "@/lib/order-tracking";
import { readTrackingRequest, trackingHeaders } from "@/lib/order-tracking-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readTrackingRequest(request);
    const receipt = await getPaymentReceipt(body.orderId, body.receiptToken);
    return NextResponse.json({ receipt }, { headers: trackingHeaders });
  } catch (error) {
    if (error instanceof PaymentReceiptError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: trackingHeaders });
    }
    if (error instanceof OrderTrackingError) {
      return NextResponse.json({ error: "Open your checkout result on this website and try again.", code: error.code }, { status: error.status, headers: trackingHeaders });
    }
    return NextResponse.json({ error: "Order details are temporarily unavailable. Please try again." }, { status: 503, headers: trackingHeaders });
  }
}
