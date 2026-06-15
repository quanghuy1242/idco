// DaisyUI 5: https://daisyui.com/components/button/

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $getSelection,
  $isRangeSelection,
  $setSelection,
  type BaseSelection,
  COMMAND_PRIORITY_LOW,
  INDENT_CONTENT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  OUTDENT_CONTENT_COMMAND,
} from "lexical";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  Popover as AriaPopover,
  Toolbar as AriaToolbar,
} from "react-aria-components";
import {
  $clampRangeSelectionToText,
  enabledTextSelectionActions,
  readTextSelectionContext,
  type TextSelectionAction,
} from "../model/selection-actions";
import { RichTextEditorBindingsContext } from "../nodes";
import { CommentButton } from "../toolbar/comment-button";
import { GlossaryButton } from "../toolbar/glossary-button";
import { LinkButton } from "../toolbar/link-button";
import { ToolbarButton, ToolbarDivider } from "../toolbar/toolbar-button";
import { selectedTextAnchorPoint } from "./selection-geometry";

type FlyoutState = {
  readonly actions: readonly TextSelectionAction[];
  readonly x: number;
  readonly y: number;
};

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
  const isApplyingDirectActionRef = useRef(false);
  const isInteractingRef = useRef(false);
  const isPointerSelectingRef = useRef(false);
  const savedSelectionRef = useRef<BaseSelection | null>(null);
  const [flyout, setFlyout] = useState<FlyoutState | null>(null);

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
    const { context, selection } = editor.getEditorState().read(() => {
      const live = $getSelection();
      // Clamp element endpoints to text so a triple-click that spills to a block
      // boundary (next to a decorator) still reads as selected text — and so the
      // saved snapshot formats/comments operate on the intended text. See
      // $clampRangeSelectionToText.
      const snapshot = $isRangeSelection(live)
        ? $clampRangeSelectionToText(live.clone())
        : (live?.clone() ?? null);
      return {
        context: readTextSelectionContext({ allowedNodes, bindings }),
        selection: snapshot,
      };
    });
    const actions = enabledTextSelectionActions(context);
    const point = selectedTextAnchorPoint(root);
    if (!point || actions.length === 0) {
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
    setFlyout({ actions, x: point.x, y: point.y });
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

  useEffect(() => {
    function closeChildOverlayInteraction(event: PointerEvent) {
      if (!childOverlayOpenRef.current) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest("[data-editor-selection-action-popover]") ||
        target.closest("[data-editor-selection-flyout]")
      ) {
        return;
      }
      childOverlayOpenRef.current = false;
      setFlyout(null);
    }

    document.addEventListener(
      "pointerdown",
      closeChildOverlayInteraction,
      true,
    );
    return () =>
      document.removeEventListener(
        "pointerdown",
        closeChildOverlayInteraction,
        true,
      );
  }, []);

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(scheduleRefresh),
        editor.registerCommand(
          SELECTION_CHANGE_COMMAND,
          () => {
            scheduleRefresh();
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
      ),
    [editor, scheduleRefresh],
  );

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const applyDirectAction = (action: TextSelectionAction) => {
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
        if (action.format) {
          selection.formatText(action.format);
        } else if (action.id === "indent") {
          editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined);
        } else if (action.id === "outdent") {
          editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined);
        }
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

  const handleChildOverlayOpenChange = useCallback((open: boolean) => {
    childOverlayOpenRef.current = open;
  }, []);

  const handleInputActionApplied = useCallback(() => {
    childOverlayOpenRef.current = false;
    setFlyout(null);
  }, []);

  const startFlyoutInteraction = () => {
    isInteractingRef.current = true;
  };

  const finishFlyoutInteraction = () => {
    requestAnimationFrame(() => {
      isInteractingRef.current = false;
    });
  };

  const hasAction = (id: TextSelectionAction["id"]) =>
    flyout?.actions.some((action) => action.id === id) ?? false;
  const formatActions =
    flyout?.actions.filter((action) => action.group === "format") ?? [];
  const layoutActions =
    flyout?.actions.filter((action) => action.group === "layout") ?? [];
  const hasInsertActions =
    hasAction("link") || hasAction("glossary") || hasAction("comment");

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
        shouldCloseOnInteractOutside={(element) => {
          if (element.closest("[data-editor-selection-action-popover]")) {
            return false;
          }
          return !childOverlayOpenRef.current;
        }}
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
          {formatActions.map((action) => (
            <ToolbarButton
              key={action.id}
              icon={action.icon}
              label={action.label}
              isActive={action.isActive}
              onPress={() => applyDirectAction(action)}
            />
          ))}
          {layoutActions.length > 0 ? <ToolbarDivider /> : null}
          {layoutActions.map((action) => (
            <ToolbarButton
              key={action.id}
              icon={action.icon}
              label={action.label}
              onPress={() => applyDirectAction(action)}
            />
          ))}
          {formatActions.length > 0 && hasInsertActions ? (
            <ToolbarDivider />
          ) : null}
          {hasAction("link") ? (
            <LinkButton
              getSelectionSnapshot={getSavedSelectionSnapshot}
              onApplied={handleInputActionApplied}
              onDialogOpenChange={handleChildOverlayOpenChange}
            />
          ) : null}
          {hasAction("glossary") ? (
            <GlossaryButton
              getSelectionSnapshot={getSavedSelectionSnapshot}
              onApplied={handleInputActionApplied}
              onDialogOpenChange={handleChildOverlayOpenChange}
            />
          ) : null}
          {hasAction("comment") ? (
            <CommentButton
              getSelectionSnapshot={getSavedSelectionSnapshot}
              onApplied={handleInputActionApplied}
              onDialogOpenChange={handleChildOverlayOpenChange}
            />
          ) : null}
        </AriaToolbar>
      </AriaPopover>
    </>
  );
}
