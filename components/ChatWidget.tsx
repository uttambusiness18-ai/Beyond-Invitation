"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

// This import is not requested until the customer first opens the assistant.
const ChatPanel = dynamic(() => import("@/components/chatbot/ChatPanel"), {
  ssr: false,
  loading: () => (
    <span role="status" className="sr-only">Opening chat</span>
  ),
});

export default function ChatWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [bottom, setBottom] = useState(20);
  const close = useCallback(() => setOpen(false), []);
  const isAdmin = pathname === "/admin" || pathname?.startsWith("/admin/");

  useEffect(() => {
    // The existing cookie notice is the only bottom-right floating control.
    // Observe its actual height so neither control obscures the other on mobile.
    let notice: Element | null = null;
    const resizeObserver = new ResizeObserver(updatePosition);
    function updatePosition() {
      const nextNotice = document.querySelector('[aria-labelledby="cookie-consent-title"]');
      if (notice !== nextNotice) {
        if (notice) resizeObserver.unobserve(notice);
        notice = nextNotice;
        if (notice) resizeObserver.observe(notice);
      }
      const top = notice?.getBoundingClientRect().top;
      const offset = top === undefined ? 20 : window.innerHeight - top + 12;
      setBottom(Math.max(20, Math.min(offset, window.innerHeight - 72)));
    }
    const mutationObserver = new MutationObserver(updatePosition);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", updatePosition);
    document.addEventListener("transitionend", updatePosition);
    updatePosition();
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("transitionend", updatePosition);
    };
  }, []);

  useEffect(() => {
    if (isAdmin) setOpen(false);
  }, [isAdmin]);

  if (process.env.NEXT_PUBLIC_CHATBOT_ENABLED !== "true" || isAdmin) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Chat with us"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={hasOpened ? "beyond-chat-panel" : undefined}
        onClick={() => { setHasOpened(true); setOpen(true); }}
        style={{ bottom: `calc(${bottom}px + env(safe-area-inset-bottom, 0px))` }}
        className="fixed right-4 z-[101] flex h-14 w-14 items-center justify-center rounded-full border border-gold/50 bg-carbon text-paper shadow-lg transition-colors hover:bg-maroon-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-carbon sm:right-5"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-6 w-6">
          <path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2v-10a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" strokeLinejoin="round" />
          <path d="M7 9h8M7 13h6" strokeLinecap="round" />
        </svg>
      </button>
      {hasOpened && <ChatPanel open={open} onClose={close} />}
    </>
  );
}
