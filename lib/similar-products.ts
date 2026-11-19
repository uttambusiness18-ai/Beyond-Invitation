import {
  matchesWeddingCardCategory,
  WEDDING_CARD_CATEGORIES,
} from "@/lib/wedding-cards";

/** Catalogue prices must already be adjusted for the current visitor. */
export type SimilarProduct = {
  slug: string;
  name: string;
  price: number;
  images: readonly string[];
  category: string;
  catalogId?: string;
  subject?: string;
  itemCategory?: string;
  tags?: readonly string[];
};

const genericWords = new Set([
  "and", "the", "with", "for", "from", "your", "our", "card", "cards",
  "wedding", "weddings", "invitation", "invitations", "invite", "invites",
  "design", "designs", "designer", "elegant", "royal", "premium", "beautiful",
  "exclusive", "collection", "new", "bestseller", "hindu", "muslim",
  "christian", "bengali", "common", "indian", "india",
]);

function normalized(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function pricePaise(price: number): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const paise = Math.round(price * 100);
  return Number.isSafeInteger(paise) && paise > 0 ? paise : null;
}

function specialFamily(product: SimilarProduct) {
  const values = [normalized(product.subject), normalized(product.itemCategory)];
  for (const family of ["wedding box", "shagun envelopes", "rakhi"]) {
    if (values.includes(family)) return family;
  }
  return null;
}

function compatible(source: SimilarProduct, candidate: SimilarProduct) {
  const sourceFamily = specialFamily(source);
  const candidateFamily = specialFamily(candidate);
  if (sourceFamily || candidateFamily) return sourceFamily === candidateFamily;

  const subject = normalized(source.subject);
  const weddingCategory = WEDDING_CARD_CATEGORIES.find(
    (category) => category.subjects[0] === subject,
  );
  if (weddingCategory) {
    return matchesWeddingCardCategory(
      { subject: candidate.subject ?? "", price: candidate.price },
      weddingCategory.value,
    );
  }
  // Common and other named subjects stay within their own subject. In
  // particular, a blank subject must not open up the broad wedding category.
  if (subject) return subject === normalized(candidate.subject);
  const category = normalized(source.category);
  return Boolean(category && category !== "wedding" && category !== "luxe") &&
    category === normalized(candidate.category);
}

function styleTokens(product: SimilarProduct) {
  const words = [product.name, ...(product.tags ?? [])]
    .join(" ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[a-z]{3,}/g) ?? [];
  return new Set(words.filter((word) => !genericWords.has(word)));
}

function styleSimilarity(source: Set<string>, candidate: Set<string>) {
  if (!source.size || !candidate.size) return 0;
  let shared = 0;
  for (const word of source) if (candidate.has(word)) shared += 1;
  return shared / (source.size + candidate.size - shared);
}

function stableTextOrder(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Rank the entire compatible set before limiting; never mutate cached data. */
export function selectSimilarProducts<T extends SimilarProduct>(
  source: SimilarProduct,
  candidates: readonly T[],
  limit = 4,
): T[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return [];
  const sourcePrice = pricePaise(source.price);
  const sourceSubject = normalized(source.subject);
  const sourceStyle = styleTokens(source);
  const ranked = candidates.flatMap((product) => {
    if (
      product.slug === source.slug ||
      (source.catalogId && product.catalogId === source.catalogId) ||
      !product.images.some((image) => image.trim()) ||
      !compatible(source, product)
    ) return [];
    const candidatePrice = pricePaise(product.price);
    if (sourcePrice !== null && candidatePrice === null) return [];
    return [{
      product,
      priceDifference: sourcePrice !== null && candidatePrice !== null
        ? Math.abs(candidatePrice - sourcePrice)
        : 0,
      exactSubject: Boolean(sourceSubject && sourceSubject === normalized(product.subject)),
      style: styleSimilarity(sourceStyle, styleTokens(product)),
    }];
  });
  ranked.sort((a, b) =>
    a.priceDifference - b.priceDifference ||
    Number(b.exactSubject) - Number(a.exactSubject) ||
    b.style - a.style ||
    stableTextOrder(a.product.slug, b.product.slug) ||
    stableTextOrder(a.product.catalogId ?? "", b.product.catalogId ?? ""),
  );

  const seenSlugs = new Set<string>();
  const seenIds = new Set<string>();
  const selected: T[] = [];
  for (const { product } of ranked) {
    if (seenSlugs.has(product.slug) || (product.catalogId && seenIds.has(product.catalogId))) continue;
    selected.push(product);
    seenSlugs.add(product.slug);
    if (product.catalogId) seenIds.add(product.catalogId);
    if (selected.length === limit) break;
  }
  return selected;
}
