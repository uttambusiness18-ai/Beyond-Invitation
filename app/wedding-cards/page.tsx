import type { Metadata } from "next";
import { cache } from "react";
import JsonLd from "@/components/seo/JsonLd";
import WeddingCardsCollection from "@/components/wedding-cards/WeddingCardsCollection";
import { fetchWeddingProductPage } from "@/lib/catalog-browse";
import { COLLECTION_PAGE_SIZE } from "@/lib/catalog-browse-options";
import { parsePageNumber } from "@/lib/pagination";
import { getBusinessIdentity } from "@/lib/business-schema";
import { getProductPreviewImages, getPublicProductImageUrls } from "@/lib/seo-images";
import { formatProductName } from "@/lib/product-name";
import { facetCounts, serializeWeddingFilters, weddingFiltersFromSearchParams, WEDDING_FAQS, type WeddingFilters, type WeddingProductPage, type WeddingSearchParams } from "@/lib/wedding-cards";
import {
  DEFAULT_OG_IMAGE,
  PRIMARY_KEYWORDS,
  SITE_DESCRIPTION,
  SITE_NAME,
  getSiteUrl,
  siteUrl,
} from "@/lib/site-config";

export const dynamic = "force-dynamic";
export const revalidate = 60;
const pageUrl = siteUrl("/wedding-cards");
const title =
  "Wedding Cards in Kolkata | Wedding Invitation Cards Online India";
const description =
  "Explore premium wedding cards in Kolkata from Beyond Invitation. Shop Hindu, Muslim, Christian and designer Indian wedding invitation cards with pan-India delivery.";

const baseMetadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title,
  description,
  keywords: PRIMARY_KEYWORDS,
  alternates: { canonical: "/wedding-cards" },
  openGraph: {
    title,
    description,
    url: pageUrl,
    siteName: SITE_NAME,
    type: "website",
    locale: "en_IN",
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        alt: "Beyond Invitation wedding cards in Kolkata",
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

// Primitive keys keep metadata and the rendered catalogue on the same result.
const readPage = cache(async (type: WeddingFilters["type"], price: WeddingFilters["price"], sort: WeddingFilters["sort"], requestedPage: number) => {
  let initialPage: WeddingProductPage = { products: [], nextOffset: null, total: 0, facets: facetCounts([]) };
  let errorMessage = "";
  try {
    initialPage = await fetchWeddingProductPage({ filters: { type, price, sort }, offset: (requestedPage - 1) * COLLECTION_PAGE_SIZE });
  } catch (error) {
    console.error("Wedding cards page Catalogue fetch failed:", error);
    errorMessage = "Unable to load wedding cards.";
  }
  return { initialPage, errorMessage };
});

async function loadPage(params: WeddingSearchParams) {
  const initialFilters = weddingFiltersFromSearchParams(params);
  const requestedPage = parsePageNumber(params.page, COLLECTION_PAGE_SIZE);
  const result = await readPage(initialFilters.type, initialFilters.price, initialFilters.sort, requestedPage);
  const pageNumber = result.initialPage.pageNumber ?? requestedPage;
  const filters = serializeWeddingFilters(initialFilters);
  const query = new URLSearchParams(filters);
  if (pageNumber > 1) query.set("page", String(pageNumber));
  return { ...result, initialFilters, pageNumber, canonical: `/wedding-cards${query.size ? `?${query}` : ""}`, index: !filters && !result.errorMessage };
}

type PageProps = { searchParams: Promise<WeddingSearchParams> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { initialPage, canonical, pageNumber, index } = await loadPage(await searchParams);
  const previews = getProductPreviewImages(initialPage.products);
  const images = previews.length ? previews : [{ url: siteUrl(DEFAULT_OG_IMAGE), alt: "Beyond Invitation wedding cards in Kolkata" }];
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

export default async function WeddingCardsPage({ searchParams }: PageProps) {
  const { initialPage, initialFilters, pageNumber, errorMessage, canonical } = await loadPage(await searchParams);
  const localBusinessJsonLd = {
    "@context": "https://schema.org",
    ...getBusinessIdentity(),
    description: SITE_DESCRIPTION,
    priceRange: "₹₹",
    areaServed: [
      { "@type": "City", name: "Kolkata" },
      { "@type": "State", name: "West Bengal" },
      { "@type": "Country", name: "India" },
    ],
  };
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: getSiteUrl() },
      {
        "@type": "ListItem",
        position: 2,
        name: "Wedding Cards",
        item: siteUrl(canonical),
      },
    ],
  };
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Wedding cards by Beyond Invitation",
    itemListElement: initialPage.products.map((product, index) => ({
      "@type": "ListItem",
      position: ((initialPage.pageNumber ?? pageNumber) - 1) * COLLECTION_PAGE_SIZE + index + 1,
      name: formatProductName(product.name, product.printName),
      url: siteUrl(`/products/${product.slug}`),
      image: getPublicProductImageUrls([product.image])[0],
    })),
  };
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: WEDDING_FAQS.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };

  return (
    <>
      <JsonLd data={localBusinessJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />
      <JsonLd data={itemListJsonLd} />
      <JsonLd data={faqJsonLd} />
      <WeddingCardsCollection initialPage={initialPage} initialFilters={initialFilters} errorMessage={errorMessage} />
    </>
  );
}
