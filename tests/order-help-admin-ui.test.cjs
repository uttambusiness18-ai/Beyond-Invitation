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
const ticket = {
  id: "11111111-2222-4333-8444-555555555555", orderId: "99999999-2222-4333-8444-555555555555",
  orderReference: "Order #99999999", topic: "delivery", message: "Please confirm the delivery date.",
  status: "open", createdAt: "2026-11-17T10:00:00.000Z", updatedAt: "2026-11-17T10:00:00.000Z",
  customer: { name: "Test Customer", email: "customer@example.test", phone: "+919000000000" },
};
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const page = (requests = [ticket], nextCursor = null) => response(200, { requests, nextCursor });
const invalidAuthResponse = (status) => ({ ok: false, status, json: async () => { throw new Error("Not JSON"); } });

async function mount(responses) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/admin/order-help", pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const { createRoot } = require("react-dom/client");
  const calls = [];
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const module = { exports: {} };
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
    });
    vm.runInNewContext(outputText, {
      module, exports: module.exports, window: dom.window, document: dom.window.document,
      AbortController, URLSearchParams, setTimeout, clearTimeout,
      async fetch(url, options) {
        calls.push({ url, options });
        const next = responses.shift();
        assert.ok(next, "Unexpected admin support request");
        return typeof next === "function" ? next(url, options) : next;
      },
      require(name) {
        if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
        if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
        if (name === "next/image") return { __esModule: true, default: (props) => React.createElement("img", props) };
        if (name.startsWith("@/")) return load(path.join(projectRoot, name.slice(2) + ".ts"));
        assert.ok(["react", "react/jsx-runtime", "lucide-react"].includes(name), `Unexpected dependency: ${name}`);
        return require(name);
      },
    }, { filename });
    modules.set(filename, module.exports);
    return module.exports;
  }
  const Component = load(path.join(projectRoot, "components/admin/OrderHelpDashboard.tsx")).default;
  const root = createRoot(dom.window.document.getElementById("root"));
  await act(async () => root.render(React.createElement(Component)));
  const document = dom.window.document;
  return {
    document, calls,
    async click(label) {
      const button = [...document.querySelectorAll("button")].find((element) => element.textContent === label);
      assert.ok(button, `Button not found: ${label}`);
      assert.equal(button.disabled, false, `Button disabled: ${label}`);
      await act(async () => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    },
    async change(selector, value) {
      const element = document.querySelector(selector);
      const prototype = element.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
      await act(async () => {
        Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
        element.dispatchEvent(new dom.window.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
      });
    },
    async submit() {
      await act(async () => document.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
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

test("admin help requires staff authentication and clears loaded customer data when access is lost", async () => {
  for (const code of [401, 403]) {
    const view = await mount([page(), invalidAuthResponse(code)]);
    try {
      assert.match(view.document.body.textContent, /customer@example\.test/);
      await view.click("Refresh");
      assert.doesNotMatch(view.document.body.textContent, /customer@example\.test|Test Customer|Please confirm/);
      assert.equal(view.document.querySelector("form"), null);
      const signIn = [...view.document.querySelectorAll("a")].find((link) => link.getAttribute("href") === "/sign-in?next=%2Fadmin%2Forder-help");
      assert.ok(signIn, view.document.body.textContent);
      assert.equal(signIn.textContent, code === 401 ? "Sign in" : "Use a staff account");
      assert.ok(view.calls.every((call) => call.url === "/api/admin/order-help"));
      assert.ok(view.calls.every((call) => call.options.cache === "no-store" && call.options.credentials === "same-origin"));
    } finally { await view.close(); }
  }
});

test("admin help only shows a new saved status after the server confirms persistence", async () => {
  let finish;
  const view = await mount([page(), () => new Promise((resolve) => { finish = resolve; })]);
  try {
    await view.change("#help-request-status", "in_progress");
    await view.submit();
    assert.equal(view.document.querySelector('[data-status="in_progress"]'), null);
    assert.equal(view.document.querySelector("#help-request-status").disabled, true);
    assert.equal(view.calls[1].options.method, "PATCH");
    assert.deepEqual(JSON.parse(view.calls[1].options.body), { status: "in_progress", expectedUpdatedAt: ticket.updatedAt });
    assert.equal(view.calls[1].url, `/api/admin/order-help/${ticket.orderId}/${ticket.id}`);
    await act(async () => finish(response(200, { request: { ...ticket, status: "in_progress", updatedAt: "2026-11-17T11:00:00.000Z" } })));
    assert.equal(view.document.querySelectorAll('[data-status="in_progress"]').length, 2);
    assert.match(view.document.querySelector('[role="status"]').textContent, /Status saved/);
  } finally { await view.close(); }
});

test("a status conflict preserves saved state and allows retry after reloading an unchanged ticket", async () => {
  const view = await mount([page(), response(409, { error: "Conflict" }), page(), response(200, { request: { ...ticket, status: "resolved", updatedAt: "2026-11-17T11:00:00.000Z" } })]);
  try {
    await view.change("#help-request-status", "resolved");
    await view.submit();
    assert.equal(view.document.querySelector('[data-status="resolved"]'), null);
    assert.match(view.document.querySelector('[role="alert"]').textContent, /changed.*Reload/);
    assert.equal(view.document.querySelector("#help-request-status").disabled, true);
    await view.click("Reload requests");
    assert.equal(view.document.querySelector("#help-request-status").disabled, false);
    await view.submit();
    assert.equal(view.document.querySelectorAll('[data-status="resolved"]').length, 2);
  } finally { await view.close(); }
});

test("pagination deduplicates requests and customer messages render as plain text", async () => {
  const second = { ...ticket, id: "22222222-2222-4333-8444-555555555555", status: "resolved", message: "<img src=x onerror=alert(1)> Please check this order.", customer: { ...ticket.customer, name: "Second Customer" } };
  const view = await mount([page([ticket], "older-cursor"), page([ticket, second])]);
  try {
    await view.click("Load more requests");
    assert.equal(view.calls[1].url, "/api/admin/order-help?cursor=older-cursor");
    assert.equal(view.document.querySelectorAll('section[aria-label="Customer help requests"] button').length, 2);
    assert.match(view.document.body.textContent, /Search, status filters and counts apply to loaded requests/);
    await view.change(".modeFilter select", "resolved");
    assert.equal(view.document.querySelectorAll('section[aria-label="Customer help requests"] button').length, 1);
    assert.match(view.document.querySelector(".message").textContent, /<img src=x onerror=alert\(1\)>/);
    assert.equal(view.document.querySelector(".message img"), null);
    assert.equal(view.document.querySelector('time').textContent, "17 Nov 2026, 3:30 pm");
  } finally { await view.close(); }
});

test("load failures remain errors and do not claim that no requests exist", async () => {
  const view = await mount([response(503, { error: "Support storage is unavailable." })]);
  try {
    assert.match(view.document.querySelector('[role="alert"]').textContent, /storage is unavailable/);
    assert.match(view.document.body.textContent, /Requests are unavailable/);
    assert.doesNotMatch(view.document.body.textContent, /No help requests yet/);
  } finally { await view.close(); }
});
