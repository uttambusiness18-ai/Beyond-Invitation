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
const websiteOrderId = "11111111-2222-4333-8444-555555555555";
const trackingToken = "a".repeat(43);
const receiptToken = "r".repeat(43);
const order = { keyId: "rzp_test_example", amount: 123000, currency: "INR", orderId: "order_example", websiteOrderId, trackingToken, receiptToken };
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const completed = { razorpay_order_id: order.orderId, razorpay_payment_id: "pay_example", razorpay_signature: "signature" };

function load(filename, context = {}) {
  const module = { exports: {} };
  const source = readFileSync(path.join(projectRoot, filename), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  });
  vm.runInNewContext(outputText, { module, exports: module.exports, URLSearchParams, ...context, require }, { filename });
  return module.exports;
}

async function mount(responses = [], options = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/checkout" });
  const previous = Object.fromEntries(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const calls = [], successes = [], failures = [], errors = [], dismissals = [];
  let gateway, hook;
  class Razorpay {
    constructor(config) { this.config = config; this.events = {}; this.closes = 0; gateway = this; }
    on(name, callback) { this.events[name] = callback; }
    open() {}
    close() { this.closes += 1; this.config.modal.ondismiss(); }
  }
  dom.window.Razorpay = Razorpay;
  const { useRazorpayCheckout } = load("components/useRazorpayCheckout.ts", {
    window: dom.window, document: dom.window.document, AbortController,
    async fetch(url, input) {
      calls.push({ url, input });
      const next = responses.shift();
      if (typeof next === "function") return next();
      if (next instanceof Error) throw next;
      assert.ok(next, `Unexpected request: ${url}`);
      return next;
    },
  });
  const root = createRoot(dom.window.document.getElementById("root"));
  function Harness() { hook = useRazorpayCheckout(); return null; }
  await act(async () => root.render(React.createElement(Harness)));
  return {
    calls, successes, failures, errors, dismissals,
    get gateway() { return gateway; },
    get loading() { return hook.loading; },
    async start() {
      await act(async () => hook.startCheckout({ items: [{ itemCode: "test", quantity: 10 }], expectedAmountPaise: order.amount,
        expectedShippingAmountPaise: 10000, onSuccess: value => successes.push(value),
        onFailure: options.legacy ? undefined : value => failures.push(value),
        onError: value => errors.push(value), onDismiss: () => dismissals.push(true) }));
    },
    async event(callback) { await act(async () => callback(gateway)); },
    async close() {
      await act(async () => root.unmount()); dom.window.close();
      for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
    },
  };
}

test("failed gateway payment closes its modal and reports one result despite late callbacks", async () => {
  const view = await mount([response(200, order)]);
  try {
    await view.start();
    const failed = { error: { description: "Bank declined this payment.", metadata: { payment_id: "pay_declined" } } };
    await view.event(gateway => gateway.events["payment.failed"](failed));
    await view.event(gateway => gateway.events["payment.failed"](failed));
    await view.event(gateway => gateway.config.handler(completed));
    assert.equal(view.gateway.closes, 1);
    assert.equal(view.dismissals.length, 0);
    assert.equal(view.failures.length, 1);
    assert.equal(view.failures[0].reason, "failed");
    assert.equal(view.failures[0].websiteOrderId, websiteOrderId);
    assert.equal(view.failures[0].paymentId, "pay_declined");
    assert.equal(view.failures[0].trackingToken, trackingToken);
    assert.equal(view.failures[0].receiptToken, receiptToken);
    assert.equal(view.successes.length, 0);
    assert.equal(view.calls.length, 1);
    assert.equal(view.loading, false);
  } finally { await view.close(); }
});

test("verification network failure preserves the payment reference and reports uncertainty", async () => {
  const view = await mount([response(200, order), new Error("Network unavailable")]);
  try {
    await view.start();
    await view.event(gateway => gateway.config.handler(completed));
    assert.equal(view.failures.length, 1);
    assert.equal(view.failures[0].reason, "verification");
    assert.equal(view.failures[0].paymentId, "pay_example");
    assert.equal(view.successes.length, 0);
    assert.equal(view.errors.length, 0);
    assert.equal(view.loading, false);
    const { paymentResultUrl } = load("lib/payment-attempt.ts");
    const href = paymentResultUrl({ ...view.failures[0], status: "pending" });
    const url = new URL(href, "https://example.com");
    assert.equal(url.pathname, "/checkout/success");
    assert.equal(url.searchParams.get("pending"), "1");
    assert.equal(url.searchParams.has("token"), false);
    assert.equal(url.searchParams.has("receipt"), false);
    assert.equal(url.hash, `#token=${trackingToken}&receipt=${receiptToken}`);
  } finally { await view.close(); }
});

test("late dismissal and failure cannot interrupt an in-flight successful verification", async () => {
  let resolveVerification;
  const deferred = new Promise(resolve => { resolveVerification = resolve; });
  const view = await mount([response(200, order), () => deferred]);
  try {
    await view.start();
    let handler;
    await view.event(gateway => {
      handler = gateway.config.handler(completed);
      gateway.config.modal.ondismiss();
      gateway.events["payment.failed"]({ error: { description: "Stale failure" } });
    });
    assert.equal(view.loading, true);
    await view.event(async () => {
      resolveVerification(response(200, { verified: true, websiteOrderId, paymentId: completed.razorpay_payment_id, paymentPending: false }));
      await handler;
    });
    assert.equal(view.successes.length, 1);
    assert.equal(view.successes[0].receiptToken, receiptToken);
    assert.equal(view.failures.length, 0);
    assert.equal(view.dismissals.length, 0);
    assert.equal(view.loading, false);
  } finally { await view.close(); }
});

test("customer cancellation stays on checkout and suppresses late payment callbacks", async () => {
  const view = await mount([response(200, order)]);
  try {
    await view.start();
    await view.event(gateway => gateway.config.modal.ondismiss());
    await view.event(gateway => gateway.config.handler(completed));
    assert.equal(view.dismissals.length, 1);
    assert.equal(view.failures.length, 0);
    assert.equal(view.calls.length, 1);
    assert.equal(view.loading, false);
  } finally { await view.close(); }
});

test("checkout initiation errors remain inline and legacy failure handlers still receive errors", async () => {
  const view = await mount([response(503, { error: "Shipping unavailable." })]);
  try {
    await view.start();
    assert.deepEqual(view.errors, ["Shipping unavailable."]);
    assert.equal(view.failures.length, 0);
  } finally { await view.close(); }
  const legacy = await mount([response(200, order)], { legacy: true });
  try {
    await legacy.start();
    await legacy.event(gateway => gateway.events["payment.failed"]({ error: { description: "Declined" } }));
    assert.deepEqual(legacy.errors, ["Declined"]);
  } finally { await legacy.close(); }
});

test("retry draft expires and optional storage cannot block result routing", () => {
  let now = 100;
  const values = new Map();
  const sessionStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const helpers = load("lib/payment-attempt.ts", { sessionStorage, Date: { now: () => now } });
  const form = Object.fromEntries(["name", "email", "contact", "addressLine1", "addressLine2", "city", "state", "pincode", "country", "notes"].map(field => [field, field]));
  helpers.saveCheckoutDraft(form);
  assert.equal(helpers.readCheckoutDraft().email, "email");
  now += 31 * 60 * 1000;
  assert.equal(helpers.readCheckoutDraft(), null);
  assert.equal(values.size, 0);
  helpers.savePaymentAttempt({ websiteOrderId, reason: "failed", paymentId: "pay_failed", message: "Declined", trackingToken });
  assert.deepEqual(Object.keys(JSON.parse(values.get(`beyond-payment-attempt:${websiteOrderId}`))).sort(), ["message", "paymentId", "reason"]);
  assert.equal(helpers.readPaymentAttempt(websiteOrderId).message, "Declined");
  const unavailable = load("lib/payment-attempt.ts", { sessionStorage: { setItem() { throw new Error(); }, getItem() { throw new Error(); }, removeItem() { throw new Error(); } } });
  assert.doesNotThrow(() => unavailable.saveCheckoutDraft(form));
  assert.equal(unavailable.readCheckoutDraft(), null);
  assert.equal(unavailable.readPaymentAttempt(websiteOrderId), null);
});
