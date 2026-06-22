# 024 - Command-Surface SPI: Unified Ribbon, Context Menu, Selection Flyout, And Slash Menu

> Status: design-grade proposal (no implementation backlog by request)
>
> Date: 2026-06-22
>
> Scope:
>
> - `packages/editor/src/view/spi/toolbar-action-registry.ts` → **`command-registry.ts`** — `ToolbarAction` (→ `Command`) + `CommandSurface` + `CommandContext`/`ToolbarSelectionFacts`; the descriptor this document generalizes into a surface-neutral command (renamed off `toolbar-*`, see §5.8).
> - `packages/editor/src/view/spi/toolbar-layout.ts` → split into **`toolbar-layout.ts`** (ribbon-only tab/slot layout + `computeToolbarLayout`, keeps the name) **+ `command-surface.ts`** (the surface-neutral `resolveCommandList` family, §5.8).
> - `packages/editor/src/view/spi/node-view.ts`, `packages/editor/src/view/spi/structural-view.ts` — the object/structural node SPIs that gain a `contributeCommands` slot (the scope-contribution source).
> - `packages/editor/src/view/chrome/context-menu.tsx` → **`chrome/surfaces/context-menu.tsx`** — the right-click menu (`useContextMenu` + `EngineContextMenu`), today partly hardcoded, re-sourced from the SPI and moved into the new surfaces folder (§5.8).
> - `packages/editor/src/view/chrome/toolbar-builtins.tsx` → **`chrome/surfaces/command-builtins.tsx`** — where built-in commands declare their `surfaces` maps (no longer toolbar-only; now also the context-menu edit-ops).
> - New surface hosts under `chrome/surfaces/`: `selection-flyout.tsx`, `slash-menu.tsx`, `use-command-surfaces.ts` (the §8 coordinator); `editor-chrome.tsx` → `ribbon.tsx` (§5.8).
> - `packages/editor/src/view/nodes/table/table-controls.tsx`, `packages/editor/src/view/nodes/table/table-interactions.tsx` — the bespoke table structure/cell menus to fold into scope contributions.
> - `packages/editor/src/view/render/text-block.tsx` — the input path (`detectMarkdownShortcut`) the slash trigger joins.
> - `packages/editor/src/view/overlays/geometry.ts`, `packages/editor/src/view/overlays/selection-overlay.tsx` — `boundingRectOf`/`caretClientRect`/`selectionRects` (the flyout/slash anchor geometry, already present).
> - `packages/editor/src/core/commands/shared.ts` — `activeScope`/`scopePath`/`childrenOf` (the scope walk).
>
> Reference (shape only, NOT ported):
>
> - `packages/editor-legacy/src/model/commands.ts` — the legacy Lexical editor's `CommandSurface`/`CommandPlacement`/`EditorCommand.surfaces`/`surfaceCommands`/`COMMAND_GROUP_ORDER`. The owned engine was built from the ground up with its own registries; legacy is consulted as a proven design of the *surface-projection idea*, not imported or floored upon.
> - `packages/editor-legacy/src/plugins/selection-flyout-plugin.tsx` — the legacy selection flyout (trigger, geometry, and the close-on-interact-outside conflict guards), the proven shape for §7.2.
>
> Source docs:
>
> - `docs/023_toolbar_spi_and_ribbon_lite_surface.md` — the ribbon SPI this extends. §6.2 decided "no central command registry; each surface projects the per-concern registries filtered by a `surfaces` tag." This document is the cash-out of that decision across all four surfaces (the chosen Option A).
> - `docs/016_node_spi_and_pluggable_blocks.md`, `docs/021_structural_node_spi.md` — the node SPIs the `contributeCommands` slot extends, modeled on `caretInk`/`renderOverlay`/`handleTab` (note.md W1/VP6).
> - `docs/004_selection_flyout_and_context_actions.md` — the legacy-era selection-flyout/context-actions design.
> - `docs/006_editor_toolbar_redesign_plan.md` — the ribbon-lite philosophy + the three-surface orthogonality (§3.11/§7.8).
>
> Assumptions:
>
> - The owned-model engine is the only editor in scope. The legacy package is reference-only.
> - "Register, don't hardcode" (docs/016 §10) governs: a command appears on a surface by declaring it, and a node contributes scope-specific commands by implementing a slot — never by a surface growing a per-type branch.
> - Option A (docs/023 §6.2 / this doc §6.1) is chosen: keep the per-concern registries; generalize the toolbar's `surfaces` tag + `computeToolbarLayout` into a surface family. There is **no** central `EditorCommand` list (that is the rejected legacy port).
> - All interactive surfaces are React Aria behavior + DaisyUI styling (AGENTS.md, idco-ui SKILL). No hand-rolled menus/popovers/listboxes.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 The Surface Inventory](#31-the-surface-inventory)
  - [3.2 What Is Hardcoded](#32-what-is-hardcoded)
  - [3.3 The Layers Are Real But Fragmented](#33-the-layers-are-real-but-fragmented)
  - [3.4 The `surfaces` Tag Is Unconsumed Beyond The Ribbon](#34-the-surfaces-tag-is-unconsumed-beyond-the-ribbon)
  - [3.5 The Legacy Reference](#35-the-legacy-reference)
- [4. Design Principles](#4-design-principles)
- [5. Target Model: The Command-Surface SPI](#5-target-model-the-command-surface-spi)
  - [5.1 Two Axes: Surface And Scope](#51-two-axes-surface-and-scope)
  - [5.2 The Surface-Neutral Command Descriptor](#52-the-surface-neutral-command-descriptor)
  - [5.3 Item Sources: Registry Projection + Scope Contribution](#53-item-sources-registry-projection--scope-contribution)
  - [5.4 The Command Context](#54-the-command-context)
  - [5.5 `resolveSurface` — The Shared Projector](#55-resolvesurface--the-shared-projector)
  - [5.6 Groups And Ordering](#56-groups-and-ordering)
  - [5.7 Public Surface Additions](#57-public-surface-additions)
  - [5.8 File And Folder Layout](#58-file-and-folder-layout)
- [6. Architecture Decisions](#6-architecture-decisions)
  - [6.1 Option A: Extend The Toolbar Pattern, No Central Command Registry (Recommended)](#61-option-a-extend-the-toolbar-pattern-no-central-command-registry-recommended)
  - [6.2 Scope Contribution Via A Node Slot, Not Per-Surface Branches (Recommended)](#62-scope-contribution-via-a-node-slot-not-per-surface-branches-recommended)
  - [6.3 By-Kind Default Participation For Flat Surfaces; Explicit Layout Only For The Ribbon (Recommended)](#63-by-kind-default-participation-for-flat-surfaces-explicit-layout-only-for-the-ribbon-recommended)
  - [6.4 One Context Menu, Scope-Merged (Recommended)](#64-one-context-menu-scope-merged-recommended)
  - [6.5 Rejected And Deferred Options](#65-rejected-and-deferred-options)
- [7. The Surfaces In Detail](#7-the-surfaces-in-detail)
  - [7.1 Context Menu](#71-context-menu)
  - [7.2 Selection Flyout](#72-selection-flyout)
  - [7.3 Slash Menu](#73-slash-menu)
  - [7.4 Table And Object Operations As Scope Contributions](#74-table-and-object-operations-as-scope-contributions)
- [8. Conflict Resolution And Coordination](#8-conflict-resolution-and-coordination)
- [9. Risks, Caveats, Edge Cases, And Failure Modes](#9-risks-caveats-edge-cases-and-failure-modes)
- [10. Test And Verification Plan](#10-test-and-verification-plan)
- [11. Definition Of Done](#11-definition-of-done)
- [12. Final Model](#12-final-model)

## 1. Goal

Make the owned editor's *command surfaces* — the ribbon, the right-click context menu, the selection flyout, and the slash menu — projections of one descriptor model, so a command appears on the surfaces it declares, gated by the live scope, with no surface holding a hardcoded item list and no two surfaces able to drift. The ribbon already works this way (docs/023). This document extends that same mechanism to the other three, adds the two that do not yet exist (flyout, slash), and folds the editor's two remaining piles of hardcoded menus — the context menu's literal items and the table's bespoke cell/structure menus — into the model.

The thesis under test: if "register, don't hardcode" is real, adding the slash menu is *tag descriptors + write one host*, not a fifth re-aggregation of marks/blocks/inserts/actions. If it tempts a parallel command list, the design failed.

Non-goals (explicitly out of this document):

- No implementation backlog or ticket breakdown. This is a design specification.
- No port of the legacy `commands.ts`. The owned engine keeps its per-concern registries; legacy is a reference for the *projection idea* only.
- No change to the object-block **config** chrome (the gear popover, `NodeView.renderChrome`/`configFields`). That is a *settings form*, not a command surface, and stays as-is; this document only adds command *contributions* from object/structural scopes.
- No new editing commands. Every surface dispatches the store commands that already exist (`toggle-mark`, `set-block-type`, `indent`, `set-link`, `insert-structural`, the table operations, …).

## 2. System Summary

The owned editor distinguishes command surfaces by *how the author invokes a command* (docs/006 §3.11) and *what is currently selected*. Today only one surface is principled (the ribbon, docs/023); the rest are partial or absent. The end state is four surfaces, all fed by `resolveSurface(surface, ctx)`:

- **Ribbon** — the persistent toolbar; task tabs + the global quick-access zone (docs/023). Invoked by pointing.
- **Context menu** — right-click; the commands valid for the right-clicked scope. Invoked by `contextmenu`.
- **Selection flyout** — a floating bar over a non-collapsed text selection; inline formatting + annotate + insert-at-selection. Invoked by *making* a selection.
- **Slash menu** — a caret-anchored, keyword-filtered command list; insert + turn-into. Invoked by typing `/`.

All four read engine state through `store.query` and mutate through `store.command`; none touch the DOM selection. The model selection survives focus loss (docs/011 §8.6), so a surface's overlay can take focus without losing the target. This document changes *how the non-ribbon surfaces are composed*, not the query/command/selection spine.

## 3. Current-State Findings

### 3.1 The Surface Inventory

| Surface | Mechanism today | Sourced from | State |
|---|---|---|---|
| Ribbon | `EditorToolbar` + `computeToolbarLayout` (`toolbar-layout.ts`) | registries + per-surface layout config (docs/023) | principled |
| Context menu | `useContextMenu` + `EngineContextMenu` (`context-menu.tsx`) | `listMarks`/`listBlockTypes` **plus literal `MenuItem`s** | partly hardcoded |
| Selection flyout | — | — | absent (exists only in `editor-legacy`) |
| Slash menu | — | — | absent |
| Table structure | `table-controls.tsx` hover overlay | bespoke literals (`TABLE_LAYOUTS`, header toggles) | hardcoded |
| Table cell `…` | `table-interactions.tsx` popover | bespoke literals (`FILL_COLORS`, merge/align) | hardcoded |
| Object config | `NodeView.renderChrome`/`configFields` (the gear) | node SPI | principled but *not a command surface* (a settings form) |

### 3.2 What Is Hardcoded

- **Context menu** (`context-menu.tsx`): cut/copy/paste/select-all/delete are literal `MenuItem`s (≈ lines 156–210); list/indent/outdent are literal `MenuItem`s again (≈ lines 285–322) — the exact controls the ribbon already migrated off hardcoding (docs/023 §7.3). It branches on the selection into `kind: "selection"` (inline formats) vs `kind: "block"` (block types + list/indent), and on a non-text selection it returns early (`context-menu.tsx:51`), so right-clicking an object yields the *browser* menu — objects have no context surface at all.
- **Table** (`table-controls.tsx` / `table-interactions.tsx`): insert/delete row+column, header-row/header-column/row-numbers toggles, layout select, and the cell `…` popover (merge/unmerge, fill palette, vertical align) are all literal JSX in two `renderOverlay` portals. `table-interactions.tsx:11–12` records the workaround: *"Right-click stays the editor's `EngineContextMenu` (one menu only)"* — i.e. table actions were deliberately kept out of the right-click menu to avoid two menus, and pushed into floating affordances instead. The consequence: right-click inside a cell shows the generic text/block menu with **zero** table actions.

### 3.3 The Layers Are Real But Fragmented

The engine has genuine scope layers, but each invented its own UI mechanism, and they do not share a model:

- **Global / document** — undo/redo/find (ribbon persistent zone, docs/023 §7.1).
- **Text-selection** — marks + block type. Sourced from `MarkDefinition`/`BlockTypeDefinition`; surfaced on the ribbon Home tab and the context menu's text branch. The live facts already exist as `ToolbarSelectionFacts` (`blockType`, `activeMarks`, `hasSelection`, `selectedText`, `inObject`).
- **Object-block** — `NodeView.renderChrome`/`chromeMeta`/`configurable`/`configFields` (node-view.ts:47–139), plus `store.activeObjectId` as the "this object is active" signal (object-block.tsx). A *config form*, not commands.
- **Structural** — `StructuralNodeView.renderOverlay`/`handleTab`/`caretInk` (structural-view.ts). The table cell/structure ops live here as a bespoke blob.

The scope itself is computable today: `activeScope(store, selection)` and `scopePath(store, selection)` (`core/commands/shared.ts:278–306`) give the innermost-first container chain, `node.kind` discriminates `text` / `structural` / `object`, and `store.activeObjectId` flags an active object. So the engine *can* answer "what scope am I in" — nothing consumes it for command routing.

### 3.4 The `surfaces` Tag Is Unconsumed Beyond The Ribbon

docs/023 added `ToolbarSurface = "ribbon" | "flyout" | "contextMenu"` (`toolbar-action-registry.ts:38`) and `ToolbarAction.surfaces` precisely to reserve this. But `actionTargetsSurface` is only ever called with `"ribbon"` (in `toolbar-layout.ts`), and the context menu does not consult it. The seam exists; nothing rides it. This document is what rides it (and adds `"slash"`).

### 3.5 The Legacy Reference

The legacy Lexical editor already solved this and the owned engine dropped it on extraction. `editor-legacy/src/model/commands.ts` has `CommandSurface = "toolbar" | "flyout" | "slash" | "context"` (line 64), `CommandPlacement = "primary" | "more"` (line 67), `EditorCommand.surfaces: Partial<Record<CommandSurface, CommandPlacement>>` (line 106) with `isAvailable/isEnabled/isActive/run(ctx)` + `group` + `keywords`, a fixed `COMMAND_GROUP_ORDER` (line 70), and `surfaceCommands(ctx, surface, placement?)` / `groupedSurfaceCommands` projecting one list onto any surface (line 417+). The flyout (`selection-flyout-plugin.tsx`) triggered on a settled non-collapsed selection, anchored via `selectedTextAnchorPoint`, and resolved conflicts with `shouldSelectionFlyoutCloseOnInteractOutside` + `data-editor-selection-flyout` / `data-editor-selection-action-popover` markers so child popovers (link/comment) did not dismiss it.

The owned engine deliberately does **not** adopt legacy's single `EditorCommand` list (that competes with the per-concern registries, docs/023 §6.2). It adopts the *projection idea* — `surfaces` placement map + `surfaceCommands`-style resolver + `COMMAND_GROUP_ORDER` + the flyout's trigger/geometry/conflict shape — and feeds it from the owned registries and a new node contribution slot instead.

## 4. Design Principles

1. **One descriptor, many surfaces.** A command declares the surfaces it lives on (and its placement on each); it does not know which surface is rendering it. Surfaces are projections, never authors of items.
2. **Scope decides availability, surface decides presentation.** Whether a command shows is a function of the live scope (text/block/object/structural/global); how it shows (button, menu item, flyout chip, slash row) is the surface's renderer.
3. **Provenance gates, never navigates (docs/006 §3.15).** A host binding being absent disables/hides a command; it never moves it to a different surface. Image stays an Insert command whether or not its picker is host-backed.
4. **The node owns its scoped commands.** A block contributes its own commands for the scope it defines (a table cell contributes merge/fill/align), the same way it owns its render, overlay, and Tab handling. Generic surfaces hold no per-type knowledge.
5. **One surface instance at a time per kind.** Exactly one context menu, one flyout, one slash menu can be open; a surface opening dismisses the conflicting ones by rule, not by race.
6. **Keep the registries; add a projector.** No central command list. The marks/block-types/inserts/actions registries stay the source of truth; surfaces are resolved from them plus scope contributions.
7. **The ribbon is the special one.** Only the ribbon has a bespoke arrangement (tabs/slots, docs/023). The menu-like surfaces (context/flyout/slash) are *grouped lists in a fixed group order* — simpler, and they should not grow a tab/slot layout.

## 5. Target Model: The Command-Surface SPI

### 5.1 Two Axes: Surface And Scope

Every command lives at the intersection of two orthogonal axes:

- **Surface (how invoked)** — `CommandSurface = "ribbon" | "contextMenu" | "flyout" | "slash"`. (The object-config gear is *not* a command surface; it is a settings form and stays out of this axis.)
- **Scope (what targeted)** — derived from the live selection: `global` (always), `text` (a caret/range in a text leaf), `block` (the text leaf's block, for turn-into), `structural` (the innermost structural container — a cell, a callout), `object` (an active object node). Computed from `scopePath` + `node.kind` + `store.activeObjectId` (§3.3).

A command participates in 1+ surfaces (with a placement each) and is *available* in 1+ scopes. `resolveSurface(surface, ctx)` is the function that, given the live scope in `ctx`, returns the commands for that surface.

### 5.2 The Surface-Neutral Command Descriptor

The existing `ToolbarAction` (docs/023 §5.2) generalizes into the surface-neutral command. The one shape change: `surfaces` becomes a **placement map**, not an array.

```ts
// packages/editor/src/view/spi/command-registry.ts (was toolbar-action-registry.ts, §5.8)

export type CommandSurface = "ribbon" | "contextMenu" | "flyout" | "slash";

/** Inline/primary on the surface vs tucked into its overflow ("More"). */
export type CommandPlacement = "primary" | "more";

export type CommandKind = "toggle" | "button" | "dropdown" | "popover";

export type ToolbarAction = {
  readonly id: string;
  readonly kind: CommandKind;
  readonly label: string;
  readonly icon: string;
  /** Fixed group for ordering across surfaces (see §5.6). */
  readonly group: CommandGroup;
  /** Fuzzy-search terms; the slash menu's primary filter signal. */
  readonly keywords?: readonly string[];
  /** Per-surface placement; an absent surface key means "not shown there". */
  readonly surfaces: Partial<Record<CommandSurface, CommandPlacement>>;
  /** The ribbon still needs a slot id when present on the ribbon (docs/023). */
  readonly slot?: string;
  readonly order?: number;
  readonly responsivePriority?: number;
  isActive?(ctx: CommandContext): boolean;
  isDisabled?(ctx: CommandContext): boolean;
  isAvailable?(ctx: CommandContext): boolean;
  run?(ctx: CommandContext): void;
  render?(ctx: CommandContext & { close(): void }): ReactNode;
};
```

`surfaces: { ribbon: "primary" }` reproduces docs/023's default. A link command becomes `surfaces: { ribbon: "primary", flyout: "primary", contextMenu: "primary" }`; a table-insert `surfaces: { ribbon: "primary", slash: "primary", contextMenu: "more" }`. `actionTargetsSurface(action, surface)` (docs/023) becomes `action.surfaces[surface] !== undefined`. The migration from the array form is mechanical and local — only built-ins and the ribbon resolver read it.

The name `ToolbarAction` is now a slight misnomer (it is a command, not a toolbar-only thing); whether to rename it `Command`/`SurfaceCommand` is a cosmetic decision recorded in §6.5. The shape is what matters.

### 5.3 Item Sources: Registry Projection + Scope Contribution

A surface's items come from two sources, merged:

1. **Registry projection (global commands).** The marks, block-types, node-inserts, and toolbar-action registries already exist. Each contributes to a surface per §6.3 (by-kind default participation for the flat surfaces; the explicit ribbon layout for the ribbon). This is everything *not* tied to a specific block instance: inline formats, turn-into block types, insert-this-block, undo/redo, link, find, the edit-ops (cut/copy/paste/select-all/delete) registered as commands tagged `contextMenu`.
2. **Scope contribution (instance commands).** A new node-SPI slot lets the block under the caret/selection contribute commands for *its* scope:

```ts
// added to NodeView (object) and StructuralNodeView (structural)
contributeCommands?(ctx: CommandContext): readonly ToolbarAction[];
```

`resolveSurface` walks `scopePath(store, selection)` innermost-first, calls each scope node's `contributeCommands(ctx)` (if registered), and merges the results. A `tablecell` structural view contributes merge/fill/align; a `table` view contributes insert/delete row+column + header toggles; an `image` object view contributes "replace"/"alt text"; and so on. This is the `caretInk`/`renderOverlay`/`handleTab` pattern (note.md W1/VP6) extended to commands — the generic surfaces enumerate the slot and keep no per-type knowledge.

This is the resolution of §3.2's table problem: the table's ops stop being a bespoke overlay menu and become `contributeCommands` returning commands tagged `{ contextMenu: "primary" }` (and optionally `flyout`/`ribbon`), so right-clicking a cell shows them in the one context menu. The genuinely-spatial affordances (drag-to-resize column, the row/column insert *handles* between cells) stay in `renderOverlay` — they are geometry, not menu commands.

### 5.4 The Command Context

`ToolbarActionContext` (docs/023 §5.3) extends with the scope so contributions and predicates can reason about where the caret is:

```ts
export type CommandScope = {
  /** Root-first container chain enclosing the selection (`scopePath`). */
  readonly path: readonly NodeId[];
  /** The innermost container id (last of `path`), or the body root. */
  readonly innermost: NodeId;
  /** The innermost container's node kind, for quick dispatch. */
  readonly innermostKind: "structural" | "object" | "root";
  /** The active object id (`store.activeObjectId`), or null. */
  readonly activeObject: NodeId | null;
};

export type CommandContext = {
  readonly store: EditorStore;
  readonly selection: ToolbarSelectionFacts; // hasSelection/selectedText/blockType/activeMarks/inObject
  readonly scope: CommandScope;
  readonly capabilities: ToolbarCapabilities;
};
```

`selection` already exists and is real (docs/023 §5.3 fixed the legacy `hasSelectedText: false` bug). `scope` is computed once per resolve from `scopePath`/`activeScope`/`store.activeObjectId`. Everything is derived from the model under the existing `useToolbarVersion` subscription, so no new reactivity.

### 5.5 `resolveSurface` — The Shared Projector

The ribbon's `computeToolbarLayout` (docs/023 §5.5) becomes one member of a family. The flat surfaces share a simpler resolver because they are grouped lists, not tab/slot arrangements:

```ts
export type ResolvedCommand = {
  readonly id: string;
  readonly command: ToolbarAction;
  readonly active: boolean;
  readonly disabled: boolean;
  readonly placement: CommandPlacement;
};
export type ResolvedCommandGroup = { readonly group: CommandGroup; readonly items: readonly ResolvedCommand[] };

/** Context/flyout/slash: a flat, grouped, ordered command list for one surface. */
export function resolveCommandList(
  surface: Exclude<CommandSurface, "ribbon">,
  ctx: CommandContext,
): readonly ResolvedCommandGroup[];

/** Ribbon keeps its richer tab/slot resolver (docs/023). */
export function computeToolbarLayout(ctx: CommandContext, config?): ResolvedToolbarLayout;
```

`resolveCommandList(surface, ctx)`:

1. Gather **global commands**: registry projection for `surface` (the marks/block-types/inserts/actions that declare `surfaces[surface]`, per §6.3) — each resolved to a `ResolvedCommand` (active/disabled/placement) and dropped if `isAvailable` is false.
2. Gather **scope contributions**: for each id in `ctx.scope.path` (innermost-first), the node view's `contributeCommands(ctx)`, filtered to those declaring `surfaces[surface]`.
3. **Gate**: drop `isAvailable === false`; compute `isDisabled`/`isActive`.
4. **Group + order**: bucket by `group`, order groups by `COMMAND_GROUP_ORDER` (§5.6), drop empty groups. Scope contributions slot into their declared group (a cell's merge command in group `structure`), so they interleave with global commands by group, not by source.
5. **Placement**: `primary` items render inline / in the main list; `more` items render in the surface's overflow ("More") submenu. The context menu and flyout honor this; the slash menu treats `more` as lower-rank in the filtered list.

This is pure and DOM-free (it reads the model via `ctx`, never the DOM), so a surface's contents are unit-asserted by calling `resolveCommandList`, exactly as docs/023 §5.5 made the ribbon testable.

### 5.6 Groups And Ordering

A fixed group order keeps every surface's items in the same relative sequence (legacy `COMMAND_GROUP_ORDER`, adapted):

```ts
export type CommandGroup =
  | "edit"        // cut/copy/paste/select-all/delete (context menu)
  | "history"     // undo/redo
  | "blockStyle"  // paragraph/heading/quote turn-into
  | "inlineFormat"// bold/italic/underline/strike/code (the marks)
  | "list"        // bulleted/numbered
  | "indent"      // indent/outdent
  | "annotate"    // link/comment/glossary
  | "insert"      // callout/table/media/divider/…
  | "structure"   // table/cell ops (scope-contributed)
  | "object";     // object-instance ops (scope-contributed)

export const COMMAND_GROUP_ORDER: readonly CommandGroup[] = [
  "edit", "history", "blockStyle", "inlineFormat", "list",
  "indent", "annotate", "insert", "structure", "object",
];
```

Each surface shows the groups relevant to it (the context menu shows `edit` first; the flyout omits `edit`/`history`/`insert`-heavy groups; the slash menu is dominated by `blockStyle`/`insert`). The group a command belongs to is fixed; the surface decides which groups it renders.

### 5.7 Public Surface Additions

New exports on `packages/editor/src/view/spi/index.ts` (and the curated root, docs/020 §4.5):

- Types: `CommandSurface`, `CommandPlacement`, `CommandGroup`, `CommandScope`, `CommandContext` (the renamed/extended `ToolbarActionContext`), and the generalized command descriptor `Command` (renamed from `ToolbarAction`, §5.8, carrying the `surfaces` map). `COMMAND_GROUP_ORDER`. Registration renames accordingly: `registerToolbarAction → registerCommand`, etc.
- Node SPI: `contributeCommands` is a new optional member of `NodeView` and `StructuralNodeView` (registered through the existing `registerNode`), plus an internal `listCommandContributors()` enumerator mirroring `listOverlayStructuralViews`/`listTabHandlers`.
- `resolveCommandList` and the `Resolved*` command types stay orchestrator-internal (deep-imported by the surface hosts and tests), like `computeToolbarLayout` (docs/023 §5.8).
- New host components (each thin, like `EditorToolbar`): `EngineContextMenu` (re-sourced), `SelectionFlyout` (new), `SlashMenu` (new), wired by `OwnedModelEditor`.

### 5.8 File And Folder Layout

Generalizing the toolbar descriptors *out of* "toolbar" means the `toolbar-*` filenames would lie. The rule: a file keeps a `toolbar-*` name only for what is genuinely ribbon-specific (the tab/slot layout); everything surface-neutral moves to a `command-*` name. This **decides** the `ToolbarAction → Command` rename that an earlier draft deferred (§6.5) — you cannot generalize the behavior and keep the toolbar-scoped names.

`view/spi/` — the registries / host extension surface:

| Today | After 024 | Why |
|---|---|---|
| `toolbar-action-registry.ts` | **`command-registry.ts`** | becomes the surface-neutral command (`Command`, `CommandSurface`, `CommandPlacement`, `CommandContext`, `CommandScope`, `register/get/list/unregisterCommand`); no longer toolbar-only |
| `toolbar-layout.ts` | `toolbar-layout.ts` **(ribbon-only)** + **`command-surface.ts`** (new) | `computeToolbarLayout` + `ToolbarTab/Slot/Item` + `DEFAULT_TOOLBAR_LAYOUT` are genuinely the ribbon's and keep the toolbar name (the ribbon *is* the toolbar); the shared resolver — `resolveCommandList`, `CommandGroup`, `COMMAND_GROUP_ORDER`, `ResolvedCommand` — extracts to `command-surface.ts` |
| `node-view.ts`, `structural-view.ts` | unchanged names, **+ `contributeCommands`** | scope contribution lives on the existing node SPIs |
| `mark-registry.ts`, `block-type-registry.ts` | unchanged | already surface-neutral |

`view/chrome/` — the surface hosts. The four command surfaces + the coordinator are a cohesive cluster (all consume `resolveCommandList`/`computeToolbarLayout`), so they earn a `chrome/surfaces/` folder the way the registries earned `spi/` (note.md VP1). This deliberately reverses VP2's flattening of `chrome/`: four surface hosts + a coordinator + the built-in command declarations is a real cluster, while `link-popover`/`find-bar`/`chrome-commands` are shared helpers (a child overlay, a controller, command builders) that stay at the chrome root.

```
view/chrome/
  surfaces/
    ribbon.tsx              (← editor-chrome.tsx; still exports EditorToolbar)
    context-menu.tsx        (moved in, re-sourced from resolveCommandList)
    selection-flyout.tsx    (new)
    slash-menu.tsx          (new)
    use-command-surfaces.ts (new — the §8 coordinator)
    command-builtins.tsx    (← toolbar-builtins.tsx; multi-surface + edit-ops)
    index.ts
  link-popover.tsx          (stays — a child overlay reused by flyout/ribbon)
  find-bar.tsx              (stays — its controller backs the ribbon's find command)
  chrome-commands.ts        (stays — shared command builders)
  index.ts
```

The barrels (`spi/index.ts`, `chrome/index.ts`) keep importers stable — only internal paths move — and the curated root (docs/020 §4.5) re-exports the same set, now under the renamed public symbols. The renamed exports (`registerToolbarAction → registerCommand`, `ToolbarAction → Command`, …) are the one intentional break; acceptable because these symbols are pre-release (no tagged publish has shipped the toolbar SPI yet — note.md docs/023 work is uncommitted). Moves use `git mv` to preserve history, per the W2/CP/VP precedent.

## 6. Architecture Decisions

### 6.1 Option A: Extend The Toolbar Pattern, No Central Command Registry (Recommended)

Recommended: generalize the toolbar's `surfaces` tag and `computeToolbarLayout` into the surface family above; keep the marks/block-types/inserts/actions registries as the source of truth.

Why: the owned engine's grain is per-concern registries (a `MarkDefinition` is the bold command's metadata; a `BlockTypeDefinition` is the heading entry's; an insert affordance is the node's). docs/023 §6.2 already chose this over a central `commands.ts`. A central `EditorCommand` list (the legacy shape) would be a second source of truth competing with those four registries, forcing every mark/block/node to be *also* declared as a command. Projection keeps each descriptor in one place and lets surfaces read them.

Rejected alternative — port legacy `commands.ts`: one flat `EditorCommand[]` with a `surfaces` map. It is the proven design and tempting to copy, but it contradicts the engine's registry grain and would duplicate the mark/block/insert metadata. The owned engine was built from the ground up on registries; flooring it on legacy's list now would be a regression in architecture even if faster to write. We take legacy's *projection idea*, not its storage.

### 6.2 Scope Contribution Via A Node Slot, Not Per-Surface Branches (Recommended)

Recommended: a block contributes its scoped commands through `contributeCommands(ctx)` on its node view; `resolveSurface` walks `scopePath` and collects. This is the same inversion `renderOverlay`/`handleTab`/`caretInk` already use — the node owns the behavior, the generic surface enumerates a slot.

Why: the alternative is each surface branching on node type ("if in a table cell, add these items"), which is exactly the hardcoding §3.2 documents (the table's bespoke menus) reproduced inside the context menu. With a slot, a host's custom block contributes its own right-click/flyout/slash commands with zero edits to any surface. It also localizes the table's ops to the table node, shrinking `table-interactions.tsx`/`table-controls.tsx` to the genuinely-spatial affordances.

Cost: a command can now come from two places (registry or contribution). Resolved by group+order being the single merge key — a contributed command declares its `group`, so it interleaves deterministically regardless of source.

### 6.3 By-Kind Default Participation For Flat Surfaces; Explicit Layout Only For The Ribbon (Recommended)

Recommended: the ribbon keeps its explicit tab/slot layout config (docs/023). The flat surfaces (context/flyout/slash) do **not** get per-surface layout configs; instead, registry descriptors carry a default surface participation by kind, overridable per descriptor:

- A toolbar mark (`MarkDefinition.toolbar`) participates in `ribbon` + `flyout` + `contextMenu` as `inlineFormat`/primary (inline formats belong on every text surface).
- A chooser block type (`BlockTypeDefinition.chooser`) participates in `contextMenu` (block branch) + `slash` (turn-into) as `blockStyle`; on the ribbon it is the chooser control (its existing special placement).
- An insert affordance (with `keywords`/`group`) participates in `slash`/primary + `contextMenu`/more + the ribbon Insert tab as `insert`.
- A `ToolbarAction` declares its `surfaces` map explicitly (link, table-picker, edit-ops, …).

Why: the menu-like surfaces are *grouped lists in a fixed order* (§5.6); there is nothing to arrange, so a layout config per surface would be ceremony that re-lists the same descriptors four times. By-kind defaults keep "register a mark → it appears on every text surface" true without config. This is the one place a descriptor implies placement, justified because (unlike the ribbon's bespoke tab arrangement) the flat surfaces have no arrangement to externalize — it mirrors legacy's `groupedSurfaceCommands` and is the pragmatic read of docs/023 §6.1's "placement lives in the layout" (here, the layout *is* the fixed group order).

### 6.4 One Context Menu, Scope-Merged (Recommended)

Recommended: kill the table's "separate overlay so we don't double-menu" workaround (§3.2). There is exactly one context menu; on right-click it resolves the scope and *merges* every contributing scope's commands (innermost-first) with the global context commands, grouped by §5.6. Right-clicking a table cell then shows: edit-ops, inline formats (if a selection), block turn-into, and the cell/table `structure` group — in one menu. Right-clicking an object shows the object's contributed commands (replacing today's fallback to the native browser menu).

Why: "one menu only" was achieved by *omission* (table ops simply absent from right-click). Scope-merge achieves it by *composition* — the menu is the union of the scopes the click lands in, ordered by group. It removes the native-menu fallback for objects and makes the table's ops discoverable where users expect them.

### 6.5 Rejected And Deferred Options

- **Rejected: central `EditorCommand` registry (legacy port).** §6.1 — competes with the four registries.
- **Rejected: per-surface layout configs for context/flyout/slash.** §6.3 — ceremony; the flat surfaces have no arrangement to externalize.
- **Rejected: per-surface branches on node type inside each surface.** §6.2 — reproduces the table hardcoding everywhere.
- **Rejected: a fifth/sixth surface (object-config) on this axis.** The gear/config form is a settings panel, not a command list; it stays on the node SPI's `renderChrome`/`configFields`. Object *commands* (replace, alt) come via `contributeCommands`; object *settings* stay the form.
- **Decided (was deferred): the `Command` rename.** `ToolbarAction` is now surface-neutral, so it and `registerToolbarAction` rename to `Command` / `registerCommand`, and the `toolbar-*` files rename per §5.8 — keeping the toolbar names on generalized code would be exactly the lie this consolidation removes. The rename is in scope, not a later cosmetic pass; `toolbar-*` names survive only for the genuinely ribbon-specific tab/slot layout.
- **Deferred: a host-overridable group order / per-surface group allowlist.** `COMMAND_GROUP_ORDER` is fixed in first cut (legacy did the same). A host that needs to reorder groups is a later, additive config; not built speculatively.

## 7. The Surfaces In Detail

### 7.1 Context Menu

Re-source `EngineContextMenu` from `resolveCommandList("contextMenu", ctx)`; delete the literal edit/list/indent `MenuItem`s.

- **Trigger + position** unchanged: `useContextMenu` captures `contextmenu`, `preventDefault`, and anchors a zero-size fixed button at the cursor (the proven mechanism). It no longer early-returns on a non-text selection (§3.2): an object/structural scope now resolves contributed commands instead of falling back to the browser menu. It still yields to the native menu only when *nothing* resolves (e.g. a right-click outside any block).
- **Contents**: `edit` group (cut/copy/paste/select-all/delete — now commands tagged `{ contextMenu: "primary" }`, gated by `hasSelection`), then `inlineFormat` (when a non-collapsed selection), `blockStyle`/`list`/`indent` (always, for the block), `annotate`, then the scope's `structure`/`object` contributions. Groups separated by the menu's existing `Separator`.
- **Placement**: `primary` items inline; `more` items in a nested "More" `SubmenuTrigger` (React Aria) so a busy cell menu stays scannable.
- **Clipboard** stays as today (async Clipboard API on the user gesture), just expressed as `edit`-group commands.

### 7.2 Selection Flyout

A new `SelectionFlyout`, the owned-engine reimplementation of the legacy flyout (reference: `selection-flyout-plugin.tsx`), fed by `resolveCommandList("flyout", ctx)`.

- **Trigger**: a *settled* non-collapsed text selection. "Settled" = on pointer-up / keyboard selection end, not on every `selectionchange` mid-drag (legacy debounced this). Hidden while the selection is collapsed, while a drag is in progress, and while the slash menu or a modal popover is open (§8). Suppressed inside an object scope (an object selection is the object's concern, not a text flyout).
- **Geometry**: anchor at the top-center of the selection's bounding rect. The owned engine already computes this: `selectionRects(...)` (`selection-overlay.tsx:56`) returns the range rects; their union's top edge is the anchor. No legacy `selection-geometry` port needed — `boundingRectOf`/`textBoundingRect` (`geometry.ts:142,369`) already exist. Render as a React Aria `Popover` containing a React Aria `Toolbar` (roving tabindex), DaisyUI-styled, mirroring the ribbon's controls.
- **Contents**: `inlineFormat` (the marks) + `annotate` (link/comment/glossary) + the block-style chooser (`compact` variant) + a `more` overflow. Insert commands generally do *not* belong on the flyout (you are formatting a selection, not inserting); `surfaces` for inserts omits `flyout`.
- **Apply-on-selection**: a flyout command reads `ctx.selection`/`ctx.scope` and dispatches; the model selection survives the flyout's focus (docs/011 §8.6), so "apply bold to the selected run" lands on the right range. Child popovers (link editor, comment box) must not dismiss the flyout — handled by the conflict guard (§8), the legacy `data-...-selection-action-popover` marker generalized to a `data-engine-flyout-child` allowlist.

### 7.3 Slash Menu

A new `SlashMenu`, the keyboard-first insert/turn-into surface, fed by `resolveCommandList("slash", ctx)`.

- **Trigger**: typing `/` at a position where it makes sense — the start of an empty text leaf, or after whitespace in a text leaf — detected in the **same input path** that runs `detectMarkdownShortcut` (`text-block.tsx:168`, which dispatches `apply-markdown`). The slash detector is a sibling check on the committed text around the caret; it must coordinate with markdown shortcuts (a `/` is never a markdown prefix, so they do not collide, but both observe the same input commit — §8).
- **Query + filter**: text typed after the `/` (up to the next whitespace or caret move) is the live filter, matched against each command's `label` + `keywords` (the insert affordances already carry `keywords`, node-view.ts:86 / structural-view.ts). Empty query shows the full grouped list (`blockStyle` turn-into + `insert` blocks). Filtering is a pure function of the query over the resolved list — testable without DOM.
- **Geometry**: anchor at the caret rect (`caretClientRect`/`robustCaretRect`, `geometry.ts:279,294`). Render as a React Aria `ListBox` inside a `Popover` (the picker pattern the repo standardized on — `ComboBox`/`ListBox`, consistent with `ScopeBuilder`/`ResourceSelector`), keyboard-navigable (up/down/enter/escape) without leaving the text.
- **Execute + cleanup**: on select, the command's `run(ctx)` dispatches (`set-block-type` for turn-into; `insert-structural`/`insert-object` for inserts), and the typed `/query` text is removed **in the same transaction** as the insert, so one undo reverses the whole thing and the caret lands correctly. This is the one genuinely new editing concern (a coordinated delete-then-insert); it composes existing steps, not a new command type.
- **Parameterized inserts**: a slash item for a block with a richer picker (the table's dimension grid, docs/023 §7.2) inserts a sensible default (e.g. a 3×3 table) rather than opening the dimension popover inline — the slash menu is a fast path; resizing happens after via the table chrome. (This is the one spot slash and ribbon deliberately differ; the ribbon keeps the dimension picker.)

### 7.4 Table And Object Operations As Scope Contributions

The table stops being a special case. `tablecell` and `table` structural views implement `contributeCommands(ctx)`:

- `tablecell` contributes (group `structure`): merge cells (when a ≥2-cell view-range exists), unmerge, fill color (a `dropdown`/`popover` command rendering the `FILL_COLORS` palette — moved from `table-interactions.tsx`), vertical align. Tagged `{ contextMenu: "primary" }`.
- `table` contributes (group `structure`): insert/delete row, insert/delete column, toggle header row, toggle header column, toggle row numbers, layout (the `TABLE_LAYOUTS` select). Tagged `{ contextMenu: "primary" }` (and optionally a `structure` group on the flyout when a cell range is selected).

These dispatch the *existing* core operations (`insertRow`/`insertColumn`/`deleteRow`/`deleteColumn`/`toggleHeaderRow`/`toggleHeaderColumn`/`toggleRowNumbers`/`mergeCells`/`unmergeCell`/`setCellBackground`/`setCellVerticalAlign`, `core/table/operations.ts`), so no new table logic. `table-controls.tsx`/`table-interactions.tsx` shrink to what is *inherently spatial* and cannot live in a menu: the drag-to-resize column borders, the inter-cell insert handles, and the cell-range drag selection. The menu/command parts move into `contributeCommands`. An object view (e.g. image) similarly contributes group `object` commands (replace, alt text) that today have no surface.

## 8. Conflict Resolution And Coordination

This is the cross-cutting design that keeps four surfaces from fighting. A single `useCommandSurfaces(store)` coordinator owns "which surface is open" so the rules are centralized, not raced.

- **One of each kind.** At most one context menu, one flyout, one slash menu open at once. Opening one closes the others (a context-menu open dismisses the flyout; a slash trigger dismisses the flyout).
- **Surface precedence by intent.** Right-click (explicit) beats the flyout (ambient): a `contextmenu` event suppresses/closes the flyout for that interaction. The slash menu (typing) beats the flyout (the author is inserting, not formatting). The flyout is the lowest-priority, ambient surface.
- **Scope precedence within a surface.** Inside one surface, innermost scope contributes first (a cell's `structure` group appears, then the table's), via the `scopePath` walk order (§5.5). Groups still render in `COMMAND_GROUP_ORDER`, so "innermost first" orders *within* a group.
- **Object scope vs text flyout.** An active object (`store.activeObjectId`) suppresses the text flyout (the object's chrome owns it) and routes right-click to the object's contributed commands.
- **Slash vs markdown shortcuts.** Both observe the committed-text input (`text-block.tsx`). They are disjoint by trigger (`/` vs markdown prefixes like `#`, `-`, `>`), but the input handler must check the slash trigger and the markdown shortcut in a defined order (markdown first, then slash) and never both in one commit. The slash menu, once open, *suppresses* markdown-shortcut detection until it closes (so typing `/h1` filters, it does not autoformat).
- **Child overlays do not self-dismiss the parent.** A flyout's link editor or a context menu's color popover is a child overlay; an interaction inside it must not close the parent surface. This is the legacy `shouldSelectionFlyoutCloseOnInteractOutside` design, generalized: each surface marks its panel (`data-engine-context-menu`/`data-engine-flyout`/`data-engine-slash`) and its child overlays (`data-engine-surface-child`), and the dismiss predicate keeps the surface open while the pointer is in itself or a child.
- **Focus + caret.** As with the ribbon (docs/023 §8), opening any of these portals does not disable the editor; only the painted caret hides while a *modal* popover holds focus. The flyout and slash menu should be *non-modal* (`isNonModal`, as the find bar is) so the caret stays painted and the selection visibly persists while they are open — the flyout especially, since it sits over the very selection it formats.

## 9. Risks, Caveats, Edge Cases, And Failure Modes

- **Slash trigger in the EditContext/IME input path.** The owned engine's input is EditContext/polyfill + diff reconcile; a naive keydown listener for `/` will fight IME composition and the markdown-cascade machinery (note.md: the markdown-cascade crash lived here). The detector must run on the *committed* model text around the caret, not raw keystrokes, and be verified on the 3-browser + mobile matrix. Highest-risk item.
- **Same-transaction slash cleanup.** Removing the typed `/query` and inserting the block must be one transaction or undo will split (type `/table`, pick Table, one Ctrl+Z should remove the table *and not* leave `/table` text). A two-step dispatch is the failure mode.
- **Scope walk cost.** `resolveCommandList` runs `scopePath` + each contributor on every open (and the flyout re-resolves as the selection changes). `scopePath` is O(depth) and contributors are O(local), so it is cheap — but the flyout must resolve on *settle*, not per `selectionchange`, or it thrashes (legacy's debounce). Memoize against the commit+selection version if profiling shows cost.
- **Group explosion in the context menu.** A right-click in a table cell with a text selection can surface edit + inlineFormat + blockStyle + list + indent + annotate + structure — a long menu. `more` placement + the nested "More" submenu (§7.1) is the pressure valve; the design must keep `primary` lean per scope or the menu becomes a wall.
- **Flyout over selection occlusion.** The flyout anchors at the selection's top; near the viewport top it must flip below (React Aria `Popover` placement handles this), and it must not cover the selection it acts on. Legacy anchored at the *start* of the selection for this reason; reuse that bias.
- **Double-surface on right-click-drag-select.** A drag that ends in a right-click could try to open both the flyout (selection settled) and the context menu. The precedence rule (right-click beats flyout, §8) must be enforced in the coordinator, or both flash.
- **`surfaces` map migration.** Changing `ToolbarAction.surfaces` from `readonly ToolbarSurface[]` to `Partial<Record<CommandSurface, CommandPlacement>>` is a breaking change to the docs/023 type. It is new and internal (only built-ins + the ribbon resolver read it), so the migration is contained — but every built-in command's `surfaces` must be revisited, and `actionTargetsSurface` updated.
- **`contributeCommands` recursion / cycles.** The contributor walk uses `scopePath`, which `scopePath` already guards against cycles (`seen` set, `core/commands/shared.ts:298`). A contributor must not itself call `resolveCommandList` (infinite loop); contributions are plain descriptors, not surface resolutions.
- **Object context menu vs native.** Removing the native-menu fallback for objects (§6.4) means an object with no `contributeCommands` would get an *empty* context menu. The resolver must fall back to the native menu when a scope resolves zero commands, not show an empty panel.
- **Keyword search quality.** The slash menu's usefulness is its filter; inserts/blocks must carry good `keywords` (e.g. "table" also matched by "grid"). Sparse keywords make slash feel broken. This is content work the SPI enables but does not supply.
- **Flyout + mobile selection handles.** On touch, the OS selection handles and the flyout compete for the same space; the flyout must offset clear of the handles, and the trigger is selection-change (no pointer-up on touch). Verify on mobile-webkit/chromium.
- **Surface drift returns if a surface hardcodes "just one" item.** The whole point is that no surface holds literal items. A single "quick" hardcoded item in any host reopens the drift door; the DoD forbids literal command JSX in the surface hosts, same discipline as docs/023.

## 10. Test And Verification Plan

Design-level acceptance (proving the model, not pixels):

- **Resolver unit tests** (no DOM): `resolveCommandList("contextMenu", ctx)` in a text scope returns edit + inlineFormat + blockStyle groups in `COMMAND_GROUP_ORDER`; in a table-cell scope it *also* returns the `structure` group from the cell/table `contributeCommands`; in an object scope it returns the `object` group; an unavailable command (`isAvailable: false`) is absent; a `more`-placement command is bucketed as overflow.
- **Surface-participation tests**: a command with `surfaces: { flyout: "primary" }` appears in `resolveCommandList("flyout")` and not in `contextMenu`; a toolbar mark appears on ribbon + flyout + contextMenu by the by-kind default; flipping a host capability hides its commands on every surface at once.
- **Scope-contribution tests**: registering a synthetic structural view with `contributeCommands` makes its commands appear in the context menu when the caret is in its scope, and disappear when the caret leaves — proving the `scopePath` walk and the no-per-type-knowledge contract.
- **Slash filter tests** (pure): the query filters the resolved list by label/keywords; empty query shows the full grouped list; selecting an item produces the expected `run` dispatch.
- **Slash transaction test**: inserting via slash removes the `/query` and inserts in one transaction (one undo reverses both).
- **Context-menu migration parity**: cut/copy/paste/select-all/delete and list/indent behave identically to the pre-migration literals (same commands, same enabled/disabled by selection).
- **Conflict/coordination e2e** (chromium/webkit/firefox, + mobile): a right-click closes an open flyout; a slash trigger closes the flyout; a flyout's link editor does not dismiss the flyout; opening any surface does not disable the editor; the flyout/slash are non-modal (caret stays painted); right-click in a table cell shows table ops in one menu.
- **Flyout geometry e2e**: the flyout anchors over a selection, flips near the viewport top, and does not occlude the selection start.
- **Regression**: `engine-toolbar.spec.ts`, `engine-chrome.test.tsx`, the docs/023 toolbar SPI tests, and the table tests stay green or are deliberately updated to the new sourcing; full `pnpm check` passes.

## 11. Definition Of Done

- `resolveCommandList(surface, ctx)` exists and is pure; the context menu, flyout, and slash menu render entirely from it; no surface host contains literal command JSX.
- `ToolbarAction.surfaces` is a `Partial<Record<CommandSurface, CommandPlacement>>` placement map; every built-in command declares the surfaces it lives on; `actionTargetsSurface` reads the map.
- `contributeCommands` exists on `NodeView` and `StructuralNodeView`; the table's cell/structure ops are contributed (not a bespoke overlay menu), so right-clicking a cell shows them in the one context menu; `table-controls.tsx`/`table-interactions.tsx` retain only the genuinely-spatial affordances.
- The context menu is scope-merged, handles object/structural scopes, and falls back to the native menu only when zero commands resolve.
- The selection flyout exists: triggered on a settled non-collapsed text selection, anchored at the selection rect, non-modal, projecting the flyout commands, with child-overlay-safe dismissal; suppressed in object scope and while slash/context is open.
- The slash menu exists: triggered by `/` in the committed-input path, keyword-filtered, caret-anchored, keyboard-navigable, inserting/turning-into via existing commands with same-transaction `/query` cleanup; coordinated with markdown shortcuts.
- A single coordinator enforces one-of-each-kind and the surface/scope precedence rules; no two surfaces open simultaneously by race.
- Resolver, participation, scope-contribution, slash-filter, and migration are unit-tested; conflict/geometry/keyboard are e2e-verified across the 3-browser + mobile matrix; `pnpm check` is green.
- New exports are limited to the descriptor/context/group types + `contributeCommands`; `resolveCommandList` and `Resolved*` stay internal.

## 12. Final Model

The owned editor's command surfaces become projections of one descriptor model. A command is a surface-neutral descriptor that declares the surfaces it lives on (`surfaces: Partial<Record<CommandSurface, CommandPlacement>>`) and its group; it is sourced either globally from the existing mark/block/insert/action registries or, when it is specific to a block instance, from that block's `contributeCommands(ctx)` slot. `resolveSurface` — `computeToolbarLayout` for the ribbon's tab/slot arrangement, `resolveCommandList` for the flat context/flyout/slash lists — walks the registries and the live `scopePath`, gates by availability and scope, and returns a grouped, ordered structure the surface host renders blind. No surface holds a command list; no two surfaces can drift; a host adds a command to a surface by declaring it and a block contributes scoped commands by implementing one slot.

This is the cash-out of docs/023 §6.2's bet (registries + projection, not a central command list) across all four surfaces, and it retires the editor's three remaining piles of hardcoding: the context menu's literal items, the table's bespoke cell/structure menus, and the absence of a flyout/slash. The slash menu — the feature that prompted this — is the smallest piece: once the descriptor carries `slash`, the node SPI contributes scoped commands, and `resolveCommandList` exists, the slash menu is a caret-anchored React Aria listbox over a filtered projection plus one input-trigger and one same-transaction cleanup. The hardest and most novel parts are not the menus but the cross-surface coordinator (§8) and the slash trigger in the EditContext input path (§9) — which is why this is sequenced as its own epic, with the surface contract locked here before the input path is touched.
