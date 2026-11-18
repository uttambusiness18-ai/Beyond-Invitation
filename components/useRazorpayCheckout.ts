"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DeliveryLocation, ShippingSelection } from "@/lib/shipping";
import type { PaymentAttempt } from "@/lib/payment-attempt";

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

declare global {
  interface Window {
    Razorpay?: any;
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);

    if (window.Razorpay) return resolve(true);

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    );

    if (existing) {
      if (existing.dataset.loaded === "true") return resolve(true);

      if (existing.dataset.error === "true") {
        existing.remove();
      } else {
        const onLoad = () => {
          existing.dataset.loaded = "true";
          cleanup();
          resolve(true);
        };

        const onError = () => {
          existing.dataset.error = "true";
          cleanup();
          resolve(false);
        };

        const cleanup = () => {
          existing.removeEventListener("load", onLoad);
          existing.removeEventListener("error", onError);
        };

        existing.addEventListener("load", onLoad);
        existing.addEventListener("error", onError);
        return;
      }
    }

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;

    script.onload = () => {
      script.dataset.loaded = "true";
      resolve(true);
    };

    script.onerror = () => {
      script.dataset.error = "true";
      resolve(false);
    };

    document.body.appendChild(script);
  });
}

export interface CheckoutItem {
  itemCode?: string;
  slug?: string;
  quantity: number;
}

export interface CheckoutCustomer {
  name?: string;
  email?: string;
  contact?: string;

  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;

  notes?: string;
}

interface StartArgs {
  items: CheckoutItem[];
  expectedAmountPaise: number;
  expectedShippingAmountPaise: number;
  service?: ShippingSelection["service"];
  deliveryLocation?: DeliveryLocation;
  deliveryPlaceId?: string;
  customer?: CheckoutCustomer;
  onSuccess?: (r: {
    paymentId: string;
    websiteOrderId: string | null;
    paymentPending: boolean;
    trackingToken: string | null;
    receiptToken?: string | null;
  }) => void;
  onError?: (message: string) => void;
  onFailure?: (attempt: PaymentAttempt) => void;
  onDismiss?: () => void;
  onQuoteChanged?: () => void;
}

export function useRazorpayCheckout() {
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const pendingOrder = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingOrder.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    if (mounted.current) setLoading(false);
    busy.current = false;
  }, []);

  const startCheckout = useCallback(
    async (args: StartArgs) => {
      if (busy.current || !mounted.current) return;

      busy.current = true;
      setLoading(true);
      const controller = new AbortController();
      pendingOrder.current = controller;
      const isCurrent = () => mounted.current && !controller.signal.aborted;

      try {
        const ok = await loadRazorpayScript();
        if (!isCurrent()) { reset(); return; }

        if (!ok || !window.Razorpay) {
          throw new Error(
            "Couldn't load the Razorpay checkout. Check your connection and retry.",
          );
        }

        const orderRes = await fetch("/api/razorpay/order", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            items: args.items,
            customer: args.customer,
            expectedAmountPaise: args.expectedAmountPaise,
            expectedShippingAmountPaise: args.expectedShippingAmountPaise,
            service: args.service ?? "standard",
            ...(args.service === "quick" && args.deliveryLocation ? { deliveryLocation: args.deliveryLocation } : {}),
            ...(args.service === "quick" && args.deliveryPlaceId ? { deliveryPlaceId: args.deliveryPlaceId } : {}),
          }),
        });

        if (!isCurrent()) { reset(); return; }
        const orderData = await orderRes.json();
        if (!isCurrent()) { reset(); return; }

        if (!orderRes.ok) {
          if (orderRes.status === 409) args.onQuoteChanged?.();
          throw new Error(orderData?.error || "Couldn't start checkout.");
        }

        const trackingToken = typeof orderData.trackingToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(orderData.trackingToken)
          ? orderData.trackingToken : null;
        const receiptToken = typeof orderData.receiptToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(orderData.receiptToken)
          ? orderData.receiptToken : null;
        let outcome: "open" | "verifying" | "settled" = "open";
        const reportFailure = (reason: PaymentAttempt["reason"], message: string, paymentId: unknown) => {
          if (!mounted.current) return;
          if (args.onFailure) args.onFailure({
            reason, message,
            paymentId: typeof paymentId === "string" ? paymentId : null,
            websiteOrderId: orderData.websiteOrderId ?? null,
            trackingToken,
            receiptToken,
          });
          else args.onError?.(message);
        };

        const rzp = new window.Razorpay({
          key: orderData.keyId,
          amount: orderData.amount,
          currency: orderData.currency,
          name: "Beyond Invitation",
          description: "Wedding & ceremony invitation cards",
          image: "/logo.png",
          order_id: orderData.orderId,
          prefill: {
            name: args.customer?.name,
            email: args.customer?.email,
            contact: args.customer?.contact,
          },
          notes: {
            customer_name: args.customer?.name || "",
            customer_email: args.customer?.email || "",
            customer_contact: args.customer?.contact || "",
            city: args.customer?.city || "",
            state: args.customer?.state || "",
            pincode: args.customer?.pincode || "",
          },
          theme: {
            color: "#7B1C2E",
          },
          modal: {
            ondismiss: () => {
              // A programmatic close or late dismissal must not interrupt verification
              // or cause a second navigation after the result has been handled.
              if (outcome !== "open") return;
              outcome = "settled";
              reset();
              if (mounted.current) args.onDismiss?.();
            },
          },
          handler: async (response: any) => {
            if (outcome !== "open") return;
            outcome = "verifying";
            try {
              if (response.razorpay_order_id !== orderData.orderId) {
                throw new Error("Payment details do not match this checkout. Please contact us with your payment reference.");
              }
              const verifyRes = await fetch("/api/razorpay/verify", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(response),
              });

              const verifyData = await verifyRes.json();

              if (!verifyRes.ok || !verifyData.verified) {
                throw new Error(
                  verifyData?.error || "Payment could not be verified.",
                );
              }

              if ((verifyData.websiteOrderId && verifyData.websiteOrderId !== orderData.websiteOrderId) ||
                  verifyData.paymentId !== response.razorpay_payment_id) {
                throw new Error("Payment details do not match this checkout. Please contact us with your payment reference.");
              }

              // Finish verification after navigation, but do not clear a newer cart
              // or redirect the customer from an abandoned checkout page.
              if (mounted.current) args.onSuccess?.({
                paymentId: verifyData.paymentId,
                websiteOrderId: verifyData.websiteOrderId ?? orderData.websiteOrderId ?? null,
                paymentPending: !!verifyData.paymentPending,
                trackingToken,
                receiptToken,
              });
            } catch (e) {
              // The gateway reported completion. Verification errors are uncertain,
              // not evidence of a failed payment, so do not invite another payment.
              reportFailure("verification", e instanceof Error ? e.message : "Payment confirmation is pending.", response.razorpay_payment_id);
            } finally {
              outcome = "settled";
              reset();
            }
          },
        });

        rzp.on("payment.failed", (resp: any) => {
          if (outcome !== "open") return;
          outcome = "settled";
          // Close before leaving checkout, and ignore the resulting ondismiss event.
          try { rzp.close(); } catch { /* The gateway may have closed itself. */ }
          reset();
          reportFailure("failed", typeof resp?.error?.description === "string"
            ? resp.error.description : "Your payment could not be completed.", resp?.error?.metadata?.payment_id);
        });

        rzp.open();
      } catch (e) {
        reset();
        if (isCurrent()) args.onError?.(
          e instanceof Error
            ? e.message
            : "Something went wrong starting checkout.",
        );
      } finally {
        if (pendingOrder.current === controller) pendingOrder.current = null;
      }
    },
    [reset],
  );

  return {
    startCheckout,
    loading,
  };
}
