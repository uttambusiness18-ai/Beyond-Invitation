const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const plain = (value) => JSON.parse(JSON.stringify(value));

function load(filename, dependencies = {}) {
  const module = { exports: {} };
  const { outputText } = ts.transpileModule(
    readFileSync(path.join(projectRoot, filename), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename },
  );
  vm.runInNewContext(outputText, {
    module, exports: module.exports, URL, URLSearchParams,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename });
  return module.exports;
}

const filters = load("lib/wedding-cards.ts");
const options = load("lib/catalog-browse-options.ts");
const selection = (type = "all", price = "any", sort = "recommended") => ({ type, price, sort });

function product(slug, subject, price, itemCategory = "Wedding Card") {
  return {
    slug, subject, price, itemCategory, name: slug, designNo: slug, itemCode: slug,
    mrp: price, image: "", images: [], imageCount: 0, itemGroup: "", hasPrice: price > 0,
    minOrderQty: null, updatedAt: "2026-11-19T00:00:00Z",
  };
}

// Deliberately mismatched ordinary Item Categories distinguish subject membership
// from the old category mapping and catch Muslim/Christian returning the same set.
const products = [
  product("hindu", " Hindu Wedding Card ", 20),
  product("hindu-unpriced", "Hindu Wedding Card", 0, "Hindu Wedding Card"),
  product("common", " COMMON ", 35, "Other"),
  product("common-unpriced", "Common", 0),
  product("muslim", "Muslim Wedding Card", 50, "Hindu Wedding Card"),
  product("muslim-unpriced", "Muslim Wedding Card", 0),
  product("christian", "Christian Wedding Card", 100),
  product("christian-unpriced", "Christian Wedding Card", 0),
  product("bengali", " Bengali ", 150),
  product("bengali-unpriced", "Bengali", 0),
  product("general", "Wedding Card", 10, "Hindu Wedding Card"),
  product("blank", "", 0),
];
const slugs = (items) => Array.from(items, (item) => item.slug);

test("Hindu matches its subject and Common only when a positive price exists", () => {
  assert.deepEqual(slugs(filters.applyWeddingFilters(products, selection("hindu"))), ["hindu", "common"]);
  const invalidPrices = [0, -1, NaN, Infinity].map((price, index) => product(`invalid-${index}`, "Common", price));
  assert.deepEqual(slugs(filters.applyWeddingFilters(invalidPrices, selection("hindu"))), []);
});

test("Muslim and Christian have distinct subjects while sharing Common cards", () => {
  assert.deepEqual(slugs(filters.applyWeddingFilters(products, selection("muslim"))), [
    "common", "common-unpriced", "muslim", "muslim-unpriced",
  ]);
  assert.deepEqual(slugs(filters.applyWeddingFilters(products, selection("christian"))), [
    "common", "common-unpriced", "christian", "christian-unpriced",
  ]);
});

test("Bengali excludes Common and All preserves the supplied collection", () => {
  assert.deepEqual(slugs(filters.applyWeddingFilters(products, selection("bengali"))), ["bengali", "bengali-unpriced"]);
  assert.deepEqual(slugs(filters.applyWeddingFilters(products, selection())), slugs(products));
});

test("category and price filters intersect, including the 100 rupee boundary", () => {
  assert.deepEqual(slugs(filters.applyWeddingFilters(products, selection("christian", "50-100"))), ["christian"]);
  assert.deepEqual(slugs(filters.applyWeddingFilters(products, selection("muslim", "25-50"))), ["common"]);
  assert.deepEqual(slugs(filters.applyWeddingFilters(products, selection("bengali", "above-100"))), ["bengali"]);
  assert.deepEqual(slugs(filters.applyWeddingFilters(products, selection("muslim", "on-request"))), [
    "common-unpriced", "muslim-unpriced",
  ]);
});

test("category counts use the same membership rules including priced Common for Hindu", () => {
  const facets = filters.facetCounts(products);
  assert.equal(facets.total, 12);
  assert.equal(facets.categoryTotal, 12);
  assert.deepEqual(Object.fromEntries(facets.types.map(({ value, count }) => [value, count])), {
    hindu: 2, muslim: 4, christian: 4, bengali: 2,
  });
});

test("Bengali category survives URL serialization, reload, and search-param arrays", () => {
  const expected = selection("bengali", "above-100", "price-desc");
  const query = filters.serializeWeddingFilters(expected);
  assert.deepEqual(plain(filters.parseWeddingFilters(new URLSearchParams(query))), expected);
  assert.deepEqual(plain(filters.weddingFiltersFromSearchParams({ type: ["bengali", "muslim"], price: "above-100", sort: "price-desc" })), expected);
  assert.deepEqual(plain(filters.parseWeddingFilters(new URLSearchParams("type=invalid&price=invalid&sort=invalid"))), selection());
});

test("dedicated collections ignore category query overrides and retain valid price and sort", () => {
  for (const collection of ["hindu", "muslim", "christian", "bengali", "boxes"]) {
    assert.deepEqual(plain(filters.normalizeWeddingCollectionFilters(selection("christian", "50-100", "newest"), collection)), selection("all", "50-100", "newest"));
  }
  assert.deepEqual(plain(filters.normalizeWeddingCollectionFilters(selection("muslim", "on-request"), "hindu")), selection());
  assert.deepEqual(plain(filters.normalizeWeddingCollectionFilters(selection("hindu", "on-request"), "muslim")), selection("all", "on-request"));
  assert.deepEqual(plain(filters.normalizeWeddingCollectionFilters(selection("hindu", "on-request"))), selection("hindu"));
});

function browseHarness(source = products, rpc = async () => null) {
  const queries = [];
  const browse = load("lib/catalog-browse.ts", {
    "server-only": {},
    "next/cache": { unstable_cache: (read) => read },
    "@/types": { discountPercent: () => 0 },
    "@/lib/wedding-cards": filters,
    "@/lib/catalog-browse-options": options,
    "@/lib/catalog": {
      fetchErpProductsBase: async () => source,
      mapCatalogRowToProduct: (row) => row,
      compareWeddingCardProducts: (a, b) => a.slug.localeCompare(b.slug),
      isWeddingCardProduct: () => true,
    },
    "@/lib/catalog-item-category": {
      fetchWeddingCardsWithCategoriesBase: async () => source,
      fetchProductsByItemCategoryBase: async (category) => source.filter((item) => item.itemCategory === category),
    },
    "@/lib/storefront-data": { readStorefrontPage: async (query) => { queries.push(plain(query)); return rpc(query); } },
    "@/lib/reseller": {
      getActiveResellerFromCookies: async () => null,
      applyMarginToPrice: (price) => price,
      repriceProduct: (item) => item,
    },
  });
  return { ...browse, queries };
}

test("fallback results for each category match its dedicated collection", async () => {
  const browse = browseHarness();
  for (const type of ["hindu", "muslim", "christian", "bengali"]) {
    for (const price of ["any", "50-100"]) {
      const category = await browse.fetchWeddingProductPage({ filters: selection(type, price, "price-asc") });
      const dedicated = await browse.fetchWeddingProductPage({ collectionType: type, filters: selection("all", price, "price-asc") });
      assert.deepEqual(slugs(category.products).sort(), slugs(dedicated.products).sort(), `${type}, ${price}`);
      assert.equal(category.total, dedicated.total, `${type}, ${price}`);
    }
  }
});

test("fallback category filtering runs before pagination and totals cover all matches", async () => {
  const source = [
    ...Array.from({ length: 30 }, (_, i) => product(`christian-${i}`, "Christian Wedding Card", 20)),
    ...Array.from({ length: 30 }, (_, i) => product(`muslim-${i}`, "Muslim Wedding Card", 30)),
  ];
  const browse = browseHarness(source);
  const first = await browse.fetchWeddingProductPage({ filters: selection("muslim") });
  const second = await browse.fetchWeddingProductPage({ filters: selection("muslim"), offset: first.nextOffset });
  assert.equal(first.total, 30);
  assert.equal(first.products.length, 24);
  assert.equal(first.nextOffset, 24);
  assert.equal(second.products.length, 6);
  assert.equal(second.nextOffset, null);
  const result = [...first.products, ...second.products];
  assert.equal(new Set(result.map((item) => item.slug)).size, 30);
  assert.ok(result.every((item) => item.subject === "Muslim Wedding Card"));
});

test("category totals stay global while price counts follow the selected category", async () => {
  const browse = browseHarness();
  const hindu = await browse.fetchWeddingProductPage({ filters: selection("hindu", "under-25") });
  assert.equal(hindu.total, 1);
  assert.equal(hindu.facets.total, 2);
  assert.equal(hindu.facets.categoryTotal, 12);
  assert.deepEqual(Object.fromEntries(hindu.facets.types.map(({ value, count }) => [value, count])), {
    hindu: 2, muslim: 4, christian: 4, bengali: 2,
  });
  assert.deepEqual(Object.fromEntries(hindu.facets.prices.map(({ value, count }) => [value, count])), {
    "under-25": 1, "25-50": 1,
  });
  const muslim = await browse.fetchWeddingProductPage({ filters: selection("muslim", "on-request") });
  assert.equal(muslim.total, 2);
  assert.equal(muslim.facets.total, 4);
  assert.equal(muslim.facets.categoryTotal, 12);
  assert.deepEqual(Object.fromEntries(muslim.facets.prices.map(({ value, count }) => [value, count])), {
    "25-50": 1, "50-100": 1, "on-request": 2,
  });
});

test("optimized catalogue requests use the dedicated page subject and pricing rules", async () => {
  const rules = {
    hindu: { subjects: ["hindu wedding card", "common"], priced: true, total: 2 },
    muslim: { subjects: ["muslim wedding card", "common"], priced: false, total: 4 },
    christian: { subjects: ["christian wedding card", "common"], priced: false, total: 4 },
    bengali: { subjects: ["bengali"], priced: false, total: 2 },
  };
  const rpc = async (query) => {
    const type = Object.values(rules).find((rule) => query.p_subjects?.[0] === rule.subjects[0]);
    return {
      products: [], nextOffset: null, total: type?.total ?? 12,
      // The RPC's old Item Category counts are deliberately wrong. The UI must
      // receive the separate subject-based query totals instead.
      facets: { total: type ? 4 : 12, types: { hindu: 99, muslim: 99, christian: 99 }, prices: { "on-request": 2, "under-25": 1, "25-50": 1 } },
    };
  };
  for (const [type, rule] of Object.entries(rules)) {
    const browse = browseHarness(products, rpc);
    const result = await browse.fetchWeddingProductPage({ filters: selection(type) });
    const main = browse.queries.find((query) => query.p_limit === 24);
    assert.deepEqual(main.p_subjects, rule.subjects);
    assert.equal(Boolean(main.p_priced_only), rule.priced);
    assert.equal(main.p_filter_item_category, undefined);
    assert.equal(result.facets.categoryTotal, 12);
    assert.deepEqual(Object.fromEntries(result.facets.types.map(({ value, count }) => [value, count])), {
      hindu: 2, muslim: 4, christian: 4, bengali: 2,
    });
    if (type === "hindu") {
      assert.equal(result.facets.total, 2);
      assert.ok(result.facets.prices.every((price) => price.value !== "on-request"));
    }
    const dedicated = browseHarness(products, rpc);
    await dedicated.fetchWeddingProductPage({ collectionType: type, filters: selection() });
    assert.deepEqual(dedicated.queries[0].p_subjects, main.p_subjects);
    assert.equal(Boolean(dedicated.queries[0].p_priced_only), Boolean(main.p_priced_only));
  }
});

test("browse API accepts Bengali categories and rejects unknown category values", async () => {
  const calls = [];
  const api = load("app/api/catalog/browse/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/catalog-browse-options": options,
    "@/lib/wedding-cards": filters,
    "@/lib/catalog-browse": {
      fetchWeddingProductPage: async (request) => { calls.push(plain(request)); return { products: [], total: 0 }; },
      fetchCatalogProductPage: async () => { throw new Error("Unexpected generic catalogue request"); },
    },
  });
  const valid = await api.GET(new Request("http://localhost/api/catalog/browse?mode=wedding&type=bengali&price=above-100"));
  assert.equal(valid.status, 200);
  assert.equal(calls[0].filters.type, "bengali");
  assert.equal(calls[0].filters.price, "above-100");
  const invalid = await api.GET(new Request("http://localhost/api/catalog/browse?mode=wedding&type=unknown"));
  assert.equal(invalid.status, 400);
  assert.equal(calls.length, 1);
});
