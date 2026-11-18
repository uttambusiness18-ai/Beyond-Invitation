const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { test } = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const orderId = "f87a3225-0000-4000-8000-000000000001";
const ownerId = "00000000-0000-4000-8000-000000000002";
const token = "A".repeat(43);
const hash = value => crypto.createHash("sha256").update(value).digest("hex");

function load(filename, dependencies) {
  const { outputText } = ts.transpileModule(readFileSync(path.join(root, filename), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, URL, Buffer,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename });
  return module.exports;
}

function harness() {
  const state = {
    user: { id: ownerId }, authError: null, dbError: null,
    row: {
      id: orderId, user_id: ownerId, created_at: "2026-11-18T10:00:00.000Z",
      paid_at: "2026-11-18T10:01:00.000Z", payment_status: "paid",
      razorpay_order_id: "order_offline", razorpay_payment_id: "pay_offline",
      amount_paise: 5020, currency: "INR", customer_name: "Sample Customer",
      customer_email: "sample@example.invalid", customer_phone: "9999999999",
      notes: "Gold ink, please", reseller_code: "PRIVATE_RESELLER", commission_paise: 100,
      items: [{ itemCode: "CARD001", name: "Floral card", printName: "Blush", price: 16.07, basePrice: 10, quantity: 3, weightGrams: 100 }],
      shipping_address: {
        addressLine1: "Example Street", addressLine2: "Second floor", city: "Kolkata",
        state: "West Bengal", pincode: "700040", country: "India", paymentMode: "live",
        paymentKeyId: "PRIVATE_GATEWAY_KEY", trackingTokenHash: hash("T".repeat(43)), receiptTokenHash: hash(token),
        fulfillment: { internalSecret: "PRIVATE_FULFILLMENT" },
        shippingQuote: { subtotalPaise: 4821, amountPaise: 199, totalPaise: 5020,
          courierName: "Example courier", deliveryPlaceId: "PRIVATE_LOCATION", courierId: 12 },
      },
    },
  };
  const calls = [];
  function client(kind) {
    return {
      auth: { async getUser() { calls.push(["auth"]); return { data: { user: state.user }, error: state.authError }; } },
      from(table) {
        assert.equal(table, "website_orders");
        calls.push(["read", kind]);
        const filters = [];
        const query = {
          select(columns) { calls.push(["select", columns]); return query; },
          eq(column, value) { filters.push([column, value]); return query; },
          async maybeSingle() {
            calls.push(["filters", kind, filters]);
            // Deliberately do not apply RLS: explicit ownership validation is required too.
            return { data: state.row, error: state.dbError };
          },
        };
        return query;
      },
    };
  }
  const tokens = load("lib/order-tracking-token.ts", { "server-only": {}, "node:crypto": crypto });
  const service = load("lib/payment-receipt.ts", {
    "server-only": {},
    "@/lib/supabase/auth-server": { getSupabaseAuthServerClient: async () => client("owner") },
    "@/lib/supabase/admin": { getSupabaseAdminClient: () => client("token") },
    "@/lib/order-tracking-token": tokens,
    "@/lib/product-name": load("lib/product-name.ts", {}),
  });
  return { service, state, calls };
}

test("private receipt returns the paid snapshot and excludes internal order metadata", async () => {
  const { service, state, calls } = harness();
  state.user = null;
  const result = await service.getPaymentReceipt(orderId, token);
  assert.equal(result.paymentStatus, "paid");
  assert.equal(result.paymentId, "pay_offline");
  assert.equal(result.gatewayOrderId, "order_offline");
  assert.equal(result.amountPaise, 5020);
  assert.equal(result.subtotalPaise, 4821);
  assert.equal(result.shippingPaise, 199);
  assert.equal(result.items[0].unitPricePaise, 1607);
  assert.equal(result.items[0].totalPaise, 4821);
  assert.equal(result.items[0].name, "Floral card (Blush)");
  assert.equal(result.address.addressLine2, "Second floor");
  assert.equal(result.shipping.service, "standard");
  assert.equal(result.shipping.courierName, "Example courier");
  assert.equal(result.testMode, false);
  assert.equal(result.notes, "Gold ink, please");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|trackingTokenHash|receiptTokenHash|basePrice|commission|weightGrams|courierId/);
  assert.equal(calls.filter(([name]) => name === "auth").length, 0);
});

test("signed-in receipts explicitly filter and verify current ownership on every read", async () => {
  const { service, state, calls } = harness();
  await service.getPaymentReceipt(orderId);
  await service.getPaymentReceipt(orderId);
  assert.equal(calls.filter(([name]) => name === "auth").length, 2);
  for (const [, kind, filters] of calls.filter(([name]) => name === "filters")) {
    assert.equal(kind, "owner");
    assert.deepEqual(filters, [["id", orderId], ["user_id", ownerId]]);
  }
  state.user.id = "different-owner";
  await assert.rejects(service.getPaymentReceipt(orderId), { code: "ORDER_NOT_FOUND", status: 404 });
  state.user = null;
  await assert.rejects(service.getPaymentReceipt(orderId), { code: "ORDER_NOT_FOUND", status: 404 });
});

test("guest wrong, missing, and rotated tokens cannot reveal an order", async () => {
  const { service, state } = harness();
  state.user = null;
  await assert.rejects(service.getPaymentReceipt(orderId), { code: "ORDER_NOT_FOUND" });
  await assert.rejects(service.getPaymentReceipt(orderId, "B".repeat(43)), { code: "ORDER_NOT_FOUND" });
  await service.getPaymentReceipt(orderId, token);
  state.row.shipping_address.receiptTokenHash = hash("C".repeat(43));
  await assert.rejects(service.getPaymentReceipt(orderId, token), { code: "ORDER_NOT_FOUND" });
  await service.getPaymentReceipt(orderId, "C".repeat(43));
});

test("tracking capabilities never grant customer receipt access, including legacy orders", async () => {
  const { service, state } = harness();
  state.user = null;
  await assert.rejects(service.getPaymentReceipt(orderId, "T".repeat(43)), { code: "ORDER_NOT_FOUND" });
  delete state.row.shipping_address.receiptTokenHash;
  await assert.rejects(service.getPaymentReceipt(orderId, "T".repeat(43)), { code: "ORDER_NOT_FOUND" });
  await assert.rejects(service.getPaymentReceipt(orderId, token), { code: "ORDER_NOT_FOUND" });
  state.user = { id: ownerId };
  assert.equal((await service.getPaymentReceipt(orderId)).id, orderId);
});

test("checkout stores independent hashed receipt and tracking capabilities", async () => {
  let saved;
  const query = {
    insert(value) { saved = value; return query; }, select() { return query; },
    async single() { return { data: { id: orderId }, error: null }; },
  };
  const tokens = load("lib/order-tracking-token.ts", { "server-only": {}, "node:crypto": crypto });
  const orders = load("lib/website-orders.ts", {
    "server-only": {},
    "@/lib/razorpay": { getRazorpayPaymentContext: () => ({ mode: "test", keyId: "rzp_test_fixture" }) },
    "@/lib/supabase/admin": { getSupabaseAdminClient: () => ({ from: () => query }) },
    "@/lib/order-tracking-token": tokens,
    "@/lib/shipping": { isValidDeliveryPlaceId: () => false },
  });
  const result = await orders.createWebsiteOrder({
    customer: { name: "Example", email: "example@example.invalid", phone: "9999999999", addressLine1: "Example Street",
      addressLine2: "", city: "Kolkata", state: "West Bengal", pincode: "700040", country: "India", notes: "" },
    cart: { lines: [{ itemCode: "CARD", name: "Card", price: 100, basePrice: 90, quantity: 1 }], amountPaise: 10000, currency: "INR", commission: 10 },
    userId: null,
  });
  assert.match(result.trackingToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(result.receiptToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(result.trackingToken, result.receiptToken);
  assert.equal(saved.shipping_address.trackingTokenHash, hash(result.trackingToken));
  assert.equal(saved.shipping_address.receiptTokenHash, hash(result.receiptToken));
  assert.equal(JSON.stringify(saved).includes(result.trackingToken), false);
  assert.equal(JSON.stringify(saved).includes(result.receiptToken), false);
});

test("receipt owner can open a stale private link, while malformed ids cause no reads", async () => {
  const { service, calls } = harness();
  assert.equal((await service.getPaymentReceipt(orderId, "B".repeat(43))).id, orderId);
  const before = calls.length;
  for (const id of [null, [], "not-an-order"]) {
    await assert.rejects(service.getPaymentReceipt(id, token), { code: "ORDER_NOT_FOUND" });
  }
  assert.equal(calls.length, before);
});

test("pending payment remains pending and later capture is reflected without cached data", async () => {
  const { service, state } = harness();
  state.row.payment_status = "pending";
  const pending = await service.getPaymentReceipt(orderId, token);
  assert.equal(pending.paymentStatus, "pending");
  assert.equal(pending.paymentId, null);
  assert.equal(pending.paidAt, null);
  state.row.payment_status = "paid";
  assert.equal((await service.getPaymentReceipt(orderId, token)).paymentId, "pay_offline");
});

test("legacy orders use original saved line prices with aggregate rounding and unknown shipping", async () => {
  const { service, state } = harness();
  delete state.row.shipping_address.shippingQuote;
  state.row.shipping_address.paymentMode = "test";
  state.row.items = [
    { itemCode: "A", name: "Card A", price: 0.335, quantity: 1 },
    { itemCode: "B", name: "Card B", price: 0.335, quantity: 1 },
  ];
  state.row.amount_paise = 67;
  const result = await service.getPaymentReceipt(orderId, token);
  assert.equal(result.subtotalPaise, 67);
  assert.equal(result.shippingPaise, null);
  assert.equal(result.shipping.courierName, null);
  assert.equal(result.testMode, true);
});

test("corrupt money and database errors fail without leaking internals", async () => {
  const { service, state } = harness();
  state.row.shipping_address.shippingQuote.amountPaise = 999;
  await assert.rejects(service.getPaymentReceipt(orderId, token), { code: "RECEIPT_UNAVAILABLE", status: 503 });
  state.dbError = { message: "PRIVATE_DB_ERROR" };
  await assert.rejects(service.getPaymentReceipt(orderId, token), error => {
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /PRIVATE_DB_ERROR/);
    return true;
  });
});

test("receipt route is private and rejects cross-origin or malformed requests before reading", async () => {
  const { service, state } = harness();
  state.user = null;
  class OrderTrackingError extends Error {
    constructor(code, message, status) { super(message); this.code = code; this.status = status; }
  }
  const next = { NextResponse: { json: (body, init) => Response.json(body, init) } };
  const tracking = load("lib/order-tracking-request.ts", {
    "server-only": {}, "next/server": next, "@/lib/order-tracking": { OrderTrackingError },
  });
  const calls = [];
  const route = load("app/api/orders/receipt/route.ts", {
    "next/server": next,
    "@/lib/payment-receipt": { ...service, getPaymentReceipt: async (...args) => { calls.push(args); return service.getPaymentReceipt(...args); } },
    "@/lib/order-tracking": { OrderTrackingError },
    "@/lib/order-tracking-request": tracking,
  });
  function request(body, headers = {}) {
    return new Request("https://example.invalid/api/orders/receipt", {
      method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
    });
  }
  const response = await route.POST(request({ orderId, receiptToken: token }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).receipt.id, orderId);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal((await route.POST(request({ orderId, token }))).status, 404);
  const before = calls.length;
  assert.equal((await route.POST(request({ orderId, receiptToken: token }, { origin: "https://hostile.invalid" }))).status, 403);
  assert.equal((await route.POST(request({ orderId, receiptToken: token }, { "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await route.POST(request({ orderId, receiptToken: token }, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await route.POST(request({ orderId, receiptToken: "A".repeat(3000) }))).status, 413);
  assert.equal((await route.POST(request([]))).status, 400);
  assert.equal(calls.length, before);
});
