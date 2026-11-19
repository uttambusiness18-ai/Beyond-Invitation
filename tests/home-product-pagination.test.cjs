const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const plain = (value) => JSON.parse(JSON.stringify(value));

function load(filename, dependencies) {
  const module = { exports: {} };
  const { outputText } = ts.transpileModule(readFileSync(path.join(projectRoot, filename), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  });
  vm.runInNewContext(outputText, {
    module, exports: module.exports, URL, URLSearchParams, Request, Response,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename });
  return module.exports;
}

const { PRODUCTS_PER_PAGE } = load("lib/product-page.ts", {});
const row = (index, price = 100) => ({
  id: `id-${index}`, slug: `card-${String(index).padStart(2, "0")}`, item_code: `item-${index}`,
  design_no: String(index), name: `Card ${index}`, price, mrp: price + 10,
  description: "", images: [], videos: [], image_url: null, tags: [], subject: "Common",
  stock_status: "in-stock", updated_at: "2026-11-19T00:00:00Z", print_name: null,
});

function database(respond) {
  const queries = [];
  return {
    queries,
    from(table) {
      const query = { table, calls: [] };
      queries.push(query);
      const builder = {};
      for (const name of ["select", "eq", "order", "range", "in", "limit", "contains"]) {
        builder[name] = (...args) => { query.calls.push({ name, args: plain(args) }); return builder; };
      }
      builder.returns = async () => respond(query);
      return builder;
    },
  };
}

function catalogHarness({ optimized, rows = [], enrich = (items) => items, allowFullScan = false } = {}) {
  const rpcCalls = [], rowCalls = [], pricedBatches = [];
  const db = database((query) => {
    assert.equal(query.table, "v_web_products");
    const range = query.calls.find((call) => call.name === "range").args;
    return { data: rows.slice(range[0], range[1] + 1), error: null, count: rows.length };
  });
  const catalog = load("lib/catalog.ts", {
    "server-only": {},
    react: { cache: (callback) => callback },
    "next/cache": { unstable_cache: (callback) => callback },
    "isomorphic-dompurify": { sanitize: (value) => value },
    "@/lib/supabase/server": { getSupabaseServerClient: () => db },
    "@/lib/catalog-pricing": { applyCatalogDetails: async (items) => enrich(items) },
    "@/lib/product-page": { PRODUCTS_PER_PAGE },
    "@/lib/storefront-data": {
      readStorefrontPage: async (query) => { rpcCalls.push(plain(query)); return optimized ?? null; },
      readStorefrontRows: async (query) => {
        rowCalls.push(plain(query));
        assert.ok(allowFullScan, "An unfiltered page must not scan the complete catalogue");
        return null;
      },
    },
    "@/lib/similar-products": { selectSimilarProducts: () => [] },
    "@/lib/reseller": {
      applyResellerPricingToProducts: async (items) => {
        pricedBatches.push(plain(items));
        return items.map((product) => ({ ...product, price: product.price * 1.5 }));
      },
      applyResellerPricingToProduct: async (product) => product,
    },
  });
  return { catalog, db, rpcCalls, rowCalls, pricedBatches };
}

test("optimized homepage reads return exact totals and a ten-product cursor before visitor pricing", async () => {
  assert.equal(PRODUCTS_PER_PAGE, 10);
  const h = catalogHarness({ optimized: { products: Array.from({ length: 10 }, (_, index) => row(index + 10)), total: 27, nextOffset: 20 } });
  const result = await h.catalog.fetchErpProductPage(10, true);
  assert.deepEqual(h.rpcCalls, [{ p_offset: 10, p_limit: 10, p_priced_only: true }]);
  assert.equal(result.products.length, 10);
  assert.equal(result.total, 27);
  assert.equal(result.nextOffset, 20);
  assert.equal(result.products[0].price, 150);
  assert.equal(h.pricedBatches[0][0].price, 100, "Only base prices enter the cached page reader");
  assert.equal(h.db.queries.length, 0);
  assert.equal(h.rowCalls.length, 0);
});

test("legacy unfiltered pages request an exact count and only the requested ten source rows", async () => {
  const h = catalogHarness({ rows: Array.from({ length: 25 }, (_, index) => row(index)) });
  const second = await h.catalog.fetchErpProductPage(10);
  assert.equal(second.total, 25);
  assert.equal(second.products.length, 10);
  assert.equal(second.products[0].slug, "card-10");
  assert.equal(second.nextOffset, 20);
  assert.equal(h.db.queries.length, 1);
  assert.deepEqual(h.db.queries[0].calls.find((call) => call.name === "select").args, ["*", { count: "exact" }]);
  assert.deepEqual(h.db.queries[0].calls.find((call) => call.name === "range").args, [10, 19]);
  assert.equal(h.rowCalls.length, 0);

  const last = await h.catalog.fetchErpProductPage(20);
  assert.equal(last.total, 25);
  assert.equal(last.products.length, 5);
  assert.equal(last.nextOffset, null);
  assert.deepEqual(h.db.queries[1].calls.find((call) => call.name === "range").args, [20, 29]);
});

test("legacy sale totals count positive resolved Selling prices before slicing the page", async () => {
  const h = catalogHarness({
    rows: Array.from({ length: 25 }, (_, index) => row(index, 0)),
    allowFullScan: true,
    enrich: (items) => items.map((item) => ({ ...item, price: Number(item.design_no) % 3 ? 100 : 0 })),
  });
  const result = await h.catalog.fetchErpProductPage(10, true);
  assert.equal(result.total, 16);
  assert.equal(result.products.length, 6);
  assert.equal(result.nextOffset, null);
  assert.ok(result.products.every((product) => product.price === 150));
  assert.equal(h.pricedBatches[0].length, 6, "Only this page receives visitor pricing");
  assert.deepEqual(h.rpcCalls, [{ p_offset: 10, p_limit: 10, p_priced_only: true }]);
  assert.equal(h.rowCalls.length, 1);
});

function categoryHarness({ optimized, rows = [] } = {}) {
  const rpcCalls = [], pricedBatches = [];
  const admin = database(() => ({ data: rows.map((item) => ({ id: item.id, item_categories: { name: "Wedding Box" } })), error: null }));
  const publicDb = database(() => ({ data: rows, error: null }));
  const map = (item) => ({ slug: item.slug, catalogId: item.id, price: item.price });
  const category = load("lib/catalog-item-category.ts", {
    "server-only": {},
    "next/cache": { unstable_cache: (callback) => callback },
    "@/lib/supabase/admin": { getSupabaseAdminClient: () => admin },
    "@/lib/supabase/server": { getSupabaseServerClient: () => publicDb },
    "@/lib/catalog": {
      buildErpProductList: async () => { throw new Error("Unexpected full catalogue read"); },
      compareWeddingCardProducts: (a, b) => a.slug.localeCompare(b.slug),
      isWeddingCardProduct: () => true,
      mapCatalogRowToProduct: map,
      resolveCatalogProducts: async (items) => items.filter((item) => !item.unpublished).map(map),
    },
    "@/lib/reseller": { applyResellerPricingToProducts: async (items) => {
      pricedBatches.push(plain(items));
      return items.map((item) => ({ ...item, price: item.price * 1.5 }));
    } },
    "@/lib/product-page": { PRODUCTS_PER_PAGE },
    "@/lib/storefront-data": { readStorefrontPage: async (query) => { rpcCalls.push(plain(query)); return optimized ?? null; } },
  });
  return { category, rpcCalls, pricedBatches, admin, publicDb };
}

test("optimized category pages retain total and cursor, including empty categories", async () => {
  const h = categoryHarness({ optimized: { products: Array.from({ length: 10 }, (_, index) => row(index + 10)), total: 31, nextOffset: 20 } });
  const result = await h.category.fetchItemCategoryProductPage(" Wedding Box ", 10);
  assert.deepEqual(h.rpcCalls, [{ p_item_category: "Wedding Box", p_offset: 10, p_limit: 10, p_sort: "recommended" }]);
  assert.equal(result.total, 31);
  assert.equal(result.nextOffset, 20);
  assert.equal(result.products.length, 10);
  assert.equal(result.products[0].price, 150);
  assert.equal(h.admin.queries.length, 0);
  assert.equal(h.publicDb.queries.length, 0);

  const empty = categoryHarness({ optimized: { products: [], total: 0, nextOffset: null } });
  assert.deepEqual(plain(await empty.category.fetchItemCategoryProductPage("Wedding Box")), { products: [], total: 0, nextOffset: null });
  assert.deepEqual(plain(await empty.category.fetchItemCategoryProductPage("  ")), { products: [], total: 0, nextOffset: null });
  assert.equal(empty.rpcCalls.length, 1, "A blank category does not issue a database query");
  assert.equal(empty.admin.queries.length, 0, "A valid empty optimized page must not trigger fallback");
});

test("legacy category totals reflect resolved published products before pagination", async () => {
  const rows = Array.from({ length: 17 }, (_, index) => ({ ...row(index), unpublished: index >= 15 }));
  const h = categoryHarness({ rows });
  const first = await h.category.fetchItemCategoryProductPage("Wedding Box");
  assert.equal(first.total, 15);
  assert.equal(first.products.length, 10);
  assert.equal(first.nextOffset, 10);
  const last = await h.category.fetchItemCategoryProductPage("Wedding Box", 10);
  assert.equal(last.total, 15);
  assert.equal(last.products.length, 5);
  assert.equal(last.nextOffset, null);
  assert.equal(last.products[0].slug, "card-10");
  assert.equal(h.pricedBatches.at(-1).length, 5);
  assert.deepEqual(h.publicDb.queries[0].calls.find((call) => call.name === "in").args, ["id", rows.map((item) => item.id)]);
});

test("homepage API includes the exact total for sale and wedding-box page requests", async () => {
  const calls = [];
  const api = load("app/api/catalog/products/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/product-page": { PRODUCTS_PER_PAGE },
    "@/lib/catalog": { fetchErpProductPage: async (...args) => { calls.push(["sale", ...args]); return { products: [], total: 23, nextOffset: 20 }; } },
    "@/lib/catalog-item-category": { fetchItemCategoryProductPage: async (...args) => { calls.push(["boxes", ...args]); return { products: [], total: 25, nextOffset: null }; } },
  });
  const sale = await api.GET(new Request("https://example.test/api/catalog/products?offset=10&pricedOnly=true"));
  assert.equal((await sale.json()).total, 23);
  assert.equal(sale.headers.get("Cache-Control"), "private, no-store");
  const boxes = await api.GET(new Request("https://example.test/api/catalog/products?offset=20&collection=wedding-boxes"));
  assert.equal((await boxes.json()).total, 25);
  assert.deepEqual(calls, [["sale", 10, true], ["boxes", "Wedding Box", 20]]);
});
