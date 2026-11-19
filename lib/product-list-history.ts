type ProductAnchor = {
  slug: string;
  top: number;
  scrollY: number;
};

export type ProductListSnapshot<T> = {
  url: string;
  data: T;
  anchor: ProductAnchor | null;
};

const HISTORY_KEY = "beyondProductLists";
const STORAGE_PREFIX = "beyond-product-list:v1:";
const MAX_SNAPSHOTS = 20;
const snapshots = new Map<string, ProductListSnapshot<unknown>>();

function currentUrl() {
  return (
    window.location.pathname + window.location.search + window.location.hash
  );
}

export function saveProductListSnapshot<T>(
  key: string,
  data: T,
  anchor: ProductAnchor | null,
) {
  const url = currentUrl();
  const entries = window.history.state?.[HISTORY_KEY] ?? {};
  const previous = entries[key];
  const id =
    previous?.url === url
      ? (previous.id as string)
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const snapshot: ProductListSnapshot<T> = { url, data, anchor };

  // Only the small identifier belongs in history; keep Next's router state intact.
  window.history.replaceState(
    {
      ...window.history.state,
      [HISTORY_KEY]: { ...entries, [key]: { id, url } },
    },
    "",
  );
  snapshots.delete(id);
  snapshots.set(id, snapshot);
  while (snapshots.size > MAX_SNAPSHOTS)
    snapshots.delete(snapshots.keys().next().value!);

  try {
    window.sessionStorage.setItem(
      STORAGE_PREFIX + id,
      JSON.stringify(snapshot),
    );
    const keys = Object.keys(window.sessionStorage)
      .filter((item) => item.startsWith(STORAGE_PREFIX))
      .sort();
    for (const expired of keys.slice(
      0,
      Math.max(0, keys.length - MAX_SNAPSHOTS),
    )) {
      window.sessionStorage.removeItem(expired);
    }
  } catch {
    // The in-memory snapshot still supports Back when browser storage is unavailable.
  }
}

export function readProductListSnapshot<T>(
  key: string,
): ProductListSnapshot<T> | null {
  const entry = window.history.state?.[HISTORY_KEY]?.[key];
  if (!entry || entry.url !== currentUrl() || typeof entry.id !== "string")
    return null;
  let snapshot = snapshots.get(entry.id);
  if (!snapshot) {
    try {
      snapshot = JSON.parse(
        window.sessionStorage.getItem(STORAGE_PREFIX + entry.id) || "null",
      );
    } catch {
      return null;
    }
  }
  if (!snapshot || snapshot.url !== currentUrl() || !snapshot.data) return null;
  if (
    snapshot.anchor &&
    (typeof snapshot.anchor.slug !== "string" ||
      !Number.isFinite(snapshot.anchor.top) ||
      !Number.isFinite(snapshot.anchor.scrollY))
  )
    return null;
  return snapshot as ProductListSnapshot<T>;
}
