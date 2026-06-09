// DaisyUI 5: https://daisyui.com/components/timeline/
import type { ReactNode } from "react";
import { NavIcon } from "./nav-icons";

export type TimelineTone =
  | "neutral"
  | "primary"
  | "success"
  | "warning"
  | "error"
  | "info";

export type TimelineItem = {
  readonly id: string;
  readonly icon?: string;
  readonly tone?: TimelineTone;
  readonly title: ReactNode;
  readonly meta?: string;
  readonly detail?: ReactNode;
};

type TimelineProps = {
  readonly items: ReadonlyArray<TimelineItem>;
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

export function Timeline({ items, compact }: TimelineProps) {
  return (
    <ul
      className={`timeline timeline-vertical timeline-compact ${compact ? "gap-0" : ""}`.trim()}
    >
      {items.map((item, index) => (
        <li key={item.id}>
          {index > 0 ? <hr className="bg-base-300" /> : null}
          <div
            className={`timeline-middle ${toneClass[item.tone ?? "neutral"]}`}
          >
            {item.icon ? (
              <NavIcon name={item.icon} />
            ) : (
              <span
                className="block size-2 rounded-full bg-current"
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
      ))}
    </ul>
  );
}
