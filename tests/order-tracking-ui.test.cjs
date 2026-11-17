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
const orderId = "11111111-2222-4333-8444-555555555555";
const fixture = (overrides = {}) => ({
  state: "tracking", status: "IN TRANSIT", courierName: "Example courier", awb: "AWB123",
  trackingUrl: null, estimatedDeliveryAt: "2026-11-20T10:00:00.000Z", deliveredAt: null,
  checkedAt: "2026-11-17T10:00:00.000Z",
  events: [{ date: "2026-11-16T10:00:00.000Z", status: "Picked up", location: "Kolkata" }],
  ...overrides,
});

async function mount(responses, props = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const calls = [];
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const module = { exports: {} };
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: filename,
    });
    vm.runInNewContext(outputText, {
      module, exports: module.exports, URL, AbortController, setTimeout, clearTimeout,
      async fetch(url, options) {
        calls.push({ url, options });
        const response = responses.shift();
        assert.ok(response, "Unexpected tracking request");
        return { ok: response.status === 200, status: response.status, json: async () => response.body };
      },
      require(name) {
        if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, key) => key === "__esModule" ? false : String(key) });
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
  const Component = load(path.join(projectRoot, "components/account/OrderTracking.tsx")).default;
  const root = createRoot(dom.window.document.getElementById("root"));
  await act(async () => root.render(React.createElement(Component, { orderId, ...props })));
  return {
    document: dom.window.document, calls,
    async click() {
      await act(async () => dom.window.document.querySelector("button").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    },
    async close() {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test("Track order loads real progress on click and keeps future milestones pending", async () => {
  const view = await mount([{ status: 200, body: { tracking: fixture() } }]);
  try {
    assert.equal(view.calls.length, 0);
    assert.equal(view.document.querySelector('[role="region"]').hidden, true);
    assert.equal(view.document.querySelector('[aria-label="Delivery progress"]'), null);
    await view.click();
    assert.equal(view.calls[0].url, `/api/account/orders/${orderId}/tracking`);
    assert.equal(view.document.querySelector('[role="region"]').hidden, false);
    assert.equal(view.document.querySelector("button").getAttribute("aria-expanded"), "true");
    const steps = [...view.document.querySelectorAll('[aria-label="Delivery progress"] > li')];
    assert.equal(steps.length, 5);
    assert.match(steps.find((step) => step.getAttribute("aria-current") === "step").textContent, /Shipped/);
    assert.equal(steps[4].dataset.state, "upcoming");
    assert.match(view.document.querySelector('[aria-label="Courier activity, latest first"]').textContent, /Picked up.*Kolkata/);
    assert.match(view.document.querySelector('[aria-live="polite"]').textContent, /IN TRANSIT/);
  } finally { await view.close(); }
});

test("guest tracking shows cancellation without a delivered milestone or stale delivery estimate", async () => {
  const token = "A".repeat(43);
  const view = await mount([{ status: 200, body: { tracking: fixture({ status: "CANCELED", events: [], deliveredAt: "2026-11-17T10:00:00.000Z" }) } }], { trackingToken: token });
  try {
    await view.click();
    assert.equal(view.calls[0].url, "/api/orders/tracking");
    assert.equal(view.calls[0].options.method, "POST");
    assert.deepEqual(JSON.parse(view.calls[0].options.body), { orderId, token });
    const progress = view.document.querySelector('[aria-label="Delivery progress"]');
    assert.equal(progress.children.length, 2);
    assert.match(progress.querySelector('[aria-current="step"]').textContent, /Shipment cancelled/);
    assert.doesNotMatch(progress.textContent, /Shipped|Out for delivery|Delivered/);
    assert.ok(![...view.document.querySelectorAll("dt")].some((label) => /delivery|delivered/i.test(label.textContent)));
  } finally { await view.close(); }
});

test("failed refresh preserves the previous timeline and labels it out of date", async () => {
  const view = await mount([{ status: 200, body: { tracking: fixture() } }, { status: 503 }]);
  try {
    await view.click();
    const before = view.document.querySelector('[aria-label="Delivery progress"]').textContent;
    await view.click();
    assert.equal(view.calls.length, 2);
    assert.equal(view.document.querySelector('[aria-label="Delivery progress"]').textContent, before);
    assert.match(view.document.querySelector('[role="alert"]').textContent, /may be out of date/);
    assert.match(view.document.querySelector("button").textContent, /Retry tracking/);
  } finally { await view.close(); }
});
