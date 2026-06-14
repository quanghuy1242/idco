import { $isTableNode, TableNode } from "@lexical/table";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, $isElementNode } from "lexical";
import { useEffect } from "react";
import { splitColumnWidths } from "../model/layout";

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
      const tableEl = editor.getElementByKey(key);
      if (!(tableEl instanceof HTMLTableElement)) return;
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
      const available =
        tableEl.parentElement?.clientWidth || tableEl.clientWidth || 0;
      const widths = splitColumnWidths(
        available > 0 ? available : columns * 120,
        columns,
      );
      editor.update(() => {
        const node = $getNodeByKey(key);
        if ($isTableNode(node) && node.getColWidths() === undefined) {
          node.setColWidths(widths);
        }
      });
    }

    // Fires with `created` for existing tables on registration (default
    // skipInitialization: false) and for every table inserted afterwards.
    return editor.registerMutationListener(TableNode, (mutations) => {
      for (const [key, type] of mutations) {
        if (type === "created") seed(key);
      }
    });
  }, [editor]);
}
