import "server-only";

import { unstable_cache } from "next/cache";
import {
  getCatalogProducts,
  searchProducts,
} from "@/lib/products";
import {
  buildCatalogLine,
  catalogSubject,
  type CatalogLineProduct,
} from "@/lib/chatbot/catalog-format";
import { createCatalogSearchPlan, selectSearchContextProducts } from "@/lib/chatbot/search-context";
import { SHAGUN_ENVELOPES_ENABLED } from "@/lib/storefront-availability";

const MAX_CATALOG_TOKENS = 25_000;

type BuiltContext = {
  text: string;
  header: string;
  productCount: number;
  estimatedTokens: number;
};

const subjectUrls: Record<string, string> = {
  "wedding card": "/collections/wedding-card",
  "hindu wedding card": "/collections/wedding-card-hindu",
  "muslim wedding card": "/collections/wedding-card-muslim",
  "christian wedding card": "/collections/wedding-card-christian",
  bengali: "/collections/wedding-card-bengali",
  "bengali wedding card": "/collections/wedding-card-bengali",
  ...(SHAGUN_ENVELOPES_ENABLED ? { "shagun envelopes": "/collections/shagun-envelopes" } : {}),
  "wedding box": "/wedding-boxes",
  common: "/wedding-cards",
  wedding: "/collections/wedding",
  housewarming: "/collections/housewarming",
  "thread-ceremony": "/collections/thread-ceremony",
  "naming-ceremony": "/collections/naming-ceremony",
  birthday: "/collections/birthday",
  "baby-shower": "/collections/baby-shower",
  luxe: "/collections/luxe",
};

function buildSubjectHeader(products: CatalogLineProduct[]): string {
  const subjects = new Map<string, number>();
  for (const product of products) {
    const subject = catalogSubject(product) || "Other products";
    subjects.set(subject, (subjects.get(subject) || 0) + 1);
  }
  const lines = [...subjects.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([subject, count]) => {
      const collectionUrl = subjectUrls[subject.toLowerCase()];
      return `${subject}: ${count} products | ${collectionUrl || "/catalog (browse all products; no dedicated collection)"}`;
    });
  return `Catalogue subjects (counts describe catalogue subjects, not live availability):\n${lines.join("\n") || "No products listed."}`;
}

// Arguments form part of Next's cache key. Pass only already-priced public
// fields, so different visitor prices never share the same text snapshot.
const buildFullContext = unstable_cache(async (rows: CatalogLineProduct[]): Promise<BuiltContext> => {
  const header = buildSubjectHeader(rows);
  const text = `${header}\n\nProducts: slug | name | subject/category | price (INR) | badge/tags | description\n${rows.map(buildCatalogLine).join("\n")}`;
  const result = {
    text,
    header,
    productCount: rows.length,
    estimatedTokens: Math.ceil(text.length / 4),
  };
  console.info("[chatbot] Catalogue context built", {
    products: result.productCount,
    characters: text.length,
    estimatedTokens: result.estimatedTokens,
    prefilterRequired: result.estimatedTokens > MAX_CATALOG_TOKENS,
  });
  return result;
}, ["chatbot-catalogue-context-v1"], { revalidate: 60, tags: ["catalogue"] });

export async function getChatCatalogContext(latestMessage: string, pagePath?: string) {
  const products = await getCatalogProducts();
  // Product reading and visitor pricing remain outside the persistent cache.
  const fullContext = await buildFullContext(products.map((product) => ({
    slug: product.slug,
    name: product.name,
    category: product.category,
    subject: product.subject,
    itemCategory: product.itemCategory,
    price: product.price,
    badge: product.badge,
    tags: product.tags,
    description: product.description,
  })));
  if (fullContext.estimatedTokens <= MAX_CATALOG_TOKENS) {
    return {
      text: fullContext.text,
      products,
      productCount: fullContext.productCount,
      estimatedTokens: fullContext.estimatedTokens,
      prefiltered: false,
    };
  }

  const found = await searchProducts(latestMessage);
  const searchPlan = createCatalogSearchPlan(latestMessage);
  // Website search requires every entered word. Clean up conversational words
  // and translate common Hindi/Bengali shopping terms in at most three queries.
  // Keep material/style terms strict: an acrylic/LED request must not become a
  // generic wedding-card match just because the category matches.
  const fallbacks = found.length < 60
    ? await Promise.all(searchPlan.queries.map((query) => searchProducts(query)))
    : [];
  const bySlug = new Map(products.map((product) => [product.slug, product]));
  const searched = [...found, ...fallbacks.flat()].flatMap((product) => {
    const realProduct = bySlug.get(product.slug);
    return realProduct ? [realProduct] : [];
  });
  // Exact product-layer search hits lead ties. The already-loaded catalogue
  // fills gaps when only Item Category or a translated term carries the match.
  const selected = selectSearchContextProducts([...searched, ...products], searchPlan);

  // Deictic questions still need their current product when keyword search
  // returns nothing. It occupies one of the same 60 slots.
  const currentSlug = pagePath?.match(/^\/products\/([^/]+)\/?$/)?.[1];
  const currentProduct = currentSlug ? bySlug.get(currentSlug) : undefined;
  if (currentProduct && !selected.some((product) => product.slug === currentProduct.slug)) {
    if (selected.length === 60) selected.pop();
    selected.unshift(currentProduct);
  }
  const text = `${fullContext.header}\n\nThe full catalogue exceeds the context budget. The following are up to 60 search matches and the current product, if any. No search match does not prove that a product does not exist; invite the customer to contact the team.\nProducts: slug | name | subject/category | price (INR) | badge/tags | description\n${selected.map(buildCatalogLine).join("\n") || "No matching products found by website search."}`;
  return {
    text,
    products,
    productCount: fullContext.productCount,
    estimatedTokens: Math.ceil(text.length / 4),
    prefiltered: true,
  };
}
