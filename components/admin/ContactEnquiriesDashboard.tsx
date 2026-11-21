"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { BookOpen, CircleAlert, Inbox, LayoutGrid, LoaderCircle, Mail, MessageSquare, Package, RefreshCw, Search } from "lucide-react";
import type { ContactEnquiry } from "@/lib/contact-enquiry-types";
import workspace from "./ItemDashboard.module.css";
import shared from "./OrderShipping.module.css";
import styles from "./ContactEnquiriesDashboard.module.css";

const NOT_PROVIDED = "Not provided";
const amount = (value: number | null) => value === null ? NOT_PROVIDED
  : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
const requirementLabel = (value: string) => value === "Sagun Envelopes" ? "Shagun envelopes" : value;

function submittedDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}

function eventDate(value: string) {
  // An event date is a calendar date, not a timestamp in the viewer's timezone.
  if (!value) return NOT_PROVIDED;
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" })
    .format(new Date(`${value}T00:00:00Z`));
}

function isEnquiry(value: unknown): value is ContactEnquiry {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return ["id", "name", "mobile", "email", "source", "requirement", "subRequirement", "eventDate", "message", "createdAt"]
    .every((key) => typeof item[key] === "string") &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id as string) &&
    Number.isFinite(Date.parse(item.createdAt as string)) &&
    (item.eventDate === "" || (/^\d{4}-\d{2}-\d{2}$/.test(item.eventDate as string) && Number.isFinite(Date.parse(`${item.eventDate}T00:00:00Z`)))) &&
    ["quantity", "budgetPerUnit", "totalBudget"].every((key) => item[key] === null || (typeof item[key] === "number" && Number.isFinite(item[key])));
}

function EnquiriesShell({ children }: { children: ReactNode }) {
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
      <Link href="/admin/order-help" className={workspace.navButton}><MessageSquare size={18} aria-hidden="true" />Order help</Link>
      <Link href="/admin/contact-enquiries" className={workspace.navActive} aria-current="page"><Mail size={18} aria-hidden="true" />Contact enquiries</Link>
      <div className={workspace.sidebarNote}><Inbox size={19} aria-hidden="true" /><p>Every enquiry,<br />with the details that matter.</p></div>
      <div className={workspace.adminLabel}>ADMIN WORKSPACE <span>/admin</span></div>
    </aside>
    <div className={workspace.workspace}>
      <header className={workspace.topbar}>
        <span>Workspace <span className={workspace.slash}>/</span> <strong>Contact enquiries</strong></span>
        <Link href="/contact" className={shared.accountLink}>View contact page</Link>
      </header>
      <main className={`${workspace.content} ${shared.content}`}>{children}</main>
    </div>
  </div>;
}

function EnquiryDetails({ enquiry }: { enquiry: ContactEnquiry }) {
  const phone = enquiry.mobile.replace(/[\s()-]/g, "");
  const phoneHref = /^[6-9]\d{9}$/.test(phone) ? `tel:+91${phone}` : /^\+?\d{7,15}$/.test(phone) ? `tel:${phone}` : null;
  const emailHref = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(enquiry.email) ? `mailto:${encodeURIComponent(enquiry.email)}` : null;
  return <section className={shared.detail} aria-label="Selected enquiry details">
    <div className={shared.detailHeading}>
      <div><span className={shared.eyebrow}>CONTACT FORM SUBMISSION</span><h2>{enquiry.name}</h2></div>
      <span className={`${shared.badge} ${shared.neutral}`}>{requirementLabel(enquiry.requirement)}</span>
    </div>
    <dl className={`${shared.orderMeta} ${styles.metadata}`}>
      <div><dt>Name</dt><dd>{enquiry.name}</dd></div>
      <div><dt>Mobile number</dt><dd>{phoneHref ? <a href={phoneHref}>{enquiry.mobile}</a> : enquiry.mobile || NOT_PROVIDED}</dd></div>
      <div><dt>Email</dt><dd>{emailHref ? <a href={emailHref}>{enquiry.email}</a> : enquiry.email || NOT_PROVIDED}</dd></div>
      <div><dt>Submitted at (IST)</dt><dd><time dateTime={enquiry.createdAt}>{submittedDate(enquiry.createdAt)}</time></dd></div>
      <div><dt>Source</dt><dd>{enquiry.source || NOT_PROVIDED}</dd></div>
      <div><dt>Enquiry ID</dt><dd>{enquiry.id}</dd></div>
    </dl>
    <dl className={`${shared.orderMeta} ${styles.metadata}`}>
      <div><dt>Requirement</dt><dd>{requirementLabel(enquiry.requirement) || NOT_PROVIDED}</dd></div>
      <div><dt>Card type / sub-requirement</dt><dd>{enquiry.subRequirement || NOT_PROVIDED}</dd></div>
      <div><dt>Quantity</dt><dd>{enquiry.quantity === null ? NOT_PROVIDED : enquiry.quantity.toLocaleString("en-IN")}</dd></div>
      <div><dt>Event date</dt><dd>{enquiry.eventDate ? <time dateTime={enquiry.eventDate}>{eventDate(enquiry.eventDate)}</time> : NOT_PROVIDED}</dd></div>
      <div><dt>Budget per piece</dt><dd>{amount(enquiry.budgetPerUnit)}</dd></div>
      <div><dt>Total budget</dt><dd>{amount(enquiry.totalBudget)}</dd></div>
    </dl>
    <div className={styles.messageSection}>
      <h3>Message and design details</h3>
      <p className={styles.message}>{enquiry.message || NOT_PROVIDED}</p>
    </div>
  </section>;
}

export default function ContactEnquiriesDashboard() {
  const [enquiries, setEnquiries] = useState<ContactEnquiry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [requirement, setRequirement] = useState("all");
  const active = useRef<AbortController | null>(null);

  const load = useCallback(async (cursor?: string) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30_000);
    setLoading(true);
    setError("");
    try {
      const query = cursor ? `?${new URLSearchParams({ cursor })}` : "";
      const response = await fetch(`/api/admin/contact-enquiries${query}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      if (active.current !== controller) return;
      const result = await response.json();
      if (active.current !== controller) return;
      if (!response.ok) throw new Error(typeof result?.error === "string" && result.error.length <= 500 ? result.error : "Enquiries could not be loaded. Please try again.");
      if (!Array.isArray(result?.enquiries) || !result.enquiries.every(isEnquiry) ||
          !(result.nextCursor === null || (typeof result.nextCursor === "string" && result.nextCursor.length > 0))) {
        throw new Error("Enquiries could not be read. Please try again.");
      }
      if (controller.signal.aborted) return;
      const incoming = result.enquiries as ContactEnquiry[];
      setEnquiries((current) => {
        const combined = new Map((cursor ? current : []).map((enquiry) => [enquiry.id, enquiry]));
        incoming.forEach((enquiry) => combined.set(enquiry.id, enquiry));
        return [...combined.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
      });
      setSelectedId((current) => current && (cursor || incoming.some((enquiry) => enquiry.id === current)) ? current : incoming[0]?.id ?? null);
      setNextCursor(result.nextCursor);
    } catch (caught) {
      if (active.current !== controller) return;
      setError(controller.signal.aborted ? "Enquiries took too long to load. Please try again."
        : caught instanceof Error ? caught.message : "Enquiries could not be loaded.");
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => { void load(); return () => { active.current?.abort(); active.current = null; }; }, [load]);
  const requirements = useMemo(() => Array.from(new Set(enquiries.map((enquiry) => enquiry.requirement))).sort(), [enquiries]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return enquiries.filter((enquiry) => (requirement === "all" || enquiry.requirement === requirement) &&
      (!needle || [...Object.values(enquiry), requirementLabel(enquiry.requirement)]
        .some((value) => value != null && String(value).toLowerCase().includes(needle))));
  }, [enquiries, requirement, search]);
  const selected = filtered.find((enquiry) => enquiry.id === selectedId) ?? filtered[0];

  return <EnquiriesShell>
    <div className={shared.heading}>
      <div><span className={shared.eyebrow}>CUSTOMER ENQUIRIES</span><h1>Contact enquiries</h1><p>Review contact form submissions and every detail shared by your customers.</p></div>
      <button type="button" className={shared.secondary} disabled={loading} onClick={() => void load()}><RefreshCw size={17} aria-hidden="true" className={loading ? shared.spin : undefined} />Refresh</button>
    </div>
    {error && <div className={shared.error} role="alert"><CircleAlert size={18} aria-hidden="true" /><span>{error}{enquiries.length > 0 && <small className={styles.stale}>Showing previously loaded enquiries.</small>}</span><button type="button" disabled={loading} onClick={() => void load()}>Retry</button></div>}
    <>
      <div className={shared.stats}>
        <div><span>Enquiries loaded</span><strong>{enquiries.length}</strong></div>
        <div><span>With an event date</span><strong>{enquiries.filter((enquiry) => enquiry.eventDate).length}</strong></div>
        <div><span>With a budget</span><strong>{enquiries.filter((enquiry) => enquiry.budgetPerUnit !== null || enquiry.totalBudget !== null).length}</strong></div>
      </div>
      <div className={shared.toolbar}>
        <label className={shared.search}><Search size={18} aria-hidden="true" /><input aria-label="Search loaded contact enquiries" placeholder="Search by name, mobile, email or message" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label className={shared.modeFilter}>Requirement<select value={requirement} onChange={(event) => setRequirement(event.target.value)}><option value="all">All requirements</option>{requirements.map((value) => <option key={value} value={value}>{requirementLabel(value)}</option>)}</select></label>
      </div>
      <p className={styles.filterHint}>Newest submissions appear first. Search, filters and counts apply to loaded enquiries; load more to review older submissions.</p>
      {loading && !enquiries.length ? <div className={shared.empty} role="status"><LoaderCircle size={25} className={shared.spin} aria-hidden="true" /><p>Loading contact enquiries…</p></div>
        : !enquiries.length ? <div className={shared.empty}><Inbox size={30} aria-hidden="true" /><h2>{error ? "Enquiries are unavailable" : "No contact enquiries yet"}</h2><p>{error ? "Retry to check for customer enquiries." : "New submissions from the contact page will appear here."}</p></div>
          : <div className={shared.columns}>
            <section className={shared.orderList} aria-label="Contact enquiry list" aria-busy={loading}>
              {!filtered.length && <p className={shared.noResults}>No loaded enquiries match these filters.</p>}
              {filtered.map((enquiry) => <button type="button" key={enquiry.id} aria-pressed={selected?.id === enquiry.id}
                onClick={() => setSelectedId(enquiry.id)} className={`${shared.orderCard} ${selected?.id === enquiry.id ? shared.selected : ""}`}>
                <strong className={styles.customerName}>{enquiry.name}</strong>
                <p className={styles.requirement}>{requirementLabel(enquiry.requirement)}</p>
                <p className={styles.preview}>{enquiry.message || "No message provided"}</p>
                <small className={styles.cardMeta}>{enquiry.mobile}<br /><time dateTime={enquiry.createdAt}>{submittedDate(enquiry.createdAt)} IST</time></small>
              </button>)}
              {nextCursor && <button type="button" className={shared.secondary} disabled={loading} onClick={() => void load(nextCursor)}>{loading ? "Loading…" : "Load more enquiries"}</button>}
            </section>
            {selected ? <EnquiryDetails enquiry={selected} /> : <div className={shared.empty}><Inbox size={26} aria-hidden="true" /><p>Choose an enquiry to view all submitted details.</p></div>}
          </div>}
    </>
  </EnquiriesShell>;
}
