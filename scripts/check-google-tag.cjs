/*
 * Optional integration check: node scripts/check-google-tag.cjs
 * Downloads only the public Google tag scripts. Every measurement request made
 * by those scripts is intercepted in JSDOM; no real visits or conversions are sent.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { JSDOM, ResourceLoader, VirtualConsole } = require("jsdom");

const projectRoot = path.resolve(__dirname, "..");
const scriptUrl = "https://www.googletagmanager.com/gtm.js?id=GTM-PM7X2BZK";
const analyticsScriptUrl = "https://www.googletagmanager.com/gtag/js?id=G-X379LZMKP7";
const orderId = "11111111-2222-4333-8444-555555555555";
const secretMarkers = ["PRIVATE_TRACKING_CAPABILITY", "PRIVATE_RECEIPT_CAPABILITY", "PRIVATE_QUERY_VALUE", "fixture-buyer@example.test"];
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function checkCookieless(runtimes, runtimeKey, choice) {
  const requests = [];
  const cookieWrites = [];
  const existingIdentifiers = ["987654321098765", "EXISTING_AD_CLICK_ID", "URL_AD_CLICK_ID"];
  let tagLoads = 0;
  class OfflineResources extends ResourceLoader {
    fetch(url) {
      const key = runtimeKey(url);
      if (runtimes.has(key)) {
        if (key === runtimeKey(scriptUrl)) tagLoads += 1;
        return Promise.resolve(runtimes.get(key));
      }
      requests.push({ type: "resource", url });
      return Promise.resolve(Buffer.from(""));
    }
  }
  const dom = new JSDOM(`<!doctype html><title>Payment confirmed</title><p>${secretMarkers[3]}</p>`, {
    url: `https://www.beyondinvitation.co.in/checkout/success?order_id=${orderId}&gclid=${existingIdentifiers[2]}&private=${secretMarkers[2]}#receipt=${secretMarkers[1]}`,
    referrer: `https://www.beyondinvitation.co.in/checkout?gclid=${existingIdentifiers[2]}&private=${secretMarkers[2]}#token=${secretMarkers[0]}`,
    runScripts: "dangerously",
    resources: new OfflineResources(),
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  try {
    const window = dom.window;
    // Pre-existing identifiers must not be used after consent is denied. Use
    // plausible Google cookie formats so this is stronger than an empty jar.
    window.document.cookie = `_ga=GA1.1.${existingIdentifiers[0]}.1234567890; Path=/`;
    window.document.cookie = `_gcl_aw=GCL.1234567890.${existingIdentifiers[1]}; Path=/`;
    window.document.cookie = `_gcl_au=1.1.${existingIdentifiers[0]}.1234567890; Path=/`;
    const initialGoogleCookies = window.document.cookie;
    const cookieDescriptor = Object.getOwnPropertyDescriptor(window.Document.prototype, "cookie");
    Object.defineProperty(window.document, "cookie", {
      get() { return cookieDescriptor.get.call(this); },
      set(value) { cookieWrites.push(String(value)); cookieDescriptor.set.call(this, value); },
    });
    window.fetch = async (url, options = {}) => {
      requests.push({ type: "fetch", url: String(url), body: String(options.body || "") });
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
    };
    window.navigator.sendBeacon = (url, body) => {
      requests.push({ type: "beacon", url: String(url), body: String(body || "") });
      return true;
    };
    window.Image = function () {
      Object.defineProperty(this, "src", { set: (url) => {
        requests.push({ type: "image", url: String(url) });
        if (this.onload) this.onload();
      } });
    };
    window.XMLHttpRequest = class extends window.EventTarget {
      open(method, url) { this.url = String(url); }
      setRequestHeader() {}
      send(body) {
        requests.push({ type: "xhr", url: this.url, body: String(body || "") });
        this.readyState = 4;
        this.status = 200;
        this.responseText = "";
        this.dispatchEvent(new window.Event("readystatechange"));
        this.dispatchEvent(new window.Event("load"));
        if (this.onreadystatechange) this.onreadystatechange();
        if (this.onload) this.onload();
      }
      abort() {}
    };
    window.WebSocket = class { constructor() { throw new Error("WebSockets disabled in offline Google tag check"); } };
    window.HTMLFormElement.prototype.submit = function () {
      requests.push({ type: "form", url: this.action });
    };

    const modules = new Map();
    function load(relativePath) {
      if (modules.has(relativePath)) return modules.get(relativePath);
      const filename = path.resolve(projectRoot, relativePath);
      const loadedModule = { exports: {} };
      const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
        fileName: filename,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      });
      window.eval(`(function(require, module, exports) {\n${outputText}\n})`)((name) => {
        assert.ok(name.startsWith("@/lib/"), `Unexpected tracking dependency: ${name}`);
        return load(`${name.slice(2)}.ts`);
      }, loadedModule, loadedModule.exports);
      modules.set(relativePath, loadedModule.exports);
      return loadedModule.exports;
    }
    const consent = load("lib/cookie-consent.ts");
    const tracking = load("lib/google-tracking.ts");
    if (choice === "declined") consent.saveCookieConsent("declined");
    const purchase = { id: orderId, paymentStatus: "paid", testMode: false, amountPaise: 125000, currency: "INR" };
    assert.equal(tracking.syncGoogleTracking(), true, `${choice}: load the shared tag with denied storage`);
    assert.equal(tracking.trackPurchaseConversion({ ...purchase, paymentStatus: "pending" }), false);
    assert.equal(tracking.trackPurchaseConversion({ ...purchase, testMode: true }), false);
    assert.equal(tracking.trackPurchaseConversion(purchase), true);
    assert.equal(tracking.trackPurchaseConversion(purchase), false);
    window.history.pushState({}, "", `/contact?gclid=${existingIdentifiers[2]}&private=${secretMarkers[2]}#message=${secretMarkers[0]}`);
    tracking.syncGoogleTracking();
    assert.equal(tracking.trackLeadConversion(), true);
    const conversions = (label) => requests.filter(request => {
      const url = new URL(request.url);
      return url.pathname.includes("/conversion/18574685891/") && url.searchParams.get("label") === label;
    });
    const analyticsRequests = () => requests.filter(request => new URL(request.url).pathname.endsWith("/g/collect"));
    for (let attempt = 0; attempt < 100 &&
      (!conversions("4scPCKSbrrsdEMPtjJlF").length || !conversions("39GSCNLBy7wdEMPtjJlF").length); attempt += 1) await delay(100);
    // Allow queued GA hits or writes to surface before asserting their absence.
    await delay(5500);
    for (const [label, value, pathname] of [
      ["4scPCKSbrrsdEMPtjJlF", "1250", "/checkout/success"],
      ["39GSCNLBy7wdEMPtjJlF", "1", "/contact"],
    ]) {
      const hits = conversions(label);
      assert.equal(hits.length, 1, `${choice}: exactly one cookieless ${label} conversion`);
      const url = new URL(hits[0].url);
      assert.equal(url.hostname, "pagead2.googlesyndication.com", `${choice}: denied-storage conversions use the cookieless domain`);
      assert.equal(url.searchParams.get("gcs"), "G100", `${choice}: ad_storage and analytics_storage are denied`);
      assert.equal(url.searchParams.get("value"), value);
      assert.equal(url.searchParams.get("currency_code"), "INR");
      assert.equal(url.searchParams.get("url"), `https://www.beyondinvitation.co.in${pathname}`);
      assert.equal(url.searchParams.get("ref"), "https://www.beyondinvitation.co.in/checkout");
      if (label === "4scPCKSbrrsdEMPtjJlF") assert.equal(url.searchParams.get("oid"), orderId);
    }
    assert.equal(analyticsRequests().length, 0, `${choice}: no Analytics hits without acceptance`);
    assert.equal(tagLoads, 1, `${choice}: one shared Google tag loader`);
    assert.equal(cookieWrites.filter(cookie => /^_(?:ga|gcl)/.test(cookie)).length, 0, `${choice}: no Google measurement cookie writes`);
    assert.equal(window.document.cookie.split("; ").filter(cookie => /^_(?:ga|gcl)/.test(cookie)).join("; "), initialGoogleCookies);
    assert.equal(window.sessionStorage.getItem(`beyond-google-ads-purchase:${orderId}`), null, `${choice}: no purchase tracking storage`);
    const captured = decodeURIComponent(JSON.stringify(requests));
    for (const marker of [...secretMarkers, ...existingIdentifiers]) assert.ok(!captured.includes(marker), `${choice}: measurement leaked ${marker}`);
    const deniedRequests = requests.length;
    // Accepting later may let Google's runtime send a consent-update ping, but
    // the application must not submit the same purchase event a second time.
    consent.saveCookieConsent("accepted");
    tracking.syncGoogleTracking();
    assert.equal(tracking.trackPurchaseConversion(purchase), false, `${choice}: acceptance does not requeue the same purchase`);
    const purchaseEvents = window.dataLayer.filter(args => args[0] === "event" && args[1] === "conversion" && args[2]?.transaction_id === orderId);
    assert.equal(purchaseEvents.length, 1);
    for (let attempt = 0; attempt < 100 && !analyticsRequests().length; attempt += 1) await delay(100);
    assert.ok(analyticsRequests().length > 0, `${choice}: Analytics starts after acceptance`);
    return { consent: choice, interceptedPurchaseRequests: 1, interceptedLeadRequests: 1, deniedAnalyticsRequests: 0, deniedRequests, googleCookieWrites: 0, reusedStoredIdentifiers: false };
  } finally {
    dom.window.close();
  }
}

async function main() {
  const runtimeKey = (value) => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "www.googletagmanager.com" ||
        !["/gtm.js", "/gtag/js"].includes(url.pathname)) return null;
    return `${url.pathname}?id=${url.searchParams.get("id")}`;
  };
  const runtimes = new Map(await Promise.all([scriptUrl, analyticsScriptUrl].map(async (url) => {
    // Only these two known runtime endpoints may reach the network. Redirects
    // and every subsequent resource request remain blocked by this harness.
    assert.ok(runtimeKey(url));
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "error" });
    assert.ok(response.ok, `Google tag download failed: HTTP ${response.status}`);
    return [runtimeKey(url), Buffer.from(await response.text())];
  })));
  const cookieless = await Promise.all(["no-choice", "declined"].map(choice => checkCookieless(runtimes, runtimeKey, choice)));
  const requests = [];
  let tagLoads = 0;
  let analyticsLoads = 0;
  class OfflineResources extends ResourceLoader {
    fetch(url) {
      const key = runtimeKey(url);
      if (runtimes.has(key)) {
        if (key === runtimeKey(scriptUrl)) tagLoads += 1;
        if (key === runtimeKey(analyticsScriptUrl)) analyticsLoads += 1;
        return Promise.resolve(runtimes.get(key));
      }
      requests.push({ type: "resource", url });
      return Promise.resolve(Buffer.from(""));
    }
  }
  const dom = new JSDOM(`<!doctype html><html><head><title>Payment confirmed</title></head><body><p>${secretMarkers[3]}</p></body></html>`, {
    url: `https://www.beyondinvitation.co.in/checkout/success?order_id=${orderId}&private=${secretMarkers[2]}#token=${secretMarkers[0]}&receipt=${secretMarkers[1]}`,
    referrer: `https://www.beyondinvitation.co.in/checkout?private=${secretMarkers[2]}`,
    runScripts: "dangerously",
    resources: new OfflineResources(),
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  try {
    const window = dom.window;
    window.fetch = async (url, options = {}) => {
      requests.push({ type: "fetch", url: String(url), body: String(options.body || "") });
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
    };
    window.navigator.sendBeacon = (url, body) => {
      requests.push({ type: "beacon", url: String(url), body: String(body || "") });
      return true;
    };
    window.Image = function () {
      Object.defineProperty(this, "src", { set: (url) => {
        requests.push({ type: "image", url: String(url) });
        if (this.onload) this.onload();
      } });
    };
    window.XMLHttpRequest = class extends window.EventTarget {
      open(method, url) { this.method = method; this.url = String(url); }
      setRequestHeader() {}
      send(body) {
        requests.push({ type: "xhr", url: this.url, body: String(body || "") });
        this.readyState = 4;
        this.status = 200;
        this.responseText = "";
        this.dispatchEvent(new window.Event("readystatechange"));
        this.dispatchEvent(new window.Event("load"));
        if (this.onreadystatechange) this.onreadystatechange();
        if (this.onload) this.onload();
      }
      abort() {}
    };
    window.WebSocket = class { constructor() { throw new Error("WebSockets disabled in offline Google tag check"); } };
    window.HTMLFormElement.prototype.submit = function () {
      requests.push({ type: "form", url: this.action });
    };

    const modules = new Map();
    function load(relativePath) {
      const filename = path.resolve(projectRoot, relativePath);
      if (modules.has(filename)) return modules.get(filename);
      const loadedModule = { exports: {} };
      const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
        fileName: filename,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      });
      const run = window.eval(`(function(require, module, exports) {\n${outputText}\n})`);
      run((name) => {
        assert.ok(name.startsWith("@/lib/"), `Unexpected tracking dependency: ${name}`);
        return load(`${name.slice(2)}.ts`);
      }, loadedModule, loadedModule.exports);
      modules.set(filename, loadedModule.exports);
      return loadedModule.exports;
    }
    const consent = load("lib/cookie-consent.ts");
    const tracking = load("lib/google-tracking.ts");
    const purchase = { id: orderId, paymentStatus: "paid", testMode: false, amountPaise: 125000, currency: "INR" };
    consent.saveCookieConsent("accepted");
    assert.equal(tracking.syncGoogleTracking(), true);
    assert.equal(tracking.trackPurchaseConversion({ ...purchase, paymentStatus: "pending" }), false);
    assert.equal(tracking.trackPurchaseConversion({ ...purchase, testMode: true }), false);
    assert.equal(tracking.trackPurchaseConversion(purchase), true);
    assert.equal(tracking.trackPurchaseConversion(purchase), false);

    const conversions = () => requests.filter((request) => {
      const url = new URL(request.url);
      return url.pathname.includes("/conversion/18574685891/") && url.searchParams.get("label") === "4scPCKSbrrsdEMPtjJlF";
    });
    const leadConversions = () => requests.filter((request) => {
      const url = new URL(request.url);
      return url.pathname.includes("/conversion/18574685891/") && url.searchParams.get("label") === "39GSCNLBy7wdEMPtjJlF";
    });
    const analyticsPageViews = () => requests.flatMap((request) => {
      const url = new URL(request.url);
      if (!url.pathname.endsWith("/g/collect")) return [];
      // GA can send one hit in the URL or batch several newline-separated hits
      // in a POST body. Combine shared query parameters with each event body.
      return (request.body ? request.body.split("\n") : [""]).map((body) => {
        const parameters = new URLSearchParams(url.searchParams);
        for (const [name, value] of new URLSearchParams(body)) parameters.set(name, value);
        return parameters;
      }).filter((parameters) => parameters.get("tid") === tracking.GOOGLE_ANALYTICS_ID && parameters.get("en") === "page_view");
    });
    const waitUntil = async (condition) => {
      for (let attempt = 0; attempt < 100 && !condition(); attempt += 1) await delay(100);
    };
    await waitUntil(() => conversions().length > 0 && analyticsPageViews().length > 0);
    assert.equal(conversions().length, 1, "The loaded Google runtime must produce one purchase request");
    const conversion = new URL(conversions()[0].url);
    assert.equal(conversion.searchParams.get("value"), "1250");
    assert.equal(conversion.searchParams.get("currency_code"), "INR");
    assert.equal(conversion.searchParams.get("oid"), orderId);
    assert.equal(conversion.searchParams.get("url"), "https://www.beyondinvitation.co.in/checkout/success");
    assert.equal(conversion.searchParams.get("ref"), "https://www.beyondinvitation.co.in/checkout");
    assert.equal(analyticsPageViews().length, 1, "The loaded Google runtime must produce one initial GA4 page view");
    assert.equal(analyticsPageViews()[0].get("dl"), "https://www.beyondinvitation.co.in/checkout/success");
    assert.equal(analyticsPageViews()[0].get("dr"), "https://www.beyondinvitation.co.in/checkout");

    window.history.pushState({}, "", `/track-order?private=${secretMarkers[2]}#token=${secretMarkers[0]}`);
    tracking.syncGoogleTracking();
    tracking.syncGoogleTracking();
    assert.equal(tracking.trackPurchaseConversion(purchase), false);
    await waitUntil(() => analyticsPageViews().length >= 2);
    assert.equal(analyticsPageViews().length, 2, "Navigation must produce exactly one additional GA4 page view");
    assert.equal(analyticsPageViews()[1].get("dl"), "https://www.beyondinvitation.co.in/track-order");
    assert.equal(analyticsPageViews()[1].get("dr"), "https://www.beyondinvitation.co.in/checkout/success");

    window.history.pushState({}, "", `/contact?email=${secretMarkers[3]}&private=${secretMarkers[2]}#message=${secretMarkers[0]}`);
    window.document.title = "Contact us";
    tracking.syncGoogleTracking();
    tracking.syncGoogleTracking();
    await waitUntil(() => analyticsPageViews().length >= 3);
    assert.equal(analyticsPageViews().length, 3);
    assert.equal(leadConversions().length, 0, "Visiting the enquiry form must not count as a lead");
    assert.equal(tracking.trackLeadConversion(), true);
    await waitUntil(() => leadConversions().length > 0);
    assert.equal(leadConversions().length, 1, "A successful enquiry must produce one lead request");
    const leadConversion = new URL(leadConversions()[0].url);
    assert.equal(tracking.GOOGLE_ADS_LEAD_DESTINATION, "AW-18574685891/39GSCNLBy7wdEMPtjJlF");
    assert.equal(leadConversion.searchParams.get("value"), "1");
    assert.equal(leadConversion.searchParams.get("currency_code"), "INR");
    assert.equal(leadConversion.searchParams.get("url"), "https://www.beyondinvitation.co.in/contact");
    assert.equal(leadConversion.searchParams.get("ref"), "https://www.beyondinvitation.co.in/checkout");
    consent.saveCookieConsent("declined");
    assert.equal(tracking.syncGoogleTracking(), true);
    window.history.pushState({}, "", `/catalog?private=${secretMarkers[2]}#token=${secretMarkers[0]}`);
    assert.equal(tracking.syncGoogleTracking(), true);
    assert.equal(tracking.trackPurchaseConversion(purchase), false);
    // Give batched requests and the existing Ads history listener time to run.
    await delay(5500);
    assert.equal(analyticsPageViews().length, 3, "Declined consent and repeated sync calls must not add GA4 page views");
    assert.equal(conversions().length, 1, "Client navigation must not duplicate the purchase");
    assert.equal(leadConversions().length, 1, "Client navigation and declined consent must not add lead conversions");
    assert.equal(tagLoads, 1, "There must be one shared Google tag loader");
    assert.equal(analyticsLoads, 1, "The Google runtime must load its GA4 destination once");
    const captured = decodeURIComponent(JSON.stringify(requests));
    for (const marker of secretMarkers) assert.ok(!captured.includes(marker), `Tracking leaked test marker: ${marker}`);
    console.log(JSON.stringify({
      passed: true,
      cookieless,
      downloadedTag: tracking.GOOGLE_TAG_ID,
      analyticsDestination: tracking.GOOGLE_ANALYTICS_ID,
      interceptedPageViews: analyticsPageViews().length,
      destination: tracking.GOOGLE_ADS_PURCHASE_DESTINATION,
      value: 1250,
      currency: "INR",
      transactionId: orderId,
      interceptedPurchaseRequests: conversions().length,
      leadDestination: tracking.GOOGLE_ADS_LEAD_DESTINATION,
      leadValue: 1,
      interceptedLeadRequests: leadConversions().length,
      interceptedRequests: requests.length,
      privateDataLeaked: false,
      realConversionsSent: 0,
      realPageViewsSent: 0,
    }, null, 2));
  } finally {
    dom.window.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
