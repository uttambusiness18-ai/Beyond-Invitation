import "server-only";

import { cache } from "react";
import { fetchCatalogProductPage } from "@/lib/catalog-browse";
import { COLLECTION_PAGE_SIZE, type CatalogScope } from "@/lib/catalog-browse-options";
import { parsePageNumber } from "@/lib/pagination";

export type CatalogSearchParams = { page?: string | string[] };

// Metadata and the HTML document share the same read and resolved page number.
const readPage = cache(async (scopeKey: string, requestedPage: number) => {
  const scope: CatalogScope = JSON.parse(scopeKey);
  const result = await fetchCatalogProductPage({
    ...scope, offset: (requestedPage - 1) * COLLECTION_PAGE_SIZE,
  });
  const pageNumber = Math.min(requestedPage, Math.max(1, Math.ceil(result.total / COLLECTION_PAGE_SIZE)));
  const page = pageNumber === requestedPage ? result : await fetchCatalogProductPage({
    ...scope, offset: (pageNumber - 1) * COLLECTION_PAGE_SIZE,
  });
  return { page, pageNumber };
});

export async function loadCatalogPage(params: CatalogSearchParams, scope: CatalogScope = {}) {
  return readPage(JSON.stringify(scope), parsePageNumber(params.page, COLLECTION_PAGE_SIZE));
}

export function catalogPagePath(pathname: string, pageNumber: number) {
  return pageNumber > 1 ? `${pathname}?page=${pageNumber}` : pathname;
}
