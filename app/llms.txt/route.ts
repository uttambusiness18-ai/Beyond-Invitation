import {
  BRAND_NAME,
  BUSINESS_NAME,
  BUSINESS_ADDRESS_TEXT,
  BUSINESS_IMAGE,
  CONTACT,
  DEFAULT_OG_IMAGE,
  SITE_DESCRIPTION,
  getSiteUrl,
} from "@/lib/site-config";
import { SHAGUN_ENVELOPES_ENABLED } from "@/lib/storefront-availability";

// An optional plain-text directory for tools that use llms.txt. Normal HTML,
// robots.txt and the XML sitemap remain the primary discovery mechanisms.
export function GET() {
  const site = getSiteUrl();
  const link = (label: string, path: string, description: string) =>
    `- [${label}](${site}${path}): ${description}`;

  const body = [
    `# ${BUSINESS_NAME}`,
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    `${BUSINESS_NAME} is the storefront of ${BRAND_NAME}. Showroom: ${BUSINESS_ADDRESS_TEXT}.`,
    `Phone / WhatsApp: ${CONTACT.displayPhone}. Landline: ${CONTACT.landline}. Email: ${CONTACT.email}.`,
    `- [Google Maps](${CONTACT.googleMaps}): Showroom and business profile.`,
    `- [Instagram](${CONTACT.instagram}): Official Instagram profile.`,
    `- [YouTube](${CONTACT.youtube}): Official YouTube channel.`,
    "",
    "## Official business images",
    "",
    link("Business logo", DEFAULT_OG_IMAGE, `The ${BUSINESS_NAME} brand logo.`),
    link("Showroom photograph", BUSINESS_IMAGE, `The ${BUSINESS_NAME} storefront in Kolkata.`),
    "",
    "## Products and collections",
    "",
    link("Product catalogue", "/catalog", "Browse the public catalogue of invitations and celebration stationery."),
    link("Wedding cards", "/wedding-cards", "Browse wedding invitation designs and available product details."),
    link("Wedding card collection", "/collections/wedding-card", "All wedding card styles."),
    link("Bengali wedding cards", "/collections/wedding-card-bengali", "Bengali wedding invitations."),
    link("Hindu wedding cards", "/collections/wedding-card-hindu", "Hindu wedding invitations."),
    link("Muslim wedding cards", "/collections/wedding-card-muslim", "Muslim wedding invitations."),
    link("Christian wedding cards", "/collections/wedding-card-christian", "Christian wedding invitations."),
    link("Wedding boxes", "/wedding-boxes", "Wedding invitation and celebration boxes."),
    ...(SHAGUN_ENVELOPES_ENABLED
      ? [link("Shagun envelopes", "/collections/shagun-envelopes", "Gift envelopes for weddings and celebrations.")]
      : []),
    "",
    "Individual product URLs are listed in the XML sitemap. Product pages provide the current public description, images, price when available and ordering information. Prices are in Indian rupees (INR); consult each product page for its current details.",
    "",
    "## Business and customer information",
    "",
    link("About", "/about", "Business background."),
    link("Visit the showroom", "/visit-us", "Location and visiting information."),
    link("Contact", "/contact", "Contact channels for product and order enquiries."),
    link("Frequently asked questions", "/faq", "Answers about invitations and ordering."),
    link("Blog", "/blog", "Invitation guides and articles."),
    link("Shipping policy", "/shipping-policy", "Shipping terms."),
    link("Refund policy", "/refund-policy", "Return and refund terms."),
    link("Terms and conditions", "/terms-and-conditions", "Purchase and website terms."),
    link("Privacy policy", "/privacy-policy", "Personal data information."),
    "",
    "## Discovery",
    "",
    link("XML sitemap", "/sitemap.xml", "Canonical public pages, product URLs and product images."),
    link("Crawler policy", "/robots.txt", "Public storefront pages are open to all crawler user agents; private account, order, checkout, administrative and API routes are excluded."),
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
