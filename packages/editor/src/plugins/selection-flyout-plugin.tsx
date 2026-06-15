// DaisyUI 5: https://daisyui.com/components/button/

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $getSelection,
  $isRangeSelection,
  $setSelection,
  type BaseSelection,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
} from "lexical";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  Popover as AriaPopover,
  Toolbar as AriaToolbar,
} from "react-aria-components";
import {
  $readCommandContext,
  availableAnnotations,
  availableBlockStyles,
  surfaceCommands,
  type CommandContext,
  type EditorCommand,
} from "../model/commands";
import { $clampRangeSelectionToText } from "../model/selection-actions";
import { RichTextEditorBindingsContext } from "../nodes";
import { BlockStyleControl } from "../toolbar/block-style-control";
import { CommentButton } from "../toolbar/comment-button";
import { GlossaryButton } from "../toolbar/glossary-button";
import { LinkButton } from "../toolbar/link-button";
import { MoreMenu } from "../toolbar/more-menu";
import { ToolbarButton, ToolbarDivider } from "../toolbar/toolbar-button";
import {
  hasNonCollapsedDomSelection,
  registerEditorUpdateListener,
} from "./editor-performance";
import { selectedTextAnchorPoint } from "./selection-geometry";

type FlyoutState = {
  readonly ctx: CommandContext;
  readonly x: number;
  readonly y: number;
};

function isSelectionActionPopover(element: Element): boolean {
  return Boolean(element.closest("[data-editor-selection-action-popover]"));
}

function isSelectionMenuPopover(element: Element): boolean {
  return Boolean(element.closest('[role="menu"]'));
}

function isSelectionFlyout(element: Element): boolean {
  return Boolean(element.closest("[data-editor-selection-flyout]"));
}

function shouldChildOverlayCloseOnInteractOutside(element: Element): boolean {
  return !isSelectionActionPopover(element) && !isSelectionMenuPopover(element);
}

export function shouldSelectionFlyoutCloseOnInteractOutside(
  element: Element,
  {
    childOverlayClosing,
    childOverlayOpen,
  }: {
    readonly childOverlayClosing: boolean;
    readonly childOverlayOpen: boolean;
  },
): boolean {
  if (isSelectionActionPopover(element) || isSelectionMenuPopover(element)) {
    return false;
  }
  if (childOverlayOpen || childOverlayClosing) {
    return !isSelectionFlyout(element);
  }
  return true;
}

export function SelectionFlyoutPlugin({
  allowedNodes,
}: {
  readonly allowedNodes: readonly string[];
}) {
  const [editor] = useLexicalComposerContext();
  const bindings = useContext(RichTextEditorBindingsContext);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef<number | null>(null);
  const childOverlayOpenRef = useRef(false);
  const childOverlayClosingRef = useRef(false);
  const isApplyingDirectActionRef = useRef(false);
  const isInteractingRef = useRef(false);
  const isPointerSelectingRef = useRef(false);
  const savedSelectionRef = useRef<BaseSelection | null>(null);
  // Mirrors `flyout !== null` so deferred (rAF) handlers can tell whether an
  // apply already closed the flyout vs. a child overlay simply being folded.
  const flyoutOpenRef = useRef(false);
  const [flyout, setFlyout] = useState<FlyoutState | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    flyoutOpenRef.current = flyout !== null;
  }, [flyout]);

  const refresh = useCallback(() => {
    const root = editor.getRootElement();
    if (!root) {
      setFlyout(null);
      return;
    }
    if (isPointerSelectingRef.current) {
      setFlyout(null);
      return;
    }
    if (!hasNonCollapsedDomSelection(root)) {
      if (
        !isApplyingDirectActionRef.current &&
        !isInteractingRef.current &&
        !childOverlayOpenRef.current
      ) {
        setFlyout(null);
      }
      return;
    }
    const point = selectedTextAnchorPoint(root);
    if (!point) {
      if (
        !isApplyingDirectActionRef.current &&
        !isInteractingRef.current &&
        !childOverlayOpenRef.current
      ) {
        setFlyout(null);
      }
      return;
    }
    const { ctx, selection } = editor.getEditorState().read(() => {
      const live = $getSelection();
      // Clamp element endpoints to text so a triple-click that spills to a block
      // boundary (next to a decorator) still reads as selected text — and so the
      // saved snapshot formats/comments operate on the intended text. See
      // $clampRangeSelectionToText.
      const snapshot = $isRangeSelection(live)
        ? $clampRangeSelectionToText(live.clone())
        : (live?.clone() ?? null);
      return {
        ctx: $readCommandContext({ allowedNodes, bindings, editor }),
        selection: snapshot,
      };
    });
    const hasAction =
      ctx.hasSelectedText &&
      (enabledFlyoutFormats(ctx).length > 0 ||
        availableAnnotations(ctx).size > 0 ||
        availableBlockStyles(ctx.allowedNodes).length > 1);
    if (!point || !hasAction) {
      if (
        !isApplyingDirectActionRef.current &&
        !isInteractingRef.current &&
        !childOverlayOpenRef.current
      ) {
        setFlyout(null);
      }
      return;
    }
    savedSelectionRef.current = selection;
    setFlyout({ ctx, x: point.x, y: point.y });
  }, [allowedNodes, bindings, editor]);

  const scheduleRefresh = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      refresh();
    });
  }, [refresh]);

  useEffect(() => {
    function onViewportChange() {
      scheduleRefresh();
    }
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [scheduleRefresh]);

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;

    function startPointerSelection(event: PointerEvent) {
      if (event.button !== 0) return;
      isPointerSelectingRef.current = true;
      setFlyout(null);
    }

    function finishPointerSelection() {
      if (!isPointerSelectingRef.current) return;
      isPointerSelectingRef.current = false;
      scheduleRefresh();
    }

    root.addEventListener("pointerdown", startPointerSelection);
    window.addEventListener("pointerup", finishPointerSelection);
    window.addEventListener("pointercancel", finishPointerSelection);
    return () => {
      root.removeEventListener("pointerdown", startPointerSelection);
      window.removeEventListener("pointerup", finishPointerSelection);
      window.removeEventListener("pointercancel", finishPointerSelection);
    };
  }, [editor, scheduleRefresh]);

  useEffect(
    () =>
      mergeRegister(
        registerEditorUpdateListener(
          editor,
          {
            budgetMs: 5,
            cost: "updates selected-text flyout position and command context only for non-collapsed selections",
            frequency:
              "after editor updates while selection flyout plugin is mounted",
            label: "selection flyout refresh",
            lane: "frame",
            priority: "high",
          },
          refresh,
        ),
        editor.registerCommand(
          SELECTION_CHANGE_COMMAND,
          () => {
            scheduleRefresh();
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
      ),
    [editor, refresh, scheduleRefresh],
  );

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const applyDirectFormat = (command: EditorCommand) => {
    const savedSelection = savedSelectionRef.current;
    isApplyingDirectActionRef.current = true;
    editor.update(
      () => {
        try {
          if (savedSelection) $setSelection(savedSelection.clone());
        } catch {
          return;
        }
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        if (command.format) selection.formatText(command.format);
      },
      { discrete: true },
    );
    requestAnimationFrame(() => {
      editor.focus();
      scheduleRefresh();
      requestAnimationFrame(() => {
        isApplyingDirectActionRef.current = false;
        scheduleRefresh();
      });
    });
  };

  const getSavedSelectionSnapshot = useCallback(
    () => savedSelectionRef.current?.clone() ?? null,
    [],
  );

  // Folding a child overlay (block-style menu, link/glossary/comment dialog, or
  // "More") via its own trigger must keep the flyout open. React Aria returns
  // focus to the trigger and momentarily drops the editor selection, so a refresh
  // can fire before it is restored and dismiss the flyout. Restore the saved
  // selection and only then release the dismissal guard — unless an apply already
  // closed the flyout, in which case leave it closed.
  const releaseChildOverlay = useCallback(() => {
    const saved = savedSelectionRef.current;
    childOverlayClosingRef.current = true;
    requestAnimationFrame(() => {
      childOverlayOpenRef.current = false;
      if (flyoutOpenRef.current && saved) {
        editor.update(
          () => {
            try {
              $setSelection(saved.clone());
            } catch {
              /* snapshot nodes no longer exist */
            }
          },
          { discrete: true },
        );
        editor.focus();
      }
      requestAnimationFrame(() => {
        childOverlayClosingRef.current = false;
      });
    });
  }, [editor]);

  const handleChildOverlayOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        childOverlayOpenRef.current = true;
      } else {
        releaseChildOverlay();
      }
    },
    [releaseChildOverlay],
  );

  const handleInputActionApplied = useCallback(() => {
    childOverlayOpenRef.current = false;
    childOverlayClosingRef.current = false;
    setFlyout(null);
  }, []);

  const handleBlockStyleApplied = useCallback(() => {
    childOverlayOpenRef.current = false;
    childOverlayClosingRef.current = false;
    setFlyout(null);
    requestAnimationFrame(() => editor.focus());
  }, [editor]);

  const handleMoreOpenChange = useCallback(
    (open: boolean) => {
      setMoreOpen(open);
      if (open) {
        childOverlayOpenRef.current = true;
      } else {
        releaseChildOverlay();
      }
    },
    [releaseChildOverlay],
  );

  const runMoreCommand = useCallback(
    (command: EditorCommand) => {
      if (!flyout) return;
      const savedSelection = savedSelectionRef.current;
      editor.update(
        () => {
          try {
            if (savedSelection) $setSelection(savedSelection.clone());
          } catch {
            /* selection no longer resolvable */
          }
        },
        { discrete: true },
      );
      command.run(flyout.ctx);
      setMoreOpen(false);
      handleInputActionApplied();
      requestAnimationFrame(() => editor.focus());
    },
    [editor, flyout, handleInputActionApplied],
  );

  const startFlyoutInteraction = () => {
    isInteractingRef.current = true;
  };

  const finishFlyoutInteraction = () => {
    requestAnimationFrame(() => {
      isInteractingRef.current = false;
    });
  };

  const ctx = flyout?.ctx ?? null;
  const formatCommands = ctx ? enabledFlyoutFormats(ctx) : [];
  const annotations = ctx ? availableAnnotations(ctx) : new Set<string>();
  const hasBlockStyles = ctx
    ? availableBlockStyles(ctx.allowedNodes).length > 1
    : false;

  // Inline segments in order: Turn-into, formats, annotate, More.
  const segments: { readonly key: string; readonly node: React.ReactNode }[] =
    [];
  if (ctx && hasBlockStyles) {
    segments.push({
      key: "blockStyle",
      node: (
        <BlockStyleControl
          ctx={ctx}
          variant="compact"
          getSelectionSnapshot={getSavedSelectionSnapshot}
          onOpenChange={handleChildOverlayOpenChange}
          onApplied={handleBlockStyleApplied}
          shouldCloseOnInteractOutside={
            shouldChildOverlayCloseOnInteractOutside
          }
        />
      ),
    });
  }
  if (ctx && formatCommands.length > 0) {
    segments.push({
      key: "inlineFormat",
      node: (
        <div className="flex items-center gap-1">
          {formatCommands.map((command) => (
            <ToolbarButton
              key={command.id}
              icon={command.icon}
              label={command.label}
              isActive={command.isActive(ctx)}
              onPress={() => applyDirectFormat(command)}
            />
          ))}
        </div>
      ),
    });
  }
  if (annotations.size > 0) {
    segments.push({
      key: "annotate",
      node: (
        <div className="flex items-center gap-1">
          {annotations.has("link") ? (
            <LinkButton
              getSelectionSnapshot={getSavedSelectionSnapshot}
              onApplied={handleInputActionApplied}
              onDialogOpenChange={handleChildOverlayOpenChange}
            />
          ) : null}
          {annotations.has("glossary") ? (
            <GlossaryButton
              getSelectionSnapshot={getSavedSelectionSnapshot}
              onApplied={handleInputActionApplied}
              onDialogOpenChange={handleChildOverlayOpenChange}
            />
          ) : null}
          {annotations.has("comment") ? (
            <CommentButton
              getSelectionSnapshot={getSavedSelectionSnapshot}
              onApplied={handleInputActionApplied}
              onDialogOpenChange={handleChildOverlayOpenChange}
            />
          ) : null}
        </div>
      ),
    });
  }
  if (ctx && surfaceCommands(ctx, "flyout", "more").length > 0) {
    segments.push({
      key: "more",
      node: (
        <MoreMenu
          ctx={ctx}
          isOpen={moreOpen}
          label="Selection"
          onOpenChange={handleMoreOpenChange}
          onRun={runMoreCommand}
          shouldCloseOnInteractOutside={
            shouldChildOverlayCloseOnInteractOutside
          }
          surface="flyout"
          variant="compact"
        />
      ),
    });
  }

  return (
    <>
      <span
        ref={anchorRef}
        aria-hidden="true"
        className="pointer-events-none opacity-0"
        style={{
          height: 1,
          left: flyout?.x ?? 0,
          position: "fixed",
          top: flyout?.y ?? 0,
          width: 1,
        }}
      />
      <AriaPopover
        aria-label="Selected text actions"
        triggerRef={anchorRef}
        isOpen={flyout !== null}
        isNonModal
        data-editor-selection-flyout="true"
        onOpenChange={(open) => {
          if (!open && !childOverlayOpenRef.current) setFlyout(null);
        }}
        shouldCloseOnInteractOutside={(element) =>
          shouldSelectionFlyoutCloseOnInteractOutside(element, {
            childOverlayClosing: childOverlayClosingRef.current,
            childOverlayOpen: childOverlayOpenRef.current,
          })
        }
        placement="top"
        offset={8}
        className="z-[50] rounded-box border border-base-300 bg-base-100 p-1 shadow-lg data-[entering]:animate-popover-in data-[exiting]:animate-popover-out"
        onMouseDownCapture={startFlyoutInteraction}
        onMouseUpCapture={finishFlyoutInteraction}
        onPointerCancelCapture={finishFlyoutInteraction}
        onPointerDownCapture={startFlyoutInteraction}
        onPointerUpCapture={finishFlyoutInteraction}
      >
        <AriaToolbar
          aria-label="Selected text actions"
          className="flex items-center gap-1"
        >
          {segments.map((segment, index) => (
            <span key={segment.key} className="flex items-center gap-1">
              {index > 0 ? <ToolbarDivider /> : null}
              {segment.node}
            </span>
          ))}
        </AriaToolbar>
      </AriaPopover>
    </>
  );
}

/** Inline formats enabled for the current selection in the flyout. */
function enabledFlyoutFormats(ctx: CommandContext): readonly EditorCommand[] {
  return surfaceCommands(ctx, "flyout", "primary").filter(
    (command) => command.group === "inlineFormat" && command.isEnabled(ctx),
  );
}
