"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  CreditCard,
  FileText,
  Heart,
  LoaderCircle,
  Mail,
  MapPin,
  MessageCircle,
  Package,
  Printer,
  RefreshCw,
  ShieldCheck,
  Truck,
  X,
} from "lucide-react";
import { usePrivateTrackingToken } from "@/components/usePrivateTrackingToken";
import OrderPrintingMatter from "@/components/OrderPrintingMatter";
import { privateTrackingLink } from "@/lib/order-tracking-link";
import { readPaymentAttempt } from "@/lib/payment-attempt";
import type { PaymentReceipt } from "@/lib/payment-receipt-types";
import { trackPurchaseConversion } from "@/lib/google-tracking";
import { COOKIE_CONSENT_EVENT } from "@/lib/cookie-consent";
import { CONTACT } from "@/lib/site-config";
import { formatProductName } from "@/lib/product-name";
import { formatDeliveryEstimate } from "@/lib/shipping";
import styles from "./PaymentResult.module.css";

type ResultState = "loading" | "success" | "pending" | "failed" | "unavailable";
type Props = {
  outcome: "success" | "failed";
  orderId?: string;
  paymentId?: string;
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function money(paise: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(paise / 100);
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unavailable";
  return (
    new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    }).format(date) + " IST"
  );
}

const copy = {
  loading: {
    eyebrow: "ONE MOMENT",
    title: "Checking your payment",
    description:
      "We’re checking your order and gathering all the details. Please keep this page open.",
    label: "Checking",
  },
  success: {
    eyebrow: "A BEAUTIFUL BEGINNING",
    title: "Payment successful",
    description:
      "Thank you for choosing Beyond Invitation. We’re delighted to be a small part of your big celebration.",
    label: "Paid",
  },
  pending: {
    eyebrow: "WE’RE ON IT",
    title: "Just confirming your payment",
    description:
      "Your payment confirmation is still on its way. Please don’t pay again while we check the status of your order.",
    label: "Confirmation pending",
  },
  failed: {
    eyebrow: "LET’S TRY THAT AGAIN",
    title: "Payment not completed",
    description:
      "We couldn’t complete this payment. Your cart is saved, so you can return to checkout when you’re ready.",
    label: "Not completed",
  },
  unavailable: {
    eyebrow: "HERE TO HELP",
    title: "Let’s check your order",
    description:
      "We can’t confirm your payment from this page yet. Open your original order link or contact us with your payment reference.",
    label: "Status unavailable",
  },
};

export default function PaymentResult({ outcome, orderId, paymentId }: Props) {
  const { ready, token } = usePrivateTrackingToken();
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] =
    useState<ReturnType<typeof readPaymentAttempt>>(null);
  const [receiptToken, setReceiptToken] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [refresh, setRefresh] = useState(0);
  const pollCount = useRef(0);
  const validOrderId =
    typeof orderId === "string" && UUID.test(orderId) ? orderId : null;
  const reference =
    typeof paymentId === "string" && /^[\w-]{1,100}$/.test(paymentId)
      ? paymentId
      : null;

  useEffect(() => {
    setReceipt(null);
    setAttempt(validOrderId ? readPaymentAttempt(validOrderId) : null);
    pollCount.current = 0;
  }, [validOrderId]);

  useEffect(() => {
    const read = () => {
      const value = new URLSearchParams(
        window.location.hash.replace(/^#/, ""),
      ).get("receipt");
      setReceiptToken(
        value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null,
      );
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!validOrderId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    let active = true;
    setLoading(true);
    setError("");
    async function load() {
      try {
        const response = await fetch("/api/orders/receipt", {
          method: "POST",
          cache: "no-store",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: validOrderId,
            ...(receiptToken ? { receiptToken } : {}),
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.receipt || data.receipt.id !== validOrderId) {
          throw new Error(
            response.status === 401 || response.status === 404
              ? "Open the original link from checkout, or sign in to the account used for this order."
              : "Your order details couldn’t be loaded. Please check again in a moment.",
          );
        }
        if (active) setReceipt(data.receipt);
      } catch (err) {
        if (active)
          setError(
            err instanceof Error && err.name !== "AbortError"
              ? err.message
              : "This is taking longer than expected. Please check again.",
          );
      } finally {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [validOrderId, receiptToken, ready, refresh]);

  // Only the stored, authorized order can confirm payment; URL parameters cannot.
  const state: ResultState =
    receipt?.paymentStatus === "paid"
      ? "success"
      : loading && !receipt
        ? "loading"
        : outcome === "failed" && attempt?.reason === "failed"
          ? "failed"
          : receipt
            ? "pending"
            : "unavailable";
  const content = copy[state];
  const trackingHref = receipt && privateTrackingLink(receipt.id, token);
  const orderHref =
    receipt && receiptToken
      ? `/checkout/success?order_id=${encodeURIComponent(receipt.id)}#${new URLSearchParams({ receipt: receiptToken, ...(token ? { token } : {}) }).toString()}`
      : null;
  const paymentReference =
    receipt?.paymentId || attempt?.paymentId || reference;
  const itemCount =
    receipt?.items.reduce((sum, item) => sum + item.quantity, 0) || 0;

  useEffect(() => {
    if (
      outcome !== "success" ||
      !receipt ||
      receipt.id !== validOrderId ||
      receipt.paymentStatus !== "paid" ||
      receipt.testMode
    )
      return;
    const purchase: Pick<
      PaymentReceipt,
      "id" | "paymentStatus" | "testMode" | "amountPaise" | "currency"
    > = {
      id: receipt.id,
      paymentStatus: receipt.paymentStatus,
      testMode: receipt.testMode,
      amountPaise: receipt.amountPaise,
      currency: receipt.currency,
    };
    const track = () => {
      trackPurchaseConversion(purchase);
    };
    track();
    // A customer may accept measurement after their payment has been confirmed.
    window.addEventListener(COOKIE_CONSENT_EVENT, track);
    return () => window.removeEventListener(COOKIE_CONSENT_EVENT, track);
  }, [outcome, receipt, validOrderId]);

  useEffect(() => {
    if (state !== "pending" || loading || error || pollCount.current >= 5)
      return;
    const timer = window.setTimeout(() => {
      pollCount.current += 1;
      setRefresh((value) => value + 1);
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [state, loading, error, refresh]);

  const copyValue = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setAnnouncement(`${label} copied.`);
    } catch {
      setAnnouncement(
        "Copy isn’t available in this browser. You can select and copy the reference below.",
      );
    }
  }, []);

  function refreshStatus() {
    setRefresh((value) => value + 1);
  }
  const StatusIcon =
    state === "success"
      ? Check
      : state === "failed"
        ? X
        : state === "loading"
          ? LoaderCircle
          : state === "pending"
            ? Clock3
            : CircleHelp;

  return (
    <div className={styles.page} data-payment-state={state}>
      <div className={styles.container}>
        <nav className={styles.breadcrumb} aria-label="Checkout progress">
          <Link href="/cart">Your cart</Link>
          <ChevronRight size={13} aria-hidden="true" />
          <span>Checkout</span>
          <ChevronRight size={13} aria-hidden="true" />
          <span aria-current="page">
            {state === "success" ? "Confirmation" : "Payment status"}
          </span>
        </nav>
        <section className={styles.hero} aria-labelledby="payment-result-title">
          <div className={styles.heroOrnament} aria-hidden="true">
            <Heart size={20} strokeWidth={1} />
          </div>
          <div className={styles.statusIcon}>
            <StatusIcon
              size={32}
              strokeWidth={1.7}
              className={state === "loading" ? styles.spin : undefined}
              aria-hidden="true"
            />
          </div>
          <p className={styles.eyebrow}>{content.eyebrow}</p>
          <h1 id="payment-result-title" aria-live="polite" aria-atomic="true">
            {content.title}
          </h1>
          <p className={styles.heroDescription}>{content.description}</p>
          {receipt?.testMode && (
            <p className={styles.testNotice}>
              Test order · No live payment or delivery
            </p>
          )}
          <div className={styles.actions}>
            {state === "success" && (
              <>
                <Link
                  className={styles.primaryButton}
                  href={trackingHref || "/account#orders"}
                  prefetch={false}
                  rel="noreferrer"
                >
                  <Package size={17} aria-hidden="true" />
                  Track your order
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <Link className={styles.secondaryButton} href="/">
                  Continue shopping
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </>
            )}
            {state === "failed" && (
              <>
                <Link className={styles.primaryButton} href="/checkout">
                  <RefreshCw size={16} aria-hidden="true" />
                  Return to checkout
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <Link className={styles.secondaryButton} href="/contact">
                  Get payment help
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </>
            )}
            {(state === "pending" || state === "unavailable") && (
              <>
                {validOrderId && (
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={refreshStatus}
                    disabled={loading}
                  >
                    <RefreshCw
                      size={16}
                      className={loading ? styles.spin : undefined}
                      aria-hidden="true"
                    />
                    {loading ? "Checking status…" : "Check payment status"}
                  </button>
                )}
                <Link className={styles.secondaryButton} href="/contact">
                  Contact our team
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </>
            )}
          </div>
          {state === "success" && (
            <p className={styles.heroFootnote}>
              <ShieldCheck size={14} aria-hidden="true" />
              Payment confirmed securely through Razorpay
            </p>
          )}
        </section>

        {state === "failed" && (
          <div className={styles.notice} role="note">
            <CircleHelp size={20} aria-hidden="true" />
            <div>
              <strong>
                {attempt?.message || "Your payment attempt was unsuccessful."}
              </strong>
              <p>
                If money was debited, check with your bank or contact our team
                before trying again. Keep your payment reference handy.
              </p>
            </div>
          </div>
        )}
        {state === "pending" && (
          <div className={styles.notice} role="status">
            <Clock3 size={20} aria-hidden="true" />
            <div>
              <strong>No need to make another payment.</strong>
              <p>
                Payment can take a moment to confirm. Check the status here, or
                contact our team with your order reference.
              </p>
            </div>
          </div>
        )}
        {error && (
          <div className={styles.loadError} role="alert">
            <CircleHelp size={18} aria-hidden="true" />
            <div>
              <p>{error}</p>
              {receipt && (
                <p>The details below are from the last successful check.</p>
              )}
            </div>
            <button type="button" disabled={loading} onClick={refreshStatus}>
              Try again
            </button>
          </div>
        )}

        {receipt ? (
          <div className={styles.layout}>
            <div className={styles.mainColumn}>
              {state === "success" && (
                <OrderPrintingMatter
                  key={receipt.id}
                  orderId={receipt.id}
                  receiptToken={receiptToken}
                />
              )}
              <section
                className={styles.card}
                aria-labelledby="order-summary-title"
              >
                <div className={styles.cardHeading}>
                  <div className={styles.headingWithIcon}>
                    <Package size={20} aria-hidden="true" />
                    <h2 id="order-summary-title">Your order</h2>
                  </div>
                  <span className={styles.quantityBadge}>
                    {itemCount} {itemCount === 1 ? "item" : "items"}
                  </span>
                </div>
                <div className={styles.orderReference}>
                  <div>
                    <span className={styles.label}>ORDER REFERENCE</span>
                    <span className={styles.referenceValue}>{receipt.id}</span>
                  </div>
                  <button
                    className={styles.iconButton}
                    type="button"
                    aria-label="Copy order reference"
                    onClick={() =>
                      void copyValue(receipt.id, "Order reference")
                    }
                  >
                    <Copy size={16} aria-hidden="true" />
                  </button>
                </div>
                <ul className={styles.items}>
                  {receipt.items.map((item, index) => (
                    <li
                      key={`${item.itemCode}-${index}`}
                      className={styles.item}
                    >
                      <div className={styles.itemIcon} aria-hidden="true">
                        <Mail size={25} strokeWidth={1.2} />
                      </div>
                      <div className={styles.itemDescription}>
                        <h3>{formatProductName(item.name)}</h3>
                        {item.itemCode && <p>Design {item.itemCode}</p>}
                        <p>
                          Qty {item.quantity} <span aria-hidden="true">×</span>{" "}
                          {money(item.unitPricePaise, receipt.currency)}
                        </p>
                      </div>
                      <strong className={styles.itemPrice}>
                        {money(item.totalPaise, receipt.currency)}
                      </strong>
                    </li>
                  ))}
                </ul>
              </section>
              <section
                className={styles.card}
                aria-labelledby="delivery-details-title"
              >
                <div className={styles.cardHeading}>
                  <div className={styles.headingWithIcon}>
                    <MapPin size={20} aria-hidden="true" />
                    <h2 id="delivery-details-title">Delivery & contact</h2>
                  </div>
                </div>
                <div className={styles.deliveryGrid}>
                  <div>
                    <p className={styles.label}>DELIVERY ADDRESS</p>
                    <address>
                      <strong>{receipt.customer.name}</strong>
                      <span>{receipt.address.addressLine1}</span>
                      {receipt.address.addressLine2 && (
                        <span>{receipt.address.addressLine2}</span>
                      )}
                      <span>
                        {receipt.address.city}, {receipt.address.state}{" "}
                        {receipt.address.pincode}
                      </span>
                      <span>{receipt.address.country}</span>
                    </address>
                  </div>
                  <div>
                    <p className={styles.label}>CONTACT DETAILS</p>
                    <div className={styles.contactDetails}>
                      <span>{receipt.customer.email}</span>
                      <span>{receipt.customer.phone}</span>
                    </div>
                    <div className={styles.deliveryMethod}>
                      <Truck size={17} aria-hidden="true" />
                      <span>
                        {receipt.shipping.service === "quick"
                          ? "Quick delivery"
                          : "Standard delivery"}
                      </span>
                    </div>
                    <p className={styles.deliveryNote}>
                      Delivery updates will appear in your order tracking.
                    </p>
                  </div>
                </div>
                {state === "success" && (
                  <div className={styles.deliveryEstimate}>
                    <p className={styles.estimateLabel}>Estimated delivery</p>
                    <p className={styles.estimateValue}>
                      {formatDeliveryEstimate(
                        receipt.shipping.estimatedDeliveryDays,
                      ) || "Delivery estimate unavailable."}
                    </p>
                    <p className={styles.estimateNote}>
                      Preparation and personalisation time is additional. Check
                      your order tracking for delivery updates.
                    </p>
                  </div>
                )}
                {receipt.notes && (
                  <div className={styles.orderNotes}>
                    <p className={styles.label}>YOUR ORDER NOTES</p>
                    <p>{receipt.notes}</p>
                  </div>
                )}
              </section>
              {state === "success" && (
                <section
                  className={styles.nextSteps}
                  aria-labelledby="next-steps-title"
                >
                  <div className={styles.headingWithIcon}>
                    <Heart size={19} aria-hidden="true" />
                    <h2 id="next-steps-title">
                      A little closer to your celebration
                    </h2>
                  </div>
                  <ol>
                    <li>
                      <span>01</span>
                      <div>
                        <h3>Printing, if needed</h3>
                        <p>
                          Buying cards without printing? No upload is needed.
                          For printing, use the optional upload above; our team
                          will confirm the charges and final proof with you.
                        </p>
                      </div>
                    </li>
                    <li>
                      <span>02</span>
                      <div>
                        <h3>Made with care</h3>
                        <p>
                          We’ll prepare your cards for dispatch. If you requested
                          printing, we’ll first confirm your final proof with you.
                        </p>
                      </div>
                    </li>
                    <li>
                      <span>03</span>
                      <div>
                        <h3>On its way to you</h3>
                        <p>
                          Follow delivery progress with your private tracking
                          link.
                        </p>
                      </div>
                    </li>
                  </ol>
                </section>
              )}
            </div>
            <aside
              className={styles.sidebar}
              aria-label="Payment summary and support"
            >
              <section
                className={styles.paymentCard}
                aria-labelledby="payment-details-title"
              >
                <div className={styles.paymentHeading}>
                  <CreditCard size={20} aria-hidden="true" />
                  <h2 id="payment-details-title">Payment details</h2>
                  <span className={styles.paymentBadge}>
                    {state === "success" ? (
                      <CheckCheck size={13} aria-hidden="true" />
                    ) : (
                      <Clock3 size={13} aria-hidden="true" />
                    )}
                    {content.label}
                  </span>
                </div>
                <p className={styles.totalLabel}>
                  {state === "success" ? "TOTAL PAID" : "ORDER TOTAL"}
                </p>
                <p className={styles.total}>
                  {money(receipt.amountPaise, receipt.currency)}
                </p>
                <dl className={styles.breakdown}>
                  <div>
                    <dt>Subtotal</dt>
                    <dd>{money(receipt.subtotalPaise, receipt.currency)}</dd>
                  </div>
                  <div>
                    <dt>Shipping</dt>
                    <dd>
                      {receipt.shippingPaise === null
                        ? "Included in total"
                        : receipt.shippingPaise === 0
                          ? "Free"
                          : money(receipt.shippingPaise, receipt.currency)}
                    </dd>
                  </div>
                  <div className={styles.totalRow}>
                    <dt>
                      Total <span>({receipt.currency})</span>
                    </dt>
                    <dd>{money(receipt.amountPaise, receipt.currency)}</dd>
                  </div>
                </dl>
                <dl className={styles.paymentMeta}>
                  <div>
                    <dt>
                      {state === "success" && receipt.paidAt
                        ? "Paid on"
                        : "Order placed"}
                    </dt>
                    <dd>
                      {dateLabel(
                        state === "success" && receipt.paidAt
                          ? receipt.paidAt
                          : receipt.createdAt,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Payment provider</dt>
                    <dd>Razorpay</dd>
                  </div>
                  {paymentReference && (
                    <div>
                      <dt>Payment reference</dt>
                      <dd className={styles.copyReference}>
                        <span>{paymentReference}</span>
                        <button
                          type="button"
                          aria-label="Copy payment reference"
                          onClick={() =>
                            void copyValue(
                              paymentReference,
                              "Payment reference",
                            )
                          }
                        >
                          <Copy size={14} aria-hidden="true" />
                        </button>
                      </dd>
                    </div>
                  )}
                  {receipt.gatewayOrderId && (
                    <div>
                      <dt>Gateway order reference</dt>
                      <dd>{receipt.gatewayOrderId}</dd>
                    </div>
                  )}
                </dl>
                {state === "success" && (
                  <button
                    className={styles.printButton}
                    type="button"
                    onClick={() => window.print()}
                  >
                    <Printer size={16} aria-hidden="true" />
                    Print order summary
                  </button>
                )}
              </section>
              {state === "success" && orderHref && (
                <section className={styles.saveLink}>
                  <div className={styles.headingWithIcon}>
                    <FileText size={18} aria-hidden="true" />
                    <h2>Save your order link</h2>
                  </div>
                  <p>
                    View your order or return later to upload printing matter
                    if needed, even without an account.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      void copyValue(
                        new URL(orderHref, window.location.origin).href,
                        "Private order and upload link",
                      )
                    }
                  >
                    <Copy size={15} aria-hidden="true" />
                    Copy order &amp; upload link
                  </button>
                  <small>
                    Keep this link private. Anyone with it can view your order
                    details and access your printing files.
                  </small>
                </section>
              )}
              {state === "success" && trackingHref && (
                <section className={styles.saveLink}>
                  <div className={styles.headingWithIcon}>
                    <Package size={18} aria-hidden="true" />
                    <h2>Delivery updates</h2>
                  </div>
                  <p>Save your private link to follow your parcel.</p>
                  <button
                    type="button"
                    onClick={() =>
                      void copyValue(
                        new URL(trackingHref, window.location.origin).href,
                        "Private tracking link",
                      )
                    }
                  >
                    <Copy size={15} aria-hidden="true" />
                    Copy private tracking link
                  </button>
                  <small>
                    This separate link provides delivery tracking only.
                  </small>
                </section>
              )}
              <section className={styles.helpCard}>
                <span className={styles.helpIcon}>
                  <MessageCircle size={21} aria-hidden="true" />
                </span>
                <h2>A little help, just a message away.</h2>
                <p>
                  Have your order reference ready and our team will help you
                  with the next step.
                </p>
                <Link href="/contact">
                  Talk to our team
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <a
                  className={styles.supportEmail}
                  href={`mailto:${CONTACT.email}`}
                >
                  {CONTACT.email}
                </a>
              </section>
            </aside>
          </div>
        ) : loading ? (
          <div className={styles.loadingCard} role="status">
            <LoaderCircle
              className={styles.spin}
              size={22}
              aria-hidden="true"
            />
            <p>Loading your order details…</p>
          </div>
        ) : (
          <section className={styles.emptyCard}>
            <FileText size={28} strokeWidth={1.3} aria-hidden="true" />
            <h2>Your order details</h2>
            <p>
              Use your original checkout link or visit My Orders to see your
              items, payment breakdown and delivery address.
            </p>
            {(validOrderId || reference) && (
              <dl className={styles.fallbackReferences}>
                {validOrderId && (
                  <div>
                    <dt>Order reference</dt>
                    <dd>{validOrderId}</dd>
                  </div>
                )}
                {reference && (
                  <div>
                    <dt>Payment reference</dt>
                    <dd>{reference}</dd>
                  </div>
                )}
              </dl>
            )}
            <Link className={styles.secondaryButton} href="/account#orders">
              Go to My Orders
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            {state === "unavailable" && (
              <p className={styles.unknownNotice}>
                If you have already paid, please confirm the status with our
                team before making another payment.
              </p>
            )}
          </section>
        )}
        <div className={styles.footerNote}>
          <ShieldCheck size={16} aria-hidden="true" />
          <span>Secure payments. Thoughtfully crafted invitations.</span>
        </div>
        <Link className={styles.backLink} href="/">
          <ArrowLeft size={15} aria-hidden="true" />
          Back to Beyond Invitation
        </Link>
        <p className={styles.announcement} role="status" aria-live="polite">
          {announcement}
        </p>
      </div>
    </div>
  );
}
