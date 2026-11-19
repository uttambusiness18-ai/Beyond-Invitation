import type { Metadata } from "next";
import FaqBrowser from "@/components/faq/FaqBrowser";
import styles from "@/components/faq/FaqPage.module.css";
import JsonLd from "@/components/seo/JsonLd";
import { faqItems } from "@/lib/faq";
import { SITE_NAME, siteUrl } from "@/lib/site-config";

const title = "Frequently Asked Questions";
const description =
  "Find answers about wedding invitations, printing, minimum quantities, payments, shipping and order help at Beyond Invitation.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/faq" },
  openGraph: {
    title: `${title} | ${SITE_NAME}`,
    description,
    url: siteUrl("/faq"),
    type: "website",
  },
};

export default function FaqPage() {
  return (
    <div className={styles.page}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          "@id": `${siteUrl("/faq")}#faq`,
          url: siteUrl("/faq"),
          name: `${title} | ${SITE_NAME}`,
          mainEntity: faqItems.map((item) => ({
            "@type": "Question",
            name: item.question,
            acceptedAnswer: { "@type": "Answer", text: item.answer },
          })),
        }}
      />
      <FaqBrowser />
    </div>
  );
}
