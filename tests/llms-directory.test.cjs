const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function directory(enabled) {
  const filename = path.resolve(__dirname, "../app/llms.txt/route.ts");
  const loaded = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mocks = {
    "@/lib/site-config": {
      SITE_NAME: "Test Store", BUSINESS_NAME: "Test Store (Test Agency)", BRAND_NAME: "Test Company", SITE_DESCRIPTION: "Test wedding invitations.",
      DEFAULT_OG_IMAGE: "/logo.png", BUSINESS_IMAGE: "/visit-us/showroom.jpg",
      BUSINESS_ADDRESS_TEXT: "Test Kolkata address", CONTACT: {
        displayPhone: "+91 12345 67890", landline: "033-12345678", email: "contact@example.test",
        googleMaps: "https://maps.example.test/showroom", instagram: "https://instagram.example.test/store", youtube: "https://youtube.example.test/store",
      },
      getSiteUrl: () => "https://example.test",
    },
    "@/lib/storefront-availability": { SHAGUN_ENVELOPES_ENABLED: enabled },
  };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(mocks, name), `Directory has no auth or database dependency: ${name}`);
    return mocks[name];
  }, loaded, loaded.exports);
  return loaded.exports.GET();
}

test("plain-text discovery directory links canonical public pages and respects collection visibility", async () => {
  for (const enabled of [false, true]) {
    const response = directory(enabled);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/plain; charset=utf-8$/);
    const text = await response.text();
    assert.match(text, /^# Test Store \(Test Agency\)\n/);
    assert.match(text, /Test Company/);
    assert.match(text, /Test Kolkata address/);
    const links = [...text.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map(match => match[1]);
    for (const route of ["/catalog", "/wedding-cards", "/collections/wedding-card-bengali", "/sitemap.xml", "/robots.txt", "/contact"]) {
      assert.ok(links.includes(`https://example.test${route}`));
    }
    assert.equal(links.includes("https://example.test/collections/shagun-envelopes"), enabled);
    assert.ok(links.every(link => !/\/(api|admin|account|checkout)(\/|$)/.test(new URL(link).pathname)));
  }
});
