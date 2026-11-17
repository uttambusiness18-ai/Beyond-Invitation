import type { OrderTracking } from "./order-tracking-types";

export type TrackingStep = {
  id: string;
  label: string;
  state: "complete" | "current" | "upcoming" | "stopped";
  date: string | null;
};

export type TrackingProgress = {
  steps: TrackingStep[];
  notice: { title: string; description: string | null; tone: "warning" | "danger" | "neutral" } | null;
};

const milestones = [
  { id: "ordered", label: "Order placed" },
  { id: "preparing", label: "Preparing" },
  { id: "shipped", label: "Shipped" },
  { id: "out-for-delivery", label: "Out for delivery" },
  { id: "delivered", label: "Delivered" },
] as const;

function normalized(status: string): string {
  return status.trim().toUpperCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

type StatusKind = "normal" | "cancelled" | "return" | "issue" | "unknown";
type Status = { kind: StatusKind; stage: number | null };

/** Check exceptions first: "RTO delivered" and "undelivered" are not customer delivery. */
function classify(status: string): Status {
  const text = normalized(status);
  if (/\b(?:RTO|RETURN(?:ED|ING)?|RETURN TO (?:ORIGIN|SENDER))\b/.test(text)) return { kind: "return", stage: null };
  if (/\bCANCELL?ED\b/.test(text)) return { kind: "cancelled", stage: null };
  if (/\b(?:UNDELIVERED|NOT DELIVERED|PARTIAL(?:LY)? DELIVERED|DELAY(?:ED)?|EXCEPTION|FAILED|FAILURE|LOST|DAMAGED|DESTROYED|MISROUTED|NDR|HOLD|UNFULFILLABLE|CANCELLATION)\b/.test(text)) {
    return { kind: "issue", stage: null };
  }
  if (/^(?:(?:SHIPMENT|PARCEL|PACKAGE|CONSIGNMENT) )?DELIVERED(?: SUCCESSFULLY| TO CONSIGNEE)?[.!]?$/.test(text)) return { kind: "normal", stage: 4 };
  if (/^(?:(?:SHIPMENT|PARCEL|PACKAGE|CONSIGNMENT) )?OUT FOR DELIVERY[.!]?$/.test(text)) return { kind: "normal", stage: 3 };
  if (/^(?:(?:SHIPMENT|PARCEL|PACKAGE|CONSIGNMENT) )?(?:SHIPPED|IN TRANSIT|PICKED UP|HANDED OVER TO COURIER|HANDOVER TO COURIER|REACHED DESTINATION HUB)[.!]?$/.test(text)) return { kind: "normal", stage: 2 };
  if (/^(?:NEW|INVOICED|PREPARING|PACKED|READY TO SHIP|PICKUP SCHEDULED|PICKUP QUEUE|PICKUP RESCHEDULED|PICKUP BOOKED|OUT FOR PICKUP|BOOKED|AWB ASSIGNED|AWB GENERATED)$/.test(text)) return { kind: "normal", stage: 1 };
  if (/^(?:ORDER PLACED|ORDER RECEIVED|ORDER CONFIRMED)$/.test(text)) return { kind: "normal", stage: 0 };
  return { kind: "unknown", stage: null };
}

function validDate(value: string | null): string | null {
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

export function getOrderTrackingProgress(tracking: OrderTracking): TrackingProgress {
  if (tracking.state === "test_order") return {
    steps: [],
    notice: { title: "Test order", description: "This order has no live shipment to track.", tone: "neutral" },
  };

  // Dates describe actual scans only. A later stage can imply earlier progress,
  // but cannot supply the missing scan dates, or turn checkedAt into an event.
  const dates = new Map<number, string>();
  for (const event of tracking.events) {
    const status = classify(event.status);
    const date = validDate(event.date);
    if (status.kind !== "normal" || status.stage === null || !date) continue;
    const previous = dates.get(status.stage);
    if (!previous || Date.parse(date) < Date.parse(previous)) dates.set(status.stage, date);
  }

  const current = classify(tracking.status);
  const knownSteps = (): TrackingStep[] => milestones.flatMap((milestone, index) =>
    // A returned shipment's delivery to the sender must never become the
    // customer's Delivered milestone, even if an old scan just says Delivered.
    index < 4 && (index === 0 || dates.has(index))
      ? [{ ...milestone, state: "complete" as const, date: dates.get(index) ?? null }]
      : []);

  if (current.kind === "cancelled" || current.kind === "return") {
    const cancelled = current.kind === "cancelled";
    const statusText = normalized(tracking.status);
    const returned = /^(?:RTO DELIVERED|RETURN DELIVERED|RETURNED(?: TO SENDER)?|RETURN TO ORIGIN DELIVERED)$/.test(statusText);
    const date = tracking.events
      .filter((event) => normalized(event.status) === normalized(tracking.status) && validDate(event.date))
      .map((event) => event.date)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
    const label = cancelled ? "Shipment cancelled" : returned ? "Returned to sender"
      : /\bCANCELL?ED\b/.test(statusText) ? "Return cancelled"
        : /\b(?:UNDELIVERED|NOT DELIVERED|PARTIAL(?:LY)? DELIVERED|FAILED|DELAYED|LOST|DAMAGED)\b/.test(statusText)
          ? "Return needs attention" : "Return in progress";
    return {
      steps: [...knownSteps(), { id: cancelled ? "cancelled" : "return", label, state: "stopped", date }],
      notice: {
        title: label,
        description: cancelled
          ? null
          : "The courier reports a return. Contact us for the next steps for your order.",
        tone: cancelled ? "danger" : "warning",
      },
    };
  }

  const paymentPending = /\b(?:WAITING FOR|AWAITING|PENDING) PAYMENT\b|\bPAYMENT (?:PENDING|CONFIRMATION)\b/.test(normalized(tracking.status));
  if (current.kind === "issue") return {
    steps: knownSteps(),
    notice: { title: "Delivery needs attention", description: "Check the latest courier status. The next delivery update will appear when it is available.", tone: "warning" },
  };

  const stage = paymentPending ? 0
    : tracking.state === "preparing" || tracking.state === "awaiting_tracking" ? 1
      : current.stage;
  if (stage === null) return {
    steps: knownSteps(),
    notice: { title: "Waiting for the latest update", description: "Only confirmed milestones are shown. More progress will appear when the courier provides a delivery update.", tone: "neutral" },
  };

  if (stage === 4) {
    const deliveredAt = validDate(tracking.deliveredAt);
    if (deliveredAt) dates.set(4, deliveredAt);
  }
  return {
    steps: milestones.map((milestone, index) => ({
      ...milestone,
      state: index < stage || stage === 4 ? "complete" : index === stage ? "current" : "upcoming",
      // Current status takes precedence over stale, later-stage activity.
      date: index <= stage ? dates.get(index) ?? null : null,
    })),
    notice: paymentPending
      ? { title: "Awaiting payment confirmation", description: "Your order is placed. Preparation will begin after payment is confirmed.", tone: "neutral" }
      : tracking.state === "awaiting_tracking"
        ? { title: "Waiting for courier updates", description: "Your shipment is registered. Delivery progress will update when courier scans are available.", tone: "neutral" }
        : null,
  };
}
