// DaisyUI 5 + React Aria: https://react-spectrum.adobe.com/react-aria/Popover.html
"use client";

import type { ReactNode, RefObject } from "react";
import {
  Dialog,
  DialogTrigger,
  Popover as AriaPopover,
  type PopoverProps,
} from "react-aria-components";

type Placement =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top start"
  | "top end"
  | "bottom start"
  | "bottom end";

const panelClass =
  "z-50 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg " +
  "data-[entering]:animate-popover-in data-[exiting]:animate-popover-out";

/**
 * A generic click-to-open popover: a trigger element plus dialog content, with
 * React Aria's focus management, outside-dismiss, and positioning. Unlike
 * `MenuTrigger` (a list of actions) this hosts arbitrary content such as a small
 * form (e.g. a link editor). `children` receives a `close` callback so the
 * content can dismiss the popover after committing.
 */
export function PopoverTrigger(props: {
  readonly trigger: ReactNode;
  readonly children: (close: () => void) => ReactNode;
  readonly placement?: Placement;
  readonly isOpen?: boolean;
  readonly onOpenChange?: (isOpen: boolean) => void;
  readonly ariaLabel?: string;
}) {
  const {
    trigger,
    children,
    placement = "bottom",
    isOpen,
    onOpenChange,
  } = props;
  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
      {trigger}
      <AriaPopover className={panelClass} offset={4} placement={placement}>
        <Dialog aria-label={props.ariaLabel} className="outline-none">
          {({ close }) => children(close)}
        </Dialog>
      </AriaPopover>
    </DialogTrigger>
  );
}

/**
 * A controlled popover anchored to an existing element (via `triggerRef`) rather
 * than a trigger child. Use when something other than a button press opens the
 * panel — e.g. an editor object that opens its config when it becomes the active
 * object. Same React Aria focus management, dismiss, and positioning.
 */
export function AnchoredPopover(props: {
  readonly triggerRef: RefObject<HTMLElement | null>;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly children: ReactNode;
  readonly placement?: Placement;
  readonly ariaLabel?: string;
  /**
   * Keep the page/editor outside the popover interactive. Use sparingly for
   * anchored controls like editor chrome where the anchor surface must keep
   * handling pointer gestures while the popover is open.
   */
  readonly isNonModal?: PopoverProps["isNonModal"];
  /**
   * Whether an outside interaction dismisses the popover. Default React Aria
   * behavior closes on any outside press; pass a predicate (e.g. keep open while
   * interacting within a host region) for non-modal surfaces like an in-editor
   * find bar that must survive clicks into the document.
   */
  readonly shouldCloseOnInteractOutside?: PopoverProps["shouldCloseOnInteractOutside"];
}) {
  const {
    triggerRef,
    isOpen,
    onOpenChange,
    children,
    placement = "bottom",
    isNonModal,
    shouldCloseOnInteractOutside,
  } = props;
  return (
    <AriaPopover
      className={panelClass}
      isNonModal={isNonModal}
      isOpen={isOpen}
      offset={4}
      onOpenChange={onOpenChange}
      placement={placement}
      shouldCloseOnInteractOutside={shouldCloseOnInteractOutside}
      triggerRef={triggerRef}
    >
      <Dialog aria-label={props.ariaLabel} className="outline-none">
        {children}
      </Dialog>
    </AriaPopover>
  );
}
