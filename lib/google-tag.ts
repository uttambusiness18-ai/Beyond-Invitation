export const GOOGLE_TAG_ID = "GTM-PM7X2BZK";
export const GOOGLE_TAG_SCRIPT_ID = "beyond-google-tag";
export const GOOGLE_TAG_BOOTSTRAP_ID = "beyond-google-tag-bootstrap";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    __beyondGoogleTagInitialized?: boolean;
  }
}

/**
 * Runs both in the initial head and as a retry during client navigation.
 * Keep this function self-contained: its source is also the inline bootstrap.
 * Pass browser globals explicitly so Next's server compiler cannot fold a
 * typeof-window guard into a no-op before the function is serialized.
 */
export function initializeGoogleTag(
  tagId: string,
  scriptId: string,
  bootstrapId: string,
  browserWindow: Window,
  browserDocument: Document,
): boolean {
  if (/^\/admin(?:\/|$)/.test(browserWindow.location.pathname))
    return false;
  try {
    browserWindow.dataLayer = browserWindow.dataLayer || [];
    browserWindow.gtag = browserWindow.gtag || function () { browserWindow.dataLayer!.push(arguments); };
    if (!browserWindow.__beyondGoogleTagInitialized) {
      // Defaults and clean URLs must precede the first Google network request.
      const cleanUrl = (value: string) => {
        try {
          const url = new URL(value);
          return /^https?:$/.test(url.protocol) ? url.origin + url.pathname : "";
        } catch { return ""; }
      };
      browserWindow.gtag("consent", "default", {
        ad_storage: "denied",
        analytics_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
      browserWindow.gtag("set", {
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        allow_enhanced_conversions: false,
        ads_data_redaction: true,
        url_passthrough: false,
        page_location: cleanUrl(browserWindow.location.href),
        page_referrer: cleanUrl(browserDocument.referrer),
      });
      browserWindow.gtag("js", new Date());
      browserWindow.__beyondGoogleTagInitialized = true;
    }
    if (!browserDocument.getElementById(scriptId)) {
      const script = browserDocument.createElement("script");
      script.id = scriptId;
      script.async = true;
      script.src = "https://www.googletagmanager.com/gtm.js?id=" + tagId;
      script.onerror = () => script.remove();
      const bootstrap = browserDocument.getElementById(bootstrapId);
      browserDocument.head.insertBefore(script, bootstrap ? bootstrap.nextSibling : browserDocument.head.firstChild);
    }
    return true;
  } catch {
    // Tracking must never prevent the page or checkout from working.
    return false;
  }
}

export const GOOGLE_TAG_BOOTSTRAP = `(${initializeGoogleTag.toString()})(${JSON.stringify(GOOGLE_TAG_ID)},${JSON.stringify(GOOGLE_TAG_SCRIPT_ID)},${JSON.stringify(GOOGLE_TAG_BOOTSTRAP_ID)},window,document);`;
