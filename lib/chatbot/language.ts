/** Reinforce the customer's script after the long English catalogue context. */
export function chatLanguageInstruction(message: string): string {
  if (/[\u0980-\u09ff]/.test(message)) {
    return "For this response, write reply entirely in Bengali using Bengali script. Do not translate the reply into English. Keep product_slugs exactly as listed.";
  }
  if (/[\u0900-\u097f]/.test(message)) {
    return "For this response, write reply entirely in Hindi using Devanagari script. Do not translate the reply into English. Keep product_slugs exactly as listed.";
  }
  if (/\b(biyer|biye|bangla|bangali|dekhan|dekhao|chai|modhye|madhye)\b/i.test(message)) {
    return "For this response, write reply in conversational Bengali typed in English letters, matching the customer's Roman Bengali. Keep product_slugs exactly as listed.";
  }
  if (/\b(shadi|shaadi|dikhao|dikhaiye|dikhaye|chahiye|chaiye|mujhe|mujhko|kaise|kahan|kitna|kitne|rupaye)\b/i.test(message)) {
    return "For this response, write reply in conversational Hindi typed in English letters, matching the customer's Roman Hindi. Do not switch to an English reply. Keep product_slugs exactly as listed.";
  }
  return "For this response, match the language and script of the customer's latest message. Use English when the message is English or its language is unclear.";
}
