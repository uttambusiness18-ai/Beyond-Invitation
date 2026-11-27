const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToPipeableStream } = require("react-dom/server");
const { JSDOM, ResourceLoader, VirtualConsole } = require("jsdom");

function loadSource(relativePath, modules = new Map()) {
  if (modules.has(relativePath)) return modules.get(relativePath);
  const filename = path.resolve(__dirname, "..", relativePath);
  const module = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  new Function("require", "module", "exports", compiled)(name => {
    if (name.startsWith("@/lib/")) return loadSource(`${name.slice(2)}.ts`, modules);
    assert.equal(name, "react/jsx-runtime", `Unexpected head dependency: ${name}`);
    return require(name);
  }, module, module.exports);
  modules.set(relativePath, module.exports);
  return module.exports;
}

function renderDocument(element) {
  return new Promise((resolve, reject) => {
    let html = "";
    const output = new PassThrough();
    output.on("data", chunk => { html += chunk; });
    output.on("end", () => resolve(html));
    output.on("error", reject);
    const stream = renderToPipeableStream(element, {
      onAllReady() { stream.pipe(output); },
      onError: reject,
    });
  });
}

test("Google bootstrap is first in server head and preserves metadata through hydration and navigation", async t => {
  const modules = new Map();
  const GoogleTagHead = loadSource("components/GoogleTagHead.tsx", modules).default;
  const tag = loadSource("lib/google-tag.ts", modules);
  const h = React.createElement;
  const documentTree = (title, description) => h("html", { lang: "en" },
    h(GoogleTagHead),
    h("body", null,
      // These are deliberately rendered later, as Next's metadata is. React
      // hoists them into head and must retain ownership after hydration.
      h("meta", { charSet: "utf-8" }),
      h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
      h("title", null, title),
      h("meta", { name: "description", content: description }),
      h("main", null, title),
    ),
  );
  const initialTree = documentTree("Home", "Home description");
  const html = await renderDocument(initialTree);
  assert.ok(html.includes(`<head><script id="${tag.GOOGLE_TAG_BOOTSTRAP_ID}">`),
    "The initial HTTP markup must put the bootstrap directly after <head>");

  const errors = [];
  const requests = [];
  class OfflineResources extends ResourceLoader {
    fetch(url) {
      requests.push(url);
      // Execute a local stand-in; this test cannot send measurement requests.
      return Promise.resolve(Buffer.from("window.__testGoogleLoads = (window.__testGoogleLoads || 0) + 1;"));
    }
  }
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM(html, {
    url: "https://example.test/contact?private=PRIVATE_QUERY#gclid=PRIVATE_FRAGMENT",
    referrer: "https://example.test/catalog?private=PRIVATE_REFERRER",
    runScripts: "dangerously",
    resources: new OfflineResources(),
    virtualConsole,
    pretendToBeVisual: true,
  });
  const globalNames = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"];
  const previousGlobals = new Map(globalNames.map(name => [name, Object.getOwnPropertyDescriptor(global, name)]));
  let root;
  t.after(async () => {
    try {
      if (root) await React.act(() => root.unmount());
    } finally {
      dom.window.close();
      for (const [name, descriptor] of previousGlobals) {
        if (descriptor) Object.defineProperty(global, name, descriptor);
        else delete global[name];
      }
    }
  });
  await new Promise(resolve => dom.window.addEventListener("load", resolve, { once: true }));
  for (const name of globalNames) Object.defineProperty(global, name, {
    configurable: true,
    writable: true,
    value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name],
  });
  t.mock.method(console, "error", (...args) => errors.push(args.map(String).join(" ")));
  t.mock.method(console, "warn", (...args) => errors.push(args.map(String).join(" ")));
  const { hydrateRoot } = require("react-dom/client");
  const { document, window } = dom.window;
  const bootstrap = document.getElementById(tag.GOOGLE_TAG_BOOTSTRAP_ID);
  const loader = document.getElementById(tag.GOOGLE_TAG_SCRIPT_ID);
  const checkDocument = (title, description) => {
    assert.equal(document.head.firstElementChild, bootstrap);
    assert.equal(bootstrap.nextElementSibling, loader);
    assert.equal(document.querySelectorAll(`#${tag.GOOGLE_TAG_BOOTSTRAP_ID}`).length, 1);
    assert.equal(document.querySelectorAll(`#${tag.GOOGLE_TAG_SCRIPT_ID}`).length, 1);
    assert.equal(document.title, title);
    assert.equal(document.querySelector('meta[name="description"]').content, description);
    assert.equal(document.querySelectorAll("meta[charset]").length, 1);
    assert.equal(document.querySelectorAll('meta[name="viewport"]').length, 1);
    assert.equal(window.__testGoogleLoads, 1);
  };
  checkDocument("Home", "Home description");
  await React.act(() => {
    root = hydrateRoot(document, initialTree, {
      onRecoverableError: error => errors.push(error.message),
    });
  });
  checkDocument("Home", "Home description");
  for (const [title, description] of [
    ["Contact", "Contact description"],
    ["Home", "Home description"],
    ["Home", "Home description"],
  ]) {
    // Re-rendering the head also covers router refresh, where resetting raw
    // innerHTML would silently erase React's metadata and resource nodes.
    await React.act(() => root.render(documentTree(title, description)));
    checkDocument(title, description);
  }
  assert.deepEqual(requests, [`https://www.googletagmanager.com/gtm.js?id=${tag.GOOGLE_TAG_ID}`]);
  const commands = window.dataLayer.map(args => Array.from(args));
  assert.equal(commands.filter(args => args[0] === "js").length, 1);
  assert.equal(commands.filter(args => args[0] === "consent" && args[1] === "default").length, 1);
  assert.deepEqual(errors, [], "SSR bootstrap and hydrated head must not produce mismatches or errors");
});
