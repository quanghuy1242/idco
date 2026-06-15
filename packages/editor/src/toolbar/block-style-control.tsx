import { Menu, MenuItem, MenuTrigger, NavIcon } from "@quanghuy1242/idco-ui";
import { $setSelection, type BaseSelection } from "lexical";
import { useState } from "react";
import { Button as AriaButton, type PopoverProps } from "react-aria-components";
import {
  applyBlockStyle,
  availableBlockStyles,
  type BlockStyleId,
  type CommandContext,
} from "../model/commands";

/**
 * The "Turn into" block-style menu, shared by the main toolbar (`variant="full"`,
 * shows the current style's label) and the selection flyout (`variant="compact"`,
 * icon only). When a `getSelectionSnapshot` is provided (flyout/overlay use) the
 * snapshot is restored before converting so the action targets the originally
 * selected block even though opening the menu moved focus.
 */
export function BlockStyleControl({
  ctx,
  getSelectionSnapshot,
  isDisabled,
  onApplied,
  onOpenChange,
  shouldCloseOnInteractOutside,
  variant = "full",
}: {
  readonly ctx: CommandContext;
  readonly getSelectionSnapshot?: () => BaseSelection | null;
  readonly isDisabled?: boolean;
  readonly onApplied?: () => void;
  readonly onOpenChange?: (open: boolean) => void;
  readonly shouldCloseOnInteractOutside?: PopoverProps["shouldCloseOnInteractOutside"];
  readonly variant?: "full" | "compact";
}) {
  const [open, setOpen] = useState(false);
  const choices = availableBlockStyles(ctx.allowedNodes);
  if (choices.length <= 1) return null;
  const current = choices.find((option) => option.id === ctx.blockKind);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  const apply = (id: BlockStyleId) => {
    const snapshot = getSelectionSnapshot?.();
    if (snapshot) {
      ctx.editor.update(() => {
        try {
          $setSelection(snapshot.clone());
        } catch {
          /* selection no longer resolvable — fall through to live selection */
        }
      });
    }
    applyBlockStyle(ctx.editor, ctx.blockKind, id);
    handleOpenChange(false);
    onApplied?.();
  };

  return (
    <MenuTrigger
      isOpen={open}
      onOpenChange={handleOpenChange}
      placement="bottom start"
      shouldCloseOnInteractOutside={shouldCloseOnInteractOutside}
    >
      <AriaButton
        aria-label="Text style"
        isDisabled={isDisabled}
        // Keep the editor selection when the trigger is pressed (matters in the
        // non-modal flyout, where losing it would drop the target block).
        onMouseDown={(event) => event.preventDefault()}
        className={
          variant === "full"
            ? "btn btn-sm btn-ghost w-40 justify-start gap-2"
            : "btn btn-sm btn-ghost gap-1.5"
        }
      >
        <NavIcon name={current?.icon ?? "Pilcrow"} />
        {variant === "full" ? (
          <span className="flex-1 truncate text-left">
            {current?.label ?? "Text style"}
          </span>
        ) : null}
        <NavIcon name="ChevronDown" />
      </AriaButton>
      <Menu aria-label="Text style" className="w-56">
        {choices.map((option) => (
          <MenuItem
            key={option.id}
            id={option.id}
            textValue={option.label}
            onAction={() => apply(option.id)}
          >
            <span className="flex items-center gap-3">
              <NavIcon name={option.icon} />
              <span className={`leading-tight ${option.preview}`}>
                {option.label}
              </span>
            </span>
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}
