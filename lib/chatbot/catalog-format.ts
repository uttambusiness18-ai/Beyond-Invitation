import { formatInr } from "@/lib/contact";
import type { Product } from "@/types";

export type CatalogLineProduct = Pick<
  Product,
  "slug" | "name" | "category" | "price" | "description" | "badge"
> & {
  subject?: string;
  itemCategory?: string;
  tags?: string[];
};

/** Keep catalogue data on one plain-text line, separate from instructions. */
export function catalogPlainText(value: string): string {
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[|\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function catalogSubject(product: CatalogLineProduct): string {
  return catalogPlainText(product.subject || product.itemCategory || product.category);
}

export function buildCatalogLine(product: CatalogLineProduct): string {
  const subject = catalogSubject(product);
  const itemCategory = catalogPlainText(product.itemCategory || "");
  const classification =
    itemCategory && itemCategory.toLowerCase() !== subject.toLowerCase()
      ? `${subject}; ${itemCategory}`
      : subject;
  const price = Number.isFinite(product.price) && product.price > 0
    ? `₹${formatInr(product.price)}`
    : "Price on request";
  const tags = Array.from(new Set([product.badge, ...(product.tags || [])].filter(Boolean)))
    .map((tag) => catalogPlainText(tag!))
    .join(", ");
  return [
    catalogPlainText(product.slug),
    catalogPlainText(product.name),
    classification,
    price,
    tags,
    Array.from(catalogPlainText(product.description)).slice(0, 80).join(""),
  ].join(" | ");
}
