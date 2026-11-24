const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const USER_ID = "wishlist-test-user";
const UNAVAILABLE = "Unable to sync your wishlist. Please try again.";
const ACCOUNT_CHANGED = "Your account changed. Please reload your wishlist.";

function compile(relativePath) {
  const filename = path.resolve(__dirname, relativePath);
  return ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const wishlistModule = { exports: {} };
new Function("require", "module", "exports", compile("../lib/wishlist.ts"))(
  require, wishlistModule, wishlistModule.exports,
);
const compiledClient = compile("../lib/wishlist-client.ts");

function clientWithFetch(respond) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return respond(calls.length, url, init);
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "fetch", compiledClient)(
    name => name === "./wishlist" || name === "@/lib/wishlist" ? wishlistModule.exports : require(name),
    module, module.exports, fetch,
  );
  return { request: module.exports.requestWishlist, calls };
}

function html(status = 404) {
  return new Response("<!DOCTYPE html><html><body>Not found</body></html>", {
    status, headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function success(values = {}) {
  return Response.json({ userId: USER_ID, slugs: ["first-card"], ...values });
}

function assertFriendly(error) {
  assert(error instanceof Error);
  assert.equal(error.message, UNAVAILABLE);
  assert.equal(error instanceof SyntaxError, false);
  assert.doesNotMatch(error.message, /DOCTYPE|Unexpected token|JSON/i);
  return true;
}

test("wishlist reads recover from an HTML route response without exposing JSON parse errors", async () => {
  const client = clientWithFetch(attempt => attempt === 1 ? html() : success());
  const signal = new AbortController().signal;
  assert.deepEqual(await client.request("GET", USER_ID, signal), {
    slugs: ["first-card"], unmergedSlugs: [],
  });
  assert.equal(client.calls.length, 2);
  assert(client.calls.every(call => call.url === "/api/wishlist"));
  assert(client.calls.every(call => call.init.method === "GET" && call.init.signal === signal));
});

test("repeated HTML responses stop after one safe read retry and return a friendly error", async () => {
  const client = clientWithFetch(() => html(503));
  await assert.rejects(client.request("GET", USER_ID, new AbortController().signal), assertFriendly);
  assert.equal(client.calls.length, 2);
});

for (const method of ["POST", "DELETE"]) {
  test(`${method} wishlist changes are never replayed after an HTML response`, async () => {
    const client = clientWithFetch(() => html(502));
    const body = { slug: "first-card" };
    await assert.rejects(client.request(method, USER_ID, new AbortController().signal, body), assertFriendly);
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].init.method, method);
    assert.deepEqual(JSON.parse(client.calls[0].init.body), body);
  });
}

test("JSON authentication errors retain their message and are not retried", async () => {
  const message = "Please sign in to access your saved wishlist.";
  const client = clientWithFetch(() => Response.json({ error: message }, { status: 401 }));
  await assert.rejects(client.request("GET", USER_ID, new AbortController().signal), { message });
  assert.equal(client.calls.length, 1);
});

test("responses for another account cannot replace the current wishlist", async () => {
  const client = clientWithFetch(() => success({ userId: "another-user" }));
  await assert.rejects(client.request("GET", USER_ID, new AbortController().signal), { message: ACCOUNT_CHANGED });
  assert.equal(client.calls.length, 1);
});

test("malformed JSON has a friendly failure with bounded read retries", async () => {
  const client = clientWithFetch(() => new Response('{"userId":', {
    headers: { "Content-Type": "application/json" },
  }));
  await assert.rejects(client.request("GET", USER_ID, new AbortController().signal), assertFriendly);
  assert(client.calls.length >= 1 && client.calls.length <= 2);
});

test("a JSON null payload cannot cause a property access crash", async () => {
  const client = clientWithFetch(() => Response.json(null));
  await assert.rejects(client.request("GET", USER_ID, new AbortController().signal), assertFriendly);
  assert(client.calls.length >= 1 && client.calls.length <= 2);
});

test("successful reads preserve request identity and normalize saved and unmerged slugs", async () => {
  const client = clientWithFetch(() => success({
    slugs: [" first-card ", "first-card", "", null, "second-card"],
    unmergedSlugs: [" extra-card ", "extra-card", 123],
  }));
  assert.deepEqual(await client.request("GET", USER_ID, new AbortController().signal), {
    slugs: ["first-card", "second-card"], unmergedSlugs: ["extra-card"],
  });
  assert.equal(client.calls.length, 1);
  const headers = new Headers(client.calls[0].init.headers);
  assert.equal(headers.get("x-wishlist-user"), USER_ID);
  assert.equal(client.calls[0].init.credentials, "same-origin");
  assert.equal(client.calls[0].init.cache, "no-store");
});

test("cancelling a request preserves the abort error and does not retry", async () => {
  const controller = new AbortController();
  const reason = new DOMException("Request cancelled", "AbortError");
  const client = clientWithFetch(() => {
    controller.abort(reason);
    throw reason;
  });
  await assert.rejects(client.request("GET", USER_ID, controller.signal), error => error === reason);
  assert.equal(client.calls.length, 1);
});

test("cancellation after an HTML response prevents the recovery request", async () => {
  const controller = new AbortController();
  const reason = new DOMException("Account changed", "AbortError");
  const client = clientWithFetch(() => {
    controller.abort(reason);
    return html();
  });
  await assert.rejects(client.request("GET", USER_ID, controller.signal), error => error === reason);
  assert.equal(client.calls.length, 1);
});
