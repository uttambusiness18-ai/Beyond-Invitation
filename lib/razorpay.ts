import Razorpay from "razorpay";
import crypto from "crypto";

let client: Razorpay | null = null;
let clientKeyId: string | undefined;
let clientSecret: string | undefined;

export class RazorpayConfigurationError extends Error {
  readonly code = "RAZORPAY_CONFIGURATION_ERROR";
}

/** Persist the environment used for this payment; never infer it later from current settings. */
export function getRazorpayPaymentContext(): { mode: "test" | "live"; keyId: string } {
  // Checkout receives this public identifier from the order API. A server-only
  // name avoids depending on NEXT_PUBLIC_* values frozen into a previous build.
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() ||
    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim() || "";
  if (/^rzp_test_[A-Za-z0-9]+$/.test(keyId)) return { mode: "test", keyId };
  if (/^rzp_live_[A-Za-z0-9]+$/.test(keyId)) return { mode: "live", keyId };
  throw new RazorpayConfigurationError(
    "Set RAZORPAY_KEY_ID (or NEXT_PUBLIC_RAZORPAY_KEY_ID) to a valid Razorpay test or live key.",
  );
}

function getRazorpaySecret(): string {
  const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!secret) throw new RazorpayConfigurationError("RAZORPAY_KEY_SECRET is missing.");
  return secret;
}

export function getRazorpay(): Razorpay {
  const { keyId: key_id } = getRazorpayPaymentContext();
  const key_secret = getRazorpaySecret();
  if (!client || clientKeyId !== key_id || clientSecret !== key_secret) {
    client = new Razorpay({ key_id, key_secret });
    clientKeyId = key_id;
    clientSecret = key_secret;
  }
  return client;
}

function timingSafeEqualHex(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Checkout signature: HMAC_SHA256(order_id|payment_id, key_secret). */
export function verifyPaymentSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const secret = getRazorpaySecret();
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${params.orderId}|${params.paymentId}`)
    .digest("hex");
  return timingSafeEqualHex(expected, params.signature);
}

/** Webhook signature: HMAC_SHA256(rawBody, webhook_secret) vs x-razorpay-signature. */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new Error("RAZORPAY_WEBHOOK_SECRET missing.");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return timingSafeEqualHex(expected, signature);
}
