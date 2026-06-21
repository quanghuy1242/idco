# 020 - Editor Architectural Refactor: Structural Node SPI, View Decomposition, And Boundary Cleanup

> Status: implementation-grade research and proposal (no code written yet)
>
> Date: 2026-06-21
>
> Scope:
>
> - `/home/quanghuy1242/pjs/idco/packages/editor/src/core/**` — the framework-free engine (model, store, commands, registry, scheduler, compat).
> - `/home/quanghuy1242/pjs/idco/packages/editor/src/view/**` — the React binding (orchestrator, block dispatchers, node views, overlays, chrome).
> - `/home/quanghuy1242/pjs/idco/packages/editor/src/index.ts` — the package public surface.
> - `/home/quanghuy1242/pjs/idco/scripts/oxlint-js-plugins/architecture.js` — the architecture lint that enforces the core/view boundary.
>
> Source docs:
>
> - `docs/010_owned_model_virtualized_editor_plan.md` — the master plan (layers, phasing, §7.1 stack split, §6.4 one-live-object slot).
> - `docs/011_foundation_dsa_owned_model_editor.md` — the foundation DSA (§2.3 node-kind master table, §2.7 sequestered object internals, §6 transactions/steps, §6.8 mutable-store/immutable-nodes).
> - `docs/016_node_spi_and_pluggable_blocks.md` — the object Node SPI this document extends to structural nodes.
> - `docs/019_positional_insertion_model.md` — positional insertion, scopes, the gap cursor, and §5.2 "Tables Become Structural Containers (The Fork)".
>
> Related docs:
>
> - `docs/017_pre_phase_8_plan.md` — the behavior-preserving switch→registry lift this document mirrors for structural nodes.
> - `docs/018_phase_9_polish_and_deferred_parity.md` — structural rendering and list-numbering rules this refactor must preserve.
> - `docs/015_reader_server_native_read_tier.md` — resting-render primitives the structural SPI should eventually route through.
>
> Assumptions:
>
> - The next feature after this refactor is a **table node**, modeled per docs/019 §5.2 as a *structural container* (rows → cells → block children), not the opaque object blob registered today. This document is the prerequisite that makes that feature a registration rather than a switch-arm sprawl.
> - The refactor is **behavior-preserving**. The existing Vitest and Playwright suites are the gate; no user-visible behavior changes in this document's scope.
> - `legacy/` (Lexical) and `spike/` stay frozen. This document touches only the owned-model engine (`core/` + `view/`).

## Table Of Contents

- [1. Goal](#1-goal)
  - [1.1 Non-Goals](#11-non-goals)
  - [1.2 Short Version](#12-short-version)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 Relevant Files](#31-relevant-files)
  - [3.2 What Is Already Right](#32-what-is-already-right)
  - [3.3 Finding A — Two God-Files](#33-finding-a--two-god-files)
  - [3.4 Finding B — The SPI Is Asymmetric: Structural Nodes Are Not Pluggable](#34-finding-b--the-spi-is-asymmetric-structural-nodes-are-not-pluggable)
  - [3.5 Finding C — object-block.tsx Conflates The Dispatcher With The Node Library](#35-finding-c--object-blocktsx-conflates-the-dispatcher-with-the-node-library)
  - [3.6 Finding D — The Public Surface Mixes Legacy And Owned Engine](#36-finding-d--the-public-surface-mixes-legacy-and-owned-engine)
  - [3.7 Finding E — Duplicated Live-vs-Resting Render Logic](#37-finding-e--duplicated-live-vs-resting-render-logic)
  - [3.8 Finding F — Cohesive-But-Large Core Files](#38-finding-f--cohesive-but-large-core-files)
- [4. Target Model](#4-target-model)
  - [4.1 The Node SPI Made Symmetric](#41-the-node-spi-made-symmetric)
  - [4.2 The StructuralNodeView Contract](#42-the-structuralnodeview-contract)
  - [4.3 The View Layer As Orchestrator + Controllers](#43-the-view-layer-as-orchestrator--controllers)
  - [4.4 The Node Library As One-File-Per-Node](#44-the-node-library-as-one-file-per-node)
  - [4.5 Target File Tree](#45-target-file-tree)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 Build The Structural SPI Before The Table Node (Recommended)](#51-build-the-structural-spi-before-the-table-node-recommended)
  - [5.2 Keep EditorStore A Class; Split The File, Not The Type](#52-keep-editorstore-a-class-split-the-file-not-the-type)
  - [5.3 Controllers As Hooks Sharing An Explicit Ref Bag](#53-controllers-as-hooks-sharing-an-explicit-ref-bag)
  - [5.4 Per-Type Metadata Moves Onto The Contract, Not Central Maps](#54-per-type-metadata-moves-onto-the-contract-not-central-maps)
  - [5.5 Curated Public Surface Over `export *`](#55-curated-public-surface-over-export-)
  - [5.6 Rejected And Deferred Options](#56-rejected-and-deferred-options)
- [6. Implementation Strategy](#6-implementation-strategy)
- [7. Detailed Implementation Plan](#7-detailed-implementation-plan)
  - [7.1 Structural Node SPI (Workstream 1)](#71-structural-node-spi-workstream-1)
  - [7.2 object-block.tsx Decomposition (Workstream 2)](#72-object-blocktsx-decomposition-workstream-2)
  - [7.3 react-view.tsx Controller Extraction (Workstream 3)](#73-react-viewtsx-controller-extraction-workstream-3)
  - [7.4 Public Surface Curation (Workstream 4)](#74-public-surface-curation-workstream-4)
  - [7.5 Core File Splits (Workstream 5)](#75-core-file-splits-workstream-5)
- [8. Migration And Rollout](#8-migration-and-rollout)
- [9. Edge Cases And Failure Modes](#9-edge-cases-and-failure-modes)
- [10. Implementation Backlog](#10-implementation-backlog)
  - [R1. Structural Node SPI](#r1-structural-node-spi)
  - [R2. object-block.tsx Decomposition](#r2-object-blocktsx-decomposition)
  - [R3. react-view.tsx Controller Extraction](#r3-react-viewtsx-controller-extraction)
  - [R4. Public Surface Curation](#r4-public-surface-curation)
  - [R5. Core File Splits](#r5-core-file-splits)
- [11. Future Backlog](#11-future-backlog)
- [12. Definition Of Done](#12-definition-of-done)
- [13. Final Model](#13-final-model)

## 1. Goal

Refactor `packages/editor` (the owned-model engine, `core/` + `view/`) into a shape where:

1. **Adding any block — object or structural — is one registration, not engine surgery.** Today objects are pluggable through the Node SPI (docs/016); structural nodes (callout, list, quote, and the forthcoming table) are still hardcoded `switch (node.type)` arms scattered across four view files. This document makes the SPI symmetric so a structural node is registered, not switched.
2. **No single file owns many unrelated concerns.** Two files — `view/react-view.tsx` (1901 lines, a ~1350-line god component) and `core/store.ts` (1791 lines, a ~1150-line god class) — concentrate most of the package's complexity. They are decomposed along the seams that already exist.
3. **Every sub-module has a stated contract and a single home.** The dispatcher knows nothing about node types; per-node logic lives in per-node files; per-type metadata is a field on the node contract, not a central lookup map the dispatcher edits.
4. **The public surface presents the SPI as the headline,** not a blanket `export *` that leaks ~90 internal symbols alongside the legacy Lexical editor.

The motivating constraint is the **next feature**: a table node. Per docs/019 §5.2 the table is a *structural container* (the "fork"), so without the structural SPI it would force a fifth, sixth, and seventh hardcoded `node.type === "table"` branch into the live renderer, the resting renderer, the per-block text view, and the selection-geometry path. Building the structural SPI first turns that feature into a single `registerStructuralNode` call.

### 1.1 Non-Goals

- **No behavior change.** This is an architectural refactor. The Vitest + Playwright suites must stay green throughout; any diff that changes a test assertion (other than adding new structural-SPI tests) is out of scope.
- **No opening of the closed text unions.** `TextLeafType`, `StructuralNodeType`, and `TextMarkKind` (`core/model.ts:191`, `:193`, `:164`) stay closed unions welded to the input/caret DSA (docs/016 §4). The structural SPI makes the *render/behavior* of a structural type pluggable; it does not make new structural *kinds* author-definable from outside the engine. See §5.6.
- **No table node implementation.** The table feature is the consumer that proves this refactor; it is documented as Future Backlog (§11), not built here.
- **No `legacy/` or `spike/` changes.** Frozen.

### 1.2 Short Version

Five workstreams, sequenced so the one that unblocks the table feature lands first:

1. **Structural Node SPI** — the symmetric twin of the object `NodeView`. Migrate callout/list/quote/heading onto it. *Blocks the table node.*
2. **`object-block.tsx` decomposition** — split the 1025-line file into a node-agnostic dispatcher plus `view/nodes/*` (one file per built-in node). Establishes the custom-node worked example.
3. **`react-view.tsx` controller extraction** — break the ~1350-line god component into `use*Controller` hooks (virtual window, drag, touch, gap cursor, clipboard, focus-navigation).
4. **Public surface curation** — replace `export *` with an explicit, SPI-forward barrel; separate the legacy entry.
5. **Core file splits** — `store.ts` and `commands.ts` split by concern (lowest risk, lowest urgency).

## 2. System Summary

The owned-model editor is a framework-agnostic engine bound to React:

- **`core/`** owns the document model (`model.ts`), the mutable store of immutable nodes (`store.ts`, docs/011 §6.8), the command compiler that turns intents into invertible transactions (`commands.ts`, docs/011 §6.12), the object registry (`registry.ts`), the off-thread bake service (`bake*.ts`, scheduler.ts), and the compat boundary to the rollback-compatible rich-text JSON (`compat.ts`). It is forbidden from importing React or Lexical by the `architecture/engine-core-no-framework` lint rule (`scripts/oxlint-js-plugins/architecture.js:205`).
- **`view/`** binds the store into React through `useSyncExternalStore`. `OwnedModelEditorView` (`view/react-view.tsx`) is the orchestrator; `EngineBlock` (same file, line 1728) dispatches each block by `node.kind` to `EngineTextBlock` (`view/text-block.tsx`), `EngineObjectBlock` (`view/object-block.tsx`), or an inline structural container render. Overlays (`selection-overlay.tsx`), chrome (`editor-chrome.tsx`, `callout-chrome.tsx`, `context-menu.tsx`), and resting render (`resting-document.tsx`) round it out.
- **The Node SPI** (docs/016) is the contract for adding an *object* block: a framework-free `NodeDefinition` (`core/registry.ts:56`) paired by `type` with a React `NodeView` (`view/node-view.ts:68`), registered together via `registerNode` (`view/node-view.ts:121`).

A block's lifecycle (born → normalized → baked → rendered-at-rest → activated → edited → deactivated → queried → exported → torn down) is split across the two halves exactly along the core/view boundary (docs/016 §5). Objects walk this lifecycle through the registry. Structural nodes do not — their render and behavior are hardcoded.

## 3. Current-State Findings

### 3.1 Relevant Files

Engine core (framework-free):

- `packages/editor/src/core/model.ts` (586) — node types, closed unions, JSON value types, factory + offset helpers.
- `packages/editor/src/core/store.ts` (1791) — `EditorStore` class (lines 262–1406) + `TransactionBuilder` (150) + pure helpers below the class.
- `packages/editor/src/core/commands.ts` (2289) — the `compilers` data table (line 137) + per-command compilers + shared edit helpers.
- `packages/editor/src/core/registry.ts` (592) — `NodeDefinition` (56), `BlockRegistry` (95), `BUILT_IN_OBJECT_DEFINITIONS` (181), global custom-node registration (152–173).
- `packages/editor/src/core/compat.ts` (930), `core/scheduler.ts` (815), `core/bake*.ts`, `core/marks.ts`, `core/selection.ts`, `core/mapping.ts`, `core/steps.ts`.

View (React):

- `packages/editor/src/view/react-view.tsx` (1901) — `OwnedModelEditorView` (179–1683) + `EngineBlock` (1728).
- `packages/editor/src/view/object-block.tsx` (1025) — `EngineObjectBlock` dispatcher (118) + config panels + all built-in node views (code 616, media `MediaLiveSurface` 667, table `tableNodeView` 957, toc).
- `packages/editor/src/view/node-view.ts` (124) — the object `NodeView` contract + registry.
- `packages/editor/src/view/text-block.tsx` (687), `view/resting-document.tsx` (339), `view/selection-overlay.tsx` (617), `view/editor-chrome.tsx` (531), `view/callout-chrome.tsx` (74).
- `packages/editor/src/index.ts` (37) — public barrel.

Tooling:

- `scripts/oxlint-js-plugins/architecture.js` — `engine-core-no-framework` (205) and other `@idco` boundary rules.
- `tests/editor/*.test.ts(x)` (Vitest, ~25 files) and `tests/e2e/engine-*.spec.ts` (Playwright, ~17 files). Existing SPI tests: `tests/editor/engine-node-spi.test.ts` (115), `tests/editor/engine-phase8-integration.test.tsx`.

### 3.2 What Is Already Right

State this explicitly so the refactor does not regress it:

- **The core/view boundary is real and lint-enforced.** `engine-core-no-framework` (`architecture.js:205`) bans `react`/`react-dom`/`lexical`/`@lexical/*` imports from any file under `packages/editor/src/core/`. The new code honors it: no `legacy/` runtime imports leak into `core/` or `view/` (only doc-comment references in `core/scheduler.ts:6`, `core/compat.ts:41`, `view/gap-cursor.ts:7`), and `spike/` self-quarantines (`spike/index.ts:8`).
- **The view import graph is a clean DAG, not a tangle.** Leaf utilities (`geometry.ts`, `styles.ts`, `types.ts`, `raf.ts`, `navigation.ts`) fan in; `react-view.tsx` orchestrates; nothing imports `react-view.tsx` except the package-level `owned-model-editor.tsx` and `index.ts`. The "import everywhere" concern is *not* true at the module level — the complexity is concentrated *inside* two files, not spread across the package.
- **The command compiler is already dispatch-as-data.** `core/commands.ts:137` declares `const compilers: { [K in EditorCommandType]: CommandCompiler }`, the exact FP table pattern docs/011 §6.9/§6.12 specify. Lean into it; do not reinvent it.
- **The object Node SPI genuinely landed.** `core/registry.ts` + `view/node-view.ts` pair by `type`; `registerNode` works; divider/code/media/table/toc are registered, not switched. `tests/editor/engine-node-spi.test.ts` already proves a brand-new synthetic node round-trips through compat + bake + view with zero engine edits.

Conclusion: this is a **"two god-files + one missing SPI symmetry"** refactor, not a rescue.

### 3.3 Finding A — Two God-Files

**`view/react-view.tsx`.** `OwnedModelEditorView` is a single `forwardRef` body spanning lines 179–1683 (~1350 lines) holding ~60 hooks across eight unrelated concerns. The clusters, by line range:

| Concern | Representative members | Lines |
| --- | --- | --- |
| Virtualization / scroll | `windowRange` memo, `scrollTop`, `heightCacheRef`, `estimateRef`, `onScroll` | 202–290, 636 |
| Focus / navigation | `selectText`, `focusBlock`, `focusRoot`, `scrollToBlock`, `revealBlock`, `pageCaret` | 319–514 |
| Clipboard | `onClipboardCopy`, `onClipboardCut`, `onClipboardPaste`, `serializeSelection` | 514–636 |
| Drag selection | `beginDrag`, `extendDragToPointer`, `scheduleDragExtend`, `handleDragMove`, `endDrag` + document mouse effect | 650–1044 |
| Gap cursor | `gapAtPointer`, `materializeGap`, `applyGapMove`, `deleteAtGap`, `dismissGap` | 726–852 |
| Root input | `onRootKeyDown`, `onRootMouseDown` | 853–959 |
| Touch selection | `armHandleDrag`, `isTouchOnCollapsedCaret` + the touch effect | 1086–1320 |
| Diagnostics / handle | `diagnostics`, `getEditorHandle`, `useImperativeHandle` | 1442–1527 |

These clusters share only refs and the store; each already exposes its surface as a handful of callbacks threaded down to `EngineBlock`. That makes them separable controllers, not a monolith by necessity.

**`core/store.ts`.** `EditorStore` (262–1406) is ~1150 lines and ~45 methods spanning document access (`getNode`, `requireTextNode`, `parentEntry`), node lifecycle (`activateTextLeaf`, `deactivateObject`, `activateObject`), composition (`setComposition`, `clearComposition`), pending-format (`togglePendingMark`, `setPendingLink`), dispatch (`dispatch`, `command`, `query`), history (`undo`, `redo`, `canUndo`, `breakUndoCoalescing`), six subscription channels (`subscribeNode`, `subscribeOrder`, `subscribeSettings`, `subscribeSelection`, `subscribeCommit`, `subscribeActiveObject`), and snapshot/geometry (`toSnapshot`, `comparePoints`). The pure helpers below the class (mark remapping 1410–1492, selection mapping 1514–1572, history coalescing 1702–1800) are already free functions — good — but the class file is the largest in the package.

### 3.4 Finding B — The SPI Is Asymmetric: Structural Nodes Are Not Pluggable

This is the keystone finding. docs/016 cured the *object* extension model (the `switch (baked.kind)` → registry lift, docs/017). But the **structural** node path still has the exact "three inconsistent extension models" disease docs/016 §2.1 diagnosed — hardcoded `node.type ===` switches in four separate files:

| Site | What is hardcoded | Lines |
| --- | --- | --- |
| `view/react-view.tsx` (live render, `EngineBlock`) | `isCallout` special-case, `list` vs generic container styling, callout glyph + chrome wrapper | 1823–1871 |
| `view/resting-document.tsx` (`renderRestingStructural`) | `callout` (DaisyUI alert), `list` (`<ul>`/`<ol>`), `listitem` arms | 165–252 |
| `view/text-block.tsx` (per-block text view) | `heading` tag, `listitem` numbering/marker | 655–678 |
| `view/selection-overlay.tsx` (caret geometry) | `heading` / `listitem` / `quote` line-box geometry | 608–612 |

The closed `StructuralNodeType` union is `"body" | "list" | "listitem" | "quote" | "callout"` (`core/model.ts:193`). Each non-`body` member is rendered and measured by ad-hoc branches in the four files above. The insert menu carries an additional structural special-case: `CALLOUT_INSERT_KEY = "callout"` is threaded through `editor-chrome.tsx:104` and `:460` as "a structural callout, plus any [registered object] node" — i.e. structural inserts are bolted on beside the object SPI's `listInsertableNodes()`, not unified with it.

The consequence is identical to the pre-016 object problem: a new structural node cannot render live, render at rest, lay out its caret, or appear in the insert menu without editing four-plus engine internals. docs/019 §5.2 makes the next feature — the table — a structural container, so it lands squarely in this unpluggable path.

There is corroborating evidence the team already feels this tension: `tableNodeView` exists today as an *object* blob (`view/object-block.tsx:957`, with `renderBakedTable` at :904 reading a baked grid read-only) while docs/019 §5.2 specifies the table should be a *structural* container with cell-held block children. The two models disagree; the structural SPI is what reconciles them.

### 3.5 Finding C — object-block.tsx Conflates The Dispatcher With The Node Library

`view/object-block.tsx` (1025 lines) is three responsibilities in one file:

1. **The dispatcher** — `EngineObjectBlock` (118), `BakedObjectView` (400), `ObjectChrome` (301). This is the node-agnostic registry-lookup core (`getNodeView(node.type)` at line ~163, with `inPlaceLive`/`popoverLive` mode handling). It *should* know nothing about specific node types.
2. **The generic fallback UI** — `ObjectConfigPanel` (477), `OBJECT_CONFIG_FIELDS` (553), `renderObjectConfig` (346) — the default config form for objects that omit `renderLive`.
3. **The actual built-in node views** — code-block (`registerNodeView({…})` at 616), media (`MediaLiveSurface` 667), table (`tableNodeView` 957, `renderBakedTable` 904, `defaultTableRow` 943), table-of-contents (toc box ~983) — all registered via module-load side-effect.

The SPI's selling point (docs/016 §10: "no node-type knowledge remains in the dispatcher") is undercut when the dispatcher ships in the same file as every node. Worse, residual node-type knowledge still sits in the *dispatcher* layer as central maps the author must edit per new node:

- `OBJECT_LABELS` (`object-block.tsx:86`) — accessible name per type.
- `objectAriaRole` (`object-block.tsx:105`) — ARIA role per type.
- `OBJECT_CHROME_META` (`object-block.tsx:284`) — badge icon + label per type.
- `UNCONFIGURABLE_OBJECTS` (`object-block.tsx:337`) — the set `{divider, table, editor-table}`.
- `INSERT_ICONS` (`editor-chrome.tsx:108`) — insert-menu icon per type.

Each is a central lookup the dispatcher/chrome reads, so adding a node still means editing shared maps — the residue of the old switch.

### 3.6 Finding D — The Public Surface Mixes Legacy And Owned Engine

`packages/editor/src/index.ts` exports **both** the legacy Lexical editor *and* the owned engine, with no curation:

- `RichTextEditor` + `RichTextEditorProps` and a grab-bag of `legacy/model/*` and `legacy/nodes/*` symbols (the whole bottom half of the file).
- `export * from "./core"` and `export * from "./view"` — ~90 symbols leaked wholesale, with the SPI surface (`registerNode`, `NodeView`, `NodeDefinition`) buried among internals like `createEngineScheduler`, `Mapping`, `TransactionBuilder`.

A consumer cannot tell which editor they are importing or which symbols are supported API versus internal. The compiled `dist/` tree shows historical churn on this boundary (`dist/engine/core`, `dist/owned-model/core`, and `dist/core` all present), so the surface has drifted before and there is no curation guarding it.

### 3.7 Finding E — Duplicated Live-vs-Resting Render Logic

Structural rendering is implemented **twice**, and the two copies must be kept in lockstep by hand:

- **Live** (editing surface) — `EngineBlock` in `react-view.tsx:1817–1871`: computes `childListMeta`, special-cases `isCallout` (glyph + `CalloutChrome` + tinted box), styles `list` vs container.
- **Resting** (published surface) — `renderRestingStructural` in `resting-document.tsx:156–212`: callout as DaisyUI `alert`, `list` as `<ul>`/`<ol>`, generic container as `<div>`.

The comment at `react-view.tsx:1797` ("Rendering is separable from virtualizing") and `resting-document.tsx:151` ("mirrors the editor's recursive structural render so the two surfaces never disagree") both acknowledge the two paths *must* agree, yet enforce it only by convention. List numbering lives in two more places: `computeWindowListMeta` (`view/styles.ts`) for live, and `restingListFlavour`/`renderBlockSequence` (`resting-document.tsx:262`) for resting. A structural SPI descriptor is the natural single source both paths consume.

### 3.8 Finding F — Cohesive-But-Large Core Files

Unlike the god-files, `core/commands.ts` (2289) is *cohesive*: it is the `compilers` table plus its compiler functions plus shared edit helpers (`deleteRange` 596, `mergeWithNeighbor` 426, `leafRangesInSelection` 685). It reads fine because the data-table pattern keeps it navigable; splitting it is worthwhile housekeeping but **low urgency**. `core/store.ts` is the higher-value split (Finding A) because the class itself mixes concerns; `core/scheduler.ts` (815) and `core/compat.ts` (930) are large but single-purpose and not in scope for this document beyond noting them.

## 4. Target Model

### 4.1 The Node SPI Made Symmetric

Today the SPI has two halves for *objects only*:

```
core/registry.ts   NodeDefinition  (framework-free: data, bake, plainText, anchors, applyEdit/invertPatch)
view/node-view.ts  NodeView        (React: renderResting, renderLive, liveMode, insert)
                   registerNode    (pairs both by `type`)
```

The target adds the structural twin, registered through the *same* ergonomic front:

```
core/registry.ts        NodeDefinition          (unchanged)
core/structural-registry.ts  StructuralDefinition  (framework-free, optional: behavior/normalization a structural type needs that is not view)
view/structural-view.ts StructuralNodeView      (React: renderContainer, container style, selection geometry, insert affordance)
view/node-view.ts       registerNode            (extended: also accepts a structural pair)
```

The dispatcher (`EngineBlock`) then becomes uniform:

```ts
// pseudocode — target EngineBlock dispatch
if (node.kind === "text")    return <EngineTextBlock … />;
if (node.kind === "object")  return <EngineObjectBlock … />;       // looks up NodeView
// structural:
const view = getStructuralView(node.type);
return view
  ? view.renderContainer({ node, store, children: renderChildren(node), … })
  : <DefaultStructuralContainer node={node}>{renderChildren(node)}</DefaultStructuralContainer>;
```

No `isCallout`, no `node.type === "list"` in the dispatcher. `callout`, `list`, `quote` each register a `StructuralNodeView`; the table feature later registers one more.

### 4.2 The StructuralNodeView Contract

A structural node differs from an object in one essential way: it **has block children the engine renders recursively**, and it participates in selection/caret geometry. So its contract is shaped around *wrapping rendered children* and *describing its line box*, where the object contract is shaped around *painting a baked snapshot*. Proposed shape (a sketch to ratify before coding, per the SPI-first discipline in docs/016 §6 and the project's `spi-first-before-internals` rule):

```ts
// view/structural-view.ts — React allowed. Keyed by structural `type`.
export type StructuralNodeView = {
  readonly type: string; // a StructuralNodeType member, or a future registered one

  /**
   * Wrap the engine-rendered children. The dispatcher renders `children`
   * (recursing through EngineBlock); this slot owns only the container element,
   * its data-attributes, styling, and any chrome overlay. Replaces the inline
   * callout/list/container branches in react-view.tsx:1825–1871.
   */
  renderContainer(args: {
    readonly node: StructuralNode;
    readonly store: EditorStore;
    readonly children: ReactNode;          // already-rendered block children
    readonly listMeta?: ListItemMeta;      // numbering context, when relevant
  }): ReactNode;

  /**
   * Resting (published) container render. Mirrors renderContainer for the
   * read-only surface (resting-document.tsx:165–212). Optional: defaults to the
   * same element renderContainer produces minus editing chrome, so the two
   * surfaces cannot drift (Finding E).
   */
  renderResting?(args: {
    readonly node: StructuralNode;
    readonly children: ReactNode;
  }): ReactNode;

  /**
   * Container styling + DOM attributes shared by live and resting. Lets a single
   * descriptor feed both paths (Finding E).
   */
  readonly containerStyle?: CSSProperties;

  /**
   * The line-box / caret-geometry descriptor the selection overlay needs
   * (replaces selection-overlay.tsx:608–612). For most containers this is the
   * generic block box; a node with non-trivial internal geometry (a table cell
   * grid) describes how to resolve a point to a cell. Optional: default geometry
   * for a plain stacking container.
   */
  readonly geometry?: StructuralGeometryDescriptor;

  /** Insert/format affordance, unified with the object insert menu. */
  readonly insert?: NodeViewInsert;
};
```

A framework-free `StructuralDefinition` half is included for symmetry and for the cases that genuinely need core behavior (normalization of children, scope/insertion rules for a container per docs/019 §4.2). It is optional; a purely-visual structural node (callout) needs only the view half:

```ts
// core/structural-registry.ts — no React, worker-safe.
export type StructuralDefinition = {
  readonly type: string;
  /** Whether this container accepts block children (docs/019 §4.2 scope). */
  readonly isScope?: boolean;
  /** Normalize/repair children on import or insert; default passthrough. */
  normalizeChildren?(children: readonly NodeId[], store: ReadonlyStoreView): readonly NodeId[];
};
```

Registration goes through the existing one-call front, extended:

```ts
registerNode({ structural: calloutDefinition, structuralView: calloutView });
// or, for an object (unchanged):
registerNode({ definition: dividerDefinition, view: dividerView });
```

`registerNode` asserts the `type` keys agree across halves and routes each to its registry, exactly as it does for objects today (`view/node-view.ts:121`). Invariants mirror docs/016 §7: duplicate `type` rejected per registry; a `StructuralNodeView` whose `type` has no resolvable structural node is a registration error; a structural type with no view falls back to the default stacking container.

### 4.3 The View Layer As Orchestrator + Controllers

`OwnedModelEditorView` becomes thin wiring over a set of controller hooks, each in its own file under `view/controllers/`:

| Controller hook | Owns | Extracted from |
| --- | --- | --- |
| `useVirtualWindow` | window range, scroll position, height cache, estimate, `onScroll` | react-view.tsx 202–290, 636 |
| `useFocusNavigation` | `selectText`, `focusBlock`, `focusRoot`, `scrollToBlock`, `revealBlock`, `pageCaret` | 319–514 |
| `useClipboard` | copy/cut/paste, `serializeSelection` | 514–636 |
| `useDragSelection` | mouse-drag selection + autoscroll + the document mouse effect | 650–1044 |
| `useGapCursor` | gap resolve/materialize/move/delete/dismiss | 726–852 |
| `useTouchSelection` | long-press, grip drag, the touch effect | 1086–1320 |
| `useEditorDiagnostics` | diagnostics snapshot + imperative handle assembly | 1442–1527 |

Each hook takes the store, scheduler, and an explicit shared ref bag (§5.3) and returns the callbacks the orchestrator threads to `EngineBlock`. The orchestrator's body shrinks to: construct scheduler, build the ref bag, call the controllers, assemble the imperative handle, render the windowed block list + overlays.

### 4.4 The Node Library As One-File-Per-Node

`view/object-block.tsx` splits into:

- `view/object-block.tsx` — the **dispatcher only**: `EngineObjectBlock`, `BakedObjectView`, `ObjectChrome`, and the default `ObjectConfigPanel` fallback. No specific node type appears here.
- `view/nodes/code-block.tsx` — code `NodeView` + `CodeLiveSurface`, ending in its `registerNode`.
- `view/nodes/media.tsx` — media `NodeView` + `MediaLiveSurface`.
- `view/nodes/table.tsx` — `tableNodeView` + `renderBakedTable` + `defaultTableRow` (until the structural table replaces it — see §11).
- `view/nodes/table-of-contents.tsx` — toc view.
- `view/nodes/divider.tsx` — the divider worked example (already minimal).
- `view/nodes/callout.tsx`, `view/nodes/list.tsx`, `view/nodes/quote.tsx` — the new `StructuralNodeView` registrations from Workstream 1.
- `view/nodes/index.ts` — a single import-for-side-effect barrel that registers every built-in, imported once by the orchestrator (replacing the current "built-in views register themselves when object-block.tsx loads", `node-view.ts:11`).

Per-type metadata (`OBJECT_LABELS`, `objectAriaRole`, `OBJECT_CHROME_META`, `UNCONFIGURABLE_OBJECTS`, `INSERT_ICONS`) moves onto the `NodeView`/`StructuralNodeView` contract as fields (`ariaLabel`, `ariaRole`, `chromeMeta`, `configurable`, `insert.icon`), read by the dispatcher generically (§5.4).

### 4.5 Target File Tree

```
packages/editor/src/
  core/
    model.ts
    store/
      index.ts            (re-exports; the public `core/store` shape is unchanged)
      editor-store.ts      (the EditorStore class)
      history.ts           (coalescing + merge helpers, this-free)
      subscriptions.ts     (the six subscription channels' plumbing, this-free)
      mapping-helpers.ts   (mark/selection remap helpers below the class today)
    commands/
      index.ts             (the `compilers` table, re-assembled)
      text.ts blocks.ts marks.ts objects.ts shared.ts
    registry.ts            (object NodeDefinition + BlockRegistry — unchanged)
    structural-registry.ts (NEW: StructuralDefinition + registry)
    scheduler.ts compat.ts bake*.ts marks.ts selection.ts mapping.ts steps.ts
  view/
    react-view.tsx         (orchestrator: thin wiring)
    controllers/
      use-virtual-window.ts use-focus-navigation.ts use-clipboard.ts
      use-drag-selection.ts use-gap-cursor.ts use-touch-selection.ts
      use-editor-diagnostics.ts
    block-dispatch.tsx     (EngineBlock: kind→sub-dispatcher, node-type-agnostic)
    object-block.tsx       (dispatcher only)
    structural-view.ts     (NEW: StructuralNodeView contract + registry)
    node-view.ts           (object NodeView + extended registerNode)
    nodes/
      index.ts code-block.tsx media.tsx table.tsx table-of-contents.tsx
      divider.tsx callout.tsx list.tsx quote.tsx
    text-block.tsx resting-document.tsx selection-overlay.tsx
    editor-chrome.tsx callout-chrome.tsx context-menu.tsx …
  index.ts                 (curated public barrel)
  legacy.ts                (NEW: legacy Lexical re-exports, separated)
```

## 5. Architecture Decisions

### 5.1 Build The Structural SPI Before The Table Node (Recommended)

**Decision: build the `StructuralNodeView` SPI and migrate callout/list/quote onto it *before* implementing the table node.**

Why: docs/019 §5.2 models the table as a structural container. Without the SPI, the table forces a new hardcoded `node.type === "table"` branch into all four sites in Finding B (live render, resting render, text/selection geometry, insert menu) — re-creating, for one feature, the exact mess docs/016 spent a whole phase removing for objects. With the SPI, the table is one `registerNode({ structural, structuralView })` call. The structural migration of the three existing types (callout/list/quote) is the behavior-preserving proof that the contract is right, exactly as divider/image proved the object SPI (docs/016 §8–§9). Callout is the ideal pilot: it became structural recently (commit `e1896d8` "Callout is now a structural block") and already has both a live chrome (`callout-chrome.tsx`) and a resting render (`resting-document.tsx:165`) to consolidate.

Rejected alternative — *table first, refactor after*: ship the table with hardcoded arms, generalize later. Rejected because it doubles the churn (write four arms, then delete four arms) and ships the table on a model the very next refactor inverts; the structural-container model from docs/019 is already decided, so there is no information gained by deferring the SPI.

Rejected alternative — *keep table as an object blob*: leave `tableNodeView` opaque and never build the structural table. Rejected because it contradicts docs/019 §5.2 (tables as scopes you can place blocks into and navigate with the gap cursor) and blocks the books use-case that motivates docs/010.

### 5.2 Keep EditorStore A Class; Split The File, Not The Type

**Decision: `EditorStore` stays a class; only its *file* is split, via `this`-free helper modules.**

Why: docs/011 §6.8 deliberately chose "a mutable store of immutable nodes" — a single mutable identity that owns dispatch, history, and subscriptions is the honest model for that, and the command chokepoint (docs/011 §6.1) depends on one object threading `dispatch`. De-classing it into free functions over a passed-in state record would scatter the chokepoint and gain nothing. The win is moving the already-`this`-free helpers (history coalescing 1702–1800, mark/selection remap 1410–1572) into named modules and lifting the subscription plumbing into a `subscriptions.ts` the class composes, so `editor-store.ts` shrinks to lifecycle + dispatch. The public `core/store` import shape is preserved by re-exporting from `core/store/index.ts`.

### 5.3 Controllers As Hooks Sharing An Explicit Ref Bag

**Decision: extract each react-view concern into a `use*Controller` hook that receives an explicit `ViewRefs` bag, rather than splitting into child components.**

Why: the clusters share mutable refs (`rootRef`, `contentRef`, `heightCacheRef`, `dragAnchorRef`, `goalColumnRef`, the `registryRef` render-registry) and must run in one component instance to keep `useImperativeHandle` and the single root keydown/scroll handlers coherent. Splitting into child components would force prop-drilling or context for refs that are inherently shared and would fragment the single-DOM-node event wiring. Hooks keep one component instance, one DOM root, one imperative handle — while giving each concern a named file, a typed input (`{ store, scheduler, refs, … }`), and a typed output (the callbacks it contributes). The `ViewRefs` bag is declared once in the orchestrator and passed to each hook, making the shared state explicit instead of implicit closure capture.

### 5.4 Per-Type Metadata Moves Onto The Contract, Not Central Maps

**Decision: `OBJECT_LABELS`, `objectAriaRole`, `OBJECT_CHROME_META`, `UNCONFIGURABLE_OBJECTS`, `INSERT_ICONS` become fields on `NodeView`/`StructuralNodeView`.**

Why: these maps are the residue of the old switch — central tables the dispatcher reads and the author must edit per new node, which violates docs/016 §10 ("no node-type knowledge remains in the dispatcher"). Moving them onto the contract (`ariaLabel?`, `ariaRole?`, `chromeMeta?: { icon; label }`, `configurable?: boolean`, `insert?: { …; icon? }`) means a new node carries its own metadata in its own file, and the dispatcher reads `getNodeView(type)?.chromeMeta` generically. Defaults preserve today's behavior (e.g. `configurable` defaults true; the `{divider, table, editor-table}` set becomes `configurable: false` on those three views).

### 5.5 Curated Public Surface Over `export *`

**Decision: replace `export *` with an explicit barrel; move legacy exports to a separate entry.**

Why: `export *` (`index.ts`) leaks ~90 symbols and buries the SPI. An explicit barrel names the supported surface — `registerNode`, `NodeView`, `NodeDefinition`, `StructuralNodeView`, `StructuralDefinition`, `OwnedModelEditor`, the command/query types — as the headline, and keeps internals (`Mapping`, `TransactionBuilder`, `createEngineScheduler`) either unexported or under a clearly-internal path. The legacy Lexical editor moves behind a `legacy.ts` entry (or a `@quanghuy1242/idco-editor/legacy` subpath export in `package.json`) so a consumer cannot accidentally mix the two editors. This makes docs/016's "one place to register a node and one contract it satisfies" true at the API surface, not only internally. Because `package.json` currently exposes a single `.` export, this is a non-breaking addition (add a subpath; keep `.` pointing at the curated barrel that still re-exports the legacy symbols during a deprecation window — see §8).

### 5.6 Rejected And Deferred Options

- **Opening the closed structural union to external authors.** Rejected for first release. `StructuralNodeType` stays a closed union welded to the DSA (docs/016 §4, non-goal §1.1). The SPI makes the *render/behavior* of a structural type pluggable; defining a brand-new structural *kind* from outside the engine (with its own selection/DSA semantics) is a far deeper change books may need later, not blog parity now. The table is added as a new `StructuralNodeType` member *inside* the engine, then rendered through the SPI — the same pattern as today's callout, just without the hardcoded render.
- **A single unified `NodeView` for both object and structural nodes.** Rejected. Objects paint a baked snapshot and sequester their internals (docs/011 §2.7); structural containers render engine-managed block children and participate in caret geometry. Forcing one shape would make every slot optional-and-conditional and lose the type safety that `node.kind` already gives the dispatcher. Two contracts paired by the same `registerNode` front is the right granularity.
- **Splitting `react-view.tsx` into child components instead of hooks.** Rejected (§5.3): fragments shared refs and the single event root.
- **De-classing `EditorStore`.** Rejected (§5.2): contradicts docs/011 §6.8 and scatters the command chokepoint.
- **Splitting `commands.ts` now.** Deferred to Workstream 5 (lowest priority): the file is cohesive and navigable via its data table; the split is housekeeping, not a structural fix.

## 6. Implementation Strategy

Five workstreams, each independently reviewable and behavior-preserving, sequenced by how much they unblock the table feature and how much risk they carry:

1. **Workstream 1 — Structural Node SPI** (highest value, moderate risk). Lands the contract + registry, migrates callout → list → quote → heading-as-structural-where-applicable, deletes the four hardcoded sites. Gated by the full e2e suite plus a new structural-SPI fixture test mirroring `engine-node-spi.test.ts`.
2. **Workstream 2 — object-block.tsx decomposition** (high value, low risk). Mechanical file split + metadata-onto-contract. Establishes `view/nodes/*` where Workstream 1's structural views also live.
3. **Workstream 3 — react-view.tsx controller extraction** (high value, low-moderate risk). Mechanical hook extraction behind the ref bag. Largest line-count reduction.
4. **Workstream 4 — public surface curation** (medium value, low risk). Barrel rewrite + legacy entry separation.
5. **Workstream 5 — core file splits** (low urgency, low risk). `store/` and `commands/` directory splits.

Sequencing note: Workstream 1 and 2 interleave naturally — the structural views from 1 land in the `view/nodes/` directory that 2 creates, so do 2's directory scaffold first, then 1's contract, then migrate node-by-node. Workstreams 3, 4, 5 are independent and can proceed in any order after 1–2, or in parallel by different engineers since they touch disjoint files (3: `react-view.tsx`; 4: `index.ts`; 5: `core/store.ts`, `core/commands.ts`).

Each workstream follows the docs/017 discipline: lift behavior verbatim behind the new seam, keep the green suite as the gate, change *shape* not *behavior*, land in small reviewable commits.

## 7. Detailed Implementation Plan

### 7.1 Structural Node SPI (Workstream 1)

Current problem: structural node render and behavior are hardcoded `node.type ===` branches in four files (Finding B); the table feature would add a fifth set. Live and resting structural render are duplicated (Finding E).

Target behavior: each structural type registers a `StructuralNodeView` (and optional `StructuralDefinition`); the dispatcher resolves render/geometry/insert by registry lookup with a documented default-container fallback; live and resting paths consume one descriptor so they cannot drift.

Implementation tasks:

- [ ] Add `core/structural-registry.ts`: `StructuralDefinition` type, a `StructuralRegistry` mirroring `BlockRegistry` (`core/registry.ts:95`), global registration mirroring `registerGlobalNodeDefinition` (`:155`), and `createDefaultStructuralRegistry`. No React. Keep it under the `engine-core-no-framework` lint.
- [ ] Add `view/structural-view.ts`: `StructuralNodeView` (§4.2), `registerStructuralView`/`getStructuralView`/`listInsertableStructuralNodes` mirroring `node-view.ts:89–107`, and a `StructuralGeometryDescriptor` type.
- [ ] Extend `registerNode` (`view/node-view.ts:121`) to accept `{ structural?, structuralView? }` and route them, asserting `type` agreement.
- [ ] Extract a `DefaultStructuralContainer` component (the generic stacking `<div data-engine-structural>` path) as the fallback.
- [ ] Migrate `callout`: create `view/nodes/callout.tsx` registering a `StructuralNodeView` whose `renderContainer` is the `isCallout` branch from `react-view.tsx:1823–1871` (glyph + `CalloutChrome` + tinted box) lifted verbatim, and whose `renderResting` is the `resting-document.tsx:165–183` alert branch. Delete both inline branches.
- [ ] Migrate `list`: `view/nodes/list.tsx` with `renderContainer` (the `list` styling + `computeWindowListMeta` numbering) and `renderResting` (`<ul>`/`<ol>` from `resting-document.tsx:185–206`). Keep list-item numbering semantics identical.
- [ ] Migrate `quote` and structural `listitem` rendering similarly; fold `text-block.tsx:655–678` heading/listitem branches into the relevant descriptors where they are structural, leaving genuinely text-leaf concerns in `text-block.tsx`.
- [ ] Move the selection-overlay structural geometry (`selection-overlay.tsx:608–612`) to read `getStructuralView(type)?.geometry` with the current heading/listitem/quote values as the migrated descriptors and a default for the rest.
- [ ] Unify the insert menu: replace the `CALLOUT_INSERT_KEY` special-case (`editor-chrome.tsx:104`, `:460`) with `listInsertableStructuralNodes()` merged into the existing `listInsertableNodes()` enumeration; move `INSERT_ICONS` entries onto each view's `insert.icon`.
- [ ] Update `EngineBlock` (`react-view.tsx:1728`) so the structural arm is the uniform `getStructuralView(node.type)?.renderContainer(...) ?? <DefaultStructuralContainer/>` (§4.1), with no `isCallout`/`list` knowledge.

Tests:

- New `tests/editor/engine-structural-spi.test.ts` mirroring `tests/editor/engine-node-spi.test.ts`: register a synthetic structural node, insert it, render container live + resting, verify children render and the default fallback applies when no view is registered.
- `pnpm test` (Vitest) — existing `engine-list-flat.test.tsx`, `engine-style-invariants.test.ts`, `engine-chrome.test.tsx`, `serialize-table.test.tsx` stay green.
- `pnpm test:e2e:correctness` — `engine-list.spec.ts`, `engine-resting.spec.ts`, `engine-flow.spec.ts`, `engine-a11y.spec.ts` stay green (callout/list visuals + a11y unchanged).

### 7.2 object-block.tsx Decomposition (Workstream 2)

Current problem: `object-block.tsx` (1025) conflates dispatcher + generic config + every built-in node view; per-type metadata lives in central maps (Finding C).

Target behavior: dispatcher is node-type-agnostic; each built-in node is one file under `view/nodes/`; per-type metadata is a contract field.

Implementation tasks:

- [ ] Create `view/nodes/` and `view/nodes/index.ts` (side-effect barrel). Have the orchestrator import it once (replacing the implicit "loads when object-block.tsx loads", `node-view.ts:11`).
- [ ] Move code-block (`object-block.tsx:616` view + `CodeLiveSurface` 417 + `toCodeLanguage`/`CODE_LANGUAGES` 65–82 + `bakedCodeText` 606) → `view/nodes/code-block.tsx`.
- [ ] Move media (`MediaLiveSurface` 667) → `view/nodes/media.tsx`.
- [ ] Move table (`tableNodeView` 957, `renderBakedTable` 904, `defaultTableRow` 943, `inlineText` 895) → `view/nodes/table.tsx` (this file is later replaced by the structural table — §11).
- [ ] Move toc → `view/nodes/table-of-contents.tsx`; divider → `view/nodes/divider.tsx`.
- [ ] Add `ariaLabel`, `ariaRole`, `chromeMeta`, `configurable` to the `NodeView` type (`node-view.ts:68`); set them on each migrated view from the values currently in `OBJECT_LABELS` (86), `objectAriaRole` (105), `OBJECT_CHROME_META` (284), `UNCONFIGURABLE_OBJECTS` (337). Delete the central maps.
- [ ] Leave `EngineObjectBlock`, `BakedObjectView`, `ObjectChrome`, `ObjectConfigPanel`, `renderObjectConfig`, `OBJECT_CONFIG_FIELDS`, the JSON helpers (`asRecord`/`stringField`/`currentObjectRecord`) in `object-block.tsx` — or move the generic config + helpers to `view/object-config.tsx` and keep `object-block.tsx` as the dispatcher only. Decide during review; both honor the boundary.

Tests:

- `tests/editor/engine-objects.test.ts`, `engine-phase8-integration.test.tsx`, `engine-node-spi.test.ts`, `engine-chrome.test.tsx`, `serialize-table.test.tsx`, `table-node.test.tsx`, `table-layout-model.test.ts` stay green.
- `pnpm test:e2e:correctness` — `engine-objects.spec.ts`, `engine-toolbar.spec.ts` stay green.

### 7.3 react-view.tsx Controller Extraction (Workstream 3)

Current problem: `OwnedModelEditorView` is a ~1350-line god component (Finding A).

Target behavior: thin orchestrator over `view/controllers/use*` hooks sharing an explicit `ViewRefs` bag (§4.3, §5.3).

Implementation tasks:

- [ ] Define `ViewRefs` (the shared ref bag: `rootRef`, `contentRef`, `heightCacheRef`, `estimateRef`, `dragAnchorRef`, `goalColumnRef`, `registryRef`, etc.) in `view/controllers/refs.ts`.
- [ ] Extract `useVirtualWindow` (lines 202–290, 636), `useFocusNavigation` (319–514), `useClipboard` (514–636), `useDragSelection` (650–1044), `useGapCursor` (726–852), `useTouchSelection` (1086–1320), `useEditorDiagnostics` (1442–1527) into `view/controllers/`, each taking `{ store, scheduler, refs, … }` and returning its callbacks.
- [ ] Reduce `OwnedModelEditorView` to: build scheduler + refs, call the controllers, assemble `useImperativeHandle`, render the windowed `EngineBlock` list + overlays. Keep `EngineBlock` and `defaultCreateBakeWorker` (move `EngineBlock` to `view/block-dispatch.tsx` per §4.5).
- [ ] Preserve exact effect ordering and dependency arrays; this is the highest-regression-risk part (see §9).

Tests:

- Full Vitest suite, especially `engine-virtualization.test.tsx`, `engine-height-cache.test.ts`, `engine-gap-cursor-geometry.test.ts`, `engine-selection.test.ts`.
- Full `pnpm test:e2e:correctness` across all five Playwright projects (chromium/webkit/firefox/mobile-webkit/mobile-chromium) — drag, touch, gap-cursor, clipboard, and scroll behaviors are exercised by `engine-input.spec.ts`, `engine-mobile.spec.ts`, `engine-gap-cursor.spec.ts`, `engine-caret.spec.ts`, `engine-editing.spec.ts`.
- `pnpm test:e2e:perf` — `engine-typing-latency.perf.spec.ts`, `engine-large-document.perf.spec.ts` must not regress (controller extraction must not add renders or break coalescing).

### 7.4 Public Surface Curation (Workstream 4)

Current problem: `index.ts` mixes legacy + owned via `export *` (Finding D).

Target behavior: curated SPI-forward barrel; legacy behind a separate entry.

Implementation tasks:

- [ ] Replace `export * from "./core"` / `export * from "./view"` in `index.ts` with explicit named re-exports grouped as: SPI (`registerNode`, `NodeView`, `NodeDefinition`, `StructuralNodeView`, `StructuralDefinition`, `NodeViewInsert`), editor (`OwnedModelEditor`, `OwnedModelEditorView` + prop/handle types), core types consumers need (command/query types, `EditorStore`, snapshot types), and helpers (`compatFromEditorStore`, `createEditorStoreFromCompat`, `importPayloadLexical`, etc.). Keep internals (`Mapping`, `createEngineScheduler`, `TransactionBuilder`) out of the default barrel or under an explicitly-internal path.
- [ ] Create `packages/editor/src/legacy.ts` re-exporting `RichTextEditor`, `RichTextEditorProps`, and the `legacy/model/*` + `legacy/nodes/*` symbols currently at the bottom of `index.ts`. Add a `./legacy` subpath to `package.json` `exports`.
- [ ] During the deprecation window, keep `index.ts` re-exporting the legacy symbols (so no consumer breaks) but mark them `@deprecated` pointing at `/legacy`.

Tests:

- `pnpm --filter @quanghuy1242/idco-editor typecheck` and a repo-wide `tsc` to confirm no consumer import breaks.
- Grep consumers: `rg "from \"@quanghuy1242/idco-editor\"" packages stories tests` to confirm each imported symbol still resolves.

### 7.5 Core File Splits (Workstream 5)

Current problem: `store.ts` (1791, god class) and `commands.ts` (2289, cohesive-but-large) (Findings A, F).

Target behavior: `core/store/` and `core/commands/` directories whose `index.ts` preserves the existing import shape.

Implementation tasks:

- [ ] Create `core/store/index.ts` re-exporting the current `core/store.ts` surface. Move the class to `core/store/editor-store.ts`; move `this`-free helpers (history coalescing 1702–1800, mark/selection remap 1410–1572) to `core/store/history.ts` and `core/store/mapping-helpers.ts`; lift subscription plumbing to `core/store/subscriptions.ts`.
- [ ] Create `core/commands/index.ts` holding the `compilers` table (assembled from per-family modules) + `compileCommand`/`runQuery`. Split compilers into `core/commands/{text,blocks,marks,objects}.ts` and shared helpers into `core/commands/shared.ts`.
- [ ] Keep all import paths stable via the `index.ts` re-exports; no caller outside `core/` changes.

Tests:

- `tests/editor/engine-commands.test.ts`, `engine-model.test.ts`, `engine-selection.test.ts`, `engine-delete-positional.test.ts`, `insertion.test.tsx` stay green.
- `engine-core-no-framework` lint stays clean across the new `core/store/` and `core/commands/` files.

## 8. Migration And Rollout

- **No data migration.** The document model, compat boundary, and persisted JSON are untouched; this is a code-shape refactor.
- **No feature flags.** Each workstream is behavior-preserving and lands behind the green test suite; there is no runtime toggle to stage.
- **Deployment order is the workstream order** (§6): 1 → 2 (interleaved) → 3, 4, 5 (independent). Each workstream is a reviewable PR (or a small series) that keeps `pnpm test` + `pnpm test:e2e:correctness` green.
- **Public-surface deprecation window (Workstream 4):** add the `./legacy` subpath and curated `.` barrel additively; keep legacy symbols re-exported from `.` with `@deprecated` for at least one release before removal, and migrate in-repo consumers (`rg "from \"@quanghuy1242/idco-editor\""`) first.
- **Rollback:** each workstream is independently revertible because none changes behavior or data; reverting a PR restores the prior shape with no migration. The `dist/` historical churn (Finding D) is a reminder to rebuild and re-publish cleanly after Workstream 4.

## 9. Edge Cases And Failure Modes

- **Controller extraction changes effect order (Workstream 3).** React effects run in declaration order; moving a `useEffect` into a hook called in a different position can reorder cleanup/setup and break the touch/drag document listeners or the imperative handle. Handling: extract in the original order, keep one hook per concern, and diff the e2e input/mobile/gap-cursor specs before/after. This is the single highest-risk change; do it after 1–2 so the suite is otherwise stable.
- **Structural fallback for an unregistered type (Workstream 1).** A structural node whose type has no `StructuralNodeView` must render through `DefaultStructuralContainer` (stack children), never throw or render nothing — mirroring docs/016 §7's "a definition with no view falls back to the generic placeholder." Verified by the new structural-SPI test.
- **Live/resting drift after consolidation (Finding E).** If `renderContainer` and `renderResting` diverge during migration, the published page and the editor disagree (the exact risk `resting-document.tsx:151` warns about). Handling: derive `renderResting` from the shared `containerStyle` + element where possible; cover with `engine-resting.spec.ts` + a snapshot of callout/list resting output.
- **Insert-menu duplication or omission (Workstream 1).** Merging structural inserts with object inserts can double-list or drop callout. Handling: assert the merged enumeration contains exactly the union with no duplicate `type`; `engine-phase9-affordances.test.ts`/`engine-chrome.test.tsx` guard it.
- **Per-type metadata default drift (Workstream 2).** Moving `UNCONFIGURABLE_OBJECTS` to `configurable: false` must keep `{divider, table, editor-table}` unconfigurable and everything else configurable. Handling: set the field explicitly on the three views; default `configurable` to `true`; assert in `engine-chrome.test.tsx`.
- **Worker boundary regressions (Workstreams 1, 2, 5).** The bake worker (`core/bake.worker.ts`) only sees framework-free `NodeDefinition`s and only built-ins survive `postMessage` (docs/016 §3). `StructuralDefinition` must stay framework-free and not be assumed worker-transported unless it is a built-in. Handling: keep `core/structural-registry.ts` under `engine-core-no-framework`; do not move any bake logic into the view halves.
- **Public-surface break for an external consumer (Workstream 4).** A symbol dropped from the curated barrel breaks a consumer. Handling: the deprecation window (§8) plus a repo-wide `tsc` and `rg` of import sites before removing anything.
- **Circular import between `view/nodes/index.ts` and the dispatcher (Workstream 2).** The side-effect barrel registering views must not import the orchestrator. Handling: barrel imports only `registerNode` + the node files; the orchestrator imports the barrel once for its side effect.

## 10. Implementation Backlog

### R1. Structural Node SPI

Scope:

- `packages/editor/src/core/structural-registry.ts` (new)
- `packages/editor/src/view/structural-view.ts` (new)
- `packages/editor/src/view/node-view.ts` (extend `registerNode`)
- `packages/editor/src/view/react-view.tsx` (`EngineBlock` structural arm)
- `packages/editor/src/view/resting-document.tsx`, `view/text-block.tsx`, `view/selection-overlay.tsx`, `view/editor-chrome.tsx`
- `packages/editor/src/view/nodes/{callout,list,quote}.tsx` (new)

Tasks:

- [ ] `StructuralDefinition` + `StructuralRegistry` + global registration + `createDefaultStructuralRegistry`.
- [ ] `StructuralNodeView` + `registerStructuralView`/`getStructuralView`/`listInsertableStructuralNodes` + `StructuralGeometryDescriptor`.
- [ ] Extend `registerNode` to route structural halves with `type`-agreement assertion.
- [ ] `DefaultStructuralContainer` fallback.
- [ ] Migrate callout, list, quote, structural-listitem render (live + resting) onto the SPI; delete the four hardcoded sites.
- [ ] Move structural selection geometry onto `geometry` descriptors.
- [ ] Unify insert menu (remove `CALLOUT_INSERT_KEY`; merge enumerations; `INSERT_ICONS` → `insert.icon`).

Acceptance criteria:

- `EngineBlock`'s structural arm contains no `node.type ===` literal; it is a registry lookup with a default fallback.
- Callout, list, quote render identically live and resting before/after (visual + a11y specs unchanged).
- A synthetic structural node registered via `registerNode` renders its container and children with zero edits to `react-view.tsx`/`resting-document.tsx`.

Tests:

- `tests/editor/engine-structural-spi.test.ts` (new), `pnpm test`, `pnpm test:e2e:correctness` (engine-list/resting/flow/a11y).

### R2. object-block.tsx Decomposition

Scope:

- `packages/editor/src/view/object-block.tsx`
- `packages/editor/src/view/nodes/{code-block,media,table,table-of-contents,divider}.tsx` (new)
- `packages/editor/src/view/nodes/index.ts` (new)
- `packages/editor/src/view/node-view.ts` (contract fields), `view/editor-chrome.tsx` (`INSERT_ICONS`)

Tasks:

- [ ] Create `view/nodes/` + side-effect barrel; orchestrator imports it once.
- [ ] Move each built-in node view into its own file.
- [ ] Add `ariaLabel`/`ariaRole`/`chromeMeta`/`configurable` to `NodeView`; set per node; delete `OBJECT_LABELS`/`objectAriaRole`/`OBJECT_CHROME_META`/`UNCONFIGURABLE_OBJECTS`.
- [ ] Reduce `object-block.tsx` to the dispatcher (+ generic config or split it to `view/object-config.tsx`).

Acceptance criteria:

- `object-block.tsx` contains no specific node `type` literal.
- Each built-in node is one self-registering file under `view/nodes/`.
- Per-type metadata reads from the contract, not central maps.

Tests:

- `tests/editor/{engine-objects,engine-node-spi,engine-chrome,serialize-table,table-node,table-layout-model}.test.*`, `pnpm test:e2e:correctness` (engine-objects/toolbar).

### R3. react-view.tsx Controller Extraction

Scope:

- `packages/editor/src/view/react-view.tsx`
- `packages/editor/src/view/controllers/{refs,use-virtual-window,use-focus-navigation,use-clipboard,use-drag-selection,use-gap-cursor,use-touch-selection,use-editor-diagnostics}.ts` (new)
- `packages/editor/src/view/block-dispatch.tsx` (new; `EngineBlock` moves here)

Tasks:

- [ ] Define `ViewRefs`.
- [ ] Extract the seven controllers preserving effect order + deps.
- [ ] Reduce `OwnedModelEditorView` to wiring; move `EngineBlock` to `block-dispatch.tsx`.

Acceptance criteria:

- `OwnedModelEditorView` body is wiring only; each concern lives in a named hook file.
- No change to render counts, coalescing, or imperative-handle surface.

Tests:

- Full `pnpm test`; full `pnpm test:e2e:correctness` (all five projects); `pnpm test:e2e:perf` no regression.

### R4. Public Surface Curation

Scope:

- `packages/editor/src/index.ts`, `packages/editor/src/legacy.ts` (new), `packages/editor/package.json` (`exports`)

Tasks:

- [ ] Replace `export *` with an explicit, grouped, SPI-forward barrel.
- [ ] Move legacy symbols to `legacy.ts`; add `./legacy` subpath export; `@deprecated` the re-exports during the window.

Acceptance criteria:

- The SPI symbols are named explicitly in the barrel; internals are not in the default surface.
- Legacy is importable from `/legacy`; no in-repo consumer breaks.

Tests:

- `pnpm --filter @quanghuy1242/idco-editor typecheck`, repo `tsc`, `rg` of import sites.

### R5. Core File Splits

Scope:

- `packages/editor/src/core/store/*` (new dir), `packages/editor/src/core/commands/*` (new dir)

Tasks:

- [ ] Split `store.ts` into `store/{index,editor-store,history,subscriptions,mapping-helpers}.ts` (class stays a class).
- [ ] Split `commands.ts` into `commands/{index,text,blocks,marks,objects,shared}.ts` (table re-assembled in `index`).
- [ ] Preserve all import paths via `index.ts` re-exports.

Acceptance criteria:

- Import shape `from "../core"` / `from "./store"` unchanged for all callers.
- `engine-core-no-framework` clean; no behavior change.

Tests:

- `tests/editor/{engine-commands,engine-model,engine-selection,engine-delete-positional,insertion}.test.*`, full `pnpm test`.

## 11. Future Backlog

These depend on this refactor but are not part of it:

- **Table node as a structural container (docs/019 §5.2).** The consumer that proves the structural SPI: rows → cells → block children, cells as scopes the gap cursor navigates, faithful grid in `data` (docs/011 §2.4). Replaces the opaque `tableNodeView` (`view/nodes/table.tsx` after R2) with a `StructuralNodeView` + `StructuralDefinition`. Brings the self-windowing slots flagged in `node-view.ts:54` (a large grid windows its own internals, so `offsetHeight` is wrong for the engine's block math).
- **Route resting render through `packages/reader` L1 primitives (docs/015).** Once the reader tier lands, `renderResting`/`StructuralNodeView.renderResting` paint through shared primitives instead of bespoke markup, killing the last of the live/resting drift risk structurally.
- **Open structural kinds to external authors.** If books need author-defined containers with their own DSA semantics, promote `StructuralNodeType` from a closed union to a registry-driven open set — a deeper change explicitly out of this document's scope (§5.6).
- **Wire `plainText`/`anchors` for structural containers into find-in-page** (the object equivalent is named in docs/016 §6.3); a structural container's searchable text is its children's, which the index already walks, so this is mostly verification.

## 12. Definition Of Done

- [ ] `StructuralNodeView` + `StructuralDefinition` exist; callout, list, quote, and structural-listitem render through them; the four hardcoded `node.type ===` sites (Finding B) are deleted; `EngineBlock`'s structural arm is a registry lookup with a documented fallback.
- [ ] `tests/editor/engine-structural-spi.test.ts` proves a brand-new synthetic structural node renders (container + children, live + resting) with zero engine-internal edits.
- [ ] `view/object-block.tsx` is the dispatcher only; every built-in node is one self-registering file under `view/nodes/`; per-type metadata is a contract field, central maps deleted.
- [ ] `OwnedModelEditorView` is thin wiring; the seven controller concerns live in `view/controllers/`; `EngineBlock` is in `view/block-dispatch.tsx`.
- [ ] `index.ts` is a curated, SPI-forward barrel; legacy is behind `/legacy`; no in-repo consumer breaks.
- [ ] `core/store/` and `core/commands/` are split by concern with import shapes preserved; `EditorStore` is still a class.
- [ ] Automated verification: `pnpm test` (Vitest) green; `pnpm test:e2e:correctness` green on all five Playwright projects; `pnpm test:e2e:perf` shows no typing-latency or large-document regression.
- [ ] Lint: `architecture/engine-core-no-framework` clean across all new `core/` files; repo `tsc`/typecheck clean.
- [ ] Manual smoke: insert + edit + publish a callout, a bulleted and numbered list, a code block, an image, and a table; confirm editor and published surfaces match.
- [ ] Docs: this document's status updated to reflect completion; docs/016 cross-referenced from the structural SPI; the `editor-architectural-refactor` memory note updated.

## 13. Final Model

After this refactor the editor has **one symmetric Node SPI**. An object registers a `NodeDefinition` + `NodeView`; a structural container registers a `StructuralDefinition` + `StructuralNodeView`; both go through the same `registerNode` front, and the block dispatcher (`EngineBlock`) carries zero node-type knowledge — it dispatches by `node.kind` and, within structural and object, by registry lookup with a documented default fallback. Live and resting structural render consume one descriptor, so the editor and the published page cannot drift.

The view layer is an orchestrator (`OwnedModelEditorView`) over seven named controller hooks sharing an explicit ref bag, instead of a 1350-line god component. The node library is one file per node under `view/nodes/`, each carrying its own metadata. The core keeps its deliberate mutable-store-of-immutable-nodes class, but in a `store/` directory split by concern, and its command compiler in a `commands/` directory assembled from per-family tables. The public surface presents the SPI as the headline and quarantines the legacy Lexical editor behind `/legacy`.

The payoff is concrete and immediate: the **table node** — the next feature, a structural container per docs/019 §5.2 — becomes a single `registerNode({ structural, structuralView })` call against a proven contract, not a fifth set of hardcoded branches across four files. "Blog now, books later, custom nodes easy" (docs/016 §1) becomes true for structural nodes the same way docs/016 made it true for objects.
