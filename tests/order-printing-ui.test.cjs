const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://example.test/account" });
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const h = React.createElement;
test.after(() => dom.window.close());

const ORDER = "11111111-2222-4333-8444-555555555555";
const FILE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const saved = { id: FILE, fileName: "wording.pdf", sizeBytes: 24, contentType: "application/pdf", notes: "", createdAt: "2026-11-24T08:00:00Z" };
const reply = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

async function harness(t, { admin = false, props = { orderId: ORDER, receiptToken: "r".repeat(43) }, respond } = {}) {
  const requests = [];
  const uploads = [];
  class XHR {
    upload = {};
    status = 200;
    open(method, url) { this.method = method; this.url = url; }
    send(body) {
      this.body = body;
      uploads.push(this);
      queueMicrotask(() => { this.upload.onprogress?.({ lengthComputable: true, loaded: 24, total: 24 }); this.onload?.(); });
    }
    abort() { this.onabort?.(); }
  }
  const mocks = {
    "lucide-react": new Proxy({}, { get: () => () => null }),
    "next/link": { default: ({ children, prefetch, ...attributes }) => h("a", attributes, children) },
  };
  const modules = new Map();
  function load(relativePath) {
    if (modules.has(relativePath)) return modules.get(relativePath);
    const filename = path.resolve(__dirname, "..", relativePath);
    const module = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    new Function("require", "module", "exports", "fetch", "XMLHttpRequest", "FormData", "Blob", compiled)(name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.endsWith(".module.css")) return { default: {} };
      if (name.startsWith("@/")) return load(`${name.slice(2)}.${name.includes("components/") ? "tsx" : "ts"}`);
      return require(name);
    }, module, module.exports, async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ url, options, body });
      if (respond) return respond(url, options, body, requests.length);
      return reply(body?.action === "prepare" ? { fileId: FILE, uploadUrl: "https://storage.example.test/object/upload/sign/file?token=private", contentType: "application/pdf" }
        : body?.action === "complete" ? { file: saved } : { files: [] });
    }, XHR, dom.window.FormData, dom.window.Blob);
    modules.set(relativePath, module.exports);
    return module.exports;
  }
  const Component = load(admin ? "components/admin/OrderPrintingFiles.tsx" : "components/OrderPrintingMatter.tsx").default;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = nextProps => act(() => root.render(h(React.StrictMode, null, h(Component, nextProps))));
  await render(props);
  let mounted = true;
  t.after(async () => { if (mounted) await act(() => root.unmount()); container.remove(); });
  const button = text => [...container.querySelectorAll("button")].find(item => item.textContent.includes(text));
  return {
    requests, uploads, container, render, button,
    click: text => act(() => { const element = button(text); assert.ok(element, `Missing button ${text}`); element.click(); }),
    async choose(name = "wording.pdf", bytes = 24) {
      const file = new dom.window.File([new Uint8Array(bytes)], name, { type: "" });
      const input = container.querySelector('input[type="file"]');
      assert.ok(input);
      await act(() => { Object.defineProperty(input, "files", { configurable: true, value: [file] }); input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    },
    submit: () => act(() => container.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))),
    async unmount() { mounted = false; await act(() => root.unmount()); },
  };
}

test("printing files load only on demand, with guest capability in the body", async t => {
  const ui = await harness(t);
  assert.equal(ui.requests.length, 0);
  await ui.click("Upload printing matter");
  assert.equal(ui.requests.length, 1);
  assert.deepEqual(ui.requests[0].body, { orderId: ORDER, receiptToken: "r".repeat(43), action: "list" });
  assert.equal(ui.requests[0].url, "/api/orders/printing-matter");
  await ui.choose();
  assert.equal(ui.uploads.length, 0, "Choosing a file does not submit it");
  assert.equal(ui.requests.length, 1);
});

test("upload uses the reserved content type and only shows a confirmed file", async t => {
  const ui = await harness(t);
  await ui.click("Upload printing matter");
  await ui.choose();
  await ui.submit();
  assert.deepEqual(ui.requests.map(request => request.body.action), ["list", "prepare", "complete"]);
  assert.equal(ui.uploads.length, 1);
  const upload = ui.uploads[0];
  assert.equal(upload.method, "PUT");
  assert.equal(upload.withCredentials, false);
  assert.equal(upload.body.get("cacheControl"), "0");
  assert.equal(upload.body.get("").type, "application/pdf", "Blank browser MIME is replaced by server MIME");
  assert.equal(ui.requests[2].body.fileId, FILE);
  assert.match(ui.container.textContent, /has been sent to our team for review/);
  assert.match(ui.container.textContent, /Submitted files \(1\)/);
});

test("unsupported files are rejected without requesting an upload URL", async t => {
  const ui = await harness(t);
  await ui.click("Upload printing matter");
  await ui.choose("artwork.exe");
  await ui.submit();
  assert.equal(ui.requests.length, 1);
  assert.match(ui.container.textContent, /Choose a PDF, Word/);
});

test("a lost confirmation retries the same upload without creating another revision", async t => {
  let confirmations = 0;
  const ui = await harness(t, { respond: async (_url, _options, body) => {
    if (body.action === "prepare") return reply({ fileId: FILE, uploadUrl: "https://storage.example.test/upload?token=private", contentType: "application/pdf" });
    if (body.action === "complete") return ++confirmations === 1 ? reply({ error: "Please retry confirmation." }, 503) : reply({ file: saved });
    return reply({ files: [] });
  } });
  await ui.click("Upload printing matter");
  await ui.choose();
  await ui.submit();
  assert.ok(ui.button("Retry confirmation"));
  await ui.click("Retry confirmation");
  assert.equal(ui.uploads.length, 1);
  assert.equal(ui.requests.filter(request => request.body.action === "prepare").length, 1);
  assert.deepEqual(ui.requests.filter(request => request.body.action === "complete").map(request => request.body.fileId), [FILE, FILE]);
  assert.match(ui.container.textContent, /Submitted files \(1\)/);
});

test("a mismatched upload confirmation is never presented as success", async t => {
  const ui = await harness(t, { respond: async (_url, _options, body) => {
    if (body.action === "prepare") return reply({ fileId: FILE, uploadUrl: "https://storage.example.test/upload", contentType: "application/pdf" });
    if (body.action === "complete") return reply({ file: { ...saved, id: ORDER } });
    return reply({ files: [] });
  } });
  await ui.click("Upload printing matter");
  await ui.choose();
  await ui.submit();
  assert.doesNotMatch(ui.container.textContent, /has been sent to our team/);
  assert.match(ui.container.textContent, /confirmation could not be checked/);
  assert.ok(ui.button("Retry confirmation"));
});

test("switching orders aborts the old request and discards late files", async t => {
  let resolveOld;
  const ui = await harness(t, { respond: () => new Promise(resolve => { resolveOld = resolve; }) });
  await ui.click("Upload printing matter");
  await ui.render({ orderId: "99999999-2222-4333-8444-555555555555" });
  assert.equal(ui.requests[0].options.signal.aborted, true);
  await act(() => resolveOld(reply({ files: [saved] })));
  assert.doesNotMatch(ui.container.textContent, /wording.pdf/);
  assert.equal(ui.container.querySelector('[aria-expanded]').getAttribute("aria-expanded"), "false");
});

test("staff files require staff permission before requesting data", async t => {
  const ui = await harness(t, { admin: true, props: { orderId: ORDER, canManageFiles: false } });
  assert.equal(ui.requests.length, 0);
  assert.match(ui.container.textContent, /Sign in with a staff account/);
});

test("staff StrictMode cleanup cannot overwrite the latest load with an aborted error", async t => {
  const pending = [];
  const ui = await harness(t, { admin: true, props: { orderId: ORDER, canManageFiles: true }, respond: () => new Promise(resolve => pending.push(resolve)) });
  assert.equal(pending.length, 2);
  assert.equal(ui.requests[0].options.signal.aborted, true);
  await act(() => pending[1](reply({ files: [saved] })));
  await act(() => pending[0](reply({ error: "Old aborted request" }, 503)));
  assert.match(ui.container.textContent, /wording.pdf/);
  assert.doesNotMatch(ui.container.textContent, /Old aborted request|took too long/);
});
