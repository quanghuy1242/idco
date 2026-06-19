/**
 * Editor chrome: the formatting toolbar, block-type and insert menus, and the
 * link editor (docs/010 Phase 8 AC2/AC9).
 *
 * Built with `@idco/ui` (React Aria behavior + DaisyUI styling + lucide icons),
 * per docs/010 §7.1 and note.md §3 — no hand-rolled menus or buttons, and icon
 * controls rather than text glyphs, matching the legacy Lexical toolbar's shape.
 * Every control operates on the engine's *model* selection through
 * `store.command`/`store.query`, never the DOM: a toggle reads `is-mark-active`
 * and dispatches `toggle-mark`; the block-type menu dispatches `set-block-type`;
 * the insert menu dispatches `insert-object` for each registered node's `insert`
 * affordance (docs/016 §6.2).
 *
 * Focus integration (note.md §3): the engine owns focus via the EditContext host
 * and the model selection survives focus loss (011 §8.6), so toolbar presses do
 * not blur the editing surface (a capture-phase `mousedown` preventDefault on the
 * bar), and after a command we return focus to the block the selection now names
 * via `focusEditor`.
 */
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import {
  Button,
  Input,
  Menu,
  MenuItem,
  MenuTrigger,
  NavIcon,
  PopoverTrigger,
} from "@quanghuy1242/idco-ui";
import type { EditorStore, TextLeafType, TextMarkKind } from "../core";
import { listInsertableNodes } from "./node-view";

/** A format toggle's mark kind, lucide icon name, and accessible label. */
const FORMAT_BUTTONS: readonly {
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

const BLOCK_TYPES: readonly {
  readonly label: string;
  readonly icon: string;
  readonly blockType: TextLeafType;
  readonly tag?: string;
}[] = [
  { blockType: "paragraph", icon: "Pilcrow", label: "Paragraph" },
  { blockType: "heading", icon: "Heading1", label: "Heading 1", tag: "h1" },
  { blockType: "heading", icon: "Heading2", label: "Heading 2", tag: "h2" },
  { blockType: "heading", icon: "Heading3", label: "Heading 3", tag: "h3" },
  { blockType: "quote", icon: "Quote", label: "Quote" },
];

/** A stable id for a block-type menu item (independent of array order). */
function blockTypeKey(choice: { blockType: string; tag?: string }): string {
  return `${choice.blockType}:${choice.tag ?? ""}`;
}

/** Insert-menu icon per node type (falls back to a generic block icon). */
const INSERT_ICONS: Record<string, string> = {
  divider: "Minus",
  media: "Image",
  table: "Table",
};

/**
 * Subscribe a component to selection + commit so toolbar query state stays live.
 * A hook-local counter is the snapshot: the store has no global revision and the
 * commit hot path must not gain one, so the subscription bumps the counter here.
 */
function useToolbarVersion(store: EditorStore): number {
  const versionRef = useRef(0);
  return useSyncExternalStore(
    (listener) => {
      const bump = () => {
        versionRef.current += 1;
        listener();
      };
      const offSel = store.subscribeSelection(bump);
      const offCommit = store.subscribeCommit(() => bump());
      return () => {
        offSel();
        offCommit();
      };
    },
    () => versionRef.current,
    () => 0,
  );
}

/** A thin divider between toolbar groups. */
function Sep() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px bg-base-300" />;
}

export function EditorToolbar(props: {
  readonly store: EditorStore;
  readonly focusEditor: () => void;
  readonly className?: string;
}) {
  const { store, focusEditor } = props;
  // Re-read query state whenever selection or content changes.
  useToolbarVersion(store);
  const [linkValue, setLinkValue] = useState("");

  const run = useCallback(
    (action: () => void) => {
      action();
      focusEditor();
    },
    [focusEditor],
  );

  // Seed the link input from the active link when the popover opens; return focus
  // to the editing surface when it closes (React Aria would otherwise restore
  // focus to the trigger button, note.md §3).
  const onLinkOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        const current = store.query({ type: "active-link-href" });
        setLinkValue(typeof current === "string" ? current : "");
      } else {
        requestAnimationFrame(() => focusEditor());
      }
    },
    [focusEditor, store],
  );

  const applyLink = useCallback(() => {
    const href = linkValue.trim();
    if (href.length > 0) store.command({ href, type: "set-link" });
    else store.command({ type: "clear-link" });
  }, [linkValue, store]);

  const inserts = listInsertableNodes();
  const linkActive =
    typeof store.query({ type: "active-link-href" }) === "string";

  return (
    <div
      aria-label="Formatting toolbar"
      className={`flex flex-wrap items-center gap-0.5 border-b border-base-300 bg-base-100 p-1 ${props.className ?? ""}`}
      data-engine-toolbar=""
      // Pressing a toolbar control must not blur the editing host; model
      // selection survives focus loss, and we restore focus after the command.
      onMouseDownCapture={(event) => event.preventDefault()}
      role="toolbar"
    >
      <Button
        ariaLabel="Undo"
        iconName="Undo2"
        onClick={() => run(() => store.undo())}
        size="sm"
        tooltip="Undo"
        variant="ghost"
      />
      <Button
        ariaLabel="Redo"
        iconName="Redo2"
        onClick={() => run(() => store.redo())}
        size="sm"
        tooltip="Redo"
        variant="ghost"
      />

      <Sep />

      <span data-engine-block-type-menu="">
        <MenuTrigger>
          <Button
            ariaLabel="Block type"
            iconName="Pilcrow"
            size="sm"
            tooltip="Block type"
            variant="ghost"
          />
          <Menu
            onAction={(key) => {
              // Keyed by a stable `blockType:tag` id, not array index, so
              // reordering BLOCK_TYPES never changes what an item does.
              const choice = BLOCK_TYPES.find((c) => blockTypeKey(c) === key);
              if (choice) {
                run(() =>
                  store.command({
                    blockType: choice.blockType,
                    ...(choice.tag ? { tag: choice.tag } : {}),
                    type: "set-block-type",
                  }),
                );
              }
            }}
          >
            {BLOCK_TYPES.map((choice) => (
              <MenuItem
                id={blockTypeKey(choice)}
                key={blockTypeKey(choice)}
                textValue={choice.label}
              >
                <NavIcon name={choice.icon} />
                {choice.label}
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
      </span>

      <Sep />

      {FORMAT_BUTTONS.map((button) => {
        const active = store.query({
          mark: button.mark,
          type: "is-mark-active",
        });
        return (
          <span
            data-engine-format={button.mark}
            data-engine-format-active={active ? "true" : "false"}
            key={button.mark}
          >
            <Button
              ariaLabel={button.label}
              iconName={button.icon}
              onClick={() =>
                run(() =>
                  store.command({ mark: button.mark, type: "toggle-mark" }),
                )
              }
              size="sm"
              tooltip={button.label}
              variant={active ? "primary" : "ghost"}
            />
          </span>
        );
      })}

      <Sep />

      <Button
        ariaLabel="Bulleted list"
        iconName="List"
        onClick={() =>
          run(() =>
            store.command({ blockType: "listitem", type: "set-block-type" }),
          )
        }
        size="sm"
        tooltip="List"
        variant="ghost"
      />
      <Button
        ariaLabel="Outdent"
        iconName="IndentDecrease"
        onClick={() => run(() => store.command({ type: "outdent" }))}
        size="sm"
        tooltip="Outdent"
        variant="ghost"
      />
      <Button
        ariaLabel="Indent"
        iconName="IndentIncrease"
        onClick={() => run(() => store.command({ type: "indent" }))}
        size="sm"
        tooltip="Indent"
        variant="ghost"
      />

      <Sep />

      <span data-engine-link-control="">
        <PopoverTrigger
          ariaLabel="Link editor"
          onOpenChange={onLinkOpenChange}
          trigger={
            <Button
              ariaLabel={linkActive ? "Edit link" : "Link"}
              iconName={linkActive ? "Unlink" : "Link"}
              size="sm"
              tooltip="Link"
              variant={linkActive ? "primary" : "ghost"}
            />
          }
        >
          {(close) => (
            <form
              className="grid w-64 gap-2"
              data-engine-link-editor=""
              onSubmit={(event) => {
                event.preventDefault();
                applyLink();
                close();
              }}
            >
              <span className="text-xs font-medium opacity-70">Link URL</span>
              <Input
                ariaLabel="Link URL"
                autoFocus
                onChange={setLinkValue}
                placeholder="https://example.com"
                size="sm"
                type="url"
                value={linkValue}
              />
              <div className="flex items-center justify-end gap-2">
                {linkActive ? (
                  <Button
                    ariaLabel="Remove link"
                    onClick={() => {
                      store.command({ type: "clear-link" });
                      close();
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    Remove
                  </Button>
                ) : null}
                <Button
                  ariaLabel="Apply link"
                  size="sm"
                  type="submit"
                  variant="primary"
                >
                  Apply
                </Button>
              </div>
            </form>
          )}
        </PopoverTrigger>
      </span>

      {inserts.length > 0 ? (
        <>
          <Sep />
          <span data-engine-insert-menu="">
            <MenuTrigger>
              <Button
                ariaLabel="Insert block"
                iconName="Plus"
                size="sm"
                tooltip="Insert"
                variant="ghost"
              />
              <Menu
                onAction={(key) => {
                  const view = inserts.find((entry) => entry.type === key);
                  if (view) {
                    run(() =>
                      store.command({
                        data: view.insert.createData(),
                        objectType: view.type,
                        type: "insert-object",
                      }),
                    );
                  }
                }}
              >
                {inserts.map((entry) => (
                  <MenuItem
                    id={entry.type}
                    key={entry.type}
                    textValue={entry.insert.label}
                  >
                    <NavIcon name={INSERT_ICONS[entry.type] ?? "Plus"} />
                    {entry.insert.label}
                  </MenuItem>
                ))}
              </Menu>
            </MenuTrigger>
          </span>
        </>
      ) : null}
    </div>
  );
}
