import "server-only";

import type { Metadata } from "next";
import { cache } from "react";
import { fetchWeddingProductPage } from "@/lib/catalog-browse";
import { COLLECTION_PAGE_SIZE } from "@/lib/catalog-browse-options";
import { parsePageNumber } from "@/lib/pagination";
import {
  serializeWeddingFilters,
  weddingDefaultFilters,
  weddingFiltersFromSearchParams,
  type WeddingFilters,
  type WeddingSearchParams,
} from "@/lib/wedding-cards";

type CollectionType = "hindu" | "muslim" | "christian";

// Primitive cache arguments let metadata and rendering share the same result,
// including the final page number when the requested page has been clamped.
const readPage = cache(async (
  collectionType: CollectionType,
  pageNumber: number,
  price: WeddingFilters["price"],
  sort: WeddingFilters["sort"],
) => fetchWeddingProductPage({
  collectionType,
  filters: { type: "all", price, sort },
  offset: (pageNumber - 1) * COLLECTION_PAGE_SIZE,
}));

export async function loadWeddingCollectionPage(
  collectionType: CollectionType,
  params: WeddingSearchParams,
) {
  const initialFilters = weddingFiltersFromSearchParams(params, collectionType);
  const requestedPage = parsePageNumber(params.page, COLLECTION_PAGE_SIZE);
  const initialPage = await readPage(
    collectionType, requestedPage, initialFilters.price, initialFilters.sort,
  );
  const pageNumber = initialPage.pageNumber ?? requestedPage;
  const query = new URLSearchParams(serializeWeddingFilters(initialFilters, collectionType));
  if (pageNumber > 1) query.set("page", String(pageNumber));
  const index = initialFilters.price === "any" &&
    initialFilters.sort === weddingDefaultFilters(collectionType).sort;
  const metadata: Pick<Metadata, "alternates" | "robots"> = {
    alternates: {
      canonical: `/collections/wedding-card-${collectionType}${query.size ? `?${query}` : ""}`,
    },
    robots: { index, follow: true, googleBot: { index, follow: true } },
  };
  return { initialFilters, initialPage, metadata };
}
