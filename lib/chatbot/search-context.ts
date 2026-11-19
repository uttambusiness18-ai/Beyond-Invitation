import type { CatalogLineProduct } from "@/lib/chatbot/catalog-format";
import { catalogPlainText } from "@/lib/chatbot/catalog-format";

type SearchCategory = "hindu" | "muslim" | "christian" | "bengali" | "wedding" | "envelopes" | "boxes" | "rakhi";

export type CatalogSearchPlan = {
  queries: string[];
  category: SearchCategory | null;
  terms: string[];
  minPrice?: number;
  maxPrice?: number;
  minExclusive: boolean;
  maxExclusive: boolean;
};

const categoryWords: Record<SearchCategory, string[]> = {
  hindu: ["hindu", "হিন্দু", "হিন্দূ", "हिंदू", "हिन्दू"],
  muslim: ["muslim", "musalman", "মুসলিম", "মুসলমান", "मुस्लिम", "मुसलमान"],
  christian: ["christian", "খ্রিস্টান", "খৃষ্টান", "ईसाई", "क्रिश्चियन"],
  bengali: ["bengali", "bangali", "bangla", "বাঙালি", "বাঙালী", "বাংলা", "बंगाली"],
  wedding: ["wedding", "invitation", "invitations", "card", "cards", "shadi", "shaadi", "biyer", "biye", "বিয়ের", "বিয়ে", "বিয়ের", "বিয়ে", "বিবাহ", "বিবাহের", "কার্ড", "शादी", "विवाह", "कार्ड"],
  envelopes: ["envelope", "envelopes", "shagun", "sagun", "খাম", "শগুন", "शगुन", "लिफाफा", "लिफाफे"],
  boxes: ["box", "boxes", "বাক্স", "বক্স", "डिब्बा", "बॉक्स"],
  rakhi: ["rakhi", "rakhis", "রাখি", "राखी"],
};

const ignoredWords = new Set([
  ...Object.values(categoryWords).flat(),
  "show", "me", "some", "a", "an", "the", "please", "i", "we", "want", "need", "looking", "look", "for", "can", "could", "you", "your", "do", "have", "has", "any", "with", "and", "or", "in", "of", "on", "is", "are", "there", "this", "that", "one", "it", "what", "which", "where", "find", "recommend", "suggest", "design", "designs", "options", "available", "invites", "invite", "rupee", "rupees", "rs", "inr", "budget", "price", "priced", "cost", "range", "per", "each", "at", "to", "from", "under", "below", "above", "over", "within", "less", "than", "more", "up", "upto", "maximum", "minimum", "max", "min", "between", "taka", "টাকা", "টাকার", "রুপির", "রুপি", "rupey", "rupaye", "रुपये", "तक", "से", "कम", "में", "के", "की", "का", "tak", "se", "kam", "mein", "me", "ke", "ki", "ka", "andar", "modhye", "madhye", "niche", "মধ্যে", "কম", "নিচে", "এর", "er", "dikhao", "dikhaiye", "dikhaye", "chahiye", "chaiye", "chai", "dekhan", "dekhao", "dekhate", "mujhe", "mujhko", "hai", "hain", "দেখান", "দেখাও", "চাই", "আমাকে", "আমার", "আমাদের", "আছে", "কি", "দরকার", "দয়া", "করে", "दिखाओ", "दिखाइए", "चाहिए", "मुझे", "है", "हैं", "हमें",
]);

const translations: Record<string, string> = {
  lal: "red", "লাল": "red", "लाल": "red",
  nil: "blue", neela: "blue", "নীল": "blue", "नीला": "blue",
  shada: "white", sada: "white", "সাদা": "white", "सफेद": "white",
  golapi: "pink", "গোলাপি": "pink", "गुलाबी": "pink",
  golden: "gold", sonali: "gold", "সোনালি": "gold", "सुनहरा": "gold",
  "ফুল": "floral", "फूल": "floral", lights: "light",
};

function normalize(value: string): string {
  return catalogPlainText(value).toLowerCase()
    .replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6))
    .replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x0966));
}

/** Deterministic query cleanup, only used when the full catalogue exceeds 25k tokens. */
export function createCatalogSearchPlan(message: string): CatalogSearchPlan {
  let clean = normalize(message);
  const plan: CatalogSearchPlan = { queries: [], category: null, terms: [], minExclusive: false, maxExclusive: false };
  const amount = "(?:₹\\s*|rs\\.?\\s*|inr\\s*)?(\\d+(?:,\\d{3})*(?:\\.\\d+)?)";
  clean = clean.replace(new RegExp(`between\\s+${amount}\\s*(?:and|to|-)\\s*${amount}`, "i"), (_match, lower: string, upper: string) => {
    plan.minPrice = Number(lower.replace(/,/g, ""));
    plan.maxPrice = Number(upper.replace(/,/g, ""));
    return " ";
  });
  clean = clean.replace(new RegExp(`(under|below|less than|up to|upto|within|maximum|max)\\s*${amount}`, "i"), (_match, operator: string, upper: string) => {
    plan.maxPrice = Number(upper.replace(/,/g, ""));
    plan.maxExclusive = ["under", "below", "less than"].includes(operator);
    return " ";
  });
  clean = clean.replace(new RegExp(`(above|over|more than|at least|minimum|min)\\s*${amount}`, "i"), (_match, operator: string, lower: string) => {
    plan.minPrice = Number(lower.replace(/,/g, ""));
    plan.minExclusive = ["above", "over", "more than"].includes(operator);
    return " ";
  });
  clean = clean.replace(/(\d+(?:\.\d+)?)\s*(?:rupees?|rupaye|taka|টাকার?|रुपये)?\s*(tak|ke andar|se kam|er modhye|er niche|এর মধ্যে|মধ্যে|নিচে|এর কম|से कम|तक)/i, (_match, upper: string, operator: string) => {
    plan.maxPrice = Number(upper);
    plan.maxExclusive = /kam|niche|নিচে|কম|कम/.test(operator);
    return " ";
  });

  const words: string[] = clean.match(/[\p{L}\p{M}\p{N}]+/gu) || [];
  // Specific product families take precedence over the generic word "wedding".
  const priority: SearchCategory[] = ["boxes", "envelopes", "rakhi", "hindu", "muslim", "christian", "bengali", "wedding"];
  plan.category = priority.find((category) => categoryWords[category].some((word) => words.includes(word))) || null;
  plan.terms = [...new Set(words.filter((word) => !ignoredWords.has(word)).map((word) => translations[word] || word))];

  const categoryQuery = plan.category === "envelopes" ? "envelope"
    : plan.category === "boxes" ? "box"
      : plan.category || "";
  const details = plan.terms.join(" ");
  const queries = [
    [categoryQuery, details].filter(Boolean).join(" "),
    ...(plan.category && ["hindu", "muslim", "christian"].includes(plan.category) ? [["common", details].filter(Boolean).join(" ")] : []),
    ...(details ? [details] : []),
  ];
  plan.queries = [...new Set(queries.filter(Boolean))].slice(0, 3);
  return plan;
}

function categoryMatches(product: CatalogLineProduct, category: SearchCategory | null): boolean {
  if (!category) return true;
  const subject = normalize(product.subject || "");
  const classification = `${subject} ${normalize(product.itemCategory || "")}`;
  const title = normalize(product.name);
  switch (category) {
    case "hindu":
    case "muslim":
    case "christian":
      // The storefront's existing religion collections include Common designs.
      return subject === "common" || classification.includes(category) || title.includes(category);
    case "bengali": return /bengali|bangali/.test(`${classification} ${title}`);
    case "envelopes": return /envelope/.test(`${classification} ${title}`);
    case "boxes": return /\bbox(?:es)?\b/.test(`${classification} ${title}`);
    case "rakhi": return /rakhi/.test(`${classification} ${title}`);
    case "wedding": return !/envelope|\bbox(?:es)?\b|rakhi/.test(subject) && product.category === "wedding";
  }
}

/** Rank only products that satisfy every material detail and any price bounds. */
export function selectSearchContextProducts<T extends CatalogLineProduct>(
  products: T[],
  plan: CatalogSearchPlan,
  limit = 60,
): T[] {
  if (!plan.category && !plan.terms.length && plan.minPrice === undefined && plan.maxPrice === undefined) return [];
  const seen = new Set<string>();
  return products.flatMap((product, index) => {
    if (seen.has(product.slug)) return [];
    seen.add(product.slug);
    if (!categoryMatches(product, plan.category)) return [];
    if (plan.minPrice !== undefined || plan.maxPrice !== undefined) {
      if (!Number.isFinite(product.price) || product.price <= 0) return [];
      if (plan.minPrice !== undefined && (plan.minExclusive ? product.price <= plan.minPrice : product.price < plan.minPrice)) return [];
      if (plan.maxPrice !== undefined && (plan.maxExclusive ? product.price >= plan.maxPrice : product.price > plan.maxPrice)) return [];
    }
    const title = normalize(product.name);
    const metadata = normalize([product.slug, product.subject, product.itemCategory, product.badge, ...(product.tags || [])].join(" "));
    const haystack = `${title} ${metadata} ${normalize(product.description)}`;
    if (!plan.terms.every((term) => haystack.includes(term))) return [];
    const score = plan.terms.reduce((total, term) => total + (title.includes(term) ? 5 : metadata.includes(term) ? 3 : 1), 0)
      + (plan.category && normalize(product.subject || "").includes(plan.category) ? 4 : 0);
    return [{ product, score, index }];
  }).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map(({ product }) => product);
}
