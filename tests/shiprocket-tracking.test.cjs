const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../lib/shiprocket.ts");
const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
});
const shipmentId = 202;
const orderId = 101;
const trackingPath = `/courier/track/shipment/${shipmentId}`;
const orderPath = `/orders/show/${orderId}`;

function trackingData(overrides = {}) {
  return {
    track_status: 1,
    shipment_status: 18,
    shipment_track: [{
      id: 999, shipment_id: String(shipmentId), order_id: String(orderId),
      current_status: "IN TRANSIT", courier_name: "Example Courier", awb_code: "AWB123",
      delivered_date: "", consignee_name: "Private Customer",
    }],
    shipment_track_activities: [
      { date: "2026-11-16 09:30:00", activity: "Picked up", location: "Delhi" },
      { date: "2026-11-17 10:00:00", activity: "In transit", location: "Mumbai" },
      { date: "not-a-date", activity: "Invalid", location: "Hidden" },
    ],
    track_url: "https://app.shiprocket.in/tracking/AWB123",
    etd: "2026-11-19 18:00:00",
    ...overrides,
  };
}

function orderDetails(overrides = {}) {
  return { data: {
    id: orderId, status: "PICKUP SCHEDULED", status_code: 4,
    customer_name: "Private Customer", customer_email: "private@example.test",
    shipments: {
      id: shipmentId, order_id: orderId, status: "PICKUP SCHEDULED",
      courier: "Example Courier", awb: "AWB123", etd: "2026-11-19 18:00:00",
      delivered_date: "",
    },
    ...overrides,
  } };
}

function loadTracking(responses) {
  const calls = [];
  const queue = [{ path: "/auth/login", body: { token: "test-token" } }, ...responses];
  const moduleUnderTest = { exports: {} };
  vm.runInNewContext(outputText, {
    module: moduleUnderTest, exports: moduleUnderTest.exports,
    require(name) {
      if (name === "server-only") return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
    process: { env: {
      SHIPROCKET_EMAIL: "api@example.test", SHIPROCKET_PASSWORD: "test-password",
      SHIPROCKET_PICKUP_LOCATION: "Warehouse",
    } },
    URL, URLSearchParams, AbortSignal,
    async fetch(url, options) {
      const route = String(url).replace("https://apiv2.shiprocket.in/v1/external", "");
      calls.push({ path: route, ...options });
      const next = queue.shift();
      assert.ok(next, `Unexpected provider request: ${route}`);
      assert.equal(route, next.path);
      if (next.error) throw next.error;
      const status = next.status ?? 200;
      return { ok: status >= 200 && status < 300, status, json: async () => next.body };
    },
  }, { filename });
  return {
    ...moduleUnderTest.exports,
    calls,
    assertReadOnly() {
      assert.equal(queue.length, 0, "All expected reads were made");
      for (const call of calls) {
        assert.equal(call.method, call.path === "/auth/login" ? "POST" : "GET");
        assert.equal(call.cache, "no-store");
      }
    },
  };
}

const safeFields = ["available", "status", "courierName", "awb", "trackingUrl",
  "estimatedDeliveryAt", "deliveredAt", "events"].sort();

for (const keyed of [false, true]) {
  test(`${keyed ? "shipment-keyed" : "direct"} courier response displays real scans and India timestamps`, async () => {
    const data = { tracking_data: trackingData() };
    const provider = loadTracking([{ path: trackingPath, body: keyed ? { [shipmentId]: data } : data }]);
    const result = await provider.getShiprocketTracking(shipmentId, orderId);
    assert.equal(result.available, true);
    assert.equal(result.status, "IN TRANSIT");
    assert.equal(result.courierName, "Example Courier");
    assert.equal(result.awb, "AWB123");
    assert.equal(result.trackingUrl, "https://app.shiprocket.in/tracking/AWB123");
    assert.equal(result.estimatedDeliveryAt, "2026-11-19T12:30:00.000Z");
    assert.deepEqual(JSON.parse(JSON.stringify(result.events)), [
      { date: "2026-11-17T04:30:00.000Z", status: "In transit", location: "Mumbai" },
      { date: "2026-11-16T04:00:00.000Z", status: "Picked up", location: "Delhi" },
    ]);
    assert.deepEqual(Object.keys(result).sort(), safeFields);
    assert.ok(!JSON.stringify(result).includes("Private Customer"));
    provider.assertReadOnly();
  });
}

test("cancelled keyed placeholder uses verified live order status without inventing scans", async () => {
  const provider = loadTracking([
    { path: trackingPath, body: { [shipmentId]: { tracking_data: trackingData({
      shipment_status: 8,
      error: "Ohh! This AWB has been cancelled.",
      shipment_track: [{ id: 0, shipment_id: 0, order_id: 0, current_status: "", courier_name: "", awb_code: "" }],
      shipment_track_activities: null, track_url: "", etd: undefined,
    }) } } },
    { path: orderPath, body: orderDetails({ status: "CANCELED", status_code: 5,
      shipments: { id: shipmentId, order_id: orderId, status: "CANCELED", courier: "", awb: null, etd: "", delivered_date: "" },
    }) },
  ]);
  const result = await provider.getShiprocketTracking(shipmentId, orderId);
  assert.equal(result.available, true);
  assert.match(result.status, /cancel/i);
  assert.equal(result.events.length, 0);
  assert.equal(result.awb, null);
  assert.equal(result.deliveredAt, null);
  assert.deepEqual(Object.keys(result).sort(), safeFields);
  provider.assertReadOnly();
});

test("no courier scans shows the verified booking status and available courier details", async () => {
  const provider = loadTracking([
    { path: trackingPath, body: { tracking_data: { track_status: 0, error: "No activities found", shipment_track: [], shipment_track_activities: null } } },
    { path: orderPath, body: orderDetails() },
  ]);
  const result = await provider.getShiprocketTracking(shipmentId, orderId);
  assert.equal(result.available, true);
  assert.equal(result.status, "PICKUP SCHEDULED");
  assert.equal(result.courierName, "Example Courier");
  assert.equal(result.awb, "AWB123");
  assert.equal(result.events.length, 0);
  provider.assertReadOnly();
});

test("missing tracking identifiers require an independent order/shipment match", async () => {
  const provider = loadTracking([
    { path: trackingPath, body: { tracking_data: trackingData({ shipment_track: [{ shipment_id: null, order_id: null, current_status: "IN TRANSIT", awb_code: "AWB123" }] }) } },
    { path: orderPath, body: orderDetails({ status: "IN TRANSIT" }) },
  ]);
  const result = await provider.getShiprocketTracking(shipmentId, orderId);
  assert.equal(result.available, true);
  assert.ok(result.status);
  provider.assertReadOnly();
});

test("fallback selects the saved shipment from an array and preserves actual delivery time", async () => {
  const provider = loadTracking([
    { path: trackingPath, body: { tracking_data: { track_status: 0, error: "No activities found" } } },
    { path: orderPath, body: orderDetails({ status: "DELIVERED", shipments: [
      { id: 9999, order_id: orderId, status: "IN TRANSIT", courier: "Other Courier", awb: "OTHER123" },
      { id: shipmentId, order_id: orderId, status: "DELIVERED", courier: "Example Courier", awb: "AWB123", delivered_date: "2026-11-17 16:45:00" },
    ] }) },
  ]);
  const result = await provider.getShiprocketTracking(shipmentId, orderId);
  assert.equal(result.status, "DELIVERED");
  assert.equal(result.awb, "AWB123");
  assert.equal(result.deliveredAt, "2026-11-17T11:15:00.000Z");
  assert.equal(result.events.length, 0);
  provider.assertReadOnly();
});

test("fallback refuses ambiguous shipment matches", async () => {
  const details = orderDetails();
  details.data.shipments = [details.data.shipments, { ...details.data.shipments }];
  const provider = loadTracking([
    { path: trackingPath, body: { tracking_data: { track_status: 0, error: "No activities found" } } },
    { path: orderPath, body: details },
  ]);
  await assert.rejects(provider.getShiprocketTracking(shipmentId, orderId), { code: "INVALID_RESPONSE" });
  provider.assertReadOnly();
});

test("identity verification refuses an AWB that differs from the saved shipment", async () => {
  const provider = loadTracking([
    { path: trackingPath, body: { tracking_data: trackingData({ shipment_track: [{ shipment_id: null, order_id: null, current_status: "IN TRANSIT", awb_code: "OTHER123" }] }) } },
    { path: orderPath, body: orderDetails() },
  ]);
  await assert.rejects(provider.getShiprocketTracking(shipmentId, orderId), { code: "INVALID_RESPONSE" });
  provider.assertReadOnly();
});

for (const field of ["shipment_id", "order_id"]) {
  test(`mismatched courier ${field} is rejected rather than replaced with a fallback`, async () => {
    const data = trackingData();
    data.shipment_track[0][field] = 9999;
    const provider = loadTracking([{ path: trackingPath, body: { tracking_data: data } }]);
    await assert.rejects(provider.getShiprocketTracking(shipmentId, orderId), { code: "INVALID_RESPONSE" });
    provider.assertReadOnly();
  });
}

for (const mismatch of ["order", "shipment", "shipment-order"]) {
  test(`fallback rejects a mismatched ${mismatch} identity`, async () => {
    const details = orderDetails();
    if (mismatch === "order") details.data.id = 9999;
    if (mismatch === "shipment") details.data.shipments.id = 9999;
    if (mismatch === "shipment-order") details.data.shipments.order_id = 9999;
    const provider = loadTracking([
      { path: trackingPath, body: { tracking_data: { track_status: 0, error: "No activities found" } } },
      { path: orderPath, body: details },
    ]);
    await assert.rejects(provider.getShiprocketTracking(shipmentId, orderId), { code: "INVALID_RESPONSE" });
    provider.assertReadOnly();
  });
}

test("wrong shipment-keyed wrapper and unrelated provider errors fail closed", async () => {
  for (const body of [
    { 9999: { tracking_data: trackingData() } },
    { tracking_data: trackingData({ error: "Permission denied" }) },
    { tracking_data: { track_status: 0, error: "Account is disabled" } },
    { tracking_data: trackingData({ shipment_track_activities: {} }) },
  ]) {
    const provider = loadTracking([{ path: trackingPath, body }]);
    await assert.rejects(provider.getShiprocketTracking(shipmentId, orderId), { code: "INVALID_RESPONSE" });
    provider.assertReadOnly();
  }
});

test("tracking HTTP and network failures cannot become successful empty updates", async () => {
  for (const response of [
    { status: 403, expected: "ACCESS_DENIED" },
    { status: 429, expected: "RATE_LIMITED" },
    { status: 500, expected: "REQUEST_FAILED" },
    { error: new Error("Network failure"), expected: "NETWORK_ERROR" },
  ]) {
    const provider = loadTracking([{ path: trackingPath, ...response }]);
    await assert.rejects(provider.getShiprocketTracking(shipmentId, orderId), { code: response.expected });
    provider.assertReadOnly();
  }
});

test("expired tracking token refreshes once and retries only the read", async () => {
  const provider = loadTracking([
    { path: trackingPath, status: 401 },
    { path: "/auth/login", body: { token: "renewed-token" } },
    { path: trackingPath, body: { tracking_data: trackingData() } },
  ]);
  assert.equal((await provider.getShiprocketTracking(shipmentId, orderId)).status, "IN TRANSIT");
  assert.equal(provider.calls.at(-1).headers.Authorization, "Bearer renewed-token");
  provider.assertReadOnly();
});

test("untrusted carrier URL is omitted while genuine shipment updates remain visible", async () => {
  const provider = loadTracking([{ path: trackingPath, body: { tracking_data: trackingData({
    track_url: "https://app.shiprocket.in.evil.test/tracking/AWB123",
  }) } }]);
  const result = await provider.getShiprocketTracking(shipmentId, orderId);
  assert.equal(result.status, "IN TRANSIT");
  assert.equal(result.trackingUrl, null);
  provider.assertReadOnly();
});
