// DaisyUI 5: https://daisyui.com/components/hero/

import { Inbox } from "lucide-react";
import { Button, LinkButton } from "./button";

/** Props for {@link EmptyState}. */
type EmptyStateProps = {
  /** Message explaining why the area is empty. */
  readonly message: string;
  /** Label for the optional call-to-action control. */
  readonly cta?: string;
  /** Press handler for the CTA when it should act as a button. */
  readonly onCta?: () => void;
  /** Destination for the CTA when it should act as a link; takes precedence over `onCta`. */
  readonly ctaHref?: string;
};

/**
 * Centered empty-state placeholder with a message and an optional call to action.
 *
 * @categoryDefault Feedback
 */

/** A centered empty-state placeholder with a message and an optional CTA link or button. */
export function EmptyState({ message, cta, onCta, ctaHref }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-base-content/50">
      <Inbox className="h-10 w-10" aria-hidden="true" />
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
