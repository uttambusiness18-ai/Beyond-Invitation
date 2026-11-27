import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import {
  fetchErpProductBySlug,
  fetchRelatedErpProducts,
  type ErpProduct,
} from "@/lib/catalog";
import type { Product } from "@/types";
import { discountPercent } from "@/types";
import { formatProductName } from "@/lib/product-name";
import { getProductQuantityRules } from "@/lib/product-quantity";
import { BRAND } from "@/components/siteConfig";
import { BRAND_NAME, getSiteUrl } from "@/lib/site-config";
import { getPublicProductImageUrls } from "@/lib/seo-images";
import { getBusinessIdentity } from "@/lib/business-schema";
import { ProductGrid } from "@/components/ProductGrid";
import ProductGallery from "@/components/ProductGallery";
import ProductBuyBox from "@/components/ProductBuyBox";
import WishlistButton from "@/components/WishlistButton";
import ProductPrice from "@/components/ProductPrice";

interface PageProps {
  params: Promise<{ slug: string }>;
}

const NOT_ENTERED = "not yet entered";

type ProductLike = Product | ErpProduct;

export const dynamicParams = true;

/**
 * Product pages must render dynamically:
 * reseller pricing reads a per-visitor cookie, which cannot work with
 * static/ISR caching. Dynamic rendering also removes the need for
 * generateStaticParams (nothing is prerendered at build time).
 * Keep this route and its ancestors free of loading.tsx boundaries so the
 * required lookup can return HTTP 404/500 before a fallback starts streaming.
 * Recommendations may stream after the product has been resolved.
 */
export const dynamic = "force-dynamic";

function stripHtml(value?: string | null) {
  if (!value) return "";

  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, max = 160) {
  const clean = value.replace(/\s+/g, " ").trim();

  if (clean.length <= max) return clean;

  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function titleCase(value: string) {
  return value
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getSubject(product: ProductLike) {
  return "subject" in product && product.subject ? product.subject.trim() : "";
}

function getSku(product: ProductLike) {
  return "itemCode" in product && product.itemCode
    ? product.itemCode
    : product.slug;
}

function buildProductUrl(product: ProductLike) {
  return `${getSiteUrl()}/products/${product.slug}`;
}

function buildCollectionUrl(product: ProductLike) {
  return `${getSiteUrl()}/collections/${product.category}`;
}

function getProductImages(product: ProductLike) {
  return getPublicProductImageUrls(product.images);
}

function hasProductPrice(product: ProductLike) {
  return Number.isFinite(product.price) && product.price > 0;
}

function buildSeoTitle(product: ProductLike) {
  const categoryLabel = titleCase(product.category);
  const subject = getSubject(product);

  const parts = [
    formatProductName(product.name, product.printName),
    subject,
    `${categoryLabel} Invitation Card`,
    "Buy Online India",
  ].filter(Boolean);

  return truncate(`${parts.join(" | ")} - ${BRAND}`, 68);
}

function buildSeoDescription(product: ProductLike) {
  const categoryLabel = titleCase(product.category);
  const subject = getSubject(product);
  const cleanDescription = stripHtml(product.description);

  const fallback = `Buy ${formatProductName(product.name, product.printName)} online from ${BRAND}. Premium ${categoryLabel.toLowerCase()} invitation card${
    subject ? ` for ${subject} ceremonies` : ""
  } with customisation, quality material, and pan-India delivery.`;

  const priceLine =
    hasProductPrice(product)
      ? ` Price starts at ₹${product.price.toLocaleString("en-IN")}.`
      : "";

  return truncate(
    cleanDescription
      ? `${cleanDescription}${priceLine} Shop ${categoryLabel.toLowerCase()} invitation cards at ${BRAND}.`
      : fallback,
    160,
  );
}

function buildKeywords(product: ProductLike) {
  const categoryLabel = titleCase(product.category);
  const subject = getSubject(product);

  return [
    product.name,
    `${product.name} price`,
    `${product.name} online`,
    `${categoryLabel} invitation card`,
    `${categoryLabel} invitation card price`,
    `${categoryLabel} card online India`,
    subject ? `${subject} invitation card` : "",
    "Indian wedding invitation cards",
    "wedding cards Kolkata",
    "premium wedding cards",
    "custom invitation cards",
    "Beyond Invitation",
  ].filter(Boolean);
}

function productDetailValue(value: string | undefined | null) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : NOT_ENTERED;
}

async function resolveProduct(slug: string): Promise<ProductLike | null> {
  return fetchErpProductBySlug(slug);
}

async function resolveRelated(product: ProductLike): Promise<Product[]> {
  try {
    return await fetchRelatedErpProducts(product);
  } catch {
    return [];
  }
}

/** Recommendations must never hold back the product's gallery and buy box. */
async function RelatedProducts({ product }: { product: ProductLike }) {
  const related = await resolveRelated(product);
  if (!related.length) return null;

  return (
    <section className="mt-14 sm:mt-20">
      <JsonLdScript data={buildRelatedJsonLd(related)} />
      <div className="mb-8 flex flex-col items-start justify-between gap-5 sm:mb-10 sm:flex-row sm:items-end">
        <div>
          <h2 className="font-display text-[1.625rem] font-semibold text-carbon sm:text-[1.75rem] md:text-[2.125rem]">
            You May Also Like
          </h2>
        </div>
        <Link
          href={`/collections/${product.category}`}
          className="inline-flex shrink-0 items-center gap-2 border-b border-carbon pb-1 text-base font-semibold uppercase tracking-[0.1em] text-carbon"
        >
          View collection <span>→</span>
        </Link>
      </div>
      <ProductGrid products={related} />
    </section>
  );
}

function RelatedProductsLoading() {
  return (
    <section
      className="mt-14 sm:mt-20"
      role="status"
      aria-label="Loading related products"
    >
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="mb-8 h-8 w-56 rounded bg-paper" />
        <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="aspect-square rounded-xl bg-paper" />
          ))}
        </div>
      </div>
    </section>
  );
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await resolveProduct(slug);

  if (!product) notFound();

  const siteUrl = getSiteUrl();
  const productUrl = buildProductUrl(product);
  const images = getProductImages(product);
  const title = buildSeoTitle(product);
  const description = buildSeoDescription(product);
  const categoryLabel = titleCase(product.category);

  return {
    metadataBase: new URL(siteUrl),
    title,
    description,
    keywords: buildKeywords(product),
    alternates: {
      canonical: productUrl,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    openGraph: {
      type: "website",
      siteName: BRAND,
      locale: "en_IN",
      url: productUrl,
      title,
      description,
      images: images.map((image) => ({
        url: image,
        alt: `${formatProductName(product.name, product.printName)} - ${categoryLabel} invitation card by ${BRAND}`,
      })),
    },
    twitter: {
      card: images.length > 0 ? "summary_large_image" : "summary",
      title,
      description,
      images: images.slice(0, 1),
    },
    other: {
      "product:brand": BRAND_NAME,
      "product:retailer_item_id": getSku(product),
      ...(hasProductPrice(product)
        ? {
            "product:price:amount": String(product.price),
            "product:price:currency": "INR",
            "og:price:amount": String(product.price),
            "og:price:currency": "INR",
          }
        : {}),
    },
  };
}

const hasHtml = (s: string) => /<\/?[a-z][\s\S]*>/i.test(s);

function buildProductJsonLd(product: ProductLike) {
  // Quote-only products remain crawlable as WebPages. Product snippets require
  // a real offer or review; the catalogue has no customer-review data to emit.
  if (!hasProductPrice(product)) return null;

  const productUrl = buildProductUrl(product);
  const categoryLabel = titleCase(product.category);
  const subject = getSubject(product);
  const images = getProductImages(product);
  const description = stripHtml(product.description) || undefined;
  const discount = discountPercent(product);
  const quantityRules = getProductQuantityRules(product);

  const additionalProperty = [
    {
      "@type": "PropertyValue",
      name: "Minimum order quantity",
      value: quantityRules.minimum,
      unitText: "pieces",
    },
    {
      "@type": "PropertyValue",
      name: "Order quantity increment",
      value: quantityRules.step,
      unitText: "pieces",
    },
    subject
      ? {
          "@type": "PropertyValue",
          name: "Tradition",
          value: subject,
        }
      : null,
    product.customisation
      ? {
          "@type": "PropertyValue",
          name: "Customisation",
          value: stripHtml(product.customisation),
        }
      : null,
    product.material
      ? {
          "@type": "PropertyValue",
          name: "Material",
          value: stripHtml(product.material),
        }
      : null,
    product.includes
      ? {
          "@type": "PropertyValue",
          name: "Includes",
          value: stripHtml(product.includes),
        }
      : null,
    discount > 0
      ? {
          "@type": "PropertyValue",
          name: "Discount",
          value: `${discount}% OFF`,
        }
      : null,
  ].filter(Boolean);

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${productUrl}#product`,
    name: formatProductName(product.name, product.printName),
    url: productUrl,
    description,
    ...(images.length ? { image: images } : {}),
    sku: getSku(product),
    // mpn property removed
    brand: {
      "@type": "Brand",
      name: BRAND_NAME,
    },
    category: categoryLabel,
    material: product.material ? stripHtml(product.material) : undefined,
    additionalProperty,
    offers:
      hasProductPrice(product)
        ? {
            "@type": "Offer",
            "@id": `${productUrl}#offer`,
            url: productUrl,
            priceCurrency: "INR",
            price: product.price,
            description: "Price per piece, inclusive of taxes. Printing charges are additional.",
            eligibleQuantity: {
              "@type": "QuantitativeValue",
              minValue: quantityRules.minimum,
              unitCode: "C62",
              unitText: "pieces",
            },
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              priceCurrency: "INR",
              price: product.price,
              valueAddedTaxIncluded: true,
              referenceQuantity: {
                "@type": "QuantitativeValue",
                value: 1,
                unitCode: "C62",
                unitText: "piece",
              },
            },
            itemCondition: "https://schema.org/NewCondition",
            seller: getBusinessIdentity(),
          }
        : undefined,
  };
}

function buildBreadcrumbJsonLd(product: ProductLike) {
  const productUrl = buildProductUrl(product);
  const categoryLabel = titleCase(product.category);

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: getSiteUrl(),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: categoryLabel,
        item: buildCollectionUrl(product),
      },
      {
        "@type": "ListItem",
        position: 3,
        name: formatProductName(product.name, product.printName),
        item: productUrl,
      },
    ],
  };
}

function buildWebPageJsonLd(product: ProductLike) {
  const productUrl = buildProductUrl(product);
  const image = getProductImages(product)[0];

  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${productUrl}#webpage`,
    url: productUrl,
    name: buildSeoTitle(product),
    description: buildSeoDescription(product),
    isPartOf: {
      "@type": "WebSite",
      name: BRAND,
      url: getSiteUrl(),
    },
    ...(image ? { primaryImageOfPage: { "@type": "ImageObject", url: image } } : {}),
    ...(hasProductPrice(product) ? { mainEntity: { "@id": `${productUrl}#product` } } : {}),
  };
}

function buildFaqJsonLd(product: ProductLike) {
  const categoryLabel = titleCase(product.category).toLowerCase();

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `Is printing included with this ${categoryLabel} invitation card?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: "Printing charges are not included in the listed product price. Printing cost depends on impressions, printing type, foil work, and card requirements.",
        },
      },
      {
        "@type": "Question",
        name: "Can this product be customised?",
        acceptedAnswer: {
          "@type": "Answer",
          text: product.customisation
            ? stripHtml(product.customisation)
            : "Customisation details depend on the selected card. Contact Beyond Invitation for exact customisation options.",
        },
      },
      {
        "@type": "Question",
        name: "What is the return policy?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Returns are not accepted unless there is an error from Beyond Invitation.",
        },
      },
    ],
  };
}

function buildRelatedJsonLd(related: Product[]) {
  if (related.length === 0) return null;

  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Related invitation cards",
    itemListElement: related.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: buildProductUrl(item),
      name: item.name,
    })),
  };
}

function JsonLdScript({ data }: { data: Record<string, unknown> | null }) {
  if (!data) return null;

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}

function SpecRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <li className="grid gap-1 border-b border-gold/10 pb-2 last:border-b-0 min-[400px]:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] min-[400px]:gap-4">
      <span className="min-w-0 break-words text-ink-mid">{label}</span>
      <span className="min-w-0 break-words text-ink">{value}</span>
    </li>
  );
}

function formatMeasurement(value: number, unit: "cm" | "g") {
  return `${value.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })} ${unit}`;
}

function Accordion({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-2xl border border-gold/15 bg-white shadow-sm transition hover:border-gold/30">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-display text-lg font-semibold text-carbon marker:hidden sm:px-6 [&::-webkit-details-marker]:hidden">
        <span>{title}</span>

        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold/25 text-gold transition-transform duration-200 group-open:rotate-45">
          ＋
        </span>
      </summary>

      <div className="border-t border-gold/10 px-5 py-5 sm:px-6">
        {children}
      </div>
    </details>
  );
}

export default async function ProductDetailPage({ params }: PageProps) {
  const { slug } = await params;

  const product = await resolveProduct(slug);

  if (!product) notFound();

  const discount = discountPercent(product);
  const categoryLabel = product.category.replace(/-/g, " ");
  const subject = getSubject(product);
  const quantityRules = getProductQuantityRules(product);
  const dimensionRows = [
    {
      label: "Height",
      value: product.dimensions?.height,
      unit: "cm" as const,
    },
    {
      label: "Width",
      value: product.dimensions?.width,
      unit: "cm" as const,
    },
    {
      label: "Depth",
      value: product.dimensions?.depth,
      unit: "cm" as const,
    },
    {
      label: "Weight",
      value: product.dimensions?.weight,
      unit: "g" as const,
    },
    {
      label: "Height (Inside Card)",
      value: product.dimensions?.heightInsideCard,
      unit: "cm" as const,
    },
    {
      label: "Width (Inside Card)",
      value: product.dimensions?.widthInsideCard,
      unit: "cm" as const,
    },
  ].filter(
    (row): row is typeof row & { value: number } => row.value !== undefined,
  );

  const productJsonLd = buildProductJsonLd(product);
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(product);
  const webPageJsonLd = buildWebPageJsonLd(product);
  const faqJsonLd = buildFaqJsonLd(product);

  return (
    <>
      <JsonLdScript data={productJsonLd} />
      <JsonLdScript data={breadcrumbJsonLd} />
      <JsonLdScript data={webPageJsonLd} />
      <JsonLdScript data={faqJsonLd} />

      <div className="bg-white">
        <div className="mx-auto max-w-7xl overflow-x-clip px-4 py-4 sm:px-6 sm:py-8 lg:px-8 lg:py-10 xl:py-12">
          {/* Breadcrumb */}
          <nav className="mb-5 flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-ink-mid sm:mb-8">
            <Link
              href="/"
              className="shrink-0 whitespace-nowrap transition-colors hover:text-carbon"
            >
              Home
            </Link>

            <span className="shrink-0 text-gold">/</span>

            <Link
              href={`/collections/${product.category}`}
              className="min-w-0 break-words capitalize transition-colors hover:text-carbon"
            >
              {categoryLabel}
            </Link>

            <span className="shrink-0 text-gold">/</span>

            <span className="min-w-0 break-words text-ink">
              {formatProductName(product.name, product.printName)}
            </span>
          </nav>

          {/* Product layout */}
          <div className="grid min-w-0 gap-6 lg:flex lg:items-start lg:gap-4 xl:gap-6">
            {/* Left: Gallery */}
            <div className="min-w-0 lg:shrink">
              <ProductGallery
                key={product.slug}
                images={product.images || []}
                videos={product.videos}
                emoji={product.emoji}
                alt={formatProductName(product.name, product.printName)}
                badge={product.badge}
              />
            </div>

            {/* Right: Product information */}
            <div className="min-w-0 flex flex-col lg:min-w-[360px] lg:flex-1 xl:min-w-[400px]">
              {/* Product name + price */}
              <section className="min-w-0 rounded-2xl border border-gold/15 bg-white p-4 shadow-sm sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <h1 className="min-w-0 break-words font-display text-2xl font-semibold leading-[1.12] text-carbon sm:text-3xl lg:text-[2.25rem] 2xl:text-[2.5rem]">
                    {formatProductName(product.name, product.printName)}
                  </h1>
                  <WishlistButton
                    productSlug={product.slug}
                    className="shrink-0"
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-ink-mid">
                  <span className="tracking-[0.1em] text-gold">★★★★★</span>
                </div>

                <div className="mt-6 flex flex-wrap items-end gap-3">
                  <ProductPrice
                    price={product.price}
                    mrp={product.mrp}
                    priceClassName="font-display text-[1.875rem] font-bold leading-none text-carbon sm:text-[2.125rem]"
                    oldPriceClassName="pb-0.5 text-lg text-ink-mid"
                  />

                  {discount > 0 && (
                    <span className="mb-0.5 rounded-md bg-[#E8F7EE] px-2.5 py-1 text-sm font-semibold text-emerald-800">
                      {discount}% OFF
                    </span>
                  )}
                </div>

                <p className="mt-2 text-sm text-ink-mid">
                  Inclusive of all taxes
                </p>

                <p className="mt-3 text-sm leading-relaxed text-ink-mid">
                  Product code: {getSku(product)}. Minimum order: {quantityRules.minimum} pieces,
                  in increments of {quantityRules.step}.
                </p>

                <div className="mt-7">
                  <ProductBuyBox product={product} />
                </div>
              </section>

              {/* Description */}
              <section className="mt-5 min-w-0 rounded-2xl border border-gold/15 bg-white p-4 shadow-sm sm:p-6">
                <h2 className="font-display text-lg font-semibold text-carbon">
                  Description
                </h2>

                <div className="mt-4 text-base leading-relaxed text-ink-mid">
                  {product.description ? (
                    hasHtml(product.description) ? (
                      <div
                        className="max-w-full space-y-3 overflow-hidden break-words [&_img]:max-w-full [&_li]:ml-4 [&_li]:list-disc [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto"
                        dangerouslySetInnerHTML={{
                          __html: product.description,
                        }}
                      />
                    ) : (
                      <p className="whitespace-pre-line break-words">
                        {product.description}
                      </p>
                    )
                  ) : (
                    <p>{NOT_ENTERED}</p>
                  )}
                </div>
              </section>

              {/* Collapsible sections */}
              <div className="mt-5 min-w-0 space-y-3">
                <Accordion title="Printing">
                  <p className="text-base leading-relaxed text-ink-mid">
                    Printing charges is not included in the above price. The
                    printing cost is dependent on variables like number of
                    impressions, type of printing - Screen / UV / Offset, gold
                    foil impression optional &amp; nature of cards. Please
                    contact our customer care to know the printing cost of the
                    card selected by you.
                  </p>
                </Accordion>

                <Accordion title="Dimensions">
                  {dimensionRows.length > 0 ? (
                    <ul className="space-y-2 text-base text-ink-mid">
                      {dimensionRows.map((row) => (
                        <SpecRow
                          key={row.label}
                          label={row.label}
                          value={formatMeasurement(row.value, row.unit)}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-base text-ink-mid">Coming soon</p>
                  )}
                </Accordion>

                <Accordion title="Return Policy">
                  <p className="text-base leading-relaxed text-ink-mid">
                    We hope you love your order! However, we do not accept
                    returns unless there is an error from our end.
                  </p>
                </Accordion>

                <Accordion title="Product Details">
                  <ul className="space-y-2 text-base text-ink-mid">
                    <SpecRow
                      label="Category"
                      value={
                        <span className="capitalize">{categoryLabel}</span>
                      }
                    />

                    {subject && <SpecRow label="Tradition" value={subject} />}

                    <SpecRow
                      label="Customisation"
                      value={productDetailValue(product.customisation)}
                    />

                    <SpecRow
                      label="Material"
                      value={productDetailValue(product.material)}
                    />

                    {product.includes && (
                      <SpecRow label="Includes" value={stripHtml(product.includes)} />
                    )}
                  </ul>

                  <p className="mt-4 text-base leading-relaxed text-ink-mid">
                    <span className="font-medium text-carbon">Phone - </span>

                    <a
                      href="tel:+917044815488"
                      className="font-semibold text-carbon underline decoration-gold/40 underline-offset-4 transition hover:text-carbon-dark"
                    >
                      +91 7044815488
                    </a>
                  </p>
                </Accordion>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-[1800px] px-4 pb-12 sm:px-6 lg:px-8">
          {/* Related products use the wider collection grid. */}
          <Suspense fallback={<RelatedProductsLoading />}>
            <RelatedProducts product={product} />
          </Suspense>
        </div>
      </div>
    </>
  );
}
