"use client";

import { useEffect, useRef } from "react";
import { useContactMotion } from "@/components/contact/ContactMotion";
import { Button, LinkButton } from "@/components/ui/button";
import { ArrowUpRight } from "lucide-react";

export default function EnquirySuccess({
  name,
  mobile,
  whatsappUrl,
  onReset,
}: {
  name: string;
  mobile: string;
  whatsappUrl: string;
  onReset: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const motion = useContactMotion();

  useEffect(() => {
    if (svgRef.current) motion.drawCheck(svgRef.current);
    panelRef.current?.focus({ preventScroll: true });
  }, [motion]);

  return (
    <div
      ref={panelRef}
      role="status"
      tabIndex={-1}
      data-enquiry-success
      className="bg-paper/40 px-6 py-12 text-center outline-none sm:px-8 sm:py-16"
    >
      <svg
        ref={svgRef}
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
        className="mx-auto h-16 w-16 text-carbon"
      >
        <circle
          cx="32"
          cy="32"
          r="28"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="m20 32 8 8 16-17"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div data-success-content>
      <h2
        className="mt-6 text-3xl font-normal tracking-tight text-maroon outline-none [font-family:Georgia,'Times_New_Roman',serif]"
      >
        Thank you, {name.trim().split(/\s+/)[0] || "there"}.
      </h2>
      <p className="mt-3 text-base leading-8 text-ink-mid">
        {mobile
          ? `Our team will contact you on +91 ${mobile}.`
          : "Our team will be in touch."}
      </p>
      <div className="mt-8 flex flex-col items-stretch gap-3">
        <LinkButton
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="h-12 gap-2 rounded-xl bg-carbon px-6 text-base font-semibold text-white hover:bg-carbon-dark focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2"
        >
          Chat on WhatsApp <ArrowUpRight className="size-4" aria-hidden="true" />
        </LinkButton>
        <Button
          type="button"
          variant="outline"
          onPress={onReset}
          className="h-12 rounded-xl border-carbon/20 bg-white px-6 text-base font-semibold text-carbon hover:bg-paper hover:text-carbon focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2"
        >
          Send another enquiry
        </Button>
      </div>
      </div>
    </div>
  );
}
