// DaisyUI 5: https://daisyui.com/components/timeline/
/**
 * Vertical timeline of events with tone-driven markers and DaisyUI styling.
 *
 * @categoryDefault Feedback
 */
import type { ReactNode } from "react";
import { NavIcon } from "./nav-icons";

/** Color intent of a timeline entry's marker. */
export type TimelineTone =
  | "neutral"
  | "primary"
  | "success"
  | "warning"
  | "error"
  | "info";

/** A single entry in a {@link Timeline}. */
export type TimelineItem = {
  /** Stable React key for the entry. */
  readonly id: string;
  /** Registered icon name to render inside the marker; falls back to a plain dot. */
  readonly icon?: string;
  /** Color intent of the marker; defaults to `neutral`. */
  readonly tone?: TimelineTone;
  /** Headline of the entry. */
  readonly title: ReactNode;
  /** Optional secondary line, typically a timestamp. */
  readonly meta?: string;
  /** Optional expanded body shown below the title. */
  readonly detail?: ReactNode;
};

/** Props for {@link Timeline}. */
type TimelineProps = {
  /** Ordered entries to render, top to bottom. */
  readonly items: ReadonlyArray<TimelineItem>;
  /** Tightens vertical spacing between entries when set. */
  readonly compact?: boolean;
};

const toneClass: Record<TimelineTone, string> = {
  neutral: "text-base-content/40",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
  info: "text-info",
};

const markerClass: Record<TimelineTone, string> = {
  neutral: "bg-base-content text-base-100",
  primary: "bg-primary text-primary-content",
  success: "bg-success text-success-content",
  warning: "bg-warning text-warning-content",
  error: "bg-error text-error-content",
  info: "bg-info text-info-content",
};

/** A vertical timeline of events with tone-driven markers. */
export function Timeline({ items, compact }: TimelineProps) {
  return (
    <ul
      className={`timeline timeline-snap-icon timeline-vertical timeline-compact ${compact ? "gap-0" : ""}`.trim()}
    >
      {items.map((item, index) => {
        const tone = item.tone ?? "neutral";
        return (
          <li key={item.id}>
            {index > 0 ? <hr className="bg-base-300" /> : null}
            <div className={`timeline-middle ${toneClass[tone]}`}>
              {item.icon ? (
                <span
                  className={`flex size-4 items-center justify-center rounded-full ${markerClass[tone]}`}
                  aria-hidden="true"
                >
                  <NavIcon name={item.icon} variant="timeline" />
                </span>
              ) : (
                <span
                  className={`block size-4 rounded-full ${markerClass[tone]}`}
                  aria-hidden="true"
                />
              )}
            </div>
            <div className={`timeline-end ${compact ? "mb-2" : "mb-4"}`}>
              <div className="text-sm font-medium text-base-content">
                {item.title}
              </div>
              {item.meta ? (
                <div className="text-xs text-base-content/50">{item.meta}</div>
              ) : null}
              {item.detail ? (
                <div className="mt-1 text-sm text-base-content/70">
                  {item.detail}
                </div>
              ) : null}
            </div>
            {index < items.length - 1 ? <hr className="bg-base-300" /> : null}
          </li>
        );
      })}
    </ul>
  );
}
