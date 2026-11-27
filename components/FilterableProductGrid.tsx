"use client";

import type { CatalogBrowsePage, CatalogPrice, CatalogScope, CatalogSort } from "@/lib/catalog-browse-options";
import { useCatalogPagination, type CatalogNavigation } from "@/components/useCatalogPagination";
import { CatalogPaginationControls } from "@/components/PaginatedProductGrid";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ProductGrid } from "./ProductGrid";

interface PriceRange {
  key: CatalogPrice;
  label: string;
}

/**
 * Price buckets.
 * Edit this array to change the available ranges.
 */
const PRICE_RANGES: PriceRange[] = [
  { key: "all", label: "All Prices" },
  { key: "under-100", label: "Under ₹100" },
  { key: "100-300", label: "₹100 – ₹300" },
  { key: "300-1000", label: "₹300 – ₹1000" },
  { key: "above-1000", label: "Above ₹1000" },
];

/**
 * Sort options.
 */
const SORT_OPTIONS = [
  { key: "featured", label: "Featured" },
  { key: "price-asc", label: "Price: Low to High" },
  { key: "price-desc", label: "Price: High to Low" },
  { key: "discount", label: "Biggest Discount" },
];

interface FilterableProductGridProps extends CatalogNavigation {
  initialPage: CatalogBrowsePage;
  scope?: CatalogScope;
}

export default function FilterableProductGrid({
  initialPage,
  scope = {},
  paginationPath,
  initialPageNumber,
}: FilterableProductGridProps) {
  const pagination = useCatalogPagination(initialPage, scope, { paginationPath, initialPageNumber });
  const { page, price: priceKey, sort: sortKey, setPrice, setSort, clearFilters, loading, error } = pagination;
  const isFiltered = priceKey !== "all" || sortKey !== "featured";

  return (
    <div ref={pagination.listRef} tabIndex={-1} className="scroll-mt-28 space-y-6 outline-none">
      <div className="flex flex-col gap-4 rounded-2xl border border-gold/20 bg-white/70 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <RadioGroup
          value={priceKey}
          onChange={(value) => setPrice(value as CatalogPrice)}
          orientation="horizontal"
          className="flex flex-wrap items-center gap-2 md:w-auto"
        >
          <Label className="text-base font-semibold text-ink">Price</Label>

          {PRICE_RANGES.map((range) => (
            <RadioGroupItem
              key={range.key}
              value={range.key}
              className={`h-auto w-auto rounded-full border px-3.5 py-1.5 text-base font-medium transition [&_[data-slot=radio-group-indicator]]:hidden ${
                priceKey === range.key
                  ? "border-maroon bg-maroon text-gold-light data-[selected]:border-maroon"
                  : "border-gold/30 bg-cream text-ink-mid hover:border-gold hover:bg-gold-pale"
              }`}
            >
              {range.label}
            </RadioGroupItem>
          ))}
        </RadioGroup>

        <div className="flex w-full min-w-0 items-center gap-2 md:w-auto">
          <Label htmlFor="sort-products" className="text-base font-semibold text-ink">
            Sort
          </Label>

          <NativeSelect
            id="sort-products"
            value={sortKey}
            onChange={(e) => setSort(e.target.value as CatalogSort)}
            className="min-w-0 flex-1 md:w-auto md:flex-none [&_[data-slot=native-select]]:h-auto [&_[data-slot=native-select]]:rounded-lg [&_[data-slot=native-select]]:border-gold/30 [&_[data-slot=native-select]]:bg-cream [&_[data-slot=native-select]]:py-1.5 [&_[data-slot=native-select]]:pl-3 [&_[data-slot=native-select]]:pr-9 [&_[data-slot=native-select]]:focus:border-gold [&_[data-slot=native-select]]:focus:ring-2 [&_[data-slot=native-select]]:focus:ring-gold [&_[data-slot=native-select-icon]]:right-3"
          >
            {SORT_OPTIONS.map((opt) => (
              <NativeSelectOption key={opt.key} value={opt.key}>
                {opt.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base text-ink-mid" aria-live="polite">
          {loading === "replace" ? "Loading products…" : error && page.products.length === 0 ? "Products unavailable" : <>
          Showing{" "}
          <span className="font-semibold text-ink">
            {pagination.rangeStart === pagination.rangeEnd ? pagination.rangeEnd : `${pagination.rangeStart}–${pagination.rangeEnd}`}
          </span>{" "}
          of{" "}
          <span className="font-semibold text-ink">
            {page.total}
          </span>{" "}
          {page.total === 1 ? "product" : "products"}
          </>}
        </p>

        {isFiltered && (
          <Button
            type="button"
            variant="link"
            onPress={clearFilters}
            className="h-auto p-0 text-base font-semibold text-maroon underline-offset-4 hover:underline"
          >
            Clear filters
          </Button>
        )}
      </div>

      <div aria-busy={Boolean(loading)}>
        {loading === "replace" && page.products.length === 0 ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
            {Array.from({ length: 10 }, (_, index) => (
              <div key={index} className="min-w-0 motion-safe:animate-pulse">
                <div className="aspect-square bg-neutral-100" />
                <div className="mt-2 h-4 w-4/5 bg-neutral-100" />
                <div className="mt-2 h-4 w-1/2 bg-neutral-100" />
              </div>
            ))}
          </div>
        ) : !error || page.products.length > 0 ? <ProductGrid products={page.products} /> : null}
        <CatalogPaginationControls {...pagination} />
      </div>
    </div>
  );
}
