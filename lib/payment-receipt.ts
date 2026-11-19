import "server-only";

import { getSupabaseAuthServerClient } from "@/lib/supabase/auth-server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyOrderTrackingToken } from "@/lib/order-tracking-token";
import { formatProductName } from "@/lib/product-name";
import type { PaymentReceipt } from "@/lib/payment-receipt-types";

export class PaymentReceiptError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "PaymentReceiptError";
  }
}

type OrderRow = {
  id: string;
  user_id: string | null;
  created_at: string;
  paid_at: string | null;
  payment_status: "pending" | "paid";
  razorpay_payment_id: string | null;
  razorpay_order_id: string | null;
  amount_paise: number;
  currency: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  shipping_address: unknown;
  notes: string;
  items: unknown;
};

const COLUMNS = "id,user_id,created_at,paid_at,payment_status,razorpay_payment_id,razorpay_order_id,amount_paise,currency,customer_name,customer_email,customer_phone,shipping_address,notes,items";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value : "";
const money = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const notFound = () => new PaymentReceiptError("ORDER_NOT_FOUND", "Order details are unavailable. Open the private link from your checkout or sign in to your account.", 404);
const unavailable = () => new PaymentReceiptError("RECEIPT_UNAVAILABLE", "Order details are temporarily unavailable. Please try again.", 503);

function receiptForOrder(row: OrderRow): PaymentReceipt {
  const address = record(row.shipping_address);
  const quote = record(address.shippingQuote);
  if (!money(row.amount_paise) || !Array.isArray(row.items) || row.items.length === 0) throw unavailable();
  let subtotalInr = 0;
  const items = row.items.map((value) => {
    const line = record(value);
    if (typeof line.price !== "number" || !Number.isFinite(line.price) || line.price < 0 ||
        typeof line.quantity !== "number" || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw unavailable();
    subtotalInr += line.price * line.quantity;
    return {
      itemCode: text(line.itemCode),
      name: formatProductName(text(line.name), text(line.printName)),
      quantity: line.quantity,
      unitPricePaise: Math.round(line.price * 100),
      totalPaise: Math.round(line.price * line.quantity * 100),
    };
  });
  // Match checkout's aggregate rounding. Never reprice an order from today's catalogue.
  const subtotalPaise = money(quote.subtotalPaise) ? quote.subtotalPaise : Math.round(subtotalInr * 100);
  const shippingPaise = money(quote.amountPaise) ? quote.amountPaise : null;
  if (!money(subtotalPaise) || subtotalPaise > row.amount_paise ||
      (shippingPaise !== null && subtotalPaise + shippingPaise !== row.amount_paise)) throw unavailable();

  return {
    id: row.id,
    createdAt: row.created_at,
    paidAt: row.payment_status === "paid" ? row.paid_at : null,
    paymentStatus: row.payment_status,
    paymentId: row.payment_status === "paid" ? row.razorpay_payment_id : null,
    gatewayOrderId: row.razorpay_order_id,
    currency: row.currency,
    amountPaise: row.amount_paise,
    subtotalPaise,
    shippingPaise,
    items,
    customer: { name: row.customer_name, email: row.customer_email, phone: row.customer_phone },
    address: {
      addressLine1: text(address.addressLine1),
      addressLine2: text(address.addressLine2),
      city: text(address.city),
      state: text(address.state),
      pincode: text(address.pincode),
      country: text(address.country),
    },
    notes: text(row.notes),
    shipping: {
      service: quote.service === "quick" ? "quick" : "standard",
      courierName: text(quote.courierName) || null,
      estimatedDeliveryDays: typeof quote.estimatedDeliveryDays === "number" &&
        Number.isSafeInteger(Math.ceil(quote.estimatedDeliveryDays)) && quote.estimatedDeliveryDays >= 0
        ? quote.estimatedDeliveryDays : null,
    },
    testMode: address.paymentMode === "test",
  };
}

/** Recheck access and current payment state on every request; no gateway calls or writes. */
export async function getPaymentReceipt(id: unknown, receiptToken?: unknown): Promise<PaymentReceipt> {
  if (typeof id !== "string" || !UUID.test(id)) throw notFound();

  if (typeof receiptToken === "string" && TOKEN.test(receiptToken)) {
    const { data, error } = await getSupabaseAdminClient().from("website_orders").select(COLUMNS).eq("id", id).maybeSingle();
    if (error) throw unavailable();
    if (data && data.id === id && verifyOrderTrackingToken(receiptToken, record(data.shipping_address).receiptTokenHash)) {
      return receiptForOrder(data as OrderRow);
    }
    // A signed-in owner can still open an old or incomplete private link.
  }

  const client = await getSupabaseAuthServerClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) throw notFound();
  const { data, error } = await client.from("website_orders").select(COLUMNS).eq("id", id).eq("user_id", user.id).maybeSingle();
  if (error) throw unavailable();
  if (!data || data.id !== id || data.user_id !== user.id) throw notFound();
  return receiptForOrder(data as OrderRow);
}
