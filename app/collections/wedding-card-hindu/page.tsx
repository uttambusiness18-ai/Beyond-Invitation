import type { Metadata } from "next";

import { loadWeddingCollectionPage } from "@/lib/wedding-collection-page";
import type { WeddingSearchParams } from "@/lib/wedding-cards";
import WeddingCardsCollection from "@/components/wedding-cards/WeddingCardsCollection";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const pageMetadata: Metadata = {
  title: "Hindu Wedding Cards – Beyond Invitation",
  description:
    "A curated collection of Hindu wedding invitation cards — sacred motifs, auspicious hues and timeless craftsmanship for the big day.",
};

type PageProps = { searchParams: Promise<WeddingSearchParams> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { metadata } = await loadWeddingCollectionPage("hindu", await searchParams);
  return { ...pageMetadata, ...metadata };
}

export default async function HinduWeddingCardPage({
  searchParams,
}: PageProps) {
  const { initialPage, initialFilters } = await loadWeddingCollectionPage(
    "hindu", await searchParams,
  );

  return (
    <WeddingCardsCollection
      title="Hindu Wedding Cards"
      collectionType="hindu"
      initialPage={initialPage}
      initialFilters={initialFilters}
      emptyTitle="No Hindu wedding cards with prices yet"
    />
  );
}
