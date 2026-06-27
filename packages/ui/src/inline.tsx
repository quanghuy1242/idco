// Pure CSS flex row — no DaisyUI component. Token spacing via gap-* mapped from design tokens.
/**
 * A horizontal inline row primitive that maps typed spacing, alignment, and wrapping props onto a flex row.
 *
 * @categoryDefault Layout
 */
import type { ReactNode } from "react";

/** Spacing scale token for gaps between children. */
type Gap = "xs" | "sm" | "md" | "lg";
/** Cross-axis alignment token for row children. */
type Align = "start" | "center" | "end";
/** Main-axis distribution token for row children. */
type Justify = "start" | "center" | "between" | "end";

/** Props for {@link Inline}. */
type InlineProps = {
  /** Horizontal spacing between row children. */
  readonly gap?: Gap;
  /** Vertical (cross-axis) alignment of row children. */
  readonly align?: Align;
  /** Horizontal (main-axis) distribution of row children. */
  readonly justify?: Justify;
  /** Whether children wrap onto multiple lines when they overflow; defaults to wrapping. */
  readonly wrap?: boolean;
  readonly children?: ReactNode;
};

const gapClass: Record<Gap, string> = {
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
};

const alignClass: Record<Align, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
};

const justifyClass: Record<Justify, string> = {
  start: "justify-start",
  center: "justify-center",
  between: "justify-between",
  end: "justify-end",
};

/** A horizontal flex row that spaces, aligns, distributes, and optionally wraps its children. */
export function Inline({
  gap = "sm",
  align = "center",
  justify = "start",
  wrap = true,
  children,
}: InlineProps) {
  return (
    <div
      className={`flex flex-row ${alignClass[align]} ${justifyClass[justify]} ${wrap ? "flex-wrap" : "flex-nowrap"} ${gapClass[gap]}`}
    >
      {children}
    </div>
  );
}
