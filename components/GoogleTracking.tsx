"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { COOKIE_CONSENT_EVENT } from "@/lib/cookie-consent";
import { syncGoogleTracking } from "@/lib/google-tracking";

export default function GoogleTracking() {
  const pathname = usePathname();

  useEffect(() => {
    const sync = () => {
      syncGoogleTracking();
    };
    sync();
    window.addEventListener(COOKIE_CONSENT_EVENT, sync);
    return () => window.removeEventListener(COOKIE_CONSENT_EVENT, sync);
  }, [pathname]);

  return null;
}
