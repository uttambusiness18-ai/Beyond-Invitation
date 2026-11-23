import type { Metadata } from "next";
import { BENGALI_KEYWORDS } from "@/lib/bengali-wedding-content";
import { COLLECTION_PAGE_SIZE } from "@/lib/catalog-browse-options";
import { parsePageNumber } from "@/lib/pagination";
import { SITE_NAME, getSiteUrl, siteUrl } from "@/lib/site-config";
import {
  DEFAULT_WEDDING_FILTERS,
  weddingFiltersFromSearchParams,
  type WeddingProductPage,
  type WeddingSearchParams,
} from "@/lib/wedding-cards";

export const BENGALI_PATH = "/collections/wedding-card-bengali";
const IMAGE =
  "https://res.cloudinary.com/dhbevwau9/image/upload/v1794916798/Bengali_Wedding_Cards_Showcase_wm8wi7.png";
const DESCRIPTION =
  "Shop Bengali wedding invitation cards online in Kolkata. Explore traditional and modern designs, compare card prices, and enquire about printing and customisation.";

function pageDetails(params: WeddingSearchParams, resolvedPage?: number) {
  const filters = weddingFiltersFromSearchParams(params, "bengali");
  const page =
    resolvedPage ?? parsePageNumber(params.page, COLLECTION_PAGE_SIZE);
  const query = new URLSearchParams();
  if (filters.price !== "any") query.set("price", filters.price);
  if (filters.sort !== DEFAULT_WEDDING_FILTERS.sort) query.set("sort", filters.sort);
  if (page > 1) query.set("page", String(page));
  return {
    page,
    path: `${BENGALI_PATH}${query.size ? `?${query}` : ""}`,
    index: filters.price === "any" && filters.sort === DEFAULT_WEDDING_FILTERS.sort,
  };
}

export function getBengaliMetadata(
  params: WeddingSearchParams,
  resolvedPage?: number,
): Metadata {
  const { page, path, index } = pageDetails(params, resolvedPage);
  const title = `Bengali Wedding Cards Online in Kolkata${page > 1 ? ` – Page ${page}` : ""} | ${SITE_NAME}`;
  return {
    metadataBase: new URL(getSiteUrl()),
    title: { absolute: title },
    description: DESCRIPTION,
    keywords: [...BENGALI_KEYWORDS],
    alternates: { canonical: path },
    openGraph: {
      title,
      description: DESCRIPTION,
      url: siteUrl(path),
      siteName: SITE_NAME,
      type: "website",
      locale: "en_IN",
      images: [
        {
          url: IMAGE,
          alt: "Bengali wedding invitation card designs from Beyond Invitation",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: DESCRIPTION,
      images: [IMAGE],
    },
    robots: {
      index,
      follow: true,
      googleBot: {
        index,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
  };
}

export function buildBengaliStructuredData(
  page: WeddingProductPage,
  params: WeddingSearchParams,
) {
  const { path, page: pageNumber } = pageDetails(params, page.pageNumber);
  const url = siteUrl(path);
  const breadcrumbs = {
    "@type": "BreadcrumbList",
    "@id": `${url}#breadcrumbs`,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: getSiteUrl() },
      {
        "@type": "ListItem",
        position: 2,
        name: "Wedding Cards",
        item: siteUrl("/wedding-cards"),
      },
      {
        "@type": "ListItem",
        position: 3,
        name: "Bengali Wedding Cards",
        item: siteUrl(BENGALI_PATH),
      },
    ],
  };
  const collection = {
    "@type": "CollectionPage",
    "@id": `${url}#collection`,
    url,
    name: `Bengali Wedding Cards${pageNumber > 1 ? ` – Page ${pageNumber}` : ""}`,
    description: DESCRIPTION,
    inLanguage: "en-IN",
    breadcrumb: { "@id": breadcrumbs["@id"] },
    ...(page.products.length
      ? { mainEntity: { "@id": `${url}#designs` } }
      : {}),
  };
  // Describe the visible list; prices and stock belong to individual product pages.
  const designs = {
    "@type": "ItemList",
    "@id": `${url}#designs`,
    name: "Bengali wedding card designs",
    itemListElement: page.products.map((product, index) => ({
      "@type": "ListItem",
      position: (pageNumber - 1) * COLLECTION_PAGE_SIZE + index + 1,
      name: product.name,
      url: siteUrl(`/products/${encodeURIComponent(product.slug)}`),
    })),
  };
  return {
    "@context": "https://schema.org",
    "@graph": [
      collection,
      breadcrumbs,
      ...(page.products.length ? [designs] : []),
    ],
  };
}
