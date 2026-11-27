import { hasMarketingConsent } from "@/lib/cookie-consent";
import type { PaymentReceipt } from "@/lib/payment-receipt-types";
import {
  GOOGLE_TAG_ID,
  GOOGLE_TAG_SCRIPT_ID,
  GOOGLE_TAG_BOOTSTRAP_ID,
  initializeGoogleTag,
} from "@/lib/google-tag";

export { GOOGLE_TAG_ID, GOOGLE_TAG_SCRIPT_ID } from "@/lib/google-tag";
export const GOOGLE_ANALYTICS_ID = "G-X379LZMKP7";
export const GOOGLE_ADS_ID = "AW-18574685891";
export const GOOGLE_ADS_PURCHASE_DESTINATION = `${GOOGLE_ADS_ID}/4scPCKSbrrsdEMPtjJlF`;
export const GOOGLE_ADS_LEAD_DESTINATION = `${GOOGLE_ADS_ID}/39GSCNLBy7wdEMPtjJlF`;

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
let configured = false;
let analyticsConfigured = false;
let previousConsent: boolean | undefined;
let lastTrackedPage: { location: string; referrer: string } | undefined;

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
    // Visit and conversion measurement only: no customer data or remarketing.
    ad_user_data: "denied",
    ad_personalization: "denied",
  };
}

/** Shared tag: cookieless Ads signals by default; Analytics views after consent. */
export function syncGoogleTracking(): boolean {
  if (
    typeof window === "undefined" ||
    /^\/admin(?:\/|$)/.test(window.location.pathname)
  )
    return false;
  try {
    if (!initializeGoogleTag(GOOGLE_TAG_ID, GOOGLE_TAG_SCRIPT_ID, GOOGLE_TAG_BOOTSTRAP_ID, window, document) || !window.gtag)
      return false;
    const accepted = hasMarketingConsent();
    const location = googleTrackingUrl(window.location.href, accepted);
    const referrer = googleTrackingUrl(
      lastTrackedPage?.location === location
        ? lastTrackedPage.referrer
        : (lastTrackedPage?.location ?? googleTrackingUrl(document.referrer)),
      accepted,
    );
    window.gtag("set", { page_location: location, page_referrer: referrer });

    if (accepted !== previousConsent) {
      window.gtag("consent", "update", consentSettings(accepted));
      previousConsent = accepted;
    }
    if (!configured) {
      window.gtag("config", GOOGLE_ADS_ID);
      configured = true;
    }
    if (accepted && !analyticsConfigured) {
      // Explicit views keep private URL parameters out of initial and SPA hits.
      // Keep GA enhanced history page views disabled to avoid duplicate views.
      window.gtag("config", GOOGLE_ANALYTICS_ID, { send_page_view: false });
      analyticsConfigured = true;
    }
    if (!accepted) {
      lastTrackedPage = undefined;
    } else if (location && lastTrackedPage?.location !== location) {
      window.gtag("event", "page_view", {
        send_to: GOOGLE_ANALYTICS_ID,
        page_location: location,
        page_referrer: referrer,
        page_title: document.title,
      });
      lastTrackedPage = { location, referrer };
    }
    return true;
  } catch {
    // Analytics must never interrupt forms, checkout, or the consent controls.
    return false;
  }
}

/** Call once after the enquiry API confirms a successful lead submission. */
export function trackLeadConversion(): boolean {
  try {
    if (!syncGoogleTracking() || !window.gtag) return false;
    window.gtag("event", "conversion", {
      send_to: GOOGLE_ADS_LEAD_DESTINATION,
      value: 1.0,
      currency: "INR",
      page_location: googleTrackingUrl(
        window.location.href,
        hasMarketingConsent(),
      ),
      page_referrer: googleTrackingUrl(document.referrer),
    });
    return true;
  } catch {
    // An optional tracking failure must never turn a saved enquiry into an error.
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
    if (hasMarketingConsent()) {
      try {
        if (
          window.sessionStorage.getItem(key) === GOOGLE_ADS_PURCHASE_DESTINATION
        )
          return false;
      } catch {
        /* Google still deduplicates using the stable transaction ID. */
      }
    }

    queuedPurchases.add(key);
    try {
      window.gtag("event", "conversion", {
        send_to: GOOGLE_ADS_PURCHASE_DESTINATION,
        value: receipt.amountPaise / 100,
        currency: receipt.currency,
        transaction_id: receipt.id,
        page_location: googleTrackingUrl(
          window.location.href,
          hasMarketingConsent(),
        ),
        page_referrer: googleTrackingUrl(document.referrer),
        event_callback: () => {
          // Persist only after the loaded tag processes the event, not when blocked/queued.
          // Consent can be revoked while the event is waiting for the tag.
          if (!hasMarketingConsent()) return;
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
