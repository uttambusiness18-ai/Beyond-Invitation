"use client";

type ProductPaginationProps = {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  label?: string;
};

export default function ProductPagination({
  currentPage,
  totalPages,
  onPageChange,
  disabled = false,
  label = "Product pages",
}: ProductPaginationProps) {
  if (totalPages <= 1) return null;
  const pages =
    totalPages <= 5
      ? Array.from({ length: totalPages }, (_, index) => index + 1)
      : [
          ...new Set([
            1,
            Math.max(2, currentPage - 1),
            currentPage,
            Math.min(totalPages - 1, currentPage + 1),
            totalPages,
          ]),
        ]
          .filter((page) => page >= 1 && page <= totalPages)
          .sort((a, b) => a - b);
  const buttonClass =
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-3 text-base font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-default disabled:opacity-40";
  const defaultColors = "border-carbon/20 bg-white text-carbon hover:border-maroon hover:text-maroon";

  return (
    <nav
      aria-label={label}
      aria-busy={disabled}
      className="mx-auto grid w-fit max-w-full grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-3 sm:flex sm:flex-wrap sm:justify-center"
    >
      <button
        type="button"
        aria-label="Previous page"
        disabled={disabled || currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
        className={`${buttonClass} ${defaultColors} col-start-1 row-start-2 justify-self-start`}
      >
        Previous
      </button>
      <div className="col-span-3 row-start-1 flex flex-wrap items-center justify-center gap-1">
        {pages.map((page, index) => (
          <span key={page} className="inline-flex items-center gap-1">
            {index > 0 && page - pages[index - 1] > 1 ? (
              <span aria-hidden="true" className="w-4 text-center text-ink-mid">
                …
              </span>
            ) : null}
            <button
              type="button"
              aria-label={`Go to page ${page}`}
              aria-current={page === currentPage ? "page" : undefined}
              disabled={disabled}
              onClick={() => {
                if (page !== currentPage) onPageChange(page);
              }}
              className={`${buttonClass} ${page === currentPage ? "border-maroon bg-maroon text-white hover:bg-maroon-dark" : defaultColors}`}
            >
              {page}
            </button>
          </span>
        ))}
      </div>
      <button
        type="button"
        aria-label="Next page"
        disabled={disabled || currentPage >= totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        className={`${buttonClass} ${defaultColors} col-start-3 row-start-2 justify-self-end`}
      >
        Next
      </button>
      <span className="sr-only" role="status">
        Page {currentPage} of {totalPages}
      </span>
    </nav>
  );
}
