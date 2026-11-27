import "server-only";

import { unstable_cache } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { WebProductRow } from "@/lib/catalog";
import { applyCatalogPrintNames } from "@/lib/catalog-titles";
import { catalogueErrorMessage } from "@/lib/catalog-errors";
import { HIDDEN_STOREFRONT_SUBJECTS, isStorefrontSubjectVisible } from "@/lib/storefront-availability";

export interface StorefrontRow extends WebProductRow {
  item_category: string;
}

export interface StorefrontPageQuery {
  p_offset?: number;
  p_limit?: number;
  p_category?: string;
  p_subjects?: string[];
  p_item_category?: string;
  p_wedding_only?: boolean;
  p_wedding_collection?: boolean;
  p_exclude_slug?: string;
  p_sort?: string;
  p_price_min?: number;
  p_price_max?: number;
  p_price_max_inclusive?: boolean;
  p_price_min_exclusive?: boolean;
  p_priced_only?: boolean;
  p_on_request?: boolean;
  p_margin_percent?: number;
  p_filter_item_category?: string;
  p_include_facets?: boolean;
}

export interface StorefrontPageResult {
  products: StorefrontRow[];
  nextOffset: number | null;
  total: number;
  facets: null | {
    total: number;
    types: Record<string, number>;
    prices: Record<string, number>;
  };
}

// Deploy the application and migration in either order. Only a missing schema
// object triggers the legacy reader; permission, pricing and network errors fail.
const unavailableUntil = new Map<string, number>();
function missingContract(
  error: { code?: string; message: string },
  resource: string,
) {
  if (
    ["PGRST202", "PGRST205", "42P01", "42883"].includes(error.code ?? "") &&
    error.message.includes(resource)
  ) {
    unavailableUntil.set(resource, Date.now() + 60_000);
    console.warn(
      "Optimized storefront query is not installed. Apply 20261012_storefront_products.sql.",
    );
    return true;
  }
  return false;
}

// The existing page RPC already filters subjects before pagination and facets.
// Cache only the narrow subject list so a paused collection needs no DB change.
const readVisibleSubjectKeys = unstable_cache(async (): Promise<string[] | null> => {
  const resource = "v_storefront_products";
  if ((unavailableUntil.get(resource) ?? 0) > Date.now()) return null;
  const subjects = new Set<string>();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await getSupabaseServerClient().from(resource)
      .select("subject_key")
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1)
      .returns<{ subject_key: string }[]>();
    if (error) {
      if (missingContract(error, resource)) return null;
      throw new Error(`Product catalogue unavailable: ${catalogueErrorMessage(error)}`);
    }
    for (const row of data ?? []) {
      if (isStorefrontSubjectVisible(row.subject_key)) subjects.add(row.subject_key);
    }
    if ((data?.length ?? 0) < pageSize) break;
  }
  return [...subjects].sort();
}, ["visible-storefront-subjects-v1", HIDDEN_STOREFRONT_SUBJECTS.join("|")], {
  revalidate: 60, tags: ["catalogue"],
});

/** null means the migration is not installed; [] is a valid empty result. */
export async function readStorefrontRows(
  options: { slug?: string; slugs?: string[]; offset?: number; limit?: number } = {},
): Promise<StorefrontRow[] | null> {
  if (options.slugs?.length === 0) return [];
  const resource = "v_storefront_products";
  if ((unavailableUntil.get(resource) ?? 0) > Date.now()) return null;
  let query = getSupabaseServerClient().from(resource).select("*");
  if (HIDDEN_STOREFRONT_SUBJECTS.length) {
    query = query.not("subject_key", "in", `(${HIDDEN_STOREFRONT_SUBJECTS.map((subject) => JSON.stringify(subject)).join(",")})`);
  }
  if (options.slug !== undefined) query = query.eq("slug", options.slug);
  if (options.slugs !== undefined) query = query.in("slug", options.slugs);
  const offset = options.offset ?? 0;
  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true })
    .range(offset, offset + (options.limit ?? 1000) - 1)
    .returns<StorefrontRow[]>();
  if (error) {
    if (missingContract(error, resource)) return null;
    throw new Error(`Product catalogue unavailable: ${catalogueErrorMessage(error)}`);
  }
  if (!Array.isArray(data)) {
    throw new Error("Product catalogue returned an invalid product list.");
  }
  return applyCatalogPrintNames(data);
}

/** Returns base prices; the margin parameter only controls filtering and order. */
export async function readStorefrontPage(
  query: StorefrontPageQuery,
): Promise<StorefrontPageResult | null> {
  const resource = "storefront_product_page";
  if ((unavailableUntil.get(resource) ?? 0) > Date.now()) return null;
  let visibleQuery = query;
  if (HIDDEN_STOREFRONT_SUBJECTS.length) {
    const subjects = query.p_subjects !== undefined
      ? query.p_subjects.filter(isStorefrontSubjectVisible)
      : await readVisibleSubjectKeys();
    if (subjects === null) return null;
    // An empty array intentionally yields no rows; undefined would expose all.
    visibleQuery = { ...query, p_subjects: subjects };
  }
  const { data, error } = await getSupabaseServerClient().rpc(resource, visibleQuery);
  if (error) {
    if (missingContract(error, resource)) return null;
    throw new Error(`Product catalogue unavailable: ${catalogueErrorMessage(error)}`);
  }
  if (
    !data ||
    !Array.isArray(data.products) ||
    !Number.isSafeInteger(data.total) ||
    data.total < 0 ||
    (data.nextOffset !== null &&
      (!Number.isSafeInteger(data.nextOffset) ||
        data.nextOffset <= (query.p_offset ?? 0)))
  ) {
    throw new Error("Product catalogue returned an invalid page.");
  }
  const result = data as StorefrontPageResult;
  return { ...result, products: await applyCatalogPrintNames(result.products) };
}
