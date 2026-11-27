import type { Metadata } from "next";

import { loadWeddingCollectionPage } from "@/lib/wedding-collection-page";
import type { WeddingSearchParams } from "@/lib/wedding-cards";
import WeddingCardsCollection from "@/components/wedding-cards/WeddingCardsCollection";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const pageMetadata: Metadata = {
  title: "Christian Wedding Cards – Beyond Invitation",
  description:
    "A curated collection of Christian wedding invitation cards — elegant church wedding invites, graceful typography and timeless printed designs.",
};

type PageProps = { searchParams: Promise<WeddingSearchParams> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { metadata } = await loadWeddingCollectionPage("christian", await searchParams);
  return { ...pageMetadata, ...metadata };
}

export default async function ChristianWeddingCardPage({ searchParams }: PageProps) {
  const { initialPage, initialFilters } = await loadWeddingCollectionPage(
    "christian", await searchParams,
  );

  return (
    <WeddingCardsCollection
      title="Christian Wedding Cards"
      collectionType="christian"
      initialPage={initialPage}
      initialFilters={initialFilters}
      emptyTitle="No Christian wedding cards just yet"
    />
  );
}
