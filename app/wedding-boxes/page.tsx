import type { Metadata } from "next";
import { cache } from "react";

import JsonLd from "@/components/seo/JsonLd";
import { fetchWeddingProductPage } from "@/lib/catalog-browse";
import { COLLECTION_PAGE_SIZE } from "@/lib/catalog-browse-options";
import { parsePageNumber } from "@/lib/pagination";
import { facetCounts, serializeWeddingFilters, weddingFiltersFromSearchParams, type WeddingFilters, type WeddingProductPage, type WeddingSearchParams } from "@/lib/wedding-cards";
import { getProductPreviewImages, getPublicProductImageUrls } from "@/lib/seo-images";
import { formatProductName } from "@/lib/product-name";
import {
  DEFAULT_OG_IMAGE,
  SITE_NAME,
  getSiteUrl,
  siteUrl,
} from "@/lib/site-config";
import WeddingCardsCollection from "@/components/wedding-cards/WeddingCardsCollection";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ITEM_CATEGORY = "Wedding Box";
const PAGE_PATH = "/wedding-boxes";
const PAGE_URL = siteUrl(PAGE_PATH);

const title = "Wedding Boxes | Premium Invitation Boxes";
const description =
  "Explore premium wedding boxes by Beyond Invitation — elegant invitation boxes crafted for luxury wedding gifting and presentation.";

const baseMetadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title,
  description,
  keywords: [
    "wedding boxes",
    "premium wedding boxes",
    "luxury wedding invitation boxes",
    "wedding invitation box",
    "wedding card boxes",
    "Beyond Invitation",
  ],
  alternates: {
    canonical: PAGE_PATH,
  },
  openGraph: {
    title,
    description,
    url: PAGE_URL,
    siteName: SITE_NAME,
    type: "website",
    locale: "en_IN",
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        alt: "Premium wedding boxes by Beyond Invitation",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [DEFAULT_OG_IMAGE],
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

const readPage = cache(async (price: WeddingFilters["price"], sort: WeddingFilters["sort"], requestedPage: number) => {
  let initialPage: WeddingProductPage = { products: [], nextOffset: null, total: 0, facets: facetCounts([]) };
  let errorMessage = "";
  try {
    initialPage = await fetchWeddingProductPage({ collectionType: "boxes", filters: { type: "all", price, sort }, offset: (requestedPage - 1) * COLLECTION_PAGE_SIZE });
  } catch (error) {
    console.error("Wedding boxes page fetch failed:", error);
    errorMessage = "Unable to load wedding boxes.";
  }
  return { initialPage, errorMessage };
});

async function loadPage(params: WeddingSearchParams) {
  const initialFilters = weddingFiltersFromSearchParams(params, "boxes");
  const requestedPage = parsePageNumber(params.page, COLLECTION_PAGE_SIZE);
  const result = await readPage(initialFilters.price, initialFilters.sort, requestedPage);
  const pageNumber = result.initialPage.pageNumber ?? requestedPage;
  const filters = serializeWeddingFilters(initialFilters, "boxes");
  const query = new URLSearchParams(filters);
  if (pageNumber > 1) query.set("page", String(pageNumber));
  return { ...result, initialFilters, pageNumber, canonical: `${PAGE_PATH}${query.size ? `?${query}` : ""}`, index: !filters && !result.errorMessage };
}

type PageProps = { searchParams: Promise<WeddingSearchParams> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { initialPage, canonical, pageNumber, index } = await loadPage(await searchParams);
  const previews = getProductPreviewImages(initialPage.products);
  const images = previews.length ? previews : [{ url: siteUrl(DEFAULT_OG_IMAGE), alt: "Premium wedding boxes by Beyond Invitation" }];
  const pageTitle = `${title}${pageNumber > 1 ? ` – Page ${pageNumber}` : ""}`;
  return {
    ...baseMetadata,
    title: pageTitle,
    alternates: { canonical },
    openGraph: { ...baseMetadata.openGraph, title: pageTitle, url: siteUrl(canonical), images },
    twitter: { ...baseMetadata.twitter, title: pageTitle, images },
    robots: { index, follow: true, googleBot: { index, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  };
}

export default async function WeddingBoxesPage({ searchParams }: PageProps) {
  const { initialPage, initialFilters, pageNumber, errorMessage, canonical } = await loadPage(await searchParams);

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
        name: "Wedding Boxes",
        item: siteUrl(canonical),
      },
    ],
  };

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Wedding boxes by Beyond Invitation",
    itemListElement: initialPage.products.map((product, index) => ({
      "@type": "ListItem",
      position: ((initialPage.pageNumber ?? pageNumber) - 1) * COLLECTION_PAGE_SIZE + index + 1,
      url: siteUrl(`/products/${product.slug}`),
      item: {
        "@type": "Product",
        name: formatProductName(product.name, product.printName),
        description,
        image: getPublicProductImageUrls([product.image])[0],
        url: siteUrl(`/products/${product.slug}`),
        category: ITEM_CATEGORY,
        offers: Number.isFinite(product.price) && product.price > 0 ? {
          "@type": "Offer",
          priceCurrency: "INR",
          price: product.price,
        } : undefined,
      },
    })),
  };

  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      {initialPage.products.length > 0 ? <JsonLd data={itemListJsonLd} /> : null}

      <WeddingCardsCollection
        title="Wedding Boxes"
        collectionType="boxes"
        initialPage={initialPage}
        initialFilters={initialFilters}
        errorMessage={errorMessage}
        emptyTitle="No wedding boxes just yet"
      />
    </>
  );
}
