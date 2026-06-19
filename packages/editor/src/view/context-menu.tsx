/**
 * Right-click context menu for the owned-model editor.
 *
 * The *mechanism* is lifted from the legacy editor's `context-menu-plugin.tsx`
 * (the only place a context menu existed): a React Aria `MenuTrigger` whose
 * trigger is a zero-size `fixed`-positioned button placed at the cursor, opened
 * on a `contextmenu` event with `preventDefault`. The *actions*, though, are pure
 * engine commands (`store.command`/`store.query`) — no Lexical, no DOM mutation —
 * so the menu, the toolbar, and the keyboard all drive the one model.
 *
 * It branches by the current model selection: a non-collapsed text selection gets
 * inline-format toggles; a collapsed caret in a block gets block-type + list +
 * indent. Anything else (a node/object selection, or no selection) is left to the
 * browser's native menu, exactly as legacy did when the click had no block key.
 */
import { useCallback, useState } from "react";
import { Button as AriaButton, Separator } from "react-aria-components";
import { Menu, MenuItem, MenuTrigger, NavIcon } from "@quanghuy1242/idco-ui";
import {
  collectSelectionText,
  orderedTextLeaves,
  pointAtOffset,
  type EditorStore,
  type TextLeafType,
  type TextMarkKind,
} from "../core";

const FORMAT_ITEMS: readonly {
  readonly mark: TextMarkKind;
  readonly icon: string;
  readonly label: string;
}[] = [
  { icon: "Bold", label: "Bold", mark: "bold" },
  { icon: "Italic", label: "Italic", mark: "italic" },
  { icon: "Underline", label: "Underline", mark: "underline" },
  { icon: "Strikethrough", label: "Strikethrough", mark: "strikethrough" },
  { icon: "Code", label: "Code", mark: "code" },
  { icon: "Highlighter", label: "Highlight", mark: "highlight" },
];

const BLOCK_ITEMS: readonly {
  readonly label: string;
  readonly icon: string;
  readonly blockType: TextLeafType;
  readonly tag?: string;
}[] = [
  { blockType: "paragraph", icon: "Pilcrow", label: "Paragraph" },
  { blockType: "heading", icon: "Heading1", label: "Heading 1", tag: "h1" },
  { blockType: "heading", icon: "Heading2", label: "Heading 2", tag: "h2" },
  { blockType: "quote", icon: "Quote", label: "Quote" },
];

type MenuPos = {
  readonly x: number;
  readonly y: number;
  readonly kind: "selection" | "block";
};

export type ContextMenuController = {
  readonly pos: MenuPos | null;
  onContextMenu(event: React.MouseEvent<HTMLElement>): void;
  close(): void;
};

/** Decide which menu (if any) a right-click opens, from the model selection. */
export function useContextMenu(store: EditorStore): ContextMenuController {
  const [pos, setPos] = useState<MenuPos | null>(null);
  const onContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const selection = store.selection;
      if (selection?.type !== "text") return; // object/none → native menu
      const collapsed =
        selection.anchor.node === selection.focus.node &&
        selection.anchor.offset === selection.focus.offset;
      event.preventDefault();
      setPos({
        kind: collapsed ? "block" : "selection",
        x: event.clientX,
        y: event.clientY,
      });
    },
    [store],
  );
  const close = useCallback(() => setPos(null), []);
  return { close, onContextMenu, pos };
}

/** Whether the model has a non-collapsed text selection (drives cut/copy/delete). */
function hasTextSelection(store: EditorStore): boolean {
  const selection = store.selection;
  return (
    selection?.type === "text" &&
    !(
      selection.anchor.node === selection.focus.node &&
      selection.anchor.offset === selection.focus.offset
    )
  );
}

/** Select the whole document, end to end, on the model (the menu's Select all). */
function selectAllInStore(store: EditorStore): void {
  const leaves = orderedTextLeaves(store);
  if (leaves.length === 0) return;
  const first = leaves[0]!.node;
  const last = leaves.at(-1)!.node;
  store.dispatch({
    origin: "local",
    selectionAfter: {
      anchor: pointAtOffset(first.id, first.content, 0),
      focus: pointAtOffset(last.id, last.content, last.content.text.length),
      type: "text",
    },
    steps: [],
  });
}

export function EngineContextMenu(props: {
  readonly store: EditorStore;
  readonly controller: ContextMenuController;
  readonly focusEditor: () => void;
}) {
  const { store, controller, focusEditor } = props;
  const { pos, close } = controller;

  const run = useCallback(
    (action: () => void) => {
      action();
      close();
      focusEditor();
    },
    [close, focusEditor],
  );

  // Clipboard goes through the same model serialization the native Ctrl+C/X/V
  // path uses (collectSelectionText / insert-text), via the async Clipboard API
  // since a menu click is a user gesture. Paste closes first, then inserts when
  // the read resolves (the caret survives), so it does not block the menu.
  const onCopy = useCallback(() => {
    void navigator.clipboard
      ?.writeText(collectSelectionText(store, store.selection))
      .catch(() => {});
    close();
    focusEditor();
  }, [close, focusEditor, store]);
  const onCut = useCallback(() => {
    void navigator.clipboard
      ?.writeText(collectSelectionText(store, store.selection))
      .catch(() => {});
    store.command({ type: "delete-selection" });
    close();
    focusEditor();
  }, [close, focusEditor, store]);
  const onPaste = useCallback(() => {
    close();
    void (async () => {
      try {
        const text = await navigator.clipboard?.readText();
        if (text) {
          store.command({ text, type: "insert-text" });
          focusEditor();
        }
      } catch {
        /* clipboard read denied — no-op */
      }
    })();
  }, [close, focusEditor, store]);

  const hasSelection = hasTextSelection(store);
  const listActive = store.query({ type: "current-block-type" }) === "listitem";

  // Universal edit commands, present in every menu (cut/copy/delete disabled
  // without a selection); the contextual group follows the separator.
  const editItems = [
    <MenuItem
      id="cut"
      isDisabled={!hasSelection}
      key="cut"
      onAction={onCut}
      textValue="Cut"
    >
      <span className="flex items-center gap-2.5">
        <NavIcon name="Scissors" />
        Cut
      </span>
    </MenuItem>,
    <MenuItem
      id="copy"
      isDisabled={!hasSelection}
      key="copy"
      onAction={onCopy}
      textValue="Copy"
    >
      <span className="flex items-center gap-2.5">
        <NavIcon name="Copy" />
        Copy
      </span>
    </MenuItem>,
    <MenuItem id="paste" key="paste" onAction={onPaste} textValue="Paste">
      <span className="flex items-center gap-2.5">
        <NavIcon name="ClipboardPaste" />
        Paste
      </span>
    </MenuItem>,
    <MenuItem
      id="select-all"
      key="select-all"
      onAction={() => run(() => selectAllInStore(store))}
      textValue="Select all"
    >
      <span className="flex items-center gap-2.5">
        <NavIcon name="ListChecks" />
        Select all
      </span>
    </MenuItem>,
    <MenuItem
      id="delete"
      isDisabled={!hasSelection}
      key="delete"
      onAction={() => run(() => store.command({ type: "delete-selection" }))}
      textValue="Delete"
    >
      <span className="flex items-center gap-2.5 text-error">
        <NavIcon name="Trash2" />
        Delete
      </span>
    </MenuItem>,
  ];

  return (
    <MenuTrigger
      isOpen={pos !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      placement="bottom start"
    >
      {/* A zero-size, focus-excluded anchor positioned at the cursor — the menu
          opens against it (the legacy mechanism). */}
      <AriaButton
        aria-hidden="true"
        className="pointer-events-none fixed size-0 opacity-0"
        excludeFromTabOrder
        style={{ left: pos?.x ?? 0, top: pos?.y ?? 0 }}
      />
      <Menu
        aria-label={
          pos?.kind === "selection" ? "Selected text actions" : "Block actions"
        }
        className="w-52"
        data-engine-context-menu={pos?.kind ?? ""}
      >
        {editItems}
        <Separator className="my-1 h-px bg-base-300" />
        {pos?.kind === "selection"
          ? FORMAT_ITEMS.map((item) => {
              const active = store.query({
                mark: item.mark,
                type: "is-mark-active",
              });
              return (
                <MenuItem
                  id={item.mark}
                  key={item.mark}
                  onAction={() =>
                    run(() =>
                      store.command({ mark: item.mark, type: "toggle-mark" }),
                    )
                  }
                  textValue={item.label}
                >
                  <span
                    className={`flex items-center gap-2.5 ${active ? "text-primary" : ""}`}
                  >
                    <NavIcon name={item.icon} />
                    {item.label}
                  </span>
                </MenuItem>
              );
            })
          : [
              ...BLOCK_ITEMS.map((item) => (
                <MenuItem
                  id={`block:${item.blockType}:${item.tag ?? ""}`}
                  key={`block:${item.blockType}:${item.tag ?? ""}`}
                  onAction={() =>
                    run(() =>
                      store.command({
                        blockType: item.blockType,
                        ...(item.tag ? { tag: item.tag } : {}),
                        type: "set-block-type",
                      }),
                    )
                  }
                  textValue={item.label}
                >
                  <span className="flex items-center gap-2.5">
                    <NavIcon name={item.icon} />
                    {item.label}
                  </span>
                </MenuItem>
              )),
              <MenuItem
                id="list"
                key="list"
                onAction={() =>
                  run(() =>
                    store.command({
                      blockType: listActive ? "paragraph" : "listitem",
                      type: "set-block-type",
                    }),
                  )
                }
                textValue="List"
              >
                <span
                  className={`flex items-center gap-2.5 ${listActive ? "text-primary" : ""}`}
                >
                  <NavIcon name="List" />
                  List
                </span>
              </MenuItem>,
              <MenuItem
                id="indent"
                key="indent"
                onAction={() => run(() => store.command({ type: "indent" }))}
                textValue="Indent"
              >
                <span className="flex items-center gap-2.5">
                  <NavIcon name="IndentIncrease" />
                  Indent
                </span>
              </MenuItem>,
              <MenuItem
                id="outdent"
                key="outdent"
                onAction={() => run(() => store.command({ type: "outdent" }))}
                textValue="Outdent"
              >
                <span className="flex items-center gap-2.5">
                  <NavIcon name="IndentDecrease" />
                  Outdent
                </span>
              </MenuItem>,
            ]}
      </Menu>
    </MenuTrigger>
  );
}
