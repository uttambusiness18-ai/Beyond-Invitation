const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const React = require("react");
const { act } = React;

const projectRoot = path.resolve(__dirname, "..");
const order = {
  id: "11111111-2222-4333-8444-555555555555", reference: "Order #11111111",
  date: "17 Nov 2026", amount: "₹1,195.00", status: "paid", itemCount: 50,
  items: [], paymentReference: "",
};
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function success(options) {
  const input = JSON.parse(options.body);
  return response(201, { request: {
    id: input.requestId, orderId: input.orderId, topic: input.topic, message: input.message,
    status: "open", createdAt: "2026-11-17T10:00:00.000Z", updatedAt: "2026-11-17T10:00:00.000Z",
  } });
}

async function mount(responses, orders = [order]) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/account", pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const { createRoot } = require("react-dom/client");
  const calls = [];
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    if (path.basename(filename) === "AccountMotion.tsx") return { useAccountMotion: () => ({ open() {}, close() {} }) };
    if (path.basename(filename) === "OrderTracking.tsx") return { default: () => null, __esModule: true };
    const module = { exports: {} };
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: filename,
    });
    vm.runInNewContext(outputText, {
      module, exports: module.exports, window: dom.window, document: dom.window.document,
      HTMLElement: dom.window.HTMLElement, getComputedStyle: dom.window.getComputedStyle,
      AbortController, crypto: { randomUUID },
      async fetch(url, options) {
        calls.push({ url, options });
        const next = responses.shift();
        assert.ok(next, "Unexpected help request");
        return typeof next === "function" ? next(options) : next;
      },
      require(name) {
        if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
        if (name.startsWith(".") || name.startsWith("@/")) {
          const target = name.startsWith("@/") ? path.join(projectRoot, name.slice(2)) : path.resolve(path.dirname(filename), name);
          for (const suffix of [".ts", ".tsx"]) {
            try { return load(target + suffix); } catch (error) { if (error.code !== "ENOENT") throw error; }
          }
          throw new Error(`Missing local module: ${name}`);
        }
        assert.ok(["react", "react-dom", "react/jsx-runtime", "lucide-react"].includes(name), `Unexpected dependency: ${name}`);
        return require(name);
      },
    }, { filename });
    modules.set(filename, module.exports);
    return module.exports;
  }
  const Component = load(path.join(projectRoot, "components/account/AccountOrders.tsx")).default;
  const root = createRoot(dom.window.document.getElementById("root"));
  await act(async () => root.render(React.createElement(Component, { orders })));
  const document = dom.window.document;
  const trigger = document.querySelector('button[aria-haspopup="dialog"]');
  return {
    document, calls, trigger,
    async open() {
      trigger.focus();
      await act(async () => trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    },
    async change(selector, value) {
      const element = document.querySelector(selector);
      const prototype = element.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLSelectElement.prototype;
      await act(async () => {
        Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
        element.dispatchEvent(new dom.window.Event(element.tagName === "TEXTAREA" ? "input" : "change", { bubbles: true }));
      });
    },
    async submit() {
      await act(async () => document.querySelector("dialog form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    },
    async click(selector) {
      await act(async () => document.querySelector(selector).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    },
    async cancel() {
      await act(async () => document.querySelector("dialog").dispatchEvent(new dom.window.Event("cancel", { cancelable: true })));
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

test("order help opens a modal, validates the form and confirms a saved request", async () => {
  const view = await mount([success]);
  try {
    assert.equal(view.document.querySelector("dialog"), null);
    await view.open();
    assert.equal(view.document.querySelector("dialog").open, true);
    assert.equal(view.document.body.style.overflow, "hidden");
    assert.equal(view.document.activeElement, view.document.querySelector("dialog select"));
    await view.submit();
    assert.equal(view.calls.length, 0);
    assert.match(view.document.querySelector('[role="alert"]').textContent, /Choose what/);
    assert.equal(view.document.activeElement, view.document.querySelector('[role="alert"]'));
    view.document.querySelector('button[type="submit"]').focus();
    await view.submit();
    assert.equal(view.document.activeElement, view.document.querySelector('[role="alert"]'));
    await view.change('select[id$="-topic"]', "delivery");
    await view.change("textarea", "Short");
    await view.submit();
    assert.equal(view.calls.length, 0);
    await view.change("textarea", "Please help me with the delivery date.");
    await view.submit();
    assert.equal(view.calls.length, 1);
    assert.equal(view.calls[0].url, "/api/account/order-help");
    assert.equal(view.calls[0].options.credentials, "same-origin");
    const sent = JSON.parse(view.calls[0].options.body);
    assert.equal(sent.orderId, order.id);
    assert.equal(sent.topic, "delivery");
    assert.equal(sent.message, "Please help me with the delivery date.");
    assert.deepEqual(Object.keys(sent).sort(), ["message", "orderId", "requestId", "topic"]);
    assert.match(view.document.querySelector('[role="status"]').textContent, /Your help request is saved/);
    assert.match(view.document.querySelector('[role="status"]').textContent, new RegExp(sent.requestId.slice(0, 8).toUpperCase()));
    assert.equal(view.document.activeElement, view.document.querySelector('[role="status"]'));
    await view.click('[role="status"] button');
    assert.equal(view.document.querySelector("dialog"), null);
    assert.equal(view.document.body.style.overflow, "");
    assert.equal(view.document.activeElement, view.trigger);
  } finally { await view.close(); }
});

test("failed saves preserve the draft and retry ID; changed requests receive a new ID", async () => {
  const view = await mount([response(503, { error: "Please try again shortly." }), response(503, { error: "Please try again shortly." }), success]);
  try {
    await view.open();
    await view.change('select[id$="-topic"]', "payment");
    await view.change("textarea", "My payment needs checking, please.");
    await view.submit();
    assert.equal(view.document.querySelector("textarea").value, "My payment needs checking, please.");
    assert.equal(view.document.activeElement, view.document.querySelector('[role="alert"]'));
    await view.submit();
    const first = JSON.parse(view.calls[0].options.body);
    const retry = JSON.parse(view.calls[1].options.body);
    assert.equal(first.requestId, retry.requestId);
    await view.change("textarea", "My payment was charged twice. Please check.");
    await view.submit();
    assert.notEqual(JSON.parse(view.calls[2].options.body).requestId, first.requestId);
    assert.match(view.document.querySelector('[role="status"]').textContent, /saved/);
  } finally { await view.close(); }
});

test("duplicate submission is blocked in flight and closing aborts the request", async () => {
  let finish;
  const view = await mount([(options) => new Promise((resolve) => { finish = () => resolve(success(options)); })]);
  try {
    await view.open();
    await view.change('select[id$="-topic"]', "changes");
    await view.change("textarea", "I need help updating the printed wording.");
    await view.submit();
    assert.equal(view.document.querySelector('button[type="submit"]').disabled, true);
    await view.submit();
    assert.equal(view.calls.length, 1);
    await view.click('button[aria-label="Close order help"]');
    assert.equal(view.calls[0].options.signal.aborted, true);
    await act(async () => finish());
    assert.equal(view.document.querySelector("dialog"), null);
  } finally { await view.close(); }
});

test("accounts without orders get a contact option and Escape restores focus", async () => {
  const view = await mount([], []);
  try {
    await view.open();
    assert.equal(view.document.querySelector("dialog form"), null);
    assert.equal(view.document.querySelector('dialog a[href="/contact"]').textContent, "Contact us");
    await view.cancel();
    assert.equal(view.document.querySelector("dialog"), null);
    assert.equal(view.document.activeElement, view.trigger);
  } finally { await view.close(); }
});

test("message validation and character counter count emoji as single Unicode characters", async () => {
  const view = await mount([success]);
  try {
    await view.open();
    await view.change('select[id$="-topic"]', "other");
    await view.change("textarea", "😀".repeat(5));
    await view.submit();
    assert.equal(view.calls.length, 0);
    assert.match(view.document.querySelector('[id$="-message-hint"]').textContent, /5 \/ 3,000/);
    await view.change("textarea", "😀".repeat(3001));
    assert.equal(Array.from(view.document.querySelector("textarea").value).length, 3000);
    assert.match(view.document.querySelector('[id$="-message-hint"]').textContent, /3,000 \/ 3,000/);
    await view.submit();
    assert.equal(view.calls.length, 1);
    assert.equal(Array.from(JSON.parse(view.calls[0].options.body).message).length, 3000);
  } finally { await view.close(); }
});
