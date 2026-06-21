# 021 - The Structural Node SPI: A Symmetric Core Half For Container Nodes

> Status: design + as-built record (steps 1-2 implemented 2026-06-21; the extension surface is pre-implementation design). Pure design and rationale; no backlog, tickets, or phases — the execution sequence across this document and docs/022 lives in one shared tracker, not here.
>
> Date: 2026-06-21
>
> This document fixes the contract for *structural* nodes — containers that own engine-navigable block children (a callout, a list, a quote, and the future table) — the way docs/016 fixed it for *object* nodes. Where docs/016 made atomic objects pluggable end to end (persist, bake, render, round-trip) through one `registerNode` call, this document does the same for structural containers: it gives them a framework-free core half (`StructuralDefinition`) symmetric to the object `NodeDefinition`, so a structural type owns its insert and its compat round-trip without a per-type branch welded into core.
>
> Scope:
>
> - `packages/editor/src/core/structural-registry.ts` — the new framework-free `StructuralDefinition` and its registry (created in this work).
> - `packages/editor/src/view/structural-view.ts` — the existing React half (`StructuralNodeView`), the structural twin of `NodeView`.
> - `packages/editor/src/view/node-view.ts` — `registerNode`, the single registration front that now routes a structural type's two halves.
> - `packages/editor/src/core/compat.ts` — the compat boundary, now registry-driven for structural import (was a hardcoded `if (node.type === "callout")` switch).
> - `packages/editor/src/core/commands/objects.ts`, `packages/editor/src/core/commands/index.ts` — the generic `insert-structural` command compiler and the command union.
> - `packages/editor/src/core/model.ts` — `StructuralNode`, the closed `StructuralNodeType` union that the extension surface (§8.1) opens.
>
> Relationship to the other docs:
>
> - **docs/011 owns the foundation; this document realizes one more part of it.** 011 §2 (the normalized node graph), §2.3 (the node-kind master table: structural nodes own `children: NodeId[]`), and §6 (mutation through invertible steps) specify what a structural node *is*. This document is the runnable contract for adding one. Where this document and 011 disagree on a foundation detail, 011 wins.
> - **docs/016 is the object twin.** This document mirrors 016's two-registry, `core`/`view` split (§3 there) for the structural kind. The two SPIs are deliberately different *shapes* (an object paints a baked snapshot and sequesters opaque internals; a structural container wraps engine-rendered children and participates in caret geometry) but register through the **same** `registerNode` front (§6.3).
> - **docs/019 owns the positional model this builds on, and this document generalizes its Phase 4.** 019 §5.2 decided tables become structural containers and 019 §7.6 sketched the table-specific way to get there ("add `table`/`tablerow`/`tablecell` to `StructuralNodeType`; map compat by hand"). This document replaces that ad-hoc union extension with a registry-driven SPI, so the table — and any future container — is a *consumer* of one contract rather than a fresh set of hardcoded core branches. The table feature itself is docs/022.
> - **docs/020 is the refactor that made this clean.** 020 split the god-files and curated the public surface; the structural *view* registry (`structural-view.ts`) is its work. This document adds the missing *core* half.
>
> Assumptions:
>
> - Scope membership is structural-by-kind. `childrenOf` (`core/commands/shared.ts`) already treats every `kind === "structural"` node as a scope (docs/019 §4.2); there is no per-type `isScope`, and this document does not add one (§8.3).
> - The persisted compat JSON shape is the contract boundary, not the runtime model. A structural type's `fromCompatNode` imports the legacy shape; export is already generic over `attrs` + `children` (`compat.ts`), so a registered structural type round-trips with no export change.
> - `TextPoint` is depth-agnostic (docs/019 §3.5): a caret addresses a leaf at any tree depth, so adding structural depth (a callout's paragraph, a cell's paragraph) needs no change to the coordinate system.

## Table Of Contents

- [1. Purpose](#1-purpose)
- [2. Why This Document Exists Now](#2-why-this-document-exists-now)
  - [2.1 The Asymmetry Before This Work](#21-the-asymmetry-before-this-work)
  - [2.2 The Ad-Hoc Alternative docs/019 Would Have Taken](#22-the-ad-hoc-alternative-docs019-would-have-taken)
- [3. The Core/View Boundary, Restated For Containers](#3-the-coreview-boundary-restated-for-containers)
- [4. Scope: What This SPI Covers And What Stays Closed](#4-scope-what-this-spi-covers-and-what-stays-closed)
- [5. The Lifecycle Of A Structural Container](#5-the-lifecycle-of-a-structural-container)
- [6. The SPI Shape](#6-the-spi-shape)
  - [6.1 StructuralDefinition — The Framework-Free Half](#61-structuraldefinition--the-framework-free-half)
  - [6.2 StructuralNodeView — The React Half](#62-structuralnodeview--the-react-half)
  - [6.3 registerNode — One Front, Two Kinds](#63-registernode--one-front-two-kinds)
  - [6.4 Required vs Optional Slots](#64-required-vs-optional-slots)
- [7. The As-Built Baseline (Steps 1-2)](#7-the-as-built-baseline-steps-1-2)
  - [7.1 Registry-Driven Compat Import](#71-registry-driven-compat-import)
  - [7.2 The Generic insert-structural Command](#72-the-generic-insert-structural-command)
  - [7.3 Callout Migrated: Core Has Zero Callout Knowledge](#73-callout-migrated-core-has-zero-callout-knowledge)
- [8. The Extension Surface For Rich Containers](#8-the-extension-surface-for-rich-containers)
  - [8.1 Opening The StructuralNodeType Union](#81-opening-the-structuralnodetype-union)
  - [8.2 Generic Structural-Child Commands](#82-generic-structural-child-commands)
  - [8.3 The Deliberate Non-Extensions](#83-the-deliberate-non-extensions)
- [9. Worked Example: A Synthetic Container That Is Not The Table](#9-worked-example-a-synthetic-container-that-is-not-the-table)
- [10. The Guardrail: How This SPI Stays Clean](#10-the-guardrail-how-this-spi-stays-clean)
- [11. Verification](#11-verification)
- [12. Open Decisions](#12-open-decisions)
- [13. Final Model](#13-final-model)

---

## 1. Purpose

Define the single contract an author implements to add a *structural container* node to the owned-model engine and have it work end to end: insert at the caret, hold engine-rendered block children, render live and at rest, round-trip the compat boundary, and participate in scope navigation — without editing engine internals. This is the structural twin of docs/016's object SPI, and the precondition that lets the live table (docs/022) be a consumer of one contract rather than a fresh pile of table-specific core branches.

The thesis is the same one docs/016 stated for objects: "blog now, books later, custom nodes easy" is only cheap if there is one place to register a node and one contract it satisfies. Before this work that place existed for objects and for the *view* half of structural nodes, but not for the *core* half of a structural node. A structural type could render but could not own its insert or survive save/load without a hand-written branch in `core/`. This document is the contract that closes that gap, and §7 records the half already built against it.

## 2. Why This Document Exists Now

### 2.1 The Asymmetry Before This Work

The engine had three extension stories of unequal completeness, the same inconsistency docs/016 §2.1 named for objects, now seen one layer further along:

| Node family | Core (persist/insert) half | View (render) half | Pluggable end to end? |
| --- | --- | --- | --- |
| Object / heavy nodes | `NodeDefinition` registry (`core/registry.ts`), registry-driven compat | `NodeView` registry (`view/node-view.ts`) | Yes — one `registerNode`, no core edits (docs/016) |
| Structural containers | **none** — insert was a bespoke `insert-callout` command; compat was a hardcoded `if (node.type === "callout")` branch | `StructuralNodeView` registry (`view/structural-view.ts`) | **No — view only** |
| Text leaves, mark kinds | closed unions welded to the per-leaf DSA | — | No, deliberately (docs/016 §4) |

The object row was symmetric: a core half and a view half, paired by `type`, both registry-driven. The structural row was lopsided: a real view registry, but a core half that lived as welded branches. The built-in callout "cheated" off those branches — it leaned on the hardcoded `insert-callout` compiler and the `callout` compat arm — so it looked pluggable while a genuinely new structural type was not. That asymmetry is the whole reason this document exists: to give the structural kind the same symmetric core half the object kind already had.

### 2.2 The Ad-Hoc Alternative docs/019 Would Have Taken

docs/019 §7.6 (the table phase) proposed the minimal, table-specific route to a structural table: "add `table`/`tablerow`/`tablecell` to `StructuralNodeType`; replace `renderBakedTable` with a structural render; map the persisted JSON by hand at import/export." That is correct and would work, but it pays for the table by adding three more hardcoded compat branches and one more bespoke insert path — the exact welded-core shape §2.1 calls the problem. Do it again for the next container (a columns layout, a disclosure, a card deck) and the welds multiply.

This document takes the other route, the one docs/016 took for objects: build the registry once, and every container after the first is a registration, not a core edit. The table then validates the contract as its second differently-shaped consumer (after callout), which is the only way to know the contract generalizes — a contract with one consumer is a contract shaped by one example.

## 3. The Core/View Boundary, Restated For Containers

The split is the same boundary docs/016 §3 proved for objects, and it is non-negotiable for the same two reasons: `core/**` may not import React (the Phase 1 lint), and `core/bake.worker.ts` requires core functions to survive structured clone. So a structural type's contract splits across two homes, keyed by the same `type` string:

- **`StructuralDefinition`** lives in `core/structural-registry.ts` — framework-free, worker-safe: how the container's initial subtree is built on insert, and how it imports from the compat boundary.
- **`StructuralNodeView`** lives in `view/structural-view.ts` — React: how the container renders its already-rendered children live (editing surface) and at rest (published page), and its insert-menu affordance.

The asymmetry with the object contract is intentional and is the point of having two SPIs rather than one. An object's core half owns `bake`, `plainText`, `applyEdit` — the machinery of an opaque payload the engine paints as a snapshot. A structural container has no opaque payload and no bake: its content *is* engine nodes the recursive renderer already walks. So its core half owns the two things an object's does not need — how to seed the child subtree, and how to import a nested child tree from compat — and nothing else. Two contracts, one registration front (§6.3).

## 4. Scope: What This SPI Covers And What Stays Closed

**Covered: structural container nodes.** Callout, quote, list (today), the table (docs/022), and any future container whose children are engine-navigable blocks. The SPI lets such a type declare its insert subtree and its compat import, register both halves in one call, and inherit scope navigation, gap-cursor placement, selection, and deletion generically by `kind === "structural"` (docs/019 §4.2).

**Not covered, and deliberately so: the text DSA and the caret core.** Text leaves, mark kinds, and the position primitive stay closed for the reasons docs/016 §4 gave — they are welded to the input/caret core and 011's per-leaf DSA. A structural container composes leaves; it does not redefine them.

**Not covered: navigation behavior.** A container does not get to define how the caret moves through it. Navigation stays generic (scope-stepping plus a geometric vertical probe), per docs/019 §4.10. This is a considered non-extension, not an omission; §8.3 argues why a per-type navigation hook would be the wrong shape.

**The one barrier this document's extension surface removes: the closed type union.** Today `makeStructuralNode` is typed to `StructuralNodeType = "body" | "list" | "listitem" | "quote" | "callout"` (`core/model.ts`). A genuinely new container type cannot be constructed without opening that union; §8.1 is that change. Everything else a new container needs is already registry-driven (§7).

## 5. The Lifecycle Of A Structural Container

One container, observed across its full cycle, each stage naming the slot responsible. Contrast docs/016 §5 (the object lifecycle) line by line: the stages are the same words, the slots are different because a container has children, not a baked payload.

1. **Born — from an insert command** (`StructuralDefinition.createSubtree`) **or from compat import** (`StructuralDefinition.fromCompatNode`). Both produce the container node plus its initial descendant subtree (e.g. a callout wrapping one empty paragraph; a cell wrapping one empty paragraph).
2. **Placed** — the generic `insert-structural` command resolves the positional insertion point (docs/019 §4.6) and lands the whole subtree atomically on one `insert-node` step (§7.2).
3. **Rendered live** — `StructuralNodeView.renderContainer` wraps the engine-rendered children with the editing chrome (the callout box, the future `<table>` grid). The children come pre-rendered by the recursive `EngineBlock`; the container only arranges them.
4. **Navigated** — the caret descends into the container and walks its children as scopes, generically (docs/019 §4.10). The container declares nothing for this.
5. **Edited (its container shape)** — child structure changes through generic commands: `set-block-attr` for the container's own attrs (a callout's tone, a table's `colWidths`), and the generic structural-child commands (§8.2) for adding/removing children. The container declares no bespoke command.
6. **Rendered at rest** — `StructuralNodeView.renderResting` projects the same container to the published page (the DaisyUI alert, the semantic `<table>`), co-located with the live render so the two cannot drift (docs/020 §3.7).
7. **Exported** — generic. `compat.ts` spreads the node's `attrs` and recurses its `children`; a container needs no `toCompatNode` unless its export shape diverges from "attrs plus children" (none does today).

Stages 1, 2, 7 are `StructuralDefinition` (core). Stages 3, 6 are `StructuralNodeView` (view). Stages 4, 5 are generic engine behavior the container inherits for free. The split is exactly §3's boundary.

## 6. The SPI Shape

### 6.1 StructuralDefinition — The Framework-Free Half

The contract as built (`core/structural-registry.ts`). Two methods, because a container has exactly two core concerns docs/016's object contract does not cover: seed a child subtree, and import a child tree.

```ts
// core/structural-registry.ts — no React, worker-safe.
export type StructuralDefinition = {
  readonly type: string;

  // Build the initial subtree for the generic `insert-structural` command:
  // the container root, its already-built descendants, and the optional leaf
  // to land the caret in at offset 0.
  createSubtree(allocator: IdAllocator): StructuralSubtree;

  // Import a legacy compat node into attrs + child ids (registry-driven import,
  // the structural twin of NodeDefinition.fromCompatNode). The engine injects a
  // context carrying the compat recursion machinery so the definition decides
  // *which* attrs/children to keep without owning the document walk.
  fromCompatNode(node: RichTextCompatNode, ctx: StructuralCompatContext): StructuralCompatResult;
};

export type StructuralSubtree = {
  readonly root: StructuralNode;
  readonly descendants: readonly EditorNode[];
  readonly caret?: NodeId;        // a descendant (or root) to put the caret in
};

export type StructuralCompatResult = {
  readonly attrs?: JsonObject;
  readonly children: readonly NodeId[];
};

export type StructuralCompatContext = {
  readonly allocator: IdAllocator;
  importChildren(children: readonly RichTextCompatNode[] | undefined): readonly NodeId[];
  hasBlockChildren(children: readonly RichTextCompatNode[] | undefined): boolean;
  importInlineAsParagraph(node: RichTextCompatNode): readonly NodeId[];
  pickAttrs(node: RichTextCompatNode, keys: readonly string[]): JsonObject | undefined;
};
```

The `ctx` is the design decision that keeps the boundary honest. A structural container's import is recursive — its children are themselves nodes that must be imported — and that recursion engine lives at the compat boundary (`importCompatNode` in `compat.ts`), not in a registry file. Rather than export the whole importer into core's registry (a dependency cycle) or duplicate it per type, the engine hands the definition a context of exactly the primitives a container import needs. The definition stays declarative ("keep `tone`; import block children, else wrap inline as a paragraph") while the walk stays where it belongs. This mirrors how the object `BlockRegistry.normalizeCompatObject` leans on `compat.ts` for the document walk (docs/016 §6.1).

There is deliberately no `toCompatNode` and no `bake`. Export is generic over `attrs` + `children` (§5 stage 7), and a container has no baked snapshot — its children are live nodes. Adding either slot now would be unread code; the rule (docs/016 §6.3, restated in §10) is to name a slot only when a consumer needs it.

### 6.2 StructuralNodeView — The React Half

Unchanged by this work; documented here for symmetry (full shape in `view/structural-view.ts`).

```ts
// view/structural-view.ts — React allowed. Keyed by the same `type`.
export type StructuralNodeView = {
  readonly type: string;
  renderContainer(args: StructuralContainerArgs): ReactNode;   // live editing surface
  renderResting(args: StructuralRestingArgs): ReactNode;       // published page
  readonly insert?: StructuralNodeViewInsert;                  // insert-menu affordance
};
```

`renderContainer` receives the already-rendered `children` and a `registerBlock` callback to bind the measured container element for virtualization and hit-testing; `renderResting` receives the resolved child nodes plus two child-rendering strategies (`renderSequence`, `renderListItems`) so it composes children without importing the engine. The `insert.createCommand()` returns the generic `{ type: "insert-structural", structuralType }` (§7.2).

### 6.3 registerNode — One Front, Two Kinds

A node is either an object (`view` + optional `definition`) or a structural container (`structuralView` + optional `structuralDefinition`); never both. `registerNode` (`view/node-view.ts`) routes each half to its registry and asserts the paired halves agree on `type`:

```ts
// object node
registerNode({ definition: mathDefinition, view: mathView });
// structural container
registerNode({ structuralView: calloutView, structuralDefinition: calloutDefinition });
```

The assertions are the persistence/render contract made executable: an object's `definition.type` must equal its `view.type`, a container's `structuralDefinition.type` must equal its `structuralView.type`, and passing both an object half and a structural half is a registration error. Built-in cores (callout today) are registered through the core's built-in list rather than this front (§7.3), exactly as built-in object cores live in `BUILT_IN_OBJECT_DEFINITIONS`; the `structuralDefinition` argument is the path a *custom* or *new* container uses.

### 6.4 Required vs Optional Slots

Per the SPI-first discipline (docs/016 §6.3): name the whole cycle, require only what a visible, persistent container cannot do without.

| Slot | Required? | Fallback when omitted |
| --- | --- | --- |
| `StructuralDefinition.type`, `createSubtree`, `fromCompatNode` | Required for an insertable, persistent container | — |
| `StructuralNodeView.type`, `renderContainer`, `renderResting` | Required for a visible container | the default stacking container (a plain `<div>`) |
| `StructuralNodeView.insert` | Optional | the type is not offered in the insert menu |
| container attrs (tone, colWidths, …) | Optional, generic | none; read via `node.attrs` in the views, written via `set-block-attr` |

A type may register only a `structuralView` (render-only, no insert, no custom compat) — that is the pre-this-work capability, still valid for a container that round-trips through an existing compat arm. A type that must own its insert and persistence registers both halves.

## 7. The As-Built Baseline (Steps 1-2)

This section records what is already implemented against the §6 contract, so the document is a true picture and not only a proposal. It is the proof the contract is real: the built-in callout was migrated onto it until core retained no callout-specific knowledge.

### 7.1 Registry-Driven Compat Import

`compat.ts`'s `importCompatNode` consults the structural registry the same way it consults the object registry. The hardcoded `if (node.type === "callout")` arm is gone; in its place a generic arm asks `getStructuralDefinition(node.type)` and, when one exists, calls its `fromCompatNode` with the injected context, then constructs the node via `makeStructuralNode`. `isBlockChild` (which decides block-vs-inline during import) consults `isStructuralDefinitionType` so any registered container counts as a block child and nests correctly. Export needed no change: it was already generic over `attrs` + `children`. The structural twin of the object path is therefore complete: `getStructuralDefinition`/`isStructuralDefinitionType` mirror `isObjectNodeType`/`normalizeCompatObject`.

`quote`, `list`, and `listitem` keep their hardcoded import arms for now. This is a deliberate boundary, not an oversight: the list family's import does real *flattening* (a nested compat `list` becomes flat `listitem` leaves with a depth attr, docs/018 §2.10), which is a dialect concern that legitimately belongs at the compat boundary, not a "cheat" to remove. Migrating them is opportunistic cleanup (docs/022 does not need it); callout was migrated because it was the clean representative container and the proof the SPI works.

### 7.2 The Generic insert-structural Command

A single command, `{ type: "insert-structural", structuralType: string }`, replaces the bespoke `insert-callout`. Its compiler (`compileInsertStructural`, `core/commands/objects.ts`) looks up the definition, calls `createSubtree(store.allocator)`, resolves the positional insertion point (docs/019 §4.6), and places the whole subtree with `placeSubtree` — one `insert-node` step carrying the descendants so the container and its children register atomically and one undo reverses the lot. When the subtree names a `caret` leaf, the command lands a text caret at offset 0 inside it; otherwise it selects the container whole. `placeSubtree` already carries descendants of arbitrary depth (`core/store/editor-store.ts` registers `[node, ...descendants]` as a flat id set), so a deep container subtree — a table's `table → rows → cells → paragraphs` — rides the same one step a callout's `callout → paragraph` does.

### 7.3 Callout Migrated: Core Has Zero Callout Knowledge

The built-in callout's core half is a `calloutStructuralDefinition` in `structural-registry.ts` (in the built-in list, not registered via the view, mirroring `BUILT_IN_OBJECT_DEFINITIONS`). Its `createSubtree` builds the `callout{tone:info} → paragraph` subtree and names the paragraph as the caret leaf; its `fromCompatNode` keeps the `tone` attr and imports block children, wrapping inline-only content as a paragraph. The callout *view* (`view/nodes/callout.tsx`) now emits `{ type: "insert-structural", structuralType: "callout" }`. After the migration, `core/` contains no `insert-callout` command and no `if (node.type === "callout")` compat branch — callout is, from core's perspective, an ordinary registered container. That is the acceptance bar this baseline met: the contract is proven when the representative consumer needs no special case.

## 8. The Extension Surface For Rich Containers

What a container richer than callout — specifically the table — forces the SPI to add. The discipline is that each addition must be *general* (a different container would use it) and *optional* (callout/quote/list are unaffected). Two additions qualify; a third candidate is rejected (§8.3).

### 8.1 Opening The StructuralNodeType Union

The one remaining barrier. `makeStructuralNode` is typed to the closed `StructuralNodeType` union, so a new `type: "table"` cannot be constructed without a core edit (today the registry-driven import path bridges callout with one `as StructuralNodeType` cast because callout is already a union member; a genuinely new type has nowhere to widen to).

The recommended shape is **a registry-driven open set with the built-ins kept as known literals** — `type StructuralNodeType = "body" | "list" | "listitem" | "quote" | "callout" | (string & {})`. The `(string & {})` widening keeps editor autocomplete and exhaustiveness for the built-ins while admitting any registered type, so existing `switch` sites over the built-ins keep their narrowing and a new container constructs without a cast. This is the structural analogue of how the object kind never closed its `type` to a union at all (`NodeDefinition.type: string`); structural started closed because it was welded to the caret core, and this is the minimal opening that unwelds the *construction* check without touching the *navigation* check (which is by `kind`, not `type`).

Rejected — **promote to a fully open `type: string`.** Drops the built-in literals entirely, losing autocomplete and the exhaustiveness the few built-in `switch` sites rely on, for no gain over the widened union. Rejected — **a runtime registry of allowed types with no compile-time set.** Moves a typecheck to a runtime throw; the widened union gives the same openness with compile-time help. The widened union is the least-surprising change that removes the barrier.

This is the only part of this SPI that is genuinely gated on the table: callout, quote, and list are all already union members, so the SPI's as-built half (§7) needed no opening. The union opens when the first non-member container is built — which is docs/022.

### 8.2 Generic Structural-Child Commands

A container that edits its child structure at runtime — add a row, delete a column, split a cell — needs commands that insert and remove a child of a scope. The wrong shape is table-specific commands (`insert-table-row`) in the core `EditorCommand` union; that is the welded-core smell again. The right shape is a **generic pair** — conceptually `insert-structural-child` (a built node into `{scope, index}`) and `remove-structural-child` (`{scope, index}`) — that any container composes. Both flow through the existing dispatch chokepoint (`EditorStore.dispatch`), so they invert and coalesce like every other command, and both are pure positional operations a callout or a list could use as readily as a table.

The table-specific *logic* then lives in the table feature (docs/022), composed from these primitives: "remove column N" is N `remove-structural-child` operations across the rows, and the grid invariant "every row has the same cell count" is enforced by the table's command-builder, not by core. Core gains two general verbs; the grid semantics stay in the consumer. This is the same division the object SPI uses — `set-object-data` is the generic mutation, the object's meaning of its data is the object's concern.

One core hardening these commands required: selection remap must relocate a caret that sat *deep* inside a removed subtree (a cell's paragraph when its row is deleted), not only one that sat on the removed node itself. `mapSelection` runs after the steps mutate the store, when the removed subtree is already gone and cannot be walked, so the dispatch now records each `remove-node` step's full removed id-set (from the `collectSubtree` it already computes for the inverse) and the remap consults it per step. This fixes every remove path at once (block delete, range delete, and these structural-child removes), and is keyed per step so a multi-remove transaction — a table column delete spanning rows — relocates each caret against the step that removed *its* ancestor. It is general core behavior, not table-specific.

Note that the container's *own* attributes need no new command: a callout's tone, a table's `colWidths`, a cell's `headerState` are all `node.attrs`, written through the existing generic `set-block-attr`. Column resize and header toggle are therefore attr writes, not new commands — a meaningful narrowing of what the table adds to core.

### 8.3 The Deliberate Non-Extensions

Two slots a naive table design would add to the SPI, and why neither should be added.

**No per-type navigation hook.** It is tempting to give `StructuralDefinition` a `navigate(from, direction)` so a container defines its own caret movement (the table would implement 2D grid movement). This is the wrong shape for this engine, because docs/019 §4.10 already chose navigation as a *generic* mechanism: horizontal arrows scope-step through children (already descending into containers — `positionAfterBlock` in `view/navigation.ts` does this today), and vertical arrows use a *geometric* probe (goal column plus caret rects, `text-block.tsx` and `verticalNavigation`). A grid's "down goes to the cell below in the same column" is precisely what a document-level geometric vertical probe produces for free — visual down-movement is visual down-movement whether it crosses paragraphs or cells. The current geometric probe is intra-leaf only and falls back to an order-based block jump, so cross-cell vertical movement is not yet delivered; the fix is to *complete docs/019 §4.10's geometric vertical nav as a document-level probe* (a general improvement that also helps vertical movement across any blocks), not to bolt a table-aware hook onto the SPI. The table consuming generic geometric nav is docs/022's navigation section; the SPI stays free of per-type caret logic.

**No structural self-windowing slot, yet.** A very large container (a 10,000-row table) renders all its children, because the body virtualizer windows top-level blocks and does not window inside a structural subtree (docs/019 §9, §11). This is the structural analogue of the object self-windowing seam (the `node-view.ts` TODO). It is real but it is not on the critical path — most containers are small — and adding the slot before a consumer needs it is the unread-code the rule forbids. It is named here so it is not rediscovered, and deferred to when a container actually needs it (docs/022 §8 records it as a table concern).

## 9. Worked Example: A Synthetic Container That Is Not The Table

The proof that the contract generalizes beyond callout, without the table's weight. A "disclosure" container (a titled, collapsible block holding children) registered entirely from outside core:

```ts
const disclosureDefinition: StructuralDefinition = {
  type: "disclosure",
  createSubtree(allocator) {
    const bodyId = allocator.createNodeId();
    const body = makeTextNode({ id: bodyId, type: "paragraph", content: allocator.createTextSlice("") });
    const root = makeStructuralNode({ id: allocator.createNodeId(), type: "disclosure", attrs: { open: true }, children: [bodyId] });
    return { root, descendants: [body], caret: bodyId };
  },
  fromCompatNode(node, ctx) {
    const children = ctx.hasBlockChildren(node.children) ? ctx.importChildren(node.children) : ctx.importInlineAsParagraph(node);
    return { attrs: ctx.pickAttrs(node, ["open", "summary"]), children };
  },
};

const disclosureView: StructuralNodeView = {
  type: "disclosure",
  renderContainer: ({ node, children }) => <details open={node.attrs?.open !== false}><summary>{String(node.attrs?.summary ?? "Details")}</summary>{children}</details>,
  renderResting: ({ node, children, renderSequence }) => <details open={node.attrs?.open !== false}><summary>{String(node.attrs?.summary ?? "Details")}</summary>{renderSequence(children)}</details>,
  insert: { label: "Disclosure", group: "Blocks", icon: "ChevronRight", createCommand: () => ({ type: "insert-structural", structuralType: "disclosure" }) },
};

registerNode({ structuralView: disclosureView, structuralDefinition: disclosureDefinition });
```

What this exercises with no core edit beyond the union opening (§8.1): insert at the caret (generic `insert-structural`), a child paragraph the caret lands in, block children rendered recursively, scope navigation in and out, the `open`/`summary` attrs written via `set-block-attr`, and a compat round-trip. It needs no bespoke command, no compat branch, no navigation hook. If the disclosure is one file plus one `registerNode` call, the SPI is right — the same bar docs/016 §8 set for `divider`.

## 10. The Guardrail: How This SPI Stays Clean

The user's constraint for this work was that the table must not "uglify" the SPI. The operational test, applied to every candidate addition:

> Would a *different* structural container — a columns layout, a disclosure, a card deck — also need this?

- Yes → it belongs in this SPI (the open union, the generic child commands, the geometric vertical nav). General by construction.
- No, it is about rows/columns/cells/grids → it belongs in the table feature (docs/022), composed from this SPI's primitives.

The failure mode to refuse is a `if (type === "table")` branch reappearing in `core/` — that is the SPI failing, and it is the line docs/022 must not cross. The healthy outcome is the table *extending* this SPI with a new *optional* slot only when the test above says the slot is general; that is the contract learning from its second consumer, exactly as docs/016 §6.3 anticipated for objects ("name now, fill later"). Across §8 the net growth the table forces is small and entirely general: one union opening, one generic command pair, one completion of an already-designed generic nav probe — and explicitly no per-type caret logic.

## 11. Verification

- A structural-fixture test registers a synthetic `StructuralDefinition` + `StructuralNodeView` (the §9 disclosure or the existing `spi-panel` fixture in `tests/editor/engine-structural-spi.test.ts`), inserts it via `insert-structural`, asserts the child subtree and caret landing, navigates in and out, writes an attr, and round-trips it through compat — touching no engine internals. This is the structural twin of docs/016 §11's node-contract test.
- The as-built baseline (§7) is already gated: the full vitest aggregator is green with callout migrated, and the callout insert + compat round-trip tests assert the new command shape and the unchanged persisted JSON.
- When §8.2's generic child commands land, the fixture container exercises them (add/remove a child by `{scope, index}`, one undo reverses), proving they are not table-shaped before the table consumes them.

## 12. Open Decisions

- **The exact widened-union form (§8.1).** `(string & {})` is recommended; confirm it against every `switch` over `StructuralNodeType` (a `grep` enumerates them) so none silently loses exhaustiveness.
- **Whether the generic child commands (§8.2) ship with the table or ahead of it, proven by the fixture.** The SPI-first stance argues for designing them now and landing them just-in-time with the table phase that needs them, validated by §9's fixture so they are general; confirm the trigger.
- **When to migrate quote (and whether to migrate the list family at all).** Quote is a near-clone of callout and is cheap cleanup; the list family's flattening is a legitimate compat-dialect concern that may stay hardcoded. Neither is required by docs/022; both are recorded as opportunistic.
- **Whether to ever open this SPI to third-party authors** (the public union opening, docs/020 §13's "one symmetric Node SPI"). Engine-internal openness is delivered by §8.1; exposing it as a public contract is a further, smaller follow-up to decide once the table has settled the shape.

## 13. Final Model

A structural container is pluggable the way an object already was: one `StructuralDefinition` (core — how to seed its subtree and import it) paired by `type` with one `StructuralNodeView` (view — how to render it live and at rest), registered through the same `registerNode` front, inheriting insert, navigation, selection, and export generically. The half that makes this real is built and proven — callout was migrated onto it until core kept no callout-specific knowledge, the compat import is registry-driven, and insertion is one generic command. What a richer container forces is small and general: open the closed `StructuralNodeType` union to a registry-driven set, add a generic structural-child command pair, and complete the already-designed generic geometric vertical nav — and deliberately *not* a per-type navigation hook, because navigation is a generic mechanism, not a container concern. The table (docs/022) is then a consumer of this contract, not a new pile of core branches, and the line that keeps the contract clean is the one rule: anything table-specific composes the primitives here; nothing table-specific is welded into core.
