const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");

const projectRoot = path.resolve(__dirname, "..");
const orderId = "11111111-2222-4333-8444-555555555555";
const token = "A".repeat(43);
const receiptToken = "B".repeat(43);
const fixture = (overrides = {}) => ({
  id: orderId, createdAt: "2026-11-18T08:00:00.000Z", paidAt: "2026-11-18T08:02:00.000Z",
  paymentStatus: "paid", paymentId: "pay_confirmed", gatewayOrderId: "order_gateway",
  currency: "INR", amountPaise: 125000, subtotalPaise: 120000, shippingPaise: 5000,
  items: [{ itemCode: "WED-123", name: "Ivory Wedding Invitation", quantity: 20, unitPricePaise: 6000, totalPaise: 120000 }],
  customer: { name: "Ananya Sen", email: "ananya@example.test", phone: "+919999999999" },
  address: { addressLine1: "24 Garden Road", addressLine2: "Apartment 5", city: "Kolkata", state: "West Bengal", pincode: "700040", country: "India" },
  notes: "Please confirm the names before printing.", shipping: { service: "standard", courierName: "Example Courier", estimatedDeliveryDays: 5 }, testMode: false,
  ...overrides,
});
const response = (receipt) => ({ status: 200, body: { receipt } });

async function mount(responses, props = {}, options = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: `https://example.test/checkout/success?order_id=${orderId}#token=${token}&receipt=${receiptToken}`, pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const calls = [], copied = [];
  let prints = 0;
  dom.window.print = () => { prints += 1; };
  const navigator = { clipboard: { async writeText(text) {
    if (options.clipboardUnavailable) throw new Error("Clipboard unavailable");
    copied.push(text);
  } } };
  for (const [key, value] of Object.entries(options.storage || {})) dom.window.sessionStorage.setItem(key, value);
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const module = { exports: {} };
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: filename,
    });
    vm.runInNewContext(outputText, {
      module, exports: module.exports, URL, URLSearchParams, AbortController, window: dom.window,
      document: dom.window.document, navigator, sessionStorage: dom.window.sessionStorage, setTimeout, clearTimeout,
      async fetch(url, requestOptions) {
        calls.push({ url, options: requestOptions });
        const next = responses.shift();
        assert.ok(next, "Unexpected receipt request");
        if (next instanceof Error) throw next;
        return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
      },
      require(name) {
        if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, key) => key === "__esModule" ? false : String(key) });
        if (name === "next/link") return { __esModule: true, default: ({ children, prefetch, ...attributes }) => React.createElement("a", attributes, children) };
        if (name.startsWith(".") || name.startsWith("@/")) {
          const target = name.startsWith("@/") ? path.join(projectRoot, name.slice(2)) : path.resolve(path.dirname(filename), name);
          for (const suffix of [".ts", ".tsx"]) {
            try { return load(target + suffix); } catch (error) { if (error.code !== "ENOENT") throw error; }
          }
          throw new Error(`Missing local module: ${name}`);
        }
        assert.ok(["react", "react/jsx-runtime", "lucide-react"].includes(name), `Unexpected dependency: ${name}`);
        return require(name);
      },
    }, { filename });
    modules.set(filename, module.exports);
    return module.exports;
  }
  const Component = load(path.join(projectRoot, "components/checkout/PaymentResult.tsx")).default;
  const root = createRoot(dom.window.document.getElementById("root"));
  await act(async () => root.render(React.createElement(Component, { outcome: "success", orderId, ...props })));
  const document = dom.window.document;
  return {
    document, calls, copied, storage: dom.window.sessionStorage,
    get state() { return document.querySelector("[data-payment-state]").dataset.paymentState; },
    get prints() { return prints; },
    async click(selector) {
      const element = document.querySelector(selector);
      assert.ok(element, `Missing element: ${selector}`);
      await act(async () => element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    },
    async clickButton(text) {
      const element = [...document.querySelectorAll("button")].find(button => button.textContent.includes(text));
      assert.ok(element, `Missing button: ${text}`);
      await act(async () => element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    },
    async close() {
      await act(async () => root.unmount()); dom.window.close();
      for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
    },
  };
}

test("paid result shows the stored items, totals, payment references, delivery and contact details", async () => {
  const view = await mount([response(fixture())], { paymentId: "pay_url_untrusted" });
  try {
    assert.equal(view.state, "success");
    assert.match(view.document.querySelector("h1").textContent, /Payment successful/);
    assert.deepEqual(JSON.parse(view.calls[0].options.body), { orderId, receiptToken });
    assert.equal(view.calls[0].url, "/api/orders/receipt");
    assert.equal(view.calls[0].options.method, "POST");
    assert.equal(view.calls[0].options.cache, "no-store");
    assert.match(view.document.querySelector('[aria-labelledby="order-summary-title"]').textContent, /20 items.*Ivory Wedding Invitation.*WED-123.*Qty 20.*60\.00.*1,200\.00/s);
    const delivery = view.document.querySelector('[aria-labelledby="delivery-details-title"]').textContent;
    assert.match(delivery, /Estimated delivery.*5 days after dispatch.*Preparation and personalisation time is additional/s);
    for (const value of ["Ananya Sen", "24 Garden Road", "Apartment 5", "Kolkata", "700040", "ananya@example.test", "+919999999999", "Standard delivery", "Please confirm the names before printing."]) assert.ok(delivery.includes(value), value);
    const payment = view.document.querySelector('[aria-labelledby="payment-details-title"]').textContent;
    assert.match(payment, /TOTAL PAID.*1,250\.00.*Subtotal.*1,200\.00.*Shipping.*50\.00/s);
    assert.match(payment, /Paid on.*18 Nov 2026.*IST.*Razorpay.*pay_confirmed.*order_gateway/s);
    assert.doesNotMatch(payment, /pay_url_untrusted/);
    assert.equal(view.document.querySelector('a[href="/checkout"]'), null);
    await view.clickButton("Print order summary");
    assert.equal(view.prints, 1);
  } finally { await view.close(); }
});

test("failed result keeps the retry link, failure reason, stored order and checkout draft", async () => {
  const draft = JSON.stringify({ expiresAt: Date.now() + 30000, form: { name: "Ananya Sen" } });
  const attempt = JSON.stringify({ reason: "failed", message: "Your bank declined this payment.", paymentId: "pay_declined" });
  const view = await mount([response(fixture({ paymentStatus: "pending", paidAt: null, paymentId: null }))], { outcome: "failed", paymentId: "pay_declined" }, {
    storage: { "beyond-checkout-draft": draft, [`beyond-payment-attempt:${orderId}`]: attempt },
  });
  try {
    assert.equal(view.state, "failed");
    assert.match(view.document.querySelector('a[href="/checkout"]').textContent, /Return to checkout/);
    assert.match(view.document.querySelector('[role="note"]').textContent, /Your bank declined this payment/);
    assert.match(view.document.body.textContent, /If money was debited/);
    assert.match(view.document.body.textContent, /Ivory Wedding Invitation/);
    assert.match(view.document.body.textContent, /ananya@example\.test/);
    assert.match(view.document.body.textContent, /pay_declined/);
    assert.doesNotMatch(view.document.body.textContent, /TOTAL PAID|Payment successful|Estimated delivery|days after dispatch/);
    assert.equal(view.storage.getItem("beyond-checkout-draft"), draft);
    assert.equal(view.storage.getItem(`beyond-payment-attempt:${orderId}`), attempt);
  } finally { await view.close(); }
});

test("pending confirmation never offers another payment and refreshes to authoritative paid state", async () => {
  const view = await mount([response(fixture({ paymentStatus: "pending", paidAt: null, paymentId: null })), response(fixture())], { paymentId: "pay_confirmed" });
  try {
    assert.equal(view.state, "pending");
    assert.doesNotMatch(view.document.body.textContent, /Estimated delivery|days after dispatch/);
    assert.match(view.document.body.textContent, /No need to make another payment/);
    assert.equal(view.document.querySelector('a[href="/checkout"]'), null);
    assert.equal(view.document.querySelector('a[href^="/track-order"]'), null);
    assert.doesNotMatch(view.document.body.textContent, /TOTAL PAID|Payment successful/);
    await view.clickButton("Check payment status");
    assert.equal(view.calls.length, 2);
    assert.equal(view.state, "success");
    assert.match(view.document.querySelector('a[href^="/track-order"]').getAttribute("href"), /#token=/);
    assert.equal(view.document.querySelector('a[href="/checkout"]'), null);
  } finally { await view.close(); }
});

test("paid result handles legacy estimates and same-day delivery without inventing arrival dates", async () => {
  for (const [days, expected] of [[undefined, "Delivery estimate unavailable."], [null, "Delivery estimate unavailable."], [0, "Same day as dispatch"], [1, "1 day after dispatch"]]) {
    const view = await mount([response(fixture({ shipping: { service: "standard", courierName: "Example Courier", ...(days !== undefined ? { estimatedDeliveryDays: days } : {}) } }))]);
    try {
      assert.equal(view.state, "success");
      assert.equal(view.document.querySelector(".estimateValue").textContent, expected);
      assert.match(view.document.querySelector(".deliveryEstimate").textContent, /Preparation and personalisation time is additional/);
    } finally { await view.close(); }
  }
});

test("opening a success URL without a valid order cannot claim successful payment", async () => {
  for (const id of [undefined, "invalid-order"]) {
    const view = await mount([], { orderId: id, paymentId: "pay_reference_only" });
    try {
      assert.equal(view.state, "unavailable");
      assert.equal(view.calls.length, 0);
      assert.doesNotMatch(view.document.body.textContent, /Payment successful|TOTAL PAID/);
      assert.match(view.document.body.textContent, /pay_reference_only/);
      assert.ok(view.document.querySelector('a[href="/account#orders"]'));
      assert.equal(view.document.querySelector('a[href="/checkout"]'), null);
    } finally { await view.close(); }
  }
});

test("receipt load errors show recoverable status and references without inventing payment success", async () => {
  const view = await mount([{ status: 503, body: { error: "Unavailable" } }, response(fixture())], { paymentId: "pay_confirmed" });
  try {
    assert.equal(view.state, "unavailable");
    assert.match(view.document.querySelector('[role="alert"]').textContent, /loaded.*check again/i);
    assert.match(view.document.querySelector(".fallbackReferences").textContent, /11111111-2222-4333-8444-555555555555.*pay_confirmed/);
    assert.equal(view.document.querySelector('a[href="/checkout"]'), null);
    await view.clickButton("Try again");
    assert.equal(view.state, "success");
    assert.equal(view.document.querySelector('[role="alert"]'), null);
  } finally { await view.close(); }
});

test("copy actions use full stored references and the private tracking fragment", async () => {
  const view = await mount([response(fixture())]);
  try {
    await view.click('[aria-label="Copy order reference"]');
    assert.equal(view.copied[0], orderId);
    assert.match(view.document.querySelector('.announcement[aria-live="polite"]').textContent, /Order reference copied/);
    await view.click('[aria-label="Copy payment reference"]');
    assert.equal(view.copied[1], "pay_confirmed");
    await view.clickButton("Copy private tracking link");
    assert.equal(view.copied[2], `https://example.test/track-order?order=${orderId}#token=${token}`);
    assert.match(view.document.querySelector('.announcement[aria-live="polite"]').textContent, /Private tracking link copied/);
  } finally { await view.close(); }
  const unavailable = await mount([response(fixture())], {}, { clipboardUnavailable: true });
  try {
    await unavailable.click('[aria-label="Copy order reference"]');
    assert.match(unavailable.document.querySelector('.announcement[aria-live="polite"]').textContent, /select and copy the reference/);
    assert.equal(unavailable.state, "success");
  } finally { await unavailable.close(); }
});

test("a captured payment overrides a failed URL and removes the retry action", async () => {
  const view = await mount([response(fixture())], { outcome: "failed" });
  try {
    assert.equal(view.state, "success");
    assert.equal(view.document.querySelector('a[href="/checkout"]'), null);
    assert.equal(view.document.querySelector('[role="note"]'), null);
  } finally { await view.close(); }
});

test("a failed URL alone cannot turn an unconfirmed payment into a failed payment or offer retry", async () => {
  const view = await mount([response(fixture({ paymentStatus: "pending", paidAt: null, paymentId: null }))], { outcome: "failed" });
  try {
    assert.equal(view.state, "pending");
    assert.equal(view.document.querySelector('a[href="/checkout"]'), null);
    assert.equal(view.document.querySelector('[role="note"]'), null);
    assert.match(view.document.body.textContent, /No need to make another payment/);
  } finally { await view.close(); }
});

test("a failed pending refresh keeps the prior receipt and labels it as the last successful check", async () => {
  const view = await mount([response(fixture({ paymentStatus: "pending", paidAt: null })), { status: 503, body: {} }]);
  try {
    await view.clickButton("Check payment status");
    assert.equal(view.state, "pending");
    assert.match(view.document.querySelector('[role="alert"]').textContent, /last successful check/);
    assert.match(view.document.body.textContent, /Ivory Wedding Invitation/);
    assert.equal(view.document.querySelector('a[href="/checkout"]'), null);
    assert.equal(view.calls.length, 2);
  } finally { await view.close(); }
});
