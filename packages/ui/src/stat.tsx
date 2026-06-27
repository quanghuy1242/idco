// DaisyUI 5: https://daisyui.com/components/stat/
/**
 * Statistic cards and their grouping containers using DaisyUI stat styling.
 *
 * @categoryDefault Feedback
 */
import type { ReactNode } from "react";
import { NavIcon } from "./nav-icons";

/** Color intent of a stat's value and figure. */
export type StatTone =
  | "neutral"
  | "primary"
  | "success"
  | "warning"
  | "error"
  | "info";
/** Number of columns in a grid stat group, or `auto` for a responsive default. */
export type StatColumns = "auto" | 2 | 3 | 4;
/** Arrangement of a stat group: a responsive `grid` or a horizontal `inline` strip. */
export type StatGroupLayout = "grid" | "inline";
/** Spacing density of a stat group's cards. */
export type StatGroupDensity = "comfortable" | "compact";
/** Whether a stat group draws its own bordered frame or sits seamlessly inline. */
export type StatGroupFrame = "standalone" | "seamless";

const columnsClass: Record<string, string> = {
  auto: "grid-cols-2 lg:grid-cols-4",
  "2": "grid-cols-1 sm:grid-cols-2",
  "3": "grid-cols-1 sm:grid-cols-3",
  "4": "grid-cols-2 lg:grid-cols-4",
};

const toneClass: Record<StatTone, string> = {
  neutral: "text-base-content",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
  info: "text-info",
};

/** Props for {@link StatGroup}. */
type StatGroupProps = {
  readonly children: ReactNode;
  /** Grid column count; ignored when `layout` is `inline`. Defaults to `auto`. */
  readonly columns?: StatColumns;
  /** Layout mode of the group; defaults to `grid`. */
  readonly layout?: StatGroupLayout;
  /** Card spacing density; defaults to `comfortable`. */
  readonly density?: StatGroupDensity;
  /** Whether the group draws its own frame; defaults to `standalone`. */
  readonly frame?: StatGroupFrame;
};

/** A responsive grid or inline strip of {@link Stat} cards. */
export function StatGroup({
  children,
  columns = "auto",
  layout = "grid",
  density = "comfortable",
  frame = "standalone",
}: StatGroupProps) {
  if (layout === "inline") {
    return (
      <div className="stats stats-horizontal w-fit max-w-full self-start border border-base-300 bg-base-100 shadow-none [&_.stat]:min-w-32 [&_.stat]:px-4 [&_.stat]:py-3 [&_.stat-value]:text-xl">
        {children}
      </div>
    );
  }

  const densityClass =
    density === "compact"
      ? "[&_.stat]:px-4 [&_.stat]:py-3 [&_.stat-value]:text-xl"
      : "";
  const frameClass =
    frame === "seamless"
      ? ""
      : "overflow-hidden rounded-box border border-base-300";
  return (
    <div
      className={`grid ${columnsClass[String(columns)]} gap-px bg-base-300 ${frameClass} ${densityClass}`.trim()}
    >
      {children}
    </div>
  );
}

/** Props for {@link StatSummaryGroup}. */
type StatSummaryGroupProps = {
  readonly children: ReactNode;
};

/** A vertically stacked, framed list of {@link Stat} cards for summary rows. */
export function StatSummaryGroup({ children }: StatSummaryGroupProps) {
  return (
    <div className="flex flex-col gap-px overflow-hidden rounded-box border border-base-300 bg-base-300">
      {children}
    </div>
  );
}

/** Props for {@link Stat}. */
type StatProps = {
  /** Label shown above the value. */
  readonly title: ReactNode;
  /** The primary statistic figure. */
  readonly value: ReactNode;
  /** Optional caption shown beneath the value. */
  readonly description?: ReactNode;
  /** Color intent of the value and figure; defaults to `neutral`. */
  readonly tone?: StatTone;
  /** Registered icon name to render in the stat figure. */
  readonly iconName?: string;
  /** Optional progress meter rendered below the value. */
  readonly meter?: { readonly value: number; readonly max: number };
};

/** A single DaisyUI stat card with title, value, and optional icon and meter. */
export function Stat({
  title,
  value,
  description,
  tone = "neutral",
  iconName,
  meter,
}: StatProps) {
  return (
    <div className="stat bg-base-100">
      {iconName ? (
        <div className={`stat-figure ${toneClass[tone]}`}>
          <NavIcon name={iconName} />
        </div>
      ) : null}
      <div className="stat-title text-base-content/60">{title}</div>
      <div className={`stat-value text-2xl ${toneClass[tone]}`}>{value}</div>
      {description ? (
        <div className="stat-desc text-base-content/50">{description}</div>
      ) : null}
      {meter ? (
        <meter
          aria-label={typeof title === "string" ? title : "meter"}
          className="mt-2 block h-2 w-full"
          value={meter.value}
          min={0}
          max={meter.max}
        />
      ) : null}
    </div>
  );
}
