// DaisyUI 5 + React Aria: https://react-spectrum.adobe.com/react-aria/Popover.html
"use client";

/**
 * Anchored popover surfaces: React Aria Popover/Dialog behavior with the shared DaisyUI surface chrome.
 *
 * @categoryDefault Overlays
 */

import type { ReactNode, RefObject } from "react";
import {
  Dialog,
  DialogTrigger,
  Popover as AriaPopover,
  type PopoverProps,
} from "react-aria-components";

/**
 * Re-export of React Aria's `UNSAFE_PortalProvider` (from `react-aria`, a direct dependency of
 * this package; `react-aria-components` does not re-export it). It sets the portal container
 * every nested React Aria overlay — a `Select`/`ComboBox` listbox, a `Menu`, a nested `Popover` —
 * renders into. A consumer that hosts its own overlay layer (the editor's authority) wraps that
 * layer with it so nested overlays land inside the layer rather than `document.body`, keeping
 * containment checks accurate. Named `UNSAFE_` by React Aria because an arbitrary container can
 * break positioning; a transform-free, overflow-free container (the editor's overlay layer) is
 * the supported case.
 */
export { UNSAFE_PortalProvider } from "react-aria";

type Placement =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top start"
  | "top end"
  | "bottom start"
  | "bottom end";

/**
 * The canonical DaisyUI popover-surface chrome (the box: radius, border, base-100 fill, and
 * shadow) shared by every floating surface so they cannot drift. The padding, `z-index`, and
 * entrance/exit animation are layered on by each consumer because they vary: a React Aria
 * `Popover` toggles `animate-popover-in/out` through its `data-[entering]/[exiting]` states,
 * while a controlled surface (the editor's overlay layer) applies the entrance class directly.
 */
export const POPOVER_SURFACE_CLASS =
  "rounded-box border border-base-300 bg-base-100 shadow-lg";

const panelClass =
  `z-50 ${POPOVER_SURFACE_CLASS} p-3 ` +
  "data-[entering]:animate-popover-in data-[exiting]:animate-popover-out";

/**
 * A generic click-to-open popover: a trigger element plus dialog content, with React Aria's
 * focus management, outside-dismiss, and positioning. Unlike `MenuTrigger` (a list of actions)
 * this hosts arbitrary content such as a small form. `children` receives a `close` callback so
 * the content can dismiss the popover after committing.
 *
 * Modality is the caller's choice via `isNonModal`. A modal popover (the default) renders React
 * Aria's modal infrastructure — a body-portaled, pointer-events-capturing underlay plus
 * `aria-hidden` on the rest of the page — which is wrong for an anchored action/form popover
 * that must coexist with the surface beneath it; pass `isNonModal` for those. Outside press +
 * Escape dismiss either way.
 *
 * `shouldCloseOnInteractOutside` lets a non-modal caller decide which outside targets dismiss:
 * React Aria runs it on a pointer press outside *and* on focus leaving the popover
 * (`onBlurWithin`), so a surface that re-acquires focus on a press would otherwise read as an
 * outside interaction. Default behavior closes on any outside press.
 */
export function PopoverTrigger(props: {
  readonly trigger: ReactNode;
  readonly children: (close: () => void) => ReactNode;
  readonly placement?: Placement;
  readonly isOpen?: boolean;
  readonly onOpenChange?: (isOpen: boolean) => void;
  readonly ariaLabel?: string;
  readonly shouldCloseOnInteractOutside?: PopoverProps["shouldCloseOnInteractOutside"];
}) {
  const {
    trigger,
    children,
    placement = "bottom",
    isOpen,
    onOpenChange,
    shouldCloseOnInteractOutside,
  } = props;
  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
      {trigger}
      <AriaPopover
        className={panelClass}
        isNonModal
        offset={4}
        placement={placement}
        shouldCloseOnInteractOutside={shouldCloseOnInteractOutside}
      >
        <Dialog aria-label={props.ariaLabel} className="outline-none">
          {({ close }) => children(close)}
        </Dialog>
      </AriaPopover>
    </DialogTrigger>
  );
}

/**
 * A controlled popover anchored to an existing element (via `triggerRef`) rather than a trigger
 * child. Use when something other than a button press opens the panel — when open/closed is
 * driven by host state rather than a click on a trigger. Same React Aria focus management,
 * dismiss, and positioning.
 */
export function AnchoredPopover(props: {
  readonly triggerRef: RefObject<HTMLElement | null>;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly children: ReactNode;
  readonly placement?: Placement;
  readonly ariaLabel?: string;
  /**
   * Keep content outside the popover interactive. Use sparingly for anchored controls whose
   * anchor surface must keep handling pointer gestures while the popover is open.
   */
  readonly isNonModal?: PopoverProps["isNonModal"];
  /**
   * Whether an outside interaction dismisses the popover. Default React Aria behavior closes on
   * any outside press; pass a predicate to keep it open for chosen targets (e.g. while
   * interacting within a host region), or `() => false` to never self-dismiss.
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
