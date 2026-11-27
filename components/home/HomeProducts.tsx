import { fetchErpProductsBySlugs, fetchErpProductPage } from "@/lib/catalog";
import { fetchItemCategoryProductPage } from "@/lib/catalog-item-category";
import { catalogueErrorMessage } from "@/lib/catalog-errors";
import { PRODUCTS_PER_PAGE } from "@/lib/product-page";
import { getSiteUrl } from "@/lib/site-config";
import { getPublicProductImageUrls } from "@/lib/seo-images";
import { formatProductName } from "@/lib/product-name";
import { ProductSection } from "@/components/ProductGrid";
import { FeatureStrip, SaleCollection } from "@/components/Sections";
import JsonLd from "@/components/seo/JsonLd";

const TRENDY_PRODUCT_SLUGS = [
  "1308", "1320", "1901", "1902", "1903", "1904", "1905", "1906",
];

function ProductSectionSkeleton({
  label,
  title,
  count = PRODUCTS_PER_PAGE,
}: {
  label: string;
  title: string;
  count?: number;
}) {
  return (
    <section className="bg-white py-14 md:py-20">
      <div className="mx-auto max-w-[1800px] px-4 sm:px-6 lg:px-8">
        <div className="mb-8 md:mb-10">
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.1em] text-gold-ink">
            {label}
          </p>
          <h2 className="font-serif text-3xl font-semibold text-ink md:text-4xl">
            {title}
          </h2>
        </div>
        <div aria-hidden="true" className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-8 motion-safe:animate-pulse sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: count }, (_, index) => (
            <div key={index} className="min-w-0">
              <div className="aspect-square bg-neutral-100" />
              <div className="space-y-2.5 pt-4">
                <div className="h-4 w-4/5 rounded bg-neutral-100" />
                <div className="h-5 w-1/2 rounded bg-neutral-100" />
              </div>
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="mx-auto mt-8 h-12 w-40 rounded-full bg-stone-100 motion-safe:animate-pulse" />
      </div>
    </section>
  );
}

/** Reserve each collection's grid while its products load. */
export function HomeProductsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading products">
      <p role="status" className="sr-only">Loading products</p>
      <ProductSectionSkeleton label="Limited time offer" title="Sale Collection" />
      <ProductSectionSkeleton
        label="Fresh from our catalogue"
        title="Trendy Collection"
        count={TRENDY_PRODUCT_SLUGS.length}
      />
      <FeatureStrip />
      <ProductSectionSkeleton label="Exclusive & elegant" title="Premium Invitations" />
    </div>
  );
}

function CollectionUnavailable({ title }: { title: string }) {
  return (
    <section className="mx-auto max-w-[1800px] px-4 py-16 sm:px-6 lg:px-8">
      <div role="status" className="rounded-3xl border border-gold/20 bg-white p-6 text-ink">
        <h2 className="font-serif text-3xl">{title}</h2>
        <p className="mt-3 text-base text-ink-mid">This collection is temporarily unavailable. Please try again shortly.</p>
        {/* A document reload retries failed server reads on this same route. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="mt-4 inline-block text-base font-semibold text-maroon underline underline-offset-4">Try again</a>
      </div>
    </section>
  );
}

/** Sale uses a priced page; Trendy is curated; Premium features wedding boxes. */
export default async function HomeProducts({ description }: { description: string }) {
  const results = await Promise.allSettled([
    fetchItemCategoryProductPage("Wedding Box"),
    fetchErpProductPage(0, true),
    fetchErpProductsBySlugs(TRENDY_PRODUCT_SLUGS),
  ]);
  const labels = ["Premium Invitations", "Sale Collection", "Trendy Collection"];
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.warn(`Homepage ${labels[index]} unavailable:`, catalogueErrorMessage(result.reason));
    }
  });
  const weddingBoxesPage = results[0].status === "fulfilled" ? results[0].value : null;
  const pricedPage = results[1].status === "fulfilled" ? results[1].value : null;
  const trendyProducts = results[2].status === "fulfilled" ? results[2].value : null;

  if (!weddingBoxesPage && !pricedPage && !trendyProducts) {
    return (
      <>
        <CollectionUnavailable title="Products could not be loaded" />
        <FeatureStrip />
      </>
    );
  }

  const featuredProducts = Array.from(
    new Map([...(pricedPage?.products ?? []), ...(trendyProducts ?? []), ...(weddingBoxesPage?.products ?? [])].map((product) => [product.slug, product])).values(),
  );
  const siteUrl = getSiteUrl();
  const productListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Featured wedding cards and invitation stationery",
    itemListElement: featuredProducts.map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: formatProductName(product.name, product.printName),
      description: product.description || description,
      url: `${siteUrl}/products/${product.slug}`,
      image: getPublicProductImageUrls(product.images)[0],
    })),
  };

  return (
    <>
      {featuredProducts.length > 0 ? <JsonLd data={productListJsonLd} /> : null}
      {pricedPage ? <SaleCollection products={pricedPage.products} nextOffset={pricedPage.nextOffset} total={pricedPage.total} /> : <CollectionUnavailable title="Sale Collection" />}
      {trendyProducts ? <ProductSection
        label="Fresh from our catalogue"
        title="Trendy Collection"
        products={trendyProducts}
        nextOffset={null}
        viewAllHref="/catalog"
        viewAllText="View All Products"
      /> : <CollectionUnavailable title="Trendy Collection" />}
      <FeatureStrip />
      {weddingBoxesPage ? <ProductSection
        label="Exclusive & elegant"
        title="Premium Invitations"
        products={weddingBoxesPage.products}
        nextOffset={weddingBoxesPage.nextOffset}
        total={weddingBoxesPage.total}
        collection="wedding-boxes"
        viewAllHref="/wedding-boxes"
        viewAllText="View All Wedding Boxes"
      /> : <CollectionUnavailable title="Premium Invitations" />}
    </>
  );
}
