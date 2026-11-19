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
const cookieName = "beyond_invitation_cookie_consent";

function loader(dom) {
  const cache = new Map();
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const filename = path.join(projectRoot, relative);
    const module = { exports: {} };
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: filename,
    });
    vm.runInNewContext(outputText, {
      module, exports: module.exports,
      ...(dom ? { window: dom.window, document: dom.window.document } : {}),
      require(name) {
        if (name === "@/lib/cookie-consent") return load("lib/cookie-consent.ts");
        if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
        assert.ok(["react", "react/jsx-runtime"].includes(name), `Unexpected dependency: ${name}`);
        return require(name);
      },
    }, { filename });
    cache.set(relative, module.exports);
    return module.exports;
  }
  return load;
}

test("consent is safe on the server and legacy essential-only acceptance does not permit marketing", () => {
  const server = loader()("lib/cookie-consent.ts");
  assert.equal(server.getCookieConsent(), null);
  assert.equal(server.hasMarketingConsent(), false);
  assert.doesNotThrow(() => server.saveCookieConsent("accepted"));
  const dom = new JSDOM("", { url: "https://example.test/" });
  try {
    const consent = loader(dom)("lib/cookie-consent.ts");
    for (const value of ["accepted", "declined", "%E0%A4%A", "v3%3Aaccepted", ""]) {
      dom.window.document.cookie = `${cookieName}=${value}; Path=/`;
      assert.equal(consent.getCookieConsent(), null, value);
      assert.equal(consent.hasMarketingConsent(), false, value);
    }
  } finally { dom.window.close(); }
});

test("saved choices persist across module reloads and are visible during the consent event", () => {
  const dom = new JSDOM("", { url: "https://example.test/contact" });
  try {
    const consent = loader(dom)("lib/cookie-consent.ts");
    const events = [];
    dom.window.addEventListener(consent.COOKIE_CONSENT_EVENT, event => {
      events.push({ detail: event.detail.status, current: consent.getCookieConsent(), marketing: consent.hasMarketingConsent() });
    });
    consent.saveCookieConsent("accepted");
    assert.match(dom.window.document.cookie, /beyond_invitation_cookie_consent=v2%3Aaccepted/);
    assert.equal(loader(dom)("lib/cookie-consent.ts").hasMarketingConsent(), true);
    consent.saveCookieConsent("declined");
    assert.equal(loader(dom)("lib/cookie-consent.ts").getCookieConsent(), "declined");
    assert.deepEqual(events, [
      { detail: "accepted", current: "accepted", marketing: true },
      { detail: "declined", current: "declined", marketing: false },
    ]);
    const saved = dom.cookieJar.getCookiesSync("https://example.test/")[0];
    assert.equal(saved.secure, true);
    assert.equal(saved.sameSite, "lax");
    assert.equal(saved.path, "/");
    assert.equal(saved.maxAge, 31536000);
  } finally { dom.window.close(); }
});

test("blocked cookies do not prevent accepting and withdrawing for the current visit", () => {
  const dom = new JSDOM("", { url: "https://example.test/" });
  try {
    Object.defineProperty(dom.window.document, "cookie", {
      get() { throw new Error("Cookies disabled"); },
      set() { throw new Error("Cookies disabled"); },
      configurable: true,
    });
    const consent = loader(dom)("lib/cookie-consent.ts");
    assert.equal(consent.getCookieConsent(), null);
    assert.doesNotThrow(() => consent.saveCookieConsent("accepted"));
    assert.equal(consent.hasMarketingConsent(), true);
    assert.doesNotThrow(() => consent.saveCookieConsent("declined"));
    assert.equal(consent.hasMarketingConsent(), false);
    assert.equal(consent.getCookieConsent(), "declined");
  } finally { dom.window.close(); }
});

async function mount(cookie) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://example.test/", pretendToBeVisual: true });
  if (cookie) dom.window.document.cookie = `${cookieName}=${cookie}; Path=/`;
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const load = loader(dom);
  const consent = load("lib/cookie-consent.ts");
  const { default: Banner, CookiePreferencesButton } = load("components/CookiesConsent.tsx");
  const { createRoot } = require("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  await act(async () => root.render(React.createElement(React.Fragment, null, React.createElement(Banner), React.createElement(CookiePreferencesButton))));
  return {
    document: dom.window.document, consent,
    async click(text) {
      const button = [...dom.window.document.querySelectorAll("button")].find(button => button.textContent.includes(text));
      assert.ok(button, `Missing button: ${text}`);
      await act(async () => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    },
    async finishClosing() { await act(async () => new Promise(resolve => dom.window.setTimeout(resolve, 320))); },
    async close() {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
    },
  };
}

test("the banner explains optional measurement, supports essential-only, and reopens to change preferences", async () => {
  const view = await mount("accepted");
  try {
    assert.ok(view.document.querySelector('[role="dialog"]'));
    assert.match(view.document.querySelector("#cookie-consent-description").textContent, /With your permission, Google cookies/);
    await view.click("Essential only");
    assert.equal(view.consent.getCookieConsent(), "declined");
    await view.finishClosing();
    assert.equal(view.document.querySelector('[role="dialog"]'), null);
    await view.click("Cookie preferences");
    assert.ok(view.document.querySelector('[role="dialog"]'));
    await view.click("Accept all");
    assert.equal(view.consent.hasMarketingConsent(), true);
    // Reopening immediately must cancel the previous close animation timer.
    await view.click("Cookie preferences");
    await view.finishClosing();
    assert.ok(view.document.querySelector('[role="dialog"]'));
    await view.click("Essential only");
    assert.equal(view.consent.hasMarketingConsent(), false);
  } finally { await view.close(); }
});

test("a stored acceptance or decline keeps the banner closed until preferences are opened", async () => {
  for (const value of ["v2%3Aaccepted", "v2%3Adeclined"]) {
    const view = await mount(value);
    try {
      assert.equal(view.document.querySelector('[role="dialog"]'), null);
      await view.click("Cookie preferences");
      assert.ok(view.document.querySelector('[role="dialog"]'));
    } finally { await view.close(); }
  }
});
