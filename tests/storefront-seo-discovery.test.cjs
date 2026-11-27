const assert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { cache } = require("./helpers/react-cache.cjs");
const { JSDOM } = require("jsdom");
const { resolveSitemap } = require("next/dist/build/webpack/loaders/metadata/resolve-route-data");

const ORIGIN = "https://example.test";
const collectionSlugs = [
  "wedding-card", "wedding-card-hindu", "wedding-card-muslim", "wedding-card-christian",
];

function harness({ enabled = true, catalogueError, products, blogs = [] } = {}) {
  const modules = new Map();
  const requests = [];
  const mocks = {
    "server-only": {},
    react: { ...require("react"), cache },
    "@/lib/site-config": {
      getSiteUrl: () => ORIGIN,
      siteUrl: (pathname = "") => `${ORIGIN}${pathname}`,
      SITE_NAME: "Beyond Invitation", DEFAULT_OG_IMAGE: "/logo.png", PRIMARY_KEYWORDS: [],
      CONTACT: { googleMaps: "https://maps.example.test/showroom", displayPhone: "+91 70448 15488", whatsappNumber: "917044815488" },
      BUSINESS_ADDRESS_TEXT: "Kolkata",
    },
    "@/lib/storefront-availability": { SHAGUN_ENVELOPES_ENABLED: enabled },
    "@/lib/products": {
      getAllCategories: async () => require("../data/categories.json"),
      getCategoryBySlug: async slug => require("../data/categories.json").find(category => category.slug === slug) ?? null,
    },
    "@/lib/catalog": { fetchErpProductsBase: async () => {
      if (catalogueError) throw catalogueError;
      return products ?? [{ slug: "g22201", name: "G22201", updatedAt: "2026-11-24T16:45:52Z" }];
    } },
    "@/lib/blog-server": { getPublishedBlogs: async () => blogs },
    "@/lib/catalog-browse": { fetchCatalogProductPage: async options => {
      requests.push(options);
      if (catalogueError) throw catalogueError;
      const offset = options.offset ?? 0;
      return {
        products: offset < 60 ? [{ slug: `catalog-card-${offset + 1}` }] : [],
        total: 60, nextOffset: offset + 24 < 60 ? offset + 24 : null,
      };
    }, fetchWeddingProductPage: async options => {
      requests.push(options);
      if (catalogueError) throw catalogueError;
      const pageNumber = Math.min(options.offset / 24 + 1, 3);
      return {
        pageNumber, products: [{ slug: `${options.collectionType}-page-${pageNumber}` }],
        total: 60, nextOffset: pageNumber < 3 ? pageNumber * 24 : null,
        facets: { total: 60, types: [], prices: [] },
      };
    } },
    "next/navigation": {},
  };
  function load(relative) {
    const filename = path.resolve(__dirname, "..", relative);
    if (modules.has(filename)) return modules.get(filename);
    const loaded = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    new Function("require", "module", "exports", compiled)(name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("@/components/")) return { default: () => null };
      if (name.startsWith("@/")) {
        const base = name.slice(2);
        const target = [`${base}.ts`, `${base}.tsx`].find(candidate => existsSync(path.resolve(__dirname, "..", candidate)));
        assert.ok(target, `Module exists: ${name}`);
        return load(target);
      }
      return require(name);
    }, loaded, loaded.exports);
    modules.set(filename, loaded.exports);
    return loaded.exports;
  }
  return Object.assign(load, { requests });
}

test("explicit collection canonicals are included in discovery, respecting collection visibility", async () => {
  for (const enabled of [false, true]) {
    const load = harness({ enabled });
    const entries = await load("app/sitemap.ts").default();
    const urls = new Set(entries.map(entry => entry.url));
    assert.equal(urls.size, entries.length, "sitemap URLs must be unique");
    for (const slug of collectionSlugs) {
      const route = load(`app/collections/${slug}/page.tsx`);
      const metadata = route.metadata ?? await route.generateMetadata({ searchParams: Promise.resolve({}) });
      const canonical = new URL(metadata.alternates.canonical, ORIGIN).href;
      assert.equal(canonical, `${ORIGIN}/collections/${slug}`);
      assert.ok(urls.has(canonical), `${slug} must be discoverable at its canonical URL`);
    }
    assert.ok(urls.has(`${ORIGIN}/collections/wedding-card-bengali`));
    assert.ok(urls.has(`${ORIGIN}/wedding-boxes`));
    assert.ok(urls.has(`${ORIGIN}/products/g22201`));
    assert.equal(urls.has(`${ORIGIN}/products/g222-01`), false);
    assert.equal(urls.has(`${ORIGIN}/collections/shagun-boxes`), false);
    for (const slug of ["hindu", "muslim", "christian"]) {
      assert.equal(urls.has(`${ORIGIN}/wedding-card-${slug}`), false, "redirect sources do not belong in the sitemap");
    }
    const envelopes = load("app/collections/shagun-envelopes/page.tsx").metadata;
    assert.equal(urls.has(`${ORIGIN}/collections/shagun-envelopes`), enabled);
    if (enabled) {
      assert.equal(envelopes.alternates.canonical, "/collections/shagun-envelopes");
    } else {
      assert.equal(envelopes.robots.index, false);
      assert.equal(envelopes.alternates, undefined);
    }
  }
});

test("every implemented public collection canonical is in the sitemap, including the category inventory", async () => {
  const directory = path.resolve(__dirname, "../app/collections");
  // Discover route files instead of maintaining another list that can omit a
  // newly added collection in exactly the same way as the sitemap.
  const concreteSlugs = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("[") &&
      existsSync(path.join(directory, entry.name, "page.tsx")))
    .map(entry => entry.name);

  for (const enabled of [false, true]) {
    const load = harness({ enabled });
    const entries = await load("app/sitemap.ts").default();
    const urls = new Set(entries.map(entry => entry.url));
    const expectedCollectionUrls = new Set();
    const candidates = [
      ...concreteSlugs.map(slug => ({ file: `app/collections/${slug}/page.tsx`, pathname: `/collections/${slug}` })),
      ...require("../data/categories.json").map(category => ({
        file: "app/collections/[category]/page.tsx", pathname: `/collections/${category.slug}`, category: category.slug,
      })),
      ...["wedding-cards", "wedding-boxes"].map(slug => ({ file: `app/${slug}/page.tsx`, pathname: `/${slug}` })),
    ];
    for (const { file, pathname, category } of candidates) {
      const route = load(file);
      const metadata = route.metadata ?? await route.generateMetadata({
        params: Promise.resolve({ category }), searchParams: Promise.resolve({}),
      });
      if (metadata.robots?.index === false) {
        assert.equal(urls.has(`${ORIGIN}${pathname}`), false, `${pathname} is disabled and must stay out of discovery`);
        continue;
      }
      assert.ok(metadata.alternates?.canonical, `${pathname} declares its canonical URL`);
      const canonical = new URL(metadata.alternates.canonical, ORIGIN).href;
      assert.equal(canonical, `${ORIGIN}${pathname}`, `${pathname} is a canonical collection, not a redirect alias`);
      assert.equal(entries.filter(entry => entry.url === canonical).length, 1, `${pathname} must appear exactly once`);
      if (pathname.startsWith("/collections/")) expectedCollectionUrls.add(canonical);
    }
    assert.deepEqual(
      [...urls].filter(url => new URL(url).pathname.startsWith("/collections/")).sort(),
      [...expectedCollectionUrls].sort(),
      "sitemap collection entries match implemented, indexable pages exactly",
    );
  }
});

test("a catalogue outage does not publish a sitemap with all product URLs removed", async () => {
  const catalogueError = new Error("Catalogue temporarily unavailable");
  const load = harness({ catalogueError });
  await assert.rejects(load("app/sitemap.ts").default(), error => error === catalogueError);
});

test("sitemap preserves known modification dates without inventing dates for unchanged or undated pages", async () => {
  const load = harness({
    products: [
      { slug: "dated-card", updatedAt: "2026-11-24T16:45:52Z" },
      { slug: "undated-card" },
      { slug: "invalid-date-card", updatedAt: "invalid date" },
    ],
    blogs: [
      { slug: "invitation-guide", updated_at: "2026-10-12T00:00:00Z" },
      { slug: "undated-guide", updated_at: "invalid date" },
    ],
  });
  const entries = await load("app/sitemap.ts").default();
  const dates = entries.filter(entry => entry.lastModified).map(entry => [entry.url, entry.lastModified.toISOString()]);
  assert.deepEqual(dates, [
    [`${ORIGIN}/products/dated-card`, "2026-11-24T16:45:52.000Z"],
    [`${ORIGIN}/blog/invitation-guide`, "2026-10-12T00:00:00.000Z"],
  ]);
  assert.doesNotThrow(() => resolveSitemap(entries), "invalid source dates cannot break sitemap serialization");
});

test("sitemap exposes public product gallery images in valid XML", async () => {
  const imageUrl = "https://images.example.test/card.jpg?width=1200&quality=90";
  const load = harness({ products: [{
    slug: "wedding card", images: [
      imageUrl, imageUrl, "/products/second photo.jpg", "third.jpg", "",
      "/private/files/customer-proof.jpg", "https://images.example.test/card.mp4", "data:image/png;base64,test",
    ],
  }] });
  const entries = await load("app/sitemap.ts").default();
  const xml = resolveSitemap(entries);
  const dom = new JSDOM(xml, { contentType: "application/xml" });
  const document = dom.window.document;
  assert.deepEqual(Array.from(document.getElementsByTagName("image:loc"), element => element.textContent), [
    imageUrl, `${ORIGIN}/products/second%20photo.jpg`, `${ORIGIN}/products/third.jpg`,
  ]);
  assert.ok(Array.from(document.getElementsByTagName("loc"), element => element.textContent)
    .includes(`${ORIGIN}/products/wedding%20card`));
  dom.window.close();
});

for (const type of ["hindu", "muslim", "christian"]) {
  test(`${type} collection metadata follows rendered pages and normalized filters`, async () => {
    const base = `/collections/wedding-card-${type}`;
    const cases = [
      { params: {}, query: "", page: 1, index: true },
      { params: { page: "2" }, query: "?page=2", page: 2, index: true },
      { params: { page: "1", price: "any", sort: "newest", type: "christian", utm_source: "test" }, query: "", page: 1, index: true },
      { params: { page: "invalid", price: "invalid", sort: "invalid" }, query: "", page: 1, index: true },
      { params: { page: "2", price: "25-50", sort: "price-asc" }, query: "?price=25-50&sort=price-asc&page=2", page: 2, index: false },
      { params: { sort: "price-asc" }, query: "?sort=price-asc", page: 1, index: false },
      { params: { page: "999" }, query: "?page=3", page: 3, index: true },
      { params: { page: "999", price: "25-50" }, query: "?price=25-50&page=3", page: 3, index: false },
      { params: { price: "on-request" }, query: type === "hindu" ? "" : "?price=on-request", page: 1, index: type === "hindu" },
    ];
    for (const scenario of cases) {
      const load = harness();
      const route = load(`app/collections/wedding-card-${type}/page.tsx`);
      const metadata = await route.generateMetadata({ searchParams: Promise.resolve(scenario.params) });
      const element = await route.default({ searchParams: Promise.resolve({ ...scenario.params }) });
      assert.equal(metadata.alternates.canonical, `${base}${scenario.query}`);
      assert.equal(metadata.robots.index, scenario.index);
      assert.equal(metadata.robots.follow, true);
      assert.equal(metadata.robots.googleBot.index, scenario.index);
      assert.equal(element.props.initialPage.pageNumber, scenario.page);
      assert.equal(element.props.initialPage.products[0].slug, `${type}-page-${scenario.page}`);
      assert.equal(element.props.initialFilters.type, "all");
      assert.equal(load.requests.length, 1, "metadata and page share the resolved catalogue result");
      assert.equal(load.requests[0].collectionType, type);
      assert.match(metadata.title, new RegExp(type, "i"));
      assert.ok(metadata.description.length > 50);
    }
  });

  test(`${type} metadata and rendering both propagate catalogue outages`, async () => {
    const catalogueError = new Error("Catalogue temporarily unavailable");
    const load = harness({ catalogueError });
    const route = load(`app/collections/wedding-card-${type}/page.tsx`);
    await assert.rejects(route.generateMetadata({ searchParams: Promise.resolve({}) }), error => error === catalogueError);
    await assert.rejects(route.default({ searchParams: Promise.resolve({}) }), error => error === catalogueError);
    assert.equal(load.requests.length, 1);
  });
}
