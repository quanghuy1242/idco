// DaisyUI 5: https://daisyui.com/components/hero/
"use client";

/**
 * Renders the standard top-of-page header with title, description, info popover, and actions.
 *
 * @categoryDefault Data Display
 */

import type { ReactNode } from "react";
import { Heading, Text } from "./typography";
import { InfoPopover } from "./info-popover";

/** Props for {@link PageIntro}. */
type PageIntroProps = {
  /** The screen title. */
  readonly title: string;
  /** One-line "what is this and what can I do here" helper text. */
  readonly description?: ReactNode;
  /** Extended teaching content shown behind an ⓘ next to the title. */
  readonly info?: ReactNode;
  /** Heading shown inside the info popover. */
  readonly infoTitle?: string;
  /** Right-aligned actions (primary CTA, etc.). */
  readonly actions?: ReactNode;
};

/**
 * Standard top-of-page header: title, a one-line description that orients the
 * user, an optional ⓘ teaching popover, and right-aligned actions. Every admin
 * screen should open with one so a first-time user knows what the page is for.
 */
export function PageIntro({
  title,
  description,
  info,
  infoTitle,
  actions,
}: PageIntroProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <Heading level="h1">{title}</Heading>
          {info ? (
            <InfoPopover
              title={infoTitle ?? title}
              label={`About ${title}`}
              placement="bottom"
              size="sm"
            >
              {info}
            </InfoPopover>
          ) : null}
        </div>
        {description ? (
          <Text variant="caption" as="p">
            {description}
          </Text>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
