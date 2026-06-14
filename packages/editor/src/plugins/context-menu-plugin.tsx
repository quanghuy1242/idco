import { Menu, MenuItem, MenuTrigger, NavIcon } from "@quanghuy1242/idco-ui";
import {
  $getTableCellNodeFromLexicalNode,
  $getTableColumnIndexFromTableCellNode,
  $getTableNodeFromLexicalNodeOrThrow,
  $isTableCellNode,
  $isTableSelection,
  $mergeCells,
  $moveTableColumn,
  $unmergeCell,
} from "@lexical/table";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getSelection,
} from "lexical";
import { useEffect, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { moveArrayItem } from "../model/layout";
import { EditorTableNode } from "../nodes/table-node";

/** Table-cell context captured at right-click, driving the table menu items. */
type TableContext = {
  readonly cellKey: string;
  readonly colIndex: number;
  readonly colCount: number;
  readonly isMerged: boolean;
  /** Keys of the 2+ cells in the active table selection, if any (mergeable). */
  readonly mergeCellKeys: readonly string[];
};

type MenuState = {
  readonly x: number;
  readonly y: number;
  readonly key: string;
  readonly table: TableContext | null;
};

/**
 * Right-click block context menu, built on the shared React Aria `Menu` (not the
 * Floating-UI-based Lexical plugin) to stay within the `@idco/ui` behavior
 * contract. A 0-size trigger is positioned at the cursor and the menu anchors to
 * it. Acts on the right-clicked top-level block, and — inside a table — exposes
 * cell merge/unmerge and column move/reorder (`@lexical/table` utilities).
 */
export function ContextMenuPlugin() {
  const [editor] = useLexicalComposerContext();
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    function onContextMenu(event: MouseEvent) {
      let key = "";
      let table: TableContext | null = null;
      editor.read(() => {
        const node = $getNearestNodeFromDOMNode(event.target as HTMLElement);
        key = (node?.getTopLevelElement() ?? node)?.getKey() ?? "";
        const cell = node ? $getTableCellNodeFromLexicalNode(node) : null;
        if (!cell) return;
        const tableNode = $getTableNodeFromLexicalNodeOrThrow(cell);
        const selection = $getSelection();
        const mergeCellKeys = $isTableSelection(selection)
          ? selection
              .getNodes()
              .filter($isTableCellNode)
              .map((selected) => selected.getKey())
          : [];
        table = {
          cellKey: cell.getKey(),
          colIndex: $getTableColumnIndexFromTableCellNode(cell),
          colCount: tableNode.getColumnCount(),
          isMerged: cell.getColSpan() > 1 || cell.getRowSpan() > 1,
          mergeCellKeys,
        };
      });
      if (!key) return;
      event.preventDefault();
      setMenu({ key, table, x: event.clientX, y: event.clientY });
    }
    root.addEventListener("contextmenu", onContextMenu);
    return () => root.removeEventListener("contextmenu", onContextMenu);
  }, [editor]);

  function insertBelow() {
    if (!menu) return;
    editor.update(() => {
      const block = $getNodeByKey(menu.key);
      if (!block) return;
      const paragraph = $createParagraphNode();
      block.insertAfter(paragraph);
      paragraph.select();
    });
  }

  function remove() {
    if (!menu) return;
    editor.update(() => {
      $getNodeByKey(menu.key)?.remove();
    });
  }

  function mergeCells() {
    const keys = menu?.table?.mergeCellKeys ?? [];
    if (keys.length < 2) return;
    editor.update(() => {
      const cells = keys
        .map((cellKey) => $getNodeByKey(cellKey))
        .filter($isTableCellNode);
      if (cells.length >= 2) $mergeCells(cells);
    });
  }

  function unmergeCell() {
    const cellKey = menu?.table?.cellKey;
    if (!cellKey) return;
    editor.update(() => {
      const cell = $getNodeByKey(cellKey);
      if (!$isTableCellNode(cell)) return;
      cell.selectEnd();
      $unmergeCell();
    });
  }

  function moveColumn(direction: -1 | 1) {
    const ctx = menu?.table;
    if (!ctx) return;
    const target = ctx.colIndex + direction;
    if (target < 0 || target >= ctx.colCount) return;
    editor.update(() => {
      const cell = $getNodeByKey(ctx.cellKey);
      if (!$isTableCellNode(cell)) return;
      const tableNode = $getTableNodeFromLexicalNodeOrThrow(cell);
      $moveTableColumn(tableNode, ctx.colIndex, target);
      // $moveTableColumn reorders the cells but not the separately-stored column
      // widths — move the matching width so columns keep their sizes.
      if (tableNode instanceof EditorTableNode) {
        const widths = tableNode.getColWidths();
        if (widths && widths.length === ctx.colCount) {
          tableNode.setColWidths(moveArrayItem(widths, ctx.colIndex, target));
        }
      }
    });
  }

  const table = menu?.table ?? null;
  const canMerge = (table?.mergeCellKeys.length ?? 0) >= 2;
  const canMoveLeft = table ? table.colIndex > 0 : false;
  const canMoveRight = table ? table.colIndex < table.colCount - 1 : false;

  return (
    <MenuTrigger
      isOpen={menu !== null}
      onOpenChange={(open) => {
        if (!open) setMenu(null);
      }}
      placement="bottom start"
    >
      <AriaButton
        aria-hidden="true"
        excludeFromTabOrder
        className="pointer-events-none fixed size-0 opacity-0"
        style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
      />
      <Menu aria-label="Block actions" className="w-52">
        <MenuItem id="insert" textValue="Insert below" onAction={insertBelow}>
          <span className="flex items-center gap-2.5">
            <NavIcon name="Plus" />
            Insert below
          </span>
        </MenuItem>
        {canMerge ? (
          <MenuItem id="merge" textValue="Merge cells" onAction={mergeCells}>
            <span className="flex items-center gap-2.5">
              <NavIcon name="Table" />
              Merge cells
            </span>
          </MenuItem>
        ) : null}
        {table?.isMerged ? (
          <MenuItem
            id="unmerge"
            textValue="Unmerge cell"
            onAction={unmergeCell}
          >
            <span className="flex items-center gap-2.5">
              <NavIcon name="Columns3" />
              Unmerge cell
            </span>
          </MenuItem>
        ) : null}
        {canMoveLeft ? (
          <MenuItem
            id="move-left"
            textValue="Move column left"
            onAction={() => moveColumn(-1)}
          >
            <span className="flex items-center gap-2.5">
              <NavIcon name="ChevronLeft" />
              Move column left
            </span>
          </MenuItem>
        ) : null}
        {canMoveRight ? (
          <MenuItem
            id="move-right"
            textValue="Move column right"
            onAction={() => moveColumn(1)}
          >
            <span className="flex items-center gap-2.5">
              <NavIcon name="ChevronRight" />
              Move column right
            </span>
          </MenuItem>
        ) : null}
        <MenuItem id="delete" textValue="Delete block" onAction={remove}>
          <span className="flex items-center gap-2.5 text-error">
            <NavIcon name="Trash2" />
            Delete block
          </span>
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}
