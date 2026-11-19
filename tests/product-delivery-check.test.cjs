const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const React = require("react");
const { act } = React;

const projectRoot = path.resolve(__dirname, "..");
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const quoteResponse = (days, pincode = "700040") => response(200, { quote: {
  pincode, currency: "INR", subtotalPaise: 100000, amountPaise: 5000, totalPaise: 105000,
  weightKg: 1, courierId: 1, courierName: "Example Courier", estimatedDeliveryDays: days,
  expiresAt: Date.now() + 300000,
} });
const settle = () => new Promise(resolve => setTimeout(resolve, 15));

async function mount(responses = [], options = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://example.test/products/ivory-card", pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const { createRoot } = require("react-dom/client");
  const calls = [], remembered = [];
  const cart = { deliveryPincode: options.pincode || "", setDeliveryPincode: value => remembered.push(value), addItem() {} };
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const module = { exports: {} };
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
    });
    vm.runInNewContext(outputText, {
      module, exports: module.exports, window: dom.window, document: dom.window.document, AbortController,
      setTimeout: (callback, delay) => setTimeout(callback, delay === 400 ? 0 : delay), clearTimeout,
      async fetch(url, requestOptions) {
        calls.push({ url, options: requestOptions });
        const next = responses.shift();
        assert.ok(next, "Unexpected shipping request");
        if (next instanceof Error) throw next;
        return typeof next === "function" ? next(requestOptions) : next;
      },
      require(name) {
        if (name.endsWith("/CartProvider")) return { useCart: () => cart };
        if (name === "next/navigation") return { useRouter: () => ({ push() {} }) };
        if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
        if (name.startsWith(".") || name.startsWith("@/")) {
          const target = name.startsWith("@/") ? path.join(projectRoot, name.slice(2)) : path.resolve(path.dirname(filename), name);
          for (const suffix of [".ts", ".tsx"]) {
            try { return load(target + suffix); } catch (error) { if (error.code !== "ENOENT") throw error; }
          }
          throw new Error(`Missing local module: ${name}`);
        }
        assert.ok(["react", "react/jsx-runtime", "lucide-react"].includes(name), `Unexpected dependency: ${name}`);
        return require(name);
      },
    }, { filename });
    modules.set(filename, module.exports);
    return module.exports;
  }
  const componentFile = options.product ? "ProductBuyBox.tsx" : "ProductDeliveryCheck.tsx";
  const Component = load(path.join(projectRoot, "components", componentFile)).default;
  let props = options.product ? { product: options.product } : { slug: "ivory-card", itemCode: "WED-1", quantity: 50 };
  const root = createRoot(dom.window.document.getElementById("root"));
  await act(async () => root.render(React.createElement(Component, props)));
  const document = dom.window.document;
  return {
    document, calls, remembered,
    async input(value) {
      const element = document.querySelector("input");
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(element, value);
        element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
    },
    async submit() {
      await act(async () => document.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    },
    async settle() { await act(settle); },
    async update(changes) {
      props = { ...props, ...changes };
      await act(async () => root.render(React.createElement(Component, props)));
    },
    async close() {
      await act(async () => root.unmount()); dom.window.close();
      for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
    },
  };
}

test("product delivery check validates pincode before requesting a quote", async () => {
  const view = await mount();
  try {
    await view.submit();
    assert.match(view.document.querySelector('[role="alert"]').textContent, /six-digit Indian pincode/);
    await view.input("012345");
    await view.submit();
    assert.equal(view.document.querySelector("input").getAttribute("aria-invalid"), "true");
    assert.equal(view.calls.length, 0);
    assert.deepEqual(view.remembered, []);
  } finally { await view.close(); }
});

test("explicit check uses saved pincode and current product quantity and remembers a serviceable pincode", async () => {
  const view = await mount([quoteResponse(4)], { pincode: "700040" });
  try {
    assert.equal(view.document.querySelector("input").value, "700040");
    assert.equal(view.calls.length, 0);
    await view.submit();
    await view.settle();
    assert.equal(view.calls.length, 1);
    assert.equal(view.calls[0].url, "/api/shipping/quote");
    assert.deepEqual(JSON.parse(view.calls[0].options.body), {
      pincode: "700040", service: "standard", items: [{ slug: "ivory-card", itemCode: "WED-1", quantity: 50 }],
    });
    assert.match(view.document.body.textContent, /Estimated delivery: 4 days after dispatch/);
    assert.match(view.document.body.textContent, /Preparation and personalisation time is additional/);
    assert.deepEqual(view.remembered, ["700040"]);
  } finally { await view.close(); }
});

test("editing pincode immediately clears the old estimate and waits for another check", async () => {
  const view = await mount([quoteResponse(4), quoteResponse(6, "110001")], { pincode: "700040" });
  try {
    await view.submit(); await view.settle();
    await view.input("110001");
    assert.doesNotMatch(view.document.body.textContent, /4 days|Delivery available/);
    await view.settle();
    assert.equal(view.calls.length, 1);
    await view.submit(); await view.settle();
    assert.match(view.document.body.textContent, /Delivery available to 110001.*6 days after dispatch/);
    assert.deepEqual(view.remembered, ["700040", "110001"]);
  } finally { await view.close(); }
});

test("quantity changes clear a completed estimate and recalculate with the new quantity", async () => {
  let resolveSecond;
  const view = await mount([quoteResponse(4), () => new Promise(resolve => { resolveSecond = resolve; })], { pincode: "700040" });
  try {
    await view.submit(); await view.settle();
    await view.update({ quantity: 100 }); await view.settle();
    assert.doesNotMatch(view.document.body.textContent, /4 days after dispatch/);
    assert.match(view.document.body.textContent, /Checking delivery/);
    assert.equal(JSON.parse(view.calls[1].options.body).items[0].quantity, 100);
    await act(async () => resolveSecond(quoteResponse(7)));
    assert.match(view.document.body.textContent, /7 days after dispatch/);
  } finally { await view.close(); }
});

test("cancelled responses cannot replace the currently checked pincode", async () => {
  let resolveFirst;
  const view = await mount([() => new Promise(resolve => { resolveFirst = resolve; }), quoteResponse(2, "110001")], { pincode: "700040" });
  try {
    await view.submit(); await view.settle();
    await view.input("110001");
    assert.equal(view.calls[0].options.signal.aborted, true);
    await view.submit(); await view.settle();
    await act(async () => resolveFirst(quoteResponse(8)));
    assert.match(view.document.body.textContent, /Delivery available to 110001.*2 days after dispatch/);
    assert.doesNotMatch(view.document.body.textContent, /8 days/);
    assert.deepEqual(view.remembered, ["110001"]);
  } finally { await view.close(); }
});

test("unserviceable or unavailable quotes can retry and missing ETA does not invent a delivery time", async () => {
  const view = await mount([
    response(422, { error: "Delivery is currently unavailable for this pincode." }),
    new Error("Network unavailable"),
    quoteResponse(null),
  ], { pincode: "700040" });
  try {
    await view.submit(); await view.settle();
    assert.match(view.document.body.textContent, /Delivery is currently unavailable/);
    assert.equal(view.document.querySelector('button[type="submit"]').textContent, "Try again");
    assert.deepEqual(view.remembered, []);
    await view.submit(); await view.settle();
    assert.match(view.document.body.textContent, /Shipping could not be calculated/);
    await view.submit(); await view.settle();
    assert.match(view.document.body.textContent, /Delivery available to 700040/);
    assert.match(view.document.body.textContent, /An estimated delivery time is not available yet/);
    assert.doesNotMatch(view.document.body.textContent, /days after dispatch|Shipping could not be calculated/);
  } finally { await view.close(); }
});

test("price-on-request products direct customers to contact with pincode and quantity", async () => {
  const view = await mount([], { product: { slug: "custom-box", price: 0, name: "Custom Box", category: "luxe" } });
  try {
    assert.equal(view.document.querySelector("form"), null);
    assert.match(view.document.querySelector("a").getAttribute("href"), /contact\?product=custom-box/);
    assert.match(view.document.body.textContent, /pincode and quantity.*estimated delivery time/);
    assert.equal(view.calls.length, 0);
  } finally { await view.close(); }
});
