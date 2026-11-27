import { getProductCardImages } from "@/lib/product-card-media";
import { formatProductName } from "@/lib/product-name";
import { DEFAULT_OG_IMAGE, getSiteUrl } from "@/lib/site-config";

/** Public gallery photos only; logos and missing photos are not product images. */
export function getPublicProductImageUrls(
  images?: readonly string[],
): string[] {
  const origin = getSiteUrl();
  const candidates = (images ?? [])
    .map((image) =>
      image.trim().replace(/^https?:\/\//i, (scheme) => scheme.toLowerCase()),
    )
    .filter((value) => {
      return (
        value &&
        (!/^[a-z][a-z\d+.-]*:/i.test(value) || /^https?:\/\//i.test(value))
      );
    });
  const urls = getProductCardImages(candidates).flatMap((image) => {
    try {
      const url = new URL(image, `${origin}/`);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return [];
      const logo = new URL(DEFAULT_OG_IMAGE, origin);
      if (url.origin === logo.origin && url.pathname === logo.pathname)
        return [];
      if (
        decodeURIComponent(url.pathname)
          .toLowerCase()
          .includes("/private/files/")
      )
        return [];
      return [url.href];
    } catch {
      return [];
    }
  });
  return [...new Set(urls)];
}

type PreviewProduct = {
  name: string;
  printName?: string;
  images?: readonly string[];
  image?: string;
};

/** Choose photos from the products on this page, keeping gallery primary order. */
export function getProductPreviewImages(
  products: readonly PreviewProduct[],
  limit = 1,
) {
  const previews: Array<{ url: string; alt: string }> = [];
  if (!Number.isSafeInteger(limit) || limit < 1) return previews;
  for (const product of products) {
    const [url] = getPublicProductImageUrls(
      product.images ?? (product.image ? [product.image] : []),
    );
    if (!url || previews.some((image) => image.url === url)) continue;
    previews.push({
      url,
      alt: formatProductName(product.name, product.printName),
    });
    if (previews.length >= limit) break;
  }
  return previews;
}
