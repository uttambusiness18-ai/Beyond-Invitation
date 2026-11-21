"use client";

type ProductPaginationProps = {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  getPageHref?: (page: number) => string;
  disabled?: boolean;
  label?: string;
};

export default function ProductPagination({
  currentPage,
  totalPages,
  onPageChange,
  getPageHref,
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
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-3 text-base font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-default disabled:opacity-40 aria-disabled:cursor-default aria-disabled:opacity-40";
  const defaultColors = "border-carbon/20 bg-white text-carbon hover:border-maroon hover:text-maroon";

  function control(page: number, label: string, content: string | number, className: string, unavailable = disabled) {
    const shared = {
      "aria-label": label,
      "aria-current": page === currentPage ? "page" as const : undefined,
      className,
    };
    if (getPageHref) {
      // Native links expose each page to crawlers and request fresh page metadata.
      return unavailable
        ? <span {...shared} role="link" aria-disabled="true">{content}</span>
        : <a {...shared} href={getPageHref(page)}>{content}</a>;
    }
    return <button {...shared} type="button" disabled={unavailable}
      onClick={() => { if (page !== currentPage) onPageChange(page); }}>{content}</button>;
  }

  return (
    <nav
      aria-label={label}
      aria-busy={disabled}
      className="mx-auto grid w-fit max-w-full grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-3 sm:flex sm:flex-wrap sm:justify-center"
    >
      {control(currentPage - 1, "Previous page", "Previous",
        `${buttonClass} ${defaultColors} col-start-1 row-start-2 justify-self-start`, disabled || currentPage <= 1)}
      <div className="col-span-3 row-start-1 flex flex-wrap items-center justify-center gap-1">
        {pages.map((page, index) => (
          <span key={page} className="inline-flex items-center gap-1">
            {index > 0 && page - pages[index - 1] > 1 ? (
              <span aria-hidden="true" className="w-4 text-center text-ink-mid">
                …
              </span>
            ) : null}
            {control(page, `Go to page ${page}`, page,
              `${buttonClass} ${page === currentPage ? "border-maroon bg-maroon text-white hover:bg-maroon-dark" : defaultColors}`)}
          </span>
        ))}
      </div>
      {control(currentPage + 1, "Next page", "Next",
        `${buttonClass} ${defaultColors} col-start-3 row-start-2 justify-self-end`, disabled || currentPage >= totalPages)}
      <span className="sr-only" role="status">
        Page {currentPage} of {totalPages}
      </span>
    </nav>
  );
}
