import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  $isRootNode,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  COMMAND_PRIORITY_LOW,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type PointType,
} from "lexical";
import { useEffect, useRef } from "react";
import {
  $selectBoundaryOrGap,
  $isGapContainerNode,
  canHoldRealCaret,
  isAtomicGapNode,
} from "./gap-cursor-plugin";

type BoundaryAction = {
  readonly containerKey: string | null;
  readonly offset: number;
  readonly preferredEdge: "backward" | "forward" | "nearest";
};

/**
 * Keeps arrow navigation visible at root and table-cell block boundaries.
 * Lexical can represent text carets and table-cell carets, but not a caret in
 * the outer gap around decorator blocks or tables. When default Lexical
 * navigation lands on a NodeSelection or a root/table-cell boundary selection,
 * resolve it to a real text edge or hand it to the gap cursor.
 */
export function BlockNavigationPlugin() {
  const [editor] = useLexicalComposerContext();
  const handledBoundary = useRef<string | null>(null);

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        const action = editorState.read((): BoundaryAction | null => {
          const selection = $getSelection();
          if ($isNodeSelection(selection)) {
            const node = selection.getNodes()[0];
            if (!node || !isAtomicGapNode(node)) return null;
            const parent = node.getParent();
            if (!$isGapContainerNode(parent)) return null;
            return {
              containerKey: $gapContainerKey(parent),
              offset: node.getIndexWithinParent() + 1,
              preferredEdge: "forward",
            };
          }
          if (
            !$isRangeSelection(selection) ||
            !selection.isCollapsed() ||
            !$isGapContainerNode(selection.anchor.getNode())
          ) {
            handledBoundary.current = null;
            return null;
          }
          const container = selection.anchor.getNode();
          const boundaryKey = `${$gapContainerKey(container) ?? "root"}:${
            selection.anchor.offset
          }`;
          if (handledBoundary.current === boundaryKey) {
            return null;
          }
          return {
            containerKey: $gapContainerKey(container),
            offset: selection.anchor.offset,
            preferredEdge: "nearest",
          };
        });
        if (!action) return;
        handledBoundary.current = `${action.containerKey ?? "root"}:${
          action.offset
        }`;
        editor.update(() => {
          const container = $gapContainerFromKey(action.containerKey);
          if (container) {
            $selectBoundaryOrGap(
              editor,
              action.offset,
              action.preferredEdge,
              container,
            );
          }
        });
      }),
    [editor],
  );

  useEffect(() => {
    const backward = (event: KeyboardEvent) => {
      const handled = $handleRangeBoundaryArrow(editor, "backward");
      if (handled) event.preventDefault();
      return handled;
    };
    const forward = (event: KeyboardEvent) => {
      const handled = $handleRangeBoundaryArrow(editor, "forward");
      if (handled) event.preventDefault();
      return handled;
    };
    return mergeCleanups(
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        backward,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ARROW_LEFT_COMMAND,
        backward,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        forward,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ARROW_RIGHT_COMMAND,
        forward,
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor]);

  return null;
}

function $handleRangeBoundaryArrow(
  editor: LexicalEditor,
  direction: "backward" | "forward",
): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const anchorNode = selection.anchor.getNode();
  if ($isGapContainerNode(anchorNode)) {
    return $selectBoundaryOrGap(
      editor,
      selection.anchor.offset,
      direction,
      anchorNode,
    );
  }
  const block = $nearestGapContainerChild(anchorNode);
  if (!block || isAtomicGapNode(block)) return false;
  const container = block.getParent();
  if (!$isGapContainerNode(container)) return false;
  const atBoundary =
    direction === "backward"
      ? isPointAtBlockStart(selection.anchor, block)
      : isPointAtBlockEnd(selection.anchor, block);
  if (!atBoundary) return false;
  const adjacent =
    direction === "backward"
      ? block.getPreviousSibling()
      : block.getNextSibling();
  if (!adjacent || !isAtomicGapNode(adjacent)) return false;
  const farSide =
    direction === "backward"
      ? adjacent.getPreviousSibling()
      : adjacent.getNextSibling();
  if (farSide && canHoldRealCaret(farSide)) {
    if (direction === "backward") farSide.selectEnd();
    else farSide.selectStart();
    return true;
  }
  return $selectBoundaryOrGap(
    editor,
    adjacent.getIndexWithinParent() + (direction === "backward" ? 0 : 1),
    direction,
    container,
  );
}

function $nearestGapContainerChild(node: LexicalNode): LexicalNode | null {
  let current: LexicalNode | null = node;
  while (current) {
    const parent: LexicalNode | null = current.getParent();
    if ($isGapContainerNode(parent)) return current;
    current = parent;
  }
  return null;
}

function $gapContainerFromKey(key: string | null): ElementNode | null {
  if (key === null) return $getRoot();
  const node = $getNodeByKey(key);
  return $isGapContainerNode(node) ? node : null;
}

function $gapContainerKey(container: LexicalNode): string | null {
  return $isRootNode(container) ? null : container.getKey();
}

function isPointAtBlockStart(point: PointType, block: LexicalNode): boolean {
  let node = point.getNode();
  if (point.offset !== 0) return false;
  while (!node.is(block)) {
    if (node.getPreviousSibling()) return false;
    const parent = node.getParent();
    if (!parent) return false;
    node = parent;
  }
  return true;
}

function isPointAtBlockEnd(point: PointType, block: LexicalNode): boolean {
  let node: LexicalNode;
  if (point.type === "text") {
    const textNode = point.getNode();
    if (point.offset !== textNode.getTextContentSize()) return false;
    node = textNode;
  } else {
    const elementNode = point.getNode();
    if (point.offset !== elementNode.getChildrenSize()) return false;
    node = elementNode;
  }
  while (!node.is(block)) {
    if (node.getNextSibling()) return false;
    const parent = node.getParent();
    if (!parent) return false;
    node = parent;
  }
  return true;
}

function mergeCleanups(...cleanups: Array<() => void>): () => void {
  return () => cleanups.forEach((cleanup) => cleanup());
}
