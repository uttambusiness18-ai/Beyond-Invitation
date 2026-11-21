# Bengali wedding card SEO

The landing page is `/collections/wedding-card-bengali`. Its title, description,
social previews, visible introduction, buying guide and FAQs cover the supplied
keyword cluster. `lib/bengali-wedding-content.ts` keeps the exact 25 keywords and
FAQ copy together. The metadata keyword list is supplementary; the visible
content and crawlable catalogue are the substantive changes.

The page answers questions about traditional and modern designs, Bengali marriage
cards and Shubho Bibaho wording, bride-and-groom and pull-out requests, card prices,
printing, customisation, manufacturing enquiries, wholesale orders and Kolkata
showroom visits. Design availability and custom production are enquiries, not
stock promises. Printing is additional to listed card prices. The showroom
address follows the existing visit-us and business facts content.

## Indexing and structured data

- The unfiltered collection and numbered pages are indexable, with their own
  canonical URLs. Metadata and the visible list use the same resolved page.
- Valid price and sort variants are `noindex, follow`. Their canonicals retain
  the actual filters; tracking parameters and redundant defaults are omitted.
- Bengali pagination uses ordinary links so crawlers can discover later pages.
- CollectionPage, BreadcrumbList and ItemList JSON-LD describe the visible page
  and products. There are no invented offers, stock claims or ratings. FAQ content
  is visible on the page; no FAQ rich-result eligibility is asserted.
- The base URL is included in the sitemap and linked from the footer, as well as
  the existing navigation and homepage collection links.

These choices follow Google's [pagination guidance](https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading)
and [title guidance](https://developers.google.com/search/docs/appearance/title-link).

## Validation and rollout

Run `node --test tests/bengali-seo.test.cjs tests/product-pagination-links.test.cjs`,
`npx tsc --noEmit --incremental false`, `npm run lint` and `npm run build`.
Check rendered HTML for the base collection, `?page=2` and a filtered URL.
Confirm the sitemap contains the base collection.

After deploying, inspect the canonical collection URL in Search Console and
submit the updated sitemap if needed. Code changes do not submit an indexing
request or publish the application.
