const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const ORIGIN = "https://example.test";
const REQUEST_ID = "f8d062c5-01b6-4f33-85c6-aed8ca101692";
const ORDER_ID = "cc4fa9d2-f3d2-4ffb-8b86-7df1d3c9ebf1";
const USER_ID = "5e9ae526-c54e-40d3-8d11-3812a1733f51";
const UPDATED_AT = "2026-11-23T08:30:00.123456+00:00";
const adminPath = `/api/admin/order-help/${ORDER_ID}/${REQUEST_ID}`;
const row = (overrides = {}) => ({
  id: REQUEST_ID, order_id: ORDER_ID, topic: "delivery", message: "Please check the delivery status.",
  status: "open", created_at: "2026-11-22T08:30:00.000Z", updated_at: UPDATED_AT,
  order: { id: ORDER_ID, customer_name: "Example Customer", customer_email: "customer@example.test", customer_phone: "9876543210" },
  ...overrides,
});
const submission = () => ({ requestId: REQUEST_ID, orderId: ORDER_ID, topic: "delivery", message: row().message });

// Exercise real service and route code using separate in-memory customer/admin
// clients. No authentication service, database, or network request is made.
function harness({ adminResults = [], customerResults = [], user = null, authError = null } = {}) {
  const queries = [];
  const authCalls = [];
  const modules = new Map();
  function client(kind, results) {
    return {
      from(table) {
        const query = { kind, table, calls: [] };
        queries.push(query);
        const builder = {};
        for (const method of ["insert", "update", "select", "eq", "order", "limit", "or", "single", "maybeSingle"]) {
          builder[method] = (...args) => { query.calls.push([method, ...args]); return builder; };
        }
        builder.then = (resolve, reject) => {
          assert.ok(results.length, `Unexpected ${kind} database query: ${JSON.stringify(query.calls)}`);
          return Promise.resolve(results.shift()).then(resolve, reject);
        };
        return builder;
      },
    };
  }
  const admin = client("admin", adminResults);
  const customer = client("customer", customerResults);
  const mocks = {
    "server-only": {},
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/supabase/admin": { getSupabaseAdminClient: () => admin },
    "@/lib/supabase/auth-server": {
      getSupabaseAuthServerClient: async () => {
        authCalls.push("createAuthClient");
        return {
          ...customer,
          auth: { getUser: async () => { authCalls.push("getUser"); return { data: { user }, error: authError }; } },
        };
      },
    },
  };
  function load(relativePath) {
    const filename = path.resolve(__dirname, "..", relativePath);
    if (modules.has(filename)) return modules.get(filename);
    const loaded = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function("require", "module", "exports", compiled)(name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("@/")) return load(`${name.slice(2)}.ts`);
      return require(name);
    }, loaded, loaded.exports);
    modules.set(filename, loaded.exports);
    return loaded.exports;
  }
  return { load, queries, authCalls };
}

function jsonRequest(pathname, body, { method = "PATCH", origin = ORIGIN } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (origin !== null) headers.Origin = origin;
  return new Request(`${ORIGIN}${pathname}`, { method, headers, body: JSON.stringify(body) });
}
const patch = (h, body, options) => h.load("app/api/admin/order-help/[orderId]/[id]/route.ts").PATCH(
  jsonRequest(adminPath, body, options), { params: Promise.resolve({ orderId: ORDER_ID, id: REQUEST_ID }) },
);
const create = h => h.load("app/api/account/order-help/route.ts").POST(
  jsonRequest("/api/account/order-help", submission(), { method: "POST" }),
);

test("admin order-help list works without a sign-in session", async () => {
  const h = harness({ adminResults: [{ data: [row()], error: null }] });
  const response = await h.load("app/api/admin/order-help/route.ts").GET(new Request(`${ORIGIN}/api/admin/order-help`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  const result = await response.json();
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].id, REQUEST_ID);
  assert.equal(result.requests[0].customer.email, "customer@example.test");
  assert.equal(result.nextCursor, null);
  assert.deepEqual(h.authCalls, []);
  assert.equal(h.queries[0].kind, "admin");
});

test("anonymous admin status updates preserve order and timestamp matching without attributing a staff user", async () => {
  const h = harness({ adminResults: [{ data: row({ status: "resolved" }), error: null }] });
  const response = await patch(h, { status: "resolved", expectedUpdatedAt: UPDATED_AT });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).request.status, "resolved");
  assert.deepEqual(h.authCalls, []);
  assert.equal(h.queries.length, 1);
  assert.equal(h.queries[0].kind, "admin");
  assert.equal(h.queries[0].table, "website_order_help_requests");
  const calls = h.queries[0].calls;
  assert.deepEqual(calls.find(([method]) => method === "update"), ["update", { status: "resolved", updated_by: null }]);
  assert.deepEqual(calls.filter(([method]) => method === "eq"), [
    ["eq", "id", REQUEST_ID], ["eq", "order_id", ORDER_ID], ["eq", "updated_at", UPDATED_AT],
  ]);
});

test("admin status updates still reject missing or foreign origins before accessing data", async () => {
  for (const origin of [null, "https://another.example.test"]) {
    const h = harness();
    const response = await patch(h, { status: "resolved", expectedUpdatedAt: UPDATED_AT }, { origin });
    assert.equal(response.status, 403);
    assert.deepEqual(h.authCalls, []);
    assert.deepEqual(h.queries, []);
  }
});

test("admin status updates require a known status and valid concurrency timestamp", async () => {
  for (const body of [
    { status: "deleted", expectedUpdatedAt: UPDATED_AT },
    { expectedUpdatedAt: UPDATED_AT },
    { status: "resolved" },
    { status: "resolved", expectedUpdatedAt: "not-a-date" },
    { status: "resolved", expectedUpdatedAt: "2026-11-23" },
  ]) {
    const h = harness();
    const response = await patch(h, body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(h.authCalls, []);
    assert.deepEqual(h.queries, []);
  }
});

test("a stale or missing help request returns conflict instead of overwriting it", async () => {
  const h = harness({ adminResults: [{ data: null, error: null }] });
  const response = await patch(h, { status: "in_progress", expectedUpdatedAt: UPDATED_AT });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Refresh before updating/);
  assert.deepEqual(h.authCalls, []);
  assert.equal(h.queries.length, 1);
});

test("customer help submissions still reject unsigned users", async () => {
  const h = harness();
  const response = await create(h);
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /Sign in/);
  assert.deepEqual(h.authCalls, ["createAuthClient", "getUser"]);
  assert.deepEqual(h.queries, []);
});

test("customer help submissions still reject orders outside the signed-in account", async () => {
  for (const order of [null, { id: ORDER_ID, user_id: "ad1767a8-6031-4c1c-8edf-39a2b625f747" }]) {
    const h = harness({ user: { id: USER_ID }, customerResults: [{ data: order, error: null }] });
    const response = await create(h);
    assert.equal(response.status, 404);
    assert.deepEqual(h.authCalls, ["createAuthClient", "getUser"]);
    assert.equal(h.queries.length, 1);
    assert.equal(h.queries[0].kind, "customer");
    assert.equal(h.queries[0].table, "website_orders");
    assert.deepEqual(h.queries[0].calls.filter(([method]) => method === "eq"), [
      ["eq", "id", ORDER_ID], ["eq", "user_id", USER_ID],
    ]);
  }
});
