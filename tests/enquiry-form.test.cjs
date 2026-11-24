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
const COOKIE_CONSENT_EVENT = "cookie-consent-change";
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

async function formHarness(t, respond = async () => ({ ok: true, json: async () => ({ success: true }) }), track = () => false) {
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
    "@/lib/google-tracking": { trackLeadConversion: (...args) => { conversions.push(args); return track(); } },
    "@/lib/cookie-consent": { COOKIE_CONSENT_EVENT },
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
        if (name === "@/lib/storefront-availability") return load("lib/storefront-availability.ts");
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
  let mounted = true;
  const unmount = async () => {
    if (!mounted) return;
    mounted = false;
    await act(() => root.unmount());
    container.remove();
  };
  t.after(unmount);
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
    setInput, unmount,
    async consentChanged() {
      await act(() => window.dispatchEvent(new window.Event(COOKIE_CONSENT_EVENT)));
    },
    async rerender() {
      await act(() => root.render(h(React.StrictMode, null, h(Form, { enquiryProduct: null }))));
    },
    async fill() {
      await act(() => query('[name="requirement"][value="Wedding Cards"]').click());
      await act(() => {
        const select = query('[name="subRequirement"]');
        select.value = "General Wedding Cards";
        select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      });
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
  await form.consentChanged();
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
      await form.consentChanged();
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
  const [first, retry] = form.requests.map(([, options]) => JSON.parse(options.body));
  assert.match(first.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(retry.requestId, first.requestId, "Retrying the same enquiry keeps its receipt ID");
  assert.ok(form.query('[role="status"]'));
});

test("editing an enquiry after a failed attempt starts a new receipt", async t => {
  const form = await formHarness(t, async () => { throw new Error("Network unavailable"); });
  await form.fill();
  await form.submit();
  await form.setInput("name", "Updated Customer");
  await form.submit();
  const [first, edited] = form.requests.map(([, options]) => JSON.parse(options.body));
  assert.notEqual(edited.requestId, first.requestId);
  assert.equal(edited.name, "Updated Customer");
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
  const [first, another] = form.requests.map(([, options]) => JSON.parse(options.body));
  assert.notEqual(another.requestId, first.requestId, "Send another enquiry starts a separate receipt");
  await act(() => resolveResponse({ ok: true, json: async () => ({ success: true }) }));
  assert.deepEqual(form.conversions, [[], []]);
});

test("a confirmed enquiry retries an unavailable tracker once it recovers on the success screen", async t => {
  let trackingAvailable = false;
  let sent = 0;
  const form = await formHarness(t, undefined, () => {
    if (!trackingAvailable) return false;
    sent += 1;
    return true;
  });
  await form.consentChanged();
  assert.equal(form.conversions.length, 0, "Consent alone cannot create a lead");
  await form.fill();
  await form.submit();
  assert.ok(form.query('[role="status"]'));
  assert.equal(sent, 0);
  await form.rerender();
  assert.equal(form.conversions.length, 1, "Rerendering must not retry measurement");
  await form.consentChanged();
  assert.equal(sent, 0, "An unavailable tracker must leave the confirmed lead pending");
  trackingAvailable = true;
  await form.consentChanged();
  assert.equal(sent, 1);
  await form.consentChanged();
  trackingAvailable = false;
  await form.consentChanged();
  trackingAvailable = true;
  await form.consentChanged();
  await form.rerender();
  assert.equal(sent, 1, "Repeated choices and renders cannot duplicate the lead");
  assert.equal(form.requests.length, 1, "Measurement retry must not resend the enquiry");
});

test("an immediately measured enquiry is not repeated after a consent change", async t => {
  const form = await formHarness(t, undefined, () => true);
  await form.fill();
  await form.submit();
  await form.consentChanged();
  await form.rerender();
  await form.consentChanged();
  assert.deepEqual(form.conversions, [[]]);
});

test("resetting or leaving the enquiry success screen discards pending measurement", async t => {
  for (const action of ["reset", "unmount"]) {
    await t.test(action, async child => {
      let trackingAvailable = false;
      const form = await formHarness(child, undefined, () => trackingAvailable);
      await form.fill();
      await form.submit();
      assert.equal(form.conversions.length, 1);
      if (action === "reset") await act(() => form.query('[role="status"] button').click());
      else await form.unmount();
      trackingAvailable = true;
      await form.consentChanged();
      assert.equal(form.conversions.length, 1, "An old enquiry must not convert after its success screen is gone");
    });
  }
});

test("a response arriving after the form unmounts does not create pending measurement", async t => {
  let resolveResponse;
  const form = await formHarness(t, () => new Promise(resolve => { resolveResponse = resolve; }), () => true);
  await form.fill();
  await form.submit();
  await form.unmount();
  await act(() => resolveResponse({ ok: true, json: async () => ({ success: true }) }));
  await form.consentChanged();
  assert.equal(form.conversions.length, 0);
});
