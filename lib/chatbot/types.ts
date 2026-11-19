export type ChatMessage = { role: "user" | "assistant"; text: string };

export type ChatProduct = {
  slug: string;
  name: string;
  price: number;
  mrp: number;
  image: string;
  url: string;
};

export type ChatResponse = {
  reply: string;
  products: ChatProduct[];
  showVisitShop: boolean;
};

export const CHATBOT_FALLBACK_REPLY =
  "Our assistant is busy right now. Please message us on WhatsApp or visit our showroom.";
