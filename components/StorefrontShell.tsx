"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import Navbar from "./Navbar";
import Footer from "./Footer";
import CookiesConsent from "./CookiesConsent";
import { CartProvider } from "./CartProvider";
import { WishlistProvider } from "./WishlistProvider";
import { AuthProvider } from "./AuthProvider";
import GoogleTracking from "./GoogleTracking";

export default function StorefrontShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/admin" || pathname?.startsWith("/admin/"))
    return <>{children}</>;
  return (
    <AuthProvider>
      <CartProvider>
        <WishlistProvider>
          <GoogleTracking />
          <Navbar />
          <main>{children}</main>
          <Footer />
          <CookiesConsent />
        </WishlistProvider>
      </CartProvider>
    </AuthProvider>
  );
}
