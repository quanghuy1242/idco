/**
 * Built-in toolbar surface — the Home and Insert tabs (docs/023 §7).
 *
 * This module registers the first-release ribbon through the toolbar SPI rather
 * than hardcoding it in the renderer (docs/023 §3.2/§7.3): the Home and Insert
 * tabs, their slots, and the controls that are not marks/block-types/inserts —
 * undo/redo, the list/indent buttons, the link editor, and the table dimension
 * picker. The block-type chooser and the format-mark group are placed by
 * `DEFAULT_TOOLBAR_LAYOUT` (they auto-project from their own registries); this file
 * owns everything with bespoke behavior.
 *
 * Registration runs through `registerBuiltInToolbarActions()`, called by the view
 * orchestrator (`react-view`) alongside the node/mark/block registrars. Per docs/023
 * §5.2/§9 that explicit call — not a bare module-load side effect — is the
 * correctness path that lets the package stay `sideEffects: false` without a bundler
 * tree-shaking the registration away. The bare self-call at the end is only a
 * convenience for direct deep-imports and tests.
 *
 * DaisyUI 5 + React Aria: the link form and the table dimension grid render with
 * `@idco/ui` primitives (Button/Input) inside the renderer's React Aria popover;
 * the size grid is a small bespoke control (no React Aria primitive models a
 * "table size" grid), kept accessible with native button semantics and labels.
 */
import { useState } from "react";
import { Button, Input } from "@quanghuy1242/idco-ui";
import { registerToolbarAction, type ToolbarActionRenderContext } from "../spi";
import { registerToolbarSlot, registerToolbarTab } from "../spi";
import { listToggleCommand } from "./chrome-commands";

/** The link editor body (docs/023 §7.3) — the migrated `set-link`/`clear-link` form. */
function LinkEditorBody({ ctx }: { readonly ctx: ToolbarActionRenderContext }) {
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
 * (docs/011 §8.6), so the insert lands at the caret the author left.
 */
function TableInsertBody({
  ctx,
}: {
  readonly ctx: ToolbarActionRenderContext;
}) {
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

let builtInToolbarRegistered = false;

/**
 * Register the built-in tabs, slots, and actions once (idempotent). Called by the
 * view orchestrator (`react-view`); the guard means a second call cannot clobber a
 * host's override registered first. See the file header for the `sideEffects`
 * rationale (docs/023 §5.2/§9).
 */
export function registerBuiltInToolbarActions(): void {
  if (builtInToolbarRegistered) return;
  builtInToolbarRegistered = true;

  // Tabs (docs/023 §5.4/§7). Home and Insert ship with content; View/Review/Data/AI
  // are registered so the model knows them, but ship no slots/actions and so resolve
  // empty and are dropped (docs/023 §7.4) — adding one later is registration, not a
  // redesign. Review/Data/AI also gate on their capability to demonstrate §5.6.
  registerToolbarTab({ id: "home", label: "Home", order: 0 });
  registerToolbarTab({ id: "insert", label: "Insert", order: 1 });
  registerToolbarTab({ id: "view", label: "View", order: 2 });
  registerToolbarTab({
    id: "review",
    isAvailable: (ctx) => ctx.capabilities.review,
    label: "Review",
    order: 3,
  });
  registerToolbarTab({
    id: "data",
    isAvailable: (ctx) => ctx.capabilities.media,
    label: "Data",
    order: 4,
  });
  registerToolbarTab({
    id: "ai",
    isAvailable: (ctx) => ctx.capabilities.ai,
    label: "AI",
    order: 5,
  });

  // Persistent (tab-independent) quick-access zone (docs/023 §7.1): undo/redo on the
  // left (the QAT position) and find on the right are document-global — they apply on
  // every tab, so they live in the tab strip, not in Home's command row. `find`'s
  // control is injected by `EditorToolbar` (its handler is a host prop), so only the
  // slot is registered here.
  registerToolbarSlot({ id: "global.history", order: 0, persistent: "start" });
  registerToolbarSlot({ id: "global.utilities", order: 0, persistent: "end" });

  // Home slots, left to right (docs/023 §7.1).
  registerToolbarSlot({ id: "home.text", order: 1, tab: "home" });
  registerToolbarSlot({ id: "home.format", order: 2, tab: "home" });
  registerToolbarSlot({ id: "home.lists", order: 3, tab: "home" });
  registerToolbarSlot({ id: "home.annotate", order: 4, tab: "home" });
  // Insert slots (docs/023 §7.2): the table dimension picker, then a projection of
  // every other registered insertable (so callout/code/media/… stay reachable; see
  // DEFAULT_TOOLBAR_LAYOUT's `inserts` note).
  registerToolbarSlot({ id: "insert.tables", order: 0, tab: "insert" });
  registerToolbarSlot({ id: "insert.blocks", order: 1, tab: "insert" });

  // home.history — undo / redo (the engine exposes these as store methods, not
  // commands, so the actions call them directly; docs/023 §7.1).
  registerToolbarAction({
    icon: "Undo2",
    id: "undo",
    isDisabled: (ctx) => !ctx.store.canUndo,
    kind: "button",
    label: "Undo",
    order: 0,
    responsivePriority: 1,
    run: (ctx) => ctx.store.undo(),
    slot: "global.history",
  });
  registerToolbarAction({
    icon: "Redo2",
    id: "redo",
    isDisabled: (ctx) => !ctx.store.canRedo,
    kind: "button",
    label: "Redo",
    order: 1,
    responsivePriority: 1,
    run: (ctx) => ctx.store.redo(),
    slot: "global.history",
  });

  // home.lists — list toggles + indent/outdent, migrated from hardcoded JSX with
  // byte-identical behavior (docs/023 §7.3). The list flavour is read from the
  // store so a bulleted item reads "bullet" and a numbered item "number".
  registerToolbarAction({
    icon: "List",
    id: "list-bulleted",
    isActive: (ctx) => {
      const listType = ctx.store.query({ type: "current-list-type" });
      return listType !== null && listType !== "number";
    },
    kind: "toggle",
    label: "Bulleted list",
    order: 0,
    responsivePriority: 3,
    run: (ctx) => {
      const listType = ctx.store.query({ type: "current-list-type" });
      const active = listType !== null && listType !== "number";
      ctx.store.command(listToggleCommand(active, "bullet"));
    },
    slot: "home.lists",
  });
  registerToolbarAction({
    icon: "ListOrdered",
    id: "list-numbered",
    isActive: (ctx) =>
      ctx.store.query({ type: "current-list-type" }) === "number",
    kind: "toggle",
    label: "Numbered list",
    order: 1,
    responsivePriority: 3,
    run: (ctx) => {
      const active =
        ctx.store.query({ type: "current-list-type" }) === "number";
      ctx.store.command(listToggleCommand(active, "number"));
    },
    slot: "home.lists",
  });
  registerToolbarAction({
    icon: "IndentDecrease",
    id: "outdent",
    kind: "button",
    label: "Outdent",
    order: 2,
    responsivePriority: 2,
    run: (ctx) => ctx.store.command({ type: "outdent" }),
    slot: "home.lists",
  });
  registerToolbarAction({
    icon: "IndentIncrease",
    id: "indent",
    kind: "button",
    label: "Indent",
    order: 3,
    responsivePriority: 2,
    run: (ctx) => ctx.store.command({ type: "indent" }),
    slot: "home.lists",
  });

  // home.annotate — link (popover), migrated from hardcoded JSX (docs/023 §7.3).
  registerToolbarAction({
    icon: "Link",
    id: "link",
    isActive: (ctx) =>
      typeof ctx.store.query({ type: "active-link-href" }) === "string",
    kind: "popover",
    label: "Link",
    order: 0,
    render: (ctx) => <LinkEditorBody ctx={ctx} />,
    responsivePriority: 2,
    slot: "home.annotate",
  });

  // insert.tables — the table dimension picker (popover), gated by the insertTable
  // capability and backed by the parameterized structural insert (docs/023 §7.2).
  registerToolbarAction({
    icon: "Table",
    id: "insert.table",
    isAvailable: (ctx) => ctx.capabilities.insertTable,
    kind: "popover",
    label: "Table",
    order: 0,
    render: (ctx) => <TableInsertBody ctx={ctx} />,
    slot: "insert.tables",
  });
}

// Convenience self-call for direct deep-imports / tests; correctness comes from the
// orchestrator's explicit call (see the file header).
registerBuiltInToolbarActions();
