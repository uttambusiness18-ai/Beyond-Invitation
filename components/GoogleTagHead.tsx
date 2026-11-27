"use client";

/* eslint-disable @next/next/no-head-element -- This is the App Router root head; next/head is for the Pages Router. */

import { GOOGLE_TAG_BOOTSTRAP, GOOGLE_TAG_BOOTSTRAP_ID } from "@/lib/google-tag";

export default function GoogleTagHead() {
  // React hoists metadata ahead of ordinary head children. Emit this trusted
  // bootstrap first in the server HTML, then leave the head to React in the
  // browser. Never set innerHTML during hydration/navigation: doing so would
  // erase the metadata and resources managed by Next.js.
  if (typeof window !== "undefined") return <head />;
  return (
    <head
      dangerouslySetInnerHTML={{
        __html: `<script id="${GOOGLE_TAG_BOOTSTRAP_ID}">${GOOGLE_TAG_BOOTSTRAP}</script>`,
      }}
    />
  );
}
