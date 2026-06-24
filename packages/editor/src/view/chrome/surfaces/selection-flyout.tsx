/**
 * Selection flyout (docs/024 §7.2) — a floating command bar over a non-collapsed text
 * selection, the owned-engine reimplementation of the legacy `selection-flyout-plugin`.
 *
 * It is *fed by the same projector* as every other surface: `resolveCommandList("flyout",
 * ctx)` returns the inline formats + `annotate` (link) the flyout shows; this host holds
 * no command list (docs/024 §4). Triggering, geometry, and conflict resolution:
 *
 * - **Trigger** is owned by the coordinator (`useCommandSurfaces`): a settled
 *   non-collapsed text selection with no active object and no higher-priority surface
 *   open (docs/024 §7.2/§8). This host renders when `open` is true.
 * - **Geometry**: anchored at the *start* of the selection (the legacy bias so the bar
 *   does not cover the selected run, docs/024 §9), via `caretClientRect` over the start
 *   leaf's mounted element. A React Aria `Popover` (`AnchoredPopover`) flips near the
 *   viewport top automatically.
 * - **Non-modal** (`isNonModal`): the painted caret stays visible and the model
 *   selection persists while the bar is open — essential, since the bar sits over the
 *   very selection it formats (docs/024 §8).
 * - **Child-overlay safe**: a child popover (the link editor) must not dismiss the
 *   flyout; `shouldCloseOnInteractOutside` keeps it open while the pointer is inside the
 *   flyout or a marked child overlay (docs/024 §8 — the legacy `data-...-action-popover`
 *   guard generalized).
 *
 * React Aria `Toolbar` gives the bar roving-tabindex keyboard behavior; commands apply
 * to the live model selection, which survives the bar's focus (docs/011 §8.6).
 */
import { useRef } from "react";
import { Toolbar as AriaToolbar } from "react-aria-components";
import { AnchoredPopover, Button, PopoverTrigger } from "@quanghuy1242/idco-ui";
import type { EditorStore } from "../../../core";
import { caretClientRect } from "../../overlays";
import {
  resolveCommandList,
  type CommandContext,
  type ResolvedCommand,
} from "../../spi";

/** The viewport rect of the selection's start caret, or null when unmounted. */
function selectionStartRect(store: EditorStore): DOMRect | null {
  const sel = store.selection;
  if (sel?.type !== "text") return null;
  let start = sel.anchor;
  try {
    if (store.comparePoints(sel.anchor, sel.focus) > 0) start = sel.focus;
  } catch {
    start = sel.anchor;
  }
  const el = document.querySelector<HTMLElement>(
    `[data-engine-block-id="${start.node}"]`,
  );
  return el ? caretClientRect(el, start.offset) : null;
}

/**
 * Whether an outside interaction/blur target should NOT dismiss the flyout. Keep it
 * open while interacting within the flyout itself, a marked child overlay, or — the
 * load-bearing case — when focus returns to the editing surface (docs/024 §8).
 *
 * React Aria's non-modal `useOverlay` runs `shouldCloseOnInteractOutside` not only on a
 * pointer press outside the popover but also on `onBlurWithin` (focus leaving the
 * popover, via `shouldCloseOnBlur`). After a flyout command runs, `run` calls
 * `focusEditor()` to restore editor focus so the author can keep typing — that blur's
 * `relatedTarget` is an editor block (`[data-engine-surface]`). Without treating the
 * surface as "inside", that focus restore is read as an outside interaction and tears
 * the sticky flyout down (it surfaced as: drag-select text, click Bold, flyout vanishes
 * — the keyboard path only hid it because `focusEditor()` was a no-op when focus was
 * already in the editor). Dismissal that *should* happen — clicking a different spot in
 * the document — collapses/moves the selection, which the coordinator already turns into
 * a close (`use-command-surfaces.ts`); a click truly outside the editor (page chrome,
 * toolbar) is not within the surface, so it still dismisses here.
 */
function shouldKeepFlyoutOpen(element: Element): boolean {
  return (
    element.closest("[data-engine-flyout]") !== null ||
    element.closest("[data-engine-link-editor]") !== null ||
    element.closest("[data-engine-surface-child]") !== null ||
    element.closest("[data-engine-surface]") !== null
  );
}

export function SelectionFlyout(props: {
  readonly store: EditorStore;
  readonly ctx: CommandContext;
  readonly open: boolean;
  readonly close: () => void;
  readonly focusEditor: () => void;
}) {
  const { store, ctx, open, close, focusEditor } = props;
  const anchorRef = useRef<HTMLDivElement | null>(null);

  const rect = open ? selectionStartRect(store) : null;
  const items = open
    ? resolveCommandList("flyout", ctx).flatMap((group) => group.items)
    : [];

  // The flyout is *sticky*: applying a format does not dismiss it, so the author can
  // chain Bold then Italic over the same selection (the Docs/Notion convention). The
  // model selection survives the bar's focus (docs/011 §8.6), and the coordinator
  // dismisses the flyout on its own when the selection collapses or changes (docs/024
  // §7.2) — so `run` only applies + restores editor focus, it never calls `close`.
  const run = (item: ResolvedCommand) => {
    item.command.run?.(ctx);
    focusEditor();
  };

  const renderItem = (item: ResolvedCommand) => {
    const { command } = item;
    if (command.render) {
      return (
        <span data-engine-surface-child key={item.id}>
          <PopoverTrigger
            ariaLabel={command.label}
            trigger={
              <Button
                ariaLabel={command.label}
                iconName={command.icon}
                size="sm"
                square
                tooltip={command.label}
                variant={item.active ? "primary" : "ghost"}
              />
            }
          >
            {(closeChild) => (
              // Mark the *portaled* popover content (not just the trigger) so the
              // flyout's `shouldCloseOnInteractOutside` keeps it open while the author
              // types in this child popover. Without this, any command popover other
              // than the link editor (glossary/comment add) closes the flyout the
              // moment its input is focused, so the input never gets focus (docs/027).
              // `data-engine-flyout-child` additionally marks an *open* child (the trigger
              // span carries only `surface-child`), so the coordinator can keep the ambient
              // flyout alive while a child popover is open (use-command-surfaces.ts) — else
              // the debounced settle re-eval tears the child + its focused input out.
              <div data-engine-flyout-child="" data-engine-surface-child="">
                {command.render?.({ ...ctx, close: closeChild }) ?? null}
              </div>
            )}
          </PopoverTrigger>
        </span>
      );
    }
    return (
      <Button
        ariaLabel={command.label}
        iconName={command.icon}
        key={item.id}
        onClick={() => run(item)}
        size="sm"
        square
        tooltip={command.label}
        variant={item.active ? "primary" : "ghost"}
      />
    );
  };

  return (
    <>
      {/* Zero-size fixed anchor at the selection start; the popover floats above it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed size-0"
        ref={anchorRef}
        style={{ left: rect?.left ?? 0, top: rect?.top ?? 0 }}
      />
      <AnchoredPopover
        ariaLabel="Selection actions"
        isNonModal
        isOpen={open && rect !== null}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        placement="top"
        shouldCloseOnInteractOutside={(element) =>
          !shouldKeepFlyoutOpen(element)
        }
        triggerRef={anchorRef}
      >
        <div data-engine-flyout="">
          <AriaToolbar
            aria-label="Selection actions"
            className="flex items-center gap-0.5"
          >
            {items.map((item) => (
              <span data-engine-flyout-item={item.id} key={item.id}>
                {renderItem(item)}
              </span>
            ))}
          </AriaToolbar>
        </div>
      </AnchoredPopover>
    </>
  );
}
