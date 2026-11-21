"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { subscribeMediaQuery } from "@/lib/media-query";
import { useProductListHistory } from "@/components/useProductListHistory";
import ProductPagination from "@/components/ProductPagination";
import { COLLECTION_PAGE_SIZE } from "@/lib/catalog-browse-options";
import { parsePageNumber, scrollToProductList } from "@/lib/pagination";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import WeddingCardTile from "@/components/wedding-cards/WeddingCardTile";
import { useWeddingCardsMotion } from "@/components/wedding-cards/WeddingCardsMotion";
import {
  DEFAULT_WEDDING_FILTERS,
  normalizeWeddingCollectionFilters,
  parseWeddingFilters,
  serializeWeddingFilters,
  WEDDING_SORTS,
  type WeddingFilters,
  type WeddingCollectionType,
  type WeddingProductPage,
} from "@/lib/wedding-cards";

const gridClass =
  "grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4";
const secondary =
  "rounded-md border border-carbon/20 bg-white px-6 py-3 text-base font-semibold text-carbon transition-colors hover:bg-paper focus-visible:outline-gold";
type FacetOption = { value: string; label: string; count: number };
type PageMode = "filter" | "page" | "history";

function writePageUrl(filters: WeddingFilters, pageNumber: number, method: "push" | "replace") {
  const query = new URLSearchParams(window.location.search);
  for (const key of ["type", "text", "price", "photos", "sort", "offset", "page"]) query.delete(key);
  new URLSearchParams(serializeWeddingFilters(filters)).forEach((value, key) => query.set(key, value));
  if (pageNumber > 1) query.set("page", String(pageNumber));
  const url = `${window.location.pathname}${query.size ? `?${query}` : ""}${window.location.hash}`;
  if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  if (method === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(window.history.state, "", url);
}

function Facet({
  label,
  options,
  value,
  anyLabel,
  anyValue,
  total,
  onChange,
}: {
  label: string;
  options: FacetOption[];
  value: string;
  anyLabel: string;
  anyValue: string;
  total: number;
  onChange: (value: string) => void;
}) {
  return (
    <RadioGroup value={value} onChange={onChange} className="min-w-0 gap-0.5">
      <Label className="mb-1.5 text-base font-semibold text-carbon">
        {label}
      </Label>
      {[{ value: anyValue, label: anyLabel, count: total }, ...options].map(
        (option) => (
          <RadioGroupItem
            key={option.value}
            value={option.value}
            className="h-auto min-h-11 w-full justify-start gap-2.5 rounded-sm border-0 py-2 text-left text-base text-ink-mid hover:text-maroon data-[selected]:font-semibold data-[selected]:text-maroon [&>[data-slot=radio-group-indicator]]:size-3.5 [&>[data-slot=radio-group-indicator]]:rounded-full [&>[data-slot=radio-group-indicator]]:border [&>[data-slot=radio-group-indicator]]:border-carbon/25 data-[selected]:[&>[data-slot=radio-group-indicator]]:border-maroon [&>[data-slot=radio-group-indicator]>span]:size-1.5"
          >
            <span>{option.label}</span>
            <span className="ml-auto pl-2 text-sm font-normal tabular-nums text-ink-mid">
              {option.count}
            </span>
          </RadioGroupItem>
        ),
      )}
    </RadioGroup>
  );
}

export function WeddingCardsSkeleton({
  productLabel = "wedding cards",
}: {
  productLabel?: string;
}) {
  return (
    <div
      role="status"
      aria-label={`Loading ${productLabel}`}
      className={gridClass}
    >
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="min-w-0">
          <div className="aspect-square bg-neutral-100" />
          <div className="space-y-3 pt-4">
            <div className="h-3 w-2/3 rounded bg-paper" />
            <div className="h-5 w-1/2 rounded bg-paper" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading designs</span>
    </div>
  );
}

export default function WeddingCardsBrowser({
  initialPage,
  initialFilters = DEFAULT_WEDDING_FILTERS,
  collectionType,
}: {
  initialPage: WeddingProductPage;
  initialFilters?: WeddingFilters;
  collectionType?: WeddingCollectionType;
}) {
  const productLabel =
    collectionType === "boxes" ? "wedding boxes" : "wedding cards";
  const normalizeFilters = useCallback(
    (value: WeddingFilters): WeddingFilters =>
      normalizeWeddingCollectionFilters(value, collectionType),
    [collectionType],
  );
  const [filters, setFilters] = useState(() =>
    normalizeFilters(initialFilters),
  );
  const [page, setPage] = useState(initialPage);
  const [currentPage, setCurrentPage] = useState(initialPage.pageNumber ?? 1);
  const currentPageRef = useRef(initialPage.pageNumber ?? 1);
  const shouldScroll = useRef(false);
  const [loading, setLoading] = useState<"replace" | "page" | null>(null);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const failedRequest = useRef<{
    filters: WeddingFilters;
    pageNumber: number;
    mode: PageMode;
  } | null>(null);
  const filterKey = serializeWeddingFilters(filters);
  const [sheetOpen, setSheetOpen] = useState(false);
  const pendingFilters = useRef(filters);
  const motion = useWeddingCardsMotion();
  const facets = page.facets;
  const visible = page.products;
  const visibleKey = visible.map((product) => product.slug).join("|");
  const hasFilters = filters.type !== "all" || filters.price !== "any";
  const { listRef: browserRef, restoreSnapshot, saveSnapshot } = useProductListHistory(
    `wedding-pages:${collectionType ?? "all"}`,
    { page, filters, currentPage },
  );
  const sheetRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const sheetWasOpen = useRef(false);
  const sortId = useId();
  const sheetTitleId = useId();

  const requestPage = useCallback(
    async (nextFilters: WeddingFilters, pageNumber = 1, mode: PageMode = "filter") => {
      const offset = (pageNumber - 1) * COLLECTION_PAGE_SIZE;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      failedRequest.current = null;
      setError("");
      setLoading(mode === "page" ? "page" : "replace");
      if (mode !== "page") {
        motion.reorderStart();
        setPage((previous) => ({
          ...previous,
          products: [],
          nextOffset: null,
          total: 0,
        }));
      }
      const query = new URLSearchParams(serializeWeddingFilters(nextFilters));
      query.set("mode", "wedding");
      if (collectionType) query.set("collectionType", collectionType);
      query.set("offset", String(offset));
      try {
        const response = await fetch(`/api/catalog/browse?${query}`, {
          signal: controller.signal,
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Unable to load designs.");
        const result: WeddingProductPage = await response.json();
        const resolvedPage = result.pageNumber ?? pageNumber;
        if (
          !Array.isArray(result.products) ||
          !result.facets ||
          !Number.isSafeInteger(result.total) ||
          result.total < 0 ||
          !Number.isSafeInteger(resolvedPage) || resolvedPage < 1 ||
          resolvedPage > Math.max(1, Math.ceil(result.total / COLLECTION_PAGE_SIZE)) ||
          (result.nextOffset !== null &&
            (!Number.isSafeInteger(result.nextOffset) ||
              result.nextOffset <= (resolvedPage - 1) * COLLECTION_PAGE_SIZE))
        ) {
          throw new Error("Unable to load designs.");
        }
        if (controller.signal.aborted || request.current !== controller) return;
        const unique = new Map(result.products.map((product) => [product.slug, product]));
        currentPageRef.current = resolvedPage;
        shouldScroll.current = mode === "page";
        setCurrentPage(resolvedPage);
        setPage({ ...result, products: [...unique.values()] });
        if (mode === "page") writePageUrl(nextFilters, resolvedPage, "push");
        else if (resolvedPage !== pageNumber) writePageUrl(nextFilters, resolvedPage, "replace");
      } catch {
        if (controller.signal.aborted || request.current !== controller) return;
        failedRequest.current = { filters: nextFilters, pageNumber, mode };
        setError("Unable to load designs. Please try again.");
      } finally {
        if (request.current === controller) {
          request.current = null;
          setLoading(null);
        }
      }
    },
    [collectionType, motion],
  );

  useLayoutEffect(() => {
    request.current?.abort();
    request.current = null;
    failedRequest.current = null;
    const restored = restoreSnapshot();
    const next = normalizeFilters(restored?.filters ?? initialFilters);
    pendingFilters.current = next;
    setFilters(next);
    setPage(restored?.page ?? initialPage);
    currentPageRef.current = restored?.currentPage ?? initialPage.pageNumber ?? 1;
    setCurrentPage(currentPageRef.current);
    shouldScroll.current = false;
    if (parsePageNumber(new URLSearchParams(window.location.search).get("page")) !== currentPageRef.current) {
      writePageUrl(next, currentPageRef.current, "replace");
    }
    setLoading(null);
    setError("");
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [initialPage, initialFilters, normalizeFilters, restoreSnapshot]);
  useLayoutEffect(() => {
    const browser = browserRef.current;
    if (!browser) return;
    // The parent motion wrapper can mount before this Suspense boundary hydrates.
    browser.dataset.motionReady = "true";
    motion.reorderEnd();
    motion.revealNew();
    return () => {
      delete browser.dataset.motionReady;
    };
  }, [visibleKey, filterKey, motion, browserRef]);

  useLayoutEffect(() => {
    if (!shouldScroll.current) return;
    shouldScroll.current = false;
    scrollToProductList(browserRef.current);
  }, [page, currentPage, browserRef]);

  useEffect(() => {
    const pathname = window.location.pathname;
    const onPopState = () => {
      if (window.location.pathname !== pathname) return;
      const restored = restoreSnapshot();
      if (restored) {
        request.current?.abort();
        request.current = null;
        failedRequest.current = null;
        pendingFilters.current = normalizeFilters(restored.filters);
        setFilters(pendingFilters.current);
        setPage(restored.page);
        currentPageRef.current = restored.currentPage;
        setCurrentPage(restored.currentPage);
        shouldScroll.current = false;
        setLoading(null);
        setError("");
        return;
      }
      const next = normalizeFilters(
        parseWeddingFilters(new URLSearchParams(window.location.search)),
      );
      const pageNumber = parsePageNumber(new URLSearchParams(window.location.search).get("page"));
      if (
        serializeWeddingFilters(next) ===
        serializeWeddingFilters(pendingFilters.current) && pageNumber === currentPageRef.current
      )
        return;
      pendingFilters.current = next;
      setFilters(next);
      void requestPage(next, pageNumber, "history");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [normalizeFilters, requestPage, restoreSnapshot]);

  useEffect(() => {
    const sheet = sheetRef.current,
      backdrop = backdropRef.current;
    if (!sheet || !backdrop) return;
    if (!sheetOpen) {
      if (sheetWasOpen.current) {
        motion.closeSheet(sheet, backdrop);
        filterButtonRef.current?.focus({ preventScroll: true });
      }
      sheetWasOpen.current = false;
      return;
    }
    sheetWasOpen.current = true;
    motion.openSheet(sheet, backdrop);
    const frame = window.requestAnimationFrame(() =>
      sheet
        .querySelector<HTMLElement>("input[type='radio']:checked")
        ?.focus({ preventScroll: true }),
    );
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSheetOpen(false);
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          sheet.querySelectorAll<HTMLElement>(
            "button:not(:disabled), a[href], select, input:not(:disabled), [tabindex='0']",
          ),
        ).filter(
          (element) => element.tabIndex >= 0 && !element.closest("[hidden]"),
        );
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !sheet.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !sheet.contains(document.activeElement))
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onDesktop = () => {
      if (desktop.matches) setSheetOpen(false);
    };
    const unsubscribeDesktop = subscribeMediaQuery(desktop, onDesktop);
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      unsubscribeDesktop();
      document.removeEventListener("keydown", onKey);
    };
  }, [sheetOpen, motion]);

  function update(patch: Partial<WeddingFilters>) {
    const next = normalizeFilters({ ...pendingFilters.current, ...patch });
    if (
      serializeWeddingFilters(next) ===
      serializeWeddingFilters(pendingFilters.current)
    )
      return;
    if (!request.current && !error) saveSnapshot();
    pendingFilters.current = next;
    setFilters(next);
    currentPageRef.current = 1;
    setCurrentPage(1);
    writePageUrl(next, 1, "push");
    void requestPage(next);
  }

  function goToPage(pageNumber: number) {
    if (request.current || !Number.isSafeInteger(pageNumber) || pageNumber < 1 ||
        pageNumber > Math.ceil(page.total / COLLECTION_PAGE_SIZE) || pageNumber === currentPageRef.current) return;
    saveSnapshot();
    void requestPage(pendingFilters.current, pageNumber, "page");
  }

  const facetControls = (
    <div className="space-y-6">
      {collectionType || facets.showPrice ? (
        <Facet
          label="Price per piece"
          options={facets.prices}
          value={filters.price}
          anyLabel="All prices"
          anyValue="any"
          total={facets.total}
          onChange={(price) =>
            update({ price: price as WeddingFilters["price"] })
          }
        />
      ) : null}
    </div>
  );

  return (
    <div
      data-wedding-browser
      ref={browserRef}
      tabIndex={-1}
      aria-busy={loading !== null}
      className="grid scroll-mt-28 items-start gap-x-6 outline-none lg:grid-cols-[200px_minmax(0,1fr)]"
    >
      <aside
        aria-label={`Filter ${productLabel}`}
        data-filter-sidebar
        className="hidden border-r border-carbon/10 pr-4 lg:block"
      >
        <div className="mb-5 flex h-11 items-center justify-between gap-2 border-b border-carbon/10">
          <h2 className="text-base font-semibold text-carbon">Filters</h2>
          {hasFilters ? (
            <Button
              variant="link"
              type="button"
              aria-label="Clear filters"
              onPress={() =>
                update({ ...DEFAULT_WEDDING_FILTERS, sort: filters.sort })
              }
              className="h-auto px-0 py-2 text-base text-ink-mid underline underline-offset-4 hover:text-maroon"
            >
              Clear filters
            </Button>
          ) : null}
        </div>
        {facetControls}
      </aside>
      <div className="min-w-0">
        <div
          data-catalogue-toolbar
          className="mb-5 flex min-h-11 flex-wrap items-center justify-between gap-x-3 border-b border-carbon/10 pb-2 lg:pb-0"
        >
          <p
            role="status"
            aria-live="polite"
            className="text-base tabular-nums text-ink-mid"
          >
            {loading
              ? "Loading designs…"
              : error && !visible.length
                ? "Unable to load designs"
                : `${page.total} designs`}
          </p>
          <div className="flex max-w-full flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              variant="ghost"
              ref={filterButtonRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              onPress={() => setSheetOpen(true)}
              className="min-h-11 gap-1.5 px-0 text-base font-semibold text-carbon focus-visible:outline-gold lg:hidden"
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              Filters
              {hasFilters ? (
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-maroon"
                />
              ) : null}
            </Button>
            <div className="flex items-center gap-2">
              <Label
                htmlFor={sortId}
                className="hidden text-base text-ink-mid sm:block"
              >
                Sort by
              </Label>
              <NativeSelect
                id={sortId}
                aria-label={`Sort ${productLabel}`}
                value={filters.sort}
                onChange={(event) =>
                  update({
                    sort: event.target.value as WeddingFilters["sort"],
                  })
                }
                className="w-auto max-w-full [&_select]:h-11 [&_select]:cursor-pointer [&_select]:rounded-none [&_select]:border-0 [&_select]:bg-transparent [&_select]:py-2 [&_select]:pl-0 [&_select]:pr-5 [&_select]:font-semibold [&_select]:text-carbon [&_svg]:right-0 [&_svg]:size-3.5"
              >
                {WEDDING_SORTS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
        </div>
        {error ? (
          <div
            role="alert"
            className="mb-5 rounded-md border border-carbon/15 bg-white p-4 text-base text-ink-mid"
          >
            <p>{error}</p>
            <Button
              variant="link"
              type="button"
              className="mt-2 h-auto px-0 text-base font-semibold text-maroon underline underline-offset-4"
              onPress={() => {
                const retry = failedRequest.current;
                if (retry)
                  void requestPage(retry.filters, retry.pageNumber, retry.mode);
              }}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {loading === "replace" ? (
          <WeddingCardsSkeleton productLabel={productLabel} />
        ) : visible.length ? (
          <>
            <div data-wedding-grid className={gridClass}>
              {visible.map((product, index) => (
                <WeddingCardTile
                  key={product.slug}
                  product={product}
                  priority={index < 4}
                />
              ))}
            </div>
            <div className="mt-10 text-center">
              <p className="mb-4 text-base text-ink-mid">
                Showing {(currentPage - 1) * COLLECTION_PAGE_SIZE + 1}–{Math.min(page.total, (currentPage - 1) * COLLECTION_PAGE_SIZE + visible.length)} of {page.total} designs
              </p>
              <ProductPagination currentPage={currentPage}
                getPageHref={collectionType === "bengali" ? (pageNumber) => {
                  const query = new URLSearchParams(filterKey);
                  if (pageNumber > 1) query.set("page", String(pageNumber));
                  return `/collections/wedding-card-bengali${query.size ? `?${query}` : ""}`;
                } : undefined}
                totalPages={Math.max(1, Math.ceil(page.total / COLLECTION_PAGE_SIZE))}
                onPageChange={goToPage} disabled={loading !== null}
                label={`${productLabel} pages`} />
            </div>
          </>
        ) : !error ? (
          <div className="border border-carbon/10 bg-white px-6 py-12 text-center">
            <p className="text-xl font-normal text-maroon">
              No designs match these filters.
            </p>
            <Button
              variant="outline"
              type="button"
              onPress={() =>
                update({ ...DEFAULT_WEDDING_FILTERS, sort: filters.sort })
              }
              className={`mt-5 h-auto ${secondary}`}
            >
              Clear filters
            </Button>
          </div>
        ) : null}
      </div>
      <div
        ref={backdropRef}
        hidden
        className="fixed inset-0 z-[200] bg-carbon/40"
        onClick={(event) => {
          if (event.target === event.currentTarget) setSheetOpen(false);
        }}
      >
        <div
          ref={sheetRef}
          hidden
          role="dialog"
          aria-modal="true"
          aria-labelledby={sheetTitleId}
          className="absolute inset-y-0 left-0 w-full max-w-sm overflow-y-auto overscroll-contain bg-[#faf8f5] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl"
        >
          <div className="mb-6 flex items-center justify-between gap-4 border-b border-carbon/10 pb-3">
            <h3 id={sheetTitleId} className="text-xl font-semibold text-maroon">
              Filters
            </h3>
            <Button
              variant="ghost"
              type="button"
              aria-label="Close filters"
              onPress={() => setSheetOpen(false)}
              className="h-auto p-3 text-carbon"
            >
              <X size={18} aria-hidden="true" />
            </Button>
          </div>
          {facetControls}
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              type="button"
              onPress={() => setSheetOpen(false)}
              className="h-auto flex-1 rounded-md bg-carbon px-6 py-3 text-base font-semibold text-white hover:bg-carbon-dark"
            >
              {loading === "replace"
                ? "Loading designs…"
                : `Show ${page.total} designs`}
            </Button>
            {hasFilters ? (
              <Button
                variant="outline"
                type="button"
                onPress={() =>
                  update({ ...DEFAULT_WEDDING_FILTERS, sort: filters.sort })
                }
                className={`h-auto ${secondary}`}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
