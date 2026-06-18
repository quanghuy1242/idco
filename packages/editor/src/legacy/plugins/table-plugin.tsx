import { $isTableNode } from "@lexical/table";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, $getRoot, $isElementNode } from "lexical";
import { useEffect } from "react";
import {
  scaleColumnWidths,
  splitColumnWidths,
  tableSeedAvailableWidth,
} from "../model/layout";
import { EditorTableNode, isResponsiveLayout } from "../nodes/table-node";

/**
 * Enables Lexical's official table support: `TableNode` / `TableRowNode` /
 * `TableCellNode`, cell merge, tab navigation between cells, and horizontal
 * scrolling for wide tables. Row/column insert and column resize are hover
 * affordances on the table (`TableControlsPlugin`); row/column delete lives in
 * the toolbar's table group. `useSeedColumnWidths` gives every table explicit
 * column widths so resizing is authoritative (see below).
 */
export function RichTextTablePlugin() {
  useSeedColumnWidths();
  useResponsiveColumnWidths();
  return (
    <TablePlugin
      hasCellMerge
      hasCellBackgroundColor={false}
      hasHorizontalScroll
      hasTabHandler
    />
  );
}

/**
 * Seeds `colWidths` on tables that don't have them yet (freshly inserted or
 * loaded from JSON), splitting the wrapper's width evenly across the columns.
 *
 * Without this, a fixed-layout table with no column widths stretches to fill its
 * container, and the browser redistributes the difference whenever the widths
 * don't sum to that container — so dragging a boundary narrower springs back and
 * resizing feels broken. Once the widths are explicit the table sizes to their
 * sum, so a resize drag changes exactly the dragged column.
 */
function useSeedColumnWidths() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    function seed(key: string) {
      const tableEl = tableElementFromLexicalElement(
        editor.getElementByKey(key),
      );
      if (!tableEl) return;
      let columns = 0;
      editor.getEditorState().read(() => {
        const node = $getNodeByKey(key);
        if (!$isTableNode(node) || node.getColWidths() !== undefined) return;
        // Cell count of the first row (the resize handles align to these too).
        const firstRow = node.getChildAtIndex(0);
        columns = $isElementNode(firstRow) ? firstRow.getChildrenSize() : 0;
      });
      if (columns === 0) return;
      // The scroll wrapper is a full-width block, so its width is the space
      // available regardless of the (not-yet-sized) table inside it.
      const available = tableSeedAvailableWidth({
        columns,
        editorWidth: editorContentWidth(editor.getRootElement()),
        tableWidth: measuredWidth(tableEl),
        wrapperWidth: measuredWidth(tableEl.parentElement),
      });
      const widths = splitColumnWidths(available, columns);
      editor.update(() => {
        const node = $getNodeByKey(key);
        if ($isTableNode(node) && node.getColWidths() === undefined) {
          node.setColWidths(widths);
        }
      });
    }

    // Fires with `created` for existing tables on registration (default
    // skipInitialization: false) and for every table inserted afterwards.
    return editor.registerMutationListener(EditorTableNode, (mutations) => {
      for (const [key, type] of mutations) {
        if (type === "created") seed(key);
      }
    });
  }, [editor]);
}

/**
 * Keeps `responsive`/`full-width` tables filling their container: a
 * `ResizeObserver` on the editor root rescales each responsive table's
 * `colWidths` proportionally to its current wrapper width whenever the layout
 * changes (window resize, sidebar toggle, font load). `fixed` tables keep their
 * absolute widths and are left untouched. Proportions are preserved by
 * `scaleColumnWidths`, so a reflow never disturbs the authored column ratios.
 */
function useResponsiveColumnWidths() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root || typeof ResizeObserver !== "function") return;

    let frame = 0;
    function reflow() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const targets: { key: string; widths: readonly number[] }[] = [];
        editor.getEditorState().read(() => {
          for (const node of collectResponsiveTables()) {
            const widths = node.getColWidths();
            if (widths && widths.length > 0) {
              targets.push({ key: node.getKey(), widths });
            }
          }
        });
        const rescaled = targets
          .map(({ key, widths }) => {
            const tableEl = tableElementFromLexicalElement(
              editor.getElementByKey(key),
            );
            const container = measuredWidth(tableEl?.parentElement);
            return { container, key, widths };
          })
          .filter(({ container, widths }) => {
            const sum = widths.reduce((total, width) => total + width, 0);
            // Only rewrite when the container actually moved (>1px) — avoids a
            // feedback loop with our own width writes.
            return container > 0 && Math.abs(sum - container) > 1;
          });
        if (rescaled.length === 0) return;
        editor.update(() => {
          for (const { container, key, widths } of rescaled) {
            const node = $getNodeByKey(key);
            if (node instanceof EditorTableNode) {
              node.setColWidths(scaleColumnWidths(widths, container));
            }
          }
        });
      });
    }

    const observer = new ResizeObserver(reflow);
    observer.observe(root);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [editor]);
}

/** All responsive (container-filling) tables in the current editor state. */
function collectResponsiveTables(): EditorTableNode[] {
  return $getRoot()
    .getChildren()
    .filter(
      (node): node is EditorTableNode =>
        node instanceof EditorTableNode && isResponsiveLayout(node.getLayout()),
    );
}

export function tableElementFromLexicalElement(
  element: HTMLElement | null,
): HTMLTableElement | null {
  if (element instanceof HTMLTableElement) return element;
  return element?.querySelector("table") ?? null;
}

function measuredWidth(element: HTMLElement | null | undefined): number {
  if (!element) return 0;
  return Math.round(
    element.clientWidth || element.getBoundingClientRect().width || 0,
  );
}

function editorContentWidth(element: HTMLElement | null): number {
  if (!element) return 0;
  const width = measuredWidth(element);
  if (width === 0) return 0;
  if (typeof getComputedStyle !== "function") return width;

  const style = getComputedStyle(element);
  const horizontalPadding =
    cssPixels(style.paddingLeft) + cssPixels(style.paddingRight);
  return Math.max(0, Math.round(width - horizontalPadding));
}

function cssPixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
