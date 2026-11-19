"use client";

import dynamic from "next/dynamic";

const ChatWidget = dynamic(() => import("@/components/ChatWidget"), { ssr: false });

/** Keep the browser-only launcher out of the initial server render. */
export default function ChatWidgetLoader() {
  return process.env.NEXT_PUBLIC_CHATBOT_ENABLED === "true" ? <ChatWidget /> : null;
}
