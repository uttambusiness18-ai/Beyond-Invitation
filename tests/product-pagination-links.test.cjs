const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../components/ProductPagination.tsx");
const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)(require, loaded, loaded.exports);
const Pagination = loaded.exports.default;

function descendants(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(descendants);
  return [node, ...descendants(node.props?.children)];
}

test("default pagination retains button callbacks and the selected page does not reload", () => {
  const changes = [];
  const nodes = descendants(Pagination({ currentPage: 2, totalPages: 4, onPageChange: page => changes.push(page) }));
  assert.equal(nodes.filter(node => node.type === "a").length, 0);
  const buttons = nodes.filter(node => node.type === "button");
  buttons.find(node => node.props["aria-label"] === "Next page").props.onClick();
  buttons.find(node => node.props["aria-label"] === "Previous page").props.onClick();
  buttons.find(node => node.props["aria-current"] === "page").props.onClick();
  assert.deepEqual(changes, [3, 1]);
});

test("link pagination exposes native hrefs without click handlers", () => {
  const nodes = descendants(Pagination({
    currentPage: 2, totalPages: 4, onPageChange: () => assert.fail("Native navigation must not fetch through the callback"),
    getPageHref: page => `/collection?price=under-25&page=${page}`,
  }));
  assert.equal(nodes.filter(node => node.type === "button").length, 0);
  const links = nodes.filter(node => node.type === "a");
  assert.equal(links.length, 6);
  assert.equal(links.find(node => node.props["aria-label"] === "Next page").props.href, "/collection?price=under-25&page=3");
  assert.equal(links.find(node => node.props["aria-label"] === "Previous page").props.href, "/collection?price=under-25&page=1");
  assert.equal(links.find(node => node.props["aria-current"] === "page").props.href, "/collection?price=under-25&page=2");
  assert.ok(links.every(node => node.props.onClick === undefined));
});

test("unavailable link controls have no href or keyboard focus target", () => {
  const hrefPages = [];
  const props = { currentPage: 1, totalPages: 3, onPageChange: () => {}, getPageHref: page => { hrefPages.push(page); return `/collection?page=${page}`; } };
  const nodes = descendants(Pagination(props));
  const previous = nodes.find(node => node.props?.["aria-label"] === "Previous page");
  assert.equal(previous.type, "span");
  assert.equal(previous.props.role, "link");
  assert.equal(previous.props["aria-disabled"], "true");
  assert.equal(previous.props.href, undefined);
  assert.equal(previous.props.tabIndex, undefined);
  assert.ok(hrefPages.every(page => page >= 1));
  const busy = descendants(Pagination({ ...props, disabled: true }));
  assert.equal(busy.filter(node => node.type === "a" || node.type === "button").length, 0);
  assert.ok(busy.filter(node => node.props?.role === "link").every(node => node.props["aria-disabled"] === "true" && node.props.href === undefined));
});

test("a single page does not render pagination", () => {
  assert.equal(Pagination({ currentPage: 1, totalPages: 1, onPageChange: () => {}, getPageHref: () => "/collection" }), null);
});
