const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");

const projectRoot = path.resolve(__dirname, "..");
const plain = (value) => JSON.parse(JSON.stringify(value));
const page = (slugs, nextOffset = null, total = slugs.length) => ({
  products: slugs.map((slug) => ({ slug, name: slug, price: 150, images: [] })),
  nextOffset,
  total,
});

function environment(options = {}) {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://example.test/collections/cards",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const globals = { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  if (options.storageUnavailable) Object.defineProperty(window, "sessionStorage", { get() { throw new Error("Storage disabled"); } });

  let scrollY = 0, cardHeight = 250;
  const scrolls = [], frames = new Map(), calls = [], responses = [];
  let frameId = 0;
  Object.defineProperty(window, "scrollY", { get: () => scrollY });
  window.scrollTo = ({ top, behavior }) => { scrolls.push({ top, behavior }); scrollY = top; };
  window.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const cards = [...window.document.querySelectorAll("[data-product-slug]")];
    const index = cards.indexOf(this);
    const top = index < 0 ? 0 : 100 + index * 300 - scrollY;
    return { top, bottom: top + cardHeight, left: 0, right: 250, width: 250, height: cardHeight, x: 0, y: top };
  };
  window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["router-tree"] }, "");

  const modules = new Map();
  const radioContext = React.createContext(() => {});
  const motion = {
    revealNew() {}, reorderStart() {}, reorderEnd() {},
    openSheet(element, backdrop) { element.hidden = false; backdrop.hidden = false; },
    closeSheet(element, backdrop) { element.hidden = true; backdrop.hidden = true; },
  };
  const weddingStubs = {
    "@/components/wedding-cards/WeddingCardsMotion": { useWeddingCardsMotion: () => motion },
    "@/components/wedding-cards/WeddingCardTile": {
      __esModule: true,
      default: ({ product }) => React.createElement("article", { "data-product-slug": product.slug, "data-card": product.slug },
        React.createElement("a", { href: `/products/${product.slug}`, onClick: (event) => event.preventDefault() }, product.name)),
    },
    "@/components/ui/button": {
      Button: React.forwardRef(function Button({ children, onPress, isDisabled, variant, ...props }, ref) {
        return React.createElement("button", { ...props, ref, disabled: isDisabled, onClick: onPress }, children);
      }),
    },
    "@/components/ui/label": { Label: ({ children, ...props }) => React.createElement("label", props, children) },
    "@/components/ui/native-select": {
      NativeSelect: ({ children, ...props }) => React.createElement("select", props, children),
      NativeSelectOption: ({ children, ...props }) => React.createElement("option", props, children),
    },
    "@/components/ui/radio-group": {
      RadioGroup: ({ children, value, onChange }) => React.createElement(radioContext.Provider, { value: onChange },
        React.createElement("div", { "data-radio-value": value }, children)),
      RadioGroupItem: function RadioGroupItem({ children, value }) {
        const onChange = React.useContext(radioContext);
        return React.createElement("button", { "data-price-option": value, onClick: () => onChange(value) }, children);
      },
    },
    "lucide-react": { SlidersHorizontal: () => null, X: () => null },
  };
  function load(relative) {
    const filename = path.resolve(projectRoot, relative);
    if (modules.has(filename)) return modules.get(filename);
    const module = { exports: {} };
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: filename,
    });
    vm.runInNewContext(outputText, {
      module, exports: module.exports, window, document: window.document, Element: window.Element,
      URL, URLSearchParams, AbortController,
      async fetch(url, requestOptions) {
        calls.push({ url, options: requestOptions });
        const response = responses.shift();
        assert.ok(response, `Unexpected catalogue request: ${url}`);
        return { ok: true, json: async () => response };
      },
      require(name) {
        if (weddingStubs[name]) return weddingStubs[name];
        if (name.startsWith("@/")) {
          const target = name.slice(2);
          return load(target + (existsSync(path.join(projectRoot, target + ".ts")) ? ".ts" : ".tsx"));
        }
        assert.ok(["react", "react/jsx-runtime"].includes(name), `Unexpected dependency: ${name}`);
        return require(name);
      },
    }, { filename });
    modules.set(filename, module.exports);
    return module.exports;
  }
  const { useCatalogPagination } = load("components/useCatalogPagination.ts");
  const root = createRoot(window.document.getElementById("root"));
  let current;
  function List({ initialPage, scope }) {
    const pagination = useCatalogPagination(initialPage, scope);
    current = pagination;
    return React.createElement("div", { ref: pagination.listRef },
      pagination.page.products.map((product) => React.createElement("article", {
        key: product.slug, "data-product-slug": product.slug, "data-card": product.slug,
      }, React.createElement("a", { href: `/products/${product.slug}`, onClick: (event) => event.preventDefault() }, product.name))),
    );
  }
  return {
    window, calls, responses, scrolls, load,
    get current() { return current; },
    get slugs() { return [...window.document.querySelectorAll("[data-product-slug]")].map((card) => card.dataset.productSlug); },
    setScroll(top) { scrollY = top; },
    setCardHeight(height) { cardHeight = height; },
    forgetModules() { modules.clear(); },
    async mount(initialPage, scope = {}) { await act(async () => root.render(React.createElement(List, { initialPage, scope }))); },
    async mountWedding(initialPage, initialFilters) {
      const WeddingCardsBrowser = load("components/wedding-cards/WeddingCardsBrowser.tsx").default;
      await act(async () => root.render(React.createElement(WeddingCardsBrowser, { initialPage, initialFilters })));
    },
    async clickElement(selector) {
      const element = window.document.querySelector(selector);
      assert.ok(element, `Missing ${selector}`);
      await act(async () => element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })));
    },
    async clickButton(text) {
      const button = [...window.document.querySelectorAll("button")].find((element) => element.textContent === text);
      assert.ok(button, `Missing button: ${text}`);
      await act(async () => button.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })));
    },
    async select(selector, value) {
      const element = window.document.querySelector(selector);
      assert.ok(element, `Missing ${selector}`);
      await act(async () => {
        element.value = value;
        element.dispatchEvent(new window.Event("change", { bubbles: true }));
      });
    },
    async unmount() { await act(async () => root.render(null)); },
    async action(callback) { await act(async () => callback(current)); },
    async click(slug, eventOptions = {}, attributes = {}) {
      const link = window.document.querySelector(`[data-product-slug="${slug}"] a`);
      assert.ok(link, `Product ${slug} must be rendered before navigating`);
      for (const [key, value] of Object.entries(attributes)) link.setAttribute(key, value);
      await act(async () => link.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, ...eventOptions })));
    },
    async traverse(direction) {
      await act(async () => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("History traversal timed out")), 1000);
        window.addEventListener("popstate", () => { clearTimeout(timeout); resolve(); }, { once: true });
        window.history[direction]();
      }));
    },
    async flushFrames() {
      await act(async () => {
        for (let pass = 0; frames.size && pass < 5; pass++) {
          const pending = [...frames.values()];
          frames.clear();
          pending.forEach((callback) => callback(0));
        }
      });
    },
    async close() {
      await act(async () => root.unmount());
      window.close();
      for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
    },
  };
}

test("Back restores appended products, filters, sort, card position, and the next pagination request", async () => {
  const view = environment();
  const initial = page(["initial-1", "initial-2"], 2, 8);
  try {
    await view.mount(initial, { category: "wedding" });
    view.responses.push(page(["filtered-1", "filtered-2"], 2, 8));
    await view.action((list) => list.setPrice("100-300"));
    view.responses.push(page(["filtered-2", "filtered-1"], 2, 8));
    await view.action((list) => list.setSort("price-desc"));
    view.responses.push(page(["appended-1", "appended-2"], 4, 8));
    await view.action((list) => list.loadMore());
    view.setScroll(800);
    await view.click("appended-2");
    const originalHistory = plain(view.window.history.state);
    assert.equal(originalHistory.__NA, true);
    assert.deepEqual(originalHistory.__PRIVATE_NEXTJS_INTERNALS_TREE, ["router-tree"]);
    await view.unmount();
    view.window.history.pushState({}, "", "/products/appended-2");
    view.setScroll(0);
    await view.traverse("back");
    await view.mount(initial, { category: "wedding" });
    assert.deepEqual(view.slugs, ["filtered-2", "filtered-1", "appended-1", "appended-2"]);
    assert.equal(view.current.price, "100-300");
    assert.equal(view.current.sort, "price-desc");
    assert.equal(view.current.page.nextOffset, 4);
    assert.equal(view.window.scrollY, 800);
    // A late native restoration must not leave the reopened card below the viewport.
    view.setScroll(40);
    await view.flushFrames();
    assert.equal(view.window.scrollY, 800);
    assert.equal(view.window.document.querySelector('[data-product-slug="appended-2"]').getBoundingClientRect().top, 200);
    assert.ok([...view.window.document.querySelectorAll("[data-card]")].every((card) => card.dataset.revealed === "true"));
    assert.equal(view.calls.length, 3, "Returning should not refetch pages already viewed");
    view.responses.push(page(["last-1", "last-2"], null, 8));
    await view.action((list) => list.loadMore());
    const query = new URL(view.calls.at(-1).url, "https://example.test").searchParams;
    assert.equal(query.get("offset"), "4");
    assert.equal(query.get("price"), "100-300");
    assert.equal(query.get("sort"), "price-desc");
    assert.equal(query.get("category"), "wedding");
    assert.deepEqual(view.slugs, ["filtered-2", "filtered-1", "appended-1", "appended-2", "last-1", "last-2"]);
  } finally { await view.close(); }
});

test("first-page cards restore on repeated Back and Forward, while fresh visits start normally", async () => {
  const view = environment();
  const initial = page(["one", "two", "three"], 3, 6);
  try {
    await view.mount(initial);
    view.setScroll(480);
    await view.click("three");
    await view.unmount();
    view.window.history.pushState({}, "", "/products/three");
    for (let visit = 0; visit < 2; visit++) {
      view.setScroll(0);
      await view.traverse("back");
      await view.mount(initial);
      await view.flushFrames();
      assert.equal(view.window.scrollY, 480);
      assert.deepEqual(view.slugs, ["one", "two", "three"]);
      await view.unmount();
      await view.traverse("forward");
    }
    view.window.history.pushState({}, "", "/collections/cards");
    view.setScroll(0);
    const scrollCount = view.scrolls.length;
    await view.mount(initial);
    await view.flushFrames();
    assert.equal(view.window.scrollY, 0);
    assert.equal(view.scrolls.length, scrollCount, "A fresh visit must not reuse an older history entry's position");
    assert.equal(view.current.price, "all");
    assert.equal(view.current.sort, "featured");
  } finally { await view.close(); }
});

test("modified clicks, new-tab targets, downloads, and non-product links do not save return state", async () => {
  const view = environment();
  try {
    await view.mount(page(["one"]));
    for (const eventOptions of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      await view.click("one", eventOptions);
      assert.equal(view.window.history.state.beyondProductLists, undefined);
    }
    for (const attributes of [{ target: "_blank" }, { target: "_self", download: "card.png" }, { href: "/cart" }]) {
      const link = view.window.document.querySelector("a");
      link.removeAttribute("download");
      link.removeAttribute("target");
      await view.click("one", {}, attributes);
      assert.equal(view.window.history.state.beyondProductLists, undefined);
    }
  } finally { await view.close(); }
});

test("in-memory snapshots restore when session storage is blocked", async () => {
  const view = environment({ storageUnavailable: true });
  const initial = page(["one", "two"], 2, 4);
  try {
    await view.mount(initial);
    view.responses.push(page(["three", "four"], null, 4));
    await view.action((list) => list.loadMore());
    view.setScroll(780);
    await view.click("four");
    await view.unmount();
    view.window.history.pushState({}, "", "/products/four");
    view.setScroll(0);
    await view.traverse("back");
    await view.mount(initial);
    await view.flushFrames();
    assert.deepEqual(view.slugs, ["one", "two", "three", "four"]);
    assert.equal(view.window.scrollY, 780);
  } finally { await view.close(); }
});

test("snapshots survive module reloads and stay isolated by route, query, and list key", async () => {
  const view = environment();
  try {
    let history = view.load("lib/product-list-history.ts");
    view.window.history.replaceState({ __NA: true }, "", "/wedding-cards?price=under-25");
    history.saveProductListSnapshot("wedding:all", { page: page(["budget-card"]), filters: { price: "under-25" } }, { slug: "budget-card", top: 140, scrollY: 1200 });
    const savedState = plain(view.window.history.state);
    view.forgetModules();
    history = view.load("lib/product-list-history.ts");
    assert.equal(history.readProductListSnapshot("wedding:all").data.page.products[0].slug, "budget-card");
    assert.equal(history.readProductListSnapshot("wedding:boxes"), null);
    for (const url of ["/wedding-cards?price=above-100", "/wedding-boxes?price=under-25", "/wedding-cards?price=under-25#different"]) {
      view.window.history.replaceState(savedState, "", url);
      assert.equal(history.readProductListSnapshot("wedding:all"), null, url);
    }
    view.window.history.replaceState({}, "", "/wedding-cards?price=under-25");
    assert.equal(history.readProductListSnapshot("wedding:all"), null);
    view.window.history.replaceState(savedState, "", "/wedding-cards?price=under-25");
    assert.equal(history.readProductListSnapshot("wedding:all").anchor.scrollY, 1200);
  } finally { await view.close(); }
});

test("restoration keeps the product visible after a smaller viewport and yields to manual scrolling", async () => {
  const view = environment();
  const initial = page(["one", "two", "three"]);
  try {
    await view.mount(initial);
    view.setScroll(100);
    await view.click("three");
    await view.unmount();
    view.window.history.pushState({}, "", "/products/three");
    Object.defineProperty(view.window, "innerHeight", { value: 400, configurable: true });
    view.setScroll(0);
    await view.traverse("back");
    await view.mount(initial);
    assert.equal(view.window.document.querySelector('[data-product-slug="three"]').getBoundingClientRect().top, 280);
    view.setScroll(500);
    view.window.dispatchEvent(new view.window.WheelEvent("wheel"));
    await view.flushFrames();
    assert.equal(view.window.scrollY, 500, "User scrolling must cancel pending restoration frames");
  } finally { await view.close(); }
});

test("All Wedding Cards returns to the opened design with Show more results, price, and sort restored", async () => {
  const view = environment();
  const filters = { type: "all", price: "any", sort: "recommended" };
  const weddingPage = (slugs, nextOffset = null) => ({
    ...page(slugs, nextOffset, 8),
    facets: {
      categoryTotal: 8, total: 8, types: [], showPrice: true,
      prices: [{ value: "under-25", label: "Under ₹25", count: 4 }, { value: "above-100", label: "Above ₹100", count: 4 }],
    },
  });
  const initial = weddingPage(["wedding-1", "wedding-2"], 2);
  try {
    view.window.history.replaceState({ __NA: true }, "", "/wedding-cards");
    await view.mountWedding(initial, filters);
    view.responses.push(weddingPage(["budget-1", "budget-2"], 2));
    await view.clickElement('[data-price-option="under-25"]');
    view.responses.push(weddingPage(["budget-2", "budget-1"], 2));
    await view.select('[aria-label="Sort wedding cards"]', "price-desc");
    view.responses.push(weddingPage(["budget-3", "budget-4"], 4));
    await view.clickButton("Show more");
    assert.deepEqual(view.slugs, ["budget-2", "budget-1", "budget-3", "budget-4"]);
    view.setScroll(820);
    await view.click("budget-4");
    const returnUrl = view.window.location.pathname + view.window.location.search;
    assert.equal(new URL(view.window.location.href).searchParams.get("price"), "under-25");
    assert.equal(new URL(view.window.location.href).searchParams.get("sort"), "price-desc");
    await view.unmount();
    view.window.history.pushState({}, "", "/products/budget-4");
    view.setScroll(0);
    await view.traverse("back");
    assert.equal(view.window.location.pathname + view.window.location.search, returnUrl);
    await view.mountWedding(initial, filters);
    await view.flushFrames();
    assert.deepEqual(view.slugs, ["budget-2", "budget-1", "budget-3", "budget-4"]);
    assert.equal(view.window.document.querySelector('[aria-label="Sort wedding cards"]').value, "price-desc");
    assert.equal(view.window.document.querySelector("[data-radio-value]").dataset.radioValue, "under-25");
    assert.equal(view.window.scrollY, 820);
    assert.equal(view.window.document.querySelector('[data-product-slug="budget-4"]').getBoundingClientRect().top, 180);
    assert.equal(view.calls.length, 3);
    view.responses.push(weddingPage(["budget-5", "budget-6"]));
    await view.clickButton("Show more");
    const query = new URL(view.calls.at(-1).url, "https://example.test").searchParams;
    assert.equal(query.get("offset"), "4");
    assert.equal(query.get("price"), "under-25");
    assert.equal(query.get("sort"), "price-desc");
    assert.deepEqual(view.slugs, ["budget-2", "budget-1", "budget-3", "budget-4", "budget-5", "budget-6"]);
    // Changing filters creates a history entry; Back must keep the most recent appended batch.
    view.responses.push(weddingPage(["premium-1", "premium-2"], 2));
    await view.clickElement('[data-price-option="above-100"]');
    assert.deepEqual(view.slugs, ["premium-1", "premium-2"]);
    const callsBeforeBack = view.calls.length;
    await view.traverse("back");
    assert.deepEqual(view.slugs, ["budget-2", "budget-1", "budget-3", "budget-4", "budget-5", "budget-6"]);
    assert.equal(view.window.document.querySelector("[data-radio-value]").dataset.radioValue, "under-25");
    assert.equal(view.calls.length, callsBeforeBack);
  } finally { await view.close(); }
});

test("a partially scrolled card remains visible when its height shrinks before returning", async () => {
  const view = environment();
  const initial = page(["one", "two", "three"]);
  try {
    await view.mount(initial);
    view.setCardHeight(600);
    view.setScroll(1100);
    const card = view.window.document.querySelector('[data-product-slug="three"]');
    assert.equal(card.getBoundingClientRect().top, -400);
    assert.equal(card.getBoundingClientRect().bottom, 200);
    await view.click("three");
    await view.unmount();
    view.window.history.pushState({}, "", "/products/three");
    view.setCardHeight(250);
    view.setScroll(0);
    await view.traverse("back");
    await view.mount(initial);
    await view.flushFrames();
    const returned = view.window.document.querySelector('[data-product-slug="three"]').getBoundingClientRect();
    assert.equal(returned.top, -130);
    assert.equal(returned.bottom, 120, "At least 120 pixels of the shorter card must remain visible");
  } finally { await view.close(); }
});
