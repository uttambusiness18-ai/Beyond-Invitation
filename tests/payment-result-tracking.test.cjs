const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://example.test/checkout/success",
});
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const h = React.createElement;
test.after(() => dom.window.close());

const ORDER_ID = "11111111-2222-4333-8444-555555555555";
const CONSENT_EVENT = "cookie-consent-change";
const receipt = {
  id: ORDER_ID,
  createdAt: "2026-11-24T08:00:00Z",
  paidAt: "2026-11-24T08:01:00Z",
  paymentStatus: "paid",
  paymentId: "pay_verified",
  gatewayOrderId: "order_verified",
  currency: "INR",
  amountPaise: 125050,
  subtotalPaise: 120050,
  shippingPaise: 5000,
  items: [{ itemCode: "CARD1", name: "Invitation", quantity: 1, unitPricePaise: 120050, totalPaise: 120050 }],
  customer: { name: "Private Customer", email: "private@example.test", phone: "9876543210" },
  address: { addressLine1: "Private address", addressLine2: "", city: "Kolkata", state: "West Bengal", pincode: "700001", country: "India" },
  notes: "Private order notes",
  shipping: { service: "standard", courierName: "Courier", estimatedDeliveryDays: 3 },
  testMode: false,
};
const successfulResponse = value => ({ ok: true, json: async () => ({ receipt: value }) });

async function resultHarness(t, {
  props = { outcome: "success", orderId: ORDER_ID },
  respond = async () => successfulResponse(receipt),
} = {}) {
  const requests = [];
  const conversions = [];
  const mocks = {
    "lucide-react": new Proxy({}, { get: () => () => null }),
    "next/link": { default: ({ children, prefetch, ...attributes }) => h("a", attributes, children) },
    "./PaymentResult.module.css": { default: {} },
    "@/components/usePrivateTrackingToken": { usePrivateTrackingToken: () => ({ ready: true, token: null }) },
    "@/components/OrderPrintingMatter": { default: () => null },
    "@/lib/order-tracking-link": { privateTrackingLink: () => null },
    "@/lib/payment-attempt": { readPaymentAttempt: () => null },
    "@/lib/google-tracking": { trackPurchaseConversion: value => { conversions.push(value); return false; } },
    "@/lib/cookie-consent": { COOKIE_CONSENT_EVENT: CONSENT_EVENT },
    "@/lib/site-config": { CONTACT: { email: "support@example.test" } },
    "@/lib/product-name": { formatProductName: name => name },
    "@/lib/shipping": { formatDeliveryEstimate: () => "3 days" },
  };
  const filename = path.resolve(__dirname, "../components/checkout/PaymentResult.tsx");
  const module = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("require", "module", "exports", "fetch", compiled)(
    name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      assert.ok(!name.startsWith("@/"), `Unexpected dependency: ${name}`);
      return require(name);
    }, module, module.exports,
    async (...args) => { requests.push(args); return respond(...args); },
  );
  const PaymentResult = module.exports.default;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = nextProps => act(() => root.render(h(React.StrictMode, null, h(PaymentResult, nextProps))));
  await render(props);
  t.after(async () => { await act(() => root.unmount()); container.remove(); });
  return {
    requests,
    conversions,
    render,
    state: () => container.querySelector("[data-payment-state]")?.dataset.paymentState,
    consentChanged: () => act(() => window.dispatchEvent(new window.CustomEvent(CONSENT_EVENT))),
  };
}

test("confirmed paid receipt on the success page sends only the stored order measurement fields", async t => {
  const page = await resultHarness(t);
  assert.equal(page.state(), "success");
  assert.deepEqual(page.conversions, [{
    id: ORDER_ID,
    paymentStatus: "paid",
    testMode: false,
    amountPaise: 125050,
    currency: "INR",
  }]);
  for (const [url, request] of page.requests) {
    assert.equal(url, "/api/orders/receipt");
    assert.equal(request.method, "POST");
    assert.equal(request.cache, "no-store");
    assert.deepEqual(JSON.parse(request.body), { orderId: ORDER_ID });
  }
  await page.consentChanged();
  assert.equal(page.conversions.length, 2, "A later consent decision can retry the verified purchase through the deduplicating tracker");
});

test("a paid receipt on the failed page never emits a purchase, including after consent changes", async t => {
  const page = await resultHarness(t, { props: { outcome: "failed", orderId: ORDER_ID } });
  assert.equal(page.state(), "success", "The receipt can truthfully show that the payment eventually completed");
  assert.deepEqual(page.conversions, []);
  await page.consentChanged();
  assert.deepEqual(page.conversions, []);
});

test("leaving the success outcome removes its consent conversion listener", async t => {
  const page = await resultHarness(t);
  assert.equal(page.conversions.length, 1);
  await page.render({ outcome: "failed", orderId: ORDER_ID });
  await page.consentChanged();
  assert.equal(page.conversions.length, 1);
});

test("pending, test, unavailable, and mismatched receipts never reach purchase tracking", async t => {
  const cases = [
    { name: "pending", response: successfulResponse({ ...receipt, paymentStatus: "pending", paidAt: null }), state: "pending" },
    { name: "test mode", response: successfulResponse({ ...receipt, testMode: true }), state: "success" },
    { name: "unavailable", response: { ok: false, status: 404, json: async () => ({ error: "Unavailable" }) }, state: "unavailable" },
    { name: "different order", response: successfulResponse({ ...receipt, id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }), state: "unavailable" },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async child => {
      const page = await resultHarness(child, { respond: async () => scenario.response });
      assert.equal(page.state(), scenario.state);
      assert.deepEqual(page.conversions, []);
      await page.consentChanged();
      assert.deepEqual(page.conversions, []);
    });
  }
});

test("a success URL without an order or before the server confirms payment does not convert", async t => {
  await t.test("no order reference", async child => {
    const page = await resultHarness(child, { props: { outcome: "success" } });
    assert.equal(page.state(), "unavailable");
    assert.deepEqual(page.requests, []);
    assert.deepEqual(page.conversions, []);
    await page.consentChanged();
    assert.deepEqual(page.conversions, []);
  });
  await t.test("receipt response pending", async child => {
    const responses = [];
    const page = await resultHarness(child, {
      respond: () => new Promise(resolve => responses.push(resolve)),
    });
    assert.equal(page.state(), "loading");
    assert.deepEqual(page.conversions, []);
    await page.consentChanged();
    assert.deepEqual(page.conversions, []);
    await act(() => { for (const resolve of responses) resolve(successfulResponse(receipt)); });
    assert.equal(page.state(), "success");
    assert.equal(page.conversions.length, 1);
  });
});
