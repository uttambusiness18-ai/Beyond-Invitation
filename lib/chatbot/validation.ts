import type { Product } from "@/types";
import type { ChatMessage, ChatProduct, ChatResponse } from "./types";

/** Chat is text only; no HTML, attachments, tool instructions or metadata. */
export function plainText(value: string): string {
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateChatInput(body: unknown): {
  messages: ChatMessage[];
  pagePath?: string;
} | null {
  if (!body || typeof body !== "object" || !("messages" in body)) return null;
  const input = body as Record<string, unknown>;
  if (!Array.isArray(input.messages) || input.messages.length === 0) return null;
  const messages: ChatMessage[] = [];
  for (const value of input.messages.slice(-8)) {
    if (!value || typeof value !== "object") return null;
    const { role, text } = value;
    if ((role !== "user" && role !== "assistant") || typeof text !== "string") return null;
    // Check the original size too, before stripping tags or whitespace.
    if (text.length > (role === "user" ? 500 : 2000)) return null;
    const cleaned = plainText(text);
    if (!cleaned) return null;
    messages.push({ role, text: cleaned });
  }
  if (messages[messages.length - 1].role !== "user") return null;

  // Only public storefront paths. Never forward queries, hashes, account/order
  // identifiers, full URLs, or any other request/body fields to the model.
  let pagePath: string | undefined;
  if (typeof input.pagePath === "string") {
    const path = input.pagePath.split(/[?#]/)[0].replace(/\/$/, "") || "/";
    if (path.length <= 200 && /^(?:\/|\/(?:products|collections)\/[a-zA-Z0-9_-]+|\/(?:catalog|search|about|contact|visit-us|faq|wedding-cards|wedding-boxes|wedding-card-hindu|wedding-card-muslim|wedding-card-christian|shipping-policy|refund-policy|terms-and-conditions|privacy-policy))$/.test(path)) {
      pagePath = path;
    }
  }
  return { messages, pagePath };
}

/** Resolve cards exclusively from the same authoritative catalogue as listings. */
export function validateProductSlugs(slugs: unknown[], catalogue: Product[]): ChatProduct[] {
  const bySlug = new Map(catalogue.map((product) => [product.slug, product]));
  const seen = new Set<string>();
  const products: ChatProduct[] = [];
  for (const slug of slugs) {
    if (typeof slug !== "string" || seen.has(slug)) continue;
    const product = bySlug.get(slug);
    if (!product) continue;
    seen.add(slug);
    products.push({
      slug: product.slug,
      name: product.name,
      price: product.price,
      mrp: product.mrp ?? 0,
      image: product.images?.[0] || "",
      url: `/products/${encodeURIComponent(product.slug)}`,
    });
    if (products.length === 6) break;
  }
  return products;
}

export function parseChatResponse(text: string, catalogue: Product[]): ChatResponse {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object") throw new Error("Invalid Gemini response object");
  const result = value as Record<string, unknown>;
  if (typeof result.reply !== "string" || !result.reply.trim() ||
      result.reply.length > 2000 || !Array.isArray(result.product_slugs) ||
      result.product_slugs.length > 6 || !result.product_slugs.every((slug) => typeof slug === "string") ||
      typeof result.show_visit_shop !== "boolean") {
    throw new Error("Invalid Gemini response schema");
  }
  const reply = plainText(result.reply).split(/\s+/).slice(0, 80).join(" ");
  if (!reply) throw new Error("Empty Gemini reply");
  return {
    reply,
    products: validateProductSlugs(result.product_slugs, catalogue),
    showVisitShop: result.show_visit_shop,
  };
}
