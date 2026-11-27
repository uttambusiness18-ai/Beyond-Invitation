const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function product(index, subject = "Common") {
  return {
    id: String(index).padStart(5, "0"), item_code: `ITEM-${index}`, design_no: `DESIGN-${index}`,
    slug: `design-${index}`, name: `Invitation with matching envelope ${index}`, print_name: "",
    subject, subject_key: (subject ?? "").trim().toLowerCase(), item_category: "Wedding Card",
    description: "Wedding invitation with a matching envelope.", price: 10, mrp: 15,
    images: [], videos: [], tags: [], image_url: null, updated_at: "2026-11-24T00:00:00Z",
  };
}

const hiddenSubjects = ["Shagun Envelopes", " SAGUN ENVELOPES ", "shagun envelope", "Sagun Envelope"];
const fixture = () => [
  ...hiddenSubjects.map((subject, index) => product(index, subject)),
  ...Array.from({ length: 27 }, (_, index) => product(index + 10, index === 0 ? null : "Common")),
];

// Execute production readers with an in-memory public catalogue. No live data
// or writes: filtering and ranges run in database order before responses return.
function harness({ rows = fixture(), legacy = false, enabled, readResponse, enrichmentError } = {}) {
  assert.equal(typeof enabled, "boolean", "Each test must choose the collection visibility policy");
  const modules = new Map();
  const requests = [];
  const rpcCalls = [];
  const memo = fn => {
    const cached = new Map();
    return (...args) => {
      const key = JSON.stringify(args);
      if (!cached.has(key)) cached.set(key, fn(...args));
      return cached.get(key);
    };
  };
  const client = {
    from(table) {
      const query = { table, filters: [], columns: "*", start: 0, end: Infinity };
      requests.push(query);
      const builder = {
        select(columns) { query.columns = columns; return this; },
        eq(column, value) { query.filters.push(row => row[column] === value); return this; },
        in(column, values) { query.filters.push(row => values.includes(row[column])); return this; },
        not(column, operator, value) {
          assert.equal(operator, "in");
          const excluded = JSON.parse(`[${value.slice(1, -1)}]`);
          query.filters.push(row => !excluded.includes(row[column]));
          return this;
        },
        order() { return this; },
        range(start, end) { query.start = start; query.end = end; return this; },
        limit(limit) { query.end = query.start + limit - 1; return this; },
        returns() { return this; },
        then(resolve, reject) {
          if (legacy && table === "v_storefront_products") {
            return Promise.resolve({ data: null, error: { code: "42P01", message: "v_storefront_products does not exist" } }).then(resolve, reject);
          }
          if (readResponse) {
            return Promise.resolve().then(() => readResponse(query)).then(resolve, reject);
          }
          const filtered = rows.filter(row => query.filters.every(filter => filter(row)));
          const data = filtered.slice(query.start, query.end + 1).map(row => query.columns === "subject_key"
            ? { subject_key: row.subject_key } : row);
          return Promise.resolve({ data, count: filtered.length, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name, query) {
      assert.equal(name, "storefront_product_page");
      rpcCalls.push(query);
      if (legacy) return { data: null, error: { code: "PGRST202", message: "storefront_product_page does not exist" } };
      const filtered = rows.filter(row => query.p_subjects === undefined || query.p_subjects.includes(row.subject_key));
      const offset = query.p_offset ?? 0;
      const end = offset + (query.p_limit ?? 24);
      return { error: null, data: {
        products: filtered.slice(offset, end), total: filtered.length,
        nextOffset: end < filtered.length ? end : null,
        facets: query.p_include_facets ? { total: filtered.length, types: {}, prices: {} } : null,
      } };
    },
  };
  const mocks = {
    "server-only": {},
    react: { cache: memo },
    "next/cache": { unstable_cache: memo },
    "isomorphic-dompurify": { sanitize: value => value },
    "@/lib/supabase/server": { getSupabaseServerClient: () => client },
    "@/lib/catalog-titles": { applyCatalogPrintNames: async rows => {
      if (enrichmentError) throw enrichmentError;
      return rows;
    } },
    "@/lib/catalog-pricing": { applyCatalogDetails: async rows => {
      if (enrichmentError) throw enrichmentError;
      return rows;
    } },
    "@/lib/reseller": {
      applyResellerPricingToProducts: async rows => rows,
      applyResellerPricingToProduct: async row => row,
      applyMarginToPrice: (value, margin) => Math.round(value * (1 + margin / 100)),
    },
  };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const filename = path.resolve(__dirname, "..", relative);
    const loaded = { exports: {} };
    let source = readFileSync(filename, "utf8");
    if (relative === "lib/storefront-availability.ts") {
      // Exercise the actual policy for either state, independent of its current
      // storefront default; do not replace the predicate with a test duplicate.
      const flag = /(export const SHAGUN_ENVELOPES_ENABLED\s*=\s*)(?:true|false)(;)/;
      assert.match(source, flag, "The production visibility flag must be available to configure");
      source = source.replace(flag, (_match, prefix, suffix) => `${prefix}${enabled}${suffix}`);
    }
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    new Function("require", "module", "exports", "console", compiled)(name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      return name.startsWith("@/") ? load(`${name.slice(2)}.ts`) : require(name);
    }, loaded, loaded.exports, { warn() {}, error() {} });
    modules.set(relative, loaded.exports);
    return loaded.exports;
  }
  return { load, requests, rpcCalls };
}

test("optimized pages exclude paused subjects before pagination, counts and facets", async () => {
  const h = harness({ enabled: false });
  const { readStorefrontPage } = h.load("lib/storefront-data.ts");
  const first = await readStorefrontPage({ p_offset: 0, p_limit: 24, p_include_facets: true });
  const second = await readStorefrontPage({ p_offset: 24, p_limit: 24 });
  assert.equal(first.total, 27);
  assert.equal(first.products.length, 24);
  assert.equal(first.nextOffset, 24);
  assert.equal(first.facets.total, 27);
  assert.equal(second.products.length, 3);
  assert.equal(second.nextOffset, null);
  assert.equal(new Set([...first.products, ...second.products].map(row => row.id)).size, 27);
  assert.deepEqual(h.rpcCalls[0].p_subjects, ["", "common"]);
  assert.equal(h.requests.filter(request => request.columns === "subject_key").length, 1);
});

test("explicit hidden scopes return empty results while mixed scopes retain visible subjects", async () => {
  const h = harness({ enabled: false });
  const { readStorefrontPage } = h.load("lib/storefront-data.ts");
  const hidden = await readStorefrontPage({ p_subjects: ["shagun envelopes"] });
  assert.equal(hidden.total, 0);
  assert.deepEqual(h.rpcCalls[0].p_subjects, []);
  const mixed = await readStorefrontPage({ p_subjects: ["shagun envelopes", "common"] });
  assert.equal(mixed.total, 26);
  assert.deepEqual(h.rpcCalls[1].p_subjects, ["common"]);
});

for (const legacy of [false, true]) {
  test(`${legacy ? "legacy" : "optimized"} catalogue hides direct/curated products and rejects old cart entries`, async () => {
    const h = harness({ legacy, enabled: false });
    const catalog = h.load("lib/catalog.ts");
    assert.equal(await catalog.fetchErpProductBySlug("design-0"), null);
    assert.equal(await catalog.fetchErpProductImages("design-0"), null);
    const curated = await catalog.fetchErpProductsBySlugs(["design-0", "design-10", "design-3"]);
    assert.deepEqual(curated.map(row => row.slug), ["design-10"]);
    assert.equal((await catalog.fetchErpProductsBase()).length, 27);
    const page = await catalog.fetchErpProductPage(24);
    assert.equal(page.total, 27);
    assert.equal(page.products.length, 3);
    assert.equal(page.nextOffset, null);
    const { resolveCartProducts } = h.load("lib/checkout.ts");
    await assert.rejects(resolveCartProducts([{ slug: "design-0", quantity: 50 }]), /no longer available/);
    const allowed = await resolveCartProducts([{ slug: "design-10", quantity: 50 }]);
    assert.equal(allowed.lines.length, 1);
    assert.equal(allowed.amountPaise, 50000);
  });
}

test("optimized full reads continue past a full visible batch without dropping later products", async () => {
  const rows = [product(0, "Shagun Envelopes"), ...Array.from({ length: 1001 }, (_, i) => product(i + 1))];
  const h = harness({ rows, enabled: false });
  const products = await h.load("lib/catalog.ts").fetchErpProductsBase();
  assert.equal(products.length, 1001);
  assert.equal(products.at(-1).slug, "design-1001");
  assert.deepEqual(h.requests.map(query => query.start), [0, 1000]);
});

test("enabling the collection restores all catalogue paths without data changes", async () => {
  const h = harness({ enabled: true });
  const catalog = h.load("lib/catalog.ts");
  assert.ok(await catalog.fetchErpProductBySlug("design-0"));
  assert.equal((await catalog.fetchErpProductsBase()).length, 31);
  assert.equal((await catalog.fetchErpProductPage()).total, 31);
  assert.equal(h.rpcCalls[0].p_subjects, undefined);
  assert.equal(h.requests.some(request => request.columns === "subject_key"), false);
});

for (const legacy of [false, true]) {
  const reader = legacy ? "legacy" : "optimized";

  test(`${reader} slug lookup distinguishes hyphenated codes and returns null only for missing products`, async () => {
    const current = { ...product(1), slug: "g22201", design_no: "G22201" };
    const h = harness({ legacy, enabled: true, rows: [current] });
    const catalog = h.load("lib/catalog.ts");
    assert.equal((await catalog.fetchErpProductBySlug("g22201")).itemCode, "G22201");
    assert.equal(await catalog.fetchErpProductBySlug("g222-01"), null);

    const other = { ...product(2), slug: "g222-01", design_no: "G222-01" };
    const both = harness({ legacy, enabled: true, rows: [current, other] }).load("lib/catalog.ts");
    assert.equal((await both.fetchErpProductBySlug("g222-01")).catalogId, other.id);
    assert.equal((await both.fetchErpProductBySlug("g22201")).catalogId, current.id);
  });

  for (const error of [
    { code: "CATALOGUE_TIMEOUT", message: "Catalogue request timed out" },
    { code: "42501", message: "permission denied for v_storefront_products" },
    { code: "PGRST000", message: "Database connection unavailable" },
  ]) {
    test(`${reader} slug lookup propagates ${error.code} instead of returning not found or falling back`, async () => {
      const h = harness({ legacy, enabled: true, readResponse: () => ({ data: null, error }) });
      await assert.rejects(h.load("lib/catalog.ts").fetchErpProductBySlug("g22201"), {
        message: `Product catalogue unavailable: ${error.message}`,
      });
      assert.deepEqual(h.requests.map(request => request.table), legacy
        ? ["v_storefront_products", "v_web_products"] : ["v_storefront_products"]);
    });
  }

  for (const data of [null, {}, "upstream failure"]) {
    test(`${reader} slug lookup rejects malformed successful response ${JSON.stringify(data)}`, async () => {
      const h = harness({ legacy, enabled: true, readResponse: () => ({ data, error: null }) });
      await assert.rejects(h.load("lib/catalog.ts").fetchErpProductBySlug("g22201"), /invalid product list/);
    });
  }

  test(`${reader} slug lookup propagates network and product enrichment failures`, async () => {
    const network = new Error("fetch failed");
    const h = harness({ legacy, enabled: true, readResponse: () => { throw network; } });
    await assert.rejects(h.load("lib/catalog.ts").fetchErpProductBySlug("design-10"), error => error === network);

    const enrichmentError = new Error("Product prices or titles unavailable");
    const enriched = harness({ legacy, enabled: true, enrichmentError });
    await assert.rejects(enriched.load("lib/catalog.ts").fetchErpProductBySlug("design-10"), error => error === enrichmentError);
  });
}
