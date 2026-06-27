// DaisyUI 5: https://daisyui.com/components/tooltip/
// React Aria: https://react-spectrum.adobe.com/react-aria/Tooltip.html
"use client";

/**
 * A hover/focus tooltip overlay built on React Aria with DaisyUI styling.
 *
 * @categoryDefault Overlays
 */

import type { ReactNode } from "react";
import {
  Tooltip as AriaTooltip,
  TooltipTrigger as AriaTooltipTrigger,
  OverlayArrow,
} from "react-aria-components";

/** Side of the trigger the tooltip points to. */
type Placement = "top" | "bottom" | "left" | "right";

/** Props for {@link Tooltip}. */
type TooltipProps = {
  /** The text shown inside the tooltip. When empty, the trigger renders without a tooltip. */
  readonly content?: ReactNode;
  /** Side of the trigger the tooltip points to. */
  readonly placement?: Placement;
  /** Hover warmup delay in ms before the tooltip appears. */
  readonly delay?: number;
  /** The focusable trigger element (e.g. a `Button`). */
  readonly children: ReactNode;
};

const tooltipPanelClass =
  "z-[60] max-w-xs rounded-field bg-neutral px-2.5 py-1.5 text-xs font-medium leading-snug text-neutral-content shadow-lg " +
  "data-[entering]:animate-popover-in data-[exiting]:animate-popover-out";

/**
 * Hover/focus tooltip for icon buttons and terse controls. Tooltips do not
 * appear on touch — never put load-bearing information here; use `InfoPopover`
 * for teaching content the user must be able to read.
 *
 * @example
 * ```tsx
 * <Tooltip content="Delete" placement="bottom">
 *   <Button variant="ghost" iconName="trash" aria-label="Delete" />
 * </Tooltip>
 * ```
 */
export function Tooltip({
  content,
  placement = "top",
  delay = 500,
  children,
}: TooltipProps) {
  if (content === undefined || content === null || content === "") {
    return <>{children}</>;
  }
  return (
    <AriaTooltipTrigger delay={delay} closeDelay={0}>
      {children}
      <AriaTooltip
        offset={8}
        placement={placement}
        className={tooltipPanelClass}
      >
        <OverlayArrow>
          <svg
            width={8}
            height={8}
            viewBox="0 0 8 8"
            className="block fill-neutral"
            aria-hidden="true"
          >
            <path d="M0 0 L4 4 L8 0" />
          </svg>
        </OverlayArrow>
        {content}
      </AriaTooltip>
    </AriaTooltipTrigger>
  );
}
