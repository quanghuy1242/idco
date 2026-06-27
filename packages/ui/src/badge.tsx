// DaisyUI 5: https://daisyui.com/components/badge/
/**
 * Outlined label badge with tone and size variants.
 *
 * @categoryDefault Feedback
 */
import type { ReactNode } from "react";

/** Color intent of a badge, mapped to a DaisyUI `badge-*` color. */
type BadgeTone =
  | "neutral"
  | "primary"
  | "secondary"
  | "accent"
  | "success"
  | "warning"
  | "error"
  | "info";
/** Size of a badge; `md` is the default and `sm` is more compact. */
type BadgeSize = "sm" | "md";

/** Props for {@link Badge}. */
type BadgeProps = {
  /** Color intent of the badge; defaults to `neutral`. */
  readonly tone?: BadgeTone;
  /** Size of the badge; defaults to `md`. */
  readonly size?: BadgeSize;
  readonly children?: ReactNode;
};

const badgeClass: Record<BadgeTone, string> = {
  neutral: "badge-neutral",
  primary: "badge-primary",
  secondary: "badge-secondary",
  accent: "badge-accent",
  success: "badge-success",
  warning: "badge-warning",
  error: "badge-error",
  info: "badge-info",
};

const sizeClass: Record<BadgeSize, string> = {
  sm: "badge-sm",
  md: "",
};

/** An outlined label badge with tone and size variants. */
export function Badge({ tone = "neutral", size = "md", children }: BadgeProps) {
  return (
    <span
      className={`badge whitespace-nowrap ${sizeClass[size]} badge-outline ${badgeClass[tone]}`.trim()}
    >
      {children}
    </span>
  );
}
