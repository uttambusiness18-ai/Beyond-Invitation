export const COOKIE_CONSENT_EVENT = "cookie-consent-change";
export const COOKIE_PREFERENCES_EVENT = "cookie-preferences-open";

export type CookieConsent = "accepted" | "declined";

const COOKIE_NAME = "beyond_invitation_cookie_consent";
const COOKIE_VERSION = "v2";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const STORAGE_KEY = COOKIE_NAME;
// Preserve this visit's choice when durable storage is unavailable.
let visitChoice: CookieConsent | null = null;

function readStoredConsent(): CookieConsent | null {
  if (typeof document === "undefined") return null;
  try {
    const prefix = `${encodeURIComponent(COOKIE_NAME)}=`;
    let choice: CookieConsent | null = null;
    for (const cookie of document.cookie.split(";").map(value => value.trim())) {
      if (!cookie.startsWith(prefix)) continue;
      try {
        const value = decodeURIComponent(cookie.slice(prefix.length));
        // A stale cookie at another path must not hide a current preference.
        // When current-version cookies conflict, keep optional tracking off.
        if (value === `${COOKIE_VERSION}:declined`) return "declined";
        if (value === `${COOKIE_VERSION}:accepted`) choice = "accepted";
      } catch { /* Ignore malformed duplicates, not the whole cookie list. */ }
    }
    return choice;
  } catch { /* An unreadable or malformed cookie is not consent. */ }
  return null;
}

function readBackupConsent(): CookieConsent | null {
  if (typeof window === "undefined") return null;
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return null;
    const record = saved as Record<string, unknown>;
    if (record.version !== COOKIE_VERSION ||
        (record.choice !== "accepted" && record.choice !== "declined") ||
        typeof record.expiresAt !== "number" || !Number.isSafeInteger(record.expiresAt) ||
        record.expiresAt <= Date.now()) return null;
    return record.choice;
  } catch { /* Storage can be unavailable or contain an obsolete preference. */ }
  return null;
}

export function getCookieConsent(): CookieConsent | null {
  // The cookie remains authoritative; a stale backup cannot reverse a decline.
  return visitChoice ?? readStoredConsent() ?? readBackupConsent();
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
  try {
    // Only an explicit choice starts this lifetime. Reads and repeat visits do
    // not extend consent or promote an older essential-only cookie to consent.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: COOKIE_VERSION,
      choice,
      expiresAt: Date.now() + COOKIE_MAX_AGE * 1000,
    }));
    // Read the durable backup on later checks, including a preference changed
    // in another tab, instead of pinning this visit to an in-memory choice.
    if (readStoredConsent() === null && readBackupConsent() === choice) visitChoice = null;
  } catch {
    // A failed overwrite must not leave an older acceptance available to revive
    // after the visitor has declined. Removal may still work when storage is full.
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* Storage is unavailable. */ }
  }
  window.dispatchEvent(new window.CustomEvent(COOKIE_CONSENT_EVENT, { detail: { status: choice } }));
}
