const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../lib/order-tracking-progress.ts");
const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
});
const loaded = { exports: {} };
vm.runInNewContext(outputText, { module: loaded, exports: loaded.exports }, { filename });
const { getOrderTrackingProgress } = loaded.exports;
const date = "2026-11-17T09:30:00.000Z";
const priorDate = "2026-11-16T09:30:00.000Z";
const fixture = (overrides = {}) => ({
  state: "tracking", status: "IN TRANSIT", courierName: "Fixture courier", awb: "AWB123",
  trackingUrl: null, estimatedDeliveryAt: null, deliveredAt: null, events: [],
  checkedAt: "2026-11-18T09:30:00.000Z", ...overrides,
});
const event = (status, value = date) => ({ status, date: value, location: null });
const plain = (value) => JSON.parse(JSON.stringify(value));

test("normal shipment progress presents five milestones without invented timestamps", () => {
  const result = getOrderTrackingProgress(fixture());
  assert.deepEqual(plain(result.steps.map(({ label, state }) => ({ label, state }))), [
    { label: "Order placed", state: "complete" }, { label: "Preparing", state: "complete" },
    { label: "Shipped", state: "current" }, { label: "Out for delivery", state: "upcoming" },
    { label: "Delivered", state: "upcoming" },
  ]);
  assert.ok(result.steps.every((step) => step.date === null));
  assert.equal(result.notice, null);
});

test("scan dates use earliest matching real events and ignore malformed timestamps", () => {
  const result = getOrderTrackingProgress(fixture({ status: "OUT FOR DELIVERY", events: [
    event("In transit"), event("Picked up", priorDate), event("Out for delivery"),
    event("Packed", "not-a-date"), event("Delivered", date),
  ] }));
  assert.equal(result.steps[2].date, priorDate);
  assert.equal(result.steps[3].date, date);
  assert.equal(result.steps[1].date, null);
  assert.equal(result.steps[4].date, null);
  assert.equal(result.steps[4].state, "upcoming");
});

test("current stage overrides stale later scans and delivery dates", () => {
  const result = getOrderTrackingProgress(fixture({ status: "PICKUP SCHEDULED", deliveredAt: date,
    events: [event("Delivered"), event("Out for delivery"), event("In transit")] }));
  assert.equal(result.steps[1].state, "current");
  assert.ok(result.steps.slice(2).every((step) => step.state === "upcoming" && step.date === null));
});

test("delivered marks the full route complete and uses the actual delivery date", () => {
  const result = getOrderTrackingProgress(fixture({ status: "DELIVERED", deliveredAt: date }));
  assert.ok(result.steps.every((step) => step.state === "complete"));
  assert.equal(result.steps[4].date, date);
  assert.ok(result.steps.slice(0, 4).every((step) => step.date === null));
});

test("cancelled shipment without scans cannot claim preparation or shipment happened", () => {
  const result = getOrderTrackingProgress(fixture({ status: "CANCELED" }));
  assert.deepEqual(plain(result.steps), [
    { id: "ordered", label: "Order placed", state: "complete", date: null },
    { id: "cancelled", label: "Shipment cancelled", state: "stopped", date: null },
  ]);
  assert.equal(result.notice.tone, "danger");
});

test("cancellation retains evidenced milestones and its matching cancellation date", () => {
  const result = getOrderTrackingProgress(fixture({ status: "CANCELLED", events: [
    event("Picked up", priorDate), event("Cancelled"), event("Delivered"),
  ] }));
  assert.deepEqual(plain(result.steps.map((step) => step.id)), ["ordered", "shipped", "cancelled"]);
  assert.equal(result.steps[1].date, priorDate);
  assert.equal(result.steps[2].date, date);
});

test("RTO and return-delivered statuses never become customer delivery", () => {
  for (const status of ["RTO DELIVERED", "RETURN DELIVERED", "RETURNED", "RTO IN TRANSIT"]) {
    const result = getOrderTrackingProgress(fixture({ status, deliveredAt: date,
      events: [event("In transit", priorDate), event("Delivered"), event(status)] }));
    assert.ok(!result.steps.some((step) => step.id === "delivered"));
    assert.equal(result.steps.at(-1).state, "stopped");
    assert.equal(result.steps.at(-1).id, "return");
    assert.equal(result.notice.tone, "warning");
  }
});

test("failed, delayed and partial delivery show warnings instead of delivered", () => {
  for (const status of ["UNDELIVERED", "NOT DELIVERED", "PARTIALLY DELIVERED", "DELIVERY DELAYED", "DELIVERY FAILED", "PICKUP EXCEPTION"]) {
    const result = getOrderTrackingProgress(fixture({ status, deliveredAt: date,
      events: [event("In transit"), event("Delivered")] }));
    assert.ok(!result.steps.some((step) => step.id === "delivered"));
    assert.equal(result.notice.tone, "warning");
  }
});

test("unsuccessful and cancelled returns cannot claim delivery to the sender", () => {
  for (const status of ["RETURN NOT DELIVERED", "RTO UNDELIVERED", "RETURN CANCELLED"]) {
    const result = getOrderTrackingProgress(fixture({ status }));
    assert.notEqual(result.steps.at(-1).label, "Returned to sender");
    assert.notEqual(result.steps.at(-1).label, "Return in progress");
    assert.equal(result.notice.tone, "warning");
  }
});

test("pickup and ready-to-ship states do not advance to shipped", () => {
  for (const status of ["OUT FOR PICKUP", "PICKUP SCHEDULED", "READY TO SHIP", "AWB ASSIGNED", "NEW"]) {
    const result = getOrderTrackingProgress(fixture({ status }));
    assert.equal(result.steps[1].state, "current");
    assert.equal(result.steps[2].state, "upcoming");
  }
});

test("unknown provider status displays only evidenced milestones with a neutral notice", () => {
  const result = getOrderTrackingProgress(fixture({ status: "PROCESSING AT FACILITY", events: [event("Picked up")] }));
  assert.deepEqual(plain(result.steps.map((step) => step.id)), ["ordered", "shipped"]);
  assert.equal(result.notice.tone, "neutral");
  assert.ok(result.steps.every((step) => step.state === "complete"));
});

test("local preparation and payment pending remain distinct", () => {
  const preparing = getOrderTrackingProgress(fixture({ state: "preparing", status: "Your order is being prepared." }));
  assert.equal(preparing.steps[1].state, "current");
  const pending = getOrderTrackingProgress(fixture({ state: "preparing", status: "Waiting for payment confirmation." }));
  assert.equal(pending.steps[0].state, "current");
  assert.equal(pending.steps[1].state, "upcoming");
  assert.match(pending.notice.title, /payment/i);
});

test("awaiting scans remains preparing and test orders have no live timeline", () => {
  const waiting = getOrderTrackingProgress(fixture({ state: "awaiting_tracking", status: "Waiting for courier tracking updates." }));
  assert.equal(waiting.steps[1].state, "current");
  assert.match(waiting.notice.title, /courier updates/i);
  const simulated = getOrderTrackingProgress(fixture({ state: "test_order", status: "Test order" }));
  assert.equal(simulated.steps.length, 0);
  assert.match(simulated.notice.title, /test order/i);
});
