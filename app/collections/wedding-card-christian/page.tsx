import type { Metadata } from "next";

import { fetchWeddingProductPage } from "@/lib/catalog-browse";
import { COLLECTION_PAGE_SIZE } from "@/lib/catalog-browse-options";
import { parsePageNumber } from "@/lib/pagination";
import { facetCounts, weddingFiltersFromSearchParams, type WeddingProductPage, type WeddingSearchParams } from "@/lib/wedding-cards";
import WeddingCardsCollection from "@/components/wedding-cards/WeddingCardsCollection";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Christian Wedding Cards – Beyond Invitation",
  description:
    "A curated collection of Christian wedding invitation cards — elegant church wedding invites, graceful typography and timeless printed designs.",
};

export default async function ChristianWeddingCardPage({ searchParams }: { searchParams: Promise<WeddingSearchParams> }) {
  const params = await searchParams;
  const initialFilters = weddingFiltersFromSearchParams(params, "christian");
  let initialPage: WeddingProductPage = { products: [], nextOffset: null, total: 0, facets: facetCounts([]) };
  let errorMessage = "";

  try {
    initialPage = await fetchWeddingProductPage({ collectionType: "christian", filters: initialFilters, offset: (parsePageNumber(params.page, COLLECTION_PAGE_SIZE) - 1) * COLLECTION_PAGE_SIZE });
  } catch (error) {
    console.error("Christian wedding cards page fetch failed:", error);
    errorMessage = "Unable to load wedding cards.";
  }

  return (
    <WeddingCardsCollection
      title="Christian Wedding Cards"
      collectionType="christian"
      initialPage={initialPage}
      initialFilters={initialFilters}
      errorMessage={errorMessage}
      emptyTitle="No Christian wedding cards just yet"
    />
  );
}
