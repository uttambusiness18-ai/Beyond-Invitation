const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://example.test";

// Execute real image selection and page metadata, replacing catalogue I/O and
// presentation components only. No remote photo or database request is needed.
function harness({ products = [], failure } = {}) {
  const modules = new Map();
  const requests = [];
  const mocks = {
    "server-only": {},
    "@/lib/products": { getAllCategories: async () => [] },
    "@/lib/catalog": { fetchErpProductPage: async (...args) => {
      requests.push(args);
      if (failure) throw failure;
      return { products, nextOffset: null, total: products.length };
    } },
  };
  function load(relative) {
    const filename = path.resolve(ROOT, relative);
    if (modules.has(filename)) return modules.get(filename);
    const loaded = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    new Function("require", "module", "exports", "process", compiled)(name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("@/components/")) return { default: () => null };
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? path.join(ROOT, name.slice(2)) : path.resolve(path.dirname(filename), name);
        const target = [`${base}.ts`, `${base}.tsx`].find(existsSync);
        assert.ok(target, `Module exists: ${name}`);
        return load(path.relative(ROOT, target));
      }
      return require(name);
    }, loaded, loaded.exports, { env: { NEXT_PUBLIC_SITE_URL: ORIGIN } });
    modules.set(filename, loaded.exports);
    return loaded.exports;
  }
  return { load, requests };
}

test("public product images retain gallery order and normalize direct, local and protocol-relative URLs", () => {
  const { getPublicProductImageUrls } = harness().load("lib/seo-images.ts");
  assert.deepEqual(getPublicProductImageUrls([
    " front.jpg ", "/products/front.jpg", "/products/back.jpg",
    "https://cdn.example.test/card.jpg?width=1200&quality=85",
    "//cdn.example.test/side.webp", "HTTPS://CDN.EXAMPLE.TEST/other.png",
  ]), [
    `${ORIGIN}/products/front.jpg`, `${ORIGIN}/products/back.jpg`,
    "https://cdn.example.test/card.jpg?width=1200&quality=85",
    "https://cdn.example.test/side.webp", "https://cdn.example.test/other.png",
  ]);
});

test("product image discovery omits absent photos, private files, video, non-web URLs and brand placeholders", () => {
  const { getPublicProductImageUrls } = harness().load("lib/seo-images.ts");
  assert.deepEqual(getPublicProductImageUrls(), []);
  assert.deepEqual(getPublicProductImageUrls([
    "", "   ", "/private/files/card.jpg", "https://erp.example.test/private/files/card.jpg",
    "https://erp.example.test/%70rivate/files/card.jpg", "/products/tour.mp4",
    "https://www.youtube.com/watch?v=card", "https://vimeo.com/123",
    "data:image/png;base64,AAAA", "javascript:alert(1)", "ftp://cdn.example.test/card.jpg",
    "https://name:password@cdn.example.test/card.jpg", "/logo.png", `${ORIGIN}/logo.png?v=2#brand`,
  ]), []);
});

test("page previews choose only photographed products from that page and keep their visible names", () => {
  const { getProductPreviewImages } = harness().load("lib/seo-images.ts");
  const products = [
    { name: "Missing photo", images: [] },
    { name: "Placeholder", images: ["/logo.png"] },
    { name: "AC-623", printName: "Aakarshak", images: ["front.jpg", "back.jpg"] },
    { name: "Duplicate", image: "/products/front.jpg" },
    { name: "Bengali card", image: "bengali.jpg" },
  ];
  assert.deepEqual(getProductPreviewImages(products), [{ url: `${ORIGIN}/products/front.jpg`, alt: "AC-623 (Aakarshak)" }]);
  assert.deepEqual(getProductPreviewImages(products, 3), [
    { url: `${ORIGIN}/products/front.jpg`, alt: "AC-623 (Aakarshak)" },
    { url: `${ORIGIN}/products/bengali.jpg`, alt: "Bengali card" },
  ]);
  assert.deepEqual(getProductPreviewImages(products, 0), []);
});

test("homepage previews use an actual displayed catalogue photo without fabricated remote dimensions", async () => {
  const env = harness({ products: [
    { name: "Photo pending", images: [] },
    { name: "AC-623", printName: "Aakarshak", images: ["https://cdn.example.test/ac623-front.jpg", "https://cdn.example.test/ac623-back.jpg"] },
  ] });
  const metadata = await env.load("app/page.tsx").generateMetadata();
  const expected = [{ url: "https://cdn.example.test/ac623-front.jpg", alt: "AC-623 (Aakarshak)" }];
  assert.deepEqual(metadata.openGraph.images, expected);
  assert.deepEqual(metadata.twitter.images, expected);
  assert.equal(metadata.alternates.canonical, "/");
  assert.deepEqual(env.requests, [[0, true]], "preview reads the same first priced collection shown on the homepage");
});

test("homepage uses the real logo when the catalogue has no usable photo or is unavailable", async () => {
  for (const scenario of [{ products: [] }, { products: [{ name: "No image", images: ["/private/files/card.jpg"] }] }, { failure: new Error("Catalogue unavailable") }]) {
    const metadata = await harness(scenario).load("app/page.tsx").generateMetadata();
    assert.equal(metadata.openGraph.images[0].url, `${ORIGIN}/logo.png`);
    assert.equal(metadata.openGraph.images[0].alt, "Beyond Invitation logo");
    assert.equal(new URL(metadata.twitter.images[0], ORIGIN).href, `${ORIGIN}/logo.png`);
    const image = await sharp(path.join(ROOT, "public/logo.png")).metadata();
    assert.equal(metadata.openGraph.images[0].width, image.width);
    assert.equal(metadata.openGraph.images[0].height, image.height);
  }
});

test("business imagery identifies the actual storefront while the logo remains a separate asset", async () => {
  const business = harness().load("lib/business-schema.ts").getBusinessIdentity();
  assert.equal(business.image, `${ORIGIN}/visit-us/bharat-agency-storefront.jpg`);
  assert.ok(existsSync(path.join(ROOT, "public", new URL(business.image).pathname)));
  assert.equal(business.logo.url, `${ORIGIN}/logo.png`);
  const image = await sharp(path.join(ROOT, "public/logo.png")).metadata();
  assert.equal(business.logo.width, image.width);
  assert.equal(business.logo.height, image.height);
  assert.notEqual(business.image, business.logo.url);
});

test("Bengali collection previews follow supplied page products instead of editorial artwork", () => {
  const { getBengaliMetadata } = harness().load("lib/bengali-wedding-seo.ts");
  const metadata = getBengaliMetadata({ page: "2" }, 2, [
    { name: "No photo", image: "" },
    { name: "Bengali 42", printName: "Lotus", image: "/products/bengali42.jpg" },
  ]);
  assert.deepEqual(metadata.openGraph.images, [{ url: `${ORIGIN}/products/bengali42.jpg`, alt: "Bengali 42 (Lotus)" }]);
  assert.deepEqual(metadata.twitter.images, metadata.openGraph.images);
  assert.equal(metadata.alternates.canonical, "/collections/wedding-card-bengali?page=2");
  assert.equal(getBengaliMetadata({}).openGraph.images[0].url, `${ORIGIN}/logo.png`);
});
