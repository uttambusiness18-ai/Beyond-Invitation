const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");

const ORIGIN = "https://example.test";
const COLLECTION_PATH = "/collections/wedding-card-bengali";
const h = React.createElement;
const product = (overrides = {}) => ({
  slug: "demo-bengali-card", designNo: "DEMO-1", name: "Sample Bengali invitation",
  price: 0, mrp: 0, image: "/products/demo.jpg", imageCount: 1,
  subject: "Bengali", itemCategory: "Wedding Card", itemGroup: "Wedding Cards",
  hasPrice: false, minOrderQty: 50, updatedAt: "2026-11-21T00:00:00Z", ...overrides,
});

// Use the real metadata, structured data, content and page composition; replace only
// catalogue I/O and browser-only product presentation/animation dependencies.
function harness() {
  const modules = new Map();
  const catalogCalls = [];
  let catalogPage;
  const mocks = {
    "server-only": {},
    "next/link": { default: ({ children, ...props }) => h("a", props, children) },
    "@/lib/catalog-browse": { fetchWeddingProductPage: async (options) => {
      catalogCalls.push(options);
      return catalogPage;
    } },
    "@/components/wedding-cards/WeddingCardsMotion": {
      WeddingCardsMotion: ({ children }) => h(React.Fragment, null, children),
      useWeddingCardsMotion: () => ({ expand() {}, collapse() {} }),
    },
    "@/components/wedding-cards/WeddingCardsBrowser": {
      default: ({ initialPage }) => h("div", { "data-test-catalogue": true }, initialPage.products.map(item =>
        h("a", { href: `/products/${item.slug}`, key: item.slug }, item.name))),
      WeddingCardsSkeleton: () => null,
    },
  };
  function load(relativePath) {
    const filename = path.resolve(__dirname, "..", relativePath);
    if (modules.has(filename)) return modules.get(filename);
    const module = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    new Function("require", "module", "exports", "process", compiled)(
      name => {
        if (Object.hasOwn(mocks, name)) return mocks[name];
        if (name.startsWith("@/") || name.startsWith(".")) {
          const base = name.startsWith("@/") ? path.resolve(__dirname, "..", name.slice(2)) : path.resolve(path.dirname(filename), name);
          const target = [base, `${base}.ts`, `${base}.tsx`].find(candidate => existsSync(candidate) && /\.[cm]?[jt]sx?$/.test(candidate));
          assert.ok(target, `Module exists: ${name}`);
          return load(path.relative(path.resolve(__dirname, ".."), target));
        }
        return require(name);
      }, module, module.exports, { env: { NEXT_PUBLIC_SITE_URL: ORIGIN } },
    );
    modules.set(filename, module.exports);
    return module.exports;
  }
  const cards = load("lib/wedding-cards.ts");
  function page(products = [], overrides = {}) {
    return { products, total: products.length, nextOffset: null, facets: cards.facetCounts(products), ...overrides };
  }
  return { load, page, catalogCalls, setCatalogPage(value) { catalogPage = value; } };
}

const canonical = metadata => new URL(String(metadata.alternates.canonical), ORIGIN);
const graphNode = (schema, type) => schema["@graph"].find(node => node["@type"] === type);
const itemUrl = item => typeof item.item === "string" ? item.item : item.url || item.item?.url || item.item?.["@id"];

test("Bengali landing metadata is indexable, branded once, and specific in search and social previews", () => {
  const { load } = harness();
  const { BENGALI_PATH, getBengaliMetadata } = load("lib/bengali-wedding-seo.ts");
  const metadata = getBengaliMetadata({});
  assert.equal(BENGALI_PATH, COLLECTION_PATH);
  assert.equal(canonical(metadata).href, `${ORIGIN}${COLLECTION_PATH}`);
  assert.equal(metadata.robots.index, true);
  assert.equal(metadata.robots.follow, true);
  assert.equal(typeof metadata.title.absolute, "string");
  assert.match(metadata.title.absolute, /Bengali/i);
  assert.equal((metadata.title.absolute.match(/Beyond Invitation/g) || []).length, 1);
  assert.match(metadata.description, /Bengali/i);
  assert.match(metadata.description, /Kolkata/i);
  assert.ok(metadata.keywords.includes("Bengali Wedding Cards"));
  for (const preview of [metadata.openGraph, metadata.twitter]) {
    assert.match(String(preview.title), /Bengali/i);
    assert.match(preview.description, /Bengali/i);
    assert.ok(preview.images.length);
  }
  assert.equal(new URL(String(metadata.openGraph.url), ORIGIN).href, canonical(metadata).href);
});

test("pagination has self canonicals while tracking, defaults and malformed parameters normalize away", () => {
  const { getBengaliMetadata } = harness().load("lib/bengali-wedding-seo.ts");
  const second = getBengaliMetadata({ page: "2", utm_source: "email", gclid: "sample-click" });
  assert.equal(canonical(second).href, `${ORIGIN}${COLLECTION_PATH}?page=2`);
  assert.equal(second.robots.index, true);
  for (const params of [
    { page: "1", price: "any", sort: "recommended", type: "all", utm_source: "email" },
    { page: "-2", price: "invalid", sort: "invalid", type: "hindu", tracking: "ignored" },
    { page: "2junk" }, { page: "999999999999999999999" },
  ]) {
    const metadata = getBengaliMetadata(params);
    assert.equal(canonical(metadata).href, `${ORIGIN}${COLLECTION_PATH}`);
    assert.equal(metadata.robots.index, true);
  }
  assert.equal(canonical(getBengaliMetadata({ page: ["2", "3"] })).search, "?page=2");
  assert.equal(canonical(getBengaliMetadata({ page: "999" }, 2)).search, "?page=2", "A resolved page must match the rendered catalogue");
});

test("price and sort variants are noindex follow with canonicals that retain their actual state", () => {
  const { getBengaliMetadata } = harness().load("lib/bengali-wedding-seo.ts");
  for (const params of [{ price: "25-50" }, { sort: "price-asc" }, { page: "2", price: "on-request", sort: "newest", type: "muslim", utm_source: "email" }]) {
    const metadata = getBengaliMetadata(params);
    const url = canonical(metadata);
    assert.equal(metadata.robots.index, false);
    assert.equal(metadata.robots.follow, true);
    assert.equal(url.pathname, COLLECTION_PATH);
    for (const field of ["price", "sort", "page"]) assert.equal(url.searchParams.get(field), params[field] ?? null);
    assert.equal(url.searchParams.has("utm_source"), false);
    assert.equal(url.searchParams.has("type"), false);
    assert.equal(new URL(String(metadata.openGraph.url), ORIGIN).href, url.href);
  }
});

test("collection structured data lists only the products rendered and makes no invented commerce claims", () => {
  const { load, page } = harness();
  const products = [product(), product({ slug: "demo-bengali-two", designNo: "DEMO-2", name: "Second sample invitation", price: 100, hasPrice: true })];
  const { buildBengaliStructuredData, getBengaliMetadata } = load("lib/bengali-wedding-seo.ts");
  const schema = buildBengaliStructuredData(page(products, { pageNumber: 2 }), { page: "2" });
  assert.equal(schema["@context"], "https://schema.org");
  const collection = graphNode(schema, "CollectionPage");
  const breadcrumb = graphNode(schema, "BreadcrumbList");
  const list = graphNode(schema, "ItemList");
  assert.ok(collection);
  assert.ok(breadcrumb.itemListElement.length >= 2);
  assert.equal(new URL(collection.url, ORIGIN).href, canonical(getBengaliMetadata({ page: "2" })).href);
  assert.deepEqual(list.itemListElement.map(item => new URL(itemUrl(item), ORIGIN).href), products.map(item => `${ORIGIN}/products/${item.slug}`));
  assert.equal(list.itemListElement.length, products.length);
  assert.ok(list.itemListElement.every(item => Number.isInteger(item.position) && item.position > 0));
  const serialized = JSON.stringify(schema);
  assert.doesNotMatch(serialized, /"(?:offers|aggregateRating|review|availability)"/);
  assert.doesNotMatch(serialized, /"@type":"(?:Product|Offer|AggregateOffer|FAQPage)"/);
});

test("an empty catalogue keeps page and breadcrumb context without fabricated products or offers", () => {
  const { load, page } = harness();
  const schema = load("lib/bengali-wedding-seo.ts").buildBengaliStructuredData(page(), {});
  assert.ok(graphNode(schema, "CollectionPage"));
  assert.ok(graphNode(schema, "BreadcrumbList"));
  const list = graphNode(schema, "ItemList");
  assert.ok(!list || list.itemListElement.length === 0);
  assert.doesNotMatch(JSON.stringify(schema), /"@type":"(?:Product|Offer|AggregateOffer)"/);
});

test("JSON-LD safely round-trips product text containing an HTML script terminator", () => {
  const { load } = harness();
  const JsonLd = load("components/seo/JsonLd.tsx").default;
  const data = { "@context": "https://schema.org", name: '</script><script>alert("sample")</script>', detail: "<b>Literal & text</b>" };
  const markup = renderToStaticMarkup(h(JsonLd, { data }));
  const dom = new JSDOM(markup);
  try {
    const scripts = dom.window.document.querySelectorAll("script");
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].type, "application/ld+json");
    assert.deepEqual(JSON.parse(scripts[0].textContent), data);
    assert.ok(!scripts[0].textContent.includes("<"));
  } finally { dom.window.close(); }
});

test("the Bengali page server-renders readable collection content, useful links and valid structured data", async () => {
  const env = harness();
  env.setCatalogPage(env.page([product()], { pageNumber: 2 }));
  const pageModule = env.load("app/collections/wedding-card-bengali/page.tsx");
  const props = { searchParams: Promise.resolve({ page: "999", utm_source: "email" }) };
  const metadata = await pageModule.generateMetadata(props);
  const markup = renderToStaticMarkup(await pageModule.default(props));
  const dom = new JSDOM(markup);
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelectorAll("h1").length, 1);
    assert.match(doc.querySelector("h1").textContent, /Bengali Wedding Cards/i);
    assert.match(doc.body.textContent, /Shubho Bibaho/);
    assert.match(doc.body.textContent, /printing/i);
    assert.match(doc.body.textContent, /Bengali wedding card questions/);
    assert.ok(doc.querySelector('a[href="/contact"]'));
    assert.ok(doc.querySelector('a[href="/visit-us"]'));
    assert.ok(doc.querySelector('a[href="/products/demo-bengali-card"]'));
    const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
    assert.ok(scripts.length);
    const collection = scripts.map(script => JSON.parse(script.textContent)).map(schema => graphNode(schema, "CollectionPage")).find(Boolean);
    assert.ok(collection);
    assert.equal(canonical(metadata).href, `${ORIGIN}${COLLECTION_PATH}?page=2`);
    assert.equal(collection.url, canonical(metadata).href, "Page schema and metadata use the catalogue's resolved page");
    assert.equal(env.catalogCalls[0].collectionType, "bengali");
  } finally { dom.window.close(); }
});
