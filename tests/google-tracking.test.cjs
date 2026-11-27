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
    bootstrap: () => {
      const tag = load("lib/google-tag.ts");
      const script = dom.window.document.createElement("script");
      script.id = tag.GOOGLE_TAG_BOOTSTRAP_ID;
      script.textContent = tag.GOOGLE_TAG_BOOTSTRAP;
      dom.window.document.head.prepend(script);
      new Function("window", "document", tag.GOOGLE_TAG_BOOTSTRAP)(dom.window, dom.window.document);
      return script;
    },
    conversions: () => (dom.window.dataLayer || []).map(args => Array.from(args))
      .filter(args => args[0] === "event" && args[1] === "conversion"),
  };
}

const commands = window => (window.dataLayer || []).map(args => Array.from(args));
const denied = { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" };
const purchase = { id: "11111111-2222-4333-8444-555555555555", paymentStatus: "paid", testMode: false, amountPaise: 125050, currency: "INR" };

test("head bootstrap sets denied consent and clean URLs before the Google loader is inserted", t => {
  const { window, tracking, bootstrap } = trackingHarness(t);
  const head = window.document.head;
  const insertBefore = head.insertBefore.bind(head);
  let commandsAtLoad;
  head.insertBefore = (node, reference) => {
    if (node.id === tracking.GOOGLE_TAG_SCRIPT_ID) commandsAtLoad = commands(window);
    return insertBefore(node, reference);
  };
  const inline = bootstrap();
  assert.deepEqual(commandsAtLoad[0], ["consent", "default", denied]);
  assert.equal(commandsAtLoad[1][1].page_location, "https://www.beyondinvitation.co.in/contact");
  assert.equal(commandsAtLoad[1][1].page_referrer, "https://www.beyondinvitation.co.in/catalog");
  assert.equal(commandsAtLoad[1][1].ads_data_redaction, true);
  assert.equal(commandsAtLoad[1][1].url_passthrough, false);
  assert.equal(commandsAtLoad.some(args => args[0] === "config" || args[0] === "event"), false);
  assert.equal(inline.nextElementSibling.id, tracking.GOOGLE_TAG_SCRIPT_ID);
  assert.equal(inline.nextElementSibling.async, true);
});

test("hydration reuses the head bootstrap without resetting consent or duplicating initialization", t => {
  const { window, consent, tracking, bootstrap } = trackingHarness(t);
  bootstrap();
  consent.saveCookieConsent("accepted");
  tracking.syncGoogleTracking();
  tracking.syncGoogleTracking();
  const queue = commands(window);
  assert.equal(queue.filter(args => args[0] === "consent" && args[1] === "default").length, 1);
  assert.equal(queue.filter(args => args[0] === "js").length, 1);
  assert.equal(queue.filter(args => args[0] === "config" && args[1] === tracking.GOOGLE_ADS_ID).length, 1);
  assert.equal(queue.filter(args => args[0] === "event" && args[1] === "page_view").length, 1);
  assert.equal(window.document.querySelectorAll(`script#${tracking.GOOGLE_TAG_SCRIPT_ID}`).length, 1);
  assert.equal(queue.find(args => args[0] === "event" && args[1] === "page_view")[2].page_location,
    "https://www.beyondinvitation.co.in/contact?gclid=click-id");
});

test("a failed head loader is retried once without reinitializing Google", t => {
  const { window, tracking, bootstrap } = trackingHarness(t);
  bootstrap();
  const failed = window.document.getElementById(tracking.GOOGLE_TAG_SCRIPT_ID);
  failed.dispatchEvent(new window.Event("error"));
  assert.equal(window.document.getElementById(tracking.GOOGLE_TAG_SCRIPT_ID), null);
  tracking.syncGoogleTracking();
  tracking.syncGoogleTracking();
  assert.notEqual(window.document.getElementById(tracking.GOOGLE_TAG_SCRIPT_ID), failed);
  assert.equal(window.document.querySelectorAll(`script#${tracking.GOOGLE_TAG_SCRIPT_ID}`).length, 1);
  assert.equal(commands(window).filter(args => args[0] === "js").length, 1);
});

test("shared head bootstrap remains inactive on admin routes and initializes on storefront navigation", t => {
  const { window, tracking, bootstrap } = trackingHarness(t, "/admin/orders");
  bootstrap();
  assert.equal(window.gtag, undefined);
  assert.equal(window.document.getElementById(tracking.GOOGLE_TAG_SCRIPT_ID), null);
  assert.equal(tracking.syncGoogleTracking(), false);
  window.history.pushState({}, "", "/contact");
  assert.equal(tracking.syncGoogleTracking(), true);
  assert.ok(window.document.getElementById(tracking.GOOGLE_TAG_SCRIPT_ID));
});

test("confirmed leads can send cookieless signals before a choice and after Essential only", async t => {
  for (const choice of [null, "declined"]) await t.test(String(choice), child => {
    const { window, consent, tracking, conversions } = trackingHarness(child);
    if (choice) consent.saveCookieConsent(choice);
    assert.equal(tracking.syncGoogleTracking(), true);
    assert.equal(conversions().length, 0, "Loading the tag alone cannot count as a conversion");
    assert.equal(tracking.trackLeadConversion(), true);
    assert.equal(window.document.querySelectorAll("script").length, 1);
    assert.equal(conversions().length, 1);
    assert.equal(conversions()[0][2].page_location, "https://www.beyondinvitation.co.in/contact");
    const queue = commands(window);
    assert.deepEqual(queue[0], ["consent", "default", denied], "Deny before configuring any destination");
    assert.ok(queue.some(args => args[0] === "set" && args[1].ads_data_redaction === true && args[1].url_passthrough === false));
    assert.ok(queue.filter(args => args[0] === "consent").every(args => JSON.stringify(args[2]) === JSON.stringify(denied)));
    assert.equal(queue.some(args => args[0] === "config" && args[1] === tracking.GOOGLE_ANALYTICS_ID), false);
    assert.equal(queue.some(args => args[0] === "event" && args[1] === "page_view"), false);
    if (!choice) assert.equal(window.document.cookie, "", "No consent choice is fabricated");
  });
});

test("Analytics waits for acceptance, while Ads signals continue after revocation with denied storage", t => {
  const { window, consent, tracking, conversions } = trackingHarness(t);
  const views = () => commands(window).filter(args => args[0] === "event" && args[1] === "page_view");
  tracking.syncGoogleTracking();
  assert.equal(views().length, 0);
  consent.saveCookieConsent("accepted");
  tracking.syncGoogleTracking();
  tracking.syncGoogleTracking();
  assert.equal(views().length, 1);
  assert.equal(tracking.trackLeadConversion(), true);
  consent.saveCookieConsent("declined");
  window.history.pushState({}, "", "/contact?gclid=another-click#private");
  assert.equal(tracking.trackLeadConversion(), true);
  assert.equal(views().length, 1);
  assert.equal(conversions().length, 2);
  assert.equal(conversions()[1][2].page_location, "https://www.beyondinvitation.co.in/contact");
  const queue = commands(window);
  assert.deepEqual(queue.filter(args => args[0] === "consent").at(-1), ["consent", "update", denied]);
  assert.equal(queue.filter(args => args[0] === "config" && args[1] === tracking.GOOGLE_ADS_ID).length, 1);
  assert.equal(queue.filter(args => args[0] === "config" && args[1] === tracking.GOOGLE_ANALYTICS_ID).length, 1);
  assert.equal(window.document.querySelectorAll("script").length, 1);
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

test("cookieless purchases use the actual INR total and order ID without accessing measurement storage", t => {
  const { window, consent, tracking, conversions } = trackingHarness(t, "/checkout/success?gclid=click-id&order_id=private#receipt=secret");
  let storageAccesses = 0;
  Object.defineProperty(window, "sessionStorage", { configurable: true, get() { storageAccesses += 1; throw new Error("No measurement storage allowed"); } });
  assert.equal(tracking.trackPurchaseConversion(purchase), true);
  const { event_callback: callback, ...payload } = conversions()[0][2];
  assert.deepEqual(payload, {
    send_to: tracking.GOOGLE_ADS_PURCHASE_DESTINATION,
    value: 1250.5, currency: "INR", transaction_id: purchase.id,
    page_location: "https://www.beyondinvitation.co.in/checkout/success",
    page_referrer: "https://www.beyondinvitation.co.in/catalog",
  });
  callback();
  consent.saveCookieConsent("declined");
  callback();
  assert.equal(tracking.trackPurchaseConversion(purchase), false);
  assert.equal(storageAccesses, 0);
  consent.saveCookieConsent("accepted");
  assert.equal(tracking.trackPurchaseConversion(purchase), false, "Later acceptance cannot requeue an order already sent cookieless");
  assert.equal(conversions().length, 1);
});

test("purchase callbacks use the current consent and only store a processed conversion after acceptance", t => {
  const { window, consent, tracking, conversions } = trackingHarness(t, "/checkout/success");
  const key = `beyond-google-ads-purchase:${purchase.id}`;
  consent.saveCookieConsent("accepted");
  assert.equal(tracking.trackPurchaseConversion(purchase), true);
  assert.equal(window.sessionStorage.getItem(key), null, "Queueing alone cannot mark delivery");
  consent.saveCookieConsent("declined");
  conversions()[0][2].event_callback();
  assert.equal(window.sessionStorage.getItem(key), null, "Revocation before callback prevents storage");
  consent.saveCookieConsent("accepted");
  conversions()[0][2].event_callback();
  assert.equal(window.sessionStorage.getItem(key), tracking.GOOGLE_ADS_PURCHASE_DESTINATION);
});

test("cookieless mode still rejects unconfirmed, test, and invalid purchases", t => {
  const { tracking, conversions } = trackingHarness(t, "/checkout/success");
  for (const invalid of [
    { paymentStatus: "pending" }, { paymentStatus: "failed" }, { testMode: true },
    { testMode: undefined }, { id: "invalid" }, { amountPaise: 0 },
    { amountPaise: 1.5 }, { currency: "USD" },
  ]) assert.equal(tracking.trackPurchaseConversion({ ...purchase, ...invalid }), false);
  assert.equal(conversions().length, 0);
});
