const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const ORIGIN = "https://example.test";
const ORDER_ID = "11111111-2222-4333-8444-555555555555";
const FILE_ID = "22222222-3333-4444-8555-666666666666";
const USER_ID = "33333333-4444-4555-8666-777777777777";
const OTHER_USER_ID = "44444444-5555-4666-8777-888888888888";
const RECEIPT_TOKEN = Buffer.alloc(32, 1).toString("base64url");
const TRACKING_TOKEN = Buffer.alloc(32, 2).toString("base64url");
const tokenHash = value => createHash("sha256").update(value).digest("hex");
const result = data => ({ data, error: null });
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const fileRow = (overrides = {}) => ({
  id: FILE_ID, order_id: ORDER_ID, storage_path: `${ORDER_ID}/${FILE_ID}.pdf`, file_name: "Wedding matter.pdf",
  size_bytes: PDF.length, content_type: "application/pdf", notes: "Main invitation insert.", state: "pending",
  created_at: "2026-11-24T08:02:00Z", completed_at: null, expires_at: "2099-01-01T00:00:00Z", ...overrides,
});
const order = (overrides = {}) => ({
  id: ORDER_ID, user_id: USER_ID, created_at: "2026-11-24T08:00:00Z", paid_at: "2026-11-24T08:01:00Z",
  payment_status: "paid", razorpay_payment_id: "pay_example", razorpay_order_id: "order_example",
  amount_paise: 10000, currency: "INR", customer_name: "Customer", customer_email: "customer@example.test",
  customer_phone: "9876543210", notes: "", items: [{ itemCode: "CARD1", name: "Card", quantity: 50, price: 2 }],
  shipping_address: { receiptTokenHash: tokenHash(RECEIPT_TOKEN), trackingTokenHash: tokenHash(TRACKING_TOKEN) },
  ...overrides,
});

// Run the actual routes, receipt capability checks and file service against
// isolated database/storage clients. No live orders, credentials or network.
function harness({ adminResults = [], customerResults = [], rpcResults = [], storageResults = {}, user = null, fetchResponse } = {}) {
  const queries = [], authCalls = [], storageCalls = [], rpcCalls = [], fetches = [];
  const modules = new Map();
  function client(kind, responses) {
    return {
      from(table) {
        const query = { kind, table, calls: [] };
        queries.push(query);
        const builder = {};
        for (const method of ["select", "insert", "update", "delete", "eq", "neq", "is", "in", "lt", "lte", "gt", "gte", "order", "limit", "or", "single", "maybeSingle"])
          builder[method] = (...args) => { query.calls.push([method, ...args]); return builder; };
        builder.then = (resolve, reject) => {
          assert.ok(responses.length, `Unexpected ${kind} query: ${table} ${JSON.stringify(query.calls)}`);
          return Promise.resolve(responses.shift()).then(resolve, reject);
        };
        return builder;
      },
    };
  }
  const admin = {
    ...client("admin", adminResults),
    rpc: async (...args) => {
      rpcCalls.push(args);
      assert.ok(rpcResults.length, `Unexpected RPC: ${args[0]}`);
      return rpcResults.shift();
    },
    storage: {
      from(bucket) {
        const storage = {};
        for (const method of ["createSignedUploadUrl", "createSignedUrl", "info", "download", "remove", "exists", "list", "upload", "copy", "move"]) {
          storage[method] = async (...args) => {
            storageCalls.push({ bucket, method, args });
            const responses = storageResults[method];
            assert.ok(responses?.length, `Unexpected storage operation: ${method} ${JSON.stringify(args)}`);
            return responses.shift();
          };
        }
        storage.getPublicUrl = () => assert.fail("Printing matter must never receive a public URL");
        return storage;
      },
    },
  };
  const mocks = {
    "server-only": {},
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/supabase/admin": { getSupabaseAdminClient: () => admin },
    "@/lib/supabase/auth-server": {
      getSupabaseAuthServerClient: async () => ({
        ...client("customer", customerResults),
        auth: { getUser: async () => { authCalls.push("getUser"); return { data: { user }, error: null }; } },
      }),
    },
  };
  function load(relativePath) {
    const filename = path.resolve(__dirname, "..", relativePath);
    if (modules.has(filename)) return modules.get(filename);
    const loaded = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function("require", "module", "exports", "fetch", "process", compiled)(name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("@/")) return load(`${name.slice(2)}.ts`);
      if (name.startsWith(".")) return load(path.relative(path.resolve(__dirname, ".."), path.resolve(path.dirname(filename), `${name}.ts`)));
      return require(name);
    }, loaded, loaded.exports, async (...args) => {
      fetches.push(args);
      assert.ok(fetchResponse, "Unexpected network request");
      return fetchResponse(...args);
    }, { env: {} });
    modules.set(filename, loaded.exports);
    return loaded.exports;
  }
  return { load, queries, authCalls, storageCalls, rpcCalls, fetches };
}

function request(body, { origin = ORIGIN, contentType = "application/json", rawBody } = {}) {
  const headers = { "Content-Type": contentType };
  if (origin !== null) headers.Origin = origin;
  return new Request(`${ORIGIN}/api/orders/printing-matter`, { method: "POST", headers, body: rawBody ?? JSON.stringify(body) });
}
const customerPost = (h, body = {}, options) => h.load("app/api/orders/printing-matter/route.ts").POST(
  request({ orderId: ORDER_ID, action: "list", ...body }, options),
);
const adminRoute = h => h.load("app/api/admin/orders/[id]/printing-matter/route.ts");
const params = () => ({ params: Promise.resolve({ id: ORDER_ID }) });

test("file metadata accepts supported documents while rejecting spoofed extensions, paths and oversized files", () => {
  const h = harness();
  const { printingUploadMetadata } = h.load("lib/order-printing-request.ts");
  const { PRINTING_MAX_FILE_BYTES } = h.load("lib/order-printing-types.ts");
  const value = printingUploadMetadata({ fileName: " Wedding matter.PDF ", sizeBytes: 200, notes: " Use this for the main insert. " });
  assert.equal(value.fileName, "Wedding matter.PDF");
  assert.equal(value.contentType, "application/pdf");
  assert.equal(value.notes, "Use this for the main insert.");
  for (const fileName of ["matter.exe", "matter.pdf.exe", "../matter.pdf", "folder\\matter.pdf", "matter\u0000.pdf", "a".repeat(201) + ".pdf"]) {
    assert.throws(() => printingUploadMetadata({ fileName, sizeBytes: 100 }), error => error.status === 400, fileName);
  }
  for (const sizeBytes of [0, -1, 1.5, Infinity, "100"]) {
    assert.throws(() => printingUploadMetadata({ fileName: "matter.pdf", sizeBytes }), error => error.status === 400 || error.status === 413);
  }
  assert.throws(() => printingUploadMetadata({ fileName: "matter.pdf", sizeBytes: PRINTING_MAX_FILE_BYTES + 1 }), error => error.status === 413);
  assert.throws(() => printingUploadMetadata({ fileName: "matter.pdf", sizeBytes: 100, notes: "x".repeat(2001) }), error => error.status === 400);
  assert.equal(printingUploadMetadata({ fileName: "বাংলা.docx", sizeBytes: 200 }).extension, "docx");
});

test("guest receipt access lists printing files without requiring an account", async () => {
  const h = harness({ adminResults: [result(order()), result([])] });
  const response = await customerPost(h, { receiptToken: RECEIPT_TOKEN });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).files, []);
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.deepEqual(h.authCalls, []);
  assert.deepEqual(h.storageCalls, []);
});

test("a tracking-only token cannot read or upload printing matter", async () => {
  for (const action of ["list", "prepare"]) {
    const h = harness({ adminResults: [result(order())] });
    const response = await customerPost(h, {
      action, receiptToken: TRACKING_TOKEN, fileName: "wording.pdf", sizeBytes: 100, notes: "",
    });
    assert.equal(response.status, 404);
    assert.equal(h.queries.length, 1);
    assert.equal(h.queries[0].table, "website_orders");
    assert.deepEqual(h.storageCalls, []);
    assert.deepEqual(h.rpcCalls, []);
  }
});

test("account access requires ownership, never just a matching email", async () => {
  const denied = harness({ user: { id: OTHER_USER_ID, email: order().customer_email }, customerResults: [result(null)] });
  assert.equal((await customerPost(denied)).status, 404);
  assert.deepEqual(denied.queries[0].calls.filter(([method]) => method === "eq"), [
    ["eq", "id", ORDER_ID], ["eq", "user_id", OTHER_USER_ID],
  ]);
  assert.deepEqual(denied.storageCalls, []);
  const allowed = harness({ user: { id: USER_ID }, customerResults: [result(order())], adminResults: [result([])] });
  assert.equal((await customerPost(allowed)).status, 200);
  assert.equal(allowed.queries[0].kind, "customer");
});

test("unpaid orders cannot reserve file storage", async () => {
  const h = harness({ adminResults: [result(order({ payment_status: "pending", paid_at: null }))] });
  const response = await customerPost(h, { action: "prepare", receiptToken: RECEIPT_TOKEN, fileName: "matter.pdf", sizeBytes: 100 });
  assert.equal(response.status, 409);
  assert.deepEqual(h.rpcCalls, []);
  assert.deepEqual(h.storageCalls, []);
});

test("printing APIs reject foreign/missing origins and malformed or oversized JSON", async () => {
  for (const scenario of [
    { options: { origin: null }, status: 403 },
    { options: { origin: "https://foreign.test" }, status: 403 },
    { options: { contentType: "text/plain" }, status: 415 },
    { options: { rawBody: "[1,2]" }, status: 400 },
    { options: { rawBody: "{bad" }, status: 400 },
    { options: { rawBody: JSON.stringify({ notes: "x".repeat(40000) }) }, status: 413 },
  ]) {
    const h = harness();
    assert.equal((await customerPost(h, {}, scenario.options)).status, scenario.status);
    assert.deepEqual(h.queries, []);
    assert.deepEqual(h.storageCalls, []);
  }
});

test("admin printing list works without a sign-in session or an auth lookup", async () => {
  const h = harness({ adminResults: [result([])] });
  const response = await adminRoute(h).GET(new Request(`${ORIGIN}/api/admin/orders/${ORDER_ID}/printing-matter`), params());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { files: [] });
  assert.deepEqual(h.authCalls, []);
  assert.deepEqual(h.queries[0].calls.filter(([method]) => method === "eq"), [["eq", "order_id", ORDER_ID], ["eq", "state", "ready"]]);
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.deepEqual(h.storageCalls, []);
});

test("prepare reserves an order-scoped immutable upload and never accepts a client storage path", async () => {
  const h = harness({
    adminResults: [result(order()), result([])], rpcResults: [result(fileRow())],
    storageResults: { createSignedUploadUrl: [result({ signedUrl: "https://storage.example.test/private-upload" })] },
  });
  const response = await customerPost(h, { action: "prepare", receiptToken: RECEIPT_TOKEN,
    fileName: "Wedding matter.pdf", sizeBytes: PDF.length, notes: "Main insert", storagePath: "another-order/other.pdf" });
  assert.equal(response.status, 200);
  const prepared = await response.json();
  const reservation = h.rpcCalls[0];
  assert.equal(reservation[0], "reserve_website_order_printing_file");
  assert.equal(reservation[1].p_order_id, ORDER_ID);
  assert.equal(reservation[1].p_file_id, prepared.fileId);
  assert.equal(reservation[1].p_storage_path, `${ORDER_ID}/${prepared.fileId}.pdf`);
  assert.equal(reservation[1].p_content_type, "application/pdf");
  assert.deepEqual(h.storageCalls[0], {
    bucket: "website_order_printing", method: "createSignedUploadUrl",
    args: [`${ORDER_ID}/${prepared.fileId}.pdf`, { upsert: false }],
  });
});

test("a reservation quota failure returns a useful conflict without issuing an upload URL", async () => {
  const h = harness({ adminResults: [result(order()), result([])],
    rpcResults: [{ data: null, error: { message: "PRINTING_FILE_LIMIT", code: "P0001" } }] });
  const response = await customerPost(h, { action: "prepare", receiptToken: RECEIPT_TOKEN, fileName: "matter.pdf", sizeBytes: 100 });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /10-file upload limit/);
  assert.deepEqual(h.storageCalls, []);
});

test("byte validation rejects disguised documents, truncated images, ordinary ZIPs and macro documents", async () => {
  const h = harness();
  const { printingFileMatches } = h.load("lib/order-printing.ts");
  const { PRINTING_CONTENT_TYPES } = h.load("lib/order-printing-types.ts");
  assert.equal(printingFileMatches(PDF, "application/pdf"), true);
  assert.equal(printingFileMatches(Buffer.from("<script>not a PDF</script>"), "application/pdf"), false);
  assert.equal(printingFileMatches(Buffer.from("%PDF-1.7\nunfinished"), "application/pdf"), false);
  assert.equal(printingFileMatches(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]), "image/jpeg"), true);
  assert.equal(printingFileMatches(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"), false);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=", "base64");
  assert.equal(printingFileMatches(png, "image/png"), true);
  assert.equal(printingFileMatches(png.subarray(0, 40), "image/png"), false);
  const JSZip = require("jszip");
  const wordZip = () => new JSZip()
    .file("[Content_Types].xml", '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    .file("word/document.xml", "<document><p>Wedding wording</p></document>");
  const word = await wordZip().generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  assert.equal(printingFileMatches(word, PRINTING_CONTENT_TYPES.docx), true);
  const ordinaryZip = await new JSZip().file("photo.txt", "not a Word document").generateAsync({ type: "nodebuffer" });
  assert.equal(printingFileMatches(ordinaryZip, PRINTING_CONTENT_TYPES.docx), false);
  const macros = await wordZip().file("word/vbaProject.bin", "macro bytes").generateAsync({ type: "nodebuffer" });
  assert.equal(printingFileMatches(macros, PRINTING_CONTENT_TYPES.docx), false);
  const oversizedXml = await wordZip().file("[Content_Types].xml", "x".repeat(300000)).generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  assert.equal(printingFileMatches(oversizedXml, PRINTING_CONTENT_TYPES.docx), false);
});

test("completion checks storage metadata and bytes before atomically publishing the file", async () => {
  const ready = fileRow({ state: "ready", completed_at: "2026-11-24T08:03:00Z" });
  const h = harness({
    adminResults: [result(order()), result(fileRow())], rpcResults: [result(ready)],
    storageResults: {
      info: [result({ size: PDF.length, contentType: "application/pdf" })],
      createSignedUrl: [result({ signedUrl: "https://storage.example.test/verification-only" })],
    }, fetchResponse: async () => new Response(PDF),
  });
  const response = await customerPost(h, { action: "complete", receiptToken: RECEIPT_TOKEN, fileId: FILE_ID });
  assert.equal(response.status, 200);
  const saved = (await response.json()).file;
  assert.deepEqual(saved, { id: FILE_ID, fileName: ready.file_name, sizeBytes: PDF.length,
    contentType: "application/pdf", notes: ready.notes, createdAt: ready.completed_at });
  assert.deepEqual(h.rpcCalls, [["complete_website_order_printing_file", { p_order_id: ORDER_ID, p_file_id: FILE_ID }]]);
  assert.equal(h.fetches[0][0], "https://storage.example.test/verification-only");
  assert.equal(h.fetches[0][1].redirect, "error");
  assert.equal(h.fetches[0][1].cache, "no-store");
});

test("completion retries return the existing file without redownloading or republishing", async () => {
  const h = harness({ adminResults: [result(order()), result(fileRow({ state: "ready", completed_at: "2026-11-24T08:03:00Z" }))] });
  assert.equal((await customerPost(h, { action: "complete", receiptToken: RECEIPT_TOKEN, fileId: FILE_ID })).status, 200);
  assert.deepEqual(h.rpcCalls, []);
  assert.deepEqual(h.storageCalls, []);
});

test("mismatched storage metadata rejects and removes the upload before downloading", async () => {
  const h = harness({ adminResults: [result(order()), result(fileRow()), result({ id: FILE_ID })],
    storageResults: { info: [result({ size: PDF.length + 1, contentType: "application/pdf" })], remove: [result([])] } });
  const response = await customerPost(h, { action: "complete", receiptToken: RECEIPT_TOKEN, fileId: FILE_ID });
  assert.equal(response.status, 400);
  assert.deepEqual(h.rpcCalls, []);
  assert.deepEqual(h.fetches, []);
  assert.deepEqual(h.queries[2].calls.find(([method]) => method === "update"), ["update", { state: "rejected" }]);
  assert.equal(h.storageCalls.at(-1).method, "remove");
});

test("a spoofed PDF with valid claimed metadata is rejected, not published", async () => {
  const fake = Buffer.alloc(PDF.length, 65);
  const h = harness({ adminResults: [result(order()), result(fileRow()), result({ id: FILE_ID })],
    storageResults: { info: [result({ size: fake.length, contentType: "application/pdf" })],
      createSignedUrl: [result({ signedUrl: "https://storage.example.test/verify" })], remove: [result([])] },
    fetchResponse: async () => new Response(fake),
  });
  const response = await customerPost(h, { action: "complete", receiptToken: RECEIPT_TOKEN, fileId: FILE_ID });
  assert.equal(response.status, 400);
  assert.deepEqual(h.rpcCalls, []);
  assert.match((await response.json()).error, /could not be verified/);
});

test("downloads are scoped to the authorized order and only ready files receive short-lived attachment URLs", async () => {
  const denied = harness({ adminResults: [result(order()), result(null)] });
  assert.equal((await customerPost(denied, { action: "download", receiptToken: RECEIPT_TOKEN, fileId: FILE_ID })).status, 404);
  assert.deepEqual(denied.storageCalls, []);
  assert.deepEqual(denied.queries[1].calls.filter(([method]) => method === "eq"), [["eq", "order_id", ORDER_ID], ["eq", "id", FILE_ID]]);
  const pending = harness({ adminResults: [result(order()), result(fileRow())] });
  assert.equal((await customerPost(pending, { action: "download", receiptToken: RECEIPT_TOKEN, fileId: FILE_ID })).status, 409);
  assert.deepEqual(pending.storageCalls, []);
  const ready = fileRow({ state: "ready", completed_at: "2026-11-24T08:03:00Z" });
  const allowed = harness({ adminResults: [result(order()), result(ready)],
    storageResults: { createSignedUrl: [result({ signedUrl: "https://storage.example.test/attachment" })] } });
  assert.equal((await customerPost(allowed, { action: "download", receiptToken: RECEIPT_TOKEN, fileId: FILE_ID })).status, 200);
  assert.deepEqual(allowed.storageCalls[0].args, [ready.storage_path, 60, { download: ready.file_name }]);
});

test("cancelled and expired uploads cannot be completed; submitted history cannot be cancelled", async () => {
  for (const row of [fileRow({ state: "cancelled" }), fileRow({ expires_at: "2000-01-01T00:00:00Z" })]) {
    const h = harness({ adminResults: [result(order()), result(row)] });
    assert.equal((await customerPost(h, { action: "complete", receiptToken: RECEIPT_TOKEN, fileId: FILE_ID })).status, 410);
    assert.deepEqual(h.storageCalls, []);
    assert.deepEqual(h.rpcCalls, []);
  }
  const h = harness({ adminResults: [result(order()), result(fileRow({ state: "ready", completed_at: "2026-11-24T08:03:00Z" }))] });
  assert.equal((await customerPost(h, { action: "cancel", receiptToken: RECEIPT_TOKEN, fileId: FILE_ID })).status, 409);
  assert.deepEqual(h.storageCalls, []);
});

test("admin can list and download private printing files without signing in", async () => {
  const ready = fileRow({ state: "ready", completed_at: "2026-11-24T08:03:00Z" });
  const h = harness({ adminResults: [result([ready]), result(ready)],
    storageResults: { createSignedUrl: [result({ signedUrl: "https://storage.example.test/admin-attachment" })] } });
  const listed = await adminRoute(h).GET(new Request(`${ORIGIN}/api/admin/orders/${ORDER_ID}/printing-matter`), params());
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).files[0].id, FILE_ID);
  const download = await adminRoute(h).POST(request({ action: "download", fileId: FILE_ID }), params());
  assert.equal(download.status, 200);
  assert.deepEqual(await download.json(), { url: "https://storage.example.test/admin-attachment" });
  assert.deepEqual(h.authCalls, []);
  assert.deepEqual(h.queries[1].calls.filter(([method]) => method === "eq"), [["eq", "order_id", ORDER_ID], ["eq", "id", FILE_ID]]);
  assert.deepEqual(h.storageCalls[0].args, [ready.storage_path, 60, { download: ready.file_name }]);
});

test("admin downloads still reject cross-origin requests, unfinished files and files outside the selected order", async () => {
  for (const origin of [null, "https://foreign.test"]) {
    const h = harness();
    const response = await adminRoute(h).POST(request({ action: "download", fileId: FILE_ID }, { origin }), params());
    assert.equal(response.status, 403);
    assert.deepEqual(h.authCalls, []);
    assert.deepEqual(h.queries, []);
    assert.deepEqual(h.storageCalls, []);
  }
  const h = harness({ adminResults: [result(null)] });
  assert.equal((await adminRoute(h).POST(request({ action: "download", fileId: FILE_ID }), params())).status, 404);
  assert.deepEqual(h.queries[0].calls.filter(([method]) => method === "eq"), [["eq", "order_id", ORDER_ID], ["eq", "id", FILE_ID]]);
  assert.deepEqual(h.storageCalls, []);
  const pending = harness({ adminResults: [result(fileRow())] });
  assert.equal((await adminRoute(pending).POST(request({ action: "download", fileId: FILE_ID }), params())).status, 409);
  assert.deepEqual(pending.storageCalls, []);
});
