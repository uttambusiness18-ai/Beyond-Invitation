const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { NextRequest } = require("next/server");
const { resolveRobots } = require("next/dist/build/webpack/loaders/metadata/resolve-route-data");
const { inspectHtml } = require("../scripts/check-crawler-access.cjs");

const ORIGIN = "https://example.test";

function load(relative, mocks) {
  const filename = path.resolve(__dirname, "..", relative);
  const loaded = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", compiled)(
    name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

const publicPaths = [
  "/", "/catalog", "/wedding-cards", "/wedding-boxes",
  "/collections/wedding-card-bengali", "/products/g22201",
  "/about", "/contact", "/visit-us", "/faq", "/faq/", "/blog", "/blog/invitation-guide",
  "/privacy-policy", "/refund-policy", "/shipping-policy", "/terms-and-conditions",
];
const privatePaths = ["/admin", "/account", "/checkout", "/my-orders", "/track-order", "/sign-in"];

test("crawler audit accepts readable quote-only pages and rejects incomplete priced-product data", () => {
  const url = `${ORIGIN}/products/example`;
  const webpage = { "@context": "https://schema.org", "@type": "WebPage", name: "Example invitation", url };
  const product = { "@context": "https://schema.org", "@type": "Product", name: "Example invitation", url };
  const inspect = (nodes, price) => inspectHtml(
    `<html><head><link rel="canonical" href="${url}">${price === undefined ? "" : `<meta name="product:price:amount" content="${price}">`}</head><body><h1>Example invitation</h1>${nodes.map(node => `<script type="application/ld+json">${JSON.stringify(node)}</script>`).join("")}</body></html>`,
    url, new Response(), "Googlebot",
  );
  assert.doesNotThrow(() => inspect([webpage]));
  assert.doesNotThrow(() => inspect([webpage, { ...product, offers: { "@type": "Offer", price: 25, priceCurrency: "INR" } }], 25));
  assert.throws(() => inspect([webpage, product]), /no offer or review/);
  assert.throws(() => inspect([webpage], 25), /missing Product/);
  assert.throws(() => inspect([]), /missing server-rendered product WebPage/);
});

test("robots output welcomes all crawlers while keeping private routes and APIs excluded", () => {
  const route = load("app/robots.ts", { "@/lib/site-config": { getSiteUrl: () => ORIGIN } });
  const output = resolveRobots(route.default());
  assert.deepEqual(output.match(/^User-Agent: .+$/gm), ["User-Agent: *"],
    "a single wildcard policy also covers future AI agents without more-specific overrides");
  assert.match(output, /^Allow: \/$/m);
  assert.match(output, /^Sitemap: https:\/\/example\.test\/sitemap\.xml$/m);
  const exclusions = [...output.matchAll(/^Disallow: (.+)$/gm)].map(match => match[1]);
  for (const pathname of [...publicPaths, "/_next/static/app.js", "/logo.png", "/sitemap.xml", "/robots.txt"]) {
    assert.ok(!exclusions.some(prefix => pathname.startsWith(prefix)), `${pathname} must remain crawlable`);
  }
  for (const pathname of [...privatePaths, "/api/orders/receipt", "/auth/callback"]) {
    assert.ok(exclusions.some(prefix => pathname.startsWith(prefix)), `${pathname} must remain excluded`);
  }
});

test("public pages bypass unavailable auth for browsers, AI crawlers and unknown agents", async () => {
  let authCalls = 0;
  const authFailure = new Error("Auth unavailable");
  const { middleware } = load("middleware.ts", {
    "@/lib/supabase/session": { async refreshAuthSession() { authCalls++; throw authFailure; } },
  });
  for (const agent of ["Mozilla/5.0", "OAI-SearchBot", "GPTBot", "ClaudeBot", "PerplexityBot", "FutureCrawler/1.0"]) {
    for (const pathname of publicPaths) {
      const response = await middleware(new NextRequest(`${ORIGIN}${pathname}`, { headers: { "User-Agent": agent } }));
      assert.equal(response.status, 200, `${agent} can read ${pathname} when auth is unavailable`);
      assert.equal(response.headers.get("location"), null);
    }
  }
  assert.equal(authCalls, 0);
  for (const pathname of privatePaths) {
    await assert.rejects(middleware(new NextRequest(`${ORIGIN}${pathname}`)), error => error === authFailure);
  }
  assert.equal(authCalls, privatePaths.length, "private routes still use their existing session refresh");
});

test("referral links still clean the URL and set the reseller cookie on public pages", async () => {
  const { middleware } = load("middleware.ts", {
    "@/lib/supabase/session": { async refreshAuthSession() { throw new Error("Unexpected auth call"); } },
  });
  const response = await middleware(new NextRequest(`${ORIGIN}/faq?via=abcd1234&source=share`));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), `${ORIGIN}/faq?source=share`);
  assert.equal(response.cookies.get("bi_pref").value, "ABCD1234");
});
