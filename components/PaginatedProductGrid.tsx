"use client";

import ProductCard from "@/components/ProductCard";
import ProductPagination from "@/components/ProductPagination";
import { useCatalogPagination, type CatalogNavigation } from "@/components/useCatalogPagination";
import type { CatalogBrowsePage, CatalogScope } from "@/lib/catalog-browse-options";

type Pagination = ReturnType<typeof useCatalogPagination>;

export function CatalogPaginationControls({ currentPage, totalPages, loading, error, goToPage, retry, getPageHref }: Pick<Pagination, "currentPage" | "totalPages" | "loading" | "error" | "goToPage" | "retry" | "getPageHref">) {
  return (
    <div className="space-y-3 pt-4 text-center">
      {error && (
        <div role="alert" className="text-base text-maroon">
          <p>{error}</p>
          <button type="button" onClick={retry} disabled={Boolean(loading)} className="mt-2 font-semibold underline underline-offset-4">
            Try again
          </button>
        </div>
      )}
      <ProductPagination currentPage={currentPage} totalPages={totalPages} onPageChange={goToPage} getPageHref={getPageHref} disabled={Boolean(loading)} />
    </div>
  );
}

export default function PaginatedProductGrid({ initialPage, scope = {}, categoryLabel, paginationPath, initialPageNumber, gridClassName = "grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4" }: {
  initialPage: CatalogBrowsePage;
  scope?: CatalogScope;
  categoryLabel?: string;
  gridClassName?: string;
} & CatalogNavigation) {
  const pagination = useCatalogPagination(initialPage, scope, { paginationPath, initialPageNumber });
  return (
    <div ref={pagination.listRef} tabIndex={-1} className="scroll-mt-28 outline-none" aria-busy={Boolean(pagination.loading)}>
      <p className="mb-5 text-base text-ink-mid" aria-live="polite">
        {pagination.loading ? "Loading products…" : <>Showing {pagination.rangeStart === pagination.rangeEnd ? pagination.rangeEnd : `${pagination.rangeStart}–${pagination.rangeEnd}`} of {pagination.page.total} {pagination.page.total === 1 ? "product" : "products"}</>}
      </p>
      <div className={gridClassName}>
        {pagination.page.products.map((product) => (
          <div key={product.slug} className="min-w-0">
            <ProductCard
              product={product}
              categoryLabel={categoryLabel}
              imageSizes="(min-width: 1800px) 419px, (min-width: 1024px) calc(25vw - 31px), (min-width: 768px) calc(33.333vw - 29.333px), (min-width: 640px) calc(50vw - 34px), calc(50vw - 22px)"
            />
          </div>
        ))}
      </div>
      <CatalogPaginationControls {...pagination} />
    </div>
  );
}
