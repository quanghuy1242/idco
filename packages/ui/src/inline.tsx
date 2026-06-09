// Pure CSS flex row — no DaisyUI component. Token spacing via gap-* mapped from design tokens.
import type { ReactNode } from "react";

type Gap = "xs" | "sm" | "md" | "lg";
type Align = "start" | "center" | "end";
type Justify = "start" | "center" | "between" | "end";

type InlineProps = {
  readonly gap?: Gap;
  readonly align?: Align;
  readonly justify?: Justify;
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
