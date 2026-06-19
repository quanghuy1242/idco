# 016 - Node SPI: Object Lifecycle And The Pluggable Block System

> Status: design sketch (pre-implementation). The contract is being locked before the internals are refactored to it (SPI-first).
>
> Date: 2026-06-19
>
> Scope:
>
> - `packages/editor/src/core/registry.ts` — today's data-only `BlockDefinition`; this document promotes it to the framework-free half of the node contract (`NodeDefinition`).
> - `packages/editor/src/view/**` — the React half of the contract (`NodeView`) and the node-type render registry that replaces the hardcoded `switch`/`inPlaceCode` dispatch in `react-view.tsx`.
> - `packages/editor/src/core/{bake,bake.worker,compat,store}.ts` — the existing consumers of the registry that the SPI keeps honest across the worker boundary.
>
> Relationship to the other docs:
>
> - **011 owns the foundation; this document realizes one part of it.** 011 §2.3 (the node-kind master table), §2.7 (object internals are sequestered, with copy/search/export/anchor adapters), and §6.5 (object/custom-node mutations are invertible steps via `applyEdit`/`invertPatch`) *specify* the node contract. This document is the runnable SPI for that specification. **Where this document and 011 disagree on a foundation detail, 011 wins**; this document only adds the view-side surface (render, live-edit, affordance) that 011 deliberately does not cover, and the registration mechanics.
> - **010 owns the phasing.** The SPI is built in the pre-Phase-8 pass (docs/017) as a behavior-preserving refactor; Phase 8 (010 §10.4) then *fills the optional slots* without reshaping the contract.
> - **015 (reader) owns resting render primitives.** A `NodeView.renderResting` renders through the `packages/reader` L1 primitives when they exist; until then it renders its own resting view (010 §5.9 / docs/017).
>
> Source of the problem this solves: docs/017 §1 (the three inconsistent extension models) and the pre-Phase-8 investigation that found object render/live-edit hardcoded in `react-view.tsx` while only the data half is registry-driven.

## Table Of Contents

- [1. Purpose](#1-purpose)
- [2. Why This Document Exists Now](#2-why-this-document-exists-now)
  - [2.1 The Three Inconsistent Extension Models Today](#21-the-three-inconsistent-extension-models-today)
  - [2.2 The Vision Is In 011, The Framework Is Half-Built](#22-the-vision-is-in-011-the-framework-is-half-built)
- [3. The Core Constraint: The core/view Boundary](#3-the-core-constraint-the-coreview-boundary)
- [4. Scope: What Is Pluggable And What Is Not](#4-scope-what-is-pluggable-and-what-is-not)
- [5. The Node Lifecycle](#5-the-node-lifecycle)
- [6. The SPI Shape (Sketch)](#6-the-spi-shape-sketch)
  - [6.1 NodeDefinition — the framework-free half](#61-nodedefinition--the-framework-free-half)
  - [6.2 NodeView — the React half](#62-nodeview--the-react-half)
  - [6.3 Required vs optional slots](#63-required-vs-optional-slots)
- [7. Registration: registerNode And The Two Registries](#7-registration-registernode-and-the-two-registries)
- [8. Worked Example 1: divider (the simplest new node)](#8-worked-example-1-divider-the-simplest-new-node)
- [9. Worked Example 2: image (live-edit + upload affordance)](#9-worked-example-2-image-live-edit--upload-affordance)
- [10. How react-view.tsx Decomposes Onto The SPI](#10-how-react-viewtsx-decomposes-onto-the-spi)
- [11. Verification](#11-verification)
- [12. Open Decisions](#12-open-decisions)

## 1. Purpose

Define the single contract an author implements to add a block/object node to the owned-model engine and have it work end to end: persist, bake, render at rest, edit live, round-trip the compat boundary, expose itself to document services (search/copy/export), invert its edits, and offer itself to the insert/format affordances — **without editing engine internals**.

The thesis: "blog now, books later, custom nodes easy" is only cheap if there is one place to register a node and one contract it satisfies. Today there is no such place for the render half. This document locks the contract before the pre-Phase-8 refactor (docs/017) reshapes the internals toward it.

## 2. Why This Document Exists Now

### 2.1 The Three Inconsistent Extension Models Today

| Node family | How it is extended today | Pluggable? |
| --- | --- | --- |
| Text leaves (`TextLeafType`), structural (`StructuralNodeType`), marks (`TextMarkKind`) | edit the closed union in `core/model.ts` plus commands plus view | No — core surgery |
| Object/heavy nodes | register a `BlockDefinition` in `core/registry.ts` | Partly — **data only** (`normalizeData`, `fromCompatNode`, `toCompatNode`, `isExportComplete`, `bake`) |
| Resting render and live-edit | hardcoded `switch (baked.kind)` for resting render and `inPlaceCode = node.type === "code-block"` for the live surface, both in `view/react-view.tsx` | No — not a contract at all |

The consequence: a new object can persist and bake, but cannot render at rest or edit live without editing `react-view.tsx`. That is the gap this SPI closes.

### 2.2 The Vision Is In 011, The Framework Is Half-Built

011 already specifies the richer contract that is not yet implemented:

- **§2.7** — a `BlockDefinition` for an object with internal content must expose adapters for whole-node copy, plain-text search, export/bake completeness, and indexable anchors. *Not implemented* (the registry has no such adapters), which is the "search silently skips object internals" risk in 010 §10.5.
- **§6.5** — a `BlockDefinition` may provide `applyEdit(data, patch)` plus `invertPatch(patch, dataBefore)` for fine-grained invertible object edits. *Not implemented* (only the wholesale `SetObjectData` swap exists).
- **§2.3 master table** — maps `link` → range mark, `glossary` → inline atom, `highlight` → format mark. *Not wired in compat import* (links currently flatten to plain text).

So: the vision is documented, the data half is built, and render / live-edit / internal-adapters / fine-grained-invert are not part of any runnable contract. This document is the runnable contract.

## 3. The Core Constraint: The core/view Boundary

The SPI **cannot be a single object**, because of a boundary the engine already enforces and depends on:

- Phase 1 AC4 lint forbids `core/**` from importing `react` (or `lexical`).
- `core/bake.worker.ts` requires `normalizeData`/`bake` to be framework-free and `postMessage`-safe. Custom object functions do not survive structured clone, so the worker bakes the built-in set with a default registry and custom objects bake on the main thread through the same `bakeObjectData` call.

Render functions are React. Therefore a node's lifecycle splits across two homes, keyed by the same `type` string:

- **`NodeDefinition`** lives in `core/` — framework-free, worker-safe: data, bake, document-service adapters, invert.
- **`NodeView`** lives in `view/` — React: resting render, live-edit surface, config panel, insert/format affordance.

This is not a compromise; it is the same layering the worker already proves. The registry is already transport-layered (built-ins vs main-thread custom). The SPI formalizes that into two paired registries (§7).

## 4. Scope: What Is Pluggable And What Is Not

**Pluggable (the SPI target): block/object nodes.** Image, divider, embed (youtube), table, code-block, post-ref, table-of-contents, and any future custom block.

**Not pluggable, and deliberately so: the text DSA.** Text leaves (`TextLeafType`), structural nodes (`StructuralNodeType`), and mark *kinds* (`TextMarkKind`) stay closed unions. They are welded to the input/caret core and 011's per-leaf DSA (011 §3); opening them is a far deeper change and blog parity does not need it.

**Adjacent, not part of this SPI: mark rendering.** DOM-izing `link`/`highlight`/`glossary` into styled spans/atoms is a parallel Phase 8 stream (010 Phase 8 AC for mark render), not a node definition. Keeping that line bright is what stops this SPI from sprawling into a full editor rewrite. A `glossary` *atom* still surfaces here only as the inline-atom entry the master table names (011 §4.3), not as a registered node.

## 5. The Node Lifecycle

One node, observed across its full cycle. Each stage names the slot responsible.

1. **Born** — from compat import (`fromCompat`) or an insert command (`normalizeData` over author/default input).
2. **Normalized** — `normalizeData` guarantees a JSON-safe, internally consistent `data` and an initial `status`.
3. **Baked** — `bake(data)` produces the static `BakedSnapshot` (pure compute, worker-safe), or `null` → recoverable `invalid` status (010 Phase 6 AC4).
4. **Rendered at rest** — `NodeView.renderResting(baked)` paints the baked snapshot, through the reader L1 primitive when available (015).
5. **Activated** — one object live at a time (010 §6.4). Outer selection becomes `{type:"node", node:id}` (011 §8.2); `NodeView.renderLive` mounts the edit surface; the text caret suspends (010 Phase 6 AC5).
6. **Edited** — fine-grained edits go through `applyEdit`/`invertPatch` (011 §6.5) or a wholesale `SetObjectData` swap; each edit re-bakes (stage 3).
7. **Deactivated** — `renderLive` unmounts; `renderResting` resumes; the text caret resumes.
8. **Queried by services** — `plainText`/`anchors` adapters answer search, copy, and export (011 §2.7); omitted adapters fall back to the baked snapshot or report "unsupported" — never a silent skip.
9. **Exported** — `toCompat(value)` projects back to the rich-text JSON boundary; `isExportComplete` reports whether the bake/data is publish-ready.
10. **Torn down** — on unmount, the view releases subscriptions, observers, and worker references (010 §10.5 memory item).

Stages 1–3, 6 (invert), 8, 9 are `NodeDefinition` (core). Stages 4, 5, 7, 10 are `NodeView` (view). The split is exactly the boundary in §3.

## 6. The SPI Shape (Sketch)

Types below are a sketch to react to, not the final signatures. They reuse the existing `core/model.ts` vocabulary (`JsonValue`, `BakedSnapshot`, `ObjectNodeStatus`, `RichTextCompatNode`).

### 6.1 NodeDefinition — the framework-free half

```ts
// core/registry.ts — extends today's BlockDefinition. No React, worker-safe.
export type NodeDefinition = {
  readonly type: string;

  // --- data (today's BlockDefinition; unchanged) ---
  normalizeData(value: unknown): ObjectNormalizationResult;
  fromCompatNode?(node: RichTextCompatNode): ObjectNormalizationResult;
  toCompatNode?(value: ObjectNormalizationResult): Omit<RichTextCompatNode, "id" | "type">;
  isExportComplete?(value: ObjectNormalizationResult): boolean;

  // --- bake (today's; pure compute, runs in the worker) ---
  bake?(data: JsonValue): BakedSnapshot | null;

  // --- NEW: document-service adapters (011 §2.7); optional ---
  plainText?(data: JsonValue): string;                 // search/index/export text
  anchors?(data: JsonValue): readonly NodeAnchor[];    // indexable internal anchors

  // --- NEW: fine-grained invertible edits (011 §6.5); optional ---
  applyEdit?(data: JsonValue, patch: JsonValue): JsonValue;
  invertPatch?(patch: JsonValue, dataBefore: JsonValue): JsonValue;
};
```

### 6.2 NodeView — the React half

```ts
// view/node-view.ts — React allowed. Keyed by the same `type`.
export type NodeView = {
  readonly type: string;

  // resting render: paint the baked snapshot (via reader L1 primitive, 015).
  renderResting(args: {
    readonly node: ObjectNode;
    readonly baked: BakedSnapshot | null;
  }): ReactNode;

  // live-edit surface: mounted when this object is the one active object.
  // `commit` re-bakes through the store (SetObjectData or applyEdit patch).
  renderLive?(args: {
    readonly node: ObjectNode;
    readonly commit: (next: JsonValue) => void;
    readonly deactivate: () => void;
  }): ReactNode;

  // affordance metadata for the slash/insert menu and format toolbar (Phase 8).
  readonly insert?: {
    readonly label: string;
    readonly group?: string;
    readonly keywords?: readonly string[];
    createData(): JsonValue;     // default data for a freshly inserted node
  };
};
```

### 6.3 Required vs optional slots

Per the SPI-first discipline: **name the whole cycle now, implement the subset that has existing behavior to wrap.**

| Slot | Required? | Wrapped by built-ins in pre-Phase-8? | Filled in Phase 8 |
| --- | --- | --- | --- |
| `type`, `normalizeData` | Required | Yes | — |
| `fromCompatNode`/`toCompatNode` | Optional (default passthrough) | Yes | — |
| `bake` | Optional (no baker → `unresolved`) | Yes | — |
| `NodeView.renderResting` | Required for a visible node | Yes (code/media/embed/post-ref lifted verbatim) | new nodes |
| `NodeView.renderLive` | Optional (default: config panel) | code-block live surface lifted | image, table |
| `plainText`/`anchors` | Optional (fallback: baked text or "unsupported") | No (named only) | with find-in-page |
| `applyEdit`/`invertPatch` | Optional (fallback: wholesale `SetObjectData`) | No (named only) | large grids |
| `NodeView.insert` | Optional | No (named only) | slash/insert menu |

Omitted optional slots must degrade to a documented fallback, never a silent failure (011 §2.7).

## 7. Registration: registerNode And The Two Registries

Two registries, paired by `type`, mirroring the core/view split:

```ts
// core
const blocks = createDefaultBlockRegistry([dividerDefinition, imageDefinition]);
// view
const views = createDefaultNodeViewRegistry([dividerView, imageView]);
```

`registerNode` is the one ergonomic call a feature author uses; it routes each half to its registry and asserts the `type` keys agree:

```ts
registerNode({ definition: dividerDefinition, view: dividerView });
```

Invariants:

- Duplicate `type` rejected in each registry (today's `BlockRegistry` already does this; the persistence contract requires deterministic parsing).
- A `NodeView` whose `type` has no `NodeDefinition` is a registration error (a view with nothing to render).
- A `NodeDefinition` with no `NodeView` is allowed (headless/worker-only, e.g. a positional `table-of-contents` whose body is derived); it falls back to the generic baked placeholder.
- The worker only ever sees `NodeDefinition`s, and only the built-in set survives `postMessage`; custom definitions bake on the main thread (unchanged from today).

## 8. Worked Example 1: divider (the simplest new node)

`divider` (horizontal rule) is the simplest missing blog node — 21 occurrences in the corpus today (`horizontalrule`), currently unrepresentable, so it is the proof the SPI is usable for a brand-new type.

```ts
// core
const dividerDefinition: NodeDefinition = {
  type: "divider",
  normalizeData: () => ({ data: {}, status: "ready" }),
  fromCompatNode: () => ({ data: {}, status: "ready" }),       // compat "horizontalrule"
  toCompatNode: () => ({}),                                     // emits { type: "divider" }
  bake: () => ({ kind: "divider", payload: {} }),
  plainText: () => "",                                          // contributes no search text
};

// view
const dividerView: NodeView = {
  type: "divider",
  renderResting: () => <ReaderHr />,                            // reader L1 primitive (015)
  insert: { label: "Divider", group: "Blocks", keywords: ["hr", "rule", "---"],
            createData: () => ({}) },
};

registerNode({ definition: dividerDefinition, view: dividerView });
```

What it exercises end to end, with **zero** edits to engine internals: normalize → bake → resting render → compat round-trip (`horizontalrule` ⇄ `divider`) → insert-menu entry. No `renderLive` (a divider is not editable), no adapters, no invert — all degrade to their fallbacks. This is the bar: if a new node is one file plus one `registerNode` call, the SPI is right.

(Note: the compat alias `horizontalrule → divider` is the kind of mapping the Payload import adapter, docs/017 §4, will carry; the divider *node* exists independently of how old data names it.)

## 9. Worked Example 2: image (live-edit + upload affordance)

Image exercises the live-edit and affordance slots and maps the corpus's `upload` node (111 occurrences). The data slot already exists as the built-in `media` definition; this shows the view half and the upload affordance.

```ts
// view
const imageView: NodeView = {
  type: "media",
  renderResting: ({ baked }) => <ReaderImage src={field(baked, "src")} caption={...} />,
  renderLive: ({ node, commit, deactivate }) => (
    <ImageConfig data={node.data} onChange={commit} onDone={deactivate} />  // @idco/ui
  ),
  insert: { label: "Image", group: "Media", keywords: ["img", "photo", "upload"],
            createData: () => ({ src: "", alt: "", caption: "" }) },
};
```

Two things this surfaces for Phase 8, recorded so they are not discovered late:

- **The upload pipeline is an affordance binding, not a node concern.** Drop/paste → host upload binding → `commit({ src })` (010 §10.5 image item). The node only receives a resolved `src`; the SPI deliberately does not own transport.
- **`upload → media` is a dialect alias** handled by the Payload import adapter (docs/017 §4), not by the `media` definition itself, which keeps the node decoupled from how old data spelled it.

## 10. How react-view.tsx Decomposes Onto The SPI

This is the seam the pre-Phase-8 decompose (docs/017) lands, behavior-preserving:

- The resting `switch (baked.kind)` arms (code/media/embed/post-ref) become the `renderResting` bodies of their `NodeView`s, **moved verbatim**. The `switch` becomes `views.get(node.type)?.renderResting(...) ?? <BakedPlaceholder/>`.
- The `inPlaceCode = node.type === "code-block"` branch and `CodeLiveSurface` become the code-block `NodeView.renderLive`. The generic `ObjectConfigPanel` becomes the default `renderLive` fallback for definitions that do not provide one.
- `EngineObjectBlock` in the extracted `object-block.tsx` becomes a thin dispatcher: look up the `NodeView` by `type`, call `renderResting` at rest and `renderLive` when active. No node-type knowledge remains in the dispatcher.

Behavior is identical (the green suite stays the gate); only the *shape* changes from a switch to a registry lookup. After this, every new node is a `registerNode` call.

## 11. Verification

- A node-fixture test registers a synthetic `NodeDefinition` + `NodeView`, inserts it, bakes it, renders it at rest, edits it live, and round-trips it through compat — **touching no view internals**. This is the Phase 8 "node contract" AC (docs/010 Phase 8).
- The existing engine e2e suite (objects/flow/editing) stays green through the pre-Phase-8 lift, proving the switch→registry move is behavior-preserving.
- `divider` and `image` ship as the two worked examples, each with a passing test.

## 12. Open Decisions

- **Single `registerNode` vs two explicit registries.** This document proposes `registerNode` as the ergonomic front for two registries. If the host needs to register core-only (worker/SSR) without a view, it uses the core registry directly. Confirm the ergonomic default.
- **Where `NodeView` config panels source their chrome.** They should use `@idco/ui` (React Aria + DaisyUI) from day one (note.md §3 / 010 §7.1); the divider/image examples assume that.
- **Whether `plainText`/`anchors` ship in Phase 8 or with find-in-page specifically.** Named now; 010 §10.5 ties them to the find-in-page UI. Decide the trigger.
- **`table` faithfulness vs blob.** 011 §2.4 wants a faithful `row → cell → block` grid inside `data`; today it imports as an opaque blob with no `renderResting`. Faithful table editing is deferrable (books, not blog) but its `NodeView.renderLive` is the largest future node. Confirm it stays deferred for blog-first.
