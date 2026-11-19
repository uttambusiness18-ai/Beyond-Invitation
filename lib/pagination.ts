/** Reject malformed or unbounded page parameters before calculating SQL offsets. */
export function parsePageNumber(
  value: string | string[] | null | undefined,
  pageSize = 24,
) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^[1-9]\d*$/.test(raw)) return 1;
  const page = Number(raw);
  return Number.isSafeInteger(page) &&
    (page - 1) * pageSize <= 2147483647 - pageSize
    ? page
    : 1;
}

/** Move keyboard focus with the page change, keeping the sticky navigation clear. */
export function scrollToProductList(element: HTMLElement | null) {
  if (!element) return;
  element.scrollIntoView({ block: "start", behavior: "instant" });
  element.focus({ preventScroll: true });
}
