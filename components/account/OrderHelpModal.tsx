"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { CheckCircle2, LoaderCircle, MessageSquare, X } from "lucide-react";
import type { AccountOrder } from "@/lib/account";
import { ORDER_HELP_TOPICS, type OrderHelpRequest, type OrderHelpTopic } from "@/lib/order-help-types";
import { focusClass, inputClass, labelClass, linkClass, primaryClass, secondaryClass } from "./AccountUI";

type Props = { orders: AccountOrder[]; onClose: () => void };
const REQUEST_TIMEOUT_MS = 30_000;

function isSavedRequest(value: unknown, orderId: string, requestId: string): value is OrderHelpRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<OrderHelpRequest>;
  return request.id === requestId && request.orderId === orderId &&
    typeof request.createdAt === "string" && Number.isFinite(Date.parse(request.createdAt));
}

export default function OrderHelpModal({ orders, onClose }: Props) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const orderRef = useRef<HTMLSelectElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const backdropPressed = useRef(false);
  const active = useRef<AbortController | null>(null);
  const submission = useRef<{ signature: string; requestId: string } | null>(null);
  const [orderId, setOrderId] = useState(orders[0]?.id ?? "");
  const [topic, setTopic] = useState<OrderHelpTopic | "">("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [signInRequired, setSignInRequired] = useState(false);
  const [saved, setSaved] = useState<OrderHelpRequest | null>(null);
  const messageLength = Array.from(message).length;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const previousPadding = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      const padding = Number.parseFloat(getComputedStyle(document.body).paddingRight) || 0;
      document.body.style.paddingRight = `${padding + scrollbarWidth}px`;
    }
    document.body.style.overflow = "hidden";
    dialog.showModal();
    (orderRef.current ?? closeRef.current)?.focus({ preventScroll: true });
    return () => {
      active.current?.abort();
      active.current = null;
      dialog.close();
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (saved) successRef.current?.focus({ preventScroll: true });
    else if (error) errorRef.current?.focus({ preventScroll: true });
  }, [saved, error]);

  function reportValidationError(message: string) {
    setError(message);
    errorRef.current?.focus({ preventScroll: true });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    const text = message.trim();
    const textLength = Array.from(text).length;
    if (!orders.some((order) => order.id === orderId)) { reportValidationError("Select the order you need help with."); return; }
    if (!ORDER_HELP_TOPICS.some((item) => item.value === topic)) { reportValidationError("Choose what you need help with."); return; }
    if (textLength < 10 || textLength > 3000) { reportValidationError("Please describe the issue in 10 to 3,000 characters."); return; }

    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    setSignInRequired(false);
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const signature = JSON.stringify({ orderId, topic, message: text });
      if (submission.current?.signature !== signature) {
        submission.current = { signature, requestId: crypto.randomUUID() };
      }
      const requestId = submission.current.requestId;
      const response = await fetch("/api/account/order-help", {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, topic, message: text, requestId }),
      });
      const result = await response.json().catch(() => null);
      if (active.current !== controller) return;
      if (controller.signal.aborted) throw new Error("The request timed out.");
      if (!response.ok) {
        setSignInRequired(response.status === 401);
        throw new Error(typeof result?.error === "string" && result.error.length <= 400
          ? result.error : "We couldn't save your request. Please try again.");
      }
      if (!isSavedRequest(result?.request, orderId, requestId)) {
        throw new Error("We couldn't confirm your request was saved. Please retry; the same request won't be saved twice.");
      }
      setSaved(result.request);
    } catch (reason) {
      if (active.current !== controller) return;
      setError(controller.signal.aborted
        ? "Saving your request took too long. Please retry; the same request won't be saved twice."
        : reason instanceof Error ? reason.message : "We couldn't save your request. Please try again.");
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  function isOutsideDialog(clientX: number, clientY: number) {
    const bounds = dialogRef.current?.getBoundingClientRect();
    return Boolean(bounds && (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom));
  }

  const selectedOrder = orders.find((order) => order.id === (saved?.orderId ?? orderId));

  return createPortal(
    <dialog ref={dialogRef} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} data-no-text-motion
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onPointerDown={(event) => { backdropPressed.current = event.target === event.currentTarget && isOutsideDialog(event.clientX, event.clientY); }}
      onClick={(event) => {
        if (backdropPressed.current && event.target === event.currentTarget && isOutsideDialog(event.clientX, event.clientY)) onClose();
        backdropPressed.current = false;
      }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-xl overflow-hidden rounded-2xl border border-gold/20 bg-white p-0 text-ink shadow-2xl backdrop:bg-carbon/50 backdrop:backdrop-blur-sm">
      <div className="flex max-h-[90dvh] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gold/20 bg-paper/60 px-5 py-5 sm:px-7">
          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gold-ink"><MessageSquare aria-hidden="true" size={15} />Order support</p>
            <h2 id={`${id}-title`} className="text-2xl font-semibold text-carbon">How can we help?</h2>
            <p id={`${id}-description`} className="mt-2 text-sm leading-relaxed text-ink-mid">Tell us about your order and our team will review your request.</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close order help"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-carbon/15 text-carbon hover:bg-white ${focusClass}`}><X size={19} aria-hidden="true" /></button>
        </header>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-6 sm:px-7">
          {saved ? (
            <div ref={successRef} tabIndex={-1} role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 outline-none">
              <CheckCircle2 aria-hidden="true" className="h-8 w-8 text-emerald-700" />
              <h3 className="mt-3 text-lg font-semibold text-emerald-900">Your help request is saved</h3>
              <p className="mt-2 text-sm leading-relaxed text-emerald-900">Our team can now review your request for {selectedOrder?.reference ?? "your order"}. We’ll use the contact details saved with your order if we need to get in touch.</p>
              <p className="mt-4 text-sm text-emerald-900">Request reference <strong>#{saved.id.slice(0, 8).toUpperCase()}</strong></p>
              <button type="button" onClick={onClose} className={`mt-5 ${secondaryClass}`}>Done</button>
            </div>
          ) : !orders.length ? (
            <div className="rounded-xl border border-gold/20 bg-paper/60 p-5">
              <h3 className="text-lg font-semibold text-carbon">No orders to select</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-mid">There are no recent orders available in this account. For a guest checkout or another question, contact our team.</p>
              <Link href="/contact" className={`mt-4 ${linkClass}`}>Contact us</Link>
            </div>
          ) : (
            <form onSubmit={submit} noValidate aria-label="Request order help" aria-busy={busy} className="space-y-5">
              {error && <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-relaxed text-red-800 outline-none">
                <p>{error}</p>
                {signInRequired && <Link href="/sign-in?next=%2Faccount%23orders" className={`mt-2 ${linkClass}`}>Sign in again</Link>}
              </div>}
              <div>
                <label htmlFor={`${id}-order`} className={labelClass}>Order</label>
                <select ref={orderRef} id={`${id}-order`} value={orderId} onChange={(event) => setOrderId(event.target.value)} required disabled={busy} className={inputClass}>
                  {orders.map((order) => <option key={order.id} value={order.id}>{order.reference} · {order.date}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`${id}-topic`} className={labelClass}>What do you need help with?</label>
                <select id={`${id}-topic`} value={topic} onChange={(event) => setTopic(event.target.value as OrderHelpTopic | "")} required disabled={busy} className={inputClass}>
                  <option value="">Select a topic</option>
                  {ORDER_HELP_TOPICS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`${id}-message`} className={labelClass}>Tell us what happened</label>
                <textarea id={`${id}-message`} value={message} onChange={(event) => setMessage(Array.from(event.target.value).slice(0, 3000).join(""))} required maxLength={6000} rows={5} disabled={busy}
                  aria-describedby={`${id}-message-hint`} className={`${inputClass} resize-y`} placeholder="Include the details that will help us understand your request." />
                <p id={`${id}-message-hint`} className="mt-2 text-xs text-ink-mid">10–3,000 characters · {messageLength.toLocaleString("en-IN")} / 3,000</p>
              </div>
              <p className="text-sm leading-relaxed text-ink-mid">We’ll use the contact details saved with your selected order.</p>
              <div className="flex flex-wrap justify-end gap-3 border-t border-gold/20 pt-5">
                <button type="button" onClick={onClose} className={secondaryClass}>Cancel</button>
                <button type="submit" disabled={busy} className={primaryClass}>{busy && <LoaderCircle size={17} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}{busy ? "Saving request…" : "Send help request"}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </dialog>, document.body,
  );
}
