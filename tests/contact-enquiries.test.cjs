const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const ID = "f8d062c5-01b6-4f33-85c6-aed8ca101692";
const CREATED_AT = "2026-11-21T08:30:00.000Z";
const submission = (overrides = {}) => ({
  requestId: ID, name: "Example Customer", mobile: "+91 98765 43210", email: "customer@example.test",
  source: "Website", requirement: "Wedding Cards", subRequirement: "Hindu Wedding Cards",
  quantity: "200", eventDate: "2099-12-01", budgetPerUnit: "0", totalBudget: "0",
  message: "Design no: DEMO-001 — Sample design\nPlease use ivory paper.", ...overrides,
});
const row = (overrides = {}) => ({
  id: ID, name: "Example Customer", mobile: "9876543210", email: "customer@example.test",
  source: "Website", requirement: "Wedding Cards", sub_requirement: "Hindu Wedding Cards",
  quantity: 200, event_date: "2099-12-01", budget_per_unit: 0, total_budget: 0,
  message: "Design no: DEMO-001 — Sample design\nPlease use ivory paper.", created_at: CREATED_AT,
  ...overrides,
});

// Execute the actual server modules with in-memory database and ERP responses.
// No network requests or customer records are used by this suite.
function harness({ results = [], env = {}, fetchResponse } = {}) {
  const queries = [];
  const events = [];
  const fetches = [];
  const modules = new Map();
  const client = {
    from(table) {
      events.push("database");
      const query = { table, calls: [] };
      queries.push(query);
      const builder = {};
      for (const method of ["insert", "select", "eq", "order", "limit", "or", "single", "maybeSingle"]) {
        builder[method] = (...args) => { query.calls.push([method, ...args]); return builder; };
      }
      builder.then = (resolve, reject) => {
        assert.ok(results.length, `Unexpected database query: ${JSON.stringify(query.calls)}`);
        return Promise.resolve(results.shift()).then(resolve, reject);
      };
      return builder;
    },
  };
  const mocks = {
    "server-only": {},
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/supabase/admin": { getSupabaseAdminClient: () => client },
  };
  function load(relativePath) {
    if (modules.has(relativePath)) return modules.get(relativePath);
    const filename = path.resolve(__dirname, "..", relativePath);
    const module = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function("require", "module", "exports", "process", "fetch", "console", compiled)(
      name => {
        assert.notEqual(name, "@/lib/admin-auth", "Contact enquiries do not require a sign-in dependency");
        if (Object.hasOwn(mocks, name)) return mocks[name];
        if (name.startsWith("@/")) return load(`${name.slice(2)}.ts`);
        return require(name);
      }, module, module.exports, { env },
      async (...args) => {
        events.push("erp"); fetches.push(args);
        assert.ok(fetchResponse, "Unexpected outbound request");
        return typeof fetchResponse === "function" ? fetchResponse(...args) : fetchResponse;
      },
      { log() {}, warn() {}, error() {} },
    );
    modules.set(relativePath, module.exports);
    return module.exports;
  }
  return { load, queries, events, fetches };
}

const postRequest = (body) => new Request("https://example.test/api/contact-lead", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("contact validation keeps all submitted details and distinguishes zero from blank", () => {
  const { validateContactEnquiry } = harness().load("lib/contact-enquiries.ts");
  const { requestId, data } = validateContactEnquiry(submission());
  assert.equal(requestId, ID);
  assert.deepEqual(data, {
    name: "Example Customer", mobile: "9876543210", email: "customer@example.test", source: "Website",
    requirement: "Wedding Cards", subRequirement: "Hindu Wedding Cards", quantity: 200,
    eventDate: "2099-12-01", budgetPerUnit: 0, totalBudget: 0,
    message: "Design no: DEMO-001 — Sample design\nPlease use ivory paper.",
  });
  const optional = validateContactEnquiry(submission({ quantity: "", budgetPerUnit: "", totalBudget: "", email: "", eventDate: "", message: "" })).data;
  assert.equal(optional.quantity, null);
  assert.equal(optional.budgetPerUnit, null);
  assert.equal(optional.totalBudget, null);
  assert.equal(optional.eventDate, "");
  assert.equal(optional.message, "");
});

test("contact validation rejects malformed contact, quantity, budget, and event fields", () => {
  const { validateContactEnquiry, ContactEnquiryError } = harness().load("lib/contact-enquiries.ts");
  for (const invalid of [
    { name: "" }, { mobile: "123" }, { email: "invalid" }, { quantity: "1.5" }, { quantity: "-1" },
    { budgetPerUnit: "Infinity" }, { budgetPerUnit: "-1" }, { eventDate: "2099-02-30" },
    { requirement: "Unknown" }, { subRequirement: "Unknown" }, { message: "x".repeat(2001) },
    { requestId: "invalid-id" },
  ]) {
    assert.throws(() => validateContactEnquiry(submission(invalid)), ContactEnquiryError, JSON.stringify(invalid).slice(0, 100));
  }
});

test("budget totals are checked and irrelevant card types are cleared", () => {
  const { validateContactEnquiry } = harness().load("lib/contact-enquiries.ts");
  const result = validateContactEnquiry(submission({ requirement: "Shagun Envelopes", budgetPerUnit: "12.50", totalBudget: "" })).data;
  assert.equal(result.requirement, "Sagun Envelopes");
  assert.equal(result.subRequirement, "");
  assert.equal(result.totalBudget, 2500);
  assert.throws(() => validateContactEnquiry(submission({ budgetPerUnit: "12.50", totalBudget: "100" })),
    error => error.status === 400);
});

test("JSON body validation rejects malformed, non-object and oversized request bodies", async () => {
  const { readContactEnquiryBody } = harness().load("lib/contact-enquiries.ts");
  for (const body of ["null", "[]", "{invalid"] ) {
    await assert.rejects(readContactEnquiryBody(new Request("https://example.test/api/contact-lead", {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    })), error => error.status === 400);
  }
  await assert.rejects(readContactEnquiryBody(new Request("https://example.test/api/contact-lead", {
    method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}",
  })), error => error.status === 415);
  await assert.rejects(readContactEnquiryBody(postRequest({ message: "₹".repeat(6000) })),
    error => error.status === 413);
});

test("saving an enquiry preserves all form fields in the private table", async () => {
  const h = harness({ results: [{ data: row(), error: null }] });
  const result = await h.load("lib/contact-enquiries.ts").saveContactEnquiry(submission());
  assert.equal(result.created, true);
  assert.equal(result.enquiry.message, row().message);
  assert.equal(result.enquiry.createdAt, CREATED_AT);
  assert.equal(result.enquiry.budgetPerUnit, 0);
  assert.equal(h.queries[0].table, "website_contact_enquiries");
  const inserted = h.queries[0].calls.find(([method]) => method === "insert")[1];
  for (const [key, value] of Object.entries(row())) {
    if (key !== "created_at") assert.equal(inserted[key], value, key);
  }
});

test("retrying an unchanged submission returns its receipt without duplicating it", async () => {
  const h = harness({ results: [{ data: null, error: { code: "23505" } }, { data: row(), error: null }] });
  const result = await h.load("lib/contact-enquiries.ts").saveContactEnquiry(submission());
  assert.equal(result.created, false);
  assert.equal(result.enquiry.id, ID);
  assert.equal(h.queries.filter(query => query.calls.some(([method]) => method === "insert")).length, 1);
  assert.ok(h.queries[1].calls.some(call => call[0] === "eq" && call[1] === "id" && call[2] === ID));
});

test("a receipt cannot be reused to silently replace another submission", async () => {
  const h = harness({ results: [{ data: null, error: { code: "23505" } }, { data: row(), error: null }] });
  await assert.rejects(h.load("lib/contact-enquiries.ts").saveContactEnquiry(submission({ message: "Changed details" })),
    error => error.status === 409);
});

test("admin API returns contact details without a sign-in session", async () => {
  const h = harness({ results: [{ data: [row()], error: null }] });
  const response = await h.load("app/api/admin/contact-enquiries/route.ts").GET(new Request("https://example.test/api/admin/contact-enquiries"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.deepEqual(h.events, ["database"]);
  const body = await response.json();
  assert.equal(body.enquiries.length, 1);
  assert.equal(body.enquiries[0].email, row().email);
  assert.equal(body.enquiries[0].message, row().message);
  assert.equal(body.nextCursor, null);
});

test("admin list returns complete details with newest-first pagination and a safe cursor", async () => {
  const rows = Array.from({ length: 26 }, (_, index) => row({
    id: `f8d062c5-01b6-4f33-85c6-${String(100000000000 + index)}`,
    created_at: `2026-11-${String(26 - index).padStart(2, "0")}T08:30:00.000Z`,
  }));
  const h = harness({ results: [{ data: rows, error: null }, { data: [rows[25]], error: null }] });
  const { listContactEnquiries } = h.load("lib/contact-enquiries.ts");
  const first = await listContactEnquiries();
  assert.equal(first.enquiries.length, 25);
  assert.equal(first.enquiries[0].id, rows[0].id);
  assert.equal(first.enquiries[0].message, row().message);
  assert.equal(first.enquiries[0].budgetPerUnit, 0);
  assert.ok(first.nextCursor);
  assert.deepEqual(h.events, ["database"]);
  assert.ok(h.queries[0].calls.some(call => call[0] === "order" && call[1] === "created_at" && call[2].ascending === false));
  const second = await listContactEnquiries(first.nextCursor);
  assert.deepEqual(second.enquiries.map(enquiry => enquiry.id), [rows[25].id]);
  assert.equal(second.nextCursor, null);
  assert.ok(h.queries[1].calls.some(call => call[0] === "or" && call[1].includes(rows[24].id)));
});

test("invalid pagination cursors are rejected before any data query", async () => {
  for (const cursor of ["not a cursor", Buffer.from(JSON.stringify({ createdAt: "invalid", id: ID })).toString("base64url")]) {
    const h = harness();
    await assert.rejects(h.load("lib/contact-enquiries.ts").listContactEnquiries(cursor), error => error.status === 400);
    assert.equal(h.queries.length, 0);
  }
});

test("admin database errors return an unavailable response without exposing internal details", async () => {
  const h = harness({ results: [{ data: null, error: { message: "private database diagnostic" } }] });
  const response = await h.load("app/api/admin/contact-enquiries/route.ts").GET(new Request("https://example.test/api/admin/contact-enquiries"));
  assert.equal(response.status, 503);
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  const body = await response.json();
  assert.ok(body.error);
  assert.doesNotMatch(JSON.stringify(body), /private database diagnostic/);
  assert.equal(body.enquiries, undefined);
});

test("contact form succeeds from durable storage without ERP credentials", async () => {
  const h = harness({ results: [{ data: row(), error: null }] });
  const response = await h.load("app/api/contact-lead/route.ts").POST(postRequest(submission()));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(h.fetches.length, 0);
});

test("ERP errors cannot turn a durably saved enquiry into a failed submission", async () => {
  for (const fetchResponse of [Response.json({ error: "ERP unavailable" }, { status: 503 }), async () => { throw new Error("Network unavailable"); }]) {
    const h = harness({ results: [{ data: row(), error: null }], fetchResponse,
      env: { ERPNEXT_URL: "https://erp.example.test", ERPNEXT_API_KEY: "test-key", ERPNEXT_API_SECRET: "test-secret" } });
    const response = await h.load("app/api/contact-lead/route.ts").POST(postRequest(submission()));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
    assert.equal(h.fetches.length, 1);
    assert.deepEqual(h.events, ["database", "erp"]);
  }
});

test("database failure never reports a successful submission or forwards it to ERP", async () => {
  const h = harness({ results: [{ data: null, error: { code: "DATABASE_UNAVAILABLE" } }],
    env: { ERPNEXT_URL: "https://erp.example.test", ERPNEXT_API_KEY: "test-key", ERPNEXT_API_SECRET: "test-secret" } });
  const response = await h.load("app/api/contact-lead/route.ts").POST(postRequest(submission()));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).success, false);
  assert.equal(h.fetches.length, 0);
});

test("an idempotent form retry does not create a second CRM lead", async () => {
  const h = harness({ results: [{ data: null, error: { code: "23505" } }, { data: row(), error: null }],
    env: { ERPNEXT_URL: "https://erp.example.test", ERPNEXT_API_KEY: "test-key", ERPNEXT_API_SECRET: "test-secret" } });
  const response = await h.load("app/api/contact-lead/route.ts").POST(postRequest(submission()));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(h.fetches.length, 0);
});

test("honeypot submissions do not store records or contact ERP", async () => {
  const h = harness();
  const response = await h.load("app/api/contact-lead/route.ts").POST(postRequest(submission({ website: "spam" })));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(h.queries.length, 0);
  assert.equal(h.fetches.length, 0);
});
