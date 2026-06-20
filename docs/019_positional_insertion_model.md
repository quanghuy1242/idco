# 019 - Positional Editing: Scopes, The Gap Cursor, And Block Placement

> Status: implementation-grade research and proposal (pre-implementation).
>
> Date: 2026-06-20
>
> Scope:
>
> - `packages/editor/src/core/model.ts` — the selection union, `StructuralNode`, `TextPoint`, scope shape.
> - `packages/editor/src/core/commands.ts` — the insertion compilers and the placement helper.
> - `packages/editor/src/core/store.ts` — `parentEntry`, gap derivation, body id, selection remap.
> - `packages/editor/src/core/transaction.ts` — `insertNode`/`removeNode`/`replaceText`/`setSelection`.
> - `packages/editor/src/view/navigation.ts` — caret/arrow movement, `adjacentTextLeaf`.
> - `packages/editor/src/view/selection-overlay.tsx` — caret/selection/gap painting.
> - `packages/editor/src/view/object-block.tsx` — the table object (`renderBakedTable`, `defaultTableRow`), the node SPI views.
> - `packages/editor/src/view/editor-chrome.tsx`, `packages/editor/src/view/owned-model-editor.tsx` — the insert dispatch sites.
>
> Source docs:
>
> - `docs/002_gap_cursor_and_block_flow.md` — the legacy gap cursor (Parts A/B/C), already scope-aware (root + table cells). This document re-establishes it in the owned model and generalizes the scope.
> - `docs/011_foundation_dsa_owned_model_editor.md` §2 (node graph), §5 (positions), §8 (the selection union, the remap contract). This document **revises** §8.2's gap shape and §2.4/§8.2's "selection never descends into object internals" invariant (see §5.2).
> - `docs/016_node_spi_and_pluggable_blocks.md` — the node SPI; `insert.createData()` is the data side of every block insert; §6.2's virtualization-seam TODO is the large-container concern.
> - `docs/018_phase_9_polish_and_deferred_parity.md` §2.10 (flat lists), §2.13/§2.14 (deferred table cell editing — this document supersedes the "deferred" status for the position model, see §5.2).
>
> Related docs:
>
> - `docs/010_owned_model_virtualized_editor_plan.md` §2.4/§6.5 — atomic objects, block-atomic selection across objects.
>
> Assumptions:
>
> - The persisted compat JSON shape for tables (`{children:[{type:"tablerow",children:[{type:"tablecell",...}]}]}`) stays stable; only the in-memory model representation changes (§8). This is verified against `defaultTableRow`/`renderBakedTable` in `object-block.tsx`.
> - v1 targets keyboard + mouse. Touch gap placement is a follow-up (it inherits the same model selection).

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 Relevant Files](#31-relevant-files)
  - [3.2 Current Behavior](#32-current-behavior)
  - [3.3 Current Problems](#33-current-problems)
  - [3.4 Legacy Prior Art](#34-legacy-prior-art)
  - [3.5 Assumptions This Design Leans On](#35-assumptions-this-design-leans-on)
- [4. Target Model](#4-target-model)
  - [4.1 The Unifying Primitive: Container-Relative Position](#41-the-unifying-primitive-container-relative-position)
  - [4.2 What A Scope Is](#42-what-a-scope-is)
  - [4.3 The Revised Selection Union](#43-the-revised-selection-union)
  - [4.4 The Resolved Scope Path](#44-the-resolved-scope-path)
  - [4.5 The `InsertionPoint` Type](#45-the-insertionpoint-type)
  - [4.6 The Insertion Resolution Table](#46-the-insertion-resolution-table)
  - [4.7 The Disposable-Empty Predicate](#47-the-disposable-empty-predicate)
  - [4.8 Applying An `InsertionPoint`](#48-applying-an-insertionpoint)
  - [4.9 The Gap Cursor: Painted, Navigable, Materializable](#49-the-gap-cursor-painted-navigable-materializable)
  - [4.10 Scope-Aware Navigation](#410-scope-aware-navigation)
  - [4.11 Selection After Insert](#411-selection-after-insert)
  - [4.12 Invariants](#412-invariants)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 Container-Relative Gap `{scope, index}` Over `{node, side}`](#51-container-relative-gap-scope-index-over-node-side)
  - [5.2 Tables Become Structural Containers (The Fork)](#52-tables-become-structural-containers-the-fork)
  - [5.3 A Resolver Returning An Intent Union](#53-a-resolver-returning-an-intent-union)
  - [5.4 The Disposable-Empty Scope Decision](#54-the-disposable-empty-scope-decision)
  - [5.5 Split Is Real, But Phase 3](#55-split-is-real-but-phase-3)
  - [5.6 The Gap Cursor Lives In The Model Selection, Not Ephemeral React State](#56-the-gap-cursor-lives-in-the-model-selection-not-ephemeral-react-state)
  - [5.7 Scope-Boundary Escape Semantics](#57-scope-boundary-escape-semantics)
  - [5.8 The Caret Shape Follows The Gap Axis](#58-the-caret-shape-follows-the-gap-axis)
- [6. Implementation Strategy](#6-implementation-strategy)
- [7. Detailed Implementation Plan](#7-detailed-implementation-plan)
  - [7.1 The Resolver And Scope Helpers (Phase 1)](#71-the-resolver-and-scope-helpers-phase-1)
  - [7.2 The `replace` Application Path (Phase 1)](#72-the-replace-application-path-phase-1)
  - [7.3 Rewiring The Insert Compilers (Phase 1)](#73-rewiring-the-insert-compilers-phase-1)
  - [7.4 The Gap Cursor: Paint + Produce + Materialize (Phase 2)](#74-the-gap-cursor-paint--produce--materialize-phase-2)
  - [7.5 Scope-Aware Navigation (Phase 2)](#75-scope-aware-navigation-phase-2)
  - [7.6 Tables As Structural Containers (Phase 4)](#76-tables-as-structural-containers-phase-4)
  - [7.7 The `split` Variant (Phase 3)](#77-the-split-variant-phase-3)
  - [7.8 Range Selections](#78-range-selections)
- [8. Migration And Rollout](#8-migration-and-rollout)
- [9. Edge Cases And Failure Modes](#9-edge-cases-and-failure-modes)
- [10. Implementation Backlog](#10-implementation-backlog)
- [11. Future Backlog](#11-future-backlog)
- [12. Definition Of Done](#12-definition-of-done)
- [13. Final Model](#13-final-model)

---

## 1. Goal

Make the caret reachable **anywhere a position exists** — the empty space before the first block, after the last block, between two adjacent objects, and inside any container (a callout, a quote, a table cell) — and make "insert a block" land **where that caret is**. Today the caret silently refuses to move past an object that has no text neighbour, the gap between blocks is unreachable and unpainted, and block insertion ignores the caret entirely and always lands "after whatever block the selection touches."

The motivating bugs are two faces of one missing concept:

1. **Insert lands in the wrong place.** With the caret at the very start of the first block, inserting a table-of-contents lands it *after* the heading. Top-of-document insertion is structurally unreachable (§3.3).
2. **The caret cannot rest beside an object.** A table as the first or last block (the reported screenshot) has no text leaf on its far side, so arrow navigation returns "no move" and there is no way to add content above or below it. The same holds for the gap between two stacked objects.

The missing concept is a **position relative to a scope**: a caret (or a between-blocks gap) named by *which container it is in* and *where in that container's order*. Once positions are scope-relative, doc-edge gaps, between-object gaps, nested-container carets, and caret-aware insertion all fall out of one model, and a gap cursor *is* an insertion point.

This document folds two systems into one (per the owner's decision, 2026-06-20):

- **Block placement** — `resolveInsertionPoint`: map any selection to where a new block lands (`at` / `replace` / `split`).
- **The scoped caret** — the gap cursor and scope-aware navigation that *produce* the positions placement consumes, reaching every gap including inside table cells.

The full-nesting decision (including table cells, 2026-06-20) drives the one model change here: **tables stop being atomic objects and become structural containers** so a cell is "just another scope" (§5.2). This is the only way "inside a cell" and "inside a callout" become the same operation rather than two special cases. Crucially this is **cheap right now**: the table is a render-only stub with no editor and no cell-editing commands (§5.2), so we build it structural greenfield rather than migrating a real implementation — the lucky timing the owner flagged. It is also our owned model end to end; nothing here is blocked by an upstream library, so "lift the legacy gap cursor forward" and "reclassify the table" are both ours to make.

Non-goals / boundaries:

- Mid-text `split` insertion is specified and recommended as Phase 3, not Phase 1 (§5.5).
- Touch gap placement is a follow-up; it reuses the same model selection.
- This document does not change `insert.createData()` or what a block *is* — only *where* it lands and *how the caret reaches there*.

## 2. System Summary

There are two block-insert entry points, both ending at the same compilers via one placement helper:

- The toolbar **Insert (+) menu** dispatches `{ type: "insert-object", objectType, data }` ([editor-chrome.tsx:476-499](../packages/editor/src/view/editor-chrome.tsx#L476-L499)); a pointer/drop path dispatches the same ([owned-model-editor.tsx:93-101](../packages/editor/src/view/owned-model-editor.tsx#L93-L101)).
- HTML paste dispatches `{ type: "insert-blocks", nodes }`, compiled by `compileInsertBlocks`.

Both compute *where* via `insertionIndexAfterSelection(store)` ([commands.ts:1121-1132](../packages/editor/src/core/commands.ts#L1121-L1132)), which collapses every selection to "index of the touched node + 1."

The selection union is richer than that helper uses ([model.ts:82-106](../packages/editor/src/core/model.ts#L82-L106), 011 §8.2):

```
EditorSelection =
  | { type: "text"; anchor: TextPoint; focus: TextPoint }   // caret/range inside a leaf
  | { type: "node"; node: NodeId }                           // an object selected whole
  | { type: "gap";  node: NodeId; side: "before" | "after" } // a caret between blocks (docs/002)
```

The `gap` member is the position concept this document needs, but in the owned model it is **vestigial**: never painted (only announced for a11y, [selection-overlay.tsx:394](../packages/editor/src/view/selection-overlay.tsx#L394)), never produced by user interaction (its only producer is the delete-fallback `fallbackSelection`, [store.ts:1630-1656](../packages/editor/src/core/store.ts#L1630-L1656)). Navigation, meanwhile, scans *past* objects to the next text leaf and refuses to move when there is none ([navigation.ts:44-60](../packages/editor/src/view/navigation.ts#L44-L60)), and it operates on the flat `store.order` with no scope concept.

## 3. Current-State Findings

### 3.1 Relevant Files

- `packages/editor/src/core/commands.ts` — `insertionIndexAfterSelection` (L1121), `compileInsertObject` (L1067), `compileInsertBlocks` (L1096), `compileSplit` (L309 — the split + mark-clip + `redirect` pattern to reuse).
- `packages/editor/src/core/model.ts` — `TextPoint`/`TextSelection`/`NodeSelection`/`GapSelection`/`EditorSelection` (L82-L106), `StructuralNode` + `StructuralNodeType` = `body | list | listitem | quote | callout` (L190-L214), `makeStructuralNode` (L470), `makeTextNode`/`makeObjectNode`, `sliceTextContent`, `pointAtOffset`.
- `packages/editor/src/core/store.ts` — `bodyId`, `order`, `parentEntry(id)`, `requireNode`, gap derivation (L1641/L1655), `mapSelection` (L1520+).
- `packages/editor/src/core/transaction.ts` — `TransactionBuilder` (L150): `replaceText` (L168), `insertNode` (L210), `removeNode` (L214), `setSelection` (L230), `redirect`.
- `packages/editor/src/view/navigation.ts` — `adjacentTextLeaf` (L44), `selectionForNavigation` (L62), `verticalNavigation` (L129).
- `packages/editor/src/view/selection-overlay.tsx` — caret/selection paint + `selectionAnnouncement` (L380, the gap a11y-only branch at L394).
- `packages/editor/src/view/object-block.tsx` — `renderBakedTable` (table `data = {children:[tablerow…], colWidths}`), `defaultTableRow` (`tablerow → tablecell → {text}`), the `table`/`editor-table` views; the node SPI views.
- `packages/editor/src/legacy/plugins/gap-cursor-plugin.tsx` — the working gap cursor to port: `$gapTargetBoundary` (L454, **container + offset**), `$isGapContainerNode` (L485, **root | table cell**), `$selectBoundaryOrGap` (L376), `canHoldRealCaret`/`isAtomicGapNode` (L426/L430), the rect geometry (L103-L122).

### 3.2 Current Behavior

**Insertion** (`compileInsertObject`, [commands.ts:1067-1088](../packages/editor/src/core/commands.ts#L1067-L1088)): normalize → bake → `makeObjectNode`, then `tr.insertNode(store.bodyId, insertionIndexAfterSelection(store), node)`, selection → node. The helper returns `index + 1` unconditionally for any non-null selection.

**Navigation** (`selectionForNavigation`, [navigation.ts:62-118](../packages/editor/src/view/navigation.ts#L62-L118)): arrows move within a text leaf by grapheme; at a leaf edge, jump to `adjacentTextLeaf`, which **scans `store.order` past every non-text node** to the next text leaf and returns `null` if there is none. There is no scope; `order.indexOf` is the only locator.

**Gap selection**: produced only by `fallbackSelection` after a delete with no sibling text leaf ([store.ts:1641](../packages/editor/src/core/store.ts#L1641)); painted nowhere; announced only.

**Tables**: a baked `ObjectNode`. Its internal grid is plain JSON inside `data` — `renderBakedTable` reads `payload.children` (rows), each row `children` (cells), each cell `children` as `{text, type:"text"}` literals, **not** `TextLeafNode`s. There is no `NodeId` for a cell, so no `TextPoint` can point inside one.

### 3.3 Current Problems

1. **Top-of-document insertion is unreachable.** `insertionIndexAfterSelection` returns `index + 1` for every selection; no caret resolves to body index `0` (the reported insert bug).
2. **The caret's offset is ignored on insert.** "Start of block" and "end of block" produce identical placement.
3. **The empty-block intent is inexpressible.** Pressing Enter for a fresh paragraph, then inserting an image, should *consume* that paragraph; today it inserts *after* it, leaving a stray blank line.
4. **The caret cannot rest beside an object.** `adjacentTextLeaf` skips objects and returns `null` when none follow — a table as first/last block (the screenshot) is uncrossable and you cannot add content around it.
5. **No between-object gap.** Two stacked objects (`code-block` → `table`) have no caret slot between them; you cannot type between them.
6. **The gap cursor is unpainted and never produced by interaction.** It cannot be the answer to (4)/(5) until it is painted and reachable by click/arrow.
7. **Navigation has no scope.** It is flat over `store.order`. There is no "navigate within this cell / callout," so nested containers cannot host an independent caret flow.
8. **Cells are not addressable.** Table cell content is opaque JSON, so a caret literally cannot exist inside a cell (the full-nesting goal is impossible without a model change).

### 3.4 Legacy Prior Art

The Lexical editor already solved (4)–(7), scope-aware, in [docs/002](docs/002_gap_cursor_and_block_flow.md) + [gap-cursor-plugin.tsx](../packages/editor/src/legacy/plugins/gap-cursor-plugin.tsx):

- **Part A** — arrow nav never leaves an invisible caret; crossing an atomic block lands a real caret or the gap cursor.
- **Part B** — a painted, blinking, ProseMirror-style gap cursor; Enter / typing / paste materialize a real paragraph at the gap.
- **Part C** — click in any inter-block whitespace places the caret or the gap.
- **Scope** — the boundary is `container + offset` (`$gapTargetBoundary`), and `$isGapContainerNode` accepted the **root or a table cell**, so a caret could rest before/between/after atomic blocks *inside a cell without escaping it* (docs/002 line 28).

The owned model regressed all of this to "skip objects, else don't move." This document ports the legacy design forward and generalizes the scope from "root | table cell" to "any container."

### 3.5 Assumptions This Design Leans On

- **A `TextPoint` already addresses a leaf at any tree depth.** `TextPoint.node` is a `NodeId`; nothing in the point model is body-relative ([model.ts:82-87](../packages/editor/src/core/model.ts#L82-L87)). So once a cell *contains a real `TextLeafNode`*, carets inside cells work with **no change to the point primitive** — this is the central argument for promoting tables to structural (§5.2): the model gains depth, the coordinate system does not change.
- **`content.text.length === 0` is the empty-leaf test**, the same predicate `compileSplit` uses ([commands.ts:316-322](../packages/editor/src/core/commands.ts#L316-L322)).
- **Selection remap already relocates dangling references** (011 §8.8, [store.ts:1520-1549](../packages/editor/src/core/store.ts#L1520-L1549)). The `replace` insert path removes a node and relies on this.
- **The persisted table JSON shape is stable.** `tablerow`/`tablecell`/`text` already exist in the compat shape; promotion changes the in-memory model, not the saved document (§8).

## 4. Target Model

### 4.1 The Unifying Primitive: Container-Relative Position

Every position the editor can hold is one of:

- A **text point** inside a leaf — `{ node, anchor, offset }` (unchanged, 011 §5).
- A **node selection** — an atom (image, divider) selected whole (unchanged).
- A **gap** — a caret *between children* of a container, named **`{ scope, index }`**: the slot between child `index-1` and child `index` of `scope`.

`{ scope, index }` is the same shape as the block-placement target `InsertionPoint.at = { parent, index }` (§4.5) and the same information the legacy `$gapTargetBoundary` carried (`container + offset`). Unifying on it means **a gap cursor is literally an insertion point**: materializing the gap = inserting at it. The two halves of this document share one coordinate.

### 4.2 What A Scope Is

A **scope** is a node whose children form an ordered sequence that can host carets, gaps, and inserts. Three kinds:

1. **The body** — the root scope (global). `store.bodyId`.
2. **Structural containers** — `callout`, `quote`, and (post-flattening) the list family, each a `StructuralNode` with `children: NodeId[]` ([model.ts:210-214](../packages/editor/src/core/model.ts#L210-L214)). A callout is a *local* scope nested in the body.
3. **Container objects, promoted** — a **table** and its **rows** and **cells** become structural containers (§5.2), so a cell is a scope whose children are real blocks. "Inside a cell" is then identical to "inside a callout."

What is *not* a scope: a true **atomic object** (image, embed, divider, code-block, post-ref, table-of-contents). These have no internal positions; the caret rests *beside* them as a gap, never inside.

The distinction that replaces today's "object = opaque atom" blanket: a node is either a **container** (has child scopes; caret descends in) or an **atom** (no internal caret; caret rests beside). Tables move from the atom column to the container column; images stay atoms.

### 4.3 The Revised Selection Union

```ts
export type GapSelection = {
  readonly type: "gap";
  readonly scope: NodeId;   // the container the gap is in (body, callout, cell, …)
  readonly index: number;   // slot between children[index-1] and children[index]
};

export type EditorSelection = TextSelection | NodeSelection | GapSelection;
```

`TextSelection` and `NodeSelection` are unchanged. Only `GapSelection` changes shape, from `{ node, side }` to `{ scope, index }` (§5.1). The single in-tree producer (`fallbackSelection`) and the a11y branch update to the new shape; there is no persisted gap (§5.6), so there is no data migration for it.

### 4.4 The Resolved Scope Path

Navigation and "which scope am I in" need the chain of containers from the root down to a position. Add a pure helper:

```ts
// Root-first chain of container ids enclosing a position: [body, …, innermost].
function scopePath(store: EditorStore, position: EditorSelection): NodeId[];
// The innermost scope of the current selection.
function activeScope(store: EditorStore, position: EditorSelection): NodeId;
```

It walks `parentEntry(node).parent` upward (the model is a normalized tree, 011 §2). This is ProseMirror's `ResolvedPos.depth`/`node(depth)` idea, reduced to what navigation needs: enumerate enclosing scopes so an arrow at a scope edge can *escape* to the parent scope's gap (§4.10, §5.7).

### 4.5 The `InsertionPoint` Type

```ts
export type InsertionPoint =
  | { readonly kind: "at"; readonly scope: NodeId; readonly index: number } // splice into a scope here
  | { readonly kind: "replace"; readonly node: NodeId }                      // consume a disposable-empty block
  | { readonly kind: "split"; readonly point: TextPoint };                   // break a leaf, insert in the seam (Phase 3)
```

`at` names a **scope** (not "the body"), so inserting inside a callout or a cell is the same operation as inserting in the body. `at` and `replace` ship in Phase 1; `split` is specified now (stable union) and built in Phase 3 (§5.5); until then a mid-block caret degrades to `at` after.

### 4.6 The Insertion Resolution Table

`resolveInsertionPoint(store): InsertionPoint` maps the current selection. `scope` and `index` come from `parentEntry(blockId)` (`.parent`, `.index`); for the body these resolve against `store.order`.

| Selection | Condition | Resolves to | Rationale |
| --- | --- | --- | --- |
| `text`, collapsed | leaf is *disposable-empty* (§4.7) | `replace(leaf)` | The empty placeholder line becomes the inserted block. |
| `text`, collapsed | `offset === 0`, non-empty | `at(scope, index)` | Insert *before* — top-of-scope reachable. |
| `text`, collapsed | `offset === text.length` (end) | `at(scope, index + 1)` | Insert *after* (today's behavior, now offset-justified). |
| `text`, collapsed | `0 < offset < length` (mid) | Phase 3: `split(point)`; Phase 1: `at(scope, index + 1)` | Break the leaf and insert in the seam; until then fall to after. |
| `text`, **range** (non-collapsed) | — | delete the range in-tx, then re-resolve at the collapsed caret (§7.8) | "Replace my selection with a block." |
| `node` | an object is selected | `at(scope, index + 1)` | Add a sibling after the selected atom. |
| `gap` | `{ scope, index }` | `at(scope, index)` | The gap *is* the position; identity. |
| `null` | no selection | `at(bodyId, order.length)` | Append at end. |

The `gap` row is now an identity map — the deepest reason to unify the two coordinates (§4.1).

### 4.7 The Disposable-Empty Predicate

```ts
function isDisposableEmpty(node: EditorNode): boolean {
  return (
    node.kind === "text" &&
    node.type === "paragraph" &&     // not heading / quote / list item
    node.content.text.length === 0 &&
    !hasInlineAtoms(node)            // an empty leaf still holding an inline atom is not empty
  );
}
```

Recommended scope: **paragraph only** (§5.4). An empty paragraph is the canonical "blank line waiting for content"; an empty heading/quote/list-item is an explicit structural choice. One function, so the policy is tunable in one place.

### 4.8 Applying An `InsertionPoint`

One applier, shared by both compilers and by gap-materialization:

```ts
function placeNodes(tr, store, point: InsertionPoint, nodes: readonly EditorNode[]): void {
  if (point.kind === "replace") {
    const e = store.parentEntry(point.node)!;
    tr.removeNode(e.parent, e.index, store.getNode(point.node)!);
    nodes.forEach((n, i) => tr.insertNode(e.parent, e.index + i, n));
    return;
  }
  if (point.kind === "at") {
    nodes.forEach((n, i) => tr.insertNode(point.scope, point.index + i, n));
    return;
  }
  // point.kind === "split" — Phase 3, §7.7 (reuses compileSplit's splitLeafAt).
}
```

`removeNode` + `insertNode` in one `TransactionBuilder` is a single invertible transaction (one undo restores the placeholder atomically).

### 4.9 The Gap Cursor: Painted, Navigable, Materializable

Port the legacy three parts into the owned model, scope-generalized.

- **Represented in the model selection** as `{ type: "gap", scope, index }` (not ephemeral React state — §5.6). The store owns it; it remaps and survives virtualization like any selection.
- **Painted** by `selection-overlay.tsx`, with the marker shape chosen by the *axis* of the boundary (§5.8): a **block-level** boundary (between/around full-width blocks — the common case) draws a blinking **horizontal** insertion marker in the gap between the rects of children `index-1` and `index` of `scope`, inset to the scope's content box; an **inline-atom** boundary (a chip/inline image inside a line of text) draws the **normal vertical** caret beside the atom instead. The horizontal geometry is the legacy `gapCursorRect` math ([gap-cursor-plugin.tsx:103-122](../packages/editor/src/legacy/plugins/gap-cursor-plugin.tsx#L103-L122)), ported off Lexical. For doc edges, the horizontal marker pins to the top of the first child / bottom of the last child of the scope. Both shapes are the *same* `{scope,index}` gap selection; only the overlay's rect orientation differs.
- **Produced** by: (a) navigation crossing an object with no text slot (§4.10); (b) a click in inter-block whitespace (legacy Part C, hit-test the gaps of the active scope); (c) the delete-fallback (already exists, reshaped to `{scope,index}`).
- **Materialized** by a printable key / Enter / paste while a gap is selected: `placeNodes` with `at(scope, index)` inserts a `paragraph` (typing/Enter) or the pasted/typed content, then lands a text caret in it. Same path as the toolbar insert.
- **Dismissed** by Escape or by a navigation that reaches a real text slot.

### 4.10 Scope-Aware Navigation

Replace the flat `adjacentTextLeaf` walk with a scope-aware step. From a position, an arrow:

1. Moves within the current text leaf if it can (grapheme step) — unchanged.
2. At a leaf edge, looks at the **next/prev sibling in the active scope**:
   - sibling is a **text leaf** → land a real caret at its near edge (today's behavior).
   - sibling is an **atom** (image, divider, code, …) → land a **gap** beside it (`{scope, index}`), so the atom is crossable and a caret can rest next to it. A second arrow steps the gap past the atom to the next slot.
   - sibling is a **container** (callout, quote, table, row, cell) → **descend** into its first/last caret slot (or its leading gap if it opens with an atom).
3. At the **scope's first/last slot** with no further sibling → produce a gap at the scope edge; a further arrow **escapes** to the parent scope's gap beside this container (using `scopePath`, §4.4/§5.7). At the body's edges, stop (or rest at the doc-edge gap).

This is the legacy `$selectBoundaryOrGap` (land real caret if a side `canHoldRealCaret`, else set a gap) generalized to descend/escape across nested scopes. Vertical (`Up`/`Down`) navigation keeps the geometry probe ([navigation.ts:129-163](../packages/editor/src/view/navigation.ts#L129-L163)) but, when the probe lands in no text, falls to the nearest gap rather than refusing to move.

### 4.11 Selection After Insert

- Object insert → `{ node: insertedId, type: "node" }` (selected whole, ready for its gear) — matches today.
- Text-block insert / gap materialize → text caret at the start (materialize) or end (paste run) of the inserted leaf.
- `replace` → selection set explicitly at the inserted node, so the removed placeholder is never referenced (the explicit `selectionAfter` wins over remap, 011 §8.8).

### 4.12 Invariants

1. **Determinism.** `resolveInsertionPoint`, `scopePath`, and the navigation step are pure functions of `(selection, document)`; no DOM reads, no mutation.
2. **Reachability.** For any document and any scope, there exists a caret/gap position at index `0` and at `children.length` of that scope. Doc edges, scope edges, and between-atom slots are all reachable (fixes problems 1, 4, 5).
3. **No stray placeholders.** Inserting onto a disposable-empty paragraph leaves none behind; inserting elsewhere creates none.
4. **Selection always valid after a transaction.** Explicit `selectionAfter` or `mapSelection` relocation; never points at a removed node.
5. **One coordinate, one owner.** A gap and an insertion target are the same `{scope, index}`; position is resolved in exactly one place; every insert path (toolbar, paste, gap-materialize, future drag-drop) reuses it.
6. **Atoms have no interior; containers do.** The caret rests beside an atom (gap) and descends into a container (child scope). Tables are containers; images are atoms.

## 5. Architecture Decisions

### 5.1 Container-Relative Gap `{scope, index}` Over `{node, side}`

Change `GapSelection` from `{ node, side }` to `{ scope, index }`. Reasons:

- It represents an **empty scope** (a fresh callout with no children → `{scope: callout, index: 0}`); `{node, side}` has no anchor node to hang `side` on.
- It represents **doc/scope edges uniformly** (before-first = `{scope, 0}`, after-last = `{scope, len}`) — the positions unreachable today.
- It is **identical to `InsertionPoint.at`**, so a gap *is* an insert target (§4.1), collapsing the gap-insertion resolution row to identity (§4.6).
- It matches the legacy boundary the working implementation used (`container + offset`, [gap-cursor-plugin.tsx:454-465](../packages/editor/src/legacy/plugins/gap-cursor-plugin.tsx#L454-L465)).

Cost: the one in-tree producer (`fallbackSelection`) and the a11y branch change shape; trivial, and there is no persisted gap to migrate (§5.6).

### 5.2 Tables Become Structural Containers (The Fork)

This is the consequential decision, forced by the full-nesting goal (caret inside a cell). Three options:

**Recommended — Promote table/row/cell to structural container nodes.** Add `table`, `tablerow`, `tablecell` to `StructuralNodeType`; a `tablecell` is a scope whose `children` are real blocks (a paragraph leaf by default). A cell then hosts carets, gaps, and inserts with **no new position machinery** — it is "just another scope" (§4.2), exactly the unification the owner asked for ("inside a cell, inside a callout — the same"). Because `TextPoint` is already depth-agnostic (§3.5), the coordinate system does not change; the model simply gains depth.

- Why recommended: one position model for every container; cell editing, cell-gap insertion, and "type above the first-block table" all fall out of the general design instead of a table-specific subsystem. It also matches how the persisted JSON is *already* shaped (`tablerow`/`tablecell`), so the saved document is unchanged (§8) — only the in-memory representation and the renderer change.
- **This is greenfield, not a migration.** The current table is a **render-only stub**: `renderResting` only (no `renderLive`), it sits in `UNCONFIGURABLE_OBJECTS` (no inline config), and there are **zero** table/cell editing commands or cell mutation anywhere in core (verified by grep against `object-block.tsx` and `core/`). No editing behavior depends on the atomic-table representation, so there is nothing to migrate *away from* — we build the structural table from the start. The atomic **bake** the table "loses" is a pass-through of its own JSON that nothing consumes table-specifically; dropping it costs nothing real. This is the lucky timing: doing this *before* a table editor is built is near-free; doing it after would be the painful rewrite §5.2 would otherwise warn about.
- Genuine (small) costs: (a) the *conceptual* revision — this document explicitly amends 011 §8.2's "selection never descends into object internals" to "atoms have no interior; containers do," and reclassifies the table from atom to container (a one-paragraph stance change, not code debt); (b) the table renderer moves from `renderBakedTable` (baked JSON) to a structural render dispatching `EngineBlock` per cell — the recursive structural render docs/018 §2.11 already established for callouts/lists, so the pattern exists; (c) a future very-large table is a structural subtree the body virtualizer does not window — but there is no large-table support today either, so this is a new-feature concern (§11), not a regression.

**Rejected — Object-scope SPI (table stays atomic).** Keep the table an opaque object and add an SPI by which it declares internal scopes and the engine's caret/gap/navigation descends into it via a contract (hit-test, caret slots, internal mutation commands). This *preserves* the atomic-object model and the bake, and is the lighter change to the table renderer. Rejected as the primary path because it forces the **position model** to carry "a position inside an object the engine does not own" — a second class of position alongside `TextPoint`, with its own remap, paint, and serialization. That is precisely the "two sources of truth" complexity 011 §8.1 refused for selection. It is the right tool for a genuinely opaque editable embed (a spreadsheet widget), and it is recorded as the extension point for that future (§11) — but a table is structured content we own, so it should be model nodes.

**Rejected — Keep tables atomic, no cell caret.** Ship doc-edge + between-object gaps and callout/quote scopes, but leave cells uneditable (the docs/018 §2.13/§2.14 "deferred" status). Rejected because the owner explicitly chose full nesting including cells; this is the Phase-1/2 subset, not the end state (and §6 still ships it first).

### 5.3 A Resolver Returning An Intent Union

Replace `insertionIndexAfterSelection: (store) => number` with `resolveInsertionPoint: (store) => InsertionPoint` + a `placeNodes` applier. The union captures *intent* (replace / before / after / split) that a bare index cannot, lives in one pure chokepoint (mirroring transactions and selection-remap), and is O(1). Rejected the minimal "return `index` when `offset===0`" patch: it fixes only the reported bug, leaves replace/gap/split unexpressible, and re-creates per-compiler duplication.

### 5.4 The Disposable-Empty Scope Decision

Replace empty **paragraphs only**, not every empty block (§4.7). An empty heading/quote/list-item is an explicit structural choice a user would be surprised to lose. Conservative default; one-line predicate change to broaden after dogfood. Recorded as a product decision, not inferred behavior.

### 5.5 Split Is Real, But Phase 3

`split` (caret mid-text → break the leaf, insert between halves) is genuine behavior and is specified now so the union is stable, but it needs the mark-clipping / `redirect` machinery `compileSplit` already implements ([commands.ts:309-357](../packages/editor/src/core/commands.ts#L309-L357)) — more wiring and test surface than the Phase 1 fix. Until it ships, a mid-block caret degrades to insert-after.

### 5.6 The Gap Cursor Lives In The Model Selection, Not Ephemeral React State

The legacy held the gap in React state (`GapTarget`, never serialized). In the owned model the **model selection is already the single source of truth** (011 §8.1) and already *has* a `gap` member, so the gap cursor is just a selection value — it remaps on every transaction, survives virtualization, and is painted by the same overlay as the caret. This is strictly simpler than a parallel React state and avoids the legacy's reconciliation listener ([gap-cursor-plugin.tsx:140-169](../packages/editor/src/legacy/plugins/gap-cursor-plugin.tsx#L140-L169)). The gap is still **never persisted** (it is an editing affordance; `compatFromEditorStore` ignores selection), preserving docs/002's "no empty boundary paragraphs in the JSON" invariant.

### 5.7 Scope-Boundary Escape Semantics

When an arrow reaches a scope's edge, the caret must either escape outward or stop. Decision (write it down, like 011 §8.8's caret-landing policy): **a vertical/forward arrow at the last slot of a non-body scope escapes to the parent scope's gap immediately after this container; a backward arrow at the first slot escapes to the gap immediately before it.** Inside a table, horizontal arrows move within a cell and then to the adjacent cell (row-major), and a vertical arrow crosses to the cell above/below by geometry; reaching the table's outer edge escapes to the body gap beside the table. This mirrors the legacy "table keyboard wins inside cells, the nav plugin acts only at the outer boundary" (docs/002 §10) — here expressed through `scopePath` rather than command priority.

### 5.8 The Caret Shape Follows The Gap Axis

The gap cursor is painted as a **horizontal** marker at block-level boundaries and as the **normal vertical** caret at inline-atom boundaries — not one shape globally (§4.9). This is the ProseMirror rule: the gapcursor shape exists only where a normal text selection cannot go (between block nodes), and inline positions keep the ordinary caret.

- Why: our objects (table, image, code, embed) are **block-level and full-width**, so the honest shape for a boundary above/below/between them is a horizontal line spanning the content width; a vertical I-beam has no natural x-position beside a full-width block and reads as a stray "empty line." Conversely, an inline atom (a glossary chip, an inline image inside a line of text) has a genuine vertical boundary, where the normal caret is correct and a horizontal line would be wrong. Both are the same `{scope,index}` selection; only the overlay rect orientation differs, so this is a paint decision, not a model split.
- UX/keyboard: the horizontal marker is unambiguous ("type → new block here") and transient (one keystroke materializes a normal paragraph, so the unfamiliar state never lingers). Keyboard navigation is identical for both shapes because they share the selection state; the shape is purely visual.

**Rejected — the "always keep a real paragraph" (Word/Docs) model.** Instead of any gap cursor, guarantee the document always holds a real (possibly empty) paragraph at the top/bottom and between adjacent atoms, so the caret is always an ordinary text caret. Rejected because it couples **cursor movement to document mutation**: either those empty paragraphs are *persisted* (violates docs/002's "no boundary paragraphs in the JSON" and makes the content-renderer emit blank lines) or they are *synthesized and torn down as the caret moves* (a transaction on mere navigation, polluting dirty state and undo, and destroying docs/002's "abandoning a gap leaves the document unchanged" property). It is the most familiar option but the worst fit for an owned model whose whole premise is that the model is the single source of truth and stays clean and serialization-stable (011 §8.1). The Word *feeling* — click below the last block and type, get a real paragraph — is still delivered by the gap cursor (click → gap → first keystroke materializes), without paying with a mutated document.

## 6. Implementation Strategy

Five phases, each independently reviewable and testable. Phases 1–3 deliver value without the table model change; Phase 4 is the structural-table promotion that unlocks cell carets; Phase 5 is polish.

- **Phase 1 — Positional placement (no caret change).** `InsertionPoint`, `resolveInsertionPoint`, `isDisposableEmpty`, `placeNodes`; rewire `compileInsertObject`/`compileInsertBlocks`; `GapSelection` reshaped to `{scope,index}`; delete `insertionIndexAfterSelection`. Fixes insert problems 1–3. Pure behavior change, no migration, no flag.
- **Phase 2 — The scoped gap cursor.** Paint the gap; produce it from click and from navigation crossing an atom; materialize it; scope-aware navigation with descend/escape for **structural** scopes (body, callout, quote) and *beside-atom* gaps. Fixes problems 4–7 for everything except table cells.
- **Phase 3 — Mid-text split.** `splitLeafAt` factored from `compileSplit`; resolver emits `split`; `placeNodes` split branch.
- **Phase 4 — Tables as structural containers.** Add `table`/`tablerow`/`tablecell` structural types; structural table renderer; compat in/out mapping (JSON shape unchanged); cells become scopes — cell carets, cell gaps, cell inserts all work via the Phase 2 machinery with zero new position code. Fixes problem 8.
- **Phase 5 — Polish.** Goal-column across gaps, touch gap placement, nested-table windowing investigation.

Sequencing rationale: Phase 1 is the bug the user hit and is safe and small. Phase 2 is the bulk of the "aggressive caret" ask and stands alone. Phase 4 is gated behind Phases 1–2 because cell editing is just "scopes work, now tables are scopes."

## 7. Detailed Implementation Plan

### 7.1 The Resolver And Scope Helpers (Phase 1)

Current problem: position is a bare index ignoring offset/empty/gap (§3.3.1-3).

Target: `resolveInsertionPoint` (§4.6), `isDisposableEmpty` (§4.7), and the `scopePath`/`activeScope` helpers (§4.4).

Tasks:

- [ ] Add `InsertionPoint` and reshape `GapSelection` to `{scope,index}` in `model.ts`; export from `core/index.ts`.
- [ ] Implement `isDisposableEmpty` with the inline-atom guard.
- [ ] Implement `scopePath`/`activeScope` (walk `parentEntry().parent`).
- [ ] Implement `resolveInsertionPoint` per §4.6 (the pure resolver assumes a collapsed selection; ranges are handled in the compiler, §7.8).
- [ ] Update `fallbackSelection` and the overlay a11y branch to the new gap shape.

Tests: `tests/editor/engine-insertion-point.test.ts` (new) — table-driven over §4.6 rows; `engine-scope-path.test.ts` for `scopePath` over a body→callout→leaf fixture.

### 7.2 The `replace` Application Path (Phase 1)

Current problem: no way to consume the empty block the caret sits on (§3.3.3).

Target: `placeNodes` handles `replace` as remove+insert at the vacated index (§4.8).

Tasks:

- [ ] Implement `placeNodes` (§4.8).
- [ ] Compilers set explicit `selectionAfter` at the inserted node.

Tests: in `engine-insertion-point.test.ts` (assert resulting order + selection + single-undo reversal).

### 7.3 Rewiring The Insert Compilers (Phase 1)

Target: both compilers resolve-then-place.

Tasks:

- [ ] `compileInsertObject`: build node as today, then `resolveInsertionPoint` → `placeNodes` → node selection.
- [ ] `compileInsertBlocks`: same with the run; keep its end-of-last-leaf caret logic.
- [ ] Delete `insertionIndexAfterSelection`; `rg` to confirm no other callers.

Tests: existing `engine-phase8-integration.test.tsx`, `engine-model.test.ts` pass (update old "+1" assertions).

### 7.4 The Gap Cursor: Paint + Produce + Materialize (Phase 2)

Current problem: gap is unpainted, unproduced, unmaterializable (§3.3.4-6).

Target: §4.9.

Tasks:

- [ ] Port `gapCursorRect` geometry into a pure `view/gap-cursor.ts` (off Lexical); unit-test like `layout.test.ts`.
- [ ] Paint a `gap` selection in `selection-overlay.tsx`: marker between the rects of `children[index-1]` and `children[index]` of `scope`, inset to the scope content box; pin to scope top/bottom at edges.
- [ ] Produce a gap from a click in inter-block whitespace (hit-test the active scope's gaps — legacy Part C).
- [ ] Materialize: on printable key / Enter / paste with a `gap` selection, `placeNodes(at(scope,index))` a `paragraph` (or pasted content), land a text caret.
- [ ] Dismiss on Escape / on reaching a real text slot.

Tests: `tests/e2e/engine-gap-cursor.spec.ts` — click above the first (object) block paints a gap and typing creates a paragraph there; gap between two stacked objects; screenshot. Pure geometry in `tests/editor/gap-cursor.test.ts`.

### 7.5 Scope-Aware Navigation (Phase 2)

Current problem: flat `adjacentTextLeaf` skips atoms and refuses to move with none (§3.3.4/7).

Target: §4.10.

Tasks:

- [ ] Add a scope-aware sibling step: within `activeScope`, next/prev child → real caret (text), gap (atom), or descend (container).
- [ ] At scope edge, produce a scope-edge gap; a further arrow escapes to the parent scope gap via `scopePath` (§5.7).
- [ ] Keep `verticalNavigation`'s geometry probe; on no-text landing, fall to the nearest gap instead of `null`.
- [ ] Retain grapheme/word/line helpers unchanged.

Tests: `tests/editor/engine-scope-nav.test.ts` — arrow from a paragraph across an object lands a gap then the next block; arrow into a callout descends; arrow at callout edge escapes; first/last-block object reachable.

### 7.6 Tables As Structural Containers (Phase 4)

Current problem: cell content is opaque JSON; no cell caret (§3.3.8).

Target: §5.2 recommended option.

Tasks:

- [ ] Add `table | tablerow | tablecell` to `StructuralNodeType`; a default `tablecell` holds one empty `paragraph`.
- [ ] Replace `renderBakedTable` with a structural table render that dispatches `EngineBlock` per cell (reuse the docs/018 §2.11 recursive structural render); keep the `RichTextTable`/`Row`/`Cell` chrome from `@idco/ui`.
- [ ] Compat in/out: map persisted `{type:"tablerow"/"tablecell", children:[{text}]}` ↔ structural nodes with `TextLeafNode` children; **the saved JSON shape is unchanged** (§8).
- [ ] Remove the table from the atomic-object bake path; the `table`/`editor-table` *views* become structural, not `registerNodeView` object views (the insert affordance moves to a structural insert).
- [ ] Cells inherit Phase-2 scope behavior automatically (carets, gaps, inserts) — verify, do not re-implement.

Tests: `tests/editor/engine-table-structural.test.ts` (round-trip JSON ↔ model; cell holds a real leaf; caret addressable inside a cell); `tests/e2e/engine-table-edit.spec.ts` (type in a cell; insert a block in a cell; gap above a first-block table → type a paragraph above it — the reported screenshot).

### 7.7 The `split` Variant (Phase 3)

Tasks:

- [ ] Factor `splitLeafAt(tr, store, point)` out of `compileSplit` (shared mark-clip + `redirect`).
- [ ] `placeNodes` split branch inserts between head and tail.
- [ ] Resolver mid-block row emits `split`.

Tests: mid-block rows in `engine-insertion-point.test.ts`; an e2e typing then inserting a divider mid-paragraph (head/divider/tail, marks intact).

### 7.8 Range Selections

Target: a non-collapsed text selection deletes then re-resolves (§4.6 range row).

Tasks:

- [ ] In the compilers, detect a non-collapsed `text` selection, run `deleteRange` (as `compileSplit` does, [commands.ts:323-325](../packages/editor/src/core/commands.ts#L323-L325)), then `resolveInsertionPoint` from the collapsed caret. Keep the resolver pure (collapsed-only).

Tests: select a word, insert a divider → word gone, divider at the caret.

## 8. Migration And Rollout

- **No persisted-data migration for selection or for the table JSON.** The gap cursor is never serialized (§5.6). Table promotion (Phase 4) changes only the in-memory model and the renderer; the saved document keeps the existing `tablerow`/`tablecell`/`text` shape, mapped at import/export. A round-trip test (`engine-table-structural.test.ts`) is the safety net: load a stored table → structural model → export → byte-compatible JSON.
- **No behavior migration either.** Because the current table has no editor, no live mode, and no cell-editing commands (§5.2), Phase 4 does not replace working functionality — it adds the first real table editing on top of a render-only stub. There is no old code path to keep working in parallel and no user-visible behavior to preserve beyond "the table still renders," which the round-trip + render tests cover.
- **No feature flag.** Phases 1–3 are pure improvements covered by gates. Phase 4 is larger; if desired it can sit behind a one-line `TABLES_STRUCTURAL` constant during rollout, removed once the round-trip suite and `engine-table-edit.spec.ts` are green — but the JSON stability means even a mixed deployment reads the same documents.
- **Deletion criteria.** `insertionIndexAfterSelection` removed in Phase 1 (`rg` returns nothing). `renderBakedTable` and the table object views removed in Phase 4. The legacy `gap-cursor-plugin.tsx` stays (it serves the legacy editor) but is no longer the reference once `view/gap-cursor.ts` lands.
- **Backward behavior.** End-of-block / node / gap-after inserts resolve to the same index as today; only start-of-block, empty-paragraph, gap, and range carets change — all in the intended direction.

## 9. Edge Cases And Failure Modes

- **Empty document (one empty paragraph).** Caret in it is disposable-empty → `replace`; the inserted block becomes the sole block. Remove+insert in one tx tolerates the transient.
- **Replace would empty a scope, then bake fails.** `insert-object` bakes before building the tx; an unbakeable object still yields an `invalid`-status node, so `placeNodes` always inserts something — a scope is never left empty by a failed bake.
- **Empty callout / empty cell.** A scope with no children paints its gap at `{scope, 0}` (the empty-scope case `{node,side}` could not express). Typing materializes a paragraph inside it.
- **Gap at scope edge vs parent escape.** A single arrow rests at the scope-edge gap; a second escapes to the parent scope gap (§5.7) — never silently jumps two scopes.
- **`parentEntry` returns null** (stale node mid-race). Resolver falls back to `at(bodyId, order.length)` (append); navigation falls to the nearest valid slot. Never throws.
- **Node selection on the first block.** Resolves to after it; to insert before the first object, use the leading gap (`{body, 0}`), which is now reachable (invariant §4.12.2).
- **Range spanning scopes.** `deleteRange` collapses block-atomically (010 §6.5); resolve proceeds from the collapsed caret.
- **Very large table (Phase 4).** A 10k-row structural table is one body block whose children are not windowed by the body virtualizer; render cost is real. Documented as a Phase-5/future concern (nested windowing, §11), not solved here. The atomic-bake path that previously bounded this is the trade named in §5.2.
- **Undo after replace / after gap-materialize.** Single undo reverses atomically (one transaction). Guarded by tests (R1-C, R2-C).
- **Table keyboard vs scope nav.** Inside a cell, horizontal/vertical arrows move within/between cells; only the table's outer edge escapes to the body (§5.7). Tab/Shift-Tab cell traversal is Phase 4/5 polish.

## 10. Implementation Backlog

### R1-A. Resolver, Scope Helpers, Gap Reshape (Phase 1)

Scope: `packages/editor/src/core/model.ts`, `packages/editor/src/core/commands.ts` (or new `core/insertion.ts`), `packages/editor/src/core/index.ts`, `packages/editor/src/core/store.ts`, `packages/editor/src/view/selection-overlay.tsx`.

Tasks:

- [ ] `InsertionPoint` union; reshape `GapSelection` → `{scope,index}`.
- [ ] `isDisposableEmpty`, `scopePath`, `activeScope`.
- [ ] `resolveInsertionPoint` (§4.6); update `fallbackSelection` + a11y branch.

Acceptance criteria: every §4.6 row returns the specified `InsertionPoint`; helpers are pure (no DOM/mutation).

Tests: `tests/editor/engine-insertion-point.test.ts`, `engine-scope-path.test.ts` (registered in `tests/all.test.ts`).

### R1-B. `placeNodes` + Rewire Compilers (Phase 1)

Scope: `packages/editor/src/core/commands.ts`.

Tasks: `placeNodes` (§4.8); rewire `compileInsertObject`/`compileInsertBlocks`; range delete-then-resolve (§7.8); delete `insertionIndexAfterSelection`.

Acceptance criteria: caret at start of first block, insert TOC → TOC is `order[0]`; caret in empty paragraph, insert image → paragraph gone, image in its place; end/node/gap-after unchanged.

Tests: existing integration suites pass with updated assertions.

### R1-C. Insertion Integration + Undo Guard (Phase 1)

Tasks: replace-empty then one undo restores it; range-select then insert deletes selection and places at caret.

Acceptance criteria: one `undo()` fully reverses a replace-insert.

Tests: `engine-insertion-point.test.ts`.

### R1-D. Top-Of-Document Reachability E2E (Phase 1)

Tasks: in the phase-8 story, caret at start of first block, Insert → TOC, assert TOC is the first block; screenshot.

Acceptance criteria: inserted block is `order[0]`; former first block is `order[1]`.

Tests: Playwright (chromium; webkit/firefox via CI).

### R2-A. Gap Cursor Paint + Geometry (Phase 2)

Scope: new `packages/editor/src/view/gap-cursor.ts`, `packages/editor/src/view/selection-overlay.tsx`.

Tasks: port `gapCursorRect`; paint a `gap` selection; pin at scope edges.

Acceptance criteria: a `gap` selection renders a visible blinking marker in the correct gap; correct at doc top/bottom and between two objects.

Tests: `tests/editor/gap-cursor.test.ts` (pure geometry); visual e2e in R2-B.

### R2-B. Gap Produce + Materialize (Phase 2)

Scope: `selection-overlay.tsx`/pointer handling, `owned-model-editor.tsx`, input controller.

Tasks: click-in-whitespace → gap; Enter/printable/paste → materialize via `placeNodes`; Escape dismiss.

Acceptance criteria: click above a first-block object → gap → typing creates a paragraph above it; same between two stacked objects.

Tests: `tests/e2e/engine-gap-cursor.spec.ts` (+ screenshot).

### R2-C. Scope-Aware Navigation (Phase 2)

Scope: `packages/editor/src/view/navigation.ts`.

Tasks: scope-aware sibling step (caret/gap/descend); scope-edge gap + parent escape; vertical fallback to gap.

Acceptance criteria: arrow across an object lands a gap then the next block (no vanish, no refuse); arrow into/out of a callout descends/escapes; first/last-block object reachable.

Tests: `tests/editor/engine-scope-nav.test.ts`.

### R3-A. Mid-Text Split (Phase 3)

Scope: `packages/editor/src/core/commands.ts`.

Tasks: factor `splitLeafAt`; `placeNodes` split branch; resolver emits `split` mid-block.

Acceptance criteria: caret mid-paragraph, insert divider → head / divider / tail with marks intact.

Tests: `engine-insertion-point.test.ts` mid-block rows + e2e.

### R4-A. Tables As Structural Containers (Phase 4)

Scope: `packages/editor/src/core/model.ts`, `packages/editor/src/core/compat.ts`, `packages/editor/src/core/payload-import.ts`, `packages/editor/src/view/object-block.tsx` → structural render, `packages/editor/src/view/react-view.tsx`.

Tasks: add `table`/`tablerow`/`tablecell` structural types; structural renderer (reuse §2.11 recursive render + `@idco/ui` table chrome); compat round-trip (JSON unchanged); remove table from the object bake path; verify cell scopes inherit Phase-2 behavior.

Acceptance criteria: table JSON round-trips byte-compatibly; a cell holds a real `TextLeafNode`; a caret is addressable inside a cell; typing/inserting in a cell works; a gap above a first-block table accepts a typed paragraph above it (the screenshot).

Tests: `tests/editor/engine-table-structural.test.ts`, `tests/e2e/engine-table-edit.spec.ts`.

## 11. Future Backlog

- **Object-scope SPI** for genuinely-opaque editable embeds (a spreadsheet/diagram widget) — the rejected §5.2 option, kept as the extension point for content the engine does *not* own.
- **Nested windowing** for very large structural containers (10k-row tables) — the trade named in §5.2; needs the body virtualizer to window a subtree, or the container to declare an estimated height (the [node-view.ts:54-66](../packages/editor/src/view/node-view.ts#L54-L66) seam, reframed for structural nodes).
- **Touch gap placement** and **goal-column across gaps** (Phase 5).
- **Tab/Shift-Tab cell traversal** and table row/column ops via the structural model.
- **Broaden disposable-empty** to heading/quote/list-item if dogfood asks (§5.4).
- **Drag-and-drop block insertion** — a drop pixel maps to a selection via `caretPositionFromPoint` (011 §8.3), then reuses `resolveInsertionPoint`. No new placement logic.

## 12. Definition Of Done

- `resolveInsertionPoint`, `isDisposableEmpty`, `placeNodes`, `scopePath`, `InsertionPoint`, and the `{scope,index}` `GapSelection` exist; `insertionIndexAfterSelection` is deleted with no callers.
- Both insert compilers route through the resolver; non-collapsed ranges delete-then-resolve.
- The reported bug is fixed: caret at the start of the first block inserts at body index 0; the empty-paragraph-replace gesture leaves no stray line.
- The gap cursor is painted, produced by click and by navigation crossing an atom, and materializable; the caret can rest above the first block, below the last block, and between two objects, and typing there creates content in the right place.
- The gap marker is **horizontal at block-level boundaries and the normal vertical caret at inline-atom boundaries** (§4.9, §5.8); both are the same `{scope,index}` selection. The "always keep a real paragraph" model is not used — navigation never mutates the document, and no boundary paragraph is persisted.
- Scope-aware navigation descends into and escapes from structural scopes; no arrow ever leaves an invisible/refused caret.
- (Phase 4) Tables are structural containers; cells host carets, gaps, and inserts; table JSON round-trips unchanged.
- New suites (`engine-insertion-point`, `engine-scope-path`, `gap-cursor`, `engine-scope-nav`, and Phase-4 `engine-table-structural`) are registered in `tests/all.test.ts`; e2e (`engine-gap-cursor`, Phase-4 `engine-table-edit`) pass on chromium.
- `pnpm format`, lint, `pnpm typecheck`, the vitest aggregator, and `pnpm build` are green.
- This document is updated if any decision changes during implementation (notably §5.2 table promotion and §5.4 disposable scope).

## 13. Final Model

Editing is positional, and a position is relative to a scope. Every place the caret can be is one coordinate — a text point in a leaf, a node selected whole, or a gap `{scope, index}` between a container's children — and that gap coordinate is *identical* to where a new block is inserted, so the gap cursor and the insertion point are the same thing. `resolveInsertionPoint` maps any selection to `at` / `replace` / `split`; the gap cursor is painted, reachable by click and arrow, and materializes through the same `placeNodes`; navigation descends into and escapes from nested scopes. A scope is any container — the body, a callout, a quote, and (by promoting tables from atomic objects to structural nodes) a table cell — so "insert in a cell" and "insert in a callout" are one operation, not two. The change reuses the existing transaction and selection-remap contracts, adds no persisted data and no document-format change, and is sequenced so the reported insert bug ships first (Phase 1), the aggressive doc-edge/between-object caret next (Phase 2), and full cell editing once tables are scopes (Phase 4).
