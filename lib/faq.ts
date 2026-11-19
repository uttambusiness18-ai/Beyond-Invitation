import { MIN_ORDER_QUANTITY, WEDDING_BOX_MIN_ORDER_QUANTITY } from "@/lib/product-quantity";

export type FaqItem = {
  id: string;
  question: string;
  answer: string;
  links?: { label: string; href: string }[];
};

// Keep answers aligned with the product page, checkout and published policies.
export const faqItems: FaqItem[] = [
  {
    id: "place-order",
    question: "How do I place an order?",
    answer: "Choose a design and quantity, add it to your cart, and enter your delivery pincode to check shipping. Complete your contact and address details at checkout, then make your payment. You can check out as a guest. For printing, personalisation or a design marked Price on request, contact our team to confirm the details and costs first.",
    links: [{ label: "Browse the catalogue", href: "/catalog" }],
  },
  {
    id: "minimum-order",
    question: "What is the minimum order quantity?",
    answer: `Wedding cards start at ${MIN_ORDER_QUANTITY} pieces, in steps of 25. Wedding boxes start at ${WEDDING_BOX_MIN_ORDER_QUANTITY}, in steps of 25, and shagun envelopes start at ${MIN_ORDER_QUANTITY}, in steps of 50. Each product’s quantity selector shows the available increments.`,
  },
  {
    id: "printing-cost",
    question: "Is printing included in the listed price?",
    answer: "Printing is not included in the listed product price. The cost depends on the number of impressions, printing method, optional foil work and selected card. Share your design and requirements with our team to confirm the printing cost before ordering.",
    links: [{ label: "Ask about printing", href: "/contact" }],
  },
  {
    id: "personalise-design",
    question: "Can I personalise the wording, colours or finish?",
    answer: "Options depend on the design. Share your names, event details, preferred language, colours and any artwork or finishing ideas with our team. We will confirm what is possible, along with any additional cost and time required.",
    links: [{ label: "Discuss personalisation", href: "/contact" }],
  },
  {
    id: "see-samples",
    question: "Can I see a sample before placing an order?",
    answer: "You can compare wedding card samples, materials, printing and finishes at our Kolkata showroom. If you cannot visit, contact us with the design you like to discuss available sample or preview options before ordering.",
    links: [{ label: "Showroom details", href: "/visit-us" }],
  },
  {
    id: "delivery-locations",
    question: "Where do you deliver, and how much does shipping cost?",
    answer: "We deliver across India. Enter your pincode in the cart or at checkout to check delivery availability and the shipping estimate for your items and quantities. The final shipping charge is shown before payment. Online checkout accepts Indian delivery addresses only.",
    links: [{ label: "Check shipping in your cart", href: "/cart" }],
  },
  {
    id: "delivery-timing",
    question: "How long will my order take?",
    answer: "Our shipping policy lists 3–4 days for our manufactured cards without printing. Printing needs additional time; during peak season, allow 10–12 days after approval of the printing matter. Courier transit varies by location. Confirm the timing for your design, quantity and event date with our team before purchasing.",
    links: [{ label: "Shipping policy", href: "/shipping-policy" }],
  },
  {
    id: "track-order",
    question: "How can I track my order?",
    answer: "Open the private tracking link saved from your order confirmation for parcel progress and courier updates. If you ordered while signed in, you can also view the order in your account. If your tracking link is missing or incomplete, contact us with your order reference.",
    links: [{ label: "View account orders", href: "/account#orders" }],
  },
  {
    id: "returns-refunds",
    question: "Can I return an order or get a refund?",
    answer: "We do not offer routine returns or exchanges. Printed and specially manufactured orders have restrictions. Damaged, defective or incorrect items require review under our published policies. Refunds are subject to approval; approved cancelled-order refunds are processed within 21 working days from refund confirmation.",
    links: [{ label: "Refund policy", href: "/refund-policy" }],
  },
  {
    id: "damaged-order",
    question: "What if my order arrives damaged or incorrect?",
    answer: "If a parcel looks damaged, opened or tampered with at delivery, our shipping policy recommends refusing it and notifying us immediately. For damaged, defective or incorrect items received, contact us within 48 hours of delivery with your order details and clear photographs. Our team will review the issue and confirm the applicable resolution.",
    links: [{ label: "Report an order issue", href: "/contact" }],
  },
];
