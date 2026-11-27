import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-config";

export default function robots(): MetadataRoute.Robots {
  const site = getSiteUrl();

  return {
    rules: [
      {
        // Applies to every search engine and AI crawler, including new agents.
        // Public pages and their assets are crawlable without a bot allowlist.
        userAgent: "*",
        allow: "/",
        // Keep customer-specific, transactional and administrative URLs out of
        // crawl discovery. These rules do not replace server authorization.
        disallow: [
          "/admin",
          "/api/",
          "/account",
          "/sign-in",
          "/sign-up",
          "/forgot-password",
          "/auth/",
          "/checkout",
          "/cart",
          "/wishlist",
          "/my-orders",
          "/track-order",
          "/search",
          "/erp-debug",
        ],
      },
    ],
    sitemap: `${site}/sitemap.xml`,
  };
}
