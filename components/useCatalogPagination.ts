"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useProductListHistory } from "@/components/useProductListHistory";
import { scrollToProductList } from "@/lib/pagination";
import {
  COLLECTION_PAGE_SIZE,
  catalogBrowseQuery,
  emptyCatalogPage,
  type CatalogBrowsePage,
  type CatalogPrice,
  type CatalogScope,
  type CatalogSort,
} from "@/lib/catalog-browse-options";

const DEFAULT_FILTERS = { price: "all", sort: "featured" } as const;
type Filters = { price: CatalogPrice; sort: CatalogSort };
type PageRequest = { query: string; offset: number; pageNumber: number; clear: boolean; scroll: boolean };

export function useCatalogPagination(initialPage: CatalogBrowsePage, scope: CatalogScope = {}) {
  const scopeQuery = catalogBrowseQuery(scope);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(initialPage);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState<"replace" | null>(null);
  const [error, setError] = useState("");
  const pageRef = useRef(initialPage);
  const currentPageRef = useRef(1);
  const shouldScrollRef = useRef(false);
  const filtersRef = useRef<Filters>(DEFAULT_FILTERS);
  const queryRef = useRef(scopeQuery);
  const controllerRef = useRef<AbortController | null>(null);
  const failedRequestRef = useRef<PageRequest | null>(null);
  const { listRef, restoreSnapshot } = useProductListHistory(`catalog-pages:${scopeQuery}`, { page, filters, currentPage });

  useLayoutEffect(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    failedRequestRef.current = null;
    const restored = restoreSnapshot();
    const nextPage = restored?.page ?? initialPage;
    const nextFilters = restored?.filters ?? DEFAULT_FILTERS;
    const nextPageNumber = restored?.currentPage ?? 1;
    const query = new URLSearchParams(scopeQuery);
    query.set("price", nextFilters.price);
    query.set("sort", nextFilters.sort);
    pageRef.current = nextPage;
    currentPageRef.current = nextPageNumber;
    shouldScrollRef.current = false;
    filtersRef.current = nextFilters;
    queryRef.current = query.toString();
    setPage(nextPage);
    setCurrentPage(nextPageNumber);
    setFilters(nextFilters);
    setLoading(null);
    setError("");
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [initialPage, scopeQuery, restoreSnapshot]);

  useLayoutEffect(() => {
    if (!shouldScrollRef.current) return;
    shouldScrollRef.current = false;
    scrollToProductList(listRef.current);
  }, [page, currentPage, listRef]);

  async function requestPage(request: PageRequest) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    failedRequestRef.current = null;
    setError("");
    setLoading("replace");
    if (request.clear) {
      pageRef.current = emptyCatalogPage();
      setPage(pageRef.current);
    }

    try {
      const response = await fetch(`/api/catalog/browse?${request.query}&offset=${request.offset}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Catalogue unavailable");
      const result = await response.json() as CatalogBrowsePage;
      if (controller.signal.aborted || controllerRef.current !== controller) return;
      if (
        !Array.isArray(result.products) || !Number.isSafeInteger(result.total) || result.total < 0 ||
        !(result.nextOffset === null || (Number.isSafeInteger(result.nextOffset) && result.nextOffset > request.offset))
      ) throw new Error("Invalid catalogue page");

      // A catalogue update can remove the final page while it is being requested.
      const lastPage = Math.max(1, Math.ceil(result.total / COLLECTION_PAGE_SIZE));
      if (request.pageNumber > lastPage) {
        void requestPage({ ...request, pageNumber: lastPage, offset: (lastPage - 1) * COLLECTION_PAGE_SIZE });
        return;
      }
      const products = [...new Map(result.products.map((product) => [product.slug, product])).values()];
      pageRef.current = { ...result, products };
      currentPageRef.current = request.pageNumber;
      shouldScrollRef.current = request.scroll;
      setPage(pageRef.current);
      setCurrentPage(request.pageNumber);
    } catch {
      if (controller.signal.aborted || controllerRef.current !== controller) return;
      failedRequestRef.current = request;
      setError("We couldn't load these products. Please try again.");
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(null);
      }
    }
  }

  function changeFilters(next: Filters) {
    const query = catalogBrowseQuery(scope, next.price, next.sort);
    if (query === queryRef.current) return;
    queryRef.current = query;
    filtersRef.current = next;
    currentPageRef.current = 1;
    setCurrentPage(1);
    setFilters(next);
    void requestPage({ query, offset: 0, pageNumber: 1, clear: true, scroll: false });
  }

  const totalPages = Math.max(1, Math.ceil(page.total / COLLECTION_PAGE_SIZE));
  const rangeStart = page.products.length ? (currentPage - 1) * COLLECTION_PAGE_SIZE + 1 : 0;
  const rangeEnd = page.products.length ? Math.min(page.total, rangeStart + page.products.length - 1) : 0;

  return {
    page, loading, error, listRef, currentPage, totalPages, rangeStart, rangeEnd, ...filters,
    setPrice: (price: CatalogPrice) => changeFilters({ ...filtersRef.current, price }),
    setSort: (sort: CatalogSort) => changeFilters({ ...filtersRef.current, sort }),
    clearFilters: () => changeFilters(DEFAULT_FILTERS),
    goToPage(pageNumber: number) {
      const lastPage = Math.max(1, Math.ceil(pageRef.current.total / COLLECTION_PAGE_SIZE));
      if (controllerRef.current || !Number.isSafeInteger(pageNumber) || pageNumber < 1 ||
          pageNumber > lastPage || pageNumber === currentPageRef.current) return;
      void requestPage({ query: queryRef.current, offset: (pageNumber - 1) * COLLECTION_PAGE_SIZE, pageNumber, clear: false, scroll: true });
    },
    retry() {
      if (!controllerRef.current && failedRequestRef.current) void requestPage(failedRequestRef.current);
    },
  };
}
