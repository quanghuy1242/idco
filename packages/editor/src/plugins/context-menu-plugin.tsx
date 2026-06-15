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
import { mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $getSelection,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $isRangeSelection,
  $setSelection,
  type BaseSelection,
  COMMAND_PRIORITY_LOW,
  INDENT_CONTENT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  OUTDENT_CONTENT_COMMAND,
} from "lexical";
import { useContext, useEffect, useRef, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import {
  editorInsertActions,
  type EditorInsertAction,
} from "../model/insert-actions";
import { moveArrayItem } from "../model/layout";
import {
  enabledTextSelectionActions,
  readTextSelectionContext,
  type TextSelectionAction,
} from "../model/selection-actions";
import { RichTextEditorBindingsContext } from "../nodes";
import { EditorTableNode } from "../nodes/table-node";
import {
  pointIntersectsSelectedText,
  selectedRangeRects,
} from "./selection-geometry";

/** Table-cell context captured at right-click, driving the table menu items. */
type TableContext = {
  readonly cellKey: string;
  readonly colIndex: number;
  readonly colCount: number;
  readonly isMerged: boolean;
  /** Keys of the 2+ cells in the active table selection, if any (mergeable). */
  readonly mergeCellKeys: readonly string[];
};

type BlockMenuState = {
  readonly kind: "block";
  readonly x: number;
  readonly y: number;
  readonly key: string;
  readonly table: TableContext | null;
};

type SelectionMenuState = {
  readonly kind: "selection";
  readonly x: number;
  readonly y: number;
  readonly actions: readonly TextSelectionAction[];
  readonly selection: BaseSelection | null;
};

type MenuState = BlockMenuState | SelectionMenuState;

type CachedSelectionMenu = {
  readonly actions: readonly TextSelectionAction[];
  readonly rects: readonly CachedSelectionRect[];
  readonly selection: BaseSelection | null;
};

type CachedSelectionRect = {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
};

function pointIntersectsCachedRects(
  rects: readonly CachedSelectionRect[],
  x: number,
  y: number,
  tolerance = 2,
): boolean {
  return rects.some(
    (rect) =>
      x >= rect.left - tolerance &&
      x <= rect.right + tolerance &&
      y >= rect.top - tolerance &&
      y <= rect.bottom + tolerance,
  );
}

/**
 * Right-click block context menu, built on the shared React Aria `Menu` (not the
 * Floating-UI-based Lexical plugin) to stay within the `@idco/ui` behavior
 * contract. A 0-size trigger is positioned at the cursor and the menu anchors to
 * it. Acts on the right-clicked top-level block, and — inside a table — exposes
 * cell merge/unmerge and column move/reorder (`@lexical/table` utilities).
 */
export function ContextMenuPlugin({
  allowedNodes,
}: {
  readonly allowedNodes: readonly string[];
}) {
  const [editor] = useLexicalComposerContext();
  const bindings = useContext(RichTextEditorBindingsContext);
  const cachedSelectionMenuRef = useRef<CachedSelectionMenu | null>(null);
  const rafRef = useRef<number | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    const cacheSelectionMenu = () => {
      const root = editor.getRootElement();
      if (!root) return;
      const rects = selectedRangeRects(root).map((rect) => ({
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        top: rect.top,
      }));
      const { selection, textActions } = editor.getEditorState().read(() => ({
        selection: $getSelection()?.clone() ?? null,
        textActions: enabledTextSelectionActions(
          readTextSelectionContext({ allowedNodes, bindings }),
        ).filter((action) => action.group !== "insert"),
      }));
      if (textActions.length > 0 && rects.length > 0) {
        cachedSelectionMenuRef.current = {
          actions: textActions,
          rects,
          selection,
        };
      }
    };

    const scheduleCacheSelectionMenu = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        cacheSelectionMenu();
      });
    };

    return mergeRegister(
      editor.registerUpdateListener(scheduleCacheSelectionMenu),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          scheduleCacheSelectionMenu();
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      () => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      },
    );
  }, [allowedNodes, bindings, editor]);

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    const rootElement = root;
    function onContextMenu(event: MouseEvent) {
      const { selection: textSelection, textActions } = editor
        .getEditorState()
        .read(() => ({
          selection: $getSelection()?.clone() ?? null,
          textActions: enabledTextSelectionActions(
            readTextSelectionContext({ allowedNodes, bindings }),
          ).filter((action) => action.group !== "insert"),
        }));
      const cachedSelectionMenu = cachedSelectionMenuRef.current;
      const cachedSelectionHit =
        cachedSelectionMenu &&
        pointIntersectsCachedRects(
          cachedSelectionMenu.rects,
          event.clientX,
          event.clientY,
        );
      if (
        (textActions.length > 0 &&
          pointIntersectsSelectedText(
            rootElement,
            event.clientX,
            event.clientY,
          )) ||
        cachedSelectionHit
      ) {
        const selectionMenu = cachedSelectionHit
          ? cachedSelectionMenu
          : { actions: textActions, selection: textSelection };
        event.preventDefault();
        setMenu({
          actions: selectionMenu.actions,
          kind: "selection",
          selection: selectionMenu.selection,
          x: event.clientX,
          y: event.clientY,
        });
        return;
      }
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
      setMenu({
        key,
        kind: "block",
        table,
        x: event.clientX,
        y: event.clientY,
      });
    }
    rootElement.addEventListener("contextmenu", onContextMenu);
    return () => rootElement.removeEventListener("contextmenu", onContextMenu);
  }, [allowedNodes, bindings, editor]);

  function insertBelow() {
    if (!menu || menu.kind !== "block") return;
    editor.update(() => {
      const block = $getNodeByKey(menu.key);
      if (!block) return;
      const paragraph = $createParagraphNode();
      block.insertAfter(paragraph);
      paragraph.select();
    });
  }

  function remove() {
    if (!menu || menu.kind !== "block") return;
    editor.update(() => {
      $getNodeByKey(menu.key)?.remove();
    });
  }

  function mergeCells() {
    const keys =
      menu?.kind === "block" ? (menu.table?.mergeCellKeys ?? []) : [];
    if (keys.length < 2) return;
    editor.update(() => {
      const cells = keys
        .map((cellKey) => $getNodeByKey(cellKey))
        .filter($isTableCellNode);
      if (cells.length >= 2) $mergeCells(cells);
    });
  }

  function unmergeCell() {
    const cellKey = menu?.kind === "block" ? menu.table?.cellKey : undefined;
    if (!cellKey) return;
    editor.update(() => {
      const cell = $getNodeByKey(cellKey);
      if (!$isTableCellNode(cell)) return;
      cell.selectEnd();
      $unmergeCell();
    });
  }

  function moveColumn(direction: -1 | 1) {
    const ctx = menu?.kind === "block" ? menu.table : null;
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

  function applyInsertAction(action: EditorInsertAction) {
    if (!menu || menu.kind !== "block") return;
    editor.update(
      () => {
        const block = $getNodeByKey(menu.key);
        if (!block) return;
        const paragraph = $createParagraphNode();
        block.insertAfter(paragraph);
        paragraph.select();
        action.run(editor);
      },
      { discrete: true },
    );
    setMenu(null);
    requestAnimationFrame(() => editor.focus());
  }

  function applySelectionAction(action: TextSelectionAction) {
    const savedSelection = menu?.kind === "selection" ? menu.selection : null;
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
    setMenu(null);
    requestAnimationFrame(() => editor.focus());
  }

  const table = menu?.kind === "block" ? menu.table : null;
  const canMerge = (table?.mergeCellKeys.length ?? 0) >= 2;
  const canMoveLeft = table ? table.colIndex > 0 : false;
  const canMoveRight = table ? table.colIndex < table.colCount - 1 : false;
  const selectionActions = menu?.kind === "selection" ? menu.actions : null;
  const insertActions =
    menu?.kind === "block"
      ? editorInsertActions({ allowedNodes, bindings })
      : [];

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
      <Menu
        aria-label={
          selectionActions ? "Selected text actions" : "Block actions"
        }
        data-editor-context-menu="true"
        className="w-52"
      >
        {selectionActions ? (
          selectionActions.map((action) => (
            <MenuItem
              key={action.id}
              id={action.id}
              textValue={action.label}
              onAction={() => applySelectionAction(action)}
            >
              <span
                className={`flex items-center gap-2.5 ${
                  action.isActive ? "text-primary" : ""
                }`}
              >
                <NavIcon name={action.icon} />
                {action.label}
              </span>
            </MenuItem>
          ))
        ) : (
          <>
            <MenuItem
              id="insert"
              textValue="Insert below"
              onAction={insertBelow}
            >
              <span className="flex items-center gap-2.5">
                <NavIcon name="Plus" />
                Insert below
              </span>
            </MenuItem>
            {insertActions.map((action) => (
              <MenuItem
                key={`insert-${action.id}`}
                id={`insert-${action.id}`}
                textValue={action.label}
                onAction={() => applyInsertAction(action)}
              >
                <span className="flex items-center gap-2.5">
                  <NavIcon name={action.icon} />
                  {action.label}
                </span>
              </MenuItem>
            ))}
            {canMerge ? (
              <MenuItem
                id="merge"
                textValue="Merge cells"
                onAction={mergeCells}
              >
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
          </>
        )}
      </Menu>
    </MenuTrigger>
  );
}
