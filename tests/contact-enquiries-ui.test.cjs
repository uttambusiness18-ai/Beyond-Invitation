const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://example.test/admin/contact-enquiries" });
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const h = React.createElement;
test.after(() => dom.window.close());

const enquiry = (overrides = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  name: "Alex Example",
  mobile: "9876543210",
  email: "alex@example.test",
  source: "Website",
  requirement: "Wedding Cards",
  subRequirement: "Hindu Wedding Cards",
  quantity: 200,
  eventDate: "2027-02-14",
  budgetPerUnit: 0,
  totalBudget: 0,
  message: 'Design no: DEMO-12 — Sample card\nPlease include <b>plain text</b> & gold trim.',
  createdAt: "2026-11-21T20:00:00Z",
  ...overrides,
});
const page = (enquiries, nextCursor = null) => ({ status: 200, body: { enquiries, nextCursor } });

async function harness(t, respond) {
  const requests = [];
  const filename = path.resolve(__dirname, "../components/admin/ContactEnquiriesDashboard.tsx");
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", "fetch", compiled)(
    (name) => {
      if (name === "next/link") return { default: ({ children, ...props }) => h("a", props, children) };
      if (name === "next/image") return { default: (props) => h("img", props) };
      if (name === "lucide-react") return new Proxy({}, { get: () => () => null });
      if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
      assert.ok(!name.startsWith("@/"), `Unexpected dependency: ${name}`);
      return require(name);
    }, module, module.exports,
    async (url, options) => {
      requests.push({ url, options });
      const result = await respond(url, requests.length);
      return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body };
    },
  );
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(module.exports.default)); });
  t.after(async () => { await act(() => root.unmount()); container.remove(); });
  return {
    container,
    requests,
    details: () => container.querySelector('[aria-label="Selected enquiry details"]'),
    cards: () => Array.from(container.querySelectorAll('[aria-label="Contact enquiry list"] button[aria-pressed]')),
    async click(label) {
      const button = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === label);
      assert.ok(button, `Button '${label}' exists`);
      await act(async () => { button.click(); });
    },
    async search(value) {
      const input = container.querySelector('[aria-label="Search loaded contact enquiries"]');
      await act(() => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
    },
  };
}

test("all submitted details remain visible with zero budgets, calendar date, IST time and literal message text", async (t) => {
  const submission = enquiry();
  const ui = await harness(t, async () => page([submission]));
  const details = ui.details();
  assert.ok(details);
  for (const text of [submission.name, submission.mobile, submission.email, submission.source, submission.id,
    submission.requirement, submission.subRequirement, "200", "14 February 2027", "22 Nov 2026", "1:30", submission.message]) {
    assert.ok(details.textContent.includes(text), `Details include ${text}`);
  }
  assert.equal((details.textContent.match(/₹0\.00/g) || []).length, 2);
  assert.equal(details.querySelector("b"), null, "Submitted markup is displayed as literal text");
  assert.equal(details.querySelector('a[href^="tel:"]').getAttribute("href"), "tel:+919876543210");
  assert.equal(details.querySelector('a[href^="mailto:"]').getAttribute("href"), "mailto:alex%40example.test");
  assert.equal(details.querySelector('time[datetime="2027-02-14"]').textContent, "14 February 2027");
  assert.equal(ui.requests[0].options.cache, "no-store");
  assert.equal(ui.container.querySelector('a[href^="/sign-in"]'), null, "Details do not require a sign-in link");
});

test("missing optional details are explicitly distinguished from zero values", async (t) => {
  const ui = await harness(t, async () => page([enquiry({ email: "", subRequirement: "", quantity: null,
    eventDate: "", budgetPerUnit: null, totalBudget: null, message: "" })]));
  const details = ui.details();
  assert.equal((details.textContent.match(/Not provided/g) || []).length, 7);
  assert.ok(!details.textContent.includes("₹0"));
  assert.equal(details.querySelector('a[href^="mailto:"]'), null);
});

test("submissions can be selected, paginated, searched and filtered without signing in", async (t) => {
  const first = enquiry();
  const second = enquiry({ id: "00000000-0000-4000-8000-000000000002", name: "Sam Example", requirement: "Sagun Envelopes", subRequirement: "", createdAt: "2026-11-20T10:00:00Z" });
  const third = enquiry({ id: "00000000-0000-4000-8000-000000000003", name: "Taylor Example", createdAt: "2026-11-19T10:00:00Z", message: "Blue border, please." });
  const ui = await harness(t, async (url) => url.includes("cursor=") ? page([second, third]) : page([first, second], "older-page"));
  assert.equal(ui.cards().length, 2);
  await act(() => ui.cards()[1].click());
  assert.ok(ui.details().textContent.includes(second.name));
  await ui.click("Load more enquiries");
  assert.equal(ui.cards().length, 3, "Overlapping pages do not duplicate submissions");
  assert.ok(ui.requests[1].url.endsWith("?cursor=older-page"));
  assert.ok(ui.details().textContent.includes(second.name), "Loading preserves selection");
  await ui.search("Blue border");
  assert.equal(ui.cards().length, 1);
  assert.ok(ui.details().textContent.includes(third.name));
  await ui.search("no matching enquiry");
  assert.equal(ui.details(), null);
  assert.ok(ui.container.textContent.includes("No loaded enquiries match these filters."));
  await ui.search("");
  const select = ui.container.querySelector("select");
  await act(() => { select.value = "Sagun Envelopes"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  assert.equal(ui.cards().length, 1);
  assert.ok(ui.details().textContent.includes(second.name));
});

for (const status of [500, 503]) {
  test(`refresh failure (${status}) preserves loaded details and offers retry without sign-in`, async (t) => {
    const submission = enquiry();
    const ui = await harness(t, async (_, call) => call === 2 ? { status, body: { error: "Temporarily unavailable" } } : page([submission], "older-page"));
    assert.ok(ui.details().textContent.includes(submission.email));
    await ui.click("Refresh");
    assert.ok(ui.details().textContent.includes(submission.email));
    assert.ok(ui.container.querySelector('[role="alert"]').textContent.includes("Temporarily unavailable"));
    assert.ok(ui.container.textContent.includes("Showing previously loaded enquiries."));
    assert.equal(ui.container.querySelector('a[href^="/sign-in"]'), null);
    await ui.click("Retry");
    assert.equal(ui.container.querySelector('[role="alert"]'), null);
    assert.ok(ui.details().textContent.includes(submission.email));
  });
}
