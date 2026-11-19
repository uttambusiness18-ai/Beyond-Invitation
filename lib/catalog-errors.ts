const unavailable = "The product catalogue is temporarily unavailable. Please try again shortly.";

/** Keep upstream HTML error documents out of logs and customer-facing errors. */
export function catalogueErrorMessage(error: unknown): string {
  const message = typeof error === "string" ? error
    : error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message : "";
  if (!message || /<!doctype|<\/?(?:html|head|body|title|script|div)\b/i.test(message)) return unavailable;
  return message.replace(/\s+/g, " ").trim().slice(0, 240);
}
