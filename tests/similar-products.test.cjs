const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const slugs = (products) => Array.from(products, (product) => product.slug);

function load(filename, dependencies = {}) {
  const compiledModule = { exports: {} };
  const { outputText } = ts.transpileModule(
    readFileSync(path.join(projectRoot, filename), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename },
  );
  vm.runInNewContext(outputText, {
    module: compiledModule, exports: compiledModule.exports, URL, URLSearchParams,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename });
  return compiledModule.exports;
}

const wedding = load("lib/wedding-cards.ts");
const similar = load("lib/similar-products.ts", { "@/lib/wedding-cards": wedding });
const { selectSimilarProducts } = similar;

function product(slug, price = 100, subject = "Common", overrides = {}) {
  return {
    slug, catalogId: slug, name: "Wedding Invitation Card", price, mrp: price,
    subject, category: "wedding", itemCategory: "Wedding Card", images: [`/${slug}.jpg`],
    tags: [], ...overrides,
  };
}

test("closest price outranks exact subject and matching design", () => {
  const source = product("source", 100, "Hindu Wedding Card", { name: "Ivory Floral Gatefold" });
  const candidates = [
    product("farther-matching-design", 95, "Hindu Wedding Card", { name: "Ivory Floral Gatefold" }),
    product("closest-common", 99, "Common", { name: "Blue Paisley" }),
  ];
  assert.deepEqual(slugs(selectSimilarProducts(source, candidates)), ["closest-common", "farther-matching-design"]);
});

test("equal price distances prefer exact subject before design similarity", () => {
  const source = product("source", 100, "Muslim Wedding Card", { name: "Ivory Floral" });
  const candidates = [
    product("common-floral", 99, "Common", { name: "Ivory Floral" }),
    product("same-subject", 101, " Muslim Wedding Card ", { name: "Blue Paisley" }),
  ];
  assert.deepEqual(slugs(selectSimilarProducts(source, candidates)), ["same-subject", "common-floral"]);
});

test("design terms and meaningful tags break remaining price ties", () => {
  const source = product("source", 100, "Common", { name: "Elegant Ivory Floral Wedding Invitation Card", tags: ["Gatefold"] });
  const candidates = [
    product("a-unrelated", 100, "Common", { name: "Elegant Navy Paisley Wedding Invitation Card" }),
    product("z-similar", 100, "Common", { name: "Ivory Floral Card", tags: ["gatefold"] }),
  ];
  assert.deepEqual(slugs(selectSimilarProducts(source, candidates)), ["z-similar", "a-unrelated"]);
});

test("generic marketing words do not count as design similarity", () => {
  const source = product("source", 100, "Common", { name: "Elegant Royal Premium Wedding Invitation Card" });
  const candidates = [
    product("z-generic", 100, "Common", { name: "Elegant Royal Premium Wedding Invitation Card" }),
    product("a-design", 100, "Common", { name: "Floral Paisley" }),
  ];
  assert.deepEqual(slugs(selectSimilarProducts(source, candidates)), ["a-design", "z-generic"]);
});

test("price comparison uses paise so floating point noise does not decide ties", () => {
  const source = product("source", 100.1);
  assert.deepEqual(slugs(selectSimilarProducts(source, [
    product("z-lower", 100), product("a-upper", 100.2),
  ])), ["a-upper", "z-lower"]);
});

test("religious collections share Common cards without mixing specific subjects", () => {
  const candidates = [
    product("hindu", 100, "Hindu Wedding Card"),
    product("muslim", 100, "Muslim Wedding Card"),
    product("christian", 100, "Christian Wedding Card"),
    product("common", 100, " COMMON "),
    product("bengali", 100, "Bengali"),
  ];
  for (const [subject, expected] of [
    ["hindu wedding card", "hindu"], [" MUSLIM WEDDING CARD ", "muslim"], ["Christian Wedding Card", "christian"],
  ]) {
    assert.deepEqual(slugs(selectSimilarProducts(product("source", 100, subject), candidates)), [expected, "common"]);
  }
});

test("Hindu candidates require a positive price even for an unpriced source", () => {
  const candidates = [
    product("hindu-unpriced", 0, "Hindu Wedding Card"), product("common-unpriced", 0),
    product("hindu-priced", 250, "Hindu Wedding Card"), product("common-priced", 5),
  ];
  assert.deepEqual(slugs(selectSimilarProducts(product("source", 0, "Hindu Wedding Card"), candidates)), ["hindu-priced", "common-priced"]);
});

test("Common and Bengali products stay in their own subjects", () => {
  const candidates = [product("common", 100), product("bengali", 100, " Bengali "), product("hindu", 100, "Hindu Wedding Card")];
  assert.deepEqual(slugs(selectSimilarProducts(product("source", 100), candidates)), ["common"]);
  assert.deepEqual(slugs(selectSimilarProducts(product("source", 100, "Bengali"), candidates)), ["bengali"]);
});

test("boxes and envelopes cannot receive wedding cards through broad wedding category", () => {
  const box = product("box", 100, "Wedding Box", { itemCategory: "Wedding Box" });
  const envelope = product("envelope", 100, "Shagun Envelopes", { itemCategory: "Shagun Envelopes" });
  const candidates = [box, envelope, product("card", 100), product("rakhi", 100, "Rakhi")];
  assert.deepEqual(slugs(selectSimilarProducts({ ...box, slug: "source", catalogId: "source" }, candidates)), ["box"]);
  assert.deepEqual(slugs(selectSimilarProducts({ ...envelope, slug: "source", catalogId: "source" }, candidates)), ["envelope"]);
  assert.deepEqual(slugs(selectSimilarProducts(product("source", 100), candidates)), ["card"]);
});

test("other occasions match their own subject and ambiguous wedding items are conservative", () => {
  const candidates = [
    product("birthday", 100, " Birthday Card ", { category: "birthday" }),
    product("housewarming", 100, "Housewarming", { category: "housewarming" }),
    product("common", 100),
  ];
  assert.deepEqual(slugs(selectSimilarProducts(product("source", 100, "Birthday Card", { category: "birthday" }), candidates)), ["birthday"]);
  assert.deepEqual(slugs(selectSimilarProducts(product("source", 100, "", { itemCategory: undefined }), candidates)), []);
});

test("exclude the source, image-less entries, and repeated product identities", () => {
  const source = product("source", 100);
  const candidates = [
    source, product("source-alias", 100, "Common", { catalogId: source.catalogId }),
    product("empty-images", 100, "Common", { images: [] }),
    product("blank-images", 100, "Common", { images: ["", "   "] }),
    product("a-unique", 100), product("a-unique", 100),
    product("z-alias", 100, "Common", { catalogId: "a-unique" }),
  ];
  assert.deepEqual(slugs(selectSimilarProducts(source, candidates)), ["a-unique"]);
});

test("priced sources exclude missing or invalid prices and do not impose a price range cutoff", () => {
  const candidates = [0, -1, NaN, Infinity].map((price, index) => product(`invalid-${index}`, price));
  candidates.push(product("far-but-compatible", 10000));
  assert.deepEqual(slugs(selectSimilarProducts(product("source", 100), candidates)), ["far-but-compatible"]);
});

test("unpriced sources rank by subject then style without treating zero as a cheap price", () => {
  const source = product("source", 0, "Muslim Wedding Card", { name: "Ivory Floral" });
  const candidates = [
    product("common-matching", 0, "Common", { name: "Ivory Floral" }),
    product("same-unrelated", 1, "Muslim Wedding Card", { name: "Blue Paisley" }),
    product("same-matching", 1000, "Muslim Wedding Card", { name: "Ivory Floral" }),
  ];
  assert.deepEqual(slugs(selectSimilarProducts(source, candidates)), ["same-matching", "same-unrelated", "common-matching"]);
});

test("results are limited, deterministic, and do not mutate the catalogue", () => {
  const candidates = ["e", "c", "b", "a", "d"].map((slug) => Object.freeze(product(slug)));
  Object.freeze(candidates);
  const source = product("source");
  assert.deepEqual(slugs(selectSimilarProducts(source, candidates)), ["a", "b", "c", "d"]);
  assert.deepEqual(slugs(selectSimilarProducts(source, [...candidates].reverse(), 2)), ["a", "b"]);
  assert.deepEqual(slugs(candidates), ["e", "c", "b", "a", "d"]);
  for (const limit of [0, -1, 1.5, NaN, Infinity, 101]) {
    assert.deepEqual(slugs(selectSimilarProducts(source, candidates, limit)), []);
  }
});

function row(item) {
  return {
    id: item.catalogId, slug: item.slug, name: item.name, design_no: item.slug, item_code: item.slug,
    subject: item.subject, item_category: item.itemCategory, price: item.price, mrp: item.mrp,
    images: item.images, image_url: null, thumb_url: null, tags: item.tags, description: "",
    updated_at: "2026-11-19T00:00:00Z",
  };
}

function catalogHarness(items, optimized = true) {
  const rows = items.map(row);
  const state = { margin: 0, cacheDepth: 0, readCalls: [], pricingCalls: [], legacyCalls: 0 };
  function repriced(item) {
    return state.margin > 0 && item.price > 0
      ? { ...item, price: Math.round(item.price * (1 + state.margin / 100)), mrp: Math.round(item.mrp * (1 + state.margin / 100)) }
      : item;
  }
  const catalog = load("lib/catalog.ts", {
    "server-only": {},
    react: { cache: (read) => read },
    "next/cache": { unstable_cache(read) {
      const values = new Map();
      return async (...args) => {
        const key = JSON.stringify(args);
        if (!values.has(key)) values.set(key, (async () => {
          state.cacheDepth++;
          try { return await read(...args); } finally { state.cacheDepth--; }
        })());
        return values.get(key);
      };
    } },
    "isomorphic-dompurify": { sanitize: (value) => value },
    "@/lib/supabase/server": { getSupabaseServerClient() { return { from(table) {
      assert.equal(table, "v_web_products");
      state.legacyCalls++;
      let start = 0, end = rows.length - 1;
      const query = {
        select() { return query; }, order() { return query; },
        range(first, last) { start = first; end = last; return query; },
        async returns() { return { data: rows.slice(start, end + 1), error: null }; },
      };
      return query;
    } }; } },
    "@/lib/catalog-pricing": { applyCatalogDetails: async (values) => values },
    "@/lib/product-page": { PRODUCTS_PER_PAGE: 24 },
    "@/lib/storefront-data": {
      async readStorefrontRows(query) {
        state.readCalls.push({ ...query });
        return optimized ? rows.slice(query.offset ?? 0, (query.offset ?? 0) + query.limit) : null;
      },
      async readStorefrontPage() { assert.fail("Recommendations must rank the full eligible set, not a pre-limited browse page"); },
    },
    "@/lib/reseller": {
      async applyResellerPricingToProducts(values) {
        assert.equal(state.cacheDepth, 0, "Visitor prices must stay outside the shared catalogue cache");
        state.pricingCalls.push(Array.from(values, ({ price }) => price));
        return values.map(repriced);
      },
      async applyResellerPricingToProduct(value) { return value && repriced(value); },
    },
    "@/lib/similar-products": similar,
  });
  return { catalog, state };
}

test("catalogue integration ranks matches beyond the first fetched page", async () => {
  const items = Array.from({ length: 1000 }, (_, index) => product(`far-${String(index).padStart(4, "0")}`, 1000 + index));
  items.push(product("near-above", 101), product("near-below", 99));
  const { catalog, state } = catalogHarness(items);
  const result = await catalog.fetchRelatedErpProducts(product("source", 100));
  assert.deepEqual(slugs(result), ["near-above", "near-below", "far-0000", "far-0001"]);
  assert.deepEqual(state.readCalls.map(({ offset }) => offset), [0, 1000]);
  assert.equal(state.pricingCalls[0].length, 1002);
});

test("visitor prices are ranked after rounding and never contaminate the shared base cache", async () => {
  const items = [product("a-base-closer", 100.4), product("b-display-closer", 100.6)];
  const { catalog, state } = catalogHarness(items);
  const source = product("source", 100.49);
  assert.deepEqual(slugs(await catalog.fetchRelatedErpProducts(source)), ["a-base-closer", "b-display-closer"]);
  state.margin = 10;
  const markedUp = await catalog.fetchRelatedErpProducts({ ...source, price: 111 });
  assert.deepEqual(slugs(markedUp), ["b-display-closer", "a-base-closer"]);
  assert.deepEqual(Array.from(markedUp, ({ price }) => price), [111, 110]);
  state.margin = 0;
  const baseAgain = await catalog.fetchRelatedErpProducts(source);
  assert.deepEqual(Array.from(baseAgain, ({ price }) => price), [100.4, 100.6]);
  assert.equal(state.readCalls.length, 1, "Base catalogue should be shared across visitors");
  assert.deepEqual(state.pricingCalls, [[100.4, 100.6], [100.4, 100.6], [100.4, 100.6]]);
});

test("legacy catalogue reader uses the same category and price ranking", async () => {
  const items = [
    product("wrong-subject", 100, "Christian Wedding Card"),
    product("farther-muslim", 90, "Muslim Wedding Card"),
    product("near-common", 101), product("unpriced", 0, "Muslim Wedding Card"),
  ];
  const source = product("source", 100, "Muslim Wedding Card");
  const optimized = catalogHarness(items);
  const legacy = catalogHarness(items, false);
  assert.deepEqual(slugs(await optimized.catalog.fetchRelatedErpProducts(source)), ["near-common", "farther-muslim"]);
  assert.deepEqual(slugs(await legacy.catalog.fetchRelatedErpProducts(source)), ["near-common", "farther-muslim"]);
  assert.equal(legacy.state.legacyCalls, 1);
});

test("legacy detail enrichment retains item family and filters unpublished products without changing selling-price resolution", async () => {
  const pricing = load("lib/catalog-pricing.ts", {
    "server-only": {}, "@/lib/supabase/admin": { getSupabaseAdminClient() { assert.fail("Use the supplied test database"); } },
  });
  const tables = {
    items: [
      { id: "box", website_price_list_id: "selling", web_title: "Ivory Gift Box", print_name: "Floral", item_categories: { name: "Wedding Box" }, show_on_website: true, is_active: true },
      { id: "unpublished", website_price_list_id: "selling", show_on_website: false, is_active: true },
      { id: "inactive", website_price_list_id: "selling", show_on_website: true, is_active: false },
    ],
    price_list_transaction_items: [
      { id: "price", item_id: "box", price_list_id: "selling", website_price: 125, rate: 150,
        gst_pct: 18, discount_pct: 0, row_status: "Active", transaction_type: "Selling", is_active: true,
        effective_from: "2026-01-01", created_at: "2026-01-01T00:00:00Z" },
    ],
    price_lists: [{ id: "selling", code: "PL0001" }],
  };
  const db = { from(table) {
    assert.ok(Object.hasOwn(tables, table), `Unexpected table ${table}`);
    const predicates = [];
    let columns = "", first = 0, last = Infinity;
    function execute() {
      return { data: tables[table].filter((item) => predicates.every((matches) => matches(item)))
        .slice(first, last + 1).map((item) => {
          const value = { ...item };
          if (table === "items" && !columns.includes("item_categories(name)")) delete value.item_categories;
          return value;
        }), error: null };
    }
    const query = {
      select(value) { columns = value; return query; },
      in(key, values) { predicates.push((item) => values.includes(item[key])); return query; },
      eq(key, value) { predicates.push((item) => item[key] === value); return query; },
      or() { return query; }, order() { return query; },
      range(start, end) { first = start; last = end; return query; },
      async returns() { return execute(); },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
    };
    return query;
  } };
  const input = ["box", "unpublished", "inactive"].map((id) => ({ id, name: id, subject: "Common", price: 999, mrp: 999 }));
  const resolved = await pricing.applyCatalogDetails(input, db);
  assert.deepEqual(Array.from(resolved, ({ id }) => id), ["box"]);
  assert.equal(resolved[0].item_category, "Wedding Box");
  assert.equal(resolved[0].subject, "Common");
  assert.equal(resolved[0].price, 125);
  assert.equal(resolved[0].mrp, 150);
  assert.equal(resolved[0].name, "Ivory Gift Box");
  const { catalog } = catalogHarness([]);
  const mapped = catalog.mapCatalogRowToProduct({ ...row(product("box")), ...resolved[0] });
  assert.deepEqual(slugs(selectSimilarProducts(product("source", 125), [mapped])), []);
  assert.deepEqual(slugs(selectSimilarProducts(product("source", 125, "Wedding Box", { itemCategory: "Wedding Box" }), [mapped])), ["box"]);
});
