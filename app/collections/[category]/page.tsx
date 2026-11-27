import type { Metadata } from "next";
import { notFound } from "next/navigation";

import CategoryCollectionPageClient from "@/components/CategoryCollectionPage";
import JsonLd from "@/components/seo/JsonLd";
import { getProductPreviewImages, getPublicProductImageUrls } from "@/lib/seo-images";
import { loadCatalogPage, catalogPagePath, type CatalogSearchParams } from "@/lib/catalog-page";
import { COLLECTION_PAGE_SIZE } from "@/lib/catalog-browse-options";
import { getAllCategories, getCategoryBySlug } from "@/lib/products";
import {
  DEFAULT_OG_IMAGE,
  PRIMARY_KEYWORDS,
  SITE_NAME,
  getSiteUrl,
  siteUrl,
} from "@/lib/site-config";

interface PageProps {
  params: Promise<{ category: string }>;
  searchParams: Promise<CatalogSearchParams>;
}

// No ancestor loading.tsx: resolve the category and required catalogue read
// before streaming so missing categories and outages retain HTTP 404/500.
export const dynamic = "force-dynamic";
export const revalidate = 60;

export async function generateStaticParams() {
  const categories = await getAllCategories();

  return categories.map((category) => ({
    category: category.slug,
  }));
}

function titleCase(value: string) {
  return value
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isWeddingCategory(categorySlug: string) {
  return categorySlug.toLowerCase().includes("wedding");
}

function getCategorySeo(
  categorySlug: string,
  categoryName: string,
  description: string,
) {
  if (isWeddingCategory(categorySlug)) {
    return {
      title: `${categoryName} | Wedding Invitation Cards in Kolkata`,
      description:
        "Browse premium wedding cards from Beyond Invitation. Explore Indian wedding invitation cards, designer wedding cards and luxury wedding card options in Kolkata.",
      keywords: PRIMARY_KEYWORDS,
    };
  }

  const label = titleCase(categoryName);

  return {
    title: `${label} Invitation Cards | Beyond Invitation`,
    description:
      description ||
      `Explore ${label.toLowerCase()} invitation cards and premium celebration stationery from Beyond Invitation in Kolkata.`,
    keywords: [
      `${label} invitation cards`,
      `${label} cards Kolkata`,
      `${label} cards online India`,
      "invitation cards Kolkata",
      "Beyond Invitation",
    ],
  };
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { category: categorySlug } = await params;
  const category = await getCategoryBySlug(categorySlug);

  if (!category) {
    notFound();
  }

  const seo = getCategorySeo(
    category.slug,
    category.name,
    category.description,
  );

  const { page, pageNumber } = await loadCatalogPage(await searchParams ?? {}, { category: category.slug });
  const canonicalPath = catalogPagePath(`/collections/${category.slug}`, pageNumber);
  const title = `${seo.title}${pageNumber > 1 ? ` – Page ${pageNumber}` : ""}`;
  const productImages = getProductPreviewImages(page.products);
  const images = productImages.length ? productImages : [{ url: siteUrl(DEFAULT_OG_IMAGE), alt: SITE_NAME }];

  return {
    metadataBase: new URL(getSiteUrl()),
    title,
    description: seo.description,
    keywords: seo.keywords,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      title,
      description: seo.description,
      url: siteUrl(canonicalPath),
      siteName: SITE_NAME,
      type: "website",
      locale: "en_IN",
      images,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: seo.description,
      images,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
  };
}

export default async function CollectionPage({ params, searchParams }: PageProps) {
  const { category: categorySlug } = await params;
  const category = await getCategoryBySlug(categorySlug);

  if (!category) {
    notFound();
  }

  const { page, pageNumber } = await loadCatalogPage(await searchParams ?? {}, { category: category.slug });

  const products = page.products;
  const collectionUrl = siteUrl(catalogPagePath(`/collections/${category.slug}`, pageNumber));

  const seo = getCategorySeo(
    category.slug,
    category.name,
    category.description,
  );

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: getSiteUrl(),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: category.name,
        item: collectionUrl,
      },
    ],
  };

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${collectionUrl}#collection`,
    url: collectionUrl,
    name: seo.title,
    description: seo.description,
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: getSiteUrl(),
    },
    mainEntity: {
      "@type": "ItemList",
      name: `${category.name} products`,
      itemListElement: products.slice(0, 24).map((product, index) => ({
        "@type": "ListItem",
        position: (pageNumber - 1) * COLLECTION_PAGE_SIZE + index + 1,
        url: siteUrl(`/products/${product.slug}`),
        item: {
          "@type": "Product",
          name: product.name,
          description: product.description || seo.description,
          image: getPublicProductImageUrls(product.images)[0],
          url: siteUrl(`/products/${product.slug}`),
          category: category.name,
          offers: product.price > 0 ? {
            "@type": "Offer",
            priceCurrency: "INR",
            price: product.price,
          } : undefined,
        },
      })),
    },
  };

  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      {products.length > 0 ? <JsonLd data={collectionJsonLd} /> : null}

      <CategoryCollectionPageClient
        categoryName={category.name}
        categoryDescription={category.description}
        initialPage={page}
        initialPageNumber={pageNumber}
        category={category.slug}
      />
    </>
  );
}
