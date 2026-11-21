"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowUpRight, Check, ChevronDown, Flower2, IndianRupee, LoaderCircle, Mail, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useContactMotion } from "@/components/contact/ContactMotion";
import ProductEnquiryBanner from "@/components/contact/ProductEnquiryBanner";
import EnquirySuccess from "@/components/contact/EnquirySuccess";
import {
  REQUIREMENTS, WEDDING_CARD_TYPES, buildEnquiryMessage, buildWhatsAppUrl,
  formatInr, isValidIndianMobile, normaliseMobile, requirementFromSubject, type EnquiryProduct,
} from "@/lib/contact";
import { CONTACT } from "@/lib/site-config";
import { trackLeadConversion } from "@/lib/google-tracking";

const labelClass = "mb-2 text-sm font-semibold leading-5 text-ink";
const hintClass = "mt-2 text-sm leading-relaxed text-ink-mid";
type FieldName = "requirement" | "subRequirement" | "quantity" | "eventDate" | "name" | "mobile" | "email" | "budgetPerUnit" | "message";
type Errors = Partial<Record<FieldName, string>>;

function Reveal({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const initiallyHidden = useRef(!open);
  const previousOpen = useRef(open);
  const motion = useContactMotion();
  useEffect(() => {
    if (ref.current && previousOpen.current !== open) {
      if (open) motion.expand(ref.current);
      else motion.collapse(ref.current);
    }
    previousOpen.current = open;
  }, [open, motion]);
  return <div ref={ref} id={id} hidden={initiallyHidden.current} aria-hidden={!open} inert={!open}>{children}</div>;
}

function FieldError({ field, errors }: { field: FieldName; errors: Errors }) {
  return errors[field] ? <p id={`enquiry-${field}-error`} className="mt-1.5 text-sm text-maroon">{errors[field]}</p> : null;
}

function localToday() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

export default function EnquiryForm({ enquiryProduct }: { enquiryProduct: EnquiryProduct | null }) {
  const initial = requirementFromSubject(enquiryProduct?.subject || "");
  const [requirement, setRequirement] = useState(initial.requirement);
  const [subRequirement, setSubRequirement] = useState(initial.subRequirement);
  const [cardTypeMounted, setCardTypeMounted] = useState(initial.requirement === "Wedding Cards");
  const [quantity, setQuantity] = useState("");
  const [budget, setBudget] = useState("");
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [mobile, setMobile] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<{ name: string; mobile: string } | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [today, setToday] = useState(localToday);
  const totalRef = useRef<HTMLSpanElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  const submission = useRef<{ payload: string; requestId: string } | null>(null);
  const focusAfterReset = useRef(false);
  const invalidField = useRef<string | null>(null);
  const motion = useContactMotion();
  const isWedding = requirement === "Wedding Cards";
  const computedTotal = quantity !== "" && budget !== "" ? Number(quantity) * Number(budget) : null;
  const total = computedTotal != null && Number.isFinite(computedTotal) && computedTotal >= 0 ? Math.round(computedTotal * 100) / 100 : null;
  const whatsappUrl = buildWhatsAppUrl(CONTACT.whatsappNumber, enquiryProduct
    ? `Hello Beyond Invitation, I would like a price for design ${enquiryProduct.designNo}.`
    : "Hello Beyond Invitation, I would like to know more.");

  useEffect(() => { setToday(localToday()); }, []);
  useEffect(() => {
    if (totalRef.current && total != null) motion.countTo(totalRef.current, total, formatInr);
  }, [total, budgetOpen, motion]);
  useEffect(() => {
    if (focusAfterReset.current && !success) {
      formRef.current?.querySelector<HTMLInputElement>('input[name="requirement"]')?.focus();
      focusAfterReset.current = false;
    }
  }, [success]);
  useEffect(() => {
    if (invalidField.current) {
      const field = formRef.current?.querySelector<HTMLElement>(`[name="${invalidField.current}"]`);
      invalidField.current = null;
      if (typeof window.requestAnimationFrame === "function") {
        const frame = window.requestAnimationFrame(() => field?.focus());
        return () => window.cancelAnimationFrame(frame);
      }
      field?.focus();
    }
  }, [errors]);

  function accessibility(field: FieldName, hint?: string) {
    return {
      "aria-invalid": errors[field] ? true as const : undefined,
      "aria-describedby": [hint, errors[field] ? `enquiry-${field}-error` : ""].filter(Boolean).join(" ") || undefined,
    };
  }

  function reset() {
    submission.current = null;
    setRequirement(initial.requirement);
    setSubRequirement(initial.subRequirement);
    setCardTypeMounted(initial.requirement === "Wedding Cards");
    setQuantity(""); setBudget(""); setBudgetOpen(false); setMobile("");
    setErrors({}); setSubmitError(null); setBusy(false);
    setFormVersion(value => value + 1);
    focusAfterReset.current = true;
    setSuccess(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const read = (field: string) => String(data.get(field) || "").trim();
    const name = read("name");
    const phone = normaliseMobile(mobile);
    setSubmitError(null);
    if (String(data.get("website") || "").length > 0) {
      setSuccess({ name, mobile: phone });
      return;
    }

    const nextErrors: Errors = {};
    if (!REQUIREMENTS.some(item => item.value === requirement)) nextErrors.requirement = "Choose what you need.";
    if (isWedding && !WEDDING_CARD_TYPES.some(item => item.value === subRequirement)) nextErrors.subRequirement = "Choose a card type, or select Not sure yet.";
    if (quantity && (!Number.isInteger(Number(quantity)) || Number(quantity) < 1)) nextErrors.quantity = "Enter a quantity of at least 1.";
    if (read("eventDate") && read("eventDate") < localToday()) nextErrors.eventDate = "Choose today or a future date.";
    if (!name) nextErrors.name = "Enter your name.";
    else if (name.length > 100) nextErrors.name = "Keep your name to 100 characters.";
    if (!isValidIndianMobile(phone)) nextErrors.mobile = "Enter a 10-digit mobile number.";
    const emailInput = form.elements.namedItem("email") as HTMLInputElement;
    if (read("email") && !emailInput.validity.valid) nextErrors.email = "Enter a valid email address.";
    if (budget && (!Number.isFinite(Number(budget)) || Number(budget) < 0)) nextErrors.budgetPerUnit = "Enter a budget of 0 or more.";
    const message = buildEnquiryMessage(enquiryProduct, read("message"));
    if (message.length > 2000) nextErrors.message = "Keep your message, including the design details, to 2,000 characters.";
    setErrors(nextErrors);
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      if (nextErrors.budgetPerUnit) setBudgetOpen(true);
      invalidField.current = firstInvalid;
      return;
    }

    submitting.current = true;
    setBusy(true);
    const payload = {
      name, mobile: phone, email: read("email"), source: "Website", requirement,
      subRequirement: isWedding ? subRequirement : "",
      quantity, eventDate: read("eventDate"), budgetPerUnit: budget,
      totalBudget: total == null ? "" : String(total), message,
    };
    try {
      const serialized = JSON.stringify(payload);
      if (submission.current?.payload !== serialized) {
        submission.current = { payload: serialized, requestId: crypto.randomUUID() };
      }
      const response = await fetch("/api/contact-lead", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, requestId: submission.current.requestId }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.success !== true) {
        setSubmitError(typeof result?.message === "string" && result.message.trim() ? result.message : "");
        return;
      }
      setSuccess({ name, mobile: phone });
      trackLeadConversion();
    } catch {
      setSubmitError("");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (success) return <EnquirySuccess {...success} whatsappUrl={whatsappUrl} onReset={reset} />;

  return (
    <form key={formVersion} ref={formRef} onSubmit={submit} noValidate aria-label="Send an enquiry" aria-busy={busy} className="relative">
      <CardHeader className="gap-0 border-b border-gold/20 bg-paper/70 p-6 sm:px-8 sm:py-7">
        <h2 className="text-3xl font-normal leading-tight tracking-[-0.025em] text-carbon [font-family:Georgia,'Times_New_Roman',serif] sm:text-[2.125rem]">Let’s create something lovely.</h2>
        <p className="mt-2 text-base leading-6 text-ink-mid">Share a few details. We’ll take it from here.</p>
      </CardHeader>

      <CardContent className="gap-6 p-6 sm:p-8">
        {enquiryProduct ? <ProductEnquiryBanner product={enquiryProduct} /> : null}

        <fieldset disabled={busy} aria-label="Your celebration" className="min-w-0 space-y-5">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gold/15 text-xs font-semibold text-gold-ink">01</span>
            <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-mid">Your celebration</h3>
            <span aria-hidden="true" className="h-px flex-1 bg-carbon/10" />
          </div>
          <div>
            <p id="enquiry-requirement-label" className={labelClass}>What are you looking for? <span className="text-carbon" aria-hidden="true">*</span></p>
            <RadioGroup
              name="requirement"
              value={requirement || null}
              orientation="horizontal"
              onChange={value => {
                setRequirement(value); setSubRequirement("");
                if (value === "Wedding Cards") setCardTypeMounted(true);
              }}
              aria-labelledby="enquiry-requirement-label"
              isRequired
              isDisabled={busy}
              isInvalid={!!errors.requirement}
              validationBehavior="aria"
              {...accessibility("requirement")}
              className="grid grid-cols-2 gap-3"
            >
              {REQUIREMENTS.map(item => {
                const Icon = item.value === "Wedding Cards" ? Flower2 : Mail;
                return (
                  <RadioGroupItem
                    key={item.value}
                    value={item.value}
                    className="group relative flex aspect-auto h-auto w-full min-w-0 cursor-pointer flex-col items-start gap-3 rounded-xl border border-carbon/15 bg-white p-3.5 text-ink transition-colors hover:border-carbon/40 hover:bg-paper/60 data-[selected]:border-carbon data-[selected]:bg-carbon/[0.04] data-[selected]:text-carbon data-[focus-visible]:ring-2 data-[focus-visible]:ring-gold/40 data-[focus-visible]:ring-offset-2 [&>[data-slot=radio-group-indicator]]:hidden sm:p-4"
                  >
                    {({ isSelected }) => (
                      <>
                        <Icon className="size-5 text-carbon" strokeWidth={1.5} aria-hidden="true" />
                        <span aria-hidden="true" className={"absolute right-3.5 top-3.5 flex size-4 items-center justify-center rounded-full border " + (isSelected ? "border-carbon bg-carbon text-white" : "border-carbon/20 bg-white")}>
                          {isSelected ? <Check className="size-2.5" strokeWidth={3} /> : null}
                        </span>
                        <span className="text-sm font-semibold leading-5 sm:text-base">{item.label}</span>
                      </>
                    )}
                  </RadioGroupItem>
                );
              })}
            </RadioGroup>
            <FieldError field="requirement" errors={errors} />
          </div>

          <Reveal id="enquiry-card-type" open={isWedding}>
            {cardTypeMounted ? <div>
              <Label htmlFor="enquiry-subRequirement" className={labelClass}>Card type <span aria-hidden="true" className="text-carbon">*</span></Label>
              <NativeSelect id="enquiry-subRequirement" name="subRequirement" required={isWedding} disabled={!isWedding || busy} value={subRequirement} onChange={event => setSubRequirement(event.target.value)} className="w-full" {...accessibility("subRequirement")}>
                <NativeSelectOption value="">Choose your card style</NativeSelectOption>
                {WEDDING_CARD_TYPES.map(item => <NativeSelectOption key={item.value} value={item.value}>{item.label}</NativeSelectOption>)}
              </NativeSelect>
              {isWedding ? <FieldError field="subRequirement" errors={errors} /> : null}
            </div> : null}
          </Reveal>

          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <Label htmlFor="enquiry-quantity" className={labelClass}>Quantity <span className="font-normal text-ink-mid">(optional)</span></Label>
              <Input id="enquiry-quantity" name="quantity" type="number" inputMode="numeric" min={1} placeholder="e.g. 200" value={quantity} onChange={event => setQuantity(event.target.value)} {...accessibility("quantity", "enquiry-quantity-hint")} />
              <p id="enquiry-quantity-hint" className={hintClass}>An estimate is perfectly fine.</p>
              <FieldError field="quantity" errors={errors} />
            </div>
            <div className="min-w-0">
              <Label htmlFor="enquiry-eventDate" className={labelClass}>Event date <span className="font-normal text-ink-mid">(optional)</span></Label>
              <Input id="enquiry-eventDate" name="eventDate" type="date" min={today} className="block max-w-full appearance-none" {...accessibility("eventDate")} />
              <FieldError field="eventDate" errors={errors} />
            </div>
          </div>
        </fieldset>

        <fieldset disabled={busy} aria-label="Your details" className="min-w-0 space-y-5">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gold/15 text-xs font-semibold text-gold-ink">02</span>
            <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-mid">A little about you</h3>
            <span aria-hidden="true" className="h-px flex-1 bg-carbon/10" />
          </div>
          <div>
            <Label htmlFor="enquiry-name" className={labelClass}>Your name <span aria-hidden="true" className="text-carbon">*</span></Label>
            <Input id="enquiry-name" name="name" required autoComplete="name" maxLength={100} placeholder="First and last name" {...accessibility("name")} />
            <FieldError field="name" errors={errors} />
          </div>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <Label htmlFor="enquiry-mobile" className={labelClass}>Mobile number <span aria-hidden="true" className="text-carbon">*</span></Label>
              <div className="relative">
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-3 left-4 flex items-center border-r border-carbon/15 pr-3 text-sm font-medium text-ink-mid">+91</span>
                <Input id="enquiry-mobile" name="mobile" aria-label="Mobile number, +91 India" type="tel" inputMode="numeric" required autoComplete="tel-national" maxLength={10} placeholder="10-digit number" value={mobile} onChange={event => setMobile(normaliseMobile(event.target.value))} onPaste={event => {
                  const pasted = normaliseMobile(event.clipboardData.getData("text"));
                  if (isValidIndianMobile(pasted)) { event.preventDefault(); setMobile(pasted); }
                }} className="pl-[4.25rem]" {...accessibility("mobile")} />
              </div>
              <FieldError field="mobile" errors={errors} />
            </div>
            <div className="min-w-0">
              <Label htmlFor="enquiry-email" className={labelClass}>Email <span className="font-normal text-ink-mid">(optional)</span></Label>
              <Input id="enquiry-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" {...accessibility("email")} />
              <FieldError field="email" errors={errors} />
            </div>
          </div>
        </fieldset>

        <div className="rounded-xl border border-gold/25 bg-paper/60">
          <Button type="button" variant="ghost" isDisabled={busy} aria-expanded={budgetOpen} aria-controls="enquiry-budget" onPress={() => setBudgetOpen(value => !value)} className="h-auto min-h-14 w-full justify-between gap-3 whitespace-normal rounded-xl px-4 py-3.5 text-left text-ink hover:bg-gold/10 focus-visible:ring-2 focus-visible:ring-gold/40">
            <span className="flex items-center gap-3">
              <IndianRupee className="size-4 text-gold-ink" aria-hidden="true" />
              <span className="text-sm font-semibold">Have a budget in mind? <span className="font-normal text-ink-mid">(optional)</span></span>
            </span>
            <ChevronDown className={"size-4 text-ink-mid transition-transform motion-reduce:transition-none " + (budgetOpen ? "rotate-180" : "")} aria-hidden="true" />
          </Button>
          <Reveal id="enquiry-budget" open={budgetOpen}>
            <div className="border-t border-gold/20 px-4 pb-4 pt-4">
              <Label htmlFor="enquiry-budgetPerUnit" className={labelClass}>Budget per piece (₹)</Label>
              <Input id="enquiry-budgetPerUnit" name="budgetPerUnit" type="number" inputMode="decimal" min={0} step="0.01" placeholder="e.g. 150" disabled={!budgetOpen || busy} value={budget} onChange={event => setBudget(event.target.value)} {...accessibility("budgetPerUnit")} />
              <FieldError field="budgetPerUnit" errors={errors} />
              {total != null ? <p className="mt-3 text-sm text-ink-mid"><span aria-hidden="true">Estimated total <span className="font-semibold text-carbon">₹<span ref={totalRef}>{formatInr(total)}</span></span></span><span className="sr-only" role="status">Estimated total ₹{formatInr(total)}</span></p> : <p className={hintClass}>Add a quantity and budget to see an estimated total.</p>}
            </div>
          </Reveal>
        </div>

        <div>
          <Label htmlFor="enquiry-message" className={labelClass}>Anything we should know? <span className="font-normal text-ink-mid">(optional)</span></Label>
          <Textarea id="enquiry-message" name="message" rows={3} maxLength={2000} disabled={busy} placeholder="Your colours, ideas or special requests…" defaultValue={buildEnquiryMessage(enquiryProduct, "")} className="min-h-[104px] resize-y" {...accessibility("message")} />
          <FieldError field="message" errors={errors} />
        </div>

        <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px]" />
        <div className="space-y-3 border-t border-carbon/10 pt-5">
          {submitError !== null ? <div role="alert" className="rounded-xl border border-maroon/20 bg-maroon/[0.04] px-4 py-3 text-sm leading-6 text-maroon">
            {submitError || <>We could not send your enquiry. Please try again or <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-4">message us on WhatsApp</a>.</>}
          </div> : null}
          <Button type="submit" isDisabled={busy} className="h-12 w-full gap-2 rounded-xl bg-carbon px-6 text-base font-semibold text-white shadow-[0_4px_12px_-4px_rgba(123,28,46,0.35)] transition-colors hover:bg-carbon-dark focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 disabled:cursor-wait">
            {busy ? <><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Sending your enquiry…</> : <>Send enquiry <ArrowUpRight className="size-4" aria-hidden="true" /></>}
          </Button>
          <p className="flex items-center justify-center gap-2 text-center text-sm leading-5 text-ink-mid"><MessageCircle className="size-3.5 shrink-0" aria-hidden="true" /> Our team will call or message you back.</p>
          <p className="text-center text-xs text-ink-mid">Fields marked * are required.</p>
        </div>
      </CardContent>
    </form>
  );
}
