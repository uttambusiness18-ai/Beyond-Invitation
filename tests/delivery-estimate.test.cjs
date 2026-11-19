const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

function load(filename, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path.resolve(__dirname, "..", filename), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, process: { env: {} },
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename });
  return module.exports;
}

const shipping = load("lib/shipping.ts");

test("delivery wording distinguishes missing estimates, same-day transit, and whole days after dispatch", () => {
  for (const value of [undefined, null, "", "4", false, -1, NaN, Infinity, {}, Number.MAX_VALUE]) {
    assert.equal(shipping.formatDeliveryEstimate(value), null);
  }
  assert.equal(shipping.formatDeliveryEstimate(0), "Same day as dispatch");
  assert.equal(shipping.formatDeliveryEstimate(1), "1 day after dispatch");
  assert.equal(shipping.formatDeliveryEstimate(4), "4 days after dispatch");
  assert.equal(shipping.formatDeliveryEstimate(2.5), "3 days after dispatch");
});

function quotes(couriers) {
  const requests = [];
  class ShiprocketError extends Error {}
  const service = load("lib/cart-shipping.ts", {
    "server-only": {}, "@/lib/shipping": shipping,
    "@/lib/shiprocket": {
      ShiprocketError,
      async getShiprocketRates(input) { requests.push(input); return { couriers }; },
      async getShiprocketQuickRates() { throw new Error("Quick must not be requested"); },
    },
  });
  return { ...service, requests };
}

const cart = (quantity = 50) => ({
  lines: [{ itemCode: "CARD", name: "Invitation", price: 10, basePrice: 10, quantity, weightGrams: 20 }],
  amountPaise: quantity * 1000, currency: "INR", commission: 0,
});

test("a product check uses the selected quantity and the same courier estimate and fee as checkout", async () => {
  const service = quotes([
    { id: 2, name: "Express", rate: 150, estimatedDeliveryDays: 2 },
    { id: 1, name: "Standard", rate: 80, estimatedDeliveryDays: 5 },
  ]);
  const quote = await service.quoteCartShipping(cart(), "700040");
  assert.equal(quote.courierName, "Standard");
  assert.equal(quote.estimatedDeliveryDays, 5);
  assert.equal(quote.amountPaise, 13000);
  assert.equal(quote.totalPaise, 63000);
  assert.equal(service.requests[0].weightKg, 1);
  assert.equal(service.requests[0].deliveryPincode, "700040");
  assert.equal(service.requests[0].cod, false);
  await service.quoteCartShipping(cart(75), "700040");
  assert.equal(service.requests[1].weightKg, 1.5);
});

test("a missing courier estimate does not block a serviceable quote or borrow another courier's time", async () => {
  const service = quotes([
    { id: 1, name: "Standard", rate: 80, estimatedDeliveryDays: null },
    { id: 2, name: "Express", rate: 150, estimatedDeliveryDays: 2 },
  ]);
  const quote = await service.quoteCartShipping(cart(), "700040");
  assert.equal(quote.courierName, "Standard");
  assert.equal(quote.estimatedDeliveryDays, null);
  assert.equal(quote.totalPaise, 63000);
});

test("invalid pincodes and missing product weights cannot produce a delivery estimate", async () => {
  const service = quotes([]);
  await assert.rejects(service.quoteCartShipping(cart(), "012345"), { code: "INVALID_PINCODE" });
  const noWeight = cart();
  delete noWeight.lines[0].weightGrams;
  await assert.rejects(service.quoteCartShipping(noWeight, "700040"), { code: "WEIGHT_MISSING" });
  assert.equal(service.requests.length, 0);
  await assert.rejects(service.quoteCartShipping(cart(), "700040"), { code: "UNSERVICEABLE" });
});
