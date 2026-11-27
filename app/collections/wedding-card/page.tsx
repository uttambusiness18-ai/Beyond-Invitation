import type { Metadata } from "next";

import FilterableProductGrid from "@/components/FilterableProductGrid";
import { loadCatalogPage, catalogPagePath, type CatalogSearchParams } from "@/lib/catalog-page";
import { getProductPreviewImages } from "@/lib/seo-images";
import { DEFAULT_OG_IMAGE, SITE_NAME, siteUrl } from "@/lib/site-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUBJECTS = [
  "Wedding Card",
  "Hindu Wedding Card",
  "Muslim Wedding Card",
  "Christian Wedding Card",
];

const baseMetadata: Metadata = {
  title: "Wedding Cards – Beyond Invitation",
  description:
    "Browse all wedding card designs available at Beyond Invitation, including Hindu, Muslim, Christian and general wedding invitation cards.",
};

type PageProps = { searchParams: Promise<CatalogSearchParams> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { page, pageNumber } = await loadCatalogPage(await searchParams ?? {}, { subjects: SUBJECTS });
  const title = `Wedding Cards${pageNumber > 1 ? ` – Page ${pageNumber}` : ""}`;
  const canonical = catalogPagePath("/collections/wedding-card", pageNumber);
  const productImages = getProductPreviewImages(page.products);
  const images = productImages.length ? productImages : [{ url: siteUrl(DEFAULT_OG_IMAGE), alt: SITE_NAME }];
  return {
    ...baseMetadata,
    title,
    alternates: { canonical },
    openGraph: { title, description: baseMetadata.description ?? undefined, url: siteUrl(canonical), type: "website", images },
    twitter: { card: "summary_large_image", title, description: baseMetadata.description ?? undefined, images },
  };
}

export default async function WeddingCardPage({ searchParams }: PageProps) {
  const { page, pageNumber } = await loadCatalogPage(await searchParams ?? {}, { subjects: SUBJECTS });

  return (
    <main className="bg-white">
      <section className="border-b border-gold/20 bg-paper">
        <div className="mx-auto max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold uppercase tracking-[0.1em] text-gold-ink">
            Collection
          </p>

          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="font-serif text-3xl font-semibold text-maroon sm:text-4xl">
                Wedding Cards
              </h1>

              <p className="mt-2 max-w-2xl text-base leading-6 text-ink-mid">
                Browse all Hindu, Muslim, Christian and general wedding card
                designs.
              </p>
            </div>

            <p className="text-base font-semibold text-carbon">
              {page.total}{" "}
              {page.total === 1 ? "Product" : "Products"}
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1800px] px-4 py-7 sm:px-6 lg:px-8">
        {page.products.length === 0 ? (
          <div className="rounded-2xl border border-gold/20 bg-paper p-8 text-center">
            <h2 className="font-serif text-2xl font-semibold text-maroon">
              No wedding cards found
            </h2>

            <p className="mt-2 text-base text-ink-mid">
              This collection is being updated. Please check back soon or contact us for help finding your invitation.
            </p>
          </div>
        ) : (
          <FilterableProductGrid initialPage={page} initialPageNumber={pageNumber} paginationPath="/collections/wedding-card" scope={{ subjects: SUBJECTS }} />
        )}
      </section>
    </main>
  );
}
