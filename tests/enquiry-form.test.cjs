const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

// Keep UI events real while replacing presentation-only components and network I/O.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://example.test/contact" });
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const h = React.createElement;
test.after(() => dom.window.close());

function primitive(tag) {
  return function Primitive({ children, ...props }) { return h(tag, props, children); };
}
const RadioContext = React.createContext(null);
function RadioGroup({ name, value, onChange, children, isDisabled }) {
  return h(RadioContext.Provider, { value: { name, value, onChange, isDisabled } }, children);
}
function RadioGroupItem({ value, children }) {
  const group = React.useContext(RadioContext);
  return h("label", null,
    h("input", { type: "radio", name: group.name, value, checked: group.value === value,
      disabled: group.isDisabled, onChange: () => group.onChange(value) }),
    children({ isSelected: group.value === value }),
  );
}

async function formHarness(t, respond = async () => ({ ok: true, json: async () => ({ success: true }) })) {
  const requests = [];
  const conversions = [];
  const noop = () => {};
  const mocks = {
    "lucide-react": new Proxy({}, { get: () => () => null }),
    "@/components/ui/button": { Button: ({ isDisabled, onPress, variant, children, ...props }) => h("button", { ...props, disabled: isDisabled, onClick: onPress }, children) },
    "@/components/ui/card": { CardHeader: primitive("div"), CardContent: primitive("div") },
    "@/components/ui/input": { Input: primitive("input") },
    "@/components/ui/label": { Label: primitive("label") },
    "@/components/ui/native-select": { NativeSelect: primitive("select"), NativeSelectOption: primitive("option") },
    "@/components/ui/radio-group": { RadioGroup, RadioGroupItem },
    "@/components/ui/textarea": { Textarea: primitive("textarea") },
    "@/components/contact/ContactMotion": { useContactMotion: () => ({ expand: noop, collapse: noop, countTo: noop }) },
    "@/components/contact/ProductEnquiryBanner": { default: () => null },
    "@/components/contact/EnquirySuccess": { default: ({ onReset }) => h("div", { role: "status" }, "Enquiry received", h("button", { onClick: onReset }, "Send another enquiry")) },
    "@/lib/site-config": { CONTACT: { whatsappNumber: "919876543210" } },
    "@/lib/google-tracking": { trackLeadConversion: (...args) => { conversions.push(args); return false; } },
  };
  function load(relativePath) {
    const filename = path.resolve(__dirname, "..", relativePath);
    const module = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    new Function("require", "module", "exports", "FormData", "fetch", compiled)(
      name => {
        if (Object.hasOwn(mocks, name)) return mocks[name];
        if (name === "@/lib/contact") return load("lib/contact.ts");
        assert.ok(!name.startsWith("@/"), `Unexpected dependency: ${name}`);
        return require(name);
      }, module, module.exports, dom.window.FormData,
      async (...args) => { requests.push(args); return respond(...args); },
    );
    return module.exports;
  }
  const Form = load("components/contact/EnquiryForm.tsx").default;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(() => root.render(h(React.StrictMode, null, h(Form, { enquiryProduct: null }))));
  t.after(async () => { await act(() => root.unmount()); container.remove(); });
  const query = selector => container.querySelector(selector);
  const setInput = async (name, value) => {
    const input = query(`[name="${name}"]`);
    await act(() => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  };
  return {
    requests, conversions, query,
    setInput,
    async fill() {
      await act(() => query('[name="requirement"][value="Sagun Envelopes"]').click());
      await setInput("name", "Test Customer");
      await setInput("mobile", "9876543210");
    },
    async submit() {
      await act(() => query("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    },
  };
}

test("mounting and invalid enquiries never count as conversions", async t => {
  const form = await formHarness(t);
  assert.equal(form.conversions.length, 0);
  await form.submit();
  assert.equal(form.requests.length, 0);
  assert.equal(form.conversions.length, 0);
  assert.ok(form.query('[aria-invalid="true"]'));
});

test("honeypot success does not send a lead or conversion", async t => {
  const form = await formHarness(t);
  await form.setInput("website", "spam.example");
  await form.submit();
  assert.ok(form.query('[role="status"]'));
  assert.equal(form.requests.length, 0);
  assert.equal(form.conversions.length, 0);
});

test("failed, malformed, and non-boolean successful responses do not convert", async t => {
  const cases = [
    { ok: false, json: async () => ({ success: true }) },
    { ok: true, json: async () => ({ success: false, message: "Try again" }) },
    { ok: true, json: async () => ({ success: "true" }) },
    { ok: true, json: async () => { throw new Error("Invalid JSON"); } },
  ];
  for (const response of cases) {
    await t.test(JSON.stringify({ ok: response.ok, result: await response.json().catch(() => null) }), async child => {
      const form = await formHarness(child, async () => response);
      await form.fill();
      await form.submit();
      assert.equal(form.requests.length, 1);
      assert.equal(form.conversions.length, 0);
      assert.ok(form.query('[role="alert"]'));
    });
  }
});

test("network failures do not convert and remain retryable", async t => {
  let attempts = 0;
  const form = await formHarness(t, async () => {
    if (attempts++ === 0) throw new Error("Network unavailable");
    return { ok: true, json: async () => ({ success: true }) };
  });
  await form.fill();
  await form.submit();
  assert.equal(form.conversions.length, 0);
  assert.ok(form.query('[role="alert"]'));
  await form.submit();
  assert.deepEqual(form.conversions, [[]], "Only the confirmed retry converts, without sending form data to tracking");
  assert.ok(form.query('[role="status"]'));
});

test("one confirmed response converts once despite duplicate submits, and another enquiry can convert", async t => {
  let resolveResponse;
  const form = await formHarness(t, () => new Promise(resolve => { resolveResponse = resolve; }));
  await form.fill();
  await form.submit();
  await form.submit();
  assert.equal(form.requests.length, 1);
  assert.equal(form.conversions.length, 0, "Wait for server confirmation");
  await act(() => resolveResponse({ ok: true, json: async () => ({ success: true }) }));
  assert.deepEqual(form.conversions, [[]]);
  assert.ok(form.query('[role="status"]'), "Successful enquiry remains successful when tracking returns false");
  await act(() => form.query('[role="status"] button').click());
  await form.fill();
  await form.submit();
  assert.equal(form.requests.length, 2);
  await act(() => resolveResponse({ ok: true, json: async () => ({ success: true }) }));
  assert.deepEqual(form.conversions, [[], []]);
});
