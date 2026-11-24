import "server-only";
import { unstable_cache } from "next/cache";
import { HIDDEN_STOREFRONT_SUBJECTS } from "@/lib/storefront-availability";
import { discountPercent } from "@/types";
import {
  fetchErpProductsBase,
  mapCatalogRowToProduct,
  isWeddingCardProduct,
  compareWeddingCardProducts,
  type CatalogProduct,
} from "@/lib/catalog";
import {
  fetchProductsByItemCategoryBase,
  fetchWeddingCardsWithCategoriesBase,
} from "@/lib/catalog-item-category";
import {
  readStorefrontPage,
  type StorefrontPageQuery,
} from "@/lib/storefront-data";
import {
  applyMarginToPrice,
  getActiveResellerFromCookies,
  repriceProduct,
} from "@/lib/reseller";
import {
  COLLECTION_PAGE_SIZE,
  CATALOG_PRICES,
  CATALOG_SORTS,
  type CatalogBrowseOptions,
  type CatalogBrowsePage,
} from "@/lib/catalog-browse-options";
import {
  WEDDING_CARD_CATEGORIES,
  PRICE_BUCKETS,
  weddingDefaultFilters,
  applyWeddingFilters,
  sortWeddingProducts,
  facetCounts,
  matchesWeddingCardCategory,
  normalizeWeddingCollectionFilters,
  type BrowserProduct,
  type WeddingFilters,
  type WeddingCollectionType,
  type WeddingProductPage,
} from "@/lib/wedding-cards";

function validateOffset(offset: number) {
  // The PostgreSQL page function uses an integer offset.
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 2147483647 - COLLECTION_PAGE_SIZE
  )
    throw new Error("Provide a valid product offset.");
}

function forDisplay(product: CatalogProduct, margin: number) {
  return {
    ...product,
    price: applyMarginToPrice(product.price, margin),
    mrp: applyMarginToPrice(product.mrp, margin),
  };
}

function summary(product: CatalogProduct): CatalogProduct {
  return {
    ...product,
    imageCount: product.images.length,
    images: product.images.slice(0, 1),
    videos: [],
    description: "",
    dimensions: undefined,
  };
}

function browserProduct(product: CatalogProduct): BrowserProduct {
  return {
    slug: product.slug,
    designNo: product.itemCode || product.slug,
    name: product.name,
    printName: product.printName,
    price: product.price,
    mrp: product.mrp,
    image: product.images[0] || "",
    imageCount: product.images.length,
    subject: product.subject,
    itemCategory: product.itemCategory ?? "",
    itemGroup: product.itemGroup,
    hasPrice: product.hasPrice,
    minOrderQty: product.minOrderQty,
    updatedAt: product.updatedAt,
  };
}

function genericPriceBounds(
  price: string,
): Pick<StorefrontPageQuery, "p_price_min" | "p_price_max"> {
  switch (price) {
    case "under-100":
      return { p_price_min: 0, p_price_max: 100 };
    case "100-300":
      return { p_price_min: 100, p_price_max: 300 };
    case "300-1000":
      return { p_price_min: 300, p_price_max: 1000 };
    case "above-1000":
      return { p_price_min: 1000 };
    default:
      return {};
  }
}

const readCatalogBrowsePage = unstable_cache(
  async (
    options: Required<Pick<CatalogBrowseOptions, "offset" | "price" | "sort">> &
      Pick<CatalogBrowseOptions, "category" | "subjects">,
    margin: number,
  ): Promise<CatalogBrowsePage> => {
    const bounds = genericPriceBounds(options.price);
    const result = await readStorefrontPage({
      p_offset: options.offset,
      p_limit: COLLECTION_PAGE_SIZE,
      p_margin_percent: margin,
      p_sort:
        options.sort === "featured"
          ? options.category === "wedding"
            ? "recommended"
            : "catalogue"
          : options.sort === "discount"
            ? "discount"
            : `generic-${options.sort}`,
      ...(options.category === "wedding"
        ? { p_wedding_only: true }
        : { p_category: options.category }),
      p_subjects: options.subjects,
      ...bounds,
    });
    if (result !== null)
      return {
        products: result.products.map(mapCatalogRowToProduct).map(summary),
        total: result.total,
        nextOffset: result.nextOffset,
      };

    // Temporary compatibility until the migration is applied. Filtering still
    // runs on the entire scoped set before slicing; the client only gets a page.
    let source = await fetchErpProductsBase();
    if (options.category)
      source = source.filter(
        options.category === "wedding"
          ? isWeddingCardProduct
          : (p) => p.category === options.category,
      );
    if (options.category === "wedding")
      source = [...source].sort(compareWeddingCardProducts);
    if (options.subjects?.length)
      source = source.filter((p) =>
        options.subjects!.includes(p.subject.trim().toLowerCase()),
      );
    const filtered = source
      .map((base) => ({ base, shown: forDisplay(base, margin) }))
      .filter(
        ({ shown }) =>
          (bounds.p_price_min === undefined ||
            shown.price >= bounds.p_price_min) &&
          (bounds.p_price_max === undefined ||
            shown.price < bounds.p_price_max),
      );
    if (options.sort === "price-asc")
      filtered.sort((a, b) => a.shown.price - b.shown.price);
    if (options.sort === "price-desc")
      filtered.sort((a, b) => b.shown.price - a.shown.price);
    if (options.sort === "discount")
      filtered.sort(
        (a, b) => discountPercent(b.shown) - discountPercent(a.shown),
      );
    const end = options.offset + COLLECTION_PAGE_SIZE;
    return {
      products: filtered
        .slice(options.offset, end)
        .map(({ base }) => summary(base)),
      nextOffset: end < filtered.length ? end : null,
      total: filtered.length,
    };
  },
  ["catalogBrowsePage-v3-visibility", HIDDEN_STOREFRONT_SUBJECTS.join("|")],
  { revalidate: 60, tags: ["catalogue"] },
);

export async function fetchCatalogProductPage(
  options: CatalogBrowseOptions = {},
): Promise<CatalogBrowsePage> {
  const offset = options.offset ?? 0;
  validateOffset(offset);
  const reseller = await getActiveResellerFromCookies();
  const page = await readCatalogBrowsePage(
    {
      offset,
      price: CATALOG_PRICES.includes(options.price!) ? options.price! : "all",
      sort: CATALOG_SORTS.includes(options.sort!) ? options.sort! : "featured",
      ...(options.category ? { category: options.category } : {}),
      ...(options.subjects?.length
        ? {
            subjects: [
              ...new Set(options.subjects.map((s) => s.trim().toLowerCase())),
            ].sort(),
          }
        : {}),
    },
    reseller?.marginPercent ?? 0,
  );
  return {
    ...page,
    products: reseller
      ? page.products.map((p) => repriceProduct(p, reseller))
      : page.products,
  };
}

function weddingPriceBounds(
  price: WeddingFilters["price"],
): StorefrontPageQuery {
  switch (price) {
    case "under-25":
      return { p_priced_only: true, p_price_max: 25 };
    case "25-50":
      return { p_price_min: 25, p_price_max: 50 };
    case "50-100":
      return { p_price_min: 50, p_price_max: 100, p_price_max_inclusive: true };
    case "above-100":
      return { p_price_min: 100, p_price_min_exclusive: true };
    case "on-request":
      return { p_on_request: true };
    default:
      return {};
  }
}

const readWeddingCategoryCounts = unstable_cache(
  async (margin: number) => {
    // Use the same subject and pricing rules as the dedicated collections.
    // These counts stay independent of the visitor's selected category/price.
    const [all, ...categories] = await Promise.all([
      readStorefrontPage({
        p_limit: 1,
        p_wedding_collection: true,
        p_margin_percent: margin,
      }),
      ...WEDDING_CARD_CATEGORIES.map((category) =>
        readStorefrontPage({
          p_limit: 1,
          p_subjects: [...category.subjects],
          p_priced_only: category.requiresPrice,
          p_margin_percent: margin,
        }),
      ),
    ]);
    if (!all || categories.some((category) => category === null)) return null;
    return {
      total: all.total,
      types: WEDDING_CARD_CATEGORIES.map((category, index) => ({
        value: category.value,
        label: category.label,
        count: categories[index]!.total,
      })),
    };
  },
  ["weddingCategoryCounts-v2-visibility", HIDDEN_STOREFRONT_SUBJECTS.join("|")],
  { revalidate: 60, tags: ["catalogue"] },
);

const readWeddingBrowsePage = unstable_cache(
  async (
    collectionType: WeddingCollectionType | null,
    filters: WeddingFilters,
    offset: number,
    margin: number,
  ) => {
    const selectedType = collectionType ?? filters.type;
    const selectedCategory = WEDDING_CARD_CATEGORIES.find(
      (category) => category.value === selectedType,
    );
    const subjects: string[] | undefined = selectedCategory
      ? [...selectedCategory.subjects]
      : undefined;
    const itemCategory = collectionType === "boxes" ? "Wedding Box" : undefined;
    const pricedOnly = selectedCategory?.requiresPrice ?? false;
    const [result, categoryCounts] = await Promise.all([
      readStorefrontPage({
        p_offset: offset,
        p_limit: COLLECTION_PAGE_SIZE,
        p_sort: filters.sort,
        p_margin_percent: margin,
        p_subjects: subjects,
        p_item_category: itemCategory,
        p_wedding_collection: !collectionType,
        p_include_facets: true,
        ...weddingPriceBounds(filters.price),
        ...(pricedOnly ? { p_priced_only: true } : {}),
      }),
      collectionType
        ? Promise.resolve(null)
        : readWeddingCategoryCounts(margin),
    ]);
    if (result !== null && (collectionType || categoryCounts)) {
      if (!result.facets)
        throw new Error("Product catalogue returned no filter counts.");
      // Facets precede price filters in the RPC; Hindu's collection only
      // includes priced products, even when no price bucket is selected.
      const facetTotal =
        result.facets.total -
        (pricedOnly ? (result.facets.prices["on-request"] ?? 0) : 0);
      const prices = PRICE_BUCKETS.filter(
        (bucket) => !pricedOnly || bucket.value !== "on-request",
      )
        .map((bucket) => ({
          ...bucket,
          count: result.facets!.prices[bucket.value] ?? 0,
        }))
        .filter((b) => b.count > 0);
      return {
        products: result.products.map(mapCatalogRowToProduct),
        nextOffset: result.nextOffset,
        total: result.total,
        facets: {
          categoryTotal: categoryCounts?.total ?? facetTotal,
          total: facetTotal,
          types:
            categoryCounts?.types ??
            WEDDING_CARD_CATEGORIES.map((t) => ({
              value: t.value,
              label: t.label,
              count: subjects
                ? t.value === collectionType
                  ? facetTotal
                  : 0
                : 0,
            })),
          prices,
          showPrice: prices.length >= 2,
        },
      };
    }
    const source =
      collectionType && subjects
        ? (await fetchErpProductsBase())
            .filter((product) =>
              subjects.includes(product.subject.trim().toLowerCase()),
            )
            .sort(compareWeddingCardProducts)
        : itemCategory
          ? await fetchProductsByItemCategoryBase(itemCategory)
          : await fetchWeddingCardsWithCategoriesBase();
    const displayed = source.map((p) => browserProduct(forDisplay(p, margin)));
    const categoryProducts = selectedCategory
      ? displayed.filter((product) =>
          matchesWeddingCardCategory(product, selectedCategory.value),
        )
      : displayed;
    const matches = sortWeddingProducts(
      applyWeddingFilters(categoryProducts, filters),
      filters.sort,
    );
    const bySlug = new Map(source.map((p) => [p.slug, p]));
    const end = offset + COLLECTION_PAGE_SIZE;
    const facets = facetCounts(categoryProducts);
    if (!collectionType) {
      const categories = facetCounts(displayed);
      facets.categoryTotal = categories.categoryTotal;
      facets.types = categories.types;
    } else if (subjects) {
      // Subject membership need not match the item's ordinary ERP category.
      facets.types = facets.types.map((type) => ({
        ...type,
        count: type.value === collectionType ? categoryProducts.length : 0,
      }));
    }
    return {
      products: matches.slice(offset, end).map((p) => bySlug.get(p.slug)!),
      nextOffset: end < matches.length ? end : null,
      total: matches.length,
      facets,
    };
  },
  ["weddingBrowsePage-v9-visibility", HIDDEN_STOREFRONT_SUBJECTS.join("|")],
  { revalidate: 60, tags: ["catalogue"] },
);

export async function fetchWeddingProductPage({
  collectionType,
  filters = weddingDefaultFilters(collectionType),
  offset = 0,
}: {
  collectionType?: WeddingCollectionType;
  filters?: WeddingFilters;
  offset?: number;
} = {}): Promise<WeddingProductPage> {
  validateOffset(offset);
  const reseller = await getActiveResellerFromCookies();
  let page = await readWeddingBrowsePage(
    collectionType ?? null,
    normalizeWeddingCollectionFilters(filters, collectionType),
    offset,
    reseller?.marginPercent ?? 0,
  );
  // A saved URL can outlive the final page when products are unpublished.
  if (offset > 0 && offset >= page.total) {
    offset =
      Math.max(0, Math.ceil(page.total / COLLECTION_PAGE_SIZE) - 1) *
      COLLECTION_PAGE_SIZE;
    if (page.total > 0)
      page = await readWeddingBrowsePage(
        collectionType ?? null,
        normalizeWeddingCollectionFilters(filters, collectionType),
        offset,
        reseller?.marginPercent ?? 0,
      );
  }
  return {
    ...page,
    pageNumber: Math.floor(offset / COLLECTION_PAGE_SIZE) + 1,
    products: page.products.map((p) =>
      browserProduct(reseller ? repriceProduct(p, reseller) : p),
    ),
  };
}
