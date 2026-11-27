const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { cache } = require("./helpers/react-cache.cjs");

const ORIGIN = "https://example.test";
const SUBJECTS = ["Wedding Card", "Hindu Wedding Card", "Muslim Wedding Card", "Christian Wedding Card"];
const routeCases = [
  { file: "app/catalog/page.tsx", pathname: "/catalog", scope: {} },
  { file: "app/collections/[category]/page.tsx", pathname: "/collections/wedding", scope: { category: "wedding" } },
  { file: "app/collections/wedding-card/page.tsx", pathname: "/collections/wedding-card", scope: { subjects: SUBJECTS } },
];

function harness({ total = 60, failure, failOffset } = {}) {
  const modules = new Map();
  const requests = [];
  const products = Array.from({ length: total }, (_, index) => ({
    slug: `wedding-card-${index + 1}`, name: `Wedding Card ${index + 1}`,
    description: "Printed wedding invitation", images: [`/products/card-${index + 1}.jpg`], price: 50,
  }));
  const mocks = {
    "server-only": {},
    react: { ...require("react"), cache },
    "next/link": { __esModule: true, default: () => null },
    "next/navigation": { notFound() { throw new Error("Unexpected notFound"); } },
    "@/lib/catalog": {},
    "@/lib/reseller": {},
    "@/lib/site-config": {
      getSiteUrl: () => ORIGIN,
      siteUrl: (pathname = "") => `${ORIGIN}${pathname}`,
      PRIMARY_KEYWORDS: [], SITE_NAME: "Beyond Invitation", DEFAULT_OG_IMAGE: "/logo.png",
    },
    "@/lib/catalog-browse": { fetchCatalogProductPage: async options => {
      requests.push(options);
      if (failure && (failOffset === undefined || options.offset === failOffset)) throw failure;
      const offset = options.offset ?? 0;
      // The real catalogue primitive accepts offsets, including offsets beyond
      // the end. The page loader is responsible for resolving the final page.
      return {
        products: products.slice(offset, offset + 24), total,
        nextOffset: offset + 24 < total ? offset + 24 : null,
      };
    } },
  };
  function load(relative) {
    const filename = path.resolve(__dirname, "..", relative);
    if (modules.has(filename)) return modules.get(filename);
    if (filename.endsWith(".json")) return JSON.parse(readFileSync(filename, "utf8"));
    const loaded = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    new Function("require", "module", "exports", compiled)(name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("@/components/")) return { __esModule: true, default: () => null };
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? path.resolve(__dirname, "..", name.slice(2)) : path.resolve(path.dirname(filename), name);
        const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.json`].find(candidate => existsSync(candidate) && /\.(?:ts|tsx|json)$/.test(candidate));
        assert.ok(target, `Module exists: ${name}`);
        return load(path.relative(path.resolve(__dirname, ".."), target));
      }
      return require(name);
    }, loaded, loaded.exports);
    modules.set(filename, loaded.exports);
    return loaded.exports;
  }
  return { load, requests };
}

function props(searchParams = {}) {
  return { params: Promise.resolve({ category: "wedding" }), searchParams: Promise.resolve(searchParams) };
}

function descendants(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(descendants);
  return [node, ...descendants(node.props?.children)];
}

for (const scenario of routeCases) {
  test(`${scenario.pathname} serves distinct product pages with matching canonical URLs`, async () => {
    const env = harness();
    const route = env.load(scenario.file);
    const first = descendants(await route.default(props())).find(node => node.props?.initialPage);
    const metadata = await route.generateMetadata(props({ page: "2" }));
    const secondElements = descendants(await route.default(props({ page: "2" })));
    const second = secondElements.find(node => node.props?.initialPage);
    assert.equal(first.props.initialPageNumber, 1);
    assert.equal(second.props.initialPageNumber, 2);
    assert.equal(first.props.initialPage.products[0].slug, "wedding-card-1");
    assert.equal(second.props.initialPage.products[0].slug, "wedding-card-25");
    assert.equal(second.props.initialPage.products.length, 24);
    assert.equal(metadata.alternates.canonical, `${scenario.pathname}?page=2`);
    assert.match(metadata.title, /Page 2/);
    if (metadata.openGraph) assert.equal(metadata.openGraph.url, `${ORIGIN}${scenario.pathname}?page=2`);
    const collectionSchema = secondElements.find(node => node.props?.data?.["@type"] === "CollectionPage")?.props.data;
    if (scenario.file !== "app/collections/wedding-card/page.tsx") {
      assert.ok(collectionSchema, "rendered collection has structured data");
      assert.equal(collectionSchema.url, `${ORIGIN}${scenario.pathname}?page=2`);
      assert.equal(collectionSchema.mainEntity.itemListElement[0].position, 25);
      assert.equal(collectionSchema.mainEntity.itemListElement[0].url, `${ORIGIN}/products/wedding-card-25`);
    }
    assert.deepEqual(env.requests, [{ ...scenario.scope, offset: 0 }, { ...scenario.scope, offset: 24 }],
      "metadata and rendering share the same result with primitive cache keys");
  });

  test(`${scenario.pathname} clamps out-of-range requests to the final nonempty page`, async () => {
    const env = harness();
    const route = env.load(scenario.file);
    const metadata = await route.generateMetadata(props({ page: "999" }));
    const grid = descendants(await route.default(props({ page: "999" }))).find(node => node.props?.initialPage);
    assert.equal(metadata.alternates.canonical, `${scenario.pathname}?page=3`);
    assert.equal(grid.props.initialPageNumber, 3);
    assert.equal(grid.props.initialPage.products[0].slug, "wedding-card-49");
    assert.equal(grid.props.initialPage.products.length, 12);
    assert.deepEqual(env.requests, [{ ...scenario.scope, offset: 998 * 24 }, { ...scenario.scope, offset: 48 }]);
  });

  test(`${scenario.pathname} handles malformed, repeated and unsafe page parameters`, async () => {
    for (const [page, expectedPage] of [
      [undefined, 1], ["0", 1], ["-2", 1], ["2.5", 1], ["2junk", 1], ["01", 1], ["1e9", 1],
      ["9007199254740992", 1], ["89478486", 1], [["2", "999"], 2], [[], 1],
    ]) {
      const env = harness();
      const route = env.load(scenario.file);
      const metadata = await route.generateMetadata(props({ page, utm_source: "campaign" }));
      const grid = descendants(await route.default(props({ page, utm_source: "campaign" }))).find(node => node.props?.initialPage);
      assert.equal(metadata.alternates.canonical, `${scenario.pathname}${expectedPage > 1 ? "?page=2" : ""}`);
      assert.equal(grid.props.initialPageNumber, expectedPage);
      assert.equal(grid.props.initialPage.products[0].slug, `wedding-card-${(expectedPage - 1) * 24 + 1}`);
      assert.deepEqual(env.requests, [{ ...scenario.scope, offset: (expectedPage - 1) * 24 }]);
    }
  });

  test(`${scenario.pathname} propagates initial and clamped-page catalogue outages`, async () => {
    for (const failOffset of [undefined, 48]) {
      const failure = new Error("Catalogue unavailable");
      const env = harness({ failure, failOffset });
      const route = env.load(scenario.file);
      const page = failOffset === undefined ? "2" : "999";
      await assert.rejects(route.generateMetadata(props({ page })), error => error === failure);
      await assert.rejects(route.default(props({ page })), error => error === failure);
      assert.equal(env.requests.length, failOffset === undefined ? 1 : 2,
        "metadata and HTML reuse the same failed lookup rather than disagreeing");
    }
  });

  test(`${scenario.pathname} normalizes an empty catalogue to page one`, async () => {
    const env = harness({ total: 0 });
    const route = env.load(scenario.file);
    const metadata = await route.generateMetadata(props({ page: "2" }));
    assert.equal(metadata.alternates.canonical, scenario.pathname);
    assert.ok(await route.default(props({ page: "2" })));
    assert.deepEqual(env.requests, [{ ...scenario.scope, offset: 24 }, { ...scenario.scope, offset: 0 }]);
  });
}

test("catalogue cache keeps independent collection scopes separate", async () => {
  const env = harness();
  const { loadCatalogPage } = env.load("lib/catalog-page.ts");
  await loadCatalogPage({ page: "2" }, { category: "wedding" });
  await loadCatalogPage({ page: "2" }, { category: "birthday" });
  await loadCatalogPage({ page: "2" }, { category: "wedding" });
  assert.deepEqual(env.requests, [{ category: "wedding", offset: 24 }, { category: "birthday", offset: 24 }]);
});
