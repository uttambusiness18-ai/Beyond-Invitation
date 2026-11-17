import type { Metadata } from "next";
import { ContactMotion } from "@/components/contact/ContactMotion";
import ContactChannels from "@/components/contact/ContactChannels";
import EnquiryForm from "@/components/contact/EnquiryForm";
import { Card } from "@/components/ui/card";
import { fetchErpProductBySlug } from "@/lib/catalog";
import type { EnquiryProduct } from "@/lib/contact";
import { siteUrl } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Contact Us | Beyond Invitation",
  description:
    "Get in touch with Beyond Invitation for wedding invitations, shagun envelopes, and celebration stationery.",
  alternates: { canonical: "/contact" },
  openGraph: { url: siteUrl("/contact") },
};

export default async function ContactPage({ searchParams }: {
  searchParams: Promise<{ product?: string | string[] }>;
}) {
  const params = await searchParams;
  const slug = typeof params.product === "string" ? params.product.trim() : "";
  let enquiryProduct: EnquiryProduct | null = null;

  if (slug) {
    try {
      const product = await fetchErpProductBySlug(slug);
      if (product) {
        enquiryProduct = {
          slug: product.slug,
          designNo: product.itemCode || product.slug,
          printName: product.printName,
          name: product.name,
          image: product.images[0] || null,
          subject: product.subject,
          minOrderQty: product.minOrderQty,
        };
      }
    } catch {
      // A catalogue outage must never prevent a customer from contacting us.
    }
  }

  return (
    <ContactMotion>
      <section className="relative bg-paper/60 px-4 py-10 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
        <div className="pointer-events-none absolute -right-40 top-10 h-96 w-96 rounded-full bg-[#dcb162]/10 blur-3xl" />
        <div className="relative mx-auto grid min-w-0 max-w-7xl gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
          <div className="min-w-0">
            <p data-motion="eyebrow" className="text-sm font-bold uppercase tracking-[0.1em] text-ink-mid">Contact</p>
            <h1 className="mt-4 text-[2.125rem] font-normal leading-[1.08] tracking-[-0.035em] text-[#50101f] lg:text-[3.25rem]">
              {"Tell us about your celebration.".split(" ").map((word, index) => (
                <span key={word}>{index > 0 ? " " : ""}<span data-motion="heading-word" className="inline-block">{word}</span></span>
              ))}
            </h1>
            <p data-motion="intro" className="mt-5 text-base leading-8 text-ink-mid">Wedding cards, shagun envelopes or a custom design — send the details and our team will call or message you back.</p>
            <div data-header-rule className="my-8 h-px bg-gradient-to-r from-gold via-gold/40 to-transparent" />
            <ContactChannels enquiryProduct={enquiryProduct} />
          </div>
          <Card data-motion="form-card" className="order-first min-w-0 gap-0 rounded-3xl border border-gold/25 bg-white p-0 shadow-[0_2px_8px_-4px_rgba(80,16,31,0.08),0_24px_64px_-32px_rgba(80,16,31,0.2)] lg:order-none lg:self-start">
            <EnquiryForm key={enquiryProduct?.slug || "general"} enquiryProduct={enquiryProduct} />
          </Card>
        </div>
      </section>
    </ContactMotion>
  );
}
