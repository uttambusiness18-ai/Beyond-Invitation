const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const projectRoot = path.resolve(__dirname, "..");
const plain = (value) => JSON.parse(JSON.stringify(value));
function load(filename, dependencies, extras = {}) {
  const module = { exports: {} };
  const { outputText } = ts.transpileModule(readFileSync(path.join(projectRoot, filename), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  });
  vm.runInNewContext(outputText, {
    module, exports: module.exports, ...extras,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename });
  return module.exports;
}

function batchHarness({ legacy = false, failure = null } = {}) {
  const rows = ["b", "a"].map((slug) => ({
    id: slug, slug, name: slug, design_no: slug, price: 100, mrp: 150,
    description: "", tags: [], images: [], videos: [], updated_at: "2026-11-19T00:00:00Z",
  }));
  const state = { calls: [], legacyCalls: [], detailsCalls: [], priceCalls: 0, cacheDepth: 0, margin: 0 };
  const catalog = load("lib/catalog.ts", {
    "server-only": {},
    react: { cache: (callback) => callback },
    "next/cache": { unstable_cache(callback) {
      const values = new Map();
      return async (...args) => {
        const key = JSON.stringify(args);
        if (!values.has(key)) values.set(key, (async () => {
          state.cacheDepth++;
          try { return await callback(...args); } finally { state.cacheDepth--; }
        })());
        return values.get(key);
      };
    } },
    "isomorphic-dompurify": { sanitize: (value) => value },
    "@/lib/supabase/server": { getSupabaseServerClient() { return { from(table) {
      assert.equal(table, "v_web_products");
      let selected, limit;
      const query = {
        select() { return query; },
        in(column, values) { assert.equal(column, "slug"); selected = Array.from(values); return query; },
        limit(value) { limit = value; return query; },
        async returns() {
          state.legacyCalls.push({ selected, limit });
          return { data: rows.filter((row) => selected.includes(row.slug)).slice(0, limit), error: null };
        },
      };
      return query;
    } }; } },
    "@/lib/catalog-pricing": { async applyCatalogDetails(values) { state.detailsCalls.push(values); return values; } },
    "@/lib/product-page": { PRODUCTS_PER_PAGE: 24 },
    "@/lib/storefront-data": {
      async readStorefrontRows(query) {
        state.calls.push(plain(query));
        if (failure) throw failure;
        return legacy ? null : rows.filter((row) => query.slugs.includes(row.slug));
      },
      readStorefrontPage() { assert.fail("Curated slugs should use a single filtered row query"); },
    },
    "@/lib/reseller": {
      async applyResellerPricingToProducts(values) {
        assert.equal(state.cacheDepth, 0, "Visitor prices must remain outside the base product cache");
        state.priceCalls++;
        return values.map((value) => ({ ...value, price: value.price + state.margin }));
      },
      applyResellerPricingToProduct(value) { return value; },
    },
    "@/lib/similar-products": { selectSimilarProducts: () => [] },
  });
  return { catalog, state };
}

test("curated products use one batch, preserve requested order, and omit missing or duplicate slugs", async () => {
  const { catalog, state } = batchHarness();
  const products = await catalog.fetchErpProductsBySlugs([" a ", "missing", "b", "a", ""]);
  assert.deepEqual(Array.from(products, ({ slug }) => slug), ["a", "b"]);
  assert.deepEqual(state.calls, [{ slugs: ["a", "missing", "b"], limit: 3 }]);
  assert.equal(state.legacyCalls.length, 0);
  assert.equal(state.priceCalls, 1);
});

test("curated base products are cached while each visitor receives their own prices", async () => {
  const { catalog, state } = batchHarness();
  const first = await catalog.fetchErpProductsBySlugs(["a", "b"]);
  state.margin = 25;
  const second = await catalog.fetchErpProductsBySlugs(["a", "b"]);
  assert.deepEqual(Array.from(first, ({ price }) => price), [100, 100]);
  assert.deepEqual(Array.from(second, ({ price }) => price), [125, 125]);
  assert.equal(state.calls.length, 1);
  assert.equal(state.priceCalls, 2);
});

test("missing optimized schema uses one legacy batch with catalogue enrichment", async () => {
  const { catalog, state } = batchHarness({ legacy: true });
  const products = await catalog.fetchErpProductsBySlugs(["a", "b"]);
  assert.deepEqual(Array.from(products, ({ slug }) => slug), ["a", "b"]);
  assert.deepEqual(state.legacyCalls, [{ selected: ["a", "b"], limit: 2 }]);
  assert.equal(state.detailsCalls.length, 1);
  assert.equal(state.detailsCalls[0].length, 2);
});

test("empty curated lists make no requests and upstream failure does not invoke the legacy reader", async () => {
  const { catalog, state } = batchHarness({ failure: new Error("HTTP 522") });
  assert.equal((await catalog.fetchErpProductsBySlugs(["", "  "])).length, 0);
  assert.equal(state.calls.length, 0);
  await assert.rejects(catalog.fetchErpProductsBySlugs(["a"]), /HTTP 522/);
  assert.equal(state.calls.length, 1);
  assert.equal(state.legacyCalls.length, 0);
});

const product = (slug) => ({ slug, name: slug, price: 100, description: "", images: [`/${slug}.jpg`] });
async function homeView(failed = []) {
  const calls = [], warnings = [], metadata = [];
  const request = async (section, value) => {
    calls.push(section);
    if (failed.includes(section)) throw new Error("<!DOCTYPE html><title>522 upstream failure</title>");
    return value;
  };
  const Section = ({ title, products }) => React.createElement("section", { "data-collection": title }, products.map(({ slug }) => React.createElement("span", { key: slug }, slug)));
  const Component = load("components/home/HomeProducts.tsx", {
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@/lib/catalog": {
      fetchErpProductsBySlugs(slugs) { assert.equal(slugs.length, 8); return request("trendy", [product("trendy-card")]); },
      fetchErpProductPage(offset, pricedOnly) { assert.equal(offset, 0); assert.equal(pricedOnly, true); return request("sale", { products: [product("sale-card")], nextOffset: 24 }); },
    },
    "@/lib/catalog-item-category": { fetchItemCategoryProductPage(category) { assert.equal(category, "Wedding Box"); return request("premium", { products: [product("premium-box")], nextOffset: 24 }); } },
    "@/lib/catalog-errors": { catalogueErrorMessage: () => "Catalogue service temporarily unavailable (HTTP 522)." },
    "@/lib/product-page": { PRODUCTS_PER_PAGE: 24 },
    "@/lib/site-config": { getSiteUrl: () => "https://example.test" },
    "@/components/ProductGrid": { ProductSection: Section },
    "@/components/Sections": {
      FeatureStrip: () => React.createElement("div", { "data-feature-strip": true }),
      SaleCollection: (props) => React.createElement(Section, { ...props, title: "Sale Collection" }),
    },
    "@/components/seo/JsonLd": { __esModule: true, default: ({ data }) => { metadata.push(data); return null; } },
  }, { console: { warn: (...args) => warnings.push(args), error: () => assert.fail("Handled catalogue failures should not emit console errors") } }).default;
  return { html: renderToStaticMarkup(await Component({ description: "Invitations" })), calls, warnings, metadata };
}

test("homepage sends only three catalogue requests including the curated batch", async () => {
  const view = await homeView();
  assert.deepEqual(view.calls, ["premium", "sale", "trendy"]);
  assert.equal(view.warnings.length, 0);
  for (const slug of ["premium-box", "sale-card", "trendy-card"]) assert.match(view.html, new RegExp(slug));
  assert.equal(view.metadata[0].itemListElement.length, 3);
});

test("a failed homepage collection leaves successful collections and their metadata visible", async () => {
  for (const failed of ["premium", "sale", "trendy"]) {
    const view = await homeView([failed]);
    assert.equal((view.html.match(/role="status"/g) || []).length, 1);
    assert.match(view.html, /temporarily unavailable/);
    assert.match(view.html, /data-feature-strip/);
    assert.match(view.html, /href="\/"[^>]*>Try again/);
    assert.doesNotMatch(view.html, new RegExp(`${failed}-(card|box)`));
    assert.equal(view.metadata[0].itemListElement.length, 2);
    assert.equal(view.warnings.length, 1);
    assert.equal(view.warnings[0][1], "Catalogue service temporarily unavailable (HTTP 522).");
    assert.doesNotMatch(view.warnings.flat().join(" "), /DOCTYPE|<title>/);
  }
});

test("a complete outage renders one helpful retry state and keeps the feature strip", async () => {
  const view = await homeView(["premium", "sale", "trendy"]);
  assert.match(view.html, /Products could not be loaded/);
  assert.equal((view.html.match(/role="status"/g) || []).length, 1);
  assert.match(view.html, /data-feature-strip/);
  assert.match(view.html, />Try again</);
  assert.equal(view.metadata.length, 0);
  assert.equal(view.warnings.length, 3);
});
