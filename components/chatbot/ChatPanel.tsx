"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import ProductPrice from "@/components/ProductPrice";
import { CHATBOT_SHOWROOM } from "@/data/chatbot-knowledge";
import {
  CHATBOT_FALLBACK_REPLY,
  type ChatMessage,
  type ChatProduct,
  type ChatResponse,
} from "@/lib/chatbot/types";

const STORAGE_KEY = "beyond-invitation-chat-v1";
const OPENING =
  "Hello. I can help you find wedding cards, shagun envelopes, boxes and rakhi products. What are you looking for?";
const QUICK_REPLIES = [
  "Hindu wedding cards",
  "Cards under ₹50",
  "Showroom address",
];
const FALLBACK: ChatResponse = {
  reply: CHATBOT_FALLBACK_REPLY,
  products: [],
  showVisitShop: true,
};

type DisplayMessage = ChatMessage & {
  products?: ChatProduct[];
  showVisitShop?: boolean;
};

function readProducts(value: unknown): ChatProduct[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).flatMap((product: unknown) => {
    if (!product || typeof product !== "object") return [];
    const item = product as Partial<ChatProduct>;
    if (
      typeof item.slug !== "string" ||
      !/^[\w-]+$/.test(item.slug) ||
      typeof item.name !== "string" ||
      typeof item.price !== "number" ||
      !Number.isFinite(item.price) ||
      typeof item.mrp !== "number" ||
      !Number.isFinite(item.mrp) ||
      typeof item.image !== "string"
    )
      return [];
    return [
      {
        slug: item.slug,
        name: item.name.slice(0, 300),
        price: item.price,
        mrp: item.mrp,
        image: /^(?:https:\/\/|\/(?!\/))/.test(item.image) ? item.image : "",
        url: `/products/${item.slug}`,
      },
    ];
  });
}

function readConversation(): DisplayMessage[] {
  try {
    const saved: unknown = JSON.parse(
      sessionStorage.getItem(STORAGE_KEY) || "[]",
    );
    if (!Array.isArray(saved)) return [];
    return saved.slice(-40).flatMap((value: unknown) => {
      if (!value || typeof value !== "object") return [];
      const message = value as Partial<DisplayMessage>;
      if (
        (message.role !== "user" && message.role !== "assistant") ||
        typeof message.text !== "string" ||
        !message.text.trim()
      )
        return [];
      return [
        {
          role: message.role,
          text: message.text.slice(0, message.role === "user" ? 500 : 2000),
          products:
            message.role === "assistant"
              ? readProducts(message.products)
              : undefined,
          showVisitShop:
            message.role === "assistant" && message.showVisitShop === true,
        },
      ];
    });
  } catch {
    return [];
  }
}

function ProductRecommendation({
  product,
  onNavigate,
}: {
  product: ChatProduct;
  onNavigate: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <Link
      href={product.url}
      onClick={onNavigate}
      className="min-w-0 w-full overflow-hidden rounded-xl border border-gold/30 bg-paper text-carbon focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-carbon sm:w-36 sm:shrink-0 sm:snap-start"
    >
      <div className="relative flex h-28 items-center justify-center bg-ivory">
        {product.image && !failed ? (
          <Image
            src={product.image}
            alt={product.name}
            fill
            sizes="(min-width: 640px) 144px, calc(50vw - 28px)"
            className="object-contain p-2"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="px-3 text-center text-xs text-ink-light">
            Image coming soon
          </span>
        )}
      </div>
      <div className="p-3">
        <p className="break-words text-sm font-semibold leading-snug">
          {product.name}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-sm">
          <ProductPrice
            price={product.price}
            mrp={product.mrp}
            priceClassName="font-semibold text-carbon"
            oldPriceClassName="text-xs text-ink-light"
          />
        </div>
      </div>
    </Link>
  );
}

function VisitShopCard() {
  const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(CHATBOT_SHOWROOM.address)}`;
  return (
    <section
      aria-label="Visit our showroom"
      className="mt-3 rounded-xl border border-gold/40 bg-ivory p-4 text-carbon"
    >
      <h3 className="text-sm font-semibold">Visit our showroom</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink-mid">
        {CHATBOT_SHOWROOM.address}
      </p>
      {CHATBOT_SHOWROOM.hours && (
        <p className="mt-1 text-sm text-ink-mid">{CHATBOT_SHOWROOM.hours}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={directions}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-carbon/25 px-3 py-2 text-sm font-semibold hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Get directions
        </a>
        <a
          href={
            CHATBOT_SHOWROOM.whatsappUrl ||
            `tel:${CHATBOT_SHOWROOM.phone.replace(/\s/g, "")}`
          }
          target={CHATBOT_SHOWROOM.whatsappUrl ? "_blank" : undefined}
          rel="noopener noreferrer"
          className="rounded-lg bg-carbon px-3 py-2 text-sm font-semibold text-paper hover:bg-maroon-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-carbon"
        >
          {CHATBOT_SHOWROOM.whatsappUrl ? "WhatsApp us" : "Call us"}
        </a>
      </div>
    </section>
  );
}

export default function ChatPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const [messages, setMessages] = useState<DisplayMessage[]>(readConversation);
  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const latestMessageRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inFlight.current?.abort();
    };
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* Private browsing can disable storage. */
    }
  }, [messages]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!open || !scroll) return;
    const latestMessage = latestMessageRef.current;
    if (messages[messages.length - 1]?.role === "assistant" && latestMessage) {
      // A grid can be taller than the viewport. Start at the reply so its first
      // recommendations remain visible, instead of jumping to the final row.
      scroll.scrollTop +=
        latestMessage.getBoundingClientRect().top -
        scroll.getBoundingClientRect().top;
    } else {
      scroll.scrollTop = scroll.scrollHeight;
    }
  }, [messages, waiting, open]);

  async function send(text: string) {
    const cleanText = text.trim();
    if (!cleanText || cleanText.length > 500 || inFlight.current) return;
    const next: DisplayMessage[] = [
      ...messages,
      { role: "user", text: cleanText },
    ];
    setMessages(next.slice(-40));
    setDraft("");
    setWaiting(true);
    const controller = new AbortController();
    inFlight.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    let result: ChatResponse = FALLBACK;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: next
            .slice(-8)
            .map(({ role, text: content }) => ({ role, text: content })),
          pagePath: pathname,
        }),
      });
      if (response.ok) {
        const data: unknown = await response.json();
        if (
          data &&
          typeof data === "object" &&
          "reply" in data &&
          typeof data.reply === "string" &&
          data.reply.trim()
        ) {
          const reply = data as ChatResponse;
          result = {
            reply: reply.reply.slice(0, 2000),
            products: readProducts(reply.products),
            showVisitShop: reply.showVisitShop === true,
          };
        }
      }
    } catch {
      /* Display the same friendly fallback for offline and server failures. */
    } finally {
      window.clearTimeout(timeout);
      inFlight.current = null;
    }
    if (mounted.current) {
      setMessages((current) =>
        [
          ...current,
          {
            role: "assistant" as const,
            text: result.reply,
            products: result.products,
            showVisitShop: result.showVisitShop,
          },
        ].slice(-40),
      );
      setWaiting(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(draft);
  }

  return (
    <dialog
      ref={dialogRef}
      id="beyond-chat-panel"
      aria-labelledby="beyond-chat-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      className={`${open ? "flex" : "hidden"} fixed inset-0 m-0 h-[100dvh] max-h-none w-full max-w-none flex-col overflow-hidden border-0 bg-paper p-0 text-carbon shadow-2xl backdrop:bg-carbon/25 sm:bottom-5 sm:left-auto sm:right-5 sm:top-auto sm:h-[min(650px,calc(100dvh-2.5rem))] sm:w-[380px] sm:rounded-2xl sm:border sm:border-gold/30`}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gold/30 bg-carbon px-4 py-4 text-paper">
        <h2 id="beyond-chat-title" className="text-base font-semibold">
          Beyond Invitation Assistant
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-paper/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="h-5 w-5"
          >
            <path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <div
        ref={scrollRef}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
      >
        <div className="rounded-xl border border-gold/20 bg-ivory p-3 text-sm leading-relaxed">
          {OPENING}
        </div>
        <div
          aria-label="Suggested questions"
          className="mt-3 flex flex-wrap gap-2"
        >
          {QUICK_REPLIES.map((text) => (
            <button
              key={text}
              type="button"
              disabled={waiting}
              onClick={() => void send(text)}
              className="rounded-full border border-carbon/20 px-3 py-2 text-xs font-semibold hover:bg-ivory focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-carbon disabled:opacity-50"
            >
              {text}
            </button>
          ))}
        </div>
        <div
          role="log"
          aria-label="Conversation"
          aria-live="polite"
          aria-relevant="additions"
          className="mt-4 space-y-4"
        >
          {messages.map((message, index) => (
            <div
              key={index}
              ref={index === messages.length - 1 ? latestMessageRef : undefined}
              className={message.role === "user" ? "ml-8" : "mr-1"}
            >
              <div
                className={`whitespace-pre-wrap break-words rounded-xl px-3 py-3 text-sm leading-relaxed ${message.role === "user" ? "bg-carbon text-paper" : "border border-gold/20 bg-ivory text-carbon"}`}
              >
                <span className="sr-only">
                  {message.role === "user" ? "You: " : "Assistant: "}
                </span>
                {message.text}
              </div>
              {!!message.products?.length && (
                <section
                  aria-label="Recommended products"
                  className="mt-3 min-w-0"
                >
                  <p className="mb-2 text-xs font-semibold text-ink-mid sm:sr-only">
                    {message.products.length} recommended{" "}
                    {message.products.length === 1 ? "design" : "designs"}
                  </p>
                  <div
                    tabIndex={0}
                    aria-label="Browse recommended designs"
                    className="grid grid-cols-2 gap-3 px-1 pb-3 pt-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-carbon sm:flex sm:snap-x sm:overflow-x-auto"
                  >
                    {message.products.map((product) => (
                      <ProductRecommendation
                        key={product.slug}
                        product={product}
                        onNavigate={onClose}
                      />
                    ))}
                  </div>
                </section>
              )}
              {message.showVisitShop && <VisitShopCard />}
            </div>
          ))}
        </div>
        {waiting && (
          <p
            role="status"
            className="mt-4 flex items-center gap-2 text-sm text-ink-mid"
          >
            <span
              aria-hidden="true"
              className="h-3 w-3 rounded-full border-2 border-carbon/20 border-t-carbon motion-safe:animate-spin"
            />
            Assistant is typing
          </p>
        )}
      </div>
      <div
        className="shrink-0 border-t border-gold/25 bg-paper px-4 pt-3"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))" }}
      >
        <form onSubmit={submit} className="flex items-center gap-2">
          <label htmlFor="beyond-chat-input" className="sr-only">
            Message the assistant
          </label>
          <input
            ref={inputRef}
            id="beyond-chat-input"
            name="message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.nativeEvent.isComposing)
                event.preventDefault();
            }}
            maxLength={500}
            autoComplete="off"
            placeholder="Type your question"
            aria-describedby="beyond-chat-privacy"
            className="min-w-0 flex-1 rounded-xl border border-carbon/25 bg-ivory px-3 py-3 text-base text-carbon placeholder:text-ink-light focus:outline focus:outline-2 focus:outline-carbon"
          />
          <button
            type="submit"
            disabled={waiting || !draft.trim()}
            aria-label="Send message"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-carbon text-paper hover:bg-maroon-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-carbon disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              className="h-5 w-5"
            >
              <path
                d="m3 3 18 9-18 9 4-9-4-9Zm4 9h14"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </form>
        <p
          id="beyond-chat-privacy"
          className="mt-2 text-xs leading-relaxed text-ink-mid"
        >
          AI assistant. Please do not share personal or payment details.
        </p>
      </div>
    </dialog>
  );
}
