export const COOKIE_CONSENT_EVENT = "cookie-consent-change";
export const COOKIE_PREFERENCES_EVENT = "cookie-preferences-open";

export type CookieConsent = "accepted" | "declined";

const COOKIE_NAME = "beyond_invitation_cookie_consent";
const COOKIE_VERSION = "v2";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
// Preserve this visit's choice when the browser blocks cookie storage.
let visitChoice: CookieConsent | null = null;

function readStoredConsent(): CookieConsent | null {
  if (typeof document === "undefined") return null;
  try {
    const prefix = `${encodeURIComponent(COOKIE_NAME)}=`;
    const cookie = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith(prefix));
    const value = cookie ? decodeURIComponent(cookie.slice(prefix.length)) : "";
    if (value === `${COOKIE_VERSION}:accepted`) return "accepted";
    if (value === `${COOKIE_VERSION}:declined`) return "declined";
  } catch { /* An unreadable or malformed cookie is not consent. */ }
  return null;
}

export function getCookieConsent(): CookieConsent | null {
  return visitChoice ?? readStoredConsent();
}

export function hasMarketingConsent(): boolean {
  return getCookieConsent() === "accepted";
}

export function saveCookieConsent(choice: CookieConsent): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (choice !== "accepted" && choice !== "declined") return;
  visitChoice = choice;
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${encodeURIComponent(COOKIE_NAME)}=${encodeURIComponent(`${COOKIE_VERSION}:${choice}`)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
    if (readStoredConsent() === choice) visitChoice = null;
  } catch { /* The current visit still honours the choice if cookies are blocked. */ }
  window.dispatchEvent(new window.CustomEvent(COOKIE_CONSENT_EVENT, { detail: { status: choice } }));
}
