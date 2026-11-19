"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Truck } from "lucide-react";
import { formatDeliveryEstimate, isValidIndianPincode } from "@/lib/shipping";
import { useCart } from "./CartProvider";
import { useShippingQuote } from "./useShippingQuote";

type Props = { slug: string; itemCode?: string; quantity: number };

export default function ProductDeliveryCheck({ slug, itemCode, quantity }: Props) {
  const { deliveryPincode, setDeliveryPincode } = useCart();
  const id = useId();
  const edited = useRef(false);
  const [pincode, setPincode] = useState(deliveryPincode);
  const [checkedPincode, setCheckedPincode] = useState("");
  const [validationError, setValidationError] = useState("");
  const shipping = useShippingQuote([{ slug, itemCode, quantity }], checkedPincode);
  const estimate = formatDeliveryEstimate(shipping.quote?.estimatedDeliveryDays);

  // Cart storage hydrates after the first render; only prefill an untouched input.
  useEffect(() => {
    if (!edited.current && isValidIndianPincode(deliveryPincode)) setPincode(deliveryPincode);
  }, [deliveryPincode]);

  useEffect(() => {
    if (shipping.quote) setDeliveryPincode(shipping.quote.pincode);
  }, [shipping.quote, setDeliveryPincode]);

  function checkDelivery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidIndianPincode(pincode)) {
      setValidationError("Enter a valid six-digit Indian pincode.");
      setCheckedPincode("");
      return;
    }
    setValidationError("");
    if (checkedPincode === pincode) shipping.refresh();
    else setCheckedPincode(pincode);
  }

  return (
    <section aria-labelledby={`${id}-title`} className="mt-6 rounded-2xl border border-gold/30 bg-white p-4 sm:p-5">
      <h3 id={`${id}-title`} className="flex items-center gap-2 text-base font-semibold text-carbon">
        <Truck size={20} aria-hidden="true" />
        Check delivery time
      </h3>
      <p id={`${id}-help`} className="mt-2 text-sm leading-relaxed text-carbon/70">
        Enter your pincode to check delivery for the selected quantity.
      </p>
      <form onSubmit={checkDelivery} noValidate className="mt-4">
        <label htmlFor={`${id}-pincode`} className="mb-2 block text-sm font-semibold text-carbon">
          Delivery pincode
        </label>
        <div className="flex gap-2">
          <input
            id={`${id}-pincode`}
            name="delivery-pincode"
            type="text"
            inputMode="numeric"
            autoComplete="postal-code"
            pattern="[1-9][0-9]{5}"
            maxLength={6}
            value={pincode}
            placeholder="6-digit pincode"
            aria-describedby={`${id}-help${validationError ? ` ${id}-error` : ""}`}
            aria-invalid={Boolean(validationError)}
            onChange={(event) => {
              edited.current = true;
              setPincode(event.target.value.replace(/\D/g, "").slice(0, 6));
              setCheckedPincode("");
              setValidationError("");
            }}
            className="min-w-0 flex-1 rounded-xl border border-gold/40 bg-white px-3 py-2.5 text-base text-carbon outline-none focus:border-carbon focus:ring-1 focus:ring-carbon"
          />
          <button
            type="submit"
            disabled={shipping.loading}
            className="shrink-0 rounded-xl bg-carbon px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-gold hover:text-carbon disabled:cursor-wait disabled:opacity-60"
          >
            {shipping.loading ? "Checking…" : shipping.error ? "Try again" : "Check"}
          </button>
        </div>
        {validationError && <p id={`${id}-error`} role="alert" className="mt-3 text-sm text-red-700">{validationError}</p>}
      </form>
      <div role="status" aria-live="polite" aria-atomic="true" className="text-sm leading-relaxed text-carbon">
        {shipping.loading && <p className="mt-3">Checking delivery to {checkedPincode}…</p>}
        {shipping.error && (
          <p className="mt-3 text-red-700">
            {shipping.error}{" "}
            <Link href={`/contact?product=${encodeURIComponent(slug)}`} className="font-semibold underline underline-offset-2">Contact us</Link>
          </p>
        )}
        {shipping.quote && (
          <div className="mt-4 rounded-xl bg-gold/10 px-3 py-3">
            <p className="font-semibold">Delivery available to {shipping.quote.pincode}</p>
            <p className="mt-1">
              {estimate ? <>Estimated delivery: <strong>{estimate}</strong></> : "An estimated delivery time is not available yet."}
            </p>
          </div>
        )}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-carbon/70">
        Preparation and personalisation time is additional. Delivery times are estimates.
      </p>
    </section>
  );
}
