import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  type ElementNode,
} from "lexical";
import { useEffect } from "react";
import { blockGapAtY, blockGapCandidates } from "../model/gap-cursor";
import { $selectBoundaryOrGap } from "./gap-cursor-plugin";

/**
 * Word/Confluence "click in the gap and type" behavior. The document root and
 * each table cell are independent block scopes: clicking whitespace above the
 * first block, between sibling blocks, or below the last block lands a real
 * text caret when a neighboring text block can hold one. If both sides are
 * atomic (decorator/table) or missing, it delegates to the gap cursor instead.
 * Inserting/reordering via the gutter handle remains available.
 */
export function BlockControlsPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;

    function onClick(event: MouseEvent) {
      const scopeElement = blockGapScopeElement(root!, event);
      const scope = editor
        .getEditorState()
        .read(() => blockGapScope(root!, scopeElement), { editor });
      if (!scope) return;
      const blocks = scope.childKeys
        .map((key) => editor.getElementByKey(key))
        .filter(
          (element): element is HTMLElement => element instanceof HTMLElement,
        );
      if (blocks.length === 0) return;
      const scopeRect = scopeElement.getBoundingClientRect();
      const gap = blockGapAtY(
        blockGapCandidates({
          blockRects: blocks.map((block) => block.getBoundingClientRect()),
          rootBottom: scopeRect.bottom,
          rootTop: scopeRect.top,
        }),
        event.clientY,
      );
      if (!gap) return;
      event.preventDefault();
      editor.update(() => {
        const container = $blockGapContainerFromKey(scope.nodeKey);
        if (!container) return;
        const offset =
          gap.beforeIndex === null
            ? 0
            : Math.min(gap.beforeIndex + 1, container.getChildrenSize());
        $selectBoundaryOrGap(editor, offset, "nearest", container);
      });
      requestAnimationFrame(() => editor.focus());
    }

    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [editor]);

  return null;
}

type BlockGapScope = {
  readonly childKeys: readonly string[];
  readonly nodeKey: string | null;
};

function blockGapScope(
  root: HTMLElement,
  scopeElement: HTMLElement,
): BlockGapScope | null {
  if (scopeElement === root) {
    return {
      childKeys: $getRoot()
        .getChildren()
        .map((node) => node.getKey()),
      nodeKey: null,
    };
  }
  const node = $getNearestNodeFromDOMNode(scopeElement);
  if (!$isElementNode(node)) return null;
  return {
    childKeys: node.getChildren().map((child) => child.getKey()),
    nodeKey: node.getKey(),
  };
}

function $blockGapContainerFromKey(key: string | null): ElementNode | null {
  if (key === null) return $getRoot();
  const node = $getNodeByKey(key);
  return $isElementNode(node) ? node : null;
}

function blockGapScopeElement(
  root: HTMLElement,
  event: MouseEvent,
): HTMLElement {
  const targetCell = tableCellFromTarget(root, event.target);
  if (targetCell) return targetCell;
  const pointCell = tableCellFromPoint(root, event.clientX, event.clientY);
  return pointCell ?? root;
}

function tableCellFromTarget(
  root: HTMLElement,
  target: EventTarget | null,
): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const cell = target.closest("td,th");
  return isTableCellInRoot(root, cell) ? cell : null;
}

function tableCellFromPoint(
  root: HTMLElement,
  x: number,
  y: number,
): HTMLElement | null {
  if (typeof document.elementsFromPoint !== "function") return null;
  const cell = document
    .elementsFromPoint(x, y)
    .find((element) => isTableCellInRoot(root, element));
  return cell instanceof HTMLElement ? cell : null;
}

function isTableCellInRoot(
  root: HTMLElement,
  element: Element | null | undefined,
): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.matches("td,th") &&
    root.contains(element)
  );
}
