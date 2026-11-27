const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");

const ORIGIN = "https://example.test";
const PAGE = "app/products/[slug]/page.tsx";
const props = slug => ({ params: Promise.resolve({ slug }) });

// Execute the route and its metadata together. Only catalogue I/O, Next's
// not-found signal, and presentation components are replaced.
function harness(lookup, { featuredProducts = [] } = {}) {
  const modules = new Map();
  const requests = [];
  let notFoundCalls = 0;
  const missing = Object.assign(new Error("Not found"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  const presentation = () => null;
  const mocks = {
    "next/navigation": { notFound() { notFoundCalls++; throw missing; } },
    "next/link": { default: presentation },
    "@/lib/catalog": {
      fetchErpProductBySlug: async slug => { requests.push(slug); return lookup(slug); },
      fetchRelatedErpProducts: async () => [],
      fetchErpProductsBySlugs: async () => featuredProducts,
      fetchErpProductPage: async () => ({ products: [], nextOffset: null, total: 0 }),
    },
    "@/lib/catalog-item-category": {
      fetchItemCategoryProductPage: async () => ({ products: [], nextOffset: null, total: 0 }),
    },
    "@/components/ProductGrid": { ProductGrid: presentation, ProductSection: presentation },
    "@/components/Sections": { FeatureStrip: presentation, SaleCollection: presentation },
    ...Object.fromEntries(["ProductGallery", "ProductBuyBox", "WishlistButton", "ProductPrice"]
      .map(name => [`@/components/${name}`, { default: presentation }])),
  };
  function load(relativePath) {
    const filename = path.resolve(__dirname, "..", relativePath);
    if (modules.has(filename)) return modules.get(filename);
    const loaded = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    new Function("require", "module", "exports", "process", compiled)(name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/")
          ? path.resolve(__dirname, "..", name.slice(2))
          : path.resolve(path.dirname(filename), name);
        const target = [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find(existsSync);
        assert.ok(target, `Module exists: ${name}`);
        return load(path.relative(path.resolve(__dirname, ".."), target));
      }
      return require(name);
    }, loaded, loaded.exports, { env: { NEXT_PUBLIC_SITE_URL: ORIGIN } });
    modules.set(filename, loaded.exports);
    return loaded.exports;
  }
  return { route: load(PAGE), load, requests, missing, get notFoundCalls() { return notFoundCalls; } };
}

function structuredData(element) {
  return React.Children.toArray(element.props.children)
    .filter(child => child.props?.data)
    .map(child => JSON.parse(child.type(child.props).props.dangerouslySetInnerHTML.__html));
}

const publishedProduct = {
  slug: "g22201", name: "G22201", printName: "Floral wedding invitation", itemCode: "G22201",
  category: "wedding", subject: "Common", description: "A floral invitation with matching envelope.",
  price: 25, mrp: 30, images: ["g22201.jpg"], videos: [], emoji: "",
};

for (const entry of ["default", "generateMetadata"]) {
  const label = entry === "default" ? "product page" : "product metadata";
  test(`${label} signals notFound only when the lookup returns no record`, async () => {
    const h = harness(async () => null);
    await assert.rejects(h.route[entry](props("g222-01")), error => error === h.missing);
    assert.equal(h.notFoundCalls, 1);
    assert.deepEqual(h.requests, ["g222-01"]);
  });

  for (const message of [
    "Product catalogue unavailable: permission denied",
    "Product catalogue unavailable: request timed out",
    "Product prices unavailable: upstream service unavailable",
  ]) {
    test(`${label} propagates ${message}`, async () => {
      const failure = new Error(message);
      const h = harness(async () => { throw failure; });
      await assert.rejects(h.route[entry](props("g22201")), error => error === failure);
      assert.equal(h.notFoundCalls, 0);
      assert.deepEqual(h.requests, ["g22201"]);
    });
  }
}

test("published product keeps its exact lookup slug, canonical URL and indexable metadata", async () => {
  const product = {
    slug: "g22201", name: "Floral wedding invitation", itemCode: "G22201",
    category: "wedding", subject: "Common", description: "A floral invitation with matching envelope.",
    price: 25, mrp: 30, images: ["/products/g22201.jpg"], videos: [], emoji: "",
  };
  const h = harness(async () => product);
  const metadata = await h.route.generateMetadata(props(product.slug));
  assert.equal(metadata.alternates.canonical, `${ORIGIN}/products/g22201`);
  assert.equal(metadata.openGraph.url, metadata.alternates.canonical);
  assert.equal(metadata.robots.index, true);
  assert.equal(metadata.robots.googleBot.index, true);
  assert.equal(metadata.other["product:retailer_item_id"], "G22201");
  assert.ok(React.isValidElement(await h.route.default(props(product.slug))));
  assert.equal(h.notFoundCalls, 0);
  assert.deepEqual(h.requests, ["g22201", "g22201"]);
});

test("product metadata and server-rendered schema describe the visible name, unit price and minimum order", async () => {
  for (const [subject, minimum] of [["Common", 50], ["Wedding Box", 25]]) {
    const product = { ...publishedProduct, subject };
    const h = harness(async () => product);
    const metadata = await h.route.generateMetadata(props(product.slug));
    const schemas = structuredData(await h.route.default(props(product.slug)));
    const schema = schemas.find(item => item["@type"] === "Product");
    assert.match(metadata.title, /G22201 \(Floral wedding invitation\)/);
    assert.equal(schema.name, "G22201 (Floral wedding invitation)");
    assert.deepEqual(schema.image, [`${ORIGIN}/products/g22201.jpg`]);
    assert.equal(metadata.openGraph.images[0].url, schema.image[0]);
    assert.equal(schema.url, metadata.alternates.canonical);
    assert.equal(schema.offers.price, product.price);
    assert.equal(schema.offers.priceCurrency, "INR");
    assert.equal(schema.offers.eligibleQuantity.minValue, minimum);
    assert.equal(schema.offers.priceSpecification.referenceQuantity.value, 1);
    assert.equal(schema.offers.priceSpecification.referenceQuantity.unitText, "piece");
    assert.equal(schema.offers.priceSpecification.valueAddedTaxIncluded, true);
    assert.match(schema.offers.description, /Printing charges are additional/);
    assert.equal(schema.offers.availability, undefined, "do not invent stock availability");
    assert.equal(schema.aggregateRating, undefined, "do not invent ratings");
    assert.equal(schemas.find(item => item["@type"] === "BreadcrumbList").itemListElement[2].name, schema.name);
  }
});

test("unknown and invalid prices never become free or malformed product offers", async () => {
  for (const price of [0, -1, NaN, Infinity]) {
    const product = { ...publishedProduct, price };
    const h = harness(async () => product);
    const metadata = await h.route.generateMetadata(props(product.slug));
    const schema = structuredData(await h.route.default(props(product.slug))).find(item => item["@type"] === "Product");
    assert.equal(schema.offers, undefined);
    assert.equal(metadata.other["product:price:amount"], undefined);
    assert.equal(metadata.other["og:price:amount"], undefined);
  }
});

test("discovery includes public gallery images and escapes embedded product text", async () => {
  const product = {
    ...publishedProduct,
    name: 'Wedding </script><script>alert("x")</script>',
    images: ["/private/files/design.jpg", "https://erp.example.test/private/files/design.jpg", "g22201.jpg"],
  };
  const h = harness(async () => product);
  const page = await h.route.default(props(product.slug));
  const node = React.Children.toArray(page.props.children).find(child => child.props?.data?.["@type"] === "Product");
  const json = node.type(node.props).props.dangerouslySetInnerHTML.__html;
  assert.equal(json.includes("</script>"), false);
  assert.deepEqual(JSON.parse(json).image, [`${ORIGIN}/products/g22201.jpg`]);
  assert.equal(JSON.parse(json).name, `${product.name} (${product.printName})`);
});

test("homepage product discovery uses the same image path and visible name without fabricated stock claims", async () => {
  const h = harness(async () => null, { featuredProducts: [publishedProduct, { ...publishedProduct, slug: "quote-only", price: 0 }] });
  const page = await h.load("components/home/HomeProducts.tsx").default({ description: "Wedding invitations" });
  const schema = structuredData(page).find(item => item["@type"] === "ItemList");
  const product = schema.itemListElement[0].item;
  assert.equal(product.image, `${ORIGIN}/products/g22201.jpg`);
  assert.equal(product.name, "G22201 (Floral wedding invitation)");
  assert.equal(product.offers.price, 25);
  assert.equal(product.offers.availability, undefined);
  assert.equal(schema.itemListElement[1].item.offers, undefined);
});
