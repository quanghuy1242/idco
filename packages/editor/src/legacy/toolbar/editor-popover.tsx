import {
  Dialog as AriaDialog,
  Popover as AriaPopover,
  type DialogProps,
  type PopoverProps,
} from "react-aria-components";

const WIDTH = {
  sm: "w-72",
  md: "w-80",
} as const;

/**
 * The standard editor overlay: a React Aria `Popover` panel wrapping a
 * `Dialog`. Centralizes the DaisyUI popover styling and enter/exit animation
 * that the link/comment/glossary popovers each repeated, plus the
 * `data-editor-selection-action-popover` flag the toolbar's blur tracking keys
 * off (so formatting controls stay enabled while the popover holds focus).
 */
export function EditorPopover({
  children,
  width = "sm",
  placement = "bottom",
  offset = 8,
  isSelectionAction = false,
}: {
  readonly children: DialogProps["children"];
  readonly width?: keyof typeof WIDTH;
  readonly placement?: PopoverProps["placement"];
  readonly offset?: number;
  readonly isSelectionAction?: boolean;
}) {
  return (
    <AriaPopover
      placement={placement}
      offset={offset}
      className={`popover-panel z-[60] ${WIDTH[width]} data-[entering]:animate-popover-in data-[exiting]:animate-popover-out`}
      {...(isSelectionAction
        ? { "data-editor-selection-action-popover": "true" }
        : {})}
    >
      <AriaDialog className="outline-none">{children}</AriaDialog>
    </AriaPopover>
  );
}
