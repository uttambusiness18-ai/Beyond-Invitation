export interface PaymentAttempt {
  paymentId: string | null;
  websiteOrderId: string | null;
  trackingToken: string | null;
  receiptToken?: string | null;
  message: string;
  reason: "failed" | "verification";
}

export interface CheckoutDraft {
  name: string;
  email: string;
  contact: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  notes: string;
}

const DRAFT_KEY = "beyond-checkout-draft";
const DRAFT_LIFETIME = 30 * 60 * 1000;
const DRAFT_FIELDS: (keyof CheckoutDraft)[] = [
  "name", "email", "contact", "addressLine1", "addressLine2", "city", "state", "pincode", "country", "notes",
];

/** Keep retry details in this tab, with an expiry, instead of putting personal details in URLs. */
export function saveCheckoutDraft(form: CheckoutDraft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ expiresAt: Date.now() + DRAFT_LIFETIME, form }));
  } catch { /* Checkout also works when browser storage is disabled. */ }
}

export function readCheckoutDraft(): CheckoutDraft | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
    if (!value || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() ||
        !value.form || DRAFT_FIELDS.some((field) => typeof value.form[field] !== "string" || value.form[field].length > 5000)) {
      sessionStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return Object.fromEntries(DRAFT_FIELDS.map((field) => [field, value.form[field]])) as unknown as CheckoutDraft;
  } catch { return null; }
}

export function clearCheckoutDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* Optional browser storage. */ }
}

export function savePaymentAttempt(attempt: PaymentAttempt) {
  if (!attempt.websiteOrderId) return;
  try {
    sessionStorage.setItem(`beyond-payment-attempt:${attempt.websiteOrderId}`, JSON.stringify({
      message: attempt.message.slice(0, 1000), reason: attempt.reason, paymentId: attempt.paymentId,
    }));
  } catch { /* The result page can still load its server-backed receipt. */ }
}

export function readPaymentAttempt(orderId: string): Pick<PaymentAttempt, "message" | "reason" | "paymentId"> | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(`beyond-payment-attempt:${orderId}`) || "null");
    if (!value || typeof value.message !== "string" ||
        !["failed", "verification"].includes(value.reason) ||
        (value.paymentId !== null && typeof value.paymentId !== "string")) return null;
    return { message: value.message.slice(0, 1000), reason: value.reason, paymentId: value.paymentId };
  } catch { return null; }
}

export function paymentResultUrl(result: {
  paymentId: string | null;
  websiteOrderId: string | null;
  trackingToken: string | null;
  receiptToken?: string | null;
  status: "success" | "pending" | "failed";
}): string {
  const params = new URLSearchParams();
  if (result.paymentId) params.set("payment_id", result.paymentId);
  if (result.websiteOrderId) params.set("order_id", result.websiteOrderId);
  if (result.status === "pending") params.set("pending", "1");
  // Separate capabilities in a fragment keep customer details out of shared tracking links,
  // HTTP request URLs, and server logs.
  const secrets = new URLSearchParams();
  if (result.websiteOrderId && result.trackingToken) secrets.set("token", result.trackingToken);
  if (result.websiteOrderId && result.receiptToken) secrets.set("receipt", result.receiptToken);
  const privateLink = secrets.size ? `#${secrets}` : "";
  return `/checkout/${result.status === "failed" ? "failed" : "success"}?${params}${privateLink}`;
}
