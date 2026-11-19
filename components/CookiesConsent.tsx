"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  COOKIE_PREFERENCES_EVENT, getCookieConsent, hasMarketingConsent,
  saveCookieConsent, type CookieConsent as ConsentChoice,
} from "@/lib/cookie-consent";

export function hasCookieConsent(): boolean {
  return hasMarketingConsent();
}

export function CookiePreferencesButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new window.Event(COOKIE_PREFERENCES_EVENT))}
      className="group inline-flex items-center gap-3 text-base leading-relaxed text-white/90 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#d6b36a]/60 transition-all group-hover:w-4 group-hover:rounded-full group-hover:bg-[#d6b36a]" />
      Cookie preferences
    </button>
  );
}

export default function CookieConsent() {
  const [shouldRender, setShouldRender] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    let animationFrame: number | null = null;
    function open() {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      setShouldRender(true);
      animationFrame = window.requestAnimationFrame(() => setIsOpen(true));
    }
    if (getCookieConsent() === null) open();
    window.addEventListener(COOKIE_PREFERENCES_EVENT, open);
    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      window.removeEventListener(COOKIE_PREFERENCES_EVENT, open);
    };
  }, []);

  function handleChoice(choice: ConsentChoice) {
    saveCookieConsent(choice);
    setIsOpen(false);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setShouldRender(false);
      closeTimer.current = null;
    }, 300);
  }

  if (!shouldRender) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-3 left-3 right-3 z-[100] md:bottom-5 md:left-auto md:right-5 md:w-[430px]">
      <section
        role="dialog"
        aria-live="polite"
        aria-labelledby="cookie-consent-title"
        aria-describedby="cookie-consent-description"
        className={[
          "pointer-events-auto relative max-h-[calc(100dvh-1.5rem)] overflow-x-hidden overflow-y-auto overscroll-contain md:max-h-[calc(100dvh-2.5rem)]",
          "rounded-[26px] border border-carbon/15",
          "bg-[#fffdf8]/95 backdrop-blur-xl",
          "shadow-[0_18px_60px_rgba(62,12,23,0.16)]",
          "transition-all duration-300 ease-out",
          isOpen
            ? "translate-y-0 opacity-100"
            : "translate-y-4 opacity-0",
        ].join(" ")}
      >
        {/* Subtle invitation-card border */}
        <div
          aria-hidden="true"
          className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent"
        />

        {/* Decorative folded corner */}
        <div
          aria-hidden="true"
          className="absolute right-0 top-0 h-9 w-9 overflow-hidden"
        >
          <div className="absolute right-[-18px] top-[-18px] h-9 w-9 rotate-45 border border-carbon/10 bg-paper" />
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex items-start gap-3.5">
            {/* Invitation envelope icon */}
            <div className="relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-carbon/10 bg-paper text-carbon">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                className="h-5 w-5"
              >
                <path
                  d="M4.75 7.25h14.5v10.5H4.75V7.25Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path
                  d="m5.25 8 6.75 5 6.75-5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>

              <span
                aria-hidden="true"
                className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-[#fffdf8] bg-carbon"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-gold-light" />
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <p className="mb-1 text-sm font-semibold uppercase tracking-[0.08em] text-ink-mid">
                A small note
              </p>

              <h2
                id="cookie-consent-title"
                className="text-lg font-bold leading-snug text-carbon"
              >
                Before you continue browsing
              </h2>

              <p
                id="cookie-consent-description"
                className="mt-1.5 text-base leading-relaxed text-ink-mid"
              >
                Essential cookies keep sign-in, your cart, wishlist and checkout
                working. With your permission, Google cookies also help us
                understand visits and measure purchases from our ads. You can
                change your choice in Cookie preferences below.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-carbon/[0.07] pt-3">
            <Link
              href="/privacy-policy"
              className="w-full text-base font-semibold text-carbon underline decoration-carbon/40 underline-offset-4 transition hover:text-carbon-dark"
            >
              Privacy details
            </Link>

            <button
              type="button"
              onClick={() => handleChoice("declined")}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-carbon px-4 py-2 text-base font-bold text-carbon transition hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Essential only
            </button>

            <button
              type="button"
              onClick={() => handleChoice("accepted")}
              className="group inline-flex min-h-11 items-center gap-2 rounded-full bg-carbon px-4 py-2 text-base font-bold text-white shadow-[0_6px_18px_rgba(123,28,46,0.18)] transition hover:-translate-y-0.5 hover:bg-carbon-dark hover:shadow-[0_9px_24px_rgba(123,28,46,0.24)] focus:outline-none focus-visible:ring-2 focus-visible:ring-carbon focus-visible:ring-offset-2 active:translate-y-0"
            >
              <span>Accept all</span>

              {/* Wax-seal style confirmation */}
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/30 bg-white/10 transition group-hover:rotate-6">
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                  className="h-3 w-3"
                >
                  <path
                    d="m5.5 10 3 3 6-6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
