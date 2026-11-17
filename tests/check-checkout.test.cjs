const test = require("node:test");
const assert = require("node:assert/strict");
const { checkCheckout, main } = require("../scripts/check-checkout.cjs");

const configuredEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "private-test-public-key",
  SUPABASE_SECRET_KEY: "private-test-admin-key",
  NEXT_PUBLIC_RAZORPAY_KEY_ID: "rzp_test_fixture",
  RAZORPAY_KEY_SECRET: "private-test-payment-secret",
  RAZORPAY_WEBHOOK_SECRET: "private-test-webhook-secret",
};

function harness({ env = configuredEnv, dbError = null, dbStatus = 200, gatewayStatus = 200 } = {}) {
  const logs = [];
  const requests = [];
  let cancelled = false;
  return {
    logs, requests,
    get cancelled() { return cancelled; },
    options: {
      env, log: (message) => logs.push(message),
      createClient: (url, key, options) => {
        assert.equal(url, configuredEnv.NEXT_PUBLIC_SUPABASE_URL);
        assert.equal(key, configuredEnv.SUPABASE_SECRET_KEY);
        assert.equal(options.auth.persistSession, false);
        return { from(table) {
          assert.equal(table, "website_orders");
          return { select(columns) {
            for (const column of ["id", "customer_email", "shipping_address", "razorpay_order_id", "commission_paise"]) {
              assert.ok(columns.split(",").includes(column));
            }
            return { async limit(count) {
              assert.equal(count, 0);
              return { error: dbError, status: dbStatus, data: [] };
            } };
          } };
        } };
      },
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        assert.equal(url, "https://api.razorpay.com/v1/orders?count=1");
        assert.equal(options.method, "GET");
        return {
          ok: gatewayStatus === 200, status: gatewayStatus,
          body: { async cancel() { cancelled = true; } },
          json() { throw new Error("Order records must not be read"); },
          text() { throw new Error("Raw provider responses must not be read"); },
        };
      },
    },
  };
}

test("successful checks request zero database rows and discard gateway records", async () => {
  const check = harness();
  assert.equal(await checkCheckout(check.options), true);
  assert.equal(check.cancelled, true);
  assert.equal(check.requests.length, 1);
  for (const secret of Object.values(configuredEnv)) assert.ok(!check.logs.join("\n").includes(secret));
  assert.match(check.logs.join("\n"), /Razorpay mode: test/);
});

test("missing configuration fails without making network requests", async () => {
  const check = harness({ env: {} });
  check.options.createClient = () => { throw new Error("Must not create an unconfigured client"); };
  assert.equal(await checkCheckout(check.options), false);
  assert.equal(check.requests.length, 0);
  assert.match(check.logs.join("\n"), /SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY missing/);
});

test("schema failures are actionable and never reveal upstream details", async () => {
  const check = harness({ dbError: { code: "42703", message: "sensitive provider detail" }, dbStatus: 400 });
  assert.equal(await checkCheckout(check.options), false);
  assert.match(check.logs.join("\n"), /schema is incomplete/);
  assert.ok(!check.logs.join("\n").includes("sensitive provider detail"));
});

test("gateway authentication failures are reported without reading response bodies", async () => {
  const check = harness({ gatewayStatus: 401 });
  assert.equal(await checkCheckout(check.options), false);
  assert.equal(check.cancelled, true);
  assert.match(check.logs.join("\n"), /Razorpay rejected credentials \(HTTP 401\)/);
});

test("malformed payment key is rejected before contacting Razorpay", async () => {
  const check = harness({ env: { ...configuredEnv, NEXT_PUBLIC_RAZORPAY_KEY_ID: "malformed-secret-value" } });
  assert.equal(await checkCheckout(check.options), false);
  assert.equal(check.requests.length, 0);
  assert.ok(!check.logs.join("\n").includes("malformed-secret-value"));
});

test("server payment key takes precedence and whitespace is normalized", async () => {
  const check = harness({ env: {
    ...configuredEnv,
    RAZORPAY_KEY_ID: " rzp_live_serverkey \n",
    RAZORPAY_KEY_SECRET: " paymentsecret \n",
  } });
  assert.equal(await checkCheckout(check.options), true);
  assert.equal(check.requests[0].options.headers.Authorization,
    `Basic ${Buffer.from("rzp_live_serverkey:paymentsecret").toString("base64")}`);
  assert.match(check.logs.join("\n"), /Razorpay mode: live/);
  assert.ok(!check.logs.join("\n").includes("serverkey"));
});

test("server-only payment key works without NEXT_PUBLIC_RAZORPAY_KEY_ID", async () => {
  const check = harness({ env: {
    ...configuredEnv,
    RAZORPAY_KEY_ID: "rzp_test_serverkey",
    NEXT_PUBLIC_RAZORPAY_KEY_ID: undefined,
  } });
  assert.equal(await checkCheckout(check.options), true);
  assert.equal(check.requests.length, 1);
});

test("env-only preserves explicit deployment environment without dotenv loading", async () => {
  const check = harness();
  assert.equal(await main({ ...check.options, argv: ["--env-only"], loadEnvConfig() {
    throw new Error("Must not load dotenv files in env-only mode");
  } }), true);
});

test("default dotenv loading selects production precedence and respects development", async () => {
  for (const development of [false, true]) {
    const check = harness({ env: { ...configuredEnv, ...(development ? { NODE_ENV: "development" } : {}) } });
    let loaded = false;
    assert.equal(await main({ ...check.options, argv: [], loadEnvConfig(root, dev) {
      assert.equal(dev, development);
      loaded = true;
    } }), true);
    assert.equal(loaded, true);
  }
});
