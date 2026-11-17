const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { test } = require("node:test");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const orderId = "f87a3225-0000-4000-8000-000000000001";
const ownerId = "00000000-0000-4000-8000-000000000002";
const token = "A".repeat(43);
const tokenHash = (value) => crypto.createHash("sha256").update(value).digest("hex");

function loadTs(filename, dependencies, env = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path.join(projectRoot, filename), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
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
    console: { error() {}, warn() {} },
  }, { filename });
  return module.exports;
}

function harness() {
  const calls = [];
  const row = {
    id: orderId,
    user_id: ownerId,
    payment_status: "paid",
    shipping_address: {
      paymentMode: "live",
      trackingTokenHash: tokenHash(token),
      addressLine1: "Private customer address",
      fulfillment: { state: "created", shipmentId: 123, shiprocketOrderId: 456 },
    },
  };
  const providerResult = {
    available: true,
    status: "In transit",
    courierName: "Fixture courier",
    awb: "FIXTURE123",
    trackingUrl: "https://shiprocket.co/tracking/FIXTURE123",
    estimatedDeliveryAt: "2026-11-20T12:00:00.000Z",
    deliveredAt: null,
    events: [{ date: "2026-11-17T10:00:00.000Z", status: "Picked up", location: "Kolkata" }],
    internalProviderField: "Must not cross the service boundary",
  };
  const state = { row, user: { id: ownerId }, authError: null, dbError: null,
    provider: async () => providerResult };
  const env = { SHIPROCKET_EMAIL: "offline@example.invalid", SHIPROCKET_PASSWORD: "offline-secret",
    SHIPROCKET_PICKUP_LOCATION: "Offline pickup" };

  function client(kind) {
    return {
      auth: { async getUser() {
        calls.push(["auth"]);
        return { data: { user: state.user }, error: state.authError };
      } },
      from(table) {
        assert.equal(table, "website_orders");
        calls.push(["read", kind]);
        const filters = [];
        const query = {
          select(columns) { calls.push(["select", kind, columns]); return query; },
          eq(column, value) { filters.push([column, value]); return query; },
          async maybeSingle() {
            calls.push(["filters", kind, filters]);
            // Deliberately do not apply RLS here: the service must also check ownership.
            return { data: state.row, error: state.dbError };
          },
        };
        // Any attempted insert, update, delete, or RPC is unsupported and fails the test.
        return query;
      },
    };
  }
  const tokens = loadTs("lib/order-tracking-token.ts", { "server-only": {}, "node:crypto": crypto });
  const service = loadTs("lib/order-tracking.ts", {
    "server-only": {},
    "node:crypto": crypto,
    "@/lib/supabase/auth-server": { getSupabaseAuthServerClient: async () => client("authenticated") },
    "@/lib/supabase/admin": { getSupabaseAdminClient: () => client("admin") },
    "@/lib/order-tracking-token": { verifyOrderTrackingToken(value, hash) {
      calls.push(["verify-token"]);
      return tokens.verifyOrderTrackingToken(value, hash);
    } },
    "@/lib/shiprocket": { async getShiprocketTracking(shipmentId, expectedOrderId) {
      calls.push(["provider", shipmentId, expectedOrderId]);
      return state.provider();
    } },
  }, env);
  const count = (kind) => calls.filter(([name]) => name === kind).length;
  return { service, state, calls, count, env };
}

test("signed-in tracking rechecks authentication and ownership before using cached provider data", async () => {
  const { service, state, calls, count } = harness();
  const first = await service.getCustomerOrderTracking(orderId);
  const second = await service.getCustomerOrderTracking(orderId);
  assert.equal(first.status, "In transit");
  assert.equal(second.checkedAt, first.checkedAt);
  assert.equal(count("auth"), 2);
  assert.equal(count("read"), 2);
  assert.equal(count("provider"), 1);
  for (const [, kind, filters] of calls.filter(([name]) => name === "filters")) {
    assert.equal(kind, "authenticated");
    assert.deepEqual(filters, [["id", orderId], ["user_id", ownerId]]);
  }
  state.user = { id: "another-owner" };
  await assert.rejects(service.getCustomerOrderTracking(orderId), { code: "ORDER_NOT_FOUND", status: 404 });
  assert.equal(count("provider"), 1);
  state.user = null;
  const reads = count("read");
  await assert.rejects(service.getCustomerOrderTracking(orderId), { code: "SIGN_IN_REQUIRED", status: 401 });
  assert.equal(count("read"), reads);
  assert.equal(count("provider"), 1);
});

test("guest tokens and their current stored hash are verified on every cache hit", async () => {
  const { service, state, count } = harness();
  await service.getGuestOrderTracking(orderId, token);
  await service.getGuestOrderTracking(orderId, token);
  assert.equal(count("read"), 2);
  assert.equal(count("verify-token"), 2);
  assert.equal(count("provider"), 1);
  await assert.rejects(service.getGuestOrderTracking(orderId, "B".repeat(43)), { code: "ORDER_NOT_FOUND", status: 404 });
  assert.equal(count("provider"), 1);
  const replacement = "C".repeat(43);
  state.row.shipping_address.trackingTokenHash = tokenHash(replacement);
  await assert.rejects(service.getGuestOrderTracking(orderId, token), { code: "ORDER_NOT_FOUND", status: 404 });
  assert.equal((await service.getGuestOrderTracking(orderId, replacement)).status, "In transit");
  assert.equal(count("verify-token"), 5);
  assert.equal(count("provider"), 1);
});

test("malformed guest capabilities fail before database or provider access", async () => {
  const { service, count } = harness();
  for (const [id, secret] of [["not-a-uuid", token], [orderId, "short"], [orderId, "!".repeat(43)],
    [orderId, null], [null, token]]) {
    await assert.rejects(service.getGuestOrderTracking(id, secret), { code: "ORDER_NOT_FOUND", status: 404 });
  }
  assert.equal(count("read"), 0);
  assert.equal(count("verify-token"), 0);
  assert.equal(count("provider"), 0);
});

test("an authenticated cache entry cannot bypass guest access checks", async () => {
  const { service, count } = harness();
  await service.getCustomerOrderTracking(orderId);
  await assert.rejects(service.getGuestOrderTracking(orderId, "B".repeat(43)), { code: "ORDER_NOT_FOUND", status: 404 });
  await service.getGuestOrderTracking(orderId, token);
  assert.equal(count("auth"), 1);
  assert.equal(count("verify-token"), 2);
  assert.equal(count("provider"), 1);
});

test("provider caching never overrides current payment or fulfillment state", async () => {
  const { service, state, count } = harness();
  await service.getCustomerOrderTracking(orderId);
  state.row.shipping_address.paymentMode = "test";
  assert.equal((await service.getCustomerOrderTracking(orderId)).state, "test_order");
  state.row.shipping_address.paymentMode = "live";
  state.row.payment_status = "pending";
  assert.equal((await service.getCustomerOrderTracking(orderId)).state, "preparing");
  state.row.payment_status = "paid";
  state.row.shipping_address.fulfillment.state = "needs_review";
  assert.equal((await service.getCustomerOrderTracking(orderId)).state, "preparing");
  assert.equal(count("provider"), 1);
});

test("changed shipment references or provider credentials cannot reuse earlier tracking", async () => {
  const { service, state, env, calls, count } = harness();
  await service.getCustomerOrderTracking(orderId);
  state.row.shipping_address.fulfillment.shipmentId = 789;
  state.row.shipping_address.fulfillment.shiprocketOrderId = 987;
  await service.getCustomerOrderTracking(orderId);
  env.SHIPROCKET_PASSWORD = "rotated-offline-secret";
  await service.getCustomerOrderTracking(orderId);
  assert.equal(count("provider"), 3);
  assert.deepEqual(calls.filter(([name]) => name === "provider"), [
    ["provider", 123, 456], ["provider", 789, 987], ["provider", 789, 987],
  ]);
});

test("a failed provider read is not cached and exposes no provider error details", async () => {
  const { service, state, count } = harness();
  const provider = state.provider;
  state.provider = async () => { throw new Error("Provider body with private-address and secret-token"); };
  await assert.rejects(service.getCustomerOrderTracking(orderId), (error) => {
    assert.equal(error.code, "TRACKING_UNAVAILABLE");
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /private-address|secret-token/);
    return true;
  });
  state.provider = provider;
  assert.equal((await service.getCustomerOrderTracking(orderId)).status, "In transit");
  assert.equal(count("provider"), 2);
  assert.equal(count("auth"), 2);
});

test("concurrent authorized reads share the provider request while each checks access", async () => {
  const { service, state, count } = harness();
  const original = state.provider;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  state.provider = () => pending;
  const first = service.getCustomerOrderTracking(orderId);
  const second = service.getGuestOrderTracking(orderId, token);
  release(await original());
  const results = await Promise.all([first, second]);
  assert.equal(results[0].status, "In transit");
  assert.equal(results[1].status, "In transit");
  assert.equal(count("auth"), 1);
  assert.equal(count("verify-token"), 1);
  assert.equal(count("read"), 2);
  assert.equal(count("provider"), 1);
});

test("tracking is read-only and only exposes selected delivery fields", async () => {
  const { service, state } = harness();
  const before = JSON.stringify(state.row);
  const result = await service.getCustomerOrderTracking(orderId);
  await service.getGuestOrderTracking(orderId, token);
  assert.equal(JSON.stringify(state.row), before);
  assert.deepEqual(Object.keys(result).sort(), ["awb", "checkedAt", "courierName", "deliveredAt",
    "estimatedDeliveryAt", "events", "state", "status", "trackingUrl"].sort());
  assert.doesNotMatch(JSON.stringify(result), /Private customer address|internalProviderField|trackingTokenHash/);
});

test("database failures and deleted orders never return cached tracking", async () => {
  const { service, state, count } = harness();
  await service.getCustomerOrderTracking(orderId);
  state.dbError = { code: "OFFLINE_FIXTURE" };
  await assert.rejects(service.getCustomerOrderTracking(orderId), { code: "ORDER_UNAVAILABLE", status: 503 });
  await assert.rejects(service.getGuestOrderTracking(orderId, token), { code: "ORDER_UNAVAILABLE", status: 503 });
  state.dbError = null;
  state.row = null;
  await assert.rejects(service.getCustomerOrderTracking(orderId), { code: "ORDER_NOT_FOUND", status: 404 });
  await assert.rejects(service.getGuestOrderTracking(orderId, token), { code: "ORDER_NOT_FOUND", status: 404 });
  assert.equal(count("provider"), 1);
});
