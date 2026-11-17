const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const orderColumns = [
  "id", "user_id", "customer_name", "customer_email", "customer_phone",
  "shipping_address", "notes", "items", "amount_paise", "currency",
  "reseller_code", "commission_paise", "razorpay_order_id", "razorpay_payment_id",
  "payment_status", "created_at", "paid_at",
].join(",");

function storageFailure(error, status) {
  const suffix = Number.isInteger(status) && status >= 100 && status <= 599 ? ` (HTTP ${status})` : "";
  if (["42P01", "PGRST205"].includes(error?.code)) {
    return `FAIL: Supabase website_orders is missing${suffix}. Apply supabase/migrations/20260916_website_orders.sql.`;
  }
  if (["42703", "PGRST204"].includes(error?.code)) {
    return `FAIL: Supabase website_orders schema is incomplete${suffix}. Compare it with supabase/migrations/20260916_website_orders.sql.`;
  }
  if ([401, 403].includes(status) || error?.code === "42501") {
    return `FAIL: Supabase rejected order-storage access${suffix}. Check the server key, project URL and service_role permissions.`;
  }
  return `FAIL: Supabase order-storage check failed${suffix}. Check connectivity and the deployed database schema.`;
}

async function checkCheckout({ env = process.env, log = console.log, fetchImpl = globalThis.fetch,
  createClient = require("@supabase/supabase-js").createClient } = {}) {
  const value = (name) => typeof env[name] === "string" ? env[name].trim() : "";
  const url = value("NEXT_PUBLIC_SUPABASE_URL");
  const publicKey = value("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const adminKey = value("SUPABASE_SECRET_KEY") || value("SUPABASE_SERVICE_ROLE_KEY");
  const keyId = value("RAZORPAY_KEY_ID") || value("NEXT_PUBLIC_RAZORPAY_KEY_ID");
  const secret = value("RAZORPAY_KEY_SECRET");
  let valid = true;
  for (const [name, configured] of [
    ["NEXT_PUBLIC_SUPABASE_URL", url],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", publicKey],
    ["SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY", adminKey],
    ["RAZORPAY_KEY_ID or NEXT_PUBLIC_RAZORPAY_KEY_ID", keyId],
    ["RAZORPAY_KEY_SECRET", secret],
  ]) {
    log(`${configured ? "OK" : "FAIL"}: ${name} ${configured ? "configured" : "missing"}.`);
    if (!configured) valid = false;
  }
  let validUrl = false;
  if (url) {
    try {
      const parsed = new URL(url);
      validUrl = ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
    } catch { /* Report a fixed message without exposing the supplied value. */ }
    if (!validUrl) { log("FAIL: NEXT_PUBLIC_SUPABASE_URL must be a valid HTTP(S) project URL."); valid = false; }
  }
  const mode = /^rzp_(test|live)_[A-Za-z0-9]+$/.exec(keyId)?.[1];
  if (keyId && !mode) {
    log("FAIL: RAZORPAY_KEY_ID (or NEXT_PUBLIC_RAZORPAY_KEY_ID) must be a valid rzp_test_ or rzp_live_ key ID.");
    valid = false;
  } else if (mode) {
    log(`Razorpay mode: ${mode}.`);
  }
  if (!value("RAZORPAY_WEBHOOK_SECRET")) {
    log("WARN: RAZORPAY_WEBHOOK_SECRET is missing. Checkout can start, but webhook payment recovery is unavailable.");
  }

  if (validUrl && adminKey) {
    try {
      const db = createClient(url, adminKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: (input, init) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(15000) }) },
      });
      // Validate every checkout column without retrieving any customer rows.
      const { error, status } = await db.from("website_orders").select(orderColumns).limit(0);
      if (error) { log(storageFailure(error, status)); valid = false; }
      else log("OK: Supabase website_orders is accessible and required columns exist (zero rows requested).");
    } catch {
      log("FAIL: Supabase order-storage check could not complete. Check connectivity and server configuration.");
      valid = false;
    }
  }
  if (mode && secret) {
    try {
      const response = await fetchImpl("https://api.razorpay.com/v1/orders?count=1", {
        method: "GET",
        headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}` },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      // Only inspect status; never read, parse or print provider order records.
      await response.body?.cancel();
      if (response.ok) log(`OK: Razorpay ${mode} credentials accepted (HTTP ${response.status}).`);
      else {
        log([401, 403].includes(response.status)
          ? `FAIL: Razorpay rejected credentials (HTTP ${response.status}). Use a matching key ID and secret from the same mode.`
          : `FAIL: Razorpay availability check failed (HTTP ${response.status}). Retry or check the provider status.`);
        valid = false;
      }
    } catch {
      log("FAIL: Razorpay availability check could not complete. Check connectivity and server configuration.");
      valid = false;
    }
  }
  log("Read-only checks finished. No orders or payments were created. Writes, payment capture and webhook delivery were not tested.");
  return valid;
}

async function main({ argv = process.argv.slice(2), env = process.env, log = console.log,
  loadEnvConfig = require("@next/env").loadEnvConfig, ...dependencies } = {}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    log("Usage: npm run checkout:check -- [--env-only]\nChecks Supabase order-storage schema and Razorpay credentials without creating orders or payments.\nDefault: Next.js production .env precedence (development when NODE_ENV=development).\n--env-only: use only the supplied process environment; do not load .env files.");
    return true;
  }
  if (argv.some((arg) => arg !== "--env-only") || argv.length > 1) {
    log("FAIL: Unsupported options. See npm run checkout:check -- --help.");
    return false;
  }
  if (!argv.includes("--env-only")) {
    loadEnvConfig(projectRoot, env.NODE_ENV === "development", {
      info() {},
      error() { throw new Error("Environment configuration could not be loaded."); },
    });
  }
  return checkCheckout({ env, log, ...dependencies });
}

module.exports = { checkCheckout, main };
if (require.main === module) {
  main().then((ok) => { process.exitCode = ok ? 0 : 1; }).catch(() => {
    console.error("FAIL: Checkout checker could not start. Check dependencies and environment configuration.");
    process.exitCode = 1;
  });
}
