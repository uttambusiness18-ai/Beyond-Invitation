import "server-only";
import { createHash, randomBytes } from "node:crypto";

type Counter = { dayCount: number; recent: number[] };

/** Per-process limits; counters are intentionally ephemeral, with no chat logs. */
export class ChatRateLimiter {
  private counters = new Map<string, Counter>();
  private day = "";
  private total = 0;

  take(key: string, dailyLimit: number, now = Date.now()): boolean {
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.counters.clear();
      this.total = 0;
      this.day = day;
    }
    if (this.total >= dailyLimit) return false;
    const counter = this.counters.get(key) ?? { dayCount: 0, recent: [] };
    counter.recent = counter.recent.filter((time) => time > now - 60_000);
    if (counter.dayCount >= 40 || counter.recent.length >= 8) return false;
    // Bound memory even with an accidentally enormous global cap.
    if (!this.counters.has(key) && this.counters.size >= 10_000) return false;
    counter.dayCount += 1;
    counter.recent.push(now);
    this.counters.set(key, counter);
    this.total += 1;
    return true;
  }
}

const limiter = new ChatRateLimiter();
const salt = randomBytes(32);

export function takeChatAllowance(headers: Headers): boolean {
  // Hosting must replace forwarded IP headers at its trusted proxy boundary.
  const forwarded = process.env.VERCEL === "1"
    ? headers.get("x-vercel-forwarded-for") || headers.get("x-forwarded-for")
    : headers.get("x-forwarded-for") || headers.get("x-real-ip");
  const ip = forwarded?.split(",")[0].trim().slice(0, 64) || "local";
  const key = createHash("sha256").update(salt).update(ip).digest("hex");
  const configured = Number(process.env.CHATBOT_DAILY_LIMIT ?? "800");
  const cap = Number.isSafeInteger(configured) && configured >= 0 ? configured : 800;
  return limiter.take(key, cap);
}
