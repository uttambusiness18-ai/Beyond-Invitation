"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  readProductListSnapshot,
  saveProductListSnapshot,
  type ProductListSnapshot,
} from "@/lib/product-list-history";

/** Preserve each list in this history entry before opening a product. */
export function useProductListHistory<T>(key: string, snapshot: T) {
  const listRef = useRef<HTMLDivElement>(null);
  const latest = useRef(snapshot);
  const [anchor, setAnchor] = useState<ProductListSnapshot<T>["anchor"]>(null);

  useLayoutEffect(() => { latest.current = snapshot; });

  const restoreSnapshot = useCallback(() => {
    const saved = readProductListSnapshot<T>(key);
    setAnchor(saved?.anchor ? { ...saved.anchor } : null);
    return saved?.data ?? null;
  }, [key]);

  const saveSnapshot = useCallback(() => {
    saveProductListSnapshot(key, latest.current, null);
  }, [key]);

  useEffect(() => {
    const onProductClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      const card = link?.closest<HTMLElement>("[data-product-slug]");
      const list = listRef.current;
      if (!link || !card || !list?.isConnected || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin || !destination.pathname.startsWith("/products/")) return;

      // Other homepage lists also retain their height, even when the click is in a different section.
      saveProductListSnapshot(key, latest.current, list.contains(card) ? {
        slug: card.dataset.productSlug!,
        top: card.getBoundingClientRect().top,
        scrollY: window.scrollY,
      } : null);
    };
    document.addEventListener("click", onProductClick, true);
    return () => document.removeEventListener("click", onProductClick, true);
  }, [key]);

  useLayoutEffect(() => {
    if (!anchor) return;
    const list = listRef.current;
    if (!list) return;
    // Returning cards should be visible immediately instead of replaying entrance motion.
    list.querySelectorAll<HTMLElement>("[data-card]").forEach((card) => {
      card.dataset.revealed = "true";
    });
    const restorePosition = () => {
      const card = Array.from(list.querySelectorAll<HTMLElement>("[data-product-slug]"))
        .find((item) => item.dataset.productSlug === anchor.slug);
      // Keep the card visible if the viewport was resized while viewing the product.
      const rect = card?.getBoundingClientRect();
      const offset = Math.max(
        Math.min(0, 120 - (rect?.height ?? 0)),
        Math.min(anchor.top, Math.max(0, window.innerHeight - 120)),
      );
      const top = rect ? window.scrollY + rect.top - offset : anchor.scrollY;
      window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
    };
    let frame = 0;
    const cancel = () => window.cancelAnimationFrame(frame);
    restorePosition();
    // Native history restoration and the router's layout effects can run after our commit.
    frame = window.requestAnimationFrame(() => {
      restorePosition();
      frame = window.requestAnimationFrame(restorePosition);
    });
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("touchstart", cancel, { passive: true });
    window.addEventListener("keydown", cancel);
    return () => {
      cancel();
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchstart", cancel);
      window.removeEventListener("keydown", cancel);
    };
  }, [anchor]);

  return { listRef, restoreSnapshot, saveSnapshot };
}
