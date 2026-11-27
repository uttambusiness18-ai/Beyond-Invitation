import Link from "next/link";
import type { Metadata } from "next";
import { loadCatalogPage, catalogPagePath, type CatalogSearchParams } from "@/lib/catalog-page";
import { DEFAULT_OG_IMAGE, SITE_NAME, getSiteUrl, siteUrl } from "@/lib/site-config";
import { getProductPreviewImages } from "@/lib/seo-images";
import { COLLECTION_PAGE_SIZE } from "@/lib/catalog-browse-options";
import { formatProductName } from "@/lib/product-name";
import PaginatedProductGrid from "@/components/PaginatedProductGrid";
import JsonLd from "@/components/seo/JsonLd";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<CatalogSearchParams> };
const description = "Explore invitation cards, wedding boxes and celebration stationery from Beyond Invitation.";

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { page, pageNumber } = await loadCatalogPage(await searchParams);
  const title = `Product Catalogue${pageNumber > 1 ? ` – Page ${pageNumber}` : ""}`;
  const canonical = catalogPagePath("/catalog", pageNumber);
  const productImages = getProductPreviewImages(page.products);
  const images = productImages.length ? productImages : [{ url: siteUrl(DEFAULT_OG_IMAGE), alt: SITE_NAME }];
  return {
    title, description,
    alternates: { canonical },
    openGraph: { title, description, url: siteUrl(canonical), type: "website", images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

export default async function CatalogPage({ searchParams }: PageProps) {
  // Propagate catalogue outages instead of serving an indexable empty catalogue.
  const { page, pageNumber } = await loadCatalogPage(await searchParams);
  const canonical = siteUrl(catalogPagePath("/catalog", pageNumber));

  return (
    <main className="min-h-screen overflow-x-clip bg-white">
      <JsonLd data={{
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        url: canonical,
        name: "Product Catalogue",
        description,
        isPartOf: { "@id": `${getSiteUrl()}/#website` },
        mainEntity: {
          "@type": "ItemList",
          itemListElement: page.products.map((product, index) => ({
            "@type": "ListItem", position: (pageNumber - 1) * COLLECTION_PAGE_SIZE + index + 1,
            name: formatProductName(product.name, product.printName), url: siteUrl(`/products/${encodeURIComponent(product.slug)}`),
          })),
        },
      }} />
      <section className="mx-auto max-w-[1800px] px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-10 text-center">
          <p className="mb-3 text-base font-semibold uppercase tracking-[0.1em] text-gold-ink">
            Explore the collection
          </p>
          <h1 className="font-display text-4xl font-semibold text-carbon md:text-5xl">
            Product Catalogue
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-6 text-ink-mid">
            Discover invitations and celebration stationery for your special occasion.
          </p>
        </div>
        {page.products.length === 0 ? (
          <div className="mx-auto max-w-3xl rounded-2xl border border-gold/30 bg-white p-8 text-center shadow-sm">
            <h2 className="font-display text-2xl font-semibold text-carbon">No products found</h2>
            <p className="mt-3 text-base leading-6 text-ink-mid">Our collection is being updated. Please check back soon.</p>
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-col justify-between gap-3 rounded-2xl border border-gold/20 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center">
              <p className="text-base font-semibold text-carbon">{page.total} products found</p>
              <Link href="/" className="inline-flex rounded-full border border-carbon px-5 py-2 text-base font-semibold text-carbon transition hover:bg-carbon hover:text-white">
                Back to Home
              </Link>
            </div>
            <PaginatedProductGrid initialPage={page} initialPageNumber={pageNumber} paginationPath="/catalog" />
          </>
        )}
      </section>
    </main>
  );
}
