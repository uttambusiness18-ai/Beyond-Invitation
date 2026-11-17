const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const ownerId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const orderId = "11111111-2222-4333-8444-555555555555";
const secondOrderId = "11111111-2222-4333-8444-666666666666";
const requestId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const createdAt = "2026-11-17T10:00:00.123456+00:00";
const origin = "https://example.test";
const submission = { orderId, requestId, topic: "delivery", message: "Please check my delivery date." };
const plain = (value) => JSON.parse(JSON.stringify(value));

function harness() {
  const calls = [];
  const state = {
    user: { id: ownerId, email: "customer@example.invalid", app_metadata: {}, user_metadata: {} },
    authError: null, orderError: null, databaseError: null, ownershipOverride: undefined,
    orders: new Map([[orderId, { id: orderId, user_id: ownerId, payment_status: "pending",
      customer_name: "Test customer", customer_email: "customer@example.invalid", customer_phone: "1234567890",
      shipping_address: { addressLine1: "Private street", trackingTokenHash: "private-token" } }]]),
    tickets: new Map(), env: {},
  };
  let revision = 0;
  function client(kind) {
    return {
      auth: { async getUser() { calls.push({ kind: "auth" }); return { data: { user: state.user }, error: state.authError }; } },
      from(table) {
        assert.equal(table, kind === "auth" ? "website_orders" : "website_order_help_requests");
        const details = { kind, table, operation: "select", filters: [], columns: "", limit: Infinity, sort: [] };
        const query = {
          select(columns) { details.columns = columns; return query; },
          eq(key, value) { details.filters.push([key, value]); return query; },
          insert(value) { details.operation = "insert"; details.value = plain(value); return query; },
          update(value) { details.operation = "update"; details.value = plain(value); return query; },
          order(key, options) { details.sort.push([key, options]); return query; },
          limit(value) { details.limit = value; return query; },
          or(value) { details.or = value; return query; },
          async single() { return execute(true); },
          async maybeSingle() { return execute(true); },
          then(resolve, reject) { return Promise.resolve().then(() => execute(false)).then(resolve, reject); },
        };
        function execute(single) {
          calls.push(plain(details));
          if (kind === "auth") {
            const selected = state.ownershipOverride !== undefined ? state.ownershipOverride
              : [...state.orders.values()].find((row) => details.filters.every(([key, value]) => row[key] === value));
            return { data: selected ?? null, error: state.orderError };
          }
          if (state.databaseError) return { data: null, error: state.databaseError };
          if (details.operation === "insert") {
            if (state.tickets.has(details.value.id)) return { data: null, error: { code: "23505", detail: "private duplicate detail" } };
            const row = { ...details.value, status: "open", created_at: createdAt, updated_at: createdAt, updated_by: null };
            state.tickets.set(row.id, row);
            return { data: { ...row }, error: null };
          }
          let rows = [...state.tickets.values()].filter((row) => details.filters.every(([key, value]) => row[key] === value));
          if (details.operation === "update") {
            for (const row of rows) Object.assign(row, details.value, { updated_at: `2026-11-17T11:00:00.${String(++revision).padStart(6, "0")}+00:00` });
          }
          if (details.or) {
            const match = /^created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([a-f0-9-]+)\)$/.exec(details.or);
            assert.ok(match, "Cursor must be a bounded timestamp/UUID keyset filter");
            assert.equal(match[1], match[2]);
            rows = rows.filter((row) => row.created_at < match[1] || (row.created_at === match[1] && row.id < match[3]));
          }
          for (const [key, options] of [...details.sort].reverse()) rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (options.ascending ? 1 : -1));
          rows = rows.slice(0, details.limit).map((row) => ({ ...row, order: state.orders.get(row.order_id), internalSecret: "must-not-leak" }));
          return { data: single ? rows[0] ?? null : rows, error: null };
        }
        return query;
      },
    };
  }
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const module = { exports: {} };
    const { outputText } = ts.transpileModule(readFileSync(path.join(projectRoot, filename), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
    });
    vm.runInNewContext(outputText, {
      module, exports: module.exports, Buffer, URL, process: { env: state.env },
      require(name) {
        if (name === "server-only") return {};
        if (name === "next/server") return { NextResponse: { json: (body, options) => Response.json(body, options) } };
        if (name === "@/lib/supabase/auth-server") return { getSupabaseAuthServerClient: async () => client("auth") };
        if (name === "@/lib/supabase/admin") return { getSupabaseAdminClient: () => { calls.push({ kind: "service-client" }); return client("admin"); } };
        assert.ok(name.startsWith("@/lib/"), `Unexpected dependency: ${name}`);
        return load(`${name.slice(2)}.ts`);
      },
    }, { filename });
    modules.set(filename, module.exports);
    return module.exports;
  }
  const service = load("lib/order-help.ts");
  const validation = load("lib/order-help-request.ts");
  const account = load("app/api/account/order-help/route.ts");
  const admin = load("app/api/admin/order-help/route.ts");
  const update = load("app/api/admin/order-help/[orderId]/[id]/route.ts");
  return { state, service, validation, calls, account, admin, update,
    staff() { state.user.app_metadata = { role: "admin" }; },
    serviceCalls() { return calls.filter((call) => call.kind === "service-client"); },
  };
}

function post(body = submission, options = {}) {
  return new Request(`${origin}/api/account/order-help`, {
    method: options.method ?? "POST", headers: { origin, "content-type": "application/json", ...options.headers },
    body: options.raw ?? JSON.stringify(body),
  });
}

function seed(h, id = requestId, overrides = {}) {
  h.state.tickets.set(id, { id, order_id: orderId, user_id: ownerId, topic: "delivery", message: submission.message,
    status: "open", created_at: createdAt, updated_at: createdAt, updated_by: null, ...overrides });
}

test("customer requests recheck authentication and explicit ownership before service-role access", async () => {
  const h = harness();
  h.state.user = null;
  assert.equal((await h.account.POST(post())).status, 401);
  h.state.user = { id: ownerId, email: "customer@example.invalid" };
  h.state.authError = { message: "secret auth diagnostic" };
  assert.equal((await h.account.POST(post())).status, 401);
  h.state.authError = null;
  h.state.ownershipOverride = { ...h.state.orders.get(orderId), user_id: otherId };
  assert.equal((await h.account.POST(post())).status, 404);
  h.state.ownershipOverride = { ...h.state.orders.get(orderId), id: secondOrderId };
  assert.equal((await h.account.POST(post())).status, 404);
  h.state.ownershipOverride = null;
  assert.equal((await h.account.POST(post())).status, 404);
  assert.equal(h.serviceCalls().length, 0);
  assert.equal(h.state.tickets.size, 0);
});

test("own pending orders can request help; client identity and status cannot override server values", async () => {
  const h = harness();
  const result = await h.account.POST(post({ ...submission, message: `  ${submission.message}  `, user_id: otherId,
    status: "resolved", customer_email: "attacker@example.invalid", updated_by: otherId }));
  assert.equal(result.status, 201);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.equal(result.headers.get("x-robots-tag"), "noindex, nofollow");
  const { request } = await result.json();
  assert.deepEqual(Object.keys(request).sort(), ["createdAt", "id", "message", "orderId", "status", "topic", "updatedAt"]);
  assert.equal(request.id, requestId);
  assert.equal(request.status, "open");
  assert.equal(request.message, submission.message);
  assert.equal(h.state.tickets.get(requestId).user_id, ownerId);
  assert.equal(h.state.tickets.get(requestId).updated_by, null);
  assert.doesNotMatch(JSON.stringify(request), /customer@example|Private street|private-token|must-not-leak/);
  const check = h.calls.find((call) => call.table === "website_orders");
  assert.deepEqual(check.filters, [["id", orderId], ["user_id", ownerId]]);
});

test("concurrent retries return one receipt and preserve later staff status", async () => {
  const h = harness();
  const replies = await Promise.all([h.service.createOrderHelpRequest(submission), h.service.createOrderHelpRequest(submission)]);
  assert.equal(replies[0].id, replies[1].id);
  assert.equal(h.state.tickets.size, 1);
  h.state.tickets.get(requestId).status = "resolved";
  const retry = await h.service.createOrderHelpRequest({ ...submission, message: ` ${submission.message}\n` });
  assert.equal(retry.id, requestId);
  assert.equal(retry.status, "resolved");
  h.state.orders.get(orderId).user_id = otherId;
  await assert.rejects(h.service.createOrderHelpRequest(submission), { status: 404 });
});

test("reusing a request reference for changed content or another owner never overwrites or leaks a ticket", async () => {
  const h = harness();
  seed(h);
  h.state.orders.set(secondOrderId, { ...h.state.orders.get(orderId), id: secondOrderId });
  for (const changed of [{ message: "A changed request must be a new ticket." }, { topic: "payment" }, { orderId: secondOrderId }]) {
    await assert.rejects(h.service.createOrderHelpRequest({ ...submission, ...changed }), { status: 409 });
  }
  h.state.tickets.get(requestId).user_id = otherId;
  h.state.tickets.get(requestId).message = "Private request from another customer";
  const result = await h.account.POST(post());
  assert.equal(result.status, 409);
  assert.doesNotMatch(await result.text(), /Private request|another customer/);
  assert.equal(h.state.tickets.get(requestId).message, "Private request from another customer");
  assert.equal(h.state.tickets.size, 1);
});

test("invalid topics, identifiers and messages fail before database access", async () => {
  const h = harness();
  for (const invalid of [{ orderId: "other.id" }, { requestId: "not-a-uuid" }, { topic: "admin" }, { topic: {} },
    { message: "  short " }, { message: "x".repeat(3001) }, { message: "valid length\u0000but forbidden" }, { message: {} }]) {
    await assert.rejects(h.service.createOrderHelpRequest({ ...submission, ...invalid }), { status: 400 });
  }
  assert.equal(h.calls.length, 0);
});

test("message limits count Unicode characters consistently with database constraints", async () => {
  const h = harness();
  for (const length of [5, 3001]) {
    const response = await h.account.POST(post({ ...submission, message: "😀".repeat(length) }));
    assert.equal(response.status, 400);
  }
  assert.equal(h.serviceCalls().length, 0);
  for (const [length, id] of [[10, requestId], [3000, "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff"]]) {
    const response = await h.account.POST(post({ ...submission, requestId: id, message: "😀".repeat(length) }));
    assert.equal(response.status, 201);
    assert.equal(Array.from((await response.json()).request.message).length, length);
  }
});

test("admin listings require trusted staff metadata or explicit allowlist; user metadata grants nothing", async () => {
  const h = harness();
  seed(h);
  h.state.user = null;
  assert.equal((await h.admin.GET(new Request(`${origin}/api/admin/order-help`))).status, 401);
  h.state.user = { id: ownerId, user_metadata: { role: "admin" }, app_metadata: {} };
  const refused = await h.admin.GET(new Request(`${origin}/api/admin/order-help`));
  assert.equal(refused.status, 403);
  assert.doesNotMatch(await refused.text(), /customer@example|1234567890|delivery date/);
  assert.equal(h.serviceCalls().length, 0);
  h.state.env.ADMIN_USER_IDS = `invalid, ${ownerId.toUpperCase()} `;
  const allowed = await h.admin.GET(new Request(`${origin}/api/admin/order-help`));
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("cache-control"), "private, no-store");
  const { requests } = await allowed.json();
  assert.deepEqual(requests[0].customer, { name: "Test customer", email: "customer@example.invalid", phone: "1234567890" });
  assert.doesNotMatch(JSON.stringify(requests), /Private street|private-token|must-not-leak|updated_by|user_id/);
});

test("admin keyset pagination handles equal timestamps without repeating requests", async () => {
  const h = harness();
  h.staff();
  for (let index = 0; index < 26; index++) seed(h, `aaaaaaaa-bbbb-4ccc-8ddd-${String(index).padStart(12, "0")}`);
  const first = await h.service.listOrderHelpRequests();
  assert.equal(first.requests.length, 25);
  assert.ok(first.nextCursor);
  const next = await h.service.listOrderHelpRequests(first.nextCursor);
  assert.equal(next.requests.length, 1);
  assert.equal(next.nextCursor, null);
  assert.equal(new Set([...first.requests, ...next.requests].map((row) => row.id)).size, 26);
});

test("invalid or injected cursors are rejected before service-role query construction", async () => {
  const h = harness();
  h.staff();
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  for (const cursor of ["!!!", "x".repeat(513), encode(null), encode({ createdAt, id: `${requestId}),id.neq.null` }),
    encode({ createdAt: `${createdAt},id.neq.null`, id: requestId }), encode({ createdAt: "invalid", id: requestId })]) {
    await assert.rejects(h.service.listOrderHelpRequests(cursor), { status: 400 });
  }
  assert.equal(h.serviceCalls().length, 0);
});

test("staff status updates are scoped to order and timestamp; stale writers cannot overwrite", async () => {
  const h = harness();
  seed(h);
  await assert.rejects(h.service.updateOrderHelpRequest(orderId, requestId, { status: "resolved", expectedUpdatedAt: createdAt }), { status: 403 });
  assert.equal(h.serviceCalls().length, 0);
  h.staff();
  const first = await h.service.updateOrderHelpRequest(orderId, requestId, { status: "in_progress", expectedUpdatedAt: createdAt,
    message: "Do not overwrite the customer message", user_id: otherId, order_id: secondOrderId });
  assert.equal(first.status, "in_progress");
  assert.notEqual(first.updatedAt, createdAt);
  assert.equal(h.state.tickets.get(requestId).message, submission.message);
  assert.equal(h.state.tickets.get(requestId).user_id, ownerId);
  assert.equal(h.state.tickets.get(requestId).updated_by, ownerId);
  await assert.rejects(h.service.updateOrderHelpRequest(orderId, requestId, { status: "resolved", expectedUpdatedAt: createdAt }), { status: 409 });
  await assert.rejects(h.service.updateOrderHelpRequest(secondOrderId, requestId, { status: "resolved", expectedUpdatedAt: first.updatedAt }), { status: 409 });
  assert.equal(h.state.tickets.get(requestId).status, "in_progress");
  const resolved = await h.service.updateOrderHelpRequest(orderId, requestId, { status: "resolved", expectedUpdatedAt: first.updatedAt });
  assert.equal(resolved.status, "resolved");
});

test("invalid staff updates never mutate stored requests", async () => {
  const h = harness();
  h.staff();
  seed(h);
  for (const body of [{ status: "deleted", expectedUpdatedAt: createdAt }, { status: "resolved" },
    { status: "resolved", expectedUpdatedAt: `${createdAt},id.neq.null` }]) {
    await assert.rejects(h.service.updateOrderHelpRequest(orderId, requestId, body), { status: 400 });
  }
  assert.equal(h.serviceCalls().length, 0);
  assert.equal(h.state.tickets.get(requestId).status, "open");
});

test("mutation routes enforce same-origin JSON and cap declared and streamed body sizes", async () => {
  const h = harness();
  for (const [options, status] of [
    [{ headers: { origin: "https://evil.example" } }, 403],
    [{ headers: { origin: "null" } }, 403],
    [{ headers: { "content-type": "text/plain" } }, 415],
    [{ headers: { "content-length": "16385" } }, 413],
    [{ raw: "x".repeat(16385), headers: { "content-length": "1" } }, 413],
    [{ raw: "{" }, 400], [{ raw: "[]" }, 400], [{ raw: "null" }, 400],
  ]) assert.equal((await h.account.POST(post(submission, options))).status, status);
  const missingOrigin = post();
  missingOrigin.headers.delete("origin");
  assert.equal((await h.account.POST(missingOrigin)).status, 403);
  const patch = await h.update.PATCH(post({}, { method: "PATCH", headers: { origin: "https://evil.example" } }),
    { params: Promise.resolve({ orderId, id: requestId }) });
  assert.equal(patch.status, 403);
  assert.equal(h.calls.length, 0);
});

test("database failures return only trusted errors and private no-store headers across all routes", async () => {
  const h = harness();
  h.state.databaseError = { message: "postgres secret-password private-address", code: "42P01" };
  const created = await h.account.POST(post());
  h.staff();
  const listed = await h.admin.GET(new Request(`${origin}/api/admin/order-help`));
  const updated = await h.update.PATCH(post({ status: "resolved", expectedUpdatedAt: createdAt }, { method: "PATCH" }),
    { params: Promise.resolve({ orderId, id: requestId }) });
  for (const response of [created, listed, updated]) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ["error"]);
    assert.doesNotMatch(body.error, /postgres|secret-password|private-address|42P01/);
  }
});

test("support migration keeps direct browser roles out and supplies database concurrency timestamps", () => {
  const sql = readFileSync(path.join(projectRoot, "supabase/migrations/20261117_website_order_help_requests.sql"), "utf8");
  assert.match(sql, /ALTER TABLE public\.website_order_help_requests ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL ON public\.website_order_help_requests FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON public\.website_order_help_requests TO service_role/i);
  assert.doesNotMatch(sql, /CREATE POLICY|GRANT[^;]+TO\s+(?:anon|authenticated)/i);
  assert.match(sql, /BEFORE UPDATE ON public\.website_order_help_requests/i);
  assert.match(sql, /OLD\.updated_at\s*\+\s*interval '1 microsecond'/i);
});
