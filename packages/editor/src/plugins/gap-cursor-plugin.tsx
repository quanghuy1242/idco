import { $isTableCellNode, $isTableNode } from "@lexical/table";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isRangeSelection,
  $isRootNode,
  BLUR_COMMAND,
  COMMAND_PRIORITY_BEFORE_EDITOR,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_HIGH,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  createCommand,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  PASTE_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
  type LexicalNode,
  type ElementNode,
} from "lexical";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  gapCursorRect,
  type GapCursorRect,
  type GapTarget,
} from "../model/gap-cursor";

export type { GapTarget } from "../model/gap-cursor";

export const SET_GAP_CURSOR_COMMAND: LexicalCommand<GapTarget> = createCommand(
  "SET_GAP_CURSOR_COMMAND",
);
export const CLEAR_GAP_CURSOR_COMMAND: LexicalCommand<void> = createCommand(
  "CLEAR_GAP_CURSOR_COMMAND",
);

/**
 * ProseMirror-style, ephemeral insertion marker for block-scope gaps Lexical
 * cannot represent as a visible RangeSelection: above/below atomic blocks and
 * between adjacent atomic blocks/tables in the document root or inside a table
 * cell. The target is React state only; materialising a gap inserts one real
 * paragraph and immediately returns to normal Lexical text editing.
 */
export function GapCursorPlugin() {
  const [editor] = useLexicalComposerContext();
  const [target, setTargetState] = useState<GapTarget | null>(null);
  const targetRef = useRef<GapTarget | null>(null);
  const [rect, setRect] = useState<GapCursorRect | null>(null);

  const setTarget = useCallback((next: GapTarget | null) => {
    targetRef.current = next;
    setTargetState(next);
  }, []);

  const updateRect = useCallback(() => {
    const current = targetRef.current;
    const root = editor.getRootElement();
    if (!current || !root) {
      setRect(null);
      return;
    }
    const context = editor
      .getEditorState()
      .read(() => $gapTargetDomContext(current), { editor });
    if (!context) {
      setRect(null);
      return;
    }
    const anchor = editor.getElementByKey(context.anchorKey);
    const container = context.containerKey
      ? editor.getElementByKey(context.containerKey)
      : root;
    if (!anchor) {
      setRect(null);
      return;
    }
    if (!container) {
      setRect(null);
      return;
    }
    const anchorRect = anchor.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const previousRect = context.previousKey
      ? elementRect(editor.getElementByKey(context.previousKey))
      : null;
    const nextRect = context.nextKey
      ? elementRect(editor.getElementByKey(context.nextKey))
      : null;
    const containerStyle = getComputedStyle(container);
    const textInset = parseFloat(containerStyle.paddingLeft) || 0;
    const rightInset = parseFloat(containerStyle.paddingRight) || 0;
    const gapTop =
      current.side === "before"
        ? (previousRect?.bottom ?? containerRect.top)
        : anchorRect.bottom;
    const gapBottom =
      current.side === "before"
        ? anchorRect.top
        : (nextRect?.top ?? containerRect.bottom);
    setRect(
      gapCursorRect({
        anchorRect,
        gapBottom,
        gapTop,
        height: 1,
        rightInset,
        rootRect: containerRect,
        side: current.side,
        textInset,
      }),
    );
  }, [editor]);

  useEffect(() => {
    updateRect();
  }, [target, updateRect]);

  useEffect(() => {
    if (!target) return;
    const refresh = () => updateRect();
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [target, updateRect]);

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        const shouldClear = editorState.read(() => {
          const current = targetRef.current;
          if (!current) return false;
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
            return true;
          }
          if ($selectionMatchesGapTarget(selection, current)) return false;
          return !$isGapContainerNode(selection.anchor.getNode());
        });
        if (shouldClear) setTarget(null);
        else requestAnimationFrame(updateRect);
      }),
    [editor, setTarget, updateRect],
  );

  useEffect(
    () =>
      editor.registerCommand(
        SET_GAP_CURSOR_COMMAND,
        (next) => {
          if (!$selectGapTargetBoundary(next)) return false;
          setTarget(next);
          requestAnimationFrame(updateRect);
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    [editor, setTarget, updateRect],
  );

  useEffect(
    () =>
      editor.registerCommand(
        CLEAR_GAP_CURSOR_COMMAND,
        () => {
          setTarget(null);
          return false;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    [editor, setTarget],
  );

  useEffect(
    () =>
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          if (!targetRef.current) return false;
          event.preventDefault();
          setTarget(null);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor, setTarget],
  );

  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          const current = targetRef.current;
          if (!current) return false;
          event?.preventDefault();
          if ($materializeGapTarget(current)) {
            setTarget(null);
            requestAnimationFrame(() => editor.focus());
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor, setTarget],
  );

  useEffect(
    () =>
      editor.registerCommand(
        CONTROLLED_TEXT_INSERTION_COMMAND,
        () => {
          const current = targetRef.current;
          if (!current) return false;
          if (!$materializeGapTarget(current)) return false;
          setTarget(null);
          requestAnimationFrame(() => editor.focus());
          // Let the rich-text plugin insert the original text/input event into
          // the paragraph we just selected.
          return false;
        },
        COMMAND_PRIORITY_BEFORE_EDITOR,
      ),
    [editor, setTarget],
  );

  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        () => {
          const current = targetRef.current;
          if (!current) return false;
          if (!$materializeGapTarget(current)) return false;
          setTarget(null);
          requestAnimationFrame(() => editor.focus());
          return false;
        },
        COMMAND_PRIORITY_BEFORE_EDITOR,
      ),
    [editor, setTarget],
  );

  useEffect(
    () =>
      editor.registerCommand(
        BLUR_COMMAND,
        () => {
          if (!targetRef.current) return false;
          setTarget(null);
          return false;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    [editor, setTarget],
  );

  useEffect(() => {
    const move = (direction: "backward" | "forward") => {
      const current = targetRef.current;
      if (!current) return false;
      const boundary = $gapTargetBoundary(current);
      if (!boundary) return false;
      const nextOffset =
        direction === "backward" ? boundary.offset - 1 : boundary.offset + 1;
      if (
        nextOffset < 0 ||
        nextOffset > boundary.container.getChildrenSize() ||
        !$selectBoundaryOrGap(editor, nextOffset, direction, boundary.container)
      ) {
        return true;
      }
      return true;
    };

    return mergeCleanups(
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) => {
          if (!targetRef.current) return false;
          event.preventDefault();
          return move("backward");
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_LEFT_COMMAND,
        (event) => {
          if (!targetRef.current) return false;
          event.preventDefault();
          return move("backward");
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => {
          if (!targetRef.current) return false;
          event.preventDefault();
          return move("forward");
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_RIGHT_COMMAND,
        (event) => {
          if (!targetRef.current) return false;
          event.preventDefault();
          return move("forward");
        },
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [editor]);

  if (!target || !rect) return null;

  return createPortal(
    <>
      {/* Hard on/off blink (a flickering caret) rather than a smooth pulse.
          `step-end` snaps between the keyframes — fully visible, then fully
          gone — instead of fading. Self-contained so it works without the host
          shipping editor CSS. */}
      <style>{GAP_CURSOR_BLINK_CSS}</style>
      <div
        data-idco-gap-cursor=""
        aria-hidden="true"
        className="pointer-events-none fixed z-[65] rounded-full bg-primary"
        style={{
          animation: "idco-gap-blink 1s step-end infinite",
          height: rect.height,
          left: rect.left,
          top: rect.top,
          width: rect.width,
        }}
      />
    </>,
    document.body,
  );
}

const GAP_CURSOR_BLINK_CSS =
  "@keyframes idco-gap-blink{0%,100%{opacity:1}50%{opacity:0}}";

function elementRect(element: Element | null): DOMRect | null {
  if (!(element instanceof HTMLElement)) return null;
  return element.getBoundingClientRect();
}

export function $selectBoundaryOrGap(
  editor: LexicalEditor,
  offset: number,
  preferredEdge: "backward" | "forward" | "nearest",
  container: ElementNode = $getRoot(),
): boolean {
  const size = container.getChildrenSize();
  const boundary = Math.max(0, Math.min(size, offset));
  const before = boundary > 0 ? container.getChildAtIndex(boundary - 1) : null;
  const after = boundary < size ? container.getChildAtIndex(boundary) : null;

  if (
    (preferredEdge === "backward" || preferredEdge === "nearest") &&
    before &&
    canHoldRealCaret(before)
  ) {
    before.selectEnd();
    editor.dispatchCommand(CLEAR_GAP_CURSOR_COMMAND, undefined);
    return true;
  }
  if (
    (preferredEdge === "forward" || preferredEdge === "nearest") &&
    after &&
    canHoldRealCaret(after)
  ) {
    after.selectStart();
    editor.dispatchCommand(CLEAR_GAP_CURSOR_COMMAND, undefined);
    return true;
  }
  if (preferredEdge === "nearest" && after && canHoldRealCaret(after)) {
    after.selectStart();
    editor.dispatchCommand(CLEAR_GAP_CURSOR_COMMAND, undefined);
    return true;
  }
  if (preferredEdge === "nearest" && before && canHoldRealCaret(before)) {
    before.selectEnd();
    editor.dispatchCommand(CLEAR_GAP_CURSOR_COMMAND, undefined);
    return true;
  }

  const target = before
    ? { anchorKey: before.getKey(), side: "after" as const }
    : after
      ? { anchorKey: after.getKey(), side: "before" as const }
      : null;
  if (!target) return false;
  editor.dispatchCommand(SET_GAP_CURSOR_COMMAND, target);
  return true;
}

export function canHoldRealCaret(node: LexicalNode): boolean {
  return $isElementNode(node) && !$isDecoratorNode(node) && !$isTableNode(node);
}

export function isAtomicGapNode(node: LexicalNode): boolean {
  return $isDecoratorNode(node) || $isTableNode(node);
}

function $selectGapTargetBoundary(target: GapTarget): boolean {
  const boundary = $gapTargetBoundary(target);
  if (!boundary) return false;
  boundary.container.select(boundary.offset, boundary.offset);
  return true;
}

function $selectionMatchesGapTarget(
  selection: ReturnType<typeof $getSelection>,
  target: GapTarget,
): boolean {
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const boundary = $gapTargetBoundary(target);
  if (!boundary) return false;
  return (
    selection.anchor.getNode().is(boundary.container) &&
    selection.anchor.offset === boundary.offset
  );
}

function $gapTargetBoundary(target: GapTarget): {
  readonly container: ElementNode;
  readonly offset: number;
} | null {
  const anchor = $getNodeByKey(target.anchorKey);
  if (!anchor) return null;
  const parent = anchor.getParent();
  if (!$isGapContainerNode(parent)) return null;
  const offset =
    anchor.getIndexWithinParent() + (target.side === "after" ? 1 : 0);
  return { container: parent, offset };
}

function $gapTargetDomContext(target: GapTarget): {
  readonly anchorKey: string;
  readonly containerKey: string | null;
  readonly nextKey: string | null;
  readonly previousKey: string | null;
} | null {
  const anchor = $getNodeByKey(target.anchorKey);
  if (!anchor) return null;
  const parent = anchor.getParent();
  if (!$isGapContainerNode(parent)) return null;
  return {
    anchorKey: anchor.getKey(),
    containerKey: $isRootNode(parent) ? null : parent.getKey(),
    nextKey: anchor.getNextSibling()?.getKey() ?? null,
    previousKey: anchor.getPreviousSibling()?.getKey() ?? null,
  };
}

export function $isGapContainerNode(
  node: LexicalNode | null | undefined,
): node is ElementNode {
  return $isRootNode(node) || $isTableCellNode(node);
}

function $materializeGapTarget(target: GapTarget): boolean {
  const anchor = $getNodeByKey(target.anchorKey);
  if (!anchor) return false;
  const paragraph = $createParagraphNode();
  if (target.side === "before") anchor.insertBefore(paragraph);
  else anchor.insertAfter(paragraph);
  paragraph.select();
  return true;
}

function mergeCleanups(...cleanups: Array<() => void>): () => void {
  return () => cleanups.forEach((cleanup) => cleanup());
}
