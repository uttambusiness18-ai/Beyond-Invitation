import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SHAGUN_ENVELOPES_ENABLED } from "@/lib/storefront-availability";

import { fetchCatalogProductPage } from "@/lib/catalog-browse";
import CollectionPageShell from "@/components/CollectionPageShell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUBJECT = "Shagun Envelopes";

export const metadata: Metadata = SHAGUN_ENVELOPES_ENABLED ? {
  alternates: { canonical: "/collections/shagun-envelopes" },
  title: "Shagun Envelopes – Beyond Invitation",
  description:
    "Explore premium Shagun Envelopes from Beyond Invitation.",
} : { title: "Collection unavailable", robots: { index: false, follow: false } };

export default async function ShagunEnvelopesPage() {
  if (!SHAGUN_ENVELOPES_ENABLED) notFound();

  const page = await fetchCatalogProductPage({ subjects: [SUBJECT] });

  return (
    <CollectionPageShell
      eyebrow="Premium Collection"
      title="Shagun Envelopes"
      description="Premium envelopes for weddings, gifting, festive celebrations and special occasions."
      initialPage={page}
      scope={{ subjects: [SUBJECT] }}
      emptyTitle="No Shagun Envelopes found"
      emptyDescription="This collection is being updated. Please check back soon or contact us for help finding your invitation."
      accentIcon="✉"
      breadcrumb={[
        { label: "Home", href: "/" },
        { label: "Shagun Envelopes" },
      ]}
    />
  );
}
