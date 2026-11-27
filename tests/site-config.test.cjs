const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const DEFAULT_ORIGIN = "https://www.beyondinvitation.co.in";

function config(env = {}) {
  const filename = path.resolve(__dirname, "../lib/site-config.ts");
  const loaded = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", "process", compiled)(name => {
    assert.equal(name, "@/lib/storefront-availability");
    return { SHAGUN_ENVELOPES_ENABLED: true };
  }, loaded, loaded.exports, { env });
  return loaded.exports;
}

test("canonical business domain ignores all implicit Vercel hostnames", () => {
  assert.equal(config().getSiteUrl(), DEFAULT_ORIGIN);
  const deploymentNames = ["NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_PROJECT_PRODUCTION_URL", "NEXT_PUBLIC_VERCEL_URL", "VERCEL_URL"];
  for (const name of deploymentNames) {
    assert.equal(config({ [name]: "temporary-deployment.vercel.app" }).getSiteUrl(), DEFAULT_ORIGIN);
  }
  assert.equal(config(Object.fromEntries(deploymentNames.map(name => [name, "preview.vercel.app"]))).getSiteUrl(), DEFAULT_ORIGIN);
});

test("explicit canonical configuration normalizes hostnames and strips paths, query strings and fragments", () => {
  for (const [input, expected] of [
    ["shop.example.test", "https://shop.example.test"],
    ['  "https://SHOP.EXAMPLE.test/"  ', "https://shop.example.test"],
    ["https://shop.example.test/catalog?ref=share#products", "https://shop.example.test"],
    ["http://localhost:3000/", "http://localhost:3000"],
    ["", DEFAULT_ORIGIN], ["   ", DEFAULT_ORIGIN],
    ["https://", DEFAULT_ORIGIN], ["https://name:password@shop.example.test", DEFAULT_ORIGIN],
    ["ftp://example.test", DEFAULT_ORIGIN], ["javascript:alert(1)", DEFAULT_ORIGIN],
    ["javascript://example.test", DEFAULT_ORIGIN],
  ]) {
    const site = config({ NEXT_PUBLIC_SITE_URL: input, VERCEL_URL: "preview.vercel.app" });
    assert.equal(site.getSiteUrl(), expected, input);
    assert.equal(site.siteUrl("/products/card"), `${expected}/products/card`);
  }
});
