"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { BookOpen, Check, CircleAlert, LayoutGrid, LoaderCircle, Mail, MessageSquare, Package, RefreshCw, Search } from "lucide-react";
import { ORDER_HELP_STATUSES, ORDER_HELP_TOPICS, type OrderHelpAdminRequest, type OrderHelpStatus } from "@/lib/order-help-types";
import workspace from "./ItemDashboard.module.css";
import shared from "./OrderShipping.module.css";
import styles from "./OrderHelp.module.css";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requestKey = (request: Pick<OrderHelpAdminRequest, "orderId" | "id">) => `${request.orderId}:${request.id}`;
const topicLabel = (value: string) => ORDER_HELP_TOPICS.find((topic) => topic.value === value)?.label || value;
const statusLabel = (value: string) => ORDER_HELP_STATUSES.find((status) => status.value === value)?.label || value;

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}

function isRequest(value: unknown): value is OrderHelpAdminRequest {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const customer = item.customer as Record<string, unknown> | null;
  return typeof item.id === "string" && UUID.test(item.id) && typeof item.orderId === "string" && UUID.test(item.orderId) &&
    typeof item.orderReference === "string" && typeof item.message === "string" &&
    ORDER_HELP_TOPICS.some((topic) => topic.value === item.topic) && ORDER_HELP_STATUSES.some((status) => status.value === item.status) &&
    typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt)) &&
    typeof item.updatedAt === "string" && Number.isFinite(Date.parse(item.updatedAt)) &&
    !!customer && typeof customer === "object" && ["name", "email", "phone"].every((key) => typeof customer[key] === "string");
}

function errorMessage(result: unknown, fallback: string) {
  const error = result && typeof result === "object" ? (result as { error?: unknown }).error : null;
  return typeof error === "string" && error.length <= 500 ? error : fallback;
}

function HelpShell({ children }: { children: ReactNode }) {
  return <div className={workspace.app}>
    <aside className={workspace.sidebar}>
      <Link href="/admin" className={workspace.brand}>
        <Image src="/logo.png" alt="" width={44} height={44} className={workspace.brandMark} />
        <span>Beyond Invitation<small>ADMIN WORKSPACE</small></span>
      </Link>
      <div className={workspace.sidebarLabel}>WORKSPACE</div>
      <Link href="/admin" className={workspace.navButton}><LayoutGrid size={18} aria-hidden="true" />All items</Link>
      <Link href="/admin/blogs" className={workspace.navButton}><BookOpen size={18} aria-hidden="true" />Blogs</Link>
      <Link href="/admin/orders" className={workspace.navButton}><Package size={18} aria-hidden="true" />Orders</Link>
      <Link href="/admin/order-help" className={workspace.navActive} aria-current="page"><MessageSquare size={18} aria-hidden="true" />Order help</Link>
      <Link href="/admin/contact-enquiries" className={workspace.navButton}><Mail size={18} aria-hidden="true" />Contact enquiries</Link>
      <div className={workspace.sidebarNote}><MessageSquare size={19} aria-hidden="true" /><p>Customer questions,<br />kept with their orders.</p></div>
      <div className={workspace.adminLabel}>ADMIN WORKSPACE <span>/admin</span></div>
    </aside>
    <div className={workspace.workspace}>
      <header className={workspace.topbar}>
        <span>Workspace <span className={workspace.slash}>/</span> <strong>Order help</strong></span>
        <Link href="/admin/orders" className={shared.accountLink}>View orders</Link>
      </header>
      <main className={`${workspace.content} ${shared.content}`}>{children}</main>
    </div>
  </div>;
}

function StatusBadge({ value }: { value: OrderHelpStatus }) {
  return <span className={`${shared.badge} ${styles.status}`} data-status={value}>{statusLabel(value)}</span>;
}

function RequestDetails({ request, loading, onUpdate, onReload, onSavingChange }: {
  request: OrderHelpAdminRequest;
  loading: boolean;
  onUpdate: (request: OrderHelpAdminRequest) => void;
  onReload: () => Promise<boolean>;
  onSavingChange: (saving: boolean) => void;
}) {
  const [status, setStatus] = useState(request.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    setStatus(request.status);
    setNeedsRefresh(false);
    setError("");
  }, [request.status, request.updatedAt]);
  useEffect(() => () => {
    active.current?.abort();
    active.current = null;
    onSavingChange(false);
  }, [onSavingChange]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (active.current || loading || needsRefresh || status === request.status) return;
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30_000);
    setSaving(true);
    onSavingChange(true);
    setSuccess(false);
    setError("");
    try {
      const response = await fetch(`/api/admin/order-help/${encodeURIComponent(request.orderId)}/${encodeURIComponent(request.id)}`, {
        method: "PATCH", cache: "no-store", credentials: "same-origin", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, expectedUpdatedAt: request.updatedAt }),
      });
      if (active.current !== controller) return;
      const result = await response.json();
      if (active.current !== controller) return;
      if (!response.ok) {
        if (response.status === 409) setNeedsRefresh(true);
        throw new Error(response.status === 409 ? "This request changed while you were reviewing it. Reload the requests before saving again."
          : errorMessage(result, "The status could not be saved. Please try again."));
      }
      if (!isRequest(result?.request) || requestKey(result.request) !== requestKey(request)) throw new Error("The saved status could not be confirmed. Reload the requests.");
      if (controller.signal.aborted) return;
      onUpdate(result.request);
      setStatus(result.request.status);
      setSuccess(true);
    } catch (caught) {
      if (active.current !== controller) return;
      // A disconnected response may follow a successful save. Reload before retrying it.
      setNeedsRefresh(true);
      setError(controller.signal.aborted ? "Saving took too long. Reload the requests to check the latest status."
        : caught instanceof Error ? caught.message : "The status could not be saved. Reload the requests.");
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        setSaving(false);
        onSavingChange(false);
      }
    }
  }

  return <section className={shared.detail} aria-labelledby="help-request-heading" aria-busy={saving}>
    <div className={shared.detailHeading}>
      <div><span className={shared.eyebrow}>REQUEST #{request.id.slice(0, 8).toUpperCase()}</span><h2 id="help-request-heading">{topicLabel(request.topic)}</h2></div>
      <StatusBadge value={request.status} />
    </div>
    <dl className={`${shared.orderMeta} ${styles.metadata}`}>
      <div><dt>Order</dt><dd title={request.orderId}>{request.orderReference}</dd></div>
      <div><dt>Customer</dt><dd>{request.customer.name}</dd></div>
      <div><dt>Email</dt><dd><a href={`mailto:${encodeURIComponent(request.customer.email)}`}>{request.customer.email}</a></dd></div>
      <div><dt>Phone</dt><dd><a href={`tel:${request.customer.phone.replace(/[^+\d]/g, "")}`}>{request.customer.phone}</a></dd></div>
      <div><dt>Submitted · India time</dt><dd><time dateTime={request.createdAt}>{dateLabel(request.createdAt)}</time></dd></div>
      <div><dt>Last updated · India time</dt><dd><time dateTime={request.updatedAt}>{dateLabel(request.updatedAt)}</time></dd></div>
    </dl>
    <div className={styles.messageSection}><h3>Customer message</h3><p className={styles.message}>{request.message}</p></div>
    <form onSubmit={save} className={styles.statusForm}>
      <label htmlFor="help-request-status">Request status</label>
      <div className={styles.statusActions}>
        <select id="help-request-status" value={status} disabled={saving || loading || needsRefresh} onChange={(event) => { setStatus(event.target.value as OrderHelpStatus); setSuccess(false); }}>
          {ORDER_HELP_STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button type="submit" className={shared.primary} disabled={saving || loading || needsRefresh || status === request.status}>
          {saving && <LoaderCircle size={17} className={shared.spin} aria-hidden="true" />}{saving ? "Saving…" : "Save status"}
        </button>
      </div>
      <p className={styles.hint}>Status changes are saved to the request. No message is sent automatically.</p>
    </form>
    {error && <div className={shared.error} role="alert"><CircleAlert size={18} aria-hidden="true" /><span>{error}</span></div>}
    {needsRefresh && <button type="button" className={shared.secondary} disabled={saving || loading} onClick={async () => {
      if (await onReload()) {
        setNeedsRefresh(false);
        setError("");
      }
    }}>Reload requests</button>}
    {success && <div className={shared.success} role="status"><Check size={18} aria-hidden="true" /><span>Status saved.</span></div>}
  </section>;
}

export default function OrderHelpDashboard() {
  const [requests, setRequests] = useState<OrderHelpAdminRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<OrderHelpStatus | "all">("all");
  const active = useRef<AbortController | null>(null);

  const load = useCallback(async (cursor?: string): Promise<boolean> => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30_000);
    setLoading(true);
    setError("");
    try {
      const query = cursor ? `?${new URLSearchParams({ cursor })}` : "";
      const response = await fetch(`/api/admin/order-help${query}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      if (active.current !== controller) return false;
      const result = await response.json();
      if (active.current !== controller) return false;
      if (!response.ok) throw new Error(errorMessage(result, "Order help requests could not be loaded. Please try again."));
      if (!Array.isArray(result?.requests) || !result.requests.every(isRequest) ||
          !(result.nextCursor === null || (typeof result.nextCursor === "string" && result.nextCursor.length > 0))) {
        throw new Error("Order help requests could not be read. Please try again.");
      }
      if (controller.signal.aborted) return false;
      const incoming = result.requests as OrderHelpAdminRequest[];
      setRequests((current) => {
        const combined = new Map((cursor ? current : []).map((request) => [requestKey(request), request]));
        incoming.forEach((request) => combined.set(requestKey(request), request));
        return [...combined.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || requestKey(a).localeCompare(requestKey(b)));
      });
      setSelectedId((current) => current && (cursor || incoming.some((request) => requestKey(request) === current)) ? current : incoming[0] ? requestKey(incoming[0]) : null);
      setNextCursor(result.nextCursor);
      return true;
    } catch (caught) {
      if (active.current !== controller) return false;
      setError(controller.signal.aborted ? "Requests took too long to load. Please try again."
        : caught instanceof Error ? caught.message : "Order help requests could not be loaded.");
      return false;
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => { void load(); return () => { active.current?.abort(); active.current = null; }; }, [load]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return requests.filter((request) => (status === "all" || request.status === status) &&
      (!needle || [request.id, request.orderId, request.orderReference, request.customer.name, request.customer.email, request.customer.phone, request.message, topicLabel(request.topic)]
        .some((value) => value.toLowerCase().includes(needle))));
  }, [requests, status, search]);
  const selected = filtered.find((request) => requestKey(request) === selectedId) ?? filtered[0];
  const unresolved = requests.filter((request) => request.status !== "resolved").length;

  return <HelpShell>
    <div className={shared.heading}>
      <div><span className={shared.eyebrow}>CUSTOMER SUPPORT</span><h1>Order help</h1><p>Review customer requests and track their progress.</p></div>
      <button type="button" className={shared.secondary} disabled={loading || saving} onClick={() => void load()}><RefreshCw size={17} aria-hidden="true" className={loading ? shared.spin : undefined} />Refresh</button>
    </div>
    {error && <div className={shared.error} role="alert"><CircleAlert size={18} aria-hidden="true" /><span>{error}{requests.length > 0 && <small className={styles.stale}>Showing previously loaded requests.</small>}</span><button type="button" disabled={loading || saving} onClick={() => void load()}>Retry</button></div>}
      <div className={shared.stats}><div><span>Requests loaded</span><strong>{requests.length}</strong></div><div><span>Open / in progress</span><strong>{unresolved}</strong></div><div><span>Resolved</span><strong>{requests.length - unresolved}</strong></div></div>
      <div className={shared.toolbar}>
        <label className={shared.search}><Search size={18} aria-hidden="true" /><input aria-label="Search loaded help requests" placeholder="Search loaded requests by customer, order or message" value={search} disabled={saving} onChange={(event) => setSearch(event.target.value)} /></label>
        <label className={shared.modeFilter}>Status<select value={status} disabled={saving} onChange={(event) => setStatus(event.target.value as OrderHelpStatus | "all")}><option value="all">All statuses</option>{ORDER_HELP_STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      </div>
      <p className={styles.filterHint}>Search, status filters and counts apply to loaded requests. Load more to review older requests.</p>
      {loading && !requests.length ? <div className={shared.empty} role="status"><LoaderCircle size={25} className={shared.spin} aria-hidden="true" /><p>Loading help requests…</p></div>
        : !requests.length ? <div className={shared.empty}><MessageSquare size={30} aria-hidden="true" /><h2>{error ? "Requests are unavailable" : "No help requests yet"}</h2><p>{error ? "Retry to check for customer requests." : "Requests submitted from My Orders will appear here."}</p></div>
          : <div className={shared.columns}>
            <section className={shared.orderList} aria-label="Customer help requests">
              {!filtered.length && <p className={shared.noResults}>No loaded requests match these filters.</p>}
              {filtered.map((request) => <button type="button" key={requestKey(request)} disabled={saving} aria-pressed={selected && requestKey(selected) === requestKey(request)}
                onClick={() => setSelectedId(requestKey(request))} className={`${shared.orderCard} ${selected && requestKey(selected) === requestKey(request) ? shared.selected : ""}`}>
                <div className={styles.cardTop}><strong>{request.customer.name}</strong><StatusBadge value={request.status} /></div>
                <p className={styles.cardTopic}>{topicLabel(request.topic)}</p>
                <p className={styles.preview}>{request.message}</p>
                <small className={styles.cardMeta}>{request.orderReference}<br /><time dateTime={request.createdAt}>{dateLabel(request.createdAt)}</time></small>
              </button>)}
              {nextCursor && <button type="button" className={shared.secondary} disabled={loading || saving} onClick={() => void load(nextCursor)}>{loading ? "Loading…" : "Load more requests"}</button>}
            </section>
            {selected ? <RequestDetails key={requestKey(selected)} request={selected} loading={loading} onSavingChange={setSaving}
              onReload={() => load()} onUpdate={(updated) => setRequests((current) => current.map((request) => requestKey(request) === requestKey(updated) ? updated : request))} />
              : <div className={shared.empty}><MessageSquare size={26} aria-hidden="true" /><p>Choose a request to view its details.</p></div>}
          </div>}
  </HelpShell>;
}
