/* Run after npm run build, or pass full page URLs to inspect server responses.
 * Only the inline bootstrap is evaluated; no scripts or measurement are fetched.
 */
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

function checkPage(html, url) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  try {
    const { window } = dom;
    const { document } = window;
    const bootstrap = document.getElementById("beyond-google-tag-bootstrap");
    assert.ok(bootstrap, `${url}: missing Google bootstrap`);
    assert.ok(html.includes('<head><script id="beyond-google-tag-bootstrap">'), `${url}: bootstrap must immediately follow <head>`);
    assert.equal(document.querySelectorAll("#beyond-google-tag-bootstrap").length, 1);
    assert.equal(document.head.firstElementChild, bootstrap);
    // Evaluate the actual compiled snippet: source-level tests cannot detect
    // server compiler optimizations that accidentally remove browser code.
    window.eval(bootstrap.textContent);
    const admin = /^\/admin(?:\/|$)/.test(window.location.pathname);
    assert.equal(document.querySelectorAll("#beyond-google-tag").length, admin ? 0 : 1);
    if (!admin) {
      assert.equal(window.__beyondGoogleTagInitialized, true);
      assert.equal(bootstrap.nextElementSibling.id, "beyond-google-tag");
      const commands = window.dataLayer.map(args => Array.from(args));
      assert.equal(commands[0][0], "consent");
      assert.equal(commands[0][2].ad_storage, "denied");
      assert.equal(commands[0][2].analytics_storage, "denied");
      assert.equal(commands[1][1].page_location, window.location.origin + window.location.pathname);
      assert.equal(commands.filter(args => args[0] === "js").length, 1);
    }
  } finally {
    dom.window.close();
  }
}

async function main() {
  const urls = process.argv.slice(2);
  let checked = 0;
  let redirects = 0;
  if (urls.length) {
    for (const url of urls) {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      assert.ok(response.ok, `${url}: HTTP ${response.status}`);
      checkPage(await response.text(), response.url);
      checked += 1;
    }
  } else {
    const directory = path.resolve(__dirname, "../.next/server/app");
    const files = readdirSync(directory, { recursive: true }).filter(file => file.endsWith(".html"));
    assert.ok(files.length, "Run npm run build before checking generated HTML");
    for (const file of files) {
      const html = readFileSync(path.join(directory, file), "utf8");
      // Next's redirect documents do not render the root layout. Their final
      // destination is the page that gets measured.
      if (html.includes("NEXT_REDIRECT;")) { redirects += 1; continue; }
      const pathname = file.replaceAll("\\", "/").replace(/\.html$/, "").replace(/^index$/, "");
      checkPage(html, `https://example.test/${pathname}?private=PRIVATE_QUERY#PRIVATE_FRAGMENT`);
      checked += 1;
    }
  }
  console.log(JSON.stringify({ passed: true, checkedPages: checked, redirectDocumentsSkipped: redirects, measurementRequestsSent: 0 }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
