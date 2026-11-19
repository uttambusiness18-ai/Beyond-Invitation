import type { Metadata } from "next";

import { fetchWeddingProductPage } from "@/lib/catalog-browse";
import { COLLECTION_PAGE_SIZE } from "@/lib/catalog-browse-options";
import { parsePageNumber } from "@/lib/pagination";
import {
  facetCounts,
  weddingFiltersFromSearchParams,
  type WeddingProductPage,
  type WeddingSearchParams,
} from "@/lib/wedding-cards";
import WeddingCardsCollection from "@/components/wedding-cards/WeddingCardsCollection";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Bengali Wedding Cards – Beyond Invitation",
  description:
    "Browse Bengali wedding invitation cards from Beyond Invitation and find a design for your celebration.",
};

export default async function BengaliWeddingCardPage({
  searchParams,
}: {
  searchParams: Promise<WeddingSearchParams>;
}) {
  const params = await searchParams;
  const initialFilters = weddingFiltersFromSearchParams(
    params,
    "bengali",
  );
  let initialPage: WeddingProductPage = {
    products: [],
    nextOffset: null,
    total: 0,
    facets: facetCounts([]),
  };
  let errorMessage = "";

  try {
    initialPage = await fetchWeddingProductPage({
      collectionType: "bengali",
      filters: initialFilters,
      offset: (parsePageNumber(params.page, COLLECTION_PAGE_SIZE) - 1) * COLLECTION_PAGE_SIZE,
    });
  } catch (error) {
    console.error("Bengali wedding cards page fetch failed:", error);
    errorMessage = "Unable to load wedding cards.";
  }

  return (
    <WeddingCardsCollection
      title="Bengali Wedding Cards"
      collectionType="bengali"
      initialPage={initialPage}
      initialFilters={initialFilters}
      errorMessage={errorMessage}
      emptyTitle="No Bengali wedding cards just yet"
    />
  );
}
