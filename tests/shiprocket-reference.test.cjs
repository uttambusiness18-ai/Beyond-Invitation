const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../lib/shiprocket-reference.ts");
const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
});
const moduleUnderTest = { exports: {} };
vm.runInNewContext(outputText, {
  module: moduleUnderTest,
  exports: moduleUnderTest.exports,
  require(name) {
    if (name === "server-only") return {};
    throw new Error(`Unexpected dependency: ${name}`);
  },
}, { filename });
const { merchantOrderId, legacyMerchantOrderId, resolveMerchantOrderId } = moduleUnderTest.exports;

const zero = "00000000-0000-0000-0000-000000000000";
const maximum = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const fixture = "c976a51c-2153-4561-82c9-1ec3a8850ba0";

test("references fit Quick's 30-character limit and retain all 128 UUID bits", () => {
  for (const id of [zero, maximum, fixture]) {
    const reference = merchantOrderId(id);
    assert.match(reference, /^BI[0-9A-Z]{25}$/);
    assert.ok(reference.length <= 30);
    const decoded = [...reference.slice(2)].reduce(
      (value, digit) => value * 36n + BigInt(parseInt(digit, 36)), 0n,
    );
    assert.equal(decoded.toString(16).padStart(32, "0"), id.replaceAll("-", ""));
  }
});

test("UUID casing cannot change the reference and different UUID bits remain distinct", () => {
  assert.equal(merchantOrderId(fixture.toUpperCase()), merchantOrderId(fixture));
  const ids = [
    zero,
    "00000000-0000-0000-0000-000000000001",
    "00000001-0000-0000-0000-000000000000",
    "ffffffff-ffff-ffff-ffff-fffffffffffe",
    maximum,
  ];
  assert.equal(new Set(ids.map(merchantOrderId)).size, ids.length);
});

test("invalid UUIDs cannot become merchant references", () => {
  for (const id of ["", "not-an-order", fixture.replaceAll("-", ""), `${fixture}0`, fixture.replace("c", "g")]) {
    assert.throws(() => merchantOrderId(id));
    assert.throws(() => legacyMerchantOrderId(id));
  }
});

test("legacy references retain their previous exact decimal value", () => {
  assert.equal(legacyMerchantOrderId(zero), "0");
  assert.equal(legacyMerchantOrderId(maximum), "340282366920938463463374607431768211455");
  assert.equal(legacyMerchantOrderId(fixture.toUpperCase()), legacyMerchantOrderId(fixture));
});

test("stored legacy and short references stay stable across retries and readback", () => {
  const legacy = legacyMerchantOrderId(fixture);
  const short = merchantOrderId(fixture);
  for (const state of ["creating", "created", "failed", "needs_review"]) {
    assert.equal(resolveMerchantOrderId(fixture, { state, merchantOrderId: legacy }), legacy);
    assert.equal(resolveMerchantOrderId(fixture, { state, merchantOrderId: short }), short);
  }
  assert.equal(resolveMerchantOrderId(fixture, { merchantOrderId: `  ${legacy}  ` }), `  ${legacy}  `);
  assert.equal(resolveMerchantOrderId(fixture, { merchantOrderId: "A".repeat(50) }), "A".repeat(50));
});

test("old fulfillment snapshots lacking a usable reference keep the legacy identity", () => {
  const expected = legacyMerchantOrderId(fixture);
  for (const saved of [{}, { state: "created" }, { merchantOrderId: "" },
    { merchantOrderId: "   " }, { merchantOrderId: 123 }, { merchantOrderId: "A".repeat(51) },
    false, 0, "old malformed state", []]) {
    assert.equal(resolveMerchantOrderId(fixture, saved), expected);
  }
});

test("orders without a fulfillment snapshot use the new short reference", () => {
  const expected = merchantOrderId(fixture);
  assert.equal(resolveMerchantOrderId(fixture, undefined), expected);
  assert.equal(resolveMerchantOrderId(fixture, null), expected);
});
