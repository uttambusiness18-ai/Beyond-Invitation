import Link from "next/link";
import { CHATBOT_SHOWROOM } from "@/data/chatbot-knowledge";
import { BRAND_NAME } from "@/lib/site-config";

const linkClass = "font-medium text-maroon underline decoration-maroon/30 underline-offset-4 transition-colors hover:decoration-maroon";

export default function BengaliWeddingEditorial() {
  return (
    <section aria-labelledby="bengali-invitation-guide" className="mx-auto max-w-7xl px-4 pb-10 sm:px-6 sm:pb-14 lg:px-8">
      <div className="rounded-3xl border border-gold/20 bg-paper p-6 sm:p-9 lg:p-10">
        <h2 id="bengali-invitation-guide" className="max-w-3xl text-2xl font-semibold leading-snug tracking-tight text-maroon sm:text-3xl">
          Bengali marriage cards for your celebration
        </h2>
        <div className="mt-7 grid gap-x-10 gap-y-7 text-base leading-8 text-ink-mid lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-lg font-semibold text-maroon">Traditional and modern Bengali wedding card designs</h3>
            <p>
              Your Biyer Card introduces the celebration before your guests arrive. For a traditional Bengali wedding invitation,
              consider how your family&apos;s wording and a Shubho Bibaho heading will sit within the design. If you prefer modern
              Bengali wedding cards, look for a layout that gives names and ceremony details room to breathe. Compare the available
              designs and share the look you have in mind with our team.
            </p>
          </div>
          <div>
            <h3 className="mb-2 text-lg font-semibold text-maroon">Bride and groom artwork, pull out formats and personal details</h3>
            <p>
              Have a particular invitation in mind? Send a reference for Bengali bride and groom artwork, a pull out wedding card
              or another format you love. Our team can check the current options for your quantity. Discuss preferred Bengali
              wording, additional languages, colours and finishes before ordering; personalisation depends on the selected design
              and may involve additional cost and preparation time.
            </p>
          </div>
          <div>
            <h3 className="mb-2 text-lg font-semibold text-maroon">Plan an affordable, premium or luxury invitation</h3>
            <p>
              Start with your guest count and total stationery budget. Use the prices shown to compare shortlisted cards, and
              enquire about designs marked Price on request. For premium or luxury Bengali wedding invitations, discuss the
              materials, printing and finishing details you want. Printing is charged separately from the card price, so include
              printing, any personalisation and shipping when comparing the complete cost. A clear budget helps the team suggest
              suitable options.
            </p>
          </div>
          <div>
            <h3 className="mb-2 text-lg font-semibold text-maroon">Printing, manufacturing and wholesale enquiries</h3>
            <p>
              Beyond Invitation is a brand of {BRAND_NAME} For a large celebration, retail sourcing or a custom manufacturing
              enquiry, share the design reference, quantity and event date. The team will confirm which options can be supplied
              or produced and quote for the required printing. Wedding card printing costs depend on the method, impressions
              and optional foil work. <Link href="/contact" className={linkClass}>Discuss your card or bulk order</Link> before
              finalising the details.
            </p>
          </div>
          <div className="lg:col-span-2">
            <h3 className="mb-2 text-lg font-semibold text-maroon">Visit our Bengali wedding card shop in Kolkata</h3>
            <p>
              Compare samples, materials and finishes at our showroom at {CHATBOT_SHOWROOM.address}{" "}
              <Link href="/visit-us" className={linkClass}>Plan your showroom visit</Link> or continue browsing the{" "}
              <Link href="/wedding-cards" className={linkClass}>wedding card collection</Link> online. We deliver across India;
              check your pincode at checkout and confirm preparation time with the team. Read the{" "}
              <Link href="/shipping-policy" className={linkClass}>shipping policy</Link> when planning around your wedding date.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
