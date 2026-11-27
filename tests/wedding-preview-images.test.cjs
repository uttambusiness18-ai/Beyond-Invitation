const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { cache } = require("./helpers/react-cache.cjs");

const ORIGIN = "https://example.test";
const product = (overrides = {}) => ({
  slug: "invitation", name: "INV-1", printName: "Floral invitation", image: "invitation.jpg",
  price: 35, mrp: 35, ...overrides,
});

function harness({ products = [product()], pageNumber, failure } = {}) {
  const calls = [];
  const modules = new Map();
  const mocks = {
    "server-only": {},
    react: { ...require("react"), cache },
    "@/lib/site-config": {
      getSiteUrl: () => ORIGIN, siteUrl: pathname => `${ORIGIN}${pathname}`,
      DEFAULT_OG_IMAGE: "/brand-preview.png", SITE_NAME: "Beyond Invitation",
      PRIMARY_KEYWORDS: [], SITE_DESCRIPTION: "Wedding invitations",
    },
    "@/lib/business-schema": { getBusinessIdentity: () => ({ "@type": "LocalBusiness", name: "Beyond Invitation" }) },
    "@/lib/catalog-browse": { fetchWeddingProductPage: async options => {
      calls.push(options);
      if (failure) throw failure;
      return {
        products, pageNumber: pageNumber ?? options.offset / 24 + 1, total: 72, nextOffset: null,
        facets: { total: 72, types: [], prices: [] },
      };
    } },
  };
  function load(relative) {
    const filename = path.resolve(__dirname, "..", relative);
    if (modules.has(filename)) return modules.get(filename);
    const loaded = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    new Function("require", "module", "exports", "console", compiled)(name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("@/components/")) return { default: () => null };
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? path.resolve(__dirname, "..", name.slice(2)) : path.resolve(path.dirname(filename), name);
        const target = [`${base}.ts`, `${base}.tsx`].find(existsSync);
        assert.ok(target, `Module exists: ${name}`);
        return load(path.relative(path.resolve(__dirname, ".."), target));
      }
      return require(name);
    }, loaded, loaded.exports, { ...console, error() {} });
    modules.set(filename, loaded.exports);
    return loaded.exports;
  }
  return { load, calls };
}

function descendants(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(descendants);
  return [node, ...descendants(node.props?.children)];
}

function schemaObjects(value) {
  if (!value || typeof value !== "object") return [];
  return [value, ...Object.values(value).flatMap(schemaObjects)];
}
const props = params => ({ searchParams: Promise.resolve(params) });

for (const routeName of ["wedding-cards", "wedding-boxes"]) {
  test(`${routeName} previews use a real visible product photo and share the resolved page read`, async () => {
    const h = harness({ products: [
      product({ slug: "unphotographed", image: "", price: 0 }),
      product({ slug: "private", image: "/private/files/proof.jpg", price: Infinity }),
      product({ slug: "invitation" }),
      product({ slug: "logo-only", image: "/brand-preview.png", price: 0 }),
    ] });
    const route = h.load(`app/${routeName}/page.tsx`);
    const metadata = await route.generateMetadata(props({ page: "2" }));
    const nodes = descendants(await route.default(props({ page: "2" })));
    const collection = nodes.find(node => node.props?.initialPage);
    const itemList = nodes.find(node => node.props?.data?.["@type"] === "ItemList").props.data;
    assert.equal(h.calls.length, 1, "metadata and rendering must share the catalogue read");
    assert.equal(h.calls[0].offset, 24);
    assert.equal(h.calls[0].collectionType, routeName === "wedding-boxes" ? "boxes" : undefined);
    assert.equal(collection.props.initialPage.pageNumber, 2);
    assert.equal(metadata.alternates.canonical, `/${routeName}?page=2`);
    assert.equal(metadata.openGraph.url, `${ORIGIN}/${routeName}?page=2`);
    assert.equal(metadata.openGraph.images[0].url, `${ORIGIN}/products/invitation.jpg`);
    assert.deepEqual(metadata.twitter.images, metadata.openGraph.images);
    assert.match(metadata.openGraph.images[0].alt, /Floral invitation/);
    assert.equal(metadata.openGraph.images[0].width, undefined);
    assert.equal(metadata.openGraph.images[0].height, undefined);
    assert.equal(metadata.robots.index, true);
    assert.equal(itemList.itemListElement[0].position, 25);
    assert.equal(itemList.itemListElement[0].image, undefined, "brand image must not masquerade as a product photo");
    assert.equal(itemList.itemListElement[1].image, undefined);
    assert.equal(itemList.itemListElement[2].image, `${ORIGIN}/products/invitation.jpg`);
    assert.equal(itemList.itemListElement[3].image, undefined, "explicit logo placeholders are omitted");
    assert.equal(itemList.itemListElement.length, collection.props.initialPage.products.length);
    for (const [index, item] of itemList.itemListElement.entries()) {
      assert.equal(item["@type"], "ListItem");
      assert.equal(item.url, `${ORIGIN}/products/${collection.props.initialPage.products[index].slug}`);
      assert.match(item.name, /Floral invitation/);
      assert.equal(item.item, undefined, "collection entries link to products without duplicating rich-result markup");
      assert.equal(item.offers, undefined);
    }
    const renderedSchemas = JSON.parse(JSON.stringify(nodes.filter(node => node.props?.data).map(node => node.props.data)));
    assert.equal(schemaObjects(renderedSchemas).some(node => node["@type"] === "Product"), false,
      "collection and business schemas must not declare incomplete Product rich results");
  });

  test(`${routeName} image metadata follows clamped pages and normalized filters`, async () => {
    const h = harness({ pageNumber: 3 });
    const route = h.load(`app/${routeName}/page.tsx`);
    const params = { page: "999", price: "25-50", sort: "price-asc" };
    const metadata = await route.generateMetadata(props(params));
    const nodes = descendants(await route.default(props({ ...params })));
    assert.equal(h.calls.length, 1);
    assert.equal(metadata.alternates.canonical, `/${routeName}?price=25-50&sort=price-asc&page=3`);
    assert.equal(metadata.openGraph.url, `${ORIGIN}${metadata.alternates.canonical}`);
    assert.match(metadata.title, /Page 3$/);
    assert.equal(metadata.robots.index, false);
    assert.equal(metadata.robots.follow, true);
    assert.equal(nodes.find(node => node.props?.initialPage).props.initialPage.pageNumber, 3);
    assert.equal(metadata.openGraph.images[0].url, `${ORIGIN}/products/invitation.jpg`);
  });

  test(`${routeName} uses only a page preview fallback when product photos are unavailable`, async () => {
    const h = harness({ products: [product({ image: "" })] });
    const route = h.load(`app/${routeName}/page.tsx`);
    const metadata = await route.generateMetadata(props({ page: "bad", price: "bad", sort: "bad" }));
    const nodes = descendants(await route.default(props({ page: "bad", price: "bad", sort: "bad" })));
    assert.equal(metadata.alternates.canonical, `/${routeName}`);
    assert.equal(metadata.openGraph.images[0].url, `${ORIGIN}/brand-preview.png`);
    assert.equal(metadata.openGraph.images[0].width, undefined);
    const item = nodes.find(node => node.props?.data?.["@type"] === "ItemList").props.data.itemListElement[0];
    assert.equal(item.image, undefined);
    assert.equal(h.calls.length, 1);
  });

  test(`${routeName} retains its error UI without indexing failed image-free catalogue results`, async () => {
    const h = harness({ failure: new Error("Catalogue unavailable") });
    const route = h.load(`app/${routeName}/page.tsx`);
    const metadata = await route.generateMetadata(props({}));
    const nodes = descendants(await route.default(props({})));
    const collection = nodes.find(node => node.props?.initialPage);
    assert.equal(h.calls.length, 1);
    assert.equal(metadata.robots.index, false);
    assert.equal(metadata.openGraph.images[0].url, `${ORIGIN}/brand-preview.png`);
    assert.match(collection.props.errorMessage, /Unable to load/);
    assert.deepEqual(collection.props.initialPage.products, []);
  });
}
