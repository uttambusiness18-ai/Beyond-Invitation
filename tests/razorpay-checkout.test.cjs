const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { test } = require("node:test");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");

function loadTs(filename, dependencies, { env = {}, logs = [] } = {}) {
  const source = readFileSync(path.join(projectRoot, filename), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    process: { env },
    Buffer,
    console: { error: (...args) => logs.push(args) },
  }, { filename });
  return module.exports;
}

function paymentModule(env, orders = {}) {
  const configurations = [];
  class FakeRazorpay {
    constructor(config) {
      configurations.push({ ...config });
      this.orders = orders;
    }
  }
  const payment = loadTs("lib/razorpay.ts", {
    razorpay: FakeRazorpay,
    crypto,
  }, { env });
  return { payment, configurations };
}

test("server-only Razorpay key configures the SDK and payment context", () => {
  const { payment, configurations } = paymentModule({
    RAZORPAY_KEY_ID: "rzp_test_serverKey",
    RAZORPAY_KEY_SECRET: "exampleSecret",
  });
  payment.getRazorpay();
  assert.equal(payment.getRazorpayPaymentContext().keyId, "rzp_test_serverKey");
  assert.equal(payment.getRazorpayPaymentContext().mode, "test");
  assert.deepEqual(configurations, [{ key_id: "rzp_test_serverKey", key_secret: "exampleSecret" }]);
});

test("legacy public key remains supported when the server key is blank", () => {
  const { payment, configurations } = paymentModule({
    RAZORPAY_KEY_ID: " \n ",
    NEXT_PUBLIC_RAZORPAY_KEY_ID: "rzp_live_legacyKey",
    RAZORPAY_KEY_SECRET: "exampleSecret",
  });
  payment.getRazorpay();
  assert.equal(payment.getRazorpayPaymentContext().mode, "live");
  assert.equal(configurations[0].key_id, "rzp_live_legacyKey");
});

test("server key takes precedence over a stale public key", () => {
  const { payment, configurations } = paymentModule({
    RAZORPAY_KEY_ID: "rzp_live_currentKey",
    NEXT_PUBLIC_RAZORPAY_KEY_ID: "rzp_test_oldKey",
    RAZORPAY_KEY_SECRET: "exampleSecret",
  });
  payment.getRazorpay();
  assert.equal(configurations[0].key_id, "rzp_live_currentKey");
  assert.equal(payment.getRazorpayPaymentContext().keyId, configurations[0].key_id);
});

test("SDK and signature verification use the same trimmed credentials", () => {
  const { payment, configurations } = paymentModule({
    RAZORPAY_KEY_ID: " rzp_test_key \n",
    RAZORPAY_KEY_SECRET: " \n exampleSecret \t",
  });
  payment.getRazorpay();
  assert.deepEqual(configurations[0], { key_id: "rzp_test_key", key_secret: "exampleSecret" });
  const signature = crypto.createHmac("sha256", "exampleSecret")
    .update("order_test|pay_test").digest("hex");
  assert.equal(payment.verifyPaymentSignature({ orderId: "order_test", paymentId: "pay_test", signature }), true);
  assert.equal(payment.verifyPaymentSignature({ orderId: "order_other", paymentId: "pay_test", signature }), false);
});

test("missing or malformed credentials fail before SDK initialization", () => {
  for (const env of [
    {},
    { RAZORPAY_KEY_ID: "rzp_test_key", RAZORPAY_KEY_SECRET: "  " },
    { RAZORPAY_KEY_ID: "rzp_test_", RAZORPAY_KEY_SECRET: "exampleSecret" },
    { RAZORPAY_KEY_ID: "invalid", NEXT_PUBLIC_RAZORPAY_KEY_ID: "rzp_test_old", RAZORPAY_KEY_SECRET: "exampleSecret" },
  ]) {
    const { payment, configurations } = paymentModule(env);
    assert.throws(() => payment.getRazorpay(), { code: "RAZORPAY_CONFIGURATION_ERROR" });
    assert.equal(configurations.length, 0);
  }
});

const requestBody = {
  customer: {
    name: "Offline Test",
    email: "offline@example.invalid",
    phone: "9999999999",
    addressLine1: "Offline fixture",
    city: "Kolkata",
    state: "West Bengal",
    pincode: "700040",
    country: "India",
  },
  items: [{ itemCode: "offline-item", quantity: 1 }],
  expectedAmountPaise: 119500,
  expectedShippingAmountPaise: 19500,
  service: "standard",
};

function routeHarness(options = {}) {
  const events = [];
  const lookups = [];
  const logs = [];
  const env = options.env || {
    RAZORPAY_KEY_ID: "rzp_test_serverKey",
    NEXT_PUBLIC_RAZORPAY_KEY_ID: "rzp_test_staleKey",
    RAZORPAY_KEY_SECRET: "exampleSecret",
  };
  const { payment, configurations } = paymentModule(env, {
    async create(input) {
      events.push(["gateway", input]);
      if (options.gatewayError) throw options.gatewayError;
      return { id: "order_offline", amount: input.amount, currency: input.currency };
    },
  });
  const route = loadTs("app/api/razorpay/order/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/razorpay": payment,
    "@/lib/checkout": {
      CheckoutValidationError: class extends Error {},
      resolveCartProducts: async () => {
        lookups.push("products");
        return { lines: [{ itemCode: "offline-item", price: 1000, quantity: 1 }], amountPaise: 100000, currency: "INR", commission: 0 };
      },
    },
    "@/lib/cart-shipping": {
      ShippingQuoteError: class extends Error {},
      quoteCartShipping: async () => {
        lookups.push("shipping");
        return { totalPaise: 119500, amountPaise: 19500 };
      },
    },
    "@/lib/shipping": {
      isValidIndianPincode: value => /^[1-9]\d{5}$/.test(value),
      isValidDeliveryPlaceId: () => false,
    },
    "@/lib/address-geocoding": {
      AddressGeocodingError: class extends Error {},
      lookupDeliveryPlace: async () => { lookups.push("geocoding"); },
    },
    "@/lib/address-geocoding-budget": {
      AddressGeocodingBudgetError: class extends Error {},
      claimAddressGeocodingBudget: () => { lookups.push("geocoding-budget"); },
    },
    "@/lib/website-orders": {
      createWebsiteOrder: async input => {
        events.push(["save", input]);
        if (options.storageError) throw options.storageError;
        return { id: "website-offline", trackingToken: "offline-token", receiptToken: "offline-receipt-token" };
      },
      attachRazorpayOrder: async (...args) => {
        events.push(["link", args]);
        if (options.linkError) throw options.linkError;
      },
    },
    "@/lib/supabase/auth-server": { getSupabaseAuthServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) },
    "@/lib/reseller": { getActiveResellerFromCookies: async () => null },
  }, { logs });
  return { events, lookups, logs, configurations, run: (body = requestBody) => route.POST({ json: async () => structuredClone(body) }) };
}

test("retired Quick checkout cannot resolve an address, create an order or start payment", async () => {
  const harness = routeHarness();
  const response = await harness.run({
    ...requestBody,
    service: "quick",
    deliveryLocation: { latitude: 22.5, longitude: 88.3 },
    deliveryPlaceId: "saved-place-reference",
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, "DELIVERY_SERVICE_UNAVAILABLE");
  assert.match(body.error, /refresh.*standard delivery/i);
  assert.deepEqual(harness.lookups, []);
  assert.deepEqual(harness.events, []);
  assert.deepEqual(harness.configurations, []);
});

test("retired Quick quote requests never call the shipping provider", async () => {
  const providerCalls = [];
  const shipping = loadTs("lib/shipping.ts", {});
  const { quoteCartShipping, ShippingQuoteError } = loadTs("lib/cart-shipping.ts", {
    "server-only": {},
    "@/lib/shipping": shipping,
    "@/lib/shiprocket": {
      ShiprocketError: class extends Error {},
      getShiprocketRates: async () => { providerCalls.push("standard"); },
      getShiprocketQuickRates: async () => { providerCalls.push("quick"); },
    },
  });
  for (const selection of [
    { service: "quick" },
    { service: "quick", deliveryLocation: { latitude: 22.5, longitude: 88.3 } },
  ]) {
    await assert.rejects(quoteCartShipping({ lines: [] }, "700040", selection), error => {
      assert.ok(error instanceof ShippingQuoteError);
      assert.equal(error.code, "DELIVERY_SERVICE_UNAVAILABLE");
      assert.equal(error.status, 400);
      assert.match(error.message, /refresh.*standard delivery/i);
      return true;
    });
  }
  assert.deepEqual(providerCalls, []);
});

test("checkout saves and links the order before exposing the SDK's resolved key", async () => {
  const harness = routeHarness();
  const response = await harness.run();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(harness.events.map(event => event[0]), ["save", "gateway", "link"]);
  assert.equal(harness.events[0][1].userId, null);
  assert.equal(harness.events[1][1].receipt, "website-offline");
  assert.deepEqual(Array.from(harness.events[2][1]), ["website-offline", "order_offline"]);
  assert.equal(body.keyId, harness.configurations[0].key_id);
  assert.equal(body.keyId, "rzp_test_serverKey");
  assert.equal(body.orderId, "order_offline");
  assert.equal(body.receiptToken, "offline-receipt-token");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("missing payment configuration cannot create any order", async () => {
  const harness = routeHarness({ env: {} });
  const response = await harness.run();
  assert.equal(response.status, 500);
  assert.equal(harness.events.length, 0);
  assert.equal(harness.configurations.length, 0);
  assert.equal(harness.logs[0][1].stage, "payment_configuration");
  assert.equal(harness.logs[0][1].code, "RAZORPAY_CONFIGURATION_ERROR");
});

test("storage failure prevents a gateway order", async () => {
  const harness = routeHarness({ storageError: new Error("storage unavailable") });
  const response = await harness.run();
  assert.equal(response.status, 503);
  assert.deepEqual(harness.events.map(event => event[0]), ["save"]);
  assert.equal(harness.logs[0][1].stage, "order_storage");
  assert.equal((await response.json()).orderId, undefined);
});

test("gateway failures log only operation, error code and HTTP status", async () => {
  const secretPayload = "do-not-log-this-credential-or-customer";
  const harness = routeHarness({
    gatewayError: { statusCode: 401, error: { code: "BAD_REQUEST_ERROR", description: secretPayload }, headers: { authorization: secretPayload } },
  });
  const response = await harness.run();
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.deepEqual(harness.events.map(event => event[0]), ["save", "gateway"]);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.logs)), [["Checkout failed", {
    stage: "razorpay_order_creation", code: "BAD_REQUEST_ERROR", statusCode: 401,
  }]]);
  assert.equal(JSON.stringify([harness.logs, body]).includes(secretPayload), false);
  assert.equal(body.orderId, undefined);
});

test("a failed database link never returns payment checkout details", async () => {
  const harness = routeHarness({ linkError: new Error("link unavailable") });
  const response = await harness.run();
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.deepEqual(harness.events.map(event => event[0]), ["save", "gateway", "link"]);
  assert.equal(body.orderId, undefined);
  assert.equal(body.keyId, undefined);
  assert.equal(harness.logs[0][1].stage, "payment_order_link");
});
