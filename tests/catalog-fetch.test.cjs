const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const endpoint = "https://catalogue.example.test/rest/v1/v_storefront_products?select=*&slug=eq.1308";
const html = "<!DOCTYPE html><html><title>522: Connection timed out</title><body>Upstream gateway error</body></html>";
const gateway = (status = 522) => new Response(html, { status, headers: { "content-type": "text/html" } });
const products = () => Response.json([{ id: "card-id", slug: "1308" }]);

function harness(responses = []) {
  const calls = [], delays = [], modules = new Map();
  const fastTimeout = (callback, ms, ...args) => {
    delays.push(ms);
    return setTimeout(callback, ms >= 1000 ? 15 : 0, ...args);
  };
  class TestAbortSignal extends AbortSignal {
    static timeout(ms) {
      const controller = new AbortController();
      fastTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), ms).unref();
      return controller.signal;
    }
  }
  const createdClients = [];
  function load(relative) {
    const filename = path.resolve(projectRoot, relative);
    if (modules.has(filename)) return modules.get(filename);
    const module = { exports: {} };
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
    });
    vm.runInNewContext(outputText, {
      module, exports: module.exports, URL, URLSearchParams, Response, Request, Headers,
      AbortController, AbortSignal: TestAbortSignal, DOMException, Error, TypeError,
      setTimeout: fastTimeout, clearTimeout, console,
      process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://catalogue.example.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-test-key" } },
      async fetch(input, init) {
        calls.push({ input, init });
        assert.ok(responses.length, "Unexpected extra catalogue request");
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return typeof response === "function" ? response(input, init) : response;
      },
      require(name) {
        if (name === "server-only") return {};
        if (name === "@supabase/supabase-js") return { createClient(url, key, options) {
          const client = { url, key, options };
          createdClients.push(client);
          return client;
        } };
        if (name.startsWith("@/")) return load(`${name.slice(2)}.ts`);
        throw new Error(`Unexpected dependency: ${name}`);
      },
    }, { filename });
    modules.set(filename, module.exports);
    return module.exports;
  }
  const { catalogueFetch } = load("lib/catalog-fetch.ts");
  return { catalogueFetch, calls, delays, load, createdClients };
}

test("a 522 catalogue read retries once and bypasses the failed cache entry", async () => {
  const h = harness([gateway(), products()]);
  const response = await h.catalogueFetch(endpoint, { headers: { apikey: "test-key" } });
  assert.equal(response.status, 200);
  assert.equal((await response.json())[0].slug, "1308");
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].init.cache, "no-store");
  assert.notEqual(h.calls[1].init.next?.revalidate, 60);
  assert.equal(new Headers(h.calls[1].init.headers).get("apikey"), "test-key");
  assert.ok(h.delays.some((delay) => delay > 0 && delay < 1000));
});

test("persistent 522 failures are bounded and return a concise status without HTML", async () => {
  const h = harness([gateway(), gateway()]);
  const response = await h.catalogueFetch(endpoint);
  assert.equal(h.calls.length, 2);
  assert.equal(response.status, 522);
  assert.match(response.headers.get("content-type"), /json/);
  const body = await response.json();
  assert.equal(typeof body.message, "string");
  assert.match(body.message, /522/);
  assert.doesNotMatch(JSON.stringify(body), /DOCTYPE|<html|<body|gateway error/);
});

test("a transient network failure can recover on the second read", async () => {
  const h = harness([new TypeError("fetch failed"), products()]);
  const response = await h.catalogueFetch(endpoint);
  assert.equal(response.status, 200);
  assert.equal(h.calls.length, 2);
});

test("permission and missing-schema errors preserve PostgREST details without retries", async () => {
  for (const [status, body] of [
    [403, { code: "42501", message: "permission denied for view v_storefront_products", details: null, hint: null }],
    [404, { code: "PGRST205", message: "Could not find v_storefront_products in the schema cache", details: null, hint: null }],
  ]) {
    const h = harness([Response.json(body, { status })]);
    const response = await h.catalogueFetch(endpoint);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), body);
    assert.equal(h.calls.length, 1);
  }
});

test("only the known read-only POST RPC is retried; writes are never repeated", async () => {
  const rpc = "https://catalogue.example.test/rest/v1/rpc/storefront_product_page";
  const h = harness([gateway(), Response.json({ products: [], total: 0, nextOffset: null })]);
  const body = JSON.stringify({ p_offset: 24, p_limit: 24 });
  assert.equal((await h.catalogueFetch(rpc, { method: "POST", body })).status, 200);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].init.body, body);
  for (const [url, method] of [
    ["https://catalogue.example.test/rest/v1/items", "POST"],
    ["https://catalogue.example.test/rest/v1/items?id=eq.1", "PATCH"],
    ["https://catalogue.example.test/rest/v1/items?id=eq.1", "DELETE"],
    ["https://catalogue.example.test/rest/v1/rpc/change_product", "POST"],
  ]) {
    const write = harness([gateway()]);
    assert.equal((await write.catalogueFetch(url, { method, body: "{}" })).status, 522);
    assert.equal(write.calls.length, 1, `${method} ${url}`);
  }
});

test("caller cancellation stops a pending read without a retry", async () => {
  const controller = new AbortController();
  const h = harness([(_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    controller.abort(new DOMException("User navigated away", "AbortError"));
  })]);
  await assert.rejects(h.catalogueFetch(endpoint, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(h.calls.length, 1);
});

test("an already-aborted caller never starts a network request", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("User navigated away", "AbortError"));
  const h = harness([]);
  await assert.rejects(h.catalogueFetch(endpoint, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(h.calls.length, 0);
});

test("request and response-body stalls stop at the deadline and remain bounded", async () => {
  const stalledFetch = (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
  const stalledBody = (_input, init) => ({
    status: 200, ok: true, headers: new Headers(),
    text: () => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }),
  });
  for (const responseFactory of [stalledFetch, stalledBody]) {
    const h = harness([responseFactory, responseFactory]);
    const response = await h.catalogueFetch(endpoint);
    assert.equal(response.status, 504);
    assert.equal((await response.json()).code, "CATALOGUE_TIMEOUT");
    assert.equal(h.calls.length, 2);
    assert.equal(h.delays.filter((delay) => delay === 10_000).length, 2);
    assert.ok(h.calls.every((call) => call.init.signal.aborted));
  }
});

test("catalogue log messages omit HTML documents and bound ordinary diagnostics", () => {
  const h = harness([]);
  const { catalogueErrorMessage } = h.load("lib/catalog-errors.ts");
  for (const error of [html, new Error(`Product catalogue unavailable: ${html}`), { message: html }, null]) {
    const message = catalogueErrorMessage(error);
    assert.match(message, /temporarily unavailable/);
    assert.doesNotMatch(message, /<|>|DOCTYPE|gateway error/);
  }
  assert.equal(catalogueErrorMessage({ message: "permission denied\nfor relation products" }), "permission denied for relation products");
  assert.equal(catalogueErrorMessage(new Error("x".repeat(1000))).length, 240);
});

test("the public Supabase client disables nested SDK retries", () => {
  const h = harness([]);
  const { getSupabaseServerClient } = h.load("lib/supabase/server.ts");
  const client = getSupabaseServerClient();
  assert.equal(client.options.db.retry, false);
  assert.equal(typeof client.options.global.fetch, "function");
  assert.equal(getSupabaseServerClient(), client);
  assert.equal(h.createdClients.length, 1);
});
