// Read-only HTTP audit. No browser JavaScript, cookies, or authentication is used.
// node scripts/check-crawler-access.cjs https://www.beyondinvitation.co.in
// Requests use crawler names from this computer, not the providers' verified IPs.
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const AGENTS = [
  "Googlebot", "bingbot", "OAI-SearchBot", "ChatGPT-User", "GPTBot",
  "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot",
  "Perplexity-User", "Google-Extended", "Applebot", "CCBot", "FutureCrawler/1.0",
];
// Keep network traffic bounded: check every identity's robots rules, and a
// representative set of search/fetch identities against actual HTML responses.
const HTTP_AGENTS = ["Googlebot", "bingbot", "OAI-SearchBot", "Claude-SearchBot", "PerplexityBot", "FutureCrawler/1.0"];

function robotsGroups(text) {
  const groups = [];
  let group;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const [, field, value] = match;
    const key = field.trim().toLowerCase();
    if (key === "user-agent") {
      if (!group || group.hasRules) groups.push(group = { agents: [], rules: [], hasRules: false });
      group.agents.push(value.toLowerCase());
    } else if (group && (key === "allow" || key === "disallow")) {
      group.hasRules = true;
      if (value) group.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  return groups;
}

function robotsAllows(groups, agent, path) {
  const token = agent.toLowerCase();
  const scores = groups.map(group => Math.max(-1, ...group.agents.map(name => name === "*" ? 0 : token.includes(name) ? name.length : -1)));
  const best = Math.max(-1, ...scores);
  const rules = groups.flatMap((group, index) => best >= 0 && scores[index] === best ? group.rules : []);
  const matching = rules.filter(rule => {
    const anchored = rule.pattern.endsWith("$");
    const pattern = anchored ? rule.pattern.slice(0, -1) : rule.pattern;
    const escaped = pattern.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${escaped}${anchored ? "$" : ""}`).test(path);
  }).sort((a, b) => b.pattern.replace(/[*$]/g, "").length - a.pattern.replace(/[*$]/g, "").length || Number(b.allow) - Number(a.allow));
  return matching[0]?.allow ?? true;
}

function blocksIndexing(value) {
  return /(?:^|[\s,:])(?:noindex|none|nosnippet)(?=$|[\s,;])/i.test(value) || /max-snippet\s*:\s*0(?:\D|$)/i.test(value);
}

function inspectHtml(text, url, response, agent) {
  const dom = new JSDOM(text, { url });
  try {
    const document = dom.window.document;
    const relevant = ["robots", agent.toLowerCase()];
    const directives = [response.headers.get("x-robots-tag") || "", ...Array.from(document.querySelectorAll("meta[name]"))
      .filter(meta => relevant.includes(meta.getAttribute("name").toLowerCase()))
      .map(meta => meta.getAttribute("content") || "")];
    assert.equal(directives.some(blocksIndexing), false, "page restricts indexing or snippets");
    const h1 = document.querySelector("h1")?.textContent.trim();
    assert.ok(h1 && !/page not found|access denied|verify you are|checking your browser/i.test(h1), "missing readable page heading or challenge page");
    const canonical = document.querySelector('link[rel="canonical"]')?.href;
    assert.ok(canonical, "missing canonical URL");
    const requested = new URL(url);
    const canonicalUrl = new URL(canonical);
    assert.equal(canonicalUrl.pathname.replace(/\/$/, "") || "/", requested.pathname.replace(/\/$/, "") || "/", "canonical points to another page");
    if (requested.searchParams.has("page")) assert.equal(canonicalUrl.searchParams.get("page"), requested.searchParams.get("page"), "pagination canonical lost the page number");
    const links = [...new Set(Array.from(document.querySelectorAll('a[href]')).map(a => new URL(a.getAttribute("href"), url)).filter(link => /^\/products\/[^/]+$/.test(link.pathname)).map(link => link.pathname))];
    if (requested.pathname === "/catalog") assert.ok(links.length, "catalogue contains no server-rendered product links");
    if (requested.pathname.startsWith("/products/")) {
      const nodes = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).flatMap(script => {
        const data = JSON.parse(script.textContent);
        return [...[data].flat(), ...[data["@graph"] || []].flat()];
      });
      assert.ok(nodes.some(node => [node?.["@type"]].flat().includes("Product")), "missing server-rendered Product structured data");
    }
    return { heading: h1, products: links, canonical };
  } finally {
    dom.window.close();
  }
}

async function main() {
  const base = new URL(process.argv[2] || "http://127.0.0.1:3000");
  assert.ok(["http:", "https:"].includes(base.protocol) && base.pathname === "/" && !base.search && !base.hash && !base.username && !base.password, "Pass an HTTP(S) origin without credentials, path, query, or fragment");
  const timeout = Number(process.env.CRAWLER_CHECK_TIMEOUT_MS || 30000);
  assert.ok(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 60000, "CRAWLER_CHECK_TIMEOUT_MS must be between 1 and 60000");
  const failures = [];
  let requests = 0;
  async function request(path, agent = "Mozilla/5.0") {
    requests++;
    const response = await fetch(new URL(path, base), { redirect: "manual", headers: { "user-agent": agent }, signal: AbortSignal.timeout(timeout) });
    const text = await response.text();
    return { response, text };
  }
  async function check(label, action) {
    try { const result = await action(); console.log(`PASS ${label}`); return result; }
    catch (error) { failures.push(`${label}: ${error.message}`); console.error(`FAIL ${label}: ${error.message}`); }
  }
  const robots = await check("robots.txt is publicly readable", async () => {
    const { response, text } = await request("/robots.txt");
    assert.equal(response.status, 200, `HTTP ${response.status}`);
    assert.match(response.headers.get("content-type") || "", /text\/plain/);
    assert.match(text, /^sitemap:\s*https?:\/\//im);
    return robotsGroups(text);
  });
  const productPath = await check("sitemap.xml exposes published products", async () => {
    const { response, text } = await request("/sitemap.xml");
    assert.equal(response.status, 200, `HTTP ${response.status}`);
    const dom = new JSDOM(text, { contentType: "application/xml" });
    try {
      const products = Array.from(dom.window.document.querySelectorAll("url > loc")).map(node => new URL(node.textContent)).filter(url => /^\/products\/[^/]+$/.test(url.pathname));
      assert.ok(products.length, "no product URLs in sitemap");
      return (products.find(url => url.pathname === "/products/g22201") || products[0]).pathname;
    } finally { dom.window.close(); }
  });
  const publicPaths = ["/", "/catalog", "/catalog?page=2", "/wedding-cards", "/collections/wedding-card-hindu", "/sitemap.xml", "/llms.txt", "/_next/static/example.js", "/logo.png", ...(productPath ? [productPath] : [])];
  if (robots) await check(`robots permits public documents for ${AGENTS.length} crawler identities`, async () => {
    for (const agent of AGENTS) for (const path of publicPaths) assert.ok(robotsAllows(robots, agent, path), `${agent} is disallowed from ${path}`);
  });
  const pageResults = new Map();
  const jobs = [
    ...["/", "/catalog", "/catalog?page=2", ...(productPath ? [productPath] : [])].map(path => [path, "Mozilla/5.0"]),
    ...HTTP_AGENTS.flatMap(agent => ["/", ...(productPath ? [productPath] : [])].map(path => [path, agent])),
  ];
  // Three requests at a time, at most 19 requests including discovery documents.
  for (let offset = 0; offset < jobs.length; offset += 3) {
    await Promise.all(jobs.slice(offset, offset + 3).map(([path, agent]) => check(`${agent}: ${path}`, async () => {
      const { response, text } = await request(path, agent);
      assert.equal(response.status, 200, `HTTP ${response.status}`);
      assert.match(response.headers.get("content-type") || "", /text\/html/);
      const inspected = inspectHtml(text, new URL(path, base).href, response, agent);
      if (agent === "Mozilla/5.0") pageResults.set(path, inspected);
      else if (pageResults.has(path)) assert.equal(inspected.canonical, pageResults.get(path).canonical, "crawler receives a different canonical from browser");
    })));
  }
  if (pageResults.has("/catalog") && pageResults.has("/catalog?page=2")) await check("catalogue pagination serves different product results without JavaScript", async () => {
    assert.notDeepEqual(pageResults.get("/catalog").products, pageResults.get("/catalog?page=2").products, "page 2 repeats page 1");
  });
  await check("optional llms.txt discovery index", async () => {
    const { response, text } = await request("/llms.txt");
    if (response.status === 404) { console.log("INFO llms.txt is absent; it is optional, not an indexing requirement"); return; }
    assert.equal(response.status, 200, `HTTP ${response.status}`);
    assert.match(response.headers.get("content-type") || "", /text\/(?:plain|markdown)/);
    assert.match(text, /\/catalog/);
    assert.match(text, /\/sitemap\.xml/);
  });
  console.log(JSON.stringify({ passed: failures.length === 0, requests, failures, limitation: "User-Agent smoke checks only; verified crawler IP access, hosting firewall settings, indexing and rankings are not confirmed." }));
  if (failures.length) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { robotsGroups, robotsAllows, blocksIndexing };
