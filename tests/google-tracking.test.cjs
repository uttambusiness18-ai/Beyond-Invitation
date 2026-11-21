const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

// Execute the tracking and consent modules without loading any Google resources.
function trackingHarness(t, pathname = "/contact?email=private@example.test&gclid=click-id#private") {
  const dom = new JSDOM("<!doctype html><title>Contact</title>", {
    url: `https://www.beyondinvitation.co.in${pathname}`,
    referrer: "https://www.beyondinvitation.co.in/catalog?phone=9876543210#private",
  });
  t.after(() => dom.window.close());
  const modules = new Map();
  function load(relativePath) {
    if (modules.has(relativePath)) return modules.get(relativePath);
    const filename = path.resolve(__dirname, "..", relativePath);
    const module = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function("require", "module", "exports", "window", "document", compiled)(
      name => {
        assert.ok(name.startsWith("@/lib/"), `Unexpected dependency: ${name}`);
        return load(`${name.slice(2)}.ts`);
      }, module, module.exports, dom.window, dom.window.document,
    );
    modules.set(relativePath, module.exports);
    return module.exports;
  }
  return {
    window: dom.window,
    consent: load("lib/cookie-consent.ts"),
    tracking: load("lib/google-tracking.ts"),
    conversions: () => (dom.window.dataLayer || []).map(args => Array.from(args))
      .filter(args => args[0] === "event" && args[1] === "conversion"),
  };
}

test("lead measurement waits for optional-cookie acceptance and honours revocation", t => {
  const { window, consent, tracking, conversions } = trackingHarness(t);
  assert.equal(tracking.trackLeadConversion(), false);
  assert.equal(window.document.querySelectorAll("script").length, 0);
  consent.saveCookieConsent("declined");
  assert.equal(tracking.trackLeadConversion(), false);
  assert.equal(conversions().length, 0);
  consent.saveCookieConsent("accepted");
  assert.equal(tracking.trackLeadConversion(), true);
  consent.saveCookieConsent("declined");
  assert.equal(tracking.trackLeadConversion(), false);
  assert.equal(conversions().length, 1);
});

test("lead conversion uses the supplied destination and INR value without customer data", t => {
  const { window, consent, tracking, conversions } = trackingHarness(t);
  consent.saveCookieConsent("accepted");
  assert.equal(tracking.trackLeadConversion(), true);
  assert.equal(tracking.GOOGLE_ADS_LEAD_DESTINATION, "AW-18574685891/39GSCNLBy7wdEMPtjJlF");
  assert.deepEqual(conversions(), [["event", "conversion", {
    send_to: "AW-18574685891/39GSCNLBy7wdEMPtjJlF",
    value: 1,
    currency: "INR",
    page_location: "https://www.beyondinvitation.co.in/contact?gclid=click-id",
    page_referrer: "https://www.beyondinvitation.co.in/catalog",
  }]]);
  assert.equal(window.document.querySelectorAll("script").length, 1);
  assert.equal(tracking.trackLeadConversion(), true, "A separate accepted enquiry may also convert");
  assert.equal(conversions().length, 2);
  assert.equal(window.document.querySelectorAll("script").length, 1, "Reuse the existing Google loader");
});

test("admin pages never emit lead conversions", t => {
  const { window, consent, tracking, conversions } = trackingHarness(t, "/admin/leads");
  consent.saveCookieConsent("accepted");
  assert.equal(tracking.trackLeadConversion(), false);
  assert.equal(conversions().length, 0);
  assert.equal(window.document.querySelectorAll("script").length, 0);
});

test("a failing Google tag cannot throw into the enquiry submission", t => {
  const { window, consent, tracking } = trackingHarness(t);
  consent.saveCookieConsent("accepted");
  assert.equal(tracking.syncGoogleTracking(), true);
  const original = window.gtag;
  window.gtag = (...args) => {
    if (args[0] === "event" && args[1] === "conversion") throw new Error("Tag unavailable");
    return original(...args);
  };
  assert.equal(tracking.trackLeadConversion(), false);
});
