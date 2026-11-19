const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");

const projectRoot = path.resolve(__dirname, "..");
const range = (id = "affordable") => ({ id, title: id, price: "MRP below ₹50" });
const page = (pageNumber, total = 60) => {
  const offset = (pageNumber - 1) * 24;
  return {
    products: Array.from({ length: Math.max(0, Math.min(24, total - offset)) }, (_, index) => ({ slug: `card-${offset + index + 1}`, name: `Design ${offset + index + 1}` })),
    total, nextOffset: offset + 24 < total ? offset + 24 : null,
  };
};
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

function environment(initialResponses = []) {
  const dom = new JSDOM('<button id="trigger">Open catalogue</button><div id="root"></div>', { url: "https://example.test/", pretendToBeVisual: true });
  const { window } = dom;
  const globals = { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  const requests = [], responses = [...initialResponses], scrolls = [];
  let backgroundScrolls = 0;
  window.scrollTo = () => { backgroundScrolls++; };
  window.HTMLElement.prototype.scrollTo = function (options) { scrolls.push({ element: this, options }); };
  window.document.getElementById("trigger").focus();
  const modules = new Map();
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const module = { exports: {} };
    const { outputText } = ts.transpileModule(readFileSync(path.join(projectRoot, relative), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: relative,
    });
    vm.runInNewContext(outputText, {
      module, exports: module.exports, window, document: window.document, HTMLElement: window.HTMLElement,
      getComputedStyle: window.getComputedStyle.bind(window), URLSearchParams, AbortController,
      async fetch(url, options) {
        requests.push({ url, options });
        const response = await responses.shift();
        assert.ok(response, `Unexpected catalogue request: ${url}`);
        if (response instanceof Error) throw response;
        return { ok: true, json: async () => response };
      },
      require(name) {
        if (name === "@/components/ProductCard") return { __esModule: true, default: ({ product }) => React.createElement("article", { "data-product": product.slug }, product.name) };
        if (name === "@/components/ProductPagination") return load("components/ProductPagination.tsx");
        if (name === "@/lib/catalog-browse-options") return { COLLECTION_PAGE_SIZE: 24 };
        if (name === "lucide-react") return { X: () => null };
        assert.ok(["react", "react-dom", "react/jsx-runtime"].includes(name), `Unexpected dependency: ${name}`);
        return require(name);
      },
    }, { filename: relative });
    modules.set(relative, module.exports);
    return module.exports;
  }
  const Component = load("components/home/CatalogueModal.tsx").default;
  const root = createRoot(window.document.getElementById("root"));
  return {
    window, requests, responses, scrolls,
    get backgroundScrolls() { return backgroundScrolls; },
    get products() { return [...window.document.querySelectorAll("[data-product]")].map((node) => node.dataset.product); },
    get currentPage() { return window.document.querySelector('[aria-current="page"]')?.textContent; },
    async mount(selectedRange = range()) { await act(async () => root.render(React.createElement(Component, { range: selectedRange, onClose() {} }))); },
    async click(label) {
      const button = [...window.document.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === label || node.textContent === label);
      assert.ok(button, `Missing button ${label}`);
      await act(async () => button.click());
    },
    async resolve(pending, result) { await act(async () => pending.resolve(result)); },
    async close() {
      await act(async () => root.unmount());
      window.close();
      for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
    },
  };
}

test("catalogue modal replaces products with numbered pages and scrolls only its own results", async () => {
  const view = environment([page(1)]);
  try {
    await view.mount();
    assert.equal(view.products.length, 24);
    assert.equal(view.currentPage, "1");
    assert.equal(view.scrolls.length, 0);
    const pending = deferred();
    view.responses.push(pending.promise);
    await view.click("Next page");
    assert.equal(view.products[0], "card-1", "Keep the current products while requesting the next page");
    assert.ok([...view.window.document.querySelectorAll("nav button")].every((button) => button.disabled));
    await view.resolve(pending, page(2));
    assert.equal(view.products.length, 24);
    assert.equal(view.products[0], "card-25");
    assert.equal(view.currentPage, "2");
    assert.match(view.window.document.body.textContent, /Showing 25–48 of 60 designs/);
    assert.equal(view.scrolls.length, 1);
    assert.equal(view.scrolls[0].options.top, 0);
    assert.equal(view.window.document.activeElement, view.scrolls[0].element);
    assert.ok(view.scrolls[0].element.closest("dialog"));
    assert.equal(view.backgroundScrolls, 0);
    view.responses.push(page(3));
    await view.click("Go to page 3");
    assert.equal(view.products.length, 12);
    assert.equal(view.currentPage, "3");
    assert.match(view.window.document.body.textContent, /Showing 49–60 of 60 designs/);
    assert.equal(view.window.document.querySelector('[aria-label="Next page"]').disabled, true);
    view.responses.push(page(2));
    await view.click("Previous page");
    assert.equal(view.currentPage, "2");
    assert.deepEqual(view.requests.map(({ url }) => new URL(url, "https://example.test").searchParams.get("offset")), ["0", "24", "48", "24"]);
    assert.ok(view.requests.every(({ url }) => new URL(url, "https://example.test").searchParams.get("range") === "affordable"));
  } finally { await view.close(); }
});

test("a failed modal page request retains the current page and retries the failed target", async () => {
  const view = environment([page(1, 48)]);
  try {
    await view.mount();
    view.responses.push(new Error("Temporary outage"));
    await view.click("Next page");
    assert.equal(view.currentPage, "1");
    assert.equal(view.products[0], "card-1");
    assert.equal(view.scrolls.length, 0);
    assert.match(view.window.document.querySelector('[role="alert"]').textContent, /couldn't load/);
    view.responses.push(page(2, 48));
    await view.click("Try again");
    assert.equal(view.currentPage, "2");
    assert.equal(view.products[0], "card-25");
    assert.equal(view.window.document.querySelector('[role="alert"]'), null);
    assert.deepEqual(view.requests.map(({ url }) => new URL(url, "https://example.test").searchParams.get("offset")), ["0", "24", "24"]);
  } finally { await view.close(); }
});

test("changing the modal range aborts the previous request and resets pagination", async () => {
  const pending = deferred();
  const view = environment([pending.promise, page(1, 10)]);
  try {
    await view.mount();
    await view.mount(range("premium"));
    assert.equal(view.requests[0].options.signal.aborted, true);
    assert.equal(new URL(view.requests[1].url, "https://example.test").searchParams.get("range"), "premium");
    assert.equal(view.products.length, 10);
    assert.equal(view.window.document.querySelector("nav"), null);
    await view.resolve(pending, page(3));
    assert.equal(view.products.length, 10, "Ignore the old range's late response");
    assert.match(view.window.document.body.textContent, /Showing 1–10 of 10 designs/);
  } finally { await view.close(); }
});

test("modal pagination clamps a removed final page to the remaining last page", async () => {
  const view = environment([page(1), page(3, 25), page(2, 25)]);
  try {
    await view.mount();
    await view.click("Go to page 3");
    assert.equal(view.currentPage, "2");
    assert.deepEqual(view.products, ["card-25"]);
    assert.match(view.window.document.body.textContent, /Showing 25 of 25 designs/);
    assert.deepEqual(view.requests.map(({ url }) => new URL(url, "https://example.test").searchParams.get("offset")), ["0", "48", "24"]);
  } finally { await view.close(); }
});
