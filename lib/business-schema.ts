import {
  BRAND_NAME,
  BUSINESS_NAME,
  BUSINESS_IMAGE,
  BUSINESS_ADDRESS,
  CONTACT,
  DEFAULT_OG_IMAGE,
  SITE_NAME,
  getSiteUrl,
  siteUrl,
} from "@/lib/site-config";

// Reuse the same identity for the showroom, product seller and blog publisher.
export function getBusinessIdentity() {
  return {
    "@type": "LocalBusiness",
    "@id": `${getSiteUrl()}/#localbusiness`,
    name: BUSINESS_NAME,
    alternateName: [SITE_NAME, "Bharat Agency", BRAND_NAME],
    legalName: BRAND_NAME,
    url: getSiteUrl(),
    image: siteUrl(BUSINESS_IMAGE),
    logo: { "@type": "ImageObject", url: siteUrl(DEFAULT_OG_IMAGE), width: 2400, height: 2400 },
    telephone: CONTACT.displayPhone.replace(/\s/g, ""),
    email: CONTACT.email,
    address: { "@type": "PostalAddress", ...BUSINESS_ADDRESS },
    hasMap: CONTACT.googleMaps,
    sameAs: [CONTACT.googleMaps, CONTACT.instagram, CONTACT.youtube],
  };
}
