/**
 * Built-in commands across every surface (docs/024 §5.3/§5.6/§7).
 *
 * docs/023's `toolbar-builtins` registered the ribbon's Home/Insert controls. docs/024
 * generalizes the file (`toolbar-builtins.tsx → command-builtins.tsx`, §5.8): the same
 * controls now declare the *surfaces* they live on (`surfaces` placement map), and the
 * edit-ops the context menu used to hardcode (cut/copy/paste/select-all/delete, docs/024
 * §3.2/§7.1) move here as commands tagged `{ contextMenu }`. Marks, chooser block-types,
 * and insertables are NOT declared here — they project by-kind from their own registries
 * (`command-surface.registryCommands`, docs/024 §6.3); this file owns the controls with
 * bespoke behavior plus the global edit-ops.
 *
 * The ribbon's tab/slot arrangement (`registerToolbarTab`/`registerToolbarSlot`) is the
 * ribbon's alone (docs/024 §6.3); the flat surfaces have no arrangement, so a command
 * appearing there needs only its `surfaces` entry + `group`.
 *
 * Registration runs through `registerBuiltInCommands()`, called by the view orchestrator
 * (`react-view`) alongside the node/mark/block registrars. Per docs/023 §5.2/§9 that
 * explicit call — not a bare module-load side effect — is the correctness path that lets
 * the package stay `sideEffects: false`. The bare self-call at the end is only a
 * convenience for direct deep-imports and tests.
 *
 * DaisyUI 5 + React Aria: the link form + the table dimension grid render with `@idco/ui`
 * primitives inside the host's React Aria popover; the size grid is a small bespoke
 * control (no React Aria primitive models a "table size" grid), kept accessible with
 * native button semantics and labels.
 */
import { useState } from "react";
import { Button, Input } from "@quanghuy1242/idco-ui";
import {
  collectSelectionText,
  orderedTextLeaves,
  pointAtOffset,
  type EditorStore,
} from "../../../core";
import {
  registerCommand,
  registerToolbarSlot,
  registerToolbarTab,
  type CommandRenderContext,
} from "../../spi";
import { listToggleCommand } from "../chrome-commands";

/** The link editor body (docs/023 §7.3) — the migrated `set-link`/`clear-link` form. */
function LinkEditorBody({ ctx }: { readonly ctx: CommandRenderContext }) {
  // Seed from the active link the moment the popover opens (the body mounts on
  // open), the owned-engine equivalent of the old `onLinkOpenChange` seeding.
  const initial = ctx.store.query({ type: "active-link-href" });
  const linkActive = typeof initial === "string";
  const [value, setValue] = useState(linkActive ? initial : "");

  const apply = () => {
    const href = value.trim();
    if (href.length > 0) ctx.store.command({ href, type: "set-link" });
    else ctx.store.command({ type: "clear-link" });
    ctx.close();
  };

  return (
    <form
      className="grid w-64 gap-2"
      data-engine-link-editor=""
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <span className="text-xs font-medium opacity-70">Link URL</span>
      <Input
        ariaLabel="Link URL"
        autoFocus
        onChange={setValue}
        placeholder="https://example.com"
        size="sm"
        type="url"
        value={value}
      />
      <div className="flex items-center justify-end gap-2">
        {linkActive ? (
          <Button
            ariaLabel="Remove link"
            onClick={() => {
              ctx.store.command({ type: "clear-link" });
              ctx.close();
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
  );
}

/** Largest grid the dimension picker offers before the author types a size. */
const PICKER_MAX = 8;

/**
 * The table dimension picker (docs/023 §7.2): a hover/focus grid that dispatches a
 * *parameterized* structural insert. `rows` counts the header row, so the picker's
 * "C × R" maps to `{ rows: R, cols: C }`; the table core seeds a header row + (R-1)
 * body rows of C columns. The model selection survives the popover taking focus
 * (docs/011 §8.6), so the insert lands at the caret the author left. This is the
 * ribbon-only richer path; the slash menu inserts a default 3×3 (docs/024 §7.3).
 */
function TableInsertBody({ ctx }: { readonly ctx: CommandRenderContext }) {
  const [hover, setHover] = useState({ cols: 1, rows: 1 });

  const commit = (rows: number, cols: number) => {
    ctx.store.command({
      params: { cols, rows },
      structuralType: "table",
      type: "insert-structural",
    });
    ctx.close();
  };

  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium opacity-70">
        {hover.cols} × {hover.rows} table
      </span>
      <div
        aria-label="Table size"
        className="grid grid-cols-8 gap-0.5"
        role="grid"
      >
        {Array.from({ length: PICKER_MAX * PICKER_MAX }, (_, index) => {
          const rows = Math.floor(index / PICKER_MAX) + 1;
          const cols = (index % PICKER_MAX) + 1;
          const filled = rows <= hover.rows && cols <= hover.cols;
          return (
            <button
              aria-label={`${cols} by ${rows}`}
              className={`size-5 rounded-xs border border-base-300 ${
                filled ? "bg-primary" : "bg-base-200"
              }`}
              key={index}
              onClick={() => commit(rows, cols)}
              onFocus={() => setHover({ cols, rows })}
              onMouseEnter={() => setHover({ cols, rows })}
              type="button"
            />
          );
        })}
      </div>
    </div>
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

let builtInCommandsRegistered = false;

/**
 * Register the built-in tabs, slots, and commands once (idempotent). Called by the
 * view orchestrator (`react-view`); the guard means a second call cannot clobber a
 * host's override registered first. See the file header for the `sideEffects`
 * rationale (docs/023 §5.2/§9).
 */
export function registerBuiltInCommands(): void {
  if (builtInCommandsRegistered) return;
  builtInCommandsRegistered = true;

  // --- Ribbon tabs (docs/023 §5.4/§7) ----------------------------------------
  // Home and Insert ship with content; View/Review/Data/AI are registered so the
  // model knows them but ship no slots/commands and so resolve empty and are
  // dropped (docs/023 §7.4). Review/Data/AI gate on their capability to demo §5.6.
  registerToolbarTab({ id: "home", label: "Home" });
  registerToolbarTab({ id: "insert", label: "Insert" });
  registerToolbarTab({ id: "view", label: "View" });
  registerToolbarTab({
    id: "review",
    isAvailable: (ctx) => ctx.capabilities.review,
    label: "Review",
  });
  registerToolbarTab({
    id: "data",
    isAvailable: (ctx) => ctx.capabilities.media,
    label: "Data",
  });
  registerToolbarTab({
    id: "ai",
    isAvailable: (ctx) => ctx.capabilities.ai,
    label: "AI",
  });

  // Persistent (tab-independent) quick-access zone (docs/023 §7.1): undo/redo left
  // (the QAT position), find right. `find`'s control is injected by the ribbon
  // (its handler is a host prop), so only the slot is registered here.
  registerToolbarSlot({ id: "global.history", persistent: "start" });
  registerToolbarSlot({ id: "global.utilities", persistent: "end" });

  // Home slots, left to right — registration order is render order (docs/023 §7.1).
  registerToolbarSlot({ id: "home.text", tab: "home" });
  registerToolbarSlot({ id: "home.format", tab: "home" });
  registerToolbarSlot({ id: "home.lists", tab: "home" });
  registerToolbarSlot({ id: "home.annotate", tab: "home" });
  // Insert slots (docs/023 §7.2): the table dimension picker, then a projection of
  // every other registered insertable (DEFAULT_TOOLBAR_LAYOUT's `inserts` note).
  registerToolbarSlot({ id: "insert.tables", tab: "insert" });
  registerToolbarSlot({ id: "insert.blocks", tab: "insert" });

  // --- Global edit-ops (docs/024 §7.1) — the context menu's former literals ----
  // Clipboard goes through the same model serialization the native Ctrl+C/X/V path
  // uses (`collectSelectionText` / `insert-text`), via the async Clipboard API since
  // a menu/keyboard gesture is a user gesture. `paste`'s `run` is async (it reads the
  // clipboard before dispatching); the context-menu host awaits it so editor focus is
  // restored after the insert lands (docs/024 §7.1). The model selection survives the
  // menu's focus (docs/011 §8.6), so the insert/delete lands on the right range.
  registerCommand({
    group: "edit",
    icon: "Scissors",
    id: "edit.cut",
    isDisabled: (ctx) => !ctx.selection.hasSelection,
    kind: "button",
    label: "Cut",
    run: (ctx) => {
      void navigator.clipboard
        ?.writeText(collectSelectionText(ctx.store, ctx.store.selection))
        .catch(() => {});
      ctx.store.command({ type: "delete-selection" });
    },
    surfaces: { contextMenu: "primary" },
  });
  registerCommand({
    group: "edit",
    icon: "Copy",
    id: "edit.copy",
    isDisabled: (ctx) => !ctx.selection.hasSelection,
    kind: "button",
    label: "Copy",
    run: (ctx) => {
      void navigator.clipboard
        ?.writeText(collectSelectionText(ctx.store, ctx.store.selection))
        .catch(() => {});
    },
    surfaces: { contextMenu: "primary" },
  });
  registerCommand({
    group: "edit",
    icon: "ClipboardPaste",
    id: "edit.paste",
    kind: "button",
    label: "Paste",
    run: async (ctx) => {
      try {
        const text = await navigator.clipboard?.readText();
        if (text) ctx.store.command({ text, type: "insert-text" });
      } catch {
        /* clipboard read denied — no-op */
      }
    },
    surfaces: { contextMenu: "primary" },
  });
  registerCommand({
    group: "edit",
    icon: "ListChecks",
    id: "edit.select-all",
    kind: "button",
    label: "Select all",
    run: (ctx) => selectAllInStore(ctx.store),
    surfaces: { contextMenu: "primary" },
  });
  registerCommand({
    group: "edit",
    icon: "Trash2",
    id: "edit.delete",
    isDisabled: (ctx) => !ctx.selection.hasSelection,
    kind: "button",
    label: "Delete",
    run: (ctx) => ctx.store.command({ type: "delete-selection" }),
    surfaces: { contextMenu: "primary" },
  });

  // --- History (ribbon persistent zone, docs/023 §7.1) ------------------------
  // Undo/redo are store methods, not commands, so the `run` calls them directly.
  registerCommand({
    group: "history",
    icon: "Undo2",
    id: "undo",
    isDisabled: (ctx) => !ctx.store.canUndo,
    kind: "button",
    label: "Undo",
    responsivePriority: 1,
    run: (ctx) => ctx.store.undo(),
    slot: "global.history",
    surfaces: { ribbon: "primary" },
  });
  registerCommand({
    group: "history",
    icon: "Redo2",
    id: "redo",
    isDisabled: (ctx) => !ctx.store.canRedo,
    kind: "button",
    label: "Redo",
    responsivePriority: 1,
    run: (ctx) => ctx.store.redo(),
    slot: "global.history",
    surfaces: { ribbon: "primary" },
  });

  // --- Lists + indent (ribbon Home + context menu, docs/023 §7.3 / docs/024 §7.1) -
  // The list flavour is read from the store so a bulleted item reads "bullet" and a
  // numbered item "number". These now also live on the context menu (block branch).
  registerCommand({
    group: "list",
    icon: "List",
    id: "list-bulleted",
    isActive: (ctx) => {
      const listType = ctx.store.query({ type: "current-list-type" });
      return listType !== null && listType !== "number";
    },
    kind: "toggle",
    label: "Bulleted list",
    responsivePriority: 3,
    run: (ctx) => {
      const listType = ctx.store.query({ type: "current-list-type" });
      const active = listType !== null && listType !== "number";
      ctx.store.command(listToggleCommand(active, "bullet"));
    },
    slot: "home.lists",
    surfaces: { contextMenu: "primary", ribbon: "primary" },
  });
  registerCommand({
    group: "list",
    icon: "ListOrdered",
    id: "list-numbered",
    isActive: (ctx) =>
      ctx.store.query({ type: "current-list-type" }) === "number",
    kind: "toggle",
    label: "Numbered list",
    responsivePriority: 3,
    run: (ctx) => {
      const active =
        ctx.store.query({ type: "current-list-type" }) === "number";
      ctx.store.command(listToggleCommand(active, "number"));
    },
    slot: "home.lists",
    surfaces: { contextMenu: "primary", ribbon: "primary" },
  });
  registerCommand({
    group: "indent",
    icon: "IndentDecrease",
    id: "outdent",
    kind: "button",
    label: "Outdent",
    responsivePriority: 2,
    run: (ctx) => ctx.store.command({ type: "outdent" }),
    slot: "home.lists",
    surfaces: { contextMenu: "primary", ribbon: "primary" },
  });
  registerCommand({
    group: "indent",
    icon: "IndentIncrease",
    id: "indent",
    kind: "button",
    label: "Indent",
    responsivePriority: 2,
    run: (ctx) => ctx.store.command({ type: "indent" }),
    slot: "home.lists",
    surfaces: { contextMenu: "primary", ribbon: "primary" },
  });

  // --- Annotate — link (ribbon Home + flyout + context menu, docs/023 §7.3) ----
  // A `popover` command renders its focused body on whichever surface shows it (the
  // ribbon/flyout as a popover, the context menu as a submenu); the editor selection
  // survives the popover focus so "apply link to selection" lands correctly.
  registerCommand({
    group: "annotate",
    icon: "Link",
    id: "link",
    isActive: (ctx) =>
      typeof ctx.store.query({ type: "active-link-href" }) === "string",
    kind: "popover",
    label: "Link",
    render: (ctx) => <LinkEditorBody ctx={ctx} />,
    responsivePriority: 2,
    slot: "home.annotate",
    surfaces: { contextMenu: "primary", flyout: "primary", ribbon: "primary" },
  });

  // --- Insert — the table dimension picker (ribbon only, docs/023 §7.2) --------
  // Ribbon-only: the slash menu inserts a default 3×3 via the generic structural
  // insert projection (docs/024 §7.3), so the picker does not target slash.
  registerCommand({
    group: "insert",
    icon: "Table",
    id: "insert.table",
    isAvailable: (ctx) => ctx.capabilities.insertTable,
    kind: "popover",
    label: "Table",
    render: (ctx) => <TableInsertBody ctx={ctx} />,
    slot: "insert.tables",
    surfaces: { ribbon: "primary" },
  });
}

// Convenience self-call for direct deep-imports / tests; correctness comes from the
// orchestrator's explicit call (see the file header).
registerBuiltInCommands();
