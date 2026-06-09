// DaisyUI 5: https://daisyui.com/components/hero/
import { Inbox } from "lucide-react";
import { Button, LinkButton } from "./button";

type EmptyStateProps = {
  readonly message: string;
  readonly cta?: string;
  readonly onCta?: () => void;
  readonly ctaHref?: string;
};

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
