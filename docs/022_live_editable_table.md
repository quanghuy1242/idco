# 022 - The Live Editable Table

> Status: design + rationale (pre-implementation). Pure design; no backlog, tickets, or phases — the execution sequence across this document and docs/021 lives in one shared tracker, not here.
>
> Date: 2026-06-21
>
> This document specifies the first real editable table in the owned-model editor. Today there is no editable table: the owned `table`/`editor-table` is a read-only baked object that paints a static grid so existing documents do not break, and it is below the parity of the legacy Lexical table it replaced. This document is the feature — the model, the rendering, the navigation, the structure operations, and the persistence — built as a *consumer* of the structural node SPI (docs/021) on top of the positional model (docs/019), not as a new pile of table-specific engine branches.
>
> Scope:
>
> - `packages/editor/src/core/model.ts` — `StructuralNodeType`, opened to admit `table`/`tablerow`/`tablecell` (docs/021 §8.1).
> - `packages/editor/src/core/structural-registry.ts` — the table's `StructuralDefinition` (its `createSubtree`, `fromCompatNode`, and the `toCompatNode` slot this feature adds, §4.3).
> - `packages/editor/src/view/nodes/table.tsx` — replaces the read-only `tableView`/`editorTableView` object views with the three structural views (`renderContainer` + `renderResting`).
> - `packages/editor/src/core/commands/` — the generic structural-child commands (docs/021 §8.2) the table composes; the table's command-builders live in the view/feature layer.
> - `packages/editor/src/view/navigation.ts`, `packages/editor/src/view/text-block.tsx`, `packages/editor/src/view/geometry.ts` — the document-level geometric vertical probe (docs/019 §4.10) that delivers cross-cell vertical movement.
> - `packages/editor/src/core/registry.ts` — the `table`/`editor-table` *object* definitions are removed once the structural import lands (the read-only stub retires).
> - `@quanghuy1242/idco-ui` — `RichTextTable`/`RichTextTableRow`/`RichTextTableCell`, the table chrome both the editor surface and the reader already share.
>
> Relationship to the other docs:
>
> - **docs/021 is the contract this consumes.** Every structural mechanic the table needs — insert subtree, registry-driven import, scope navigation, the generic structural-child commands, the open union — is docs/021's. This document adds no new *engine* surface beyond what docs/021 §8 already justifies as general; it adds the table's *use* of that surface. The guardrail (docs/021 §10) governs: anything grid-specific composes docs/021's primitives; nothing grid-specific is welded into `core/`.
> - **docs/019 is the positional model this inherits, and this document supersedes its table-build specifics.** 019 §5.2 decided tables become structural containers (the fork) and §7.6/§10 R4-A sketched a table-specific way to build it. This document keeps 019's *decision* and its navigation design (§4.10 scope nav, §5.7 escape semantics, §9 the large-table trade) and *replaces* 019 §7.6's "add three types and map compat by hand" with the docs/021 SPI consumption. Where 019 §7.6 and this document differ on how the structural table is built, this document wins; where they differ on the position model, 019 wins.
> - **docs/011 §2.4 and docs/016 §12 are superseded on the table, by docs/019 §5.2.** Both earlier docs modeled the table as an atomic object with a faithful grid inside `data`, edited as one live slot. docs/019 §5.2 consciously reversed that (with rejected-option analysis) once the engine gained the positional/scope machinery that made cell-as-scope cheap. This document is downstream of that reversal; §10.1 restates it so a reader who arrives from 011/016 is not confused.
>
> Assumptions:
>
> - The persisted compat JSON for tables stays byte-stable. The saved shape is `{type:"table", children:[{type:"tablerow", children:[{type:"tablecell", headerState, children:[…inline text…]}]}], colWidths, …}` (verified against `defaultTableRow`/`renderBakedTable` in `view/nodes/table.tsx` and the `table` definition in `core/registry.ts`). Only the in-memory model and the renderer change; import maps the saved shape in, export maps it back (§4.3).
> - The table is greenfield. The current table is a render-only stub with no `renderLive`, no inline config, and zero cell-editing commands anywhere in core (docs/019 §5.2 verified this by grep). There is no editing behavior to migrate — only "the table still renders," which the round-trip and render tests preserve.
> - v1 targets keyboard + mouse. Touch cell selection inherits the same model selection and is a follow-up.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. Current State And The Parity Target](#2-current-state-and-the-parity-target)
  - [2.1 What Exists Today](#21-what-exists-today)
  - [2.2 The Legacy Capability Inventory](#22-the-legacy-capability-inventory)
- [3. The Model](#3-the-model)
- [4. How The Table Consumes The Structural SPI](#4-how-the-table-consumes-the-structural-spi)
  - [4.1 createSubtree: Seeding A Grid](#41-createsubtree-seeding-a-grid)
  - [4.2 fromCompatNode: Importing The Legacy Grid](#42-fromcompatnode-importing-the-legacy-grid)
  - [4.3 toCompatNode: The One Slot The Table Adds To The SPI](#43-tocompatnode-the-one-slot-the-table-adds-to-the-spi)
  - [4.4 Rendering: Live And Resting](#44-rendering-live-and-resting)
- [5. Navigation: The 2D Crux](#5-navigation-the-2d-crux)
- [6. Structure Operations](#6-structure-operations)
- [7. Selection Across Cells](#7-selection-across-cells)
- [8. Rendering Cost And Large Tables](#8-rendering-cost-and-large-tables)
- [9. Resting Render And Reader Parity](#9-resting-render-and-reader-parity)
- [10. Architecture Decisions](#10-architecture-decisions)
  - [10.1 Structural, Not An Atomic Object (Inherited From docs/019 §5.2)](#101-structural-not-an-atomic-object-inherited-from-docs019-52)
  - [10.2 Generic Child Commands, Not Table Commands](#102-generic-child-commands-not-table-commands)
  - [10.3 Geometric Vertical Nav, Not A Per-Type Hook](#103-geometric-vertical-nav-not-a-per-type-hook)
  - [10.4 colWidths And headerState As Attrs](#104-colwidths-and-headerstate-as-attrs)
- [11. Edge Cases And Failure Modes](#11-edge-cases-and-failure-modes)
- [12. Test And Verification Plan](#12-test-and-verification-plan)
- [13. Definition Of Done](#13-definition-of-done)
- [14. Final Model](#14-final-model)

---

## 1. Goal

Make the table a first-class editable structural container: a caret rests inside any cell, cell content is normal block editing (paragraphs, lists, marks — everything a body block gets), arrows move within and between cells in two dimensions, rows and columns can be added and removed, header rows and columns toggle, columns resize, and the whole thing round-trips the persisted JSON byte-for-byte. The bar is *beyond* the legacy Lexical table, because the owned model gives cell content the full engine (find, selection, the gap cursor, undo at the engine level) rather than a sequestered cell editor — but the floor is at least legacy parity, which the current read-only stub does not meet.

The non-goal is any new *engine* capability that is table-specific. The table is the second consumer of the structural SPI (docs/021), after callout; its job is to validate that contract by living inside it. Every place this document reaches for a primitive, the primitive is general (docs/021 §10).

## 2. Current State And The Parity Target

### 2.1 What Exists Today

The owned table is an atomic object that renders read-only. `view/nodes/table.tsx` exposes `tableView` and `editorTableView`, both `renderResting`-only, both `configurable: false`. `renderResting` calls `renderBakedTable`, which reads the baked payload's `children` (rows), each row's `children` (cells), each cell's `headerState` and inline text, plus `colWidths`/`layout`/`showRowNumbers`, and paints `RichTextTable`/`Row`/`Cell` from `@quanghuy1242/idco-ui`. The `table`/`editor-table` object definitions in `core/registry.ts` carry the JSON through as opaque `data` and bake `{kind:"table", payload:data}`. The insert affordance seeds a 2×2 (`defaultTableRow(["Column 1","Column 2"], true)` + an empty row). There is no `renderLive`, no caret in a cell, no cell mutation, no resize, no row/column operation. It is a faithful *picture* of a table and nothing more.

### 2.2 The Legacy Capability Inventory

The real editing the owned model must reach and exceed lives in the legacy Lexical plugins (`legacy/plugins/table-controls-plugin.tsx`, `legacy/nodes/table-node.tsx`). The parity target:

| Capability | Legacy mechanism | Owned-model home |
| --- | --- | --- |
| Edit cell content | Lexical table cell editor | normal block editing in a cell scope (free from docs/021 + docs/019) |
| Insert row (above/below) | `insertRow(boundary)` | `insert-structural-child` into the table at a row index (§6) |
| Insert column (left/right) | `insertColumn(boundary)` | `insert-structural-child` of a cell into each row at a col index (§6) |
| Delete row | `deleteRow(rowIndex)` | `remove-structural-child` of the row (§6) |
| Delete column | `deleteColumn(colIndex)` | `remove-structural-child` of cell N across rows (§6) |
| Header row toggle | `toggleHeaderRow(on)` | `set-block-attr` `headerState` on the row's cells (§6, §10.4) |
| Header column toggle | `toggleHeaderColumn(on)` | `set-block-attr` `headerState` on the column's cells (§6, §10.4) |
| Column resize | `resizeColumnWidths` → `colWidths` | `set-block-attr` `colWidths` on the table (§6, §10.4) |
| Resize drag handles | hover handle per internal boundary | view chrome over the structural render (§4.4) |

Two columns matter: every legacy *operation* maps either to a generic structural-child command or to a generic `set-block-attr`, and every legacy *surface* maps to view chrome over the structural render. Nothing in this inventory requires a table-specific core command — the validation that docs/021 §8 sized the SPI correctly.

## 3. The Model

Three structural node types, opened into `StructuralNodeType` (docs/021 §8.1):

- `table` — a structural container; `children` are `tablerow` ids; `attrs` carry `colWidths?: number[]`, and the carried-through `layout?`/`showRowNumbers?`.
- `tablerow` — a structural container; `children` are `tablecell` ids; no attrs of its own in v1.
- `tablecell` — a structural container; `children` are *block* nodes (a `paragraph` leaf by default, but any block: lists, nested callouts, even images); `attrs` carry `headerState?: number` (the legacy header bitfield: row-header / column-header).

A cell is a scope exactly like a callout (docs/019 §4.2), so a caret inside a cell is "just another scope" and needs no new position machinery — the central argument docs/019 §3.5/§5.2 made, now realized. `TextPoint` is depth-agnostic, so `table → row → cell → paragraph → caret` is the same coordinate as `callout → paragraph → caret`, only deeper. The grid is a faithful subtree of model nodes, not a blob inside object `data` (docs/011 §2.1's "the structure stays honest," reached the structural way rather than the atomic-object way docs/011 §2.4 first proposed).

The grid invariant — **every row has the same number of cells** — is a table-feature invariant, enforced by the table's command-builders (§6), not by core. Core knows only "a structural node has children"; the rectangularity of the grid is the table's concern.

## 4. How The Table Consumes The Structural SPI

### 4.1 createSubtree: Seeding A Grid

The table's `StructuralDefinition.createSubtree` (docs/021 §6.1) builds the full initial subtree — `table → 2 rows → 2 cells each → one paragraph per cell` — and names the first cell's paragraph as the `caret` leaf. The generic `insert-structural` command (docs/021 §7.2) places the whole subtree on one `insert-node` step (descendants of any depth ride one step, verified in docs/021 §7.2) and lands the caret in the top-left cell. The seed shape matches today's `defaultTableRow` 2×2 with a header row, so the insert affordance is unchanged from the user's view; only the resulting model is structural instead of baked. The insert menu entry moves from the object insert (`insert-object`) to `{ type: "insert-structural", structuralType: "table" }`.

### 4.2 fromCompatNode: Importing The Legacy Grid

The table's `fromCompatNode` (docs/021 §6.1) walks the saved `{table → tablerow → tablecell}` shape into the structural model using the injected `StructuralCompatContext`. Rows and cells import as structural nodes; a cell's inline text content imports as a single `paragraph` leaf via `ctx.importInlineAsParagraph` (the same projection callout uses for legacy inline-content callouts), and a cell already carrying block children imports them directly via `ctx.importChildren`. `headerState` and the table's `colWidths`/`layout`/`showRowNumbers` are carried by `ctx.pickAttrs`. Because the registry-driven structural import already exists (docs/021 §7.1) and `isStructuralDefinitionType` already makes a registered container count as a block child, the table nests correctly inside other containers and vice versa with no new import plumbing.

### 4.3 toCompatNode: The One Slot The Table Adds To The SPI

This is the single place the table extends the structural SPI, and it is the predicted healthy extension (docs/021 §10, §6.1): a new *optional* slot, general by construction.

The asymmetry is in export. docs/021 §6.1 omitted `toCompatNode` because callout/quote export generically — their runtime children (paragraphs) are exactly their persisted children. A `tablecell` is different: at runtime it holds a `paragraph` leaf, but the persisted JSON holds inline text *directly* under the cell (`tablecell > [text]`, not `tablecell > paragraph > text`), to keep the saved document byte-stable (the §2 assumption). So a cell's export must flatten a sole paragraph child back to inline text — exactly the projection `exportListItemChildren` already does for list items in `compat.ts`.

The clean way to express this is an **optional `toCompatNode(node, ctx)` on `StructuralDefinition`**, consulted by the generic export path when present and falling back to the generic "attrs + children" projection when absent. This is general — any container whose runtime child shape diverges from its persisted shape needs it (a future `figure`, a `details` with a summary attr) — so it satisfies docs/021 §10's test and belongs in the SPI, added now because the table is the first consumer that needs it. The alternative, a hardcoded `if (node.type === "tablecell")` arm in `compat.ts` export, is the welded-core smell docs/021 §10 forbids; rejected for that reason. Adding the optional slot keeps export registry-driven for the divergent case the way import already is.

The byte-stable round-trip is the safety net: load a stored table → structural model → export → JSON deep-equal to the original (modulo ids). This is the same guarantee docs/019 §8 required.

### 4.4 Rendering: Live And Resting

`renderContainer` (live) for the three types composes through the recursive `EngineBlock` the same way callout does (docs/020 §3.7): the `table` view renders the `RichTextTable` wrapper around its already-rendered row children; the `tablerow` view renders a row around its cell children; the `tablecell` view renders a cell around its block children, binding the cell element via `registerBlock` for measurement and hit-testing. The resize drag handles and the row/column insert/delete affordances are view chrome layered over this structural render (the legacy `table-controls-plugin` UX, re-hosted), dispatching the §6 commands. `renderResting` projects the same three types to a semantic `<table>`/`<tr>`/`<td|th>` (header cells chosen by `headerState`), co-located with the live render so the editor surface and the published page cannot drift. Both surfaces reuse `RichTextTable`/`Row`/`Cell` from `@idco/ui`, the components the reader already renders, so the published table is unchanged.

## 5. Navigation: The 2D Crux

This is the one genuinely hard part, and docs/021 §8.3 placed the fix correctly: it is a *generic* navigation completion, not a table-specific hook.

**Horizontal movement is already correct, generically.** ArrowLeft/Right scope-step through children and descend into containers — `positionAfterBlock`/`positionBeforeBlock` in `view/navigation.ts` already do this, which is why a callout's arrow-in/out works. In a table this gives row-major traversal for free: ArrowRight at the end of a cell's content descends into the next cell in the row, and at the row's end into the first cell of the next row; ArrowLeft is the mirror. At the table's outer edge the arrow escapes to the body gap beside the table (docs/019 §5.7's `scopePath` escape). No table code is needed for horizontal movement.

**Vertical movement is not yet correct, and the fix is general.** The current vertical nav (`text-block.tsx:602-636`, `verticalNavigation`) seeds a goal column from `caretClientRect` and probes browser line geometry *within the current leaf's host element*; when the probe lands in the inter-block gap (the leaf's first/last line) it falls back to `selectionForNavigation`'s order-based block jump. That is intra-leaf geometry plus an order-based fall-through — it cannot cross from a cell to the cell visually below in the same column, because the geometry probe never leaves the current leaf and the order fall-through walks reading order, not columns.

The fix docs/019 §4.10 already specified is a **document-level geometric vertical probe**: from the caret rect at the goal column, step the probe point down (or up) past the current line into the next visual line *anywhere in the document* via `caretPositionFromPoint`/`pointToModelPosition` (`view/geometry.ts` already has `pointToModelPosition`), and resolve to whatever leaf that pixel lands in — the cell below, the next paragraph, whatever is visually there. This is the ProseMirror/Word behavior for vertical movement and it is correct for *all* vertical motion, not just tables: it also fixes vertical movement across mixed block widths in the body. So the table's 2D vertical navigation is delivered by completing a general engine capability docs/019 designed, exactly as docs/021 §8.3 argued — the table consumes it; it adds no per-type caret logic.

**Tab / Shift-Tab** cell traversal (move to the next/previous cell, creating a row when tabbing past the last cell) is a table-feature key binding handled in the table's view chrome, dispatching scope navigation plus, at the end, an `insert-structural-child` row. It is convenience over the generic arrows, not a new engine mechanism (docs/019 §11 listed it as polish).

## 6. Structure Operations

Every operation composes docs/021 §8.2's generic structural-child commands or the generic `set-block-attr`; the grid invariant lives in the table's command-builders (in the view/feature layer), never in core.

- **Insert row** — build a `tablerow` subtree of N empty cells (N = current column count) and `insert-structural-child` it into the table at the target row index. One command, one undo.
- **Delete row** — `remove-structural-child` the row from the table. Refuse (or convert to delete-table) when it is the last row, per §11.
- **Insert column** — for each row, build a cell and `insert-structural-child` it at the target column index; one transaction spanning the rows so a single undo reverses the whole column. The "all rows same width" invariant is the builder's responsibility: it inserts into *every* row.
- **Delete column** — `remove-structural-child` cell index N from every row, one transaction. Adjust `colWidths` (drop the removed width) in the same transaction via `set-block-attr`.
- **Toggle header row / column** — `set-block-attr` `headerState` on the affected cells. No structure change; an attr write per cell, batched in one transaction.
- **Column resize** — `set-block-attr` `colWidths` on the table, committed once on drag release (the legacy `resizeColumnWidths` trades width between neighbors; the same pure helper computes the next `colWidths` array, and the command writes it). Live drag is view-local; only the release mutates the model, so resize does not flood undo (the legacy behavior).

The shape to notice: core gains *zero* table verbs. It gains the two generic child commands (docs/021 §8.2, shared with any container) and already has `set-block-attr`. The table is entirely a composition.

## 7. Selection Across Cells

v1 ships block-atomic selection through cells: a range that crosses a cell boundary collapses block-atomically (docs/010 §6.5), the same rule that governs a range crossing any object. A caret selects and edits one cell's content at a time; whole-block operations on the table select the table node.

A **rectangular cell-range selection** (drag-select a block of cells, then style/clear/copy them as a grid) is the one capability the legacy table had that v1 does not, and it is deferred deliberately: it is a second class of selection (a 2D cell range) layered on the model, and it is not required for parity with editing or for the reported use cases. It is recorded as future work, built as a table-feature selection overlay over the structural cells, not a change to the core selection union. Copy/paste of a single cell's content rides the existing text clipboard; grid-shaped copy/paste belongs with the rectangular-range work.

## 8. Rendering Cost And Large Tables

A structural table renders all its cells, because the body virtualizer windows top-level blocks and does not window inside a structural subtree (docs/019 §9, §11; docs/021 §8.3). For ordinary tables (the blog and book cases — tens of rows) this is a non-issue and is strictly simpler than the atomic-object self-windowing the old stub would have needed. A very large table (thousands of rows) is one body block whose children are not windowed, and its render cost is real.

This is named, not solved, in v1, for the reason docs/021 §8.3 gives: adding a structural self-windowing slot before a consumer needs it is unread code, and no document in the corpus needs a thousand-row table. When one does, the fix is the deferred structural self-windowing slot (docs/021 §8.3, docs/019 §11) — the body virtualizer windowing a subtree, or the container declaring an estimated height — added then, as a general capability. The atomic-bake path that previously bounded this is the trade docs/019 §5.2 accepted knowingly.

## 9. Resting Render And Reader Parity

The published table is the semantic `<table>` the reader already renders, emitted by the three types' `renderResting` (§4.4). `headerState` selects `<th>` vs `<td>` and the scope attributes; `colWidths` emits the column sizing; `showRowNumbers`/`layout` carry through as today. Because live and resting render are co-located per type (docs/020 §3.7) and both lean on the shared `@idco/ui` table components, the editor surface, the published page, and the existing reader output stay aligned by construction. The round-trip test (§12) plus the resting-render test are the drift guards.

## 10. Architecture Decisions

### 10.1 Structural, Not An Atomic Object (Inherited From docs/019 §5.2)

The consequential decision was made in docs/019 §5.2 and is inherited, not re-litigated, here; it is restated because docs/011 §2.4 and docs/016 §12 say the opposite and a reader may arrive from them. docs/011/016 modeled the table as an atomic object with a faithful grid inside `data`, edited as one live slot — the caret never entering a cell, the table managing its own internal editing the way `code-block` manages its piece-table. docs/019 §5.2 reversed this once the engine gained the positional/scope model: making a cell "just another scope" means cell editing, cell-gap insertion, and "type above a first-block table" all fall out of the general design instead of a table-specific subsystem, and the coordinate system does not change because `TextPoint` is depth-agnostic. docs/019 §5.2 rejected the "object-scope SPI" (table stays atomic, declares internal scopes via a contract) as the primary path because it forces a second class of position alongside `TextPoint` — two sources of truth for selection, the thing docs/011 §8.1 refused — and kept it only as the extension point for a genuinely opaque editable embed (a spreadsheet widget the engine does not own). A table is structured content the engine owns, so it is model nodes. This document is downstream of that decision; the structural SPI (docs/021) is what makes "model nodes" cheap.

### 10.2 Generic Child Commands, Not Table Commands

Row and column operations are composed from the generic `insert-structural-child`/`remove-structural-child` (docs/021 §8.2), not from table-specific core commands. Rejected — adding `insert-table-row`/`delete-table-column` to the core `EditorCommand` union: it welds grid semantics into core, the exact smell docs/021 §10 forbids, and it does not generalize to the next container. The generic commands keep core's command set free of grid knowledge; the grid invariant (rectangularity) lives in the table's command-builders, which compose the generic verbs. This mirrors the object SPI, where `set-object-data` is the generic mutation and the object's meaning of its data is the object's concern.

### 10.3 Geometric Vertical Nav, Not A Per-Type Hook

Cross-cell vertical movement is delivered by completing the document-level geometric vertical probe docs/019 §4.10 designed, a general engine capability (§5), not by a `navigate` hook on `StructuralDefinition`. Rejected — a per-type navigation hook: it would let a container redefine caret movement, which is the wrong shape for an engine whose navigation is deliberately generic (scope-stepping plus geometry), and it would put grid geometry inside the SPI rather than letting the table consume a general mechanism. The probe completion also improves vertical movement across mixed-width body blocks, so the work is not table-specific even though the table is what forces it. docs/021 §8.3 is the full argument.

### 10.4 colWidths And headerState As Attrs

Column widths live on the table node's `attrs.colWidths`; the header bitfield lives on each cell's `attrs.headerState`. Both are therefore written through the existing generic `set-block-attr` and need no new command, which is why resize and header toggle cost core nothing (§6). Rejected — a dedicated table-geometry sidecar structure: attrs are already the engine's per-node key/value channel, they round-trip through the generic compat export, and they remap and undo like any node change; a sidecar would duplicate that machinery. The only subtlety is keeping `colWidths` length in sync with the column count on insert/delete column, handled in the same transaction as the structure change (§6).

## 11. Edge Cases And Failure Modes

- **Empty document, insert table** — the caret's empty paragraph is disposable-empty (docs/019 §4.7), so the table replaces it and the table becomes the sole block; the caret lands in the top-left cell.
- **Delete the last row or last column** — refuse the operation (a table needs at least 1×1), or, if the product prefers, deleting the last row deletes the whole table. Decision recorded as product (default: refuse, with delete-table as the explicit gesture).
- **Ragged rows must never occur** — the invariant is enforced at every mutation: insert/delete column touches every row in one transaction; import (§4.2) pads short rows to the max width if a malformed document arrives, so the in-memory model is always rectangular even when the source JSON is not.
- **Caret escape at table edges** — an arrow at the table's outer boundary escapes to the body gap beside the table (docs/019 §5.7); a first-block or last-block table is reachable above/below via the gap cursor (the docs/019 §1 reported bug, now covered for tables specifically).
- **Vertical nav into a ragged-height row** — the geometric probe (§5) lands by pixel, so a tall cell next to a short one resolves to whatever is visually at the goal column; this is the correct visual behavior and needs no special case.
- **Undo of a column operation** — one transaction spans all rows, so a single undo reverses the whole column insert/delete atomically (the §6 requirement).
- **colWidths drift** — after delete column, the removed width is dropped in the same transaction; after insert column, a default width is spliced in; a `colWidths` array shorter/longer than the column count is tolerated by the renderer (extra ignored, missing defaulted) so a malformed import never throws.
- **Paste into a cell** — normal block paste into the cell scope (the cell is a scope); grid-shaped paste is deferred with rectangular selection (§7).
- **Very large table** — renders fully (§8); documented limit, not a crash.
- **Header semantics round-trip** — `headerState` is the legacy bitfield; import/export preserve it exactly so a table edited in the owned model still reads correctly in any consumer of the saved JSON.

## 12. Test And Verification Plan

- **Round-trip (the persistence safety net).** Load a stored table's JSON → structural model → export → assert deep-equal to the original modulo ids. Covers cells with inline text, cells with block children, header cells, `colWidths`, and a malformed (ragged) import padded to rectangular. This is the gate for §4.3's `toCompatNode` projection and the §2 byte-stability assumption.
- **Cell addressability.** A cell holds a real `TextLeafNode`; a `TextPoint` resolves inside it; typing in a cell mutates only that leaf.
- **Navigation.** Horizontal arrows traverse cells row-major and escape at the table edge; the document-level geometric vertical probe moves to the cell below in the same column and, separately, across mixed-width body blocks (the general case); a first-block table is reachable above via the gap cursor.
- **Structure operations.** Insert/delete row and column keep the grid rectangular; a single undo reverses a column operation; toggle header writes `headerState`; resize writes `colWidths` once on release. Each asserts the model shape and the single-transaction undo.
- **Rendering parity.** Live and resting renders produce matching structure; the resting `<table>` emits the correct `<th>`/`<td>` from `headerState` and column sizing from `colWidths`; the reader output is unchanged for a stored table.
- **The SPI guardrail.** A `grep` over `core/` finds no `table`/`tablerow`/`tablecell` literal in any command compiler or compat branch (the structural import/export is registry-driven; the only `core/` mention is the table's `StructuralDefinition` in `structural-registry.ts`). This is the executable form of docs/021 §10's guardrail.

## 13. Definition Of Done

- `table`/`tablerow`/`tablecell` are structural types (the union opened per docs/021 §8.1); the table's `StructuralDefinition` (`createSubtree`, `fromCompatNode`, `toCompatNode`) is registered; the read-only `table`/`editor-table` object views and definitions are removed.
- A caret rests and edits inside any cell; cell content is full block editing; the persisted JSON round-trips byte-compatibly.
- Horizontal cell traversal and cross-cell vertical movement work (the latter via the completed general geometric vertical probe); a first/last-block table is reachable via the gap cursor.
- Insert/delete row and column, header toggle, and column resize work, each composed from the generic structural-child commands or `set-block-attr`, each a single undoable transaction, the grid always rectangular.
- Live and resting renders match and reuse the `@idco/ui` table chrome; the reader output is unchanged.
- The guardrail holds: no table-specific branch in any `core/` command compiler or compat arm; the only general SPI growth the table introduced is the optional `toCompatNode` slot (§4.3), justified as general.
- The round-trip, addressability, navigation, structure-operation, rendering-parity, and guardrail tests are green, registered in `tests/all.test.ts` (unit) and the e2e suite (cell editing, the gap-above-a-first-block-table screenshot); `pnpm format`, lint, `pnpm typecheck`, the vitest aggregator, and `pnpm build` are green.

## 14. Final Model

The table is a faithful grid of structural nodes — `table → row → cell → blocks` — where a cell is a scope like any other, so cell editing, in-cell insertion, and typing above or below the table all fall out of the positional model (docs/019) and the structural SPI (docs/021) rather than a table-specific subsystem. It seeds through `createSubtree`, imports and exports through `fromCompatNode`/`toCompatNode` with the saved JSON unchanged, renders live and at rest through co-located views over the shared `@idco/ui` chrome, navigates horizontally by generic scope-stepping and vertically by a general document-level geometric probe, and edits its structure by composing the generic structural-child commands and `set-block-attr` — adding exactly one general optional slot to the SPI (`toCompatNode`) and not one table-specific branch to core. It reaches past legacy parity because cell content is the full owned-model engine, and it is greenfield because the thing it replaces was only ever a picture of a table. The one rule that keeps it honest is docs/021 §10's: everything grid-specific composes the engine's general primitives; nothing grid-specific is welded into core.
