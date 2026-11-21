import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";

import { fetchWeddingProductPage } from "@/lib/catalog-browse";
import { COLLECTION_PAGE_SIZE } from "@/lib/catalog-browse-options";
import {
  buildBengaliStructuredData,
  getBengaliMetadata,
} from "@/lib/bengali-wedding-seo";
import { BENGALI_FAQS, BENGALI_INTRO } from "@/lib/bengali-wedding-content";
import { parsePageNumber } from "@/lib/pagination";
import {
  facetCounts,
  weddingFiltersFromSearchParams,
  type WeddingProductPage,
  type WeddingSearchParams,
  type WeddingFilters,
} from "@/lib/wedding-cards";
import WeddingCardsCollection from "@/components/wedding-cards/WeddingCardsCollection";
import BengaliWeddingEditorial from "@/components/wedding-cards/BengaliWeddingEditorial";
import JsonLd from "@/components/seo/JsonLd";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Metadata and the rendered list share one result, including a clamped page number.
const readPage = cache(
  async (
    pageNumber: number,
    price: WeddingFilters["price"],
    sort: WeddingFilters["sort"],
  ) => {
    let initialPage: WeddingProductPage = {
      pageNumber,
      products: [],
      nextOffset: null,
      total: 0,
      facets: facetCounts([]),
    };
    let errorMessage = "";

    try {
      initialPage = await fetchWeddingProductPage({
        collectionType: "bengali",
        filters: { type: "all", price, sort },
        offset: (pageNumber - 1) * COLLECTION_PAGE_SIZE,
      });
    } catch (error) {
      console.error("Bengali wedding cards page fetch failed:", error);
      errorMessage = "Unable to load wedding cards.";
    }
    return { initialPage, errorMessage };
  },
);

function loadPage(params: WeddingSearchParams) {
  const filters = weddingFiltersFromSearchParams(params, "bengali");
  return readPage(
    parsePageNumber(params.page, COLLECTION_PAGE_SIZE),
    filters.price,
    filters.sort,
  );
}

type PageProps = { searchParams: Promise<WeddingSearchParams> };

export async function generateMetadata({
  searchParams,
}: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const { initialPage } = await loadPage(params);
  return getBengaliMetadata(params, initialPage.pageNumber);
}

export default async function BengaliWeddingCardPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const initialFilters = weddingFiltersFromSearchParams(params, "bengali");
  const { initialPage, errorMessage } = await loadPage(params);

  return (
    <>
      <JsonLd data={buildBengaliStructuredData(initialPage, params)} />
      <WeddingCardsCollection
        title="Bengali Wedding Cards"
        collectionType="bengali"
        initialPage={initialPage}
        initialFilters={initialFilters}
        errorMessage={errorMessage}
        emptyTitle="No Bengali wedding cards just yet"
        intro={BENGALI_INTRO}
        headerContent={
          <nav aria-label="Breadcrumb" className="mb-4 text-sm text-ink-mid">
            <ol className="flex flex-wrap items-center gap-2">
              <li>
                <Link href="/" className="hover:text-maroon hover:underline">
                  Home
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <Link
                  href="/wedding-cards"
                  className="hover:text-maroon hover:underline"
                >
                  Wedding Cards
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page">Bengali Wedding Cards</li>
            </ol>
          </nav>
        }
        faqs={BENGALI_FAQS}
        faqTitle="Bengali wedding card questions"
      >
        <BengaliWeddingEditorial />
      </WeddingCardsCollection>
    </>
  );
}
