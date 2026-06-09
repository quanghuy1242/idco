// DaisyUI 5: https://daisyui.com/components/badge/
import type { ReactNode } from "react";

type BadgeTone =
  | "neutral"
  | "primary"
  | "secondary"
  | "accent"
  | "success"
  | "warning"
  | "error"
  | "info";
type BadgeSize = "sm" | "md";

type BadgeProps = {
  readonly tone?: BadgeTone;
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

export function Badge({ tone = "neutral", size = "md", children }: BadgeProps) {
  return (
    <span
      className={`badge whitespace-nowrap ${sizeClass[size]} badge-outline ${badgeClass[tone]}`.trim()}
    >
      {children}
    </span>
  );
}
