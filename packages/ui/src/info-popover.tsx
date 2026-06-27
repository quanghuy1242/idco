// DaisyUI 5: https://daisyui.com/components/dropdown/
// React Aria: https://react-spectrum.adobe.com/react-aria/Popover.html
"use client";

/**
 * A click-to-open info popover overlay built on React Aria with DaisyUI styling.
 *
 * @categoryDefault Overlays
 */

import type { ReactNode } from "react";
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  Heading,
  OverlayArrow,
  Popover,
} from "react-aria-components";
import { CircleHelp, Info } from "lucide-react";

/** Side of the trigger the popover points to. */
type Placement = "top" | "bottom" | "left" | "right";
/** Which trigger glyph to show: `info` for ⓘ or `help` for a question mark. */
type IconKind = "info" | "help";
/** Size of the circular trigger button. */
type Size = "xs" | "sm";

/** Props for {@link InfoPopover}. */
type InfoPopoverProps = {
  /** Optional bold heading inside the popover. */
  readonly title?: string;
  /** Teaching content — what the thing is and when to use it. */
  readonly children: ReactNode;
  /** Accessible label for the trigger button. */
  readonly label?: string;
  readonly placement?: Placement;
  /** `info` = ⓘ, `help` = ⊙? (question mark). */
  readonly icon?: IconKind;
  readonly size?: Size;
};

const triggerSizeClass: Record<Size, string> = {
  xs: "btn-xs",
  sm: "btn-sm",
};

const iconSizeClass: Record<Size, string> = {
  xs: "size-3.5",
  sm: "size-4",
};

const panelClass =
  "z-50 w-72 max-w-[calc(100vw-2rem)] rounded-box border border-base-300 bg-base-100 p-4 shadow-lg " +
  "data-[entering]:animate-popover-in data-[exiting]:animate-popover-out";

/**
 * A click-to-open teaching bubble. Use the ⓘ next to a label, control, or
 * column header to explain what it is and when to use it. Unlike `Tooltip`,
 * this works on touch and keeps load-bearing guidance readable.
 */
export function InfoPopover({
  title,
  children,
  label = "More information",
  placement = "top",
  icon = "info",
  size = "xs",
}: InfoPopoverProps) {
  const Icon = icon === "help" ? CircleHelp : Info;
  return (
    <DialogTrigger>
      <AriaButton
        aria-label={label}
        className={`btn btn-circle btn-ghost ${triggerSizeClass[size]} align-middle text-base-content/40 hover:text-primary`}
      >
        <Icon className={iconSizeClass[size]} aria-hidden="true" />
      </AriaButton>
      <Popover placement={placement} offset={8} className={panelClass}>
        <OverlayArrow>
          <svg
            width={10}
            height={10}
            viewBox="0 0 10 10"
            className="block fill-base-100 stroke-base-300"
            aria-hidden="true"
          >
            <path d="M0 0 L5 5 L10 0" />
          </svg>
        </OverlayArrow>
        <Dialog className="outline-none">
          {title ? (
            <Heading
              slot="title"
              className="mb-1 text-sm font-semibold text-base-content"
            >
              {title}
            </Heading>
          ) : null}
          <div className="text-sm leading-relaxed text-base-content/70">
            {children}
          </div>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
