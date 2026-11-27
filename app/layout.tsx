import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Assistant, Inter } from "next/font/google";

import "./globals.css";

import { SITE_NAME } from "@/components/siteConfig";
import { getSiteUrl, DEFAULT_OG_IMAGE } from "@/lib/site-config";
import { SHAGUN_ENVELOPES_ENABLED } from "@/lib/storefront-availability";
import GoogleTagHead from "@/components/GoogleTagHead";

import StorefrontShell from "@/components/StorefrontShell";
import ChatWidgetLoader from "@/components/chatbot/ChatWidgetLoader";
import { cn } from "@/lib/utils";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

const assistant = Assistant({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-assistant",
  display: "swap",
});

const siteUrl = getSiteUrl();
const description = SHAGUN_ENVELOPES_ENABLED
  ? "Discover premium wedding invitation cards, shagun envelopes, boxes, and celebration stationery by Beyond Invitation."
  : "Discover premium wedding invitation cards, boxes, and celebration stationery by Beyond Invitation.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),

  title: {
    default: `${SITE_NAME} – Wedding Invitation Cards`,
    template: `%s | ${SITE_NAME}`,
  },

  description,

  applicationName: SITE_NAME,

  authors: [
    {
      name: "Bharat Agency Wedding Cards Pvt. Ltd.",
    },
  ],

  creator: SITE_NAME,
  publisher: SITE_NAME,

  keywords: [
    "wedding invitation cards",
    "wedding cards Kolkata",
    ...(SHAGUN_ENVELOPES_ENABLED ? ["shagun envelopes"] : []),
  ],

  openGraph: {
    title: SITE_NAME,

    description,

    url: siteUrl,
    siteName: SITE_NAME,
    type: "website",

    images: [
      {
        url: `${siteUrl}${DEFAULT_OG_IMAGE}`,
        width: 1200,
        height: 630,
        alt: SITE_NAME,
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,

    description,
  },

  robots: {
    index: true,
    follow: true,
    "max-image-preview": "large",
    "max-snippet": -1,
    "max-video-preview": -1,
  },

  formatDetection: {
    telephone: false,
  },

  icons: {
    icon: "/logo.ico",
  },
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className={cn("font-sans", inter.variable, assistant.variable)}>
      <GoogleTagHead />
      {/* Suppress body-only attribute warnings from extensions such as ColorZilla. */}
      <body
        suppressHydrationWarning
        className="min-h-screen bg-white font-body text-carbon antialiased"
      >
        <StorefrontShell>{children}</StorefrontShell>
        <ChatWidgetLoader />
      </body>
    </html>
  );
}
