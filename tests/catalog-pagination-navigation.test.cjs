const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://example.test/collections/wedding-card?page=2",
});
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { act } = React;
const { renderToString } = require("react-dom/server");
const { hydrateRoot } = require("react-dom/client");
const h = React.createElement;
test.after(() => dom.window.close());

function page(offset, total = 60) {
  return {
    products: Array.from({ length: Math.max(0, Math.min(24, total - offset)) }, (_, index) => ({ slug: `card-${offset + index + 1}` })),
    total,
    nextOffset: offset + 24 < total ? offset + 24 : null,
  };
}

// Exercise real React state/effects and real pagination markup. Only history
// storage, document navigation and the catalogue network boundary are replaced.
function harness({ paginationPath = "/collections/wedding-card" } = {}) {
  const requests = [];
  const navigations = [];
  const modules = new Map();
  let current;
  const initialPage = page(24);
  const scope = { subjects: ["Wedding Card"] };
  const mocks = {
    "@/components/useProductListHistory": {
      useProductListHistory: () => ({
        listRef: React.useRef(null),
        restoreSnapshot: React.useCallback(() => null, []),
      }),
    },
  };
  function load(relative) {
    const filename = path.resolve(__dirname, "..", relative);
    if (modules.has(filename)) return modules.get(filename);
    const loaded = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    new Function("require", "module", "exports", "window", "fetch", compiled)(name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("@/")) {
        const target = [`${name.slice(2)}.ts`, `${name.slice(2)}.tsx`]
          .find(candidate => existsSync(path.resolve(__dirname, "..", candidate)));
        assert.ok(target, `Module exists: ${name}`);
        return load(target);
      }
      return require(name);
    }, loaded, loaded.exports,
    { location: { assign: url => navigations.push(url) } },
    async (url, options) => {
      requests.push({ url, options });
      const query = new URL(url, "https://example.test").searchParams;
      return { ok: true, json: async () => page(Number(query.get("offset")), 50) };
    });
    modules.set(filename, loaded.exports);
    return loaded.exports;
  }
  const { useCatalogPagination } = load("components/useCatalogPagination.ts");
  const Pagination = load("components/ProductPagination.tsx").default;
  function Probe() {
    current = useCatalogPagination(initialPage, scope, { paginationPath, initialPageNumber: 2 });
    return h("div", null,
      h("p", { "data-range": true }, `${current.rangeStart}-${current.rangeEnd} of ${current.page.total}`),
      h(Pagination, { currentPage: current.currentPage, totalPages: current.totalPages,
        onPageChange: current.goToPage, getPageHref: current.getPageHref, disabled: Boolean(current.loading) }),
    );
  }
  return {
    requests, navigations, get current() { return current; },
    html: () => renderToString(h(Probe)),
    async mount(t) {
      const container = document.createElement("div");
      container.innerHTML = this.html();
      document.body.appendChild(container);
      const hydrationErrors = [];
      let root;
      await act(() => { root = hydrateRoot(container, h(Probe), { onRecoverableError: error => hydrationErrors.push(error) }); });
      t.after(async () => { await act(() => root.unmount()); container.remove(); });
      assert.deepEqual(hydrationErrors, []);
      return container;
    },
  };
}

test("server page 2 renders and hydrates its own range and crawlable page links", async t => {
  const state = harness();
  const rendered = new JSDOM(state.html());
  t.after(() => rendered.window.close());
  const document = rendered.window.document;
  assert.equal(document.querySelector("[data-range]").textContent, "25-48 of 60");
  assert.equal(document.querySelector('a[aria-label="Previous page"]').getAttribute("href"), "/collections/wedding-card");
  assert.equal(document.querySelector('a[aria-label="Next page"]').getAttribute("href"), "/collections/wedding-card?page=3");
  assert.equal(document.querySelector('a[aria-current="page"]').getAttribute("href"), "/collections/wedding-card?page=2");
  const container = await state.mount(t);
  assert.equal(container.querySelector("[data-range]").textContent, "25-48 of 60");
  assert.equal(state.requests.length, 0, "hydration should use the server's product page");
});

test("temporary filters use API pagination and clearing them navigates to page one's document", async t => {
  const state = harness();
  const container = await state.mount(t);
  await act(async () => state.current.setPrice("under-100"));
  assert.equal(state.current.currentPage, 1);
  assert.equal(state.current.getPageHref, undefined);
  assert.equal(container.querySelectorAll("nav a").length, 0);
  assert.equal(state.requests.length, 1);
  let query = new URL(state.requests[0].url, "https://example.test").searchParams;
  assert.equal(query.get("offset"), "0");
  assert.equal(query.get("price"), "under-100");
  assert.equal(query.get("subjects"), "Wedding Card");
  await act(async () => container.querySelector('button[aria-label="Next page"]').click());
  assert.equal(container.querySelector("[data-range]").textContent, "25-48 of 50");
  query = new URL(state.requests[1].url, "https://example.test").searchParams;
  assert.equal(query.get("offset"), "24");
  assert.equal(query.get("price"), "under-100");
  await act(async () => state.current.clearFilters());
  assert.deepEqual(state.navigations, ["/collections/wedding-card"]);
  assert.equal(state.requests.length, 2, "reset should load a document with matching metadata, not mutate page 2 in place");
});

test("returning the sort to its default also restores page one's document", async t => {
  const state = harness();
  await state.mount(t);
  await act(async () => state.current.setSort("price-asc"));
  assert.equal(state.current.sort, "price-asc");
  assert.equal(state.current.getPageHref, undefined);
  await act(async () => state.current.setSort("featured"));
  assert.deepEqual(state.navigations, ["/collections/wedding-card"]);
  assert.equal(state.requests.length, 1);
});

test("embedded lists without document pagination preserve their API-only filter behavior", async t => {
  const state = harness({ paginationPath: null });
  await state.mount(t);
  await act(async () => state.current.setPrice("under-100"));
  await act(async () => state.current.clearFilters());
  assert.deepEqual(state.navigations, []);
  assert.equal(state.requests.length, 2);
  assert.equal(state.current.currentPage, 1);
  assert.equal(state.current.price, "all");
  assert.equal(state.current.getPageHref, undefined);
});
