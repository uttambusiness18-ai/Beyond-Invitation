import type { MetadataRoute } from "next";
import { getAllCategories } from "@/lib/products";
import { fetchErpProductsBase } from "@/lib/catalog";
import { getSiteUrl } from "@/lib/site-config";
import { getPublishedBlogs } from "@/lib/blog-server";
import { SHAGUN_ENVELOPES_ENABLED } from "@/lib/storefront-availability";
import { getProductCardImages } from "@/lib/product-card-media";

export const dynamic = "force-dynamic";
export const revalidate = 60;

function uniqueByUrl(items: MetadataRoute.Sitemap) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function knownModifiedDate(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function productImageUrls(images: string[], siteUrl: string): string[] {
  const crawlableImages = images.filter((image) =>
    !/^[a-z][a-z\d+.-]*:/i.test(image.trim()) || /^https?:\/\//i.test(image.trim()),
  );
  const urls = getProductCardImages(crawlableImages).flatMap((image) => {
    try {
      // Bare filenames use the same /products/ location as the storefront.
      const url = new URL(image.trim(), `${siteUrl}/products/`);
      return url.protocol === "https:" || url.protocol === "http:"
        // Next 15's sitemap serializer inserts image URLs verbatim into XML.
        // Escape query separators so signed/transformed image URLs stay valid.
        ? [url.href.replace(/&/g, "&amp;")]
        : [];
    } catch {
      return [];
    }
  });
  return [...new Set(urls)].slice(0, 1000);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();

  // Only publish lastmod when the content source supplies a real edit time.
  // Generating a sitemap does not mean every page changed.

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${siteUrl}/blog`,
      changeFrequency: "weekly",
      priority: 0.65,
    },
    {
      url: `${siteUrl}/catalog`,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${siteUrl}`,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${siteUrl}/wedding-cards`,
      changeFrequency: "daily",
      priority: 0.98,
    },
    {
      url: `${siteUrl}/collections/wedding-card-bengali`,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/collections/wedding-card`,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/collections/wedding-card-hindu`,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/collections/wedding-card-muslim`,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/collections/wedding-card-christian`,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/wedding-boxes`,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/about`,
      changeFrequency: "monthly",
      priority: 0.55,
    },
    {
      url: `${siteUrl}/contact`,
      changeFrequency: "monthly",
      priority: 0.55,
    },
    {
      url: `${siteUrl}/visit-us`,
      changeFrequency: "monthly",
      priority: 0.55,
    },
    {
      url: `${siteUrl}/faq`,
      changeFrequency: "monthly",
      priority: 0.55,
    },
    {
      url: `${siteUrl}/shipping-policy`,
      changeFrequency: "yearly",
      priority: 0.25,
    },
    {
      url: `${siteUrl}/refund-policy`,
      changeFrequency: "yearly",
      priority: 0.25,
    },
    {
      url: `${siteUrl}/privacy-policy`,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: `${siteUrl}/terms-and-conditions`,
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ];

  if (SHAGUN_ENVELOPES_ENABLED) {
    staticRoutes.push({
      url: `${siteUrl}/collections/shagun-envelopes`,
      changeFrequency: "weekly",
      priority: 0.72,
    });
  }

  const categories = await getAllCategories();

  const categoryRoutes: MetadataRoute.Sitemap = categories.map((category) => ({
    url: `${siteUrl}/collections/${category.slug}`,
    changeFrequency: "weekly",
    priority: category.slug.includes("wedding") ? 0.9 : 0.72,
  }));

  const products = await fetchErpProductsBase();

  const productRoutes: MetadataRoute.Sitemap = products
    .filter((product) => Boolean(product.slug))
    .map((product): MetadataRoute.Sitemap[number] => {
      const images = productImageUrls(product.images ?? [], siteUrl);

      const text = [
        product.name,
        product.slug,
        product.category,
        product.description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const isWeddingProduct =
        text.includes("wedding") ||
        text.includes("marriage") ||
        text.includes("bride") ||
        text.includes("groom") ||
        text.includes("invitation");

      return {
        url: `${siteUrl}/products/${encodeURIComponent(product.slug)}`,
        lastModified: knownModifiedDate(product.updatedAt),
        ...(images.length ? { images } : {}),
        changeFrequency: "weekly",
        priority: isWeddingProduct ? 0.92 : 0.82,
      };
    });

  const blogRoutes: MetadataRoute.Sitemap = (
    await getPublishedBlogs().catch(() => [])
  ).map((post) => ({
    url: `${siteUrl}/blog/${encodeURIComponent(post.slug)}`,
    lastModified: knownModifiedDate(post.updated_at),
    changeFrequency: "monthly",
    priority: 0.65,
  }));

  return uniqueByUrl([
    ...staticRoutes,
    ...categoryRoutes,
    ...productRoutes,
    ...blogRoutes,
  ]);
}
