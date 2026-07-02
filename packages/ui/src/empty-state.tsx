// DaisyUI 5: https://daisyui.com/components/hero/

import { Button, LinkButton } from "./button";
import { NavIcon } from "./nav-icons";

/**
 * Tone of the empty-state icon chip (R2 / content-api PV21). Colors the chip so
 * four empty states no longer read as identical grey blocks; the CTA stays the
 * standard primary action.
 */
type EmptyStateTone = "neutral" | "primary" | "info" | "success" | "warning";

// Tinted chip surface per tone: a soft brand wash behind a saturated glyph, the
// same low-opacity-fill + solid-foreground pattern the status badges use.
const chipToneClass: Record<EmptyStateTone, string> = {
  neutral: "bg-base-200 text-base-content/70",
  primary: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
};

/** Props for {@link EmptyState}. */
type EmptyStateProps = {
  /** Message explaining why the area is empty. */
  readonly message: string;
  /**
   * Registered icon name shown in a colored chip above the message (R2); register
   * in `nav-icons` first. Defaults to `Inbox`.
   */
  readonly icon?: string;
  /** Chip tone; defaults to `neutral`. */
  readonly tone?: EmptyStateTone;
  /** Label for the optional call-to-action control. */
  readonly cta?: string;
  /** Press handler for the CTA when it should act as a button. */
  readonly onCta?: () => void;
  /** Destination for the CTA when it should act as a link; takes precedence over `onCta`. */
  readonly ctaHref?: string;
};

/**
 * Centered empty-state placeholder with a toned icon chip, a message, and an optional call to action.
 *
 * @categoryDefault Feedback
 */

/** A centered empty-state placeholder with a colored icon chip, a message, and an optional CTA link or button. */
export function EmptyState({
  message,
  icon = "Inbox",
  tone = "neutral",
  cta,
  onCta,
  ctaHref,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-base-content/50">
      <span
        aria-hidden="true"
        className={`flex size-12 items-center justify-center rounded-box ${chipToneClass[tone]}`}
      >
        <NavIcon name={icon} variant="chip" />
      </span>
      <p className="text-sm">{message}</p>
      {cta && ctaHref && (
        <LinkButton href={ctaHref} iconName="Plus">
          {cta}
        </LinkButton>
      )}
      {cta && onCta && !ctaHref && (
        <Button variant="primary" onClick={onCta}>
          {cta}
        </Button>
      )}
    </div>
  );
}
