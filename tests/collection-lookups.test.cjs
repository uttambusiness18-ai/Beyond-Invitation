const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { cache } = require("./helpers/react-cache.cjs");

const routes = [
  "[category]", "wedding-card", "wedding-card-hindu", "wedding-card-muslim",
  "wedding-card-christian", "wedding-card-bengali", "shagun-envelopes",
];

// Execute the actual route and local category lookup, replacing only catalogue
// I/O, Next navigation and child components that need the browser runtime.
function harness({ failure, shagunEnabled = true } = {}) {
  const modules = new Map();
  const calls = [];
  const notFoundError = new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  const emptyPage = {
    products: [], total: 0, nextOffset: null, pageNumber: 1,
    facets: { categoryTotal: 0, total: 0, types: [], prices: [], showPrice: false },
  };
  async function readPage(options) {
    calls.push(options);
    if (failure) throw failure;
    return emptyPage;
  }
  const mocks = {
    "server-only": {},
    react: { ...require("react"), cache },
    "next/navigation": { notFound() { throw notFoundError; } },
    "next/link": { __esModule: true, default: () => null },
    "@/lib/catalog": {},
    "@/lib/reseller": {},
    "@/lib/catalog-browse": { fetchCatalogProductPage: readPage, fetchWeddingProductPage: readPage },
    "@/lib/storefront-availability": { SHAGUN_ENVELOPES_ENABLED: shagunEnabled },
  };
  function load(relativePath) {
    const filename = path.resolve(__dirname, "..", relativePath);
    if (modules.has(filename)) return modules.get(filename);
    if (filename.endsWith(".json")) return JSON.parse(readFileSync(filename, "utf8"));
    const loaded = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
      },
    }).outputText;
    new Function("require", "module", "exports", compiled)(name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("@/components/")) return { __esModule: true, default: () => null };
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/")
          ? path.resolve(__dirname, "..", name.slice(2))
          : path.resolve(path.dirname(filename), name);
        const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.json`]
          .find(candidate => existsSync(candidate) && /\.[cm]?[jt]sx?$|\.json$/.test(candidate));
        assert.ok(target, `Module exists: ${name}`);
        return load(path.relative(path.resolve(__dirname, ".."), target));
      }
      return require(name);
    }, loaded, loaded.exports);
    modules.set(filename, loaded.exports);
    return loaded.exports;
  }
  return { load, calls, emptyPage, notFoundError };
}

function props(category = "wedding") {
  return { params: Promise.resolve({ category }), searchParams: Promise.resolve({}) };
}

function descendants(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(descendants);
  return [node, ...descendants(node.props?.children)];
}

test("an unknown collection calls notFound in both metadata and the page before catalogue I/O", async () => {
  const env = harness({ failure: new Error("Database unavailable") });
  const route = env.load("app/collections/[category]/page.tsx");
  for (const handler of [route.generateMetadata, route.default]) {
    await assert.rejects(handler(props("unknown-collection")), error => error === env.notFoundError);
  }
  assert.deepEqual(env.calls, []);
});

test("a known collection with no products remains valid and indexable", async () => {
  const env = harness();
  const route = env.load("app/collections/[category]/page.tsx");
  const metadata = await route.generateMetadata(props());
  const page = await route.default(props());
  const collection = descendants(page).find(node => node.props?.category === "wedding");
  assert.ok(collection);
  assert.equal(collection.props.initialPage, env.emptyPage);
  assert.equal(metadata.robots.index, true);
  assert.equal(metadata.alternates.canonical, "/collections/wedding");
  assert.deepEqual(env.calls, [{ category: "wedding", offset: 0 }]);
});

for (const name of routes) {
  test(`${name} propagates catalogue outages instead of rendering a missing or empty collection`, async () => {
    const failure = new Error("Product catalogue unavailable: connection refused");
    const env = harness({ failure });
    const route = env.load(`app/collections/${name}/page.tsx`);
    await assert.rejects(route.default(props()), error => error === failure);
    assert.equal(env.calls.length, 1);
  });

  test(`${name} renders a successful empty catalogue`, async () => {
    const env = harness();
    const route = env.load(`app/collections/${name}/page.tsx`);
    assert.ok(await route.default(props()));
    assert.equal(env.calls.length, 1);
  });
}

test("Bengali metadata propagates catalogue outages from its shared page lookup", async () => {
  const failure = new Error("Product catalogue unavailable: timeout");
  const env = harness({ failure });
  const route = env.load("app/collections/wedding-card-bengali/page.tsx");
  await assert.rejects(route.generateMetadata(props()), error => error === failure);
});

test("the intentionally paused Shagun collection still returns notFound without catalogue I/O", async () => {
  const env = harness({ shagunEnabled: false, failure: new Error("Database unavailable") });
  const route = env.load("app/collections/shagun-envelopes/page.tsx");
  await assert.rejects(route.default(), error => error === env.notFoundError);
  assert.deepEqual(env.calls, []);
});
