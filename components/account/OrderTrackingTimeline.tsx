import { AlertCircle, Check, ChevronDown, MapPin, Package, PackageCheck, ShoppingBag, Truck, X } from "lucide-react";
import type { OrderTracking } from "@/lib/order-tracking-types";
import type { TrackingProgress } from "@/lib/order-tracking-progress";
import styles from "./OrderTrackingTimeline.module.css";

type Props = {
  tracking: OrderTracking;
  formatDate: (value: string, includeTime?: boolean) => string | null;
};

function StepIcon({ label }: { label: string }) {
  const Icon = label === "Order placed" ? ShoppingBag
    : label === "Shipped" ? Truck
      : label === "Out for delivery" ? MapPin
        : label === "Delivered" ? PackageCheck : Package;
  return <Icon aria-hidden="true" size={16} strokeWidth={1.8} />;
}

export default function OrderTrackingTimeline({ progress, formatDate }: {
  progress: TrackingProgress;
  formatDate: Props["formatDate"];
}) {
  const { steps, notice } = progress;

  return (
    <div className={styles.root}>
      {notice && <div className={styles.notice} data-tone={notice.tone}>
        <AlertCircle aria-hidden="true" size={20} className={styles.noticeIcon} />
        <div>
          <p className={styles.noticeTitle}>{notice.title}</p>
          <p className={styles.noticeDescription}>{notice.description}</p>
        </div>
      </div>}
      {steps.length > 0 && <div className={styles.progress}>
        <h4 className={styles.heading}>Delivery progress</h4>
        <ol className={styles.steps} aria-label="Delivery progress">
          {steps.map((step, index) => {
            const date = step.date ? formatDate(step.date) : null;
            const next = steps[index + 1];
            const stateLabel = step.state === "complete" ? "Completed"
              : step.state === "current" ? "Current step"
                : step.state === "stopped" ? "Stopped" : "Upcoming";
            return (
              <li key={step.id} className={styles.step} data-state={step.state}
                data-tone={notice?.tone}
                data-connected={step.state === "complete" && next?.state !== "upcoming"}
                aria-current={step.state === "current" || step.state === "stopped" ? "step" : undefined}>
                <span className={styles.marker} aria-hidden="true">
                  {step.state === "complete" ? <Check size={16} strokeWidth={2.6} />
                    : step.state === "stopped" ? <X size={16} strokeWidth={2.3} />
                      : <StepIcon label={step.label} />}
                </span>
                <div className={styles.stepContent}>
                  <p className={styles.stepLabel}>{step.label}<span className="sr-only">: {stateLabel}</span></p>
                  {date ? <time dateTime={step.date!} className={styles.stepDate}>{date}</time>
                    : <p className={styles.stepDate} aria-hidden="true">{stateLabel}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      </div>}
    </div>
  );
}

export function CourierActivityTimeline({ tracking, formatDate }: Props) {
  if (!tracking.events.length) return null;
  const events = [...tracking.events].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  return (
    <details className={styles.activity} open>
      <summary className={styles.activitySummary}>
        <span>Courier activity <span className={styles.count}>{events.length}</span></span>
        <ChevronDown size={18} aria-hidden="true" className={styles.chevron} />
      </summary>
      <p className={styles.activityHint}>Latest update first · All times in India time</p>
      <ol className={styles.events} aria-label="Courier activity, latest first">
        {events.map((event, index) => {
          const date = formatDate(event.date);
          return (
            <li key={`${event.date}-${index}`} className={styles.event}>
              <span aria-hidden="true" className={styles.eventDot} />
              <p className={styles.eventStatus}>{event.status}</p>
              {event.location && <p className={styles.eventLocation}>{event.location}</p>}
              {date && <time dateTime={event.date} className={styles.eventDate}>{date}</time>}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
