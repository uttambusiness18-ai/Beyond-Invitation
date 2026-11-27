import type { Metadata } from "next";

import { loadWeddingCollectionPage } from "@/lib/wedding-collection-page";
import type { WeddingSearchParams } from "@/lib/wedding-cards";
import WeddingCardsCollection from "@/components/wedding-cards/WeddingCardsCollection";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const pageMetadata: Metadata = {
  title: "Muslim Wedding Cards – Beyond Invitation",
  description:
    "A curated collection of Muslim wedding invitation cards — elegant layouts, refined details and graceful designs for nikah and wedding celebrations.",
};

type PageProps = { searchParams: Promise<WeddingSearchParams> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { metadata } = await loadWeddingCollectionPage("muslim", await searchParams);
  return { ...pageMetadata, ...metadata };
}

export default async function MuslimWeddingCardPage({ searchParams }: PageProps) {
  const { initialPage, initialFilters } = await loadWeddingCollectionPage(
    "muslim", await searchParams,
  );

  return (
    <WeddingCardsCollection
      title="Muslim Wedding Cards"
      collectionType="muslim"
      initialPage={initialPage}
      initialFilters={initialFilters}
      emptyTitle="No Muslim wedding cards just yet"
    />
  );
}
