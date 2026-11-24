const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { JSDOM, CookieJar } = require("jsdom");

const KEY = "beyond_invitation_cookie_consent";
const YEAR_SECONDS = 60 * 60 * 24 * 365;
const NOW = Date.now();
const filename = path.resolve(__dirname, "../lib/cookie-consent.ts");
const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Fresh modules/documents share only browser persistence explicitly supplied by
// each test. JSDOM does not load resources or make any network requests here.
function browser(t, {
  cookieJar = new CookieJar(), storage = new Map(), cookiesBlocked = false,
  storageBlocked = false, storageWriteFails = false, cookieText, now = NOW,
} = {}) {
  const dom = new JSDOM("<!doctype html>", { url: "https://www.example.test/wedding-cards", cookieJar });
  t.after(() => dom.window.close());
  const { window } = dom;
  const cookieWrites = [];
  const storageWrites = [];
  const events = [];
  const nativeCookie = Object.getOwnPropertyDescriptor(window.Document.prototype, "cookie");
  Object.defineProperty(window.document, "cookie", {
    configurable: true,
    get() {
      if (cookiesBlocked) return "";
      return cookieText === undefined ? nativeCookie.get.call(this) : cookieText;
    },
    set(value) {
      cookieWrites.push(value);
      if (!cookiesBlocked) nativeCookie.set.call(this, value);
    },
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      if (storageBlocked) throw new Error("Storage unavailable");
      return {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => {
          storageWrites.push([key, value]);
          if (storageWriteFails) throw new Error("Storage quota exceeded");
          storage.set(key, value);
        },
        removeItem: key => storage.delete(key),
      };
    },
  });
  window.addEventListener("cookie-consent-change", event => events.push(event.detail.status));
  let clock = now;
  class Clock extends Date { static now() { return clock; } }
  function load() {
    const module = { exports: {} };
    new Function("module", "exports", "window", "document", "Date", compiled)(
      module, module.exports, window, window.document, Clock,
    );
    return module.exports;
  }
  return { load, window, cookieJar, storage, cookieWrites, storageWrites, events, setNow(value) { clock = value; } };
}

test("explicit choices retain the one-year cookie and create an equally bounded backup", t => {
  for (const choice of ["accepted", "declined"]) {
    const b = browser(t);
    const consent = b.load();
    assert.equal(consent.getCookieConsent(), null);
    assert.equal(consent.hasMarketingConsent(), false);
    assert.deepEqual(b.cookieWrites, []);
    assert.deepEqual(b.storageWrites, []);
    consent.saveCookieConsent(choice);
    assert.equal(consent.getCookieConsent(), choice);
    assert.equal(consent.hasMarketingConsent(), choice === "accepted");
    assert.match(b.cookieWrites[0], new RegExp(`${KEY}=v2%3A${choice}`));
    assert.match(b.cookieWrites[0], new RegExp(`Max-Age=${YEAR_SECONDS}(?:;|$)`));
    assert.match(b.cookieWrites[0], /Path=\//);
    assert.match(b.cookieWrites[0], /SameSite=Lax/);
    assert.match(b.cookieWrites[0], /; Secure(?:;|$)/);
    assert.deepEqual(JSON.parse(b.storage.get(KEY)), {
      version: "v2", choice, expiresAt: NOW + YEAR_SECONDS * 1000,
    });
    assert.deepEqual(b.events, [choice]);
  }
});

test("accepted and declined choices survive a new document when cookies cannot be saved", t => {
  for (const choice of ["accepted", "declined"]) {
    const storage = new Map();
    const first = browser(t, { storage, cookiesBlocked: true });
    const consent = first.load();
    consent.saveCookieConsent(choice === "accepted" ? "declined" : "accepted");
    consent.saveCookieConsent(choice);
    assert.equal(first.load().getCookieConsent(), choice, "A fresh module must not depend on visit memory");
    const originalBackup = storage.get(KEY);
    const revisit = browser(t, { storage, cookiesBlocked: true, now: NOW + 86400000 });
    assert.equal(revisit.load().getCookieConsent(), choice);
    assert.equal(revisit.load().hasMarketingConsent(), choice === "accepted");
    assert.equal(storage.get(KEY), originalBackup, "A visit must not extend the saved expiry");
    assert.deepEqual(revisit.cookieWrites, []);
    assert.deepEqual(revisit.storageWrites, []);
  }
});

test("expired, malformed, and legacy backups never imply consent", t => {
  for (const value of [
    "{invalid", "null", "[]", "accepted",
    JSON.stringify({ version: "v1", choice: "accepted", expiresAt: NOW + 86400000 }),
    JSON.stringify({ version: "v2", choice: "unknown", expiresAt: NOW + 86400000 }),
    JSON.stringify({ version: "v2", choice: "accepted", expiresAt: String(NOW + 86400000) }),
    JSON.stringify({ version: "v2", choice: "accepted" }),
    JSON.stringify({ version: "v2", choice: "accepted", expiresAt: NOW }),
    JSON.stringify({ version: "v2", choice: "declined", expiresAt: NOW - 1 }),
  ]) {
    const b = browser(t, { cookiesBlocked: true, storage: new Map([[KEY, value]]) });
    const consent = b.load();
    assert.equal(consent.getCookieConsent(), null, value);
    assert.equal(consent.hasMarketingConsent(), false, value);
    assert.deepEqual(b.storageWrites, [], "Reading invalid data must not manufacture a new consent record");
  }
});

test("a cookie-blocked visit observes changed and expired durable preferences", t => {
  const b = browser(t, { cookiesBlocked: true });
  const consent = b.load();
  consent.saveCookieConsent("accepted");
  const expiresAt = JSON.parse(b.storage.get(KEY)).expiresAt;
  b.storage.set(KEY, JSON.stringify({ version: "v2", choice: "declined", expiresAt }));
  assert.equal(consent.getCookieConsent(), "declined", "A changed backup must not be shadowed by visit memory");
  assert.equal(consent.hasMarketingConsent(), false);
  b.setNow(expiresAt);
  assert.equal(consent.getCookieConsent(), null, "Visit memory must not extend a durable preference past expiry");
  assert.equal(b.storageWrites.length, 1, "Only the explicit choice writes a backup");
});

test("a valid cookie is authoritative over a conflicting backup", t => {
  for (const choice of ["declined", "accepted"]) {
    const backup = JSON.stringify({ version: "v2", choice: choice === "accepted" ? "declined" : "accepted", expiresAt: NOW + 86400000 });
    const b = browser(t, { storage: new Map([[KEY, backup]]) });
    b.window.document.cookie = `${KEY}=${encodeURIComponent(`v2:${choice}`)}; Path=/`;
    b.cookieWrites.length = 0;
    const consent = b.load();
    assert.equal(consent.getCookieConsent(), choice);
    assert.equal(consent.hasMarketingConsent(), choice === "accepted");
    assert.deepEqual(b.cookieWrites, []);
    assert.deepEqual(b.storageWrites, []);
  }
});

test("duplicate cookies ignore malformed and legacy values and prefer a current declined choice", t => {
  for (const [values, expected] of [
    [["%invalid", "v1:accepted", "v2:accepted"], "accepted"],
    [["v1:declined", "v2:accepted"], "accepted"],
    [["v2:accepted", "v2:declined"], "declined"],
    [["v2:declined", "v2:accepted"], "declined"],
    [["%invalid", "v1:accepted"], null],
  ]) {
    const cookieText = values.map(value => `${KEY}=${value}`).join("; ");
    const consent = browser(t, { cookieText }).load();
    assert.equal(consent.getCookieConsent(), expected);
    assert.equal(consent.hasMarketingConsent(), expected === "accepted");
  }
});

test("a current backup can recover a choice when cookies contain only unusable values", t => {
  const storage = new Map([[KEY, JSON.stringify({ version: "v2", choice: "declined", expiresAt: NOW + 86400000 })]]);
  const b = browser(t, { storage, cookieText: `${KEY}=v1:accepted; ${KEY}=%invalid` });
  assert.equal(b.load().getCookieConsent(), "declined");
  assert.equal(b.load().hasMarketingConsent(), false);
});

test("unavailable local storage does not prevent cookie persistence", t => {
  for (const choice of ["accepted", "declined"]) {
    const first = browser(t, { storageBlocked: true });
    assert.doesNotThrow(() => first.load().saveCookieConsent(choice));
    const revisit = browser(t, { cookieJar: first.cookieJar, storageBlocked: true });
    assert.equal(revisit.load().getCookieConsent(), choice);
    assert.equal(revisit.load().hasMarketingConsent(), choice === "accepted");
  }
});

test("a failed backup write removes stale acceptance after an explicit decline", t => {
  const storage = new Map([[KEY, JSON.stringify({ version: "v2", choice: "accepted", expiresAt: NOW + 86400000 })]]);
  const first = browser(t, { storage, storageWriteFails: true });
  const consent = first.load();
  assert.equal(consent.getCookieConsent(), "accepted");
  assert.doesNotThrow(() => consent.saveCookieConsent("declined"));
  assert.equal(consent.getCookieConsent(), "declined");
  assert.equal(storage.has(KEY), false, "A failed update must not leave an earlier acceptance as fallback");
  const revisit = browser(t, { storage, cookieJar: first.cookieJar, cookiesBlocked: true });
  assert.equal(revisit.load().getCookieConsent(), null);
  assert.equal(revisit.load().hasMarketingConsent(), false);
});

test("when both stores are unavailable the explicit choice still works for the current visit", t => {
  const b = browser(t, { cookiesBlocked: true, storageBlocked: true });
  const consent = b.load();
  for (const choice of ["accepted", "declined"]) {
    assert.doesNotThrow(() => consent.saveCookieConsent(choice));
    assert.equal(consent.getCookieConsent(), choice);
    assert.equal(consent.hasMarketingConsent(), choice === "accepted");
  }
  assert.deepEqual(b.events, ["accepted", "declined"]);
  assert.equal(b.load().getCookieConsent(), null, "No persistence must mean a fresh visit has no assumed choice");
});
