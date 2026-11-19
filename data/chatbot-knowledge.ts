// Public facts only. Sources: app/visit-us/page.tsx, components/Footer.tsx,
// lib/faq.ts, app/about/page.tsx, app/terms-and-conditions/page.tsx,
// app/shipping-policy/page.tsx, app/refund-policy/page.tsx and README.md.
// Keep the showroom address independent of the outdated BUSINESS_ADDRESS.
export const CHATBOT_SHOWROOM: {
  address: string;
  hours: string | null;
  whatsappUrl: string;
  phone: string;
  email: string;
} = {
  address: "8, Jackson Lane, Canning Street, Kolkata 700001.",
  hours: null,
  whatsappUrl:
    "https://wa.me/917044815488?text=Hello%20Beyond%20Invitation%2C%20I%20would%20like%20to%20know%20more.",
  phone: "+91 70448 15488",
  email: "contact@khushionline.net",
};

export const CHATBOT_MISSING_FACTS = [
  "Showroom opening hours and days",
  "Shipped sample ordering process, price and delivery terms",
  "Destination-specific courier transit times",
] as const;

export const CHATBOT_KNOWLEDGE = `
Brand: Beyond Invitation, a brand of Bharat Agency Wedding Cards Pvt. Ltd.
Products: Wedding invitation cards, including Hindu, Muslim and Christian cards; shagun envelopes; wedding boxes; rakhi products; festive gifting stationery and packaging.
Showroom address: ${CHATBOT_SHOWROOM.address}
Phone / WhatsApp: ${CHATBOT_SHOWROOM.phone}. Landline: 033-22428918.
Email: ${CHATBOT_SHOWROOM.email}
Showroom opening hours and days: NOT PROVIDED.
Delivery areas: Across India. Online checkout accepts Indian delivery addresses only. Customers can check pincode availability and a shipping estimate in the cart or at checkout; the final shipping charge appears before payment.
Preparation / dispatch estimates: The shipping policy lists 3–4 days for our manufactured cards without printing. Printing requires additional time; during peak season, allow 10–12 days after approval of the printing matter. Orders are processed and dispatched on business days, excluding Sundays and public holidays. These are estimates, not delivery promises. The team must confirm timing for the design, quantity and event date.
Destination-specific courier transit times: NOT PROVIDED. Courier transit varies by location.
Minimum order quantity: Wedding cards start at 50 pieces, in steps of 25. Wedding boxes start at 25, in steps of 25. Shagun envelopes start at 50, in steps of 50. The product quantity selector shows the available increments.
Printing: Printing is not included in the listed product price. Its cost depends on the number of impressions, printing method, optional foil work and selected card. Contact the team to confirm printing details and costs before ordering.
Customisation of card text, language, colours and finish: Options depend on the design. The team must confirm feasibility, additional cost and time. A proof, preview, sample image or confirmation may be shared for approval. Changes after approval may cost extra, cause delays or be unavailable after production starts. Do not collect names or printing details in this chat; direct customers to the team.
Samples: Customers may compare wedding card samples, materials, printing and finishes at the Kolkata showroom. Those unable to visit should contact the team about available sample or preview options for their chosen design.
Shipped sample ordering process, price and delivery terms: NOT PROVIDED.
Payment methods: The published terms list online payment gateway, UPI, bank transfer, cash, card and wallet, subject to the methods made available by the team. Online payments use providers such as Razorpay. Do not imply every listed method is available for every order; customers should check the payment options offered at checkout or with the team.
Returns: No routine returns or exchanges. Printed and specially manufactured orders have restrictions. Damaged, defective or incorrect items require team review under the published policies; customers should contact the team within 48 hours of delivery with details and photographs through the contact channels. Refunds require approval. Approved cancelled-order refunds are processed within 21 working days from refund confirmation. Never promise a refund or replacement.
Ordering: Customers should open the chosen product page to select a design and quantity. For printing, customisation or Price on request items, contact the team to confirm details and costs first. This chat cannot place orders, accept payment or collect personal details.
Showroom visits: Customers can compare designs, materials and finishes in person and discuss bulk orders and special requirements with the team.
`.trim();
