"use client";

import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useProductListHistory } from "@/components/useProductListHistory";
import type { Product } from "@/types";
import { PRODUCTS_PER_PAGE, type ProductPage } from "@/lib/product-page";
import { scrollToProductList } from "@/lib/pagination";
import ProductPagination from "@/components/ProductPagination";
import ProductCard from "./ProductCard";

interface ProductGridProps {
  products: Product[];
}

/** A responsive grid of product cards. */
export function ProductGrid({ products }: ProductGridProps) {
  if (products.length === 0) {
    return (
      <p className="py-10 text-center text-base text-ink-mid">
        No products found.
      </p>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4">
      {products.map((product) => (
        <ProductCard
          key={product.slug}
          product={product}
          imageSizes="(min-width: 1800px) 419px, (min-width: 1024px) calc(25vw - 31px), (min-width: 768px) calc(33.333vw - 29.333px), (min-width: 640px) calc(50vw - 34px), calc(50vw - 22px)"
        />
      ))}
    </div>
  );
}

interface ProductSectionProps {
  label: string;
  title: string;
  products: Product[];
  nextOffset: number | null;
  total?: number;
  sale?: boolean;
  pricedOnly?: boolean;
  collection?: "wedding-boxes";
  viewAllHref?: string;
  viewAllText?: string;
}

/** A homepage collection with one product page at a time. */
export function ProductSection({
  label,
  title,
  products,
  nextOffset,
  total = products.length,
  sale = false,
  pricedOnly = false,
  collection,
  viewAllHref,
  viewAllText = "View All",
}: ProductSectionProps) {
  const [page, setPage] = useState<ProductPage>({ products, nextOffset, total });
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const failedPageRef = useRef<number | null>(null);
  const scrollAfterLoad = useRef(false);
  const { listRef, restoreSnapshot } = useProductListHistory(
    `home-pages:${JSON.stringify([label, pricedOnly, collection, sale])}`,
    { page, currentPage },
  );

  useLayoutEffect(() => {
    const restored = restoreSnapshot();
    setPage(restored?.page ?? { products, nextOffset, total });
    setCurrentPage(restored?.currentPage ?? 1);
    failedPageRef.current = null;
    scrollAfterLoad.current = false;
    setLoading(false);
    setError("");
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [products, nextOffset, total, pricedOnly, collection, restoreSnapshot]);

  useLayoutEffect(() => {
    if (!scrollAfterLoad.current) return;
    scrollAfterLoad.current = false;
    scrollToProductList(listRef.current);
  }, [page, currentPage, listRef]);

  const displayedProducts = useMemo(() => {
    const visibleProducts = pricedOnly
      ? page.products.filter((product) => Number.isFinite(product.price) && product.price > 0)
      : page.products;
    if (!sale) return visibleProducts;
    return visibleProducts.map((product) => {
      const onSale = product.price > 0 && product.mrp > product.price;
      return { ...product, onSale, badge: onSale ? "SALE" : product.badge };
    });
  }, [page.products, sale, pricedOnly]);

  const totalPages = Math.max(1, Math.ceil(page.total / PRODUCTS_PER_PAGE));

  async function goToPage(requestedPage: number) {
    if (requestRef.current || !Number.isSafeInteger(requestedPage)) return;
    let targetPage = Math.min(totalPages, Math.max(1, requestedPage));
    if (targetPage === currentPage && !error) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    failedPageRef.current = targetPage;

    try {
      const fetchPage = async (pageNumber: number): Promise<ProductPage> => {
        const offset = (pageNumber - 1) * PRODUCTS_PER_PAGE;
        const params = new URLSearchParams({ offset: String(offset) });
        if (pricedOnly) params.set("pricedOnly", "true");
        if (collection) params.set("collection", collection);
        const response = await fetch(`/api/catalog/products?${params}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Product request failed");
        const result: ProductPage = await response.json();
        if (
          !Array.isArray(result.products) ||
          !Number.isSafeInteger(result.total) || result.total < 0 ||
          (result.nextOffset !== null &&
            (!Number.isSafeInteger(result.nextOffset) || result.nextOffset <= offset))
        ) throw new Error("Invalid product page");
        return result;
      };
      let result = await fetchPage(targetPage);
      const lastPage = Math.max(1, Math.ceil(result.total / PRODUCTS_PER_PAGE));
      // Products may have been removed since the section was first loaded.
      if (targetPage > lastPage) {
        targetPage = lastPage;
        result = await fetchPage(targetPage);
      }
      if (controller.signal.aborted || requestRef.current !== controller) return;
      if (targetPage > Math.max(1, Math.ceil(result.total / PRODUCTS_PER_PAGE))) {
        throw new Error("Product catalogue changed while loading the page");
      }
      scrollAfterLoad.current = true;
      setPage(result);
      setCurrentPage(targetPage);
      failedPageRef.current = null;
    } catch {
      if (!controller.signal.aborted && requestRef.current === controller) {
        setError("This product page could not be loaded. Please try again.");
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <section
      className="bg-white py-14 md:py-20"
    >
      <div ref={listRef} tabIndex={-1} aria-busy={loading} className="mx-auto max-w-[1800px] scroll-mt-28 px-4 outline-none sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 md:mb-10 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 text-sm font-semibold uppercase tracking-[0.1em] text-gold-ink">
              {label}
            </p>

            <h2 className="font-serif text-3xl font-semibold text-ink md:text-4xl">
              {title}
            </h2>
          </div>

          {viewAllHref && (
            <Link
              href={viewAllHref}
              className="hidden text-base font-semibold text-maroon underline-offset-4 hover:underline md:inline-flex"
            >
              {viewAllText} →
            </Link>
          )}
        </div>

        <ProductGrid products={displayedProducts} />

        {error && (
          <div role="alert" className="mt-4 text-center text-base text-maroon">
            <p>{error}</p>
            <button type="button" disabled={loading} className="mt-2 font-semibold underline underline-offset-4" onClick={() => {
              if (failedPageRef.current !== null) void goToPage(failedPageRef.current);
            }}>Try again</button>
          </div>
        )}
        <p role="status" className="sr-only">
          {loading
            ? "Loading products"
            : `Page ${currentPage} of ${totalPages}, ${displayedProducts.length} products shown`}
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <ProductPagination currentPage={currentPage} totalPages={totalPages} disabled={loading} label={`${title} pagination`} onPageChange={(number) => { void goToPage(number); }} />

          {viewAllHref && (
            <Link
              href={viewAllHref}
              className="text-base font-semibold text-maroon underline-offset-4 hover:underline md:hidden"
            >
              {viewAllText} →
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
