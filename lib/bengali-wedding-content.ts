import { CHATBOT_SHOWROOM } from "@/data/chatbot-knowledge";
import { MIN_ORDER_QUANTITY } from "@/lib/product-quantity";

export const BENGALI_KEYWORDS = [
  "Bengali Wedding Cards",
  "Bengali Wedding Invitation Cards",
  "Bengali Marriage Cards",
  "Bengali Wedding Cards Online",
  "Bengali Wedding Cards Kolkata",
  "Bengali Wedding Card Designs",
  "Traditional Bengali Wedding Cards",
  "Modern Bengali Wedding Cards",
  "Premium Bengali Wedding Cards",
  "Luxury Bengali Wedding Invitations",
  "Bengali Wedding Card Manufacturer",
  "Bengali Wedding Card Printing",
  "Bengali Wedding Card Shop Kolkata",
  "Buy Bengali Wedding Cards Online",
  "Bengali Bride and Groom Wedding Cards",
  "Bengali Pull Out Wedding Cards",
  "Bengali Shubho Bibaho Cards",
  "Bengali Wedding Cards with Price",
  "Affordable Bengali Wedding Cards",
  "Customized Bengali Wedding Cards",
  "Bengali Wedding Invitation Designs",
  "Bengali Biyer Card",
  "Bengali Wedding Cards Wholesale",
  "Designer Bengali Marriage Cards",
  "Bengali Wedding Invitation Kolkata",
] as const;

export const BENGALI_INTRO =
  "Explore Bengali wedding invitation cards for a celebration that feels personal to your family. Compare the designs and prices shown, then discuss Bengali wording, printing, quantity and finishing options with Beyond Invitation. Browse online or visit our Kolkata showroom to see samples and plan your Shubho Bibaho invitation with our team.";

export const BENGALI_FAQS = [
  {
    question: "Where can I buy Bengali wedding cards online or in Kolkata?",
    answer: `Browse the Bengali collection online and open a design to see its details and ordering options. You can also compare samples at the Beyond Invitation showroom at ${CHATBOT_SHOWROOM.address} Contact the team before ordering if you need printing, personalisation or a quotation.`,
  },
  {
    question: "Can I personalise my Biyer Card with Bengali wording?",
    answer:
      "Share your preferred Bengali wording, names, ceremony details and any additional language requirements with our team. Text, language, colour and finish options depend on the selected design. The team will confirm feasibility, printing costs and preparation time before you order.",
  },
  {
    question: "Do you have Bengali bride and groom or pull out wedding cards?",
    answer:
      "Contact us with a reference image or a design number if you want bride and groom artwork, a pull out format or a particular Shubho Bibaho style. The team can check the current options and confirm availability, personalisation and pricing for your quantity.",
  },
  {
    question: "Is printing included in Bengali wedding card prices?",
    answer:
      "Printing is not included in the listed product price. Printing costs depend on the selected card, number of impressions, printing method and any foil work. Compare the prices shown and request a quote for designs marked Price on request. Include printing and shipping when planning your total budget.",
  },
  {
    question: "Can I enquire about wholesale quantities or a bulk order?",
    answer: `Yes. Share your shortlisted designs and quantities with the team for a bulk or wholesale enquiry. Wedding cards start at ${MIN_ORDER_QUANTITY} pieces, in steps of 25; check the quantity selector on the product page. Pricing and any bulk terms must be confirmed for your order.`,
  },
  {
    question: "Who should I contact about manufacturing a custom Bengali wedding card?",
    answer:
      "Beyond Invitation is a brand of Bharat Agency Wedding Cards Pvt. Ltd. Send the team your design reference, quantity, material preferences and event date to discuss manufacturing options. The team will confirm whether the requested design can be produced, along with the costs and timing.",
  },
  {
    question: "Can Bengali wedding invitations be delivered outside Kolkata?",
    answer:
      "We deliver across India. Enter your delivery pincode in the cart or at checkout to check availability and the shipping estimate. Printing requires additional preparation time, and courier transit varies by location. Confirm the schedule for your chosen design, quantity and event date with the team before purchasing.",
  },
] as const;
