import { hasMarketingConsent } from "@/lib/cookie-consent";
import type { PaymentReceipt } from "@/lib/payment-receipt-types";

export const GOOGLE_TAG_ID = "GTM-PM7X2BZK";
export const GOOGLE_ADS_ID = "AW-18574685891";
export const GOOGLE_ADS_PURCHASE_DESTINATION = `${GOOGLE_ADS_ID}/4scPCKSbrrsdEMPtjJlF`;
export const GOOGLE_TAG_SCRIPT_ID = "beyond-google-tag";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

type PurchaseReceipt = Pick<
  PaymentReceipt,
  "id" | "paymentStatus" | "testMode" | "amountPaise" | "currency"
>;
const ORDER_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ATTRIBUTION_PARAMS = [
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_id",
  "utm_term",
  "utm_content",
];
const queuedPurchases = new Set<string>();
let initialized = false;
let configured = false;
let previousConsent: boolean | undefined;

/** Never expose private receipt/tracking fragments or customer query parameters. */
export function googleTrackingUrl(
  value: string,
  includeAttribution = false,
): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    const clean = new URL(url.origin + url.pathname);
    if (includeAttribution) {
      for (const key of ATTRIBUTION_PARAMS) {
        const parameter = url.searchParams.get(key);
        if (parameter) clean.searchParams.set(key, parameter);
      }
    }
    return clean.href;
  } catch {
    return "";
  }
}

function consentSettings(accepted: boolean) {
  return {
    ad_storage: accepted ? "granted" : "denied",
    analytics_storage: accepted ? "granted" : "denied",
    // Purchase measurement only: no enhanced customer data or remarketing.
    ad_user_data: "denied",
    ad_personalization: "denied",
  };
}

/** One shared Google loader; the published container already includes the Ads destination. */
export function syncGoogleTracking(): boolean {
  if (
    typeof window === "undefined" ||
    /^\/admin(?:\/|$)/.test(window.location.pathname)
  )
    return false;
  try {
    window.dataLayer = window.dataLayer || [];
    window.gtag =
      window.gtag ||
      function () {
        window.dataLayer!.push(arguments);
      };
    if (!initialized) {
      window.gtag("consent", "default", consentSettings(false));
      window.gtag("set", {
        allow_ad_personalization_signals: false,
        allow_enhanced_conversions: false,
      });
      initialized = true;
    }
    window.gtag("set", {
      page_location: googleTrackingUrl(window.location.href, true),
      page_referrer: googleTrackingUrl(document.referrer),
    });

    const accepted = hasMarketingConsent();
    if (accepted !== previousConsent) {
      window.gtag("consent", "update", consentSettings(accepted));
      previousConsent = accepted;
    }
    if (!accepted) return false;

    if (!configured) {
      window.gtag("js", new Date());
      window.gtag("config", GOOGLE_ADS_ID);
      configured = true;
    }
    if (!document.getElementById(GOOGLE_TAG_SCRIPT_ID)) {
      const script = document.createElement("script");
      script.id = GOOGLE_TAG_SCRIPT_ID;
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtm.js?id=${GOOGLE_TAG_ID}`;
      // A later visit/consent update can retry if a transient loading error occurs.
      script.onerror = () => script.remove();
      document.head.appendChild(script);
    }
    return true;
  } catch {
    // Analytics must never interrupt checkout or the consent controls.
    return false;
  }
}

/** Call only with the receipt returned by the authorized server receipt endpoint. */
export function trackPurchaseConversion(receipt: PurchaseReceipt): boolean {
  if (
    receipt.paymentStatus !== "paid" ||
    receipt.testMode !== false ||
    !ORDER_ID.test(receipt.id) ||
    !Number.isSafeInteger(receipt.amountPaise) ||
    receipt.amountPaise <= 0 ||
    receipt.currency !== "INR"
  )
    return false;

  try {
    if (!syncGoogleTracking() || !window.gtag) return false;
    const key = `beyond-google-ads-purchase:${receipt.id}`;
    if (queuedPurchases.has(key)) return false;
    try {
      if (
        window.sessionStorage.getItem(key) === GOOGLE_ADS_PURCHASE_DESTINATION
      )
        return false;
    } catch {
      /* Google still deduplicates using the stable transaction ID. */
    }

    queuedPurchases.add(key);
    try {
      window.gtag("event", "conversion", {
        send_to: GOOGLE_ADS_PURCHASE_DESTINATION,
        value: receipt.amountPaise / 100,
        currency: receipt.currency,
        transaction_id: receipt.id,
        page_location: googleTrackingUrl(window.location.href, true),
        page_referrer: googleTrackingUrl(document.referrer),
        event_callback: () => {
          // Persist only after the loaded tag processes the event, not when blocked/queued.
          try {
            window.sessionStorage.setItem(key, GOOGLE_ADS_PURCHASE_DESTINATION);
          } catch {
            /* Optional storage. */
          }
        },
      });
      return true;
    } catch {
      queuedPurchases.delete(key);
      return false;
    }
  } catch {
    return false;
  }
}
