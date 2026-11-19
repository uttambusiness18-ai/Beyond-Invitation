const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const paid = {
  id: "11111111-2222-4333-8444-555555555555",
  paymentStatus: "paid",
  testMode: false,
  amountPaise: 125099,
  currency: "INR",
};

function setup(
  url = "https://www.beyondinvitation.co.in/checkout/success?order_id=private&gclid=click123#receipt=secret",
) {
  // JSDOM does not load resources here; no Google requests or real conversions.
  const dom = new JSDOM(
    "<!doctype html><html><head></head><body></body></html>",
    {
      url,
      referrer:
        "https://www.beyondinvitation.co.in/checkout?email=private@example.test#token=secret",
    },
  );
  const modules = new Map();
  function load(name) {
    if (modules.has(name)) return modules.get(name);
    const file = path.join(root, `${name}.ts`);
    const loadedModule = { exports: {} };
    const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: file,
    });
    vm.runInNewContext(
      outputText,
      {
        module: loadedModule,
        exports: loadedModule.exports,
        window: dom.window,
        document: dom.window.document,
        URL,
        require(dependency) {
          return load(dependency.replace(/^@\//, ""));
        },
      },
      { filename: file },
    );
    modules.set(name, loadedModule.exports);
    return loadedModule.exports;
  }
  const consent = load("lib/cookie-consent");
  const tracking = load("lib/google-tracking");
  return {
    ...tracking,
    ...consent,
    window: dom.window,
    close: () => dom.window.close(),
    events: () =>
      (dom.window.dataLayer || []).filter(
        (entry) => entry[0] === "event" && entry[1] === "conversion",
      ),
  };
}

test("optional Google scripts wait for consent and initialize once, with denied user data", () => {
  const view = setup();
  try {
    assert.equal(view.syncGoogleTracking(), false);
    assert.equal(view.window.document.scripts.length, 0);
    assert.equal(view.trackPurchaseConversion(paid), false);
    view.saveCookieConsent("declined");
    assert.equal(view.syncGoogleTracking(), false);
    assert.equal(view.events().length, 0);
    view.saveCookieConsent("accepted");
    assert.equal(view.syncGoogleTracking(), true);
    assert.equal(view.syncGoogleTracking(), true);
    assert.equal(view.window.document.scripts.length, 1);
    assert.equal(
      view.window.document.scripts[0].src,
      "https://www.googletagmanager.com/gtm.js?id=GTM-PM7X2BZK",
    );
    const commands = view.window.dataLayer;
    assert.equal(commands.filter((entry) => entry[0] === "config").length, 1);
    assert.equal(commands[0][0], "consent");
    assert.equal(commands[0][1], "default");
    assert.equal(commands[0][2].ad_storage, "denied");
    const granted = commands.find(
      (entry) =>
        entry[0] === "consent" &&
        entry[1] === "update" &&
        entry[2].ad_storage === "granted",
    );
    assert.equal(granted[2].ad_user_data, "denied");
    assert.equal(granted[2].ad_personalization, "denied");
    view.saveCookieConsent("declined");
    assert.equal(view.syncGoogleTracking(), false);
    assert.equal(view.trackPurchaseConversion(paid), false);
    assert.equal(
      commands.filter((entry) => entry[0] === "consent").at(-1)[2].ad_storage,
      "denied",
    );
  } finally {
    view.close();
  }
});

test("only valid live paid INR orders queue with actual value and safe URLs", () => {
  const view = setup();
  try {
    view.saveCookieConsent("accepted");
    for (const override of [
      { paymentStatus: "pending" },
      { testMode: true },
      { testMode: undefined },
      { id: "" },
      { id: "customer@example.test" },
      { amountPaise: 0 },
      { amountPaise: -1 },
      { amountPaise: 1.5 },
      { amountPaise: NaN },
      { amountPaise: Infinity },
      { amountPaise: Number.MAX_SAFE_INTEGER + 1 },
      { currency: "USD" },
    ])
      assert.equal(
        view.trackPurchaseConversion({ ...paid, ...override }),
        false,
      );
    assert.equal(view.events().length, 0);
    assert.equal(view.trackPurchaseConversion(paid), true);
    assert.equal(view.trackPurchaseConversion(paid), false);
    const payload = view.events()[0][2];
    assert.equal(payload.send_to, "AW-18574685891/4scPCKSbrrsdEMPtjJlF");
    assert.equal(payload.value, 1250.99);
    assert.equal(payload.currency, "INR");
    assert.equal(payload.transaction_id, paid.id);
    assert.equal(
      payload.page_location,
      "https://www.beyondinvitation.co.in/checkout/success?gclid=click123",
    );
    assert.equal(
      payload.page_referrer,
      "https://www.beyondinvitation.co.in/checkout",
    );
    assert.doesNotMatch(
      JSON.stringify(view.window.dataLayer),
      /secret|private@example|order_id=|receipt=/,
    );
    assert.equal(
      view.window.sessionStorage.length,
      0,
      "Queueing must not imply delivery",
    );
    payload.event_callback();
    assert.equal(
      view.window.sessionStorage.getItem(
        `beyond-google-ads-purchase:${paid.id}`,
      ),
      payload.send_to,
    );
  } finally {
    view.close();
  }
});

test("storage and tag failures never affect checkout; distinct orders still track", () => {
  const view = setup();
  try {
    view.saveCookieConsent("accepted");
    Object.defineProperty(view.window, "sessionStorage", {
      get() {
        throw new Error("Blocked storage");
      },
    });
    assert.equal(view.trackPurchaseConversion(paid), true);
    assert.doesNotThrow(() => view.events()[0][2].event_callback());
    assert.equal(view.trackPurchaseConversion(paid), false);
    const next = { ...paid, id: "22222222-2222-4333-8444-555555555555" };
    const gtag = view.window.gtag;
    view.window.gtag = (...args) => {
      if (args[0] === "event") throw new Error("Tag blocked");
      gtag(...args);
    };
    assert.equal(view.trackPurchaseConversion(next), false);
    view.window.gtag = gtag;
    assert.equal(view.trackPurchaseConversion(next), true);
    assert.equal(view.events().length, 2);
  } finally {
    view.close();
  }
});

test("a transient script load failure can be retried without a second config", () => {
  const view = setup();
  try {
    view.saveCookieConsent("accepted");
    view.syncGoogleTracking();
    view.window.document.scripts[0].dispatchEvent(
      new view.window.Event("error"),
    );
    assert.equal(view.window.document.scripts.length, 0);
    view.syncGoogleTracking();
    assert.equal(view.window.document.scripts.length, 1);
    assert.equal(
      view.window.dataLayer.filter((entry) => entry[0] === "config").length,
      1,
    );
  } finally {
    view.close();
  }
});

test("admin entry does not load Google; URL sanitization rejects non-web URLs", () => {
  const view = setup("https://www.beyondinvitation.co.in/admin/orders");
  try {
    view.saveCookieConsent("accepted");
    assert.equal(view.syncGoogleTracking(), false);
    assert.equal(view.window.document.scripts.length, 0);
    assert.equal(view.googleTrackingUrl("javascript:alert(1)"), "");
    assert.equal(view.googleTrackingUrl("not a URL"), "");
    assert.equal(
      view.googleTrackingUrl(
        "https://example.test/path?token=private#gclid=private",
      ),
      "https://example.test/path",
    );
  } finally {
    view.close();
  }
});
