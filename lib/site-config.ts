import { SHAGUN_ENVELOPES_ENABLED } from "@/lib/storefront-availability";

const DEFAULT_SITE_URL = "https://www.beyondinvitation.co.in";

function normalizeUrl(value?: string | null) {
  const clean = (value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\/$/, "");

  if (!clean) return "";

  if (/^[a-z][a-z\d+.-]*:/i.test(clean) && !/^https?:\/\//i.test(clean)) return "";

  if (/^https?:\/\//i.test(clean)) {
    return clean;
  }

  return `https://${clean}`;
}

export const SITE_NAME = "Beyond Invitation";
export const BUSINESS_NAME = "Beyond Invitation (Bharat Agency)";
export const BRAND_NAME = "Bharat Agency Wedding Cards Pvt. Ltd.";
export const DEFAULT_OG_IMAGE = "/logo.png";
export const BUSINESS_IMAGE = "/visit-us/bharat-agency-storefront.jpg";

export const CONTACT = {
  whatsappNumber: "917044815488",
  displayPhone: "+91 70448 15488",
  landline: "033-22428918",
  email: "contact@khushionline.net",
  instagram: "https://www.instagram.com/beyond_invitationofficial/",
  instagramHandle: "@beyond_invitationofficial",
  youtube: "https://www.youtube.com/@BeyondInvitation",
  googleMaps: "https://share.google/OGSfid2VgyLRllfAo",
} as const;

export const SITE_DESCRIPTION = SHAGUN_ENVELOPES_ENABLED
  ? "Shop premium wedding cards, wedding invitation cards, shagun envelopes, shagun boxes, and invitation stationery from Beyond Invitation in Kolkata."
  : "Shop premium wedding cards, wedding invitation cards, shagun boxes, and invitation stationery from Beyond Invitation in Kolkata.";

export const PRIMARY_KEYWORDS = [
  "wedding cards",
  "wedding card",
  "wedding cards Kolkata",
  "wedding invitation cards",
  "wedding invitation cards Kolkata",
  "wedding cards online India",
  "Indian wedding cards",
  "Hindu wedding cards",
  "Muslim wedding cards",
  "Christian wedding cards",
  "premium wedding cards",
  "invitation printing Kolkata",
  ...(SHAGUN_ENVELOPES_ENABLED ? ["shagun envelopes"] : []),
  "shagun boxes",
  "Beyond Invitation",
];

export const BUSINESS_ADDRESS = {
  streetAddress: "8, Jackson Lane, Canning Street",
  addressLocality: "Kolkata",
  addressRegion: "West Bengal",
  postalCode: "700001",
  addressCountry: "IN",
};

export const BUSINESS_ADDRESS_TEXT = `${BUSINESS_ADDRESS.streetAddress}, ${BUSINESS_ADDRESS.addressLocality} - ${BUSINESS_ADDRESS.postalCode}`;

export function getSiteUrl(): string {
  // Deployment/preview hostnames must never become the canonical storefront.
  // Only an explicit public site setting can override the business domain.
  const configured = normalizeUrl(process.env.NEXT_PUBLIC_SITE_URL);
  if (!configured) return DEFAULT_SITE_URL;
  try {
    const url = new URL(configured);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.origin
      : DEFAULT_SITE_URL;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

export function siteUrl(path = "/") {
  const base = getSiteUrl();

  if (!path || path === "/") return base;

  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
