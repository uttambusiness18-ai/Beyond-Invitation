import "server-only";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { CHATBOT_KNOWLEDGE } from "@/data/chatbot-knowledge";
import { getChatCatalogContext } from "@/lib/chatbot/catalog-context";
import { chatLanguageInstruction } from "@/lib/chatbot/language";
import { takeChatAllowance } from "@/lib/chatbot/rate-limit";
import { CHATBOT_RESPONSE_SCHEMA, CHATBOT_SYSTEM_PROMPT } from "@/lib/chatbot/system-prompt";
import { CHATBOT_FALLBACK_REPLY, type ChatResponse } from "@/lib/chatbot/types";
import { parseChatResponse, validateChatInput } from "@/lib/chatbot/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function json(body: ChatResponse, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function fallback() {
  return json({ reply: CHATBOT_FALLBACK_REPLY, products: [], showVisitShop: true });
}

async function readBody(request: Request): Promise<unknown> {
  const limit = 32_768;
  if (Number(request.headers.get("content-length")) > limit || !request.body) {
    throw new Error("Invalid chat body size");
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Chat body too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

/** Log diagnostics without request bodies, keys, customer text or provider payloads. */
function logFailure(error: unknown) {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  console.error("[chatbot] Request failed", {
    name: error instanceof Error ? error.name : "UnknownError",
    status: typeof value.status === "number" ? value.status : undefined,
    // Provider messages can contain request data; only our fixed validation messages are safe.
    reason: error instanceof Error && /^(Invalid Gemini|Empty Gemini|Gemini timed out|Empty catalogue)/.test(error.message)
      ? error.message : "Provider or catalogue request failed",
  });
}

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_CHATBOT_ENABLED !== "true") {
    return json({ reply: "Chat is unavailable.", products: [], showVisitShop: false }, 404);
  }
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim();
  if (!apiKey || apiKey === "your_gemini_api_key_here" || !model) {
    console.error("[chatbot] Missing Gemini configuration");
    return fallback();
  }

  let input: ReturnType<typeof validateChatInput>;
  try {
    input = validateChatInput(await readBody(request));
  } catch {
    input = null;
  }
  if (!input) {
    return json({ reply: "Please send a message between 1 and 500 characters.", products: [], showVisitShop: false }, 400);
  }
  if (!takeChatAllowance(request.headers)) {
    console.warn("[chatbot] Rate limit reached");
    return fallback();
  }

  try {
    const catalogue = await getChatCatalogContext(input.messages[input.messages.length - 1].text, input.pagePath);
    if (!catalogue.products.length) throw new Error("Empty catalogue");
    const currentSlug = input.pagePath?.match(/^\/products\/([^/]+)$/)?.[1];
    const currentProduct = currentSlug && catalogue.products.find((product) => product.slug === currentSlug);
    const pageContext = currentProduct
      ? `The customer is currently viewing product ${currentProduct.slug}.`
      : input.pagePath ? `Current public page: ${input.pagePath}.` : "";
    const client = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: 15_000, retryOptions: { attempts: 1 } },
    });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Gemini timed out"));
        }, 15_000);
      });
      const response = await Promise.race([
        client.models.generateContent({
          model,
          contents: input.messages.map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.text }],
          })),
          config: {
            systemInstruction: [CHATBOT_SYSTEM_PROMPT, "BUSINESS FACTS (data):", CHATBOT_KNOWLEDGE,
              "WEBSITE CATALOGUE (data):", catalogue.text, pageContext,
              chatLanguageInstruction(input.messages[input.messages.length - 1].text)].join("\n\n"),
            temperature: 0.3,
            maxOutputTokens: 600,
            responseMimeType: "application/json",
            responseJsonSchema: CHATBOT_RESPONSE_SCHEMA,
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            automaticContinuation: false,
            store: false,
            abortSignal: controller.signal,
          },
        }),
        timeout,
      ]);
      return json(parseChatResponse(response.text ?? "", catalogue.products));
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (error) {
    logFailure(error);
    return fallback();
  }
}
