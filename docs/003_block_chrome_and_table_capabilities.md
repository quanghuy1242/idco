# 003 — Block Chrome System and Table Capabilities

> Status: implemented (Parts A–E)
>
> Date: 2026-06-14
>
> Scope:
>
> - `/home/quanghuy1242/pjs/idco/packages/editor` (live editor — nodes, plugins, model)
> - `/home/quanghuy1242/pjs/idco/packages/content-renderer` (read-side renderer — must match any new table layout/header semantics)
> - `/home/quanghuy1242/pjs/idco/stories` (Ladle previews)
> - `/home/quanghuy1242/pjs/idco/tests/editor` (vitest coverage)
>
> Related docs:
>
> - `docs/001_lexical_editor_architecture.md` — §7.5 _Live Tables_, §4.3 _Node Taxonomy_, and the `BlockShell` chrome convention (§5). This doc extends both.
> - `docs/002_gap_cursor_and_block_flow.md` — the table-cell gap scope this doc's chrome sits alongside.
>
> Related memory: `lexical-editor-package`, `rich-text-live-editor`, `standardize-dont-diverge-ui-patterns`, `idco-ui-react-aria-daisyui-philosophy`
>
> Assumptions:
>
> - Lexical stays pinned at `0.45.0` across all `@lexical/*` packages. `TableNode.colWidths` is a `number[]` of **pixels** with no native percentage or responsive mode (verified against `@lexical/table@0.45` `dist/*.d.ts`).
> - The document JSON stays round-trippable through the editor and `@idco/content-renderer`. Any new table attribute (layout mode, header axes) must serialize and render identically on both sides.
> - The editor stays product-neutral and within the React Aria + DaisyUI contract: no hand-rolled menus/buttons; chrome composes `@idco/ui` primitives (`MenuTrigger`/`Menu`/`MenuItem`, `NavIcon`, React Aria `Button`).
> - This is opt-in surface area. Existing documents (fixed-px tables, header-row tables) must load and behave exactly as before; new capabilities are additive and default-off where they change behavior.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. Problem Statement](#2-problem-statement)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 The Three Chrome Systems](#31-the-three-chrome-systems)
  - [3.2 Table Layout Is Px-Only And Force-Seeded](#32-table-layout-is-px-only-and-force-seeded)
  - [3.3 Header State Is Per-Cell And Unmanaged](#33-header-state-is-per-cell-and-unmanaged)
  - [3.4 The Header-Becomes-Middle Bug](#34-the-header-becomes-middle-bug)
  - [3.5 `@lexical/table` Coverage Audit](#35-lexicaltable-coverage-audit)
- [4. Design Overview](#4-design-overview)
- [5. Part A — The Shared Chrome Primitives](#5-part-a--the-shared-chrome-primitives)
  - [5.1 Token Set](#51-token-set)
  - [5.2 Primitive APIs](#52-primitive-apis)
  - [5.3 Three Render Hosts, One Vocabulary](#53-three-render-hosts-one-vocabulary)
  - [5.4 Migration Of Existing Chrome](#54-migration-of-existing-chrome)
- [6. Part B — Table Layout Modes](#6-part-b--table-layout-modes)
  - [6.1 The Px-Only Constraint](#61-the-px-only-constraint)
  - [6.2 The `layout` Attribute](#62-the-layout-attribute)
  - [6.3 Seeding And Resize Per Mode](#63-seeding-and-resize-per-mode)
  - [6.4 Renderer Parity](#64-renderer-parity)
- [7. Part C — Header And Numbered-Column Toggles](#7-part-c--header-and-numbered-column-toggles)
  - [7.1 Header Row / Header Column](#71-header-row--header-column)
  - [7.2 Numbered Column](#72-numbered-column)
- [8. Part D — The Header-Edge Insert Guard](#8-part-d--the-header-edge-insert-guard)
- [9. Part E — Optional Lexical Capabilities](#9-part-e--optional-lexical-capabilities)
- [10. Files](#10-files)
- [11. Edge Cases And Failure Modes](#11-edge-cases-and-failure-modes)
- [12. Tests](#12-tests)
- [13. Implementation Sequence](#13-implementation-sequence)
- [14. Definition Of Done](#14-definition-of-done)

## 0. As-Built Notes (deviations from the plan)

Five things changed during implementation; each is load-bearing:

- **`EditorTableNode` uses a unique internal type `"editor-table"`, not `"table"`.** Lexical's node-replacement registry rejects a same-type override (the base klass owns `"table"`, so constructing the subclass throws a type/klass mismatch), and Lexical also validates `exportJSON().type === getType()`, so the type can't be forced back to `"table"`. New tables therefore serialize as `"editor-table"`; `normalize.ts` and the renderer accept **both** it and legacy `"table"`. Legacy `"table"` still hydrates into `EditorTableNode` because `TableNode.importJSON` runs `$createTableNode` (replacement).
- **Responsive layout is px + `ResizeObserver` (Route 1), and `colRatios` is not persisted.** Ratios are derived from `colWidths` (`width / sum`), so the only new persisted fields are `layout` and `showRowNumbers`. The editor keeps `colWidths` pinned to the container via a `ResizeObserver`; the renderer derives `%` from `colWidths` for native reflow.
- **No `EditorTableNode` `createDOM` rewrite was needed for behavior, but a thin `createDOM`/`updateDOM` override stamps `data-table-layout` + the `rt-table-numbered` class** (CSS keys off them). Layout *behavior* still emerges from `colWidths`; the attribute/class only drive presentational CSS (responsive `width:100%`, numbered gutter).
- **Chrome "pinning" was added.** The table chrome is mouse-band-driven, so an open menu's Popover (rendered outside the band) would clear `geom` and unmount the menu mid-click. `pinned` freezes the chrome while the layout select or structure menu is open, and the structure toggles skip the post-mutation editor refocus so the multi-select menu stays open across taps.
- **Merge/unmerge/column-move live in the right-click context menu** (`ContextMenuPlugin`), table-aware via context captured at open time, rather than a separate cell-selection toolbar. Column move keeps `colWidths` aligned via `moveArrayItem`.

Verified end-to-end in Ladle with Playwright: editor loads clean; layout switch (fixed→responsive fills the container); numbered gutter; conditional header-edge guard; cell merge/unmerge; column move — all with no console errors. 501 unit tests pass; typecheck, lint, and build are green.

## 1. Goal

Make block chrome — the badges, icon buttons, and dropdown selectors that float on a block — a **single shared vocabulary** instead of three hand-rolled copies, then use that vocabulary to add **Confluence-grade table controls**: responsive (percentage) column layout, header-row / header-column / numbered-column toggles, and a fix for the header-becomes-middle bug. The work is sequenced so the chrome standardization lands first and every table capability after it is expressed as a chrome control, not new bespoke UI.

## 2. Problem Statement

Four things, in the order the owner raised them:

1. **Chrome is hand-rolled everywhere.** The same visual elements (a badge pill, a round icon button, a dropdown pill like the code-block language picker) are implemented three times with drifting tokens. The code-block language dropdown is the pattern we want everywhere; it should be a reusable primitive, not a one-off.
2. **Tables are fixed-px only.** Every table is force-seeded to pixel column widths and resize trades pixels between neighbors. There is no Confluence-style **responsive** table that distributes by percentage and reflows with the container.
3. **No header / numbered-column toggles.** Lexical supports per-cell header state but we never expose a toggle. Header row, header column, and a numbered column should be opt-in features, surfaced through the same standardized chrome as #1.
4. **Header-becomes-middle bug.** Inserting a row above the header row, or a column before the header column, pushes the header into the interior. Likely we should simply disallow inserting *before* the header axis.

Plus a coverage question: are we using everything `@lexical/table` offers, or is there capability sitting unused?

## 3. Current-State Findings

### 3.1 The Three Chrome Systems

There is no shared chrome layer. Three independent implementations of the same vocabulary exist:

**System 1 — `BlockShell` (`packages/editor/src/nodes/base.tsx:175`).** The intended convention (docs/001 §5 calls it "the chrome"). Used by `CalloutNode`, `EmbedNode`, `MediaNode`, `PostRefNode`. Renders *inside* the decorator node's DOM. Provides:

- a hover badge top-left (icon + uppercase label, `opacity-0 → group-hover/block:opacity-100`);
- a top-right cluster of `actions` (hover-revealed) plus an always-present `Remove` button;
- a `persistentActions` slot rendered before the hover cluster (its doc-comment literally cites "the code-block language" as the use case — but code-block does not use `BlockShell`);
- a `BlockChromeButton` helper for action buttons.
- Tokens: `border-base-300 bg-base-200`, buttons `size-6`, badge `bg-base-200 text-[10px] uppercase tracking-wide`.

**System 2 — Code block (`packages/editor/src/nodes/code-block-node.tsx:73`).** Deliberately bypasses `BlockShell` ("No BlockShell border/label" comment). Hand-rolls its own `absolute right-2 top-2` cluster containing:

- a `MenuTrigger` **language dropdown pill** — the exact pattern we want to generalize — with bespoke classes (`rounded-full border-base-300 bg-base-100 px-2.5 ... shadow-sm`);
- a `Remove` button with *different* tokens than `BlockShell` (`bg-base-100`, `shadow-sm`, hover-revealed).

**System 3 — `TableControlsPlugin` (`packages/editor/src/plugins/table-controls-plugin.tsx`).** A third world, structurally forced apart: tables are real `ElementNode`s, so chrome cannot live inside the node. It is a `createPortal(…, document.body)` fixed overlay positioned from `mousemove` geometry (`computeGeom`). It defines its own four button-class constants (`buttonBaseClass`, `insertButtonClass`, `deleteButtonClass`, `chromeButtonClass`, sized `size-[18px]`) and re-creates a "Table" badge pill + Remove button that visually *imitate* `BlockShell`'s badge while sharing zero code.

**Divergence summary.** The same three elements — badge pill, round icon button, dropdown selector — appear in all three with inconsistent tokens:

| Element | BlockShell | Code block | Table controls |
| --- | --- | --- | --- |
| Icon button bg | `bg-base-200` | `bg-base-100 shadow-sm` | `bg-base-100 shadow-sm` |
| Icon button size | `size-6` | `size-6` | `size-[18px]` |
| Badge bg | `bg-base-200` | (none) | `bg-base-100 shadow-sm` |
| Dropdown pill | — | bespoke | — |
| Render host | inside node | inside node | body portal |

The host differs for a real reason (decorator DOM vs. body portal). The *styling* differing is the accident to fix.

### 3.2 Table Layout Is Px-Only And Force-Seeded

`packages/editor/src/plugins/table-plugin.tsx` `useSeedColumnWidths` runs on every `TableNode` `created` mutation and, if `getColWidths() === undefined`, writes explicit pixel widths from `tableSeedAvailableWidth` + `splitColumnWidths`. The doc-comment explains why this is necessary *today*: without explicit widths a fixed-layout table springs back on resize. The consequence is that **every** table is locked to the Word "fixed width" model from birth.

`packages/editor/src/model/layout.ts`:

- `splitColumnWidths(available, columns)` — even px split, remainder into the last column.
- `resizeColumnWidths(widths, colIndex, deltaX, minWidth)` — trades px with the **adjacent** column so the total is conserved (no right-hand gap). This is fixed-width semantics by definition.

`TableControlsPlugin.startResize` previews by writing `<col>` `style.width = "${px}px"` straight to the DOM during drag, then commits `node.setColWidths(committed)` once on release.

There is **no percentage path anywhere**. Confluence's default table is responsive: columns hold relative weights and the table reflows to its container. `@lexical/table@0.45` cannot store that — `colWidths` is `number[]` (px). So responsive mode is not a flag flip; it requires the editor to own the ratio↔px conversion (see §6).

### 3.3 Header State Is Per-Cell And Unmanaged

Header is **not** a table property in Lexical. Each `TableCellNode` carries `__headerState: TableCellHeaderState`, where `TableCellHeaderStates = { NO_STATUS, ROW, COLUMN, BOTH }` (bit flags: `ROW | COLUMN === BOTH`). Cells expose `getHeaderStyles()` and `setHeaderStyles(state, mask?)`.

We set headers exactly once, at insert time, via `includeHeaders: true` (toolbar `toolbar-plugin.tsx:411`, slash `slash-menu-plugin.tsx:89`). That creates a header **row**. After that we never read or write header state — there is no toggle for header row, no concept of a header column, and no numbered column. All three are achievable from the existing per-cell API (numbered column needs a presentational gutter, not a data column — see §7.2).

### 3.4 The Header-Becomes-Middle Bug

`TableControlsPlugin.insertColumn(0)` / `insertRow(0)` resolve `boundary === 0` to `targetCol/Row = 0`, `after = false`, and call `$insertTableColumnAtSelection(false)` / `$insertTableRowAtSelection(false)` against the first header cell (`table-controls-plugin.tsx:168`, `:185`). The inserted row/column is `NO_STATUS`, so the header cells shift to index 1 and visually land in the interior — "the header becomes middle."

Root cause: header is per-cell and edge-insert does not preserve "the header is the boundary." The owner's instinct — *don't let users insert before the header axis at all* — is the cleanest fix and matches Confluence (you cannot push content above a header row). See §8.

### 3.5 `@lexical/table` Coverage Audit

What we import and use: `TablePlugin` (`hasCellMerge`, `hasHorizontalScroll`, `hasTabHandler`, `hasCellBackgroundColor={false}`), `INSERT_TABLE_COMMAND`, the `$insert*/$delete*AtSelection` family, `$isTableNode`, `$getTableCellNodeFromLexicalNode`, `$getTableNodeFromLexicalNodeOrThrow`, `$getNearestNodeFromDOMNode`, `TableNode.get/setColWidths`.

Enabled but with **no UI** (dead capability):

- **`hasCellMerge` is on, but nothing calls `$mergeCells` / `$unmergeCell`.** Cell selection works; merge/unmerge is unreachable. `ContextMenuPlugin` only offers insert-below / delete-block. Confluence has merge/split.

Available and unused (Confluence-parity candidates):

- `$moveTableColumn` — drag-reorder columns. Natural extension of the existing resize handles.
- `hasCellBackgroundColor` — currently `false`. Confluence tints cells/rows.
- `TableCellHeaderStates` + `setHeaderStyles` — the entirety of Part C.
- `$isScrollableTablesActive` / `setScrollableTablesActive` — global scroll mode; relevant once responsive mode (§6) wants per-table wrap-vs-scroll.
- Low-level `$computeTableMap`, `$getTableCellNodeRect`, `$getTableCellSiblingsFromTableCellNode` — building blocks if we implement merge / move / numbered gutter ourselves.

Conclusion: we use the structural core but none of the *styling/semantic* surface (headers, merge, move, background). Parts C–E close that.

## 4. Design Overview

Four parts, layered so each rests on the one before:

- **Part A — Chrome primitives.** Extract `ChromeBadge`, `ChromeButton`, `ChromeSelect`, `ChromeBar` into `nodes/chrome.tsx`. One token set. `BlockShell` composes them; code-block drops its bespoke cluster; `TableControlsPlugin` imports the same primitives into its portal. Nothing visual changes for the user except consistency.
- **Part B — Table layout modes.** A serialized `layout: "fixed" | "responsive" | "full-width"` attribute on the table, owned by the editor (Lexical can't store it natively). Seeding and resize become mode-aware: responsive stores ratios and converts to px via a `ResizeObserver`.
- **Part C — Header/numbered toggles.** A `ChromeSelect`/toggle group in the table chrome that flips per-cell header state for the row and/or column axis, plus an opt-in presentational numbered gutter.
- **Part D — Header-edge guard.** Suppress the boundary-0 insert affordance on a header axis, fixing §3.4.
- **Part E — Optional capabilities.** Merge/unmerge UI and column move, expressed through the standardized chrome and context menu.

Parts A and D are pure refactors/bug-fixes with no schema change. Parts B, C (and E's merge if it changes nothing serialized) touch the document model and therefore the renderer.

## 5. Part A — The Shared Chrome Primitives

### 5.1 Token Set

Pick one set and apply it to all three hosts. Proposed canonical tokens (closest to today's code-block/table look, which read best on dense surfaces):

- **Surface:** `border border-base-300 bg-base-100 shadow-sm`.
- **Icon button:** `grid size-6 place-items-center rounded-full` + surface, neutral `text-base-content/60`, hover intent color (`hover:text-base-content` default, `hover:text-error` for destructive).
- **Badge:** `flex h-6 items-center gap-1 rounded-full px-2 text-[10px] font-semibold uppercase tracking-wide text-base-content/60` + surface.
- **Select pill:** badge geometry + `gap-1` + trailing `ChevronDown`, `hover:text-base-content`.

`bg-base-100 shadow-sm` wins over `BlockShell`'s `bg-base-200` because two of three hosts (code, table) already use it and it floats correctly over both light node bodies and the document background. `BlockShell` cells move to `bg-base-100`; this is the one intentional visual change and should be eyeballed in Ladle.

### 5.2 Primitive APIs

New file `packages/editor/src/nodes/chrome.tsx` (decorator hosts already import from `nodes/`, and the table plugin can import across — keep it under `nodes/` since `base.tsx` will re-export for back-compat):

```tsx
// A round icon button. `intent` selects the hover color.
export function ChromeButton(props: {
  icon: string;
  label: string;                    // aria-label
  intent?: "neutral" | "danger";    // default "neutral"
  onPress?: () => void;
  isHidden?: boolean;               // for hover-reveal wrappers
}): JSX.Element;

// The icon + label pill (non-interactive by default).
export function ChromeBadge(props: {
  icon: string;
  label: string;
}): JSX.Element;

// The code-block language dropdown, generalized. Drives a React Aria Menu.
export function ChromeSelect<T extends string>(props: {
  label: string;                    // aria-label on trigger + menu
  value: T;
  options: readonly { value: T; label: string; icon?: string }[];
  onChange: (value: T) => void;
  menuClassName?: string;           // e.g. "w-40"
}): JSX.Element;

// Optional: a horizontal cluster wrapper with consistent gap. Hosts that need
// hover-reveal wrap their own `group-hover` div; ChromeBar stays layout-only.
export function ChromeBar(props: { children: ReactNode }): JSX.Element;
```

`ChromeSelect` is the centerpiece — it is exactly today's code-block `MenuTrigger` + `Button` pill + `Menu`/`MenuItem`, lifted verbatim and parameterized. Optional `icon` per option supports the callout-tone menu (icon + label rows) and future header-mode menus.

### 5.3 Three Render Hosts, One Vocabulary

The primitives are host-agnostic — plain styled React Aria components. They are dropped into three different containers:

- **Decorator nodes:** inside `BlockShell`, in its `actions` / `persistentActions` slots.
- **Code block:** inside its own `absolute top-right` cluster (it keeps opting out of the border/label shell, but its buttons/select are now `ChromeButton` / `ChromeSelect`).
- **Table:** inside the `createPortal` overlay in `TableControlsPlugin`, positioned by geometry. The whole-table badge + remove (`table-controls-plugin.tsx:416`) becomes `<ChromeBar><ChromeBadge …/><ChromeButton intent="danger" …/></ChromeBar>`; the insert/delete `+`/`-` buttons become `ChromeButton`s (note: those are `size-[18px]` micro-buttons — either accept `size-6` everywhere or add a `size?: "sm" | "md"` prop; recommend `size` prop so the boundary buttons stay small).

The geometry, mouse-tracking, and resize logic in `TableControlsPlugin` are untouched — only the leaf button/badge JSX swaps to primitives.

### 5.4 Migration Of Existing Chrome

- `BlockChromeButton` (`base.tsx:219`) → thin alias of `ChromeButton`, or delete and update callers (`callout-node.tsx:93`). Keep an alias for one release to avoid churn.
- `BlockShell` internal badge/remove markup → `ChromeBadge` / `ChromeButton`.
- `code-block-node.tsx` language pill → `ChromeSelect`; remove button → `ChromeButton`.
- `table-controls-plugin.tsx` four class constants → deleted; buttons → `ChromeButton` (`intent="danger"` for delete/remove), badge → `ChromeBadge`.

No behavior changes; this is a consolidation. Verified by existing snapshot/interaction tests plus a Ladle pass for the `bg-base-200 → bg-base-100` shift.

## 6. Part B — Table Layout Modes

### 6.1 The Px-Only Constraint

`TableNode.colWidths` is px-only in `@lexical/table@0.45`. We cannot persist percentages there. Two viable strategies:

1. **Editor-owned ratios (recommended).** Store the layout mode and, for responsive mode, store relative weights in our own table attribute; convert weights→px on mount and on container resize, writing the resulting px into `colWidths` (so Lexical's reconciler and the renderer keep working unchanged frame-to-frame). The model is "ratios are the truth, px is a cache."
2. **Drop `colWidths` in responsive mode.** Let `table-layout: auto` flow and skip seeding. Simpler, but loses authored column proportions and makes resize ill-defined. Rejected as the default; acceptable as the degenerate "no widths yet" state.

We go with strategy 1.

### 6.2 The `layout` Attribute

Because Lexical's `TableNode` won't carry it, the editor owns it. Options, cheapest first:

- **(Recommended) A wrapping attribute via the existing passthrough.** Confirmed: the editor registers the **stock** `@lexical/table` `TableNode` (`RichTextEditor.tsx:160`, no subclass), and tables serialize through the generic model passthrough (`model/serialize.ts`, `model/normalize.ts` `"table"/"tablerow"/"tablecell"`) with `indent: 0` — *not* through `TableNode.exportJSON`. So `layout` (and, for responsive, `colRatios?: number[]`) can ride that passthrough as extra fields on the table node's serialized shape, threading through `serialize.ts`/`normalize.ts` without subclassing. The lighter-weight path.
- **A data-attribute mirror** for the renderer to read (`data-idco-table-layout`).

`layout` values:

- `fixed` — today's behavior: px `colWidths`, resize trades px with neighbor, total conserved. Default for existing/imported tables (back-compat).
- `responsive` — `colRatios` sum to 1; px `colWidths` are derived = `ratio * containerWidth`; resize adjusts ratios; table width follows container. **Confirmed default for newly inserted tables** (owner decision 2026-06-14, matches Confluence). Existing/imported tables stay `fixed`.
- `full-width` — responsive pinned to 100% of the editor content width (bleed to the column edge). Optional; can ship after `responsive`.

### 6.3 Seeding And Resize Per Mode

`useSeedColumnWidths` (`table-plugin.tsx`) becomes mode-aware:

- `fixed`: unchanged.
- `responsive`: seed `colRatios` to even (`1/n`) and derive px from the measured container; do **not** treat the absence of `colWidths` as a bug.

`model/layout.ts` gains ratio-space twins (pure, unit-testable like the existing functions):

```ts
export function splitColumnRatios(columns: number): number[];          // even, sums to 1
export function resizeColumnRatios(                                    // trade with neighbor in ratio space
  ratios: readonly number[], colIndex: number, deltaRatio: number, minRatio: number,
): number[];
export function ratiosToWidths(ratios: readonly number[], container: number): number[];
export function widthsToRatios(widths: readonly number[]): number[];   // for fixed→responsive conversion
```

`TableControlsPlugin.startResize` branches on mode: `fixed` keeps writing px and committing `colWidths`; `responsive` converts the px delta to a ratio delta (`deltaX / containerWidth`), previews px on `<col>` as today, and commits `colRatios` (with derived `colWidths` cached). A `ResizeObserver` on the scroll wrapper recomputes derived px when the container changes (window resize, sidebar toggle) for responsive tables only.

A **layout-mode `ChromeSelect`** (Fixed / Responsive / Full-width, with icons) joins the table chrome bar from Part A. Switching `fixed → responsive` calls `widthsToRatios(colWidths)` so proportions are preserved; `responsive → fixed` freezes current derived px into `colWidths`.

### 6.4 Renderer Parity

`@idco/content-renderer` must read `layout`/`colRatios` and render the same way the editor previews:

- `fixed`: `table-layout: fixed` + `<colgroup>` px (today).
- `responsive`: `<colgroup>` with `%` widths from ratios, `width: 100%`, so the published page reflows identically without the editor's `ResizeObserver`.
- `full-width`: as responsive at 100% content width.

This is the gate that makes responsive mode safe to ship: the read side must not fall back to fixed px or the published table will differ from the editor.

## 7. Part C — Header And Numbered-Column Toggles

All three surface as controls in the table chrome bar (Part A), e.g. a small `ChromeSelect`/toggle group "Header row / Header column / Numbers".

### 7.1 Header Row / Header Column

Pure per-cell state via `setHeaderStyles(state, mask)`:

- **Toggle header row:** for every cell in row 0, flip the `ROW` bit: `cell.setHeaderStyles($state ? cur | ROW : cur & ~ROW, ROW)`. (Use the `mask` arg so the `COLUMN` bit is untouched — important when both are on, i.e. `BOTH`.)
- **Toggle header column:** same with the `COLUMN` bit across every row's cell at index 0.
- Corner cell (0,0) naturally becomes `BOTH` when both axes are on — which is exactly the Confluence look.

Read current state for the toggle's on/off by sampling row-0 / col-0 cells' `getHeaderStyles()`. Store nothing new: header state already serializes per cell, and the renderer already distinguishes `th`/`td` from it.

### 7.2 Numbered Column

Confluence's row-number gutter is **presentational** — not a data column. Critical design call: do **not** insert a real `TableCellNode` column (that would corrupt data, break CSV/HTML export, and re-introduce header-edge bugs). Instead:

- Serialize a boolean `showRowNumbers` on the table attribute (Part B's mechanism).
- Render the gutter with a CSS counter on the left, or as an overlay column in the `TableControlsPlugin` portal (which already computes `geom.rows` y-positions — it can paint numbers next to each row boundary). The renderer uses the CSS-counter approach for the static page.
- The gutter is non-editable, non-selectable, excluded from column geometry used by insert/resize.

Toggle lives in the same chrome group. Default off.

## 8. Part D — The Header-Edge Insert Guard

Fix §3.4 by refusing to insert *before* a header axis, matching Confluence and avoiding the per-cell header rewrite entirely.

In `TableControlsPlugin`, when computing which insert affordances to reveal:

- If the table has a **header row**, suppress the `activeRow === 0` insert `+` (the row-before-first affordance at `table-controls-plugin.tsx:382`). The earliest a row can be inserted is *after* row 0.
- If the table has a **header column**, suppress the `activeCol === 0` insert `+` (`:350`).
- Delete affordances and all interior/after inserts are unaffected.

Determine header presence by sampling row-0 / col-0 header state (same read as §7.1). When no header is set, boundary-0 inserts remain allowed (current behavior).

Fallback option if the owner later wants to keep boundary-0 inserts: after `$insertTable*AtSelection(false)`, re-stamp the header bit onto the new edge cells and clear it from the displaced ones. This is strictly more code and more failure modes than the guard, so the guard is the chosen default.

## 9. Part E — Optional Lexical Capabilities

Sequenced after A–D; each is independently shippable and uses the standardized chrome.

- **Cell merge / unmerge.** `hasCellMerge` is already on but unreachable. Add merge/unmerge to `ContextMenuPlugin` (and/or a cell-selection chrome bar) calling `$mergeCells` / `$unmergeCell`, enabled only when a multi-cell `TableSelection` exists. No schema change (merge is span attributes Lexical already serializes).
- **Column move.** `$moveTableColumn` driven from a drag affordance on the existing column boundary handles. Interacts with `colWidths`/`colRatios` — moving a column must move its width/ratio with it.
- **Cell background color** (`hasCellBackgroundColor`) and **per-table scroll vs wrap** (`setScrollableTablesActive`) — listed for completeness; defer unless requested.

## 10. Files

New:

- `packages/editor/src/nodes/chrome.tsx` — `ChromeButton`, `ChromeBadge`, `ChromeSelect`, `ChromeBar`, token constants.
- *No* `TableNode` subclass is needed for the recommended path — `layout` / `colRatios` / `showRowNumbers` thread through `model/serialize.ts` + `model/normalize.ts` (the existing table passthrough). A subclass is only the fallback if runtime access (not just serialization) of `layout` proves awkward.
- `tests/editor/chrome.test.tsx`, `tests/editor/table-layout-model.test.ts`, `tests/editor/table-headers.test.tsx`.

Changed:

- `nodes/base.tsx` — `BlockShell` composes primitives; `BlockChromeButton` → alias.
- `nodes/code-block-node.tsx` — language pill → `ChromeSelect`; remove → `ChromeButton`.
- `nodes/callout-node.tsx` — tone menu → `ChromeSelect`.
- `plugins/table-controls-plugin.tsx` — buttons/badge → primitives; layout-mode + header + numbers chrome; header-edge guard; mode-aware resize.
- `plugins/table-plugin.tsx` — mode-aware seeding; `ResizeObserver` for responsive.
- `model/layout.ts` — ratio-space helpers.
- `plugins/context-menu-plugin.tsx` — (Part E) merge/unmerge.
- `packages/content-renderer/*` — read `layout` / `colRatios` / `showRowNumbers`.
- `docs/001` §7.5 — cross-link this doc.

## 11. Edge Cases And Failure Modes

- **Mid-drag reconcile race (existing, must preserve).** `table-controls-plugin.tsx` previews on the DOM and commits once on release precisely because routing every frame through `editor.update` makes the document-sync plugin revert the drag. The responsive path must keep this discipline — convert to ratios but still commit once.
- **Container width 0 at mount.** Responsive derive needs a real container width; if measured 0 (hidden tab, SSR hydrate), defer derivation until the `ResizeObserver` first fires; do not write 0-width `colWidths`.
- **Empty `colRatios` / NaN.** Guard `ratiosToWidths` against `sum === 0`; fall back to even split.
- **Header sampling on merged corner cells.** Reading `getHeaderStyles()` on a spanned cell must sample the origin cell, not a spanned-over slot (use `$computeTableMap` if merges are present).
- **Both-axis header math.** Always pass the `mask` to `setHeaderStyles` so toggling one axis never clears the other's bit on the corner cell.
- **Layout switch with prior px.** `fixed → responsive` must convert existing `colWidths` to ratios (preserve proportions); never reset to even unless widths are absent.
- **Numbered gutter vs. geometry.** Insert/resize/header reads index real columns only; the gutter is excluded from `geom.cols`.
- **Header-edge guard with no header.** Guard must read live header state each hover, not assume; a user can remove the header row and then *should* regain boundary-0 insert.
- **Renderer drift.** Any table that previews responsive in the editor but renders fixed (or vice versa) on the page is a correctness bug, not cosmetic — covered by a round-trip test (§12).

## 12. Tests

- `model/layout` ratio helpers: even split sums to 1; resize conserves total and respects `minRatio`; `ratiosToWidths`/`widthsToRatios` round-trip; container-0 fallback. (Pure, no DOM — mirrors existing `layout.test.ts`.)
- Chrome primitives: `ChromeSelect` opens, lists options, fires `onChange`; `ChromeButton` fires `onPress` and exposes `aria-label`; danger intent renders error hover. (React Aria interaction tests.)
- Header toggles: toggling header row sets `ROW` on row-0 cells and renders `th`; header column sets `COLUMN`; both → corner `BOTH`; un-toggle clears only the intended bit.
- Header-edge guard: with a header row, the row-0 insert `+` is not rendered; without it, it is.
- Layout mode: switching `fixed → responsive` preserves proportions; new responsive table seeds even ratios; resize in responsive commits `colRatios` once (not per frame).
- **Round-trip parity:** a responsive table exported and re-rendered through `@idco/content-renderer` produces percentage `<colgroup>` widths matching the editor; a fixed table still produces px. (Guards §11 "renderer drift".)
- Ladle: visual pass on the `bg-base-200 → bg-base-100` chrome shift across callout/embed/media/post-ref.

## 13. Implementation Sequence

1. **Part A — chrome primitives.** Pure refactor, unblocks the rest, no schema risk. Land and visually verify first.
2. **Part D — header-edge guard.** Small, self-contained bug fix; can land alongside A.
3. **Part B — layout modes.** Schema + renderer change. **Decided (2026-06-14):** new tables default to `responsive`; existing/imported docs stay `fixed`. The renderer-parity test (§12) is the gate that makes this safe to ship.
4. **Part C — header / numbered toggles.** Builds on A's chrome and B's attribute mechanism.
5. **Part E — merge / move.** Optional, post-MVP.

Open decisions to confirm before Part B:

- ~~Default layout mode for new tables~~ — **decided: `responsive`** (2026-06-14).
- Confirm the passthrough path for `layout`/`colRatios` (recommended) over a `TableNode` subclass.
- Whether `full-width` ships in this pass or follows `responsive`.

## 14. Definition Of Done

- One chrome vocabulary: `ChromeButton`/`ChromeBadge`/`ChromeSelect`/`ChromeBar` are the only source of badge/button/select styling; `BlockShell`, code block, and `TableControlsPlugin` all compose them; the four bespoke class constants in `table-controls-plugin.tsx` and the duplicated cluster in `code-block-node.tsx` are gone.
- Tables support `fixed`, `responsive`, and (optionally) `full-width` layout, switchable from table chrome; responsive columns distribute by ratio and reflow with the container; the choice round-trips through the document and renders identically in `@idco/content-renderer`.
- Header row, header column, and numbered column are opt-in toggles in table chrome; header axes use per-cell `setHeaderStyles` with correct bit masking; the numbered column is presentational and never a data column.
- Inserting a row/column before a header axis is disallowed; the header never lands in the interior (§3.4 fixed).
- `@lexical/table` coverage gaps are documented and either closed (headers) or consciously deferred (merge/move/background) with a tracking note.
- Existing documents load and behave unchanged; all new behavior is additive and default-safe.
- Tests in §12 pass, including the renderer round-trip parity test.
