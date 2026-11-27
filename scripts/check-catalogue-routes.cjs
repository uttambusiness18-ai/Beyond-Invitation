// Read-only HTTP/SEO smoke check against a running dev, production, or deployed server:
// node scripts/check-catalogue-routes.cjs http://127.0.0.1:3100
// Requires the published G22201 product and enabled Shagun Envelopes collection.
// No browser JavaScript is executed. Valid collections may be empty.
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const PREFERRED_PATH = "/products/g22201";
const OLD_PATH = "/products/g222-01";
const DEAD_COLLECTION_PATH = "/collections/shagun-boxes";
const COLLECTION_PATHS = [
  "/collections/wedding",
  "/collections/wedding-card",
  "/collections/wedding-card-hindu",
  "/collections/wedding-card-muslim",
  "/collections/wedding-card-christian",
  "/collections/wedding-card-bengali",
  "/collections/shagun-envelopes",
  "/wedding-boxes",
];
const PAGINATED_COLLECTION_PATHS = [
  "/collections/wedding-card-hindu",
  "/collections/wedding-card-muslim",
  "/collections/wedding-card-christian",
];
const USER_AGENTS = {
  browser: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
};

function robotDirectives(response, document) {
  return [
    response.headers.get("x-robots-tag") || "",
    ...Array.from(document.querySelectorAll("meta[name]"))
      .filter(meta => /^(robots|googlebot)$/i.test(meta.getAttribute("name")))
      .map(meta => meta.getAttribute("content") || ""),
  ];
}

function isNoindex(value) {
  return /(?:^|[\s,:])(?:noindex|none)(?=$|[\s,;])/i.test(value);
}

function structuredNodes(value) {
  if (Array.isArray(value)) return value.flatMap(structuredNodes);
  if (!value || typeof value !== "object") return [];
  return [value, ...structuredNodes(value["@graph"])];
}

function pageLinks(document, url) {
  return Array.from(document.querySelectorAll("a[href]"))
    .map(link => new URL(link.getAttribute("href"), url));
}

function assertNoDeadNavigation(document, url) {
  assert.equal(pageLinks(document, url).some(link => link.pathname === DEAD_COLLECTION_PATH), false,
    `${url.pathname} must not link to the nonexistent Shagun Boxes collection.`);
}

function renderedCurrentPage(document, url) {
  const selected = document.querySelectorAll('[aria-current="page"][aria-label^="Go to page "]');
  assert.ok(selected.length <= 1, `${url.pathname} must not mark multiple pagination controls current.`);
  if (selected.length) {
    const current = Number(selected[0].textContent.trim());
    assert.ok(Number.isSafeInteger(current) && current > 0, "Current pagination control must contain a page number.");
    return current;
  }

  // Single-page collections omit pagination. Confirm all current results render
  // instead of assuming a missing pagination control means the request clamped.
  const totalText = document.querySelector('[data-catalogue-toolbar] [role="status"]')?.textContent.trim();
  if (totalText !== undefined) {
    const total = totalText.match(/^(\d+) designs$/);
    assert.ok(total, `${url.pathname} must expose a successful result count.`);
    const grid = document.querySelector("[data-wedding-grid]");
    const count = grid ? new Set(pageLinks(grid, url)
      .filter(link => /^\/products\/[^/]+$/.test(link.pathname))
      .map(link => link.pathname)).size : 0;
    assert.equal(count, Number(total[1]), "Without pagination, the server HTML must contain every matching product.");
  } else {
    const emptyHeading = document.querySelector("#collection h2")?.textContent.trim() || "";
    assert.match(emptyHeading, /^No .+ just yet$/i, "A collection without products or pagination must render its empty state.");
  }
  return 1;
}

async function main() {
  const base = new URL(process.argv[2] || "http://127.0.0.1:3000");
  assert.ok(["http:", "https:"].includes(base.protocol), "Base URL must use HTTP or HTTPS.");
  assert.equal(base.pathname, "/", "Pass the server origin without a path.");
  const timeout = Number(process.env.CATALOGUE_CHECK_TIMEOUT_MS || 60000);
  assert.ok(Number.isSafeInteger(timeout) && timeout > 0, "CATALOGUE_CHECK_TIMEOUT_MS must be a positive integer.");
  let checks = 0;
  let canonical;
  const collectionCanonicals = new Map();

  async function request(route, agent = "browser") {
    const url = new URL(route, base);
    const response = await fetch(url, {
      redirect: "manual",
      headers: { "user-agent": USER_AGENTS[agent] },
      signal: AbortSignal.timeout(timeout),
    });
    const text = await response.text();
    return { response, text, url };
  }

  function passed(description) {
    checks++;
    console.log(`PASS ${description}`);
  }

  for (const agent of Object.keys(USER_AGENTS)) {
    for (const route of [
      "/products/catalogue-route-check-missing-product",
      "/collections/catalogue-route-check-missing-collection",
    ]) {
      const { response, text, url } = await request(route, agent);
      assert.equal(response.status, 404, `${agent} ${route} must return an actual HTTP 404, including before streaming.`);
      const dom = new JSDOM(text, { url: url.href });
      try {
        assert.ok(robotDirectives(response, dom.window.document).some(isNoindex), `${agent} ${route} must include noindex.`);
      } finally {
        dom.window.close();
      }
      passed(`${agent}: ${route} returns HTTP 404 and noindex`);
    }

    const legacyQuery = "?via=ROUTECHECK&utm_source=catalogue-route-check";
    const { response: redirectResponse, url: oldUrl } = await request(`${OLD_PATH}${legacyQuery}`, agent);
    assert.equal(redirectResponse.status, 308, `${agent} old product URL must permanently redirect with HTTP 308.`);
    assert.ok(redirectResponse.headers.get("location"), "The redirect must specify its destination.");
    const destination = new URL(redirectResponse.headers.get("location"), oldUrl);
    assert.equal(destination.origin, base.origin, "The old URL should redirect within the requested site.");
    assert.equal(destination.pathname, PREFERRED_PATH);
    assert.deepEqual([...destination.searchParams], [...new URLSearchParams(legacyQuery)]);
    passed(`${agent}: old URL redirects directly to ${PREFERRED_PATH} and preserves its query`);

    const { response, text, url } = await request(PREFERRED_PATH, agent);
    assert.equal(response.status, 200, `${agent} preferred product must return HTTP 200 without another redirect.`);
    const dom = new JSDOM(text, { url: url.href });
    try {
      const document = dom.window.document;
      assertNoDeadNavigation(document, url);
      assert.equal(robotDirectives(response, document).some(isNoindex), false, `${agent} preferred product must not have noindex in headers or metadata.`);
      const headings = document.querySelectorAll("h1");
      assert.equal(headings.length, 1, `${agent} preferred product must render one H1 in server HTML.`);
      assert.ok(headings[0].textContent.trim(), "The product H1 must contain its name.");
      assert.doesNotMatch(headings[0].textContent, /not found|404|something went wrong/i);
      const links = document.querySelectorAll('link[rel="canonical"]');
      assert.equal(links.length, 1, `${agent} product must have exactly one canonical link.`);
      const preferredCanonical = new URL(links[0].getAttribute("href"));
      assert.equal(preferredCanonical.pathname, PREFERRED_PATH);
      assert.equal(preferredCanonical.search, "");
      assert.equal(preferredCanonical.hash, "");
      if (canonical) assert.equal(preferredCanonical.href, canonical, "Browser and Googlebot must receive the same canonical.");
      canonical = preferredCanonical.href;
      const nodes = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
        .flatMap(script => structuredNodes(JSON.parse(script.textContent)));
      const product = nodes.find(node => [node["@type"]].flat().includes("Product"));
      assert.ok(product, `${agent} preferred product must include Product structured data.`);
      assert.equal(String(product.sku).toLowerCase(), "g22201");
      assert.ok(product.name && headings[0].textContent.includes(product.name), "Structured data must describe the displayed product.");
      assert.equal(product["@id"], `${canonical}#product`);
      const webpage = nodes.find(node => [node["@type"]].flat().includes("WebPage"));
      assert.ok(webpage, "Product HTML must include WebPage structured data.");
      assert.equal(webpage.url, canonical);
    } finally {
      dom.window.close();
    }
    passed(`${agent}: preferred URL renders the product, canonical and JSON-LD without noindex`);

    for (const route of COLLECTION_PATHS) {
      const { response: collectionResponse, text: collectionHtml, url: collectionUrl } = await request(route, agent);
      assert.equal(collectionResponse.status, 200, `${agent} ${route} must return HTTP 200.`);
      const collection = new JSDOM(collectionHtml, { url: collectionUrl.href });
      let productCount;
      try {
        const document = collection.window.document;
        assertNoDeadNavigation(document, collectionUrl);
        assert.equal(robotDirectives(collectionResponse, document).some(isNoindex), false,
          `${agent} ${route} must not have noindex in headers or metadata.`);
        const headings = document.querySelectorAll("h1");
        assert.equal(headings.length, 1, `${agent} ${route} must render one H1 in server HTML.`);
        assert.ok(headings[0].textContent.trim(), `${agent} ${route} must render a collection heading.`);
        assert.doesNotMatch(headings[0].textContent, /not found|404|something went wrong/i);
        const canonicals = document.querySelectorAll('link[rel="canonical"]');
        assert.equal(canonicals.length, 1, `${agent} ${route} must have exactly one canonical link.`);
        const collectionCanonical = new URL(canonicals[0].getAttribute("href"));
        assert.equal(collectionCanonical.origin, new URL(canonical).origin,
          `${agent} collection and product canonical origins must agree.`);
        assert.equal(collectionCanonical.pathname, route, `${agent} ${route} must have a self canonical.`);
        assert.equal(collectionCanonical.search, "");
        assert.equal(collectionCanonical.hash, "");
        if (collectionCanonicals.has(route)) {
          assert.equal(collectionCanonical.href, collectionCanonicals.get(route),
            `Browser and Googlebot must receive the same canonical for ${route}.`);
        }
        collectionCanonicals.set(route, collectionCanonical.href);
        const products = pageLinks(document, collectionUrl)
          .filter(link => (link.origin === base.origin || link.origin === collectionCanonical.origin)
            && /^\/products\/[^/]+$/.test(link.pathname));
        assert.equal(products.some(link => link.pathname === OLD_PATH), false,
          `${agent} ${route} must not link to the old product slug.`);
        productCount = new Set(products.map(link => link.pathname)).size;
      } finally {
        collection.window.close();
      }
      passed(`${agent}: ${route} returns 200, heading and self canonical without noindex; ${productCount} distinct product links in server HTML`);
    }

    for (const route of PAGINATED_COLLECTION_PATHS) {
      for (const query of ["?page=2", "?sort=price-asc"]) {
        const { response: variantResponse, text: variantHtml, url: variantUrl } = await request(`${route}${query}`, agent);
        assert.equal(variantResponse.status, 200, `${agent} ${route}${query} must return HTTP 200.`);
        const variant = new JSDOM(variantHtml, { url: variantUrl.href });
        let detail;
        try {
          const document = variant.window.document;
          assertNoDeadNavigation(document, variantUrl);
          const canonicals = document.querySelectorAll('link[rel="canonical"]');
          assert.equal(canonicals.length, 1, `${agent} ${route}${query} must have exactly one canonical.`);
          const variantCanonical = new URL(canonicals[0].getAttribute("href"));
          assert.equal(variantCanonical.origin, new URL(canonical).origin);
          assert.equal(variantCanonical.pathname, route);
          assert.equal(variantCanonical.hash, "");
          const directives = robotDirectives(variantResponse, document);
          assert.equal(directives.some(value => /(?:^|[\s,:])(?:nofollow|none)(?=$|[\s,;])/i.test(value)), false,
            `${agent} ${route}${query} must permit following links.`);
          if (query === "?page=2") {
            const currentPage = renderedCurrentPage(document, variantUrl);
            assert.ok(currentPage === 1 || currentPage === 2, "Page 2 must render page 2 or clamp to the only available page.");
            assert.equal(variantCanonical.search, currentPage > 1 ? `?page=${currentPage}` : "",
              `${agent} page canonical must match the visible resolved pagination page.`);
            assert.equal(directives.some(isNoindex), false, `${agent} an unfiltered catalogue page must remain indexable.`);
            detail = `canonical matches rendered page ${currentPage}${currentPage === 1 ? " (clamped)" : ""}`;
          } else {
            assert.equal(variantCanonical.search, "?sort=price-asc", `${agent} filtered canonical must preserve the active sort.`);
            assert.ok(directives.some(isNoindex), `${agent} sorted collection variants must have noindex.`);
            assert.ok(directives.some(value => /(?:^|[\s,:])follow(?=$|[\s,;])/i.test(value)),
              `${agent} sorted collection variants must explicitly allow following links.`);
            const sort = document.querySelector('select[aria-label^="Sort "]');
            if (sort) assert.equal(sort.value, "price-asc", "Rendered sort must match the filtered canonical.");
            detail = "canonical retains sort; noindex, follow";
          }
        } finally {
          variant.window.close();
        }
        passed(`${agent}: ${route}${query} returns 200; ${detail}`);
      }
    }
  }

  const { response: sitemapResponse, text: xml } = await request("/sitemap.xml", "googlebot");
  assert.equal(sitemapResponse.status, 200, "Sitemap must load successfully.");
  const sitemap = new JSDOM(xml, { contentType: "application/xml" });
  try {
    const locations = Array.from(sitemap.window.document.querySelectorAll("loc"), node => node.textContent.trim());
    assert.ok(locations.includes(canonical), "Sitemap must include the preferred product's canonical URL.");
    assert.equal(locations.some(location => new URL(location).pathname === OLD_PATH), false, "Sitemap must not list the redirected old slug.");
    assert.equal(locations.some(location => new URL(location).pathname === DEAD_COLLECTION_PATH), false,
      "Sitemap must not list the nonexistent Shagun Boxes collection.");
    for (const [route, collectionCanonical] of collectionCanonicals) {
      assert.ok(locations.includes(collectionCanonical), `Sitemap must include the successful ${route} canonical URL.`);
    }
  } finally {
    sitemap.window.close();
  }
  passed(`sitemap includes the preferred product and ${collectionCanonicals.size} valid collection canonicals; excludes old product and nonexistent collection`);

  const { response: searchResponse, text: searchHtml, url: searchUrl } = await request("/search?q=G22201", "googlebot");
  assert.equal(searchResponse.status, 200, "Product search must load successfully.");
  const search = new JSDOM(searchHtml, { url: searchUrl.href });
  try {
    assertNoDeadNavigation(search.window.document, searchUrl);
    const productLinks = pageLinks(search.window.document, searchUrl)
      .filter(url => url.origin === base.origin || url.origin === new URL(canonical).origin);
    assert.ok(productLinks.some(url => url.pathname === PREFERRED_PATH), "Server-rendered search must link to the preferred product URL.");
    assert.equal(productLinks.some(url => url.pathname === OLD_PATH), false, "Search must not link to the old slug.");
  } finally {
    search.window.close();
  }
  passed("server-rendered product search links to the preferred slug");
  console.log(`Completed ${checks} read-only catalogue route checks against ${base.origin}.`);
}

main().catch(error => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
