# 030 — TS owned-model editor: markdown I/O, structural nesting, and the snapshot load/save/memory model

> Status: implementation-grade research and proposal
>
> Date: 2026-06-26
>
> Scope:
>
> - `/home/quanghuy1242/pjs/idco/packages/editor` — the owned-model editor (TypeScript). This document covers the TypeScript evolution path only.
> - `/home/quanghuy1242/pjs/idco/packages/reader` — only where editor↔reader convergence is load-bearing (markdown export parity, checklist/nesting render).
>
> Source docs:
>
> - `docs/010_owned_model_virtualized_editor_plan.md` — the owned-model foundation, the virtualization contract, the Phase 8 input affordances.
> - `docs/018_phase_9_polish_and_deferred_parity.md` — §2.8/§2.10, the flat-list-by-design decision and the deferred-parity edges.
> - `docs/025_virtual_geometry_offset_model_and_fling.md` — the `OffsetModel` SPI + treap that made scroll O(log n).
> - `docs/021_structural_node_spi.md` / `docs/022_live_editable_table.md` — the structural container SPI that list nesting reuses.
> - `docs/028_reader_convergence_snapshot_native_dispatch.md` — the reader renders the native snapshot; the editor↔reader single-source discipline.
> - `note.md` §4 — the markdown/lists/export/publication backlog this document promotes into a plan.
>
> Related docs:
>
> - `docs/006_editor_toolbar_redesign_plan.md` §5.8/§6 — bake pipeline and publication settings (the export tier this document's markdown export must satisfy).
> - `docs/013_collaborative_owned_model_yjs_adaptation.md` / `docs/014_crdt_future_proofing_brainstorm.md` — the collaboration future the save/memory model is shaped to meet.
> - `docs/031_editor_native_rust_wasm_core.md` — the sibling document covering the `editor-native` Rust/WASM core. This document is its specification and oracle; see §5.7 and §11.
>
> Assumptions:
>
> - `compat.ts` is a temporary one-time importer for the legacy PayloadCMS-compatible Lexical JSON corpus and is slated for deletion (the file's own top banner now states this). It is NOT the save/load/serialization path and no work in this document is built on it. This is an explicit, load-bearing assumption — every workstream below is designed to outlive compat's removal.
> - The first consumer is the book platform (`../content-api`), which validates chapter content against a strict Zod node union and renders on three tiers (editor, web reader, EPUB/PDF export). A new node shape or a new serialized form is a coordinated change across editor, reader, and the host union, not a local editor concern.
> - The editor stays product-neutral and `core/**` stays framework-free (the architecture lint, docs/020). Markdown parsing and any worker plumbing live in the view/worker layer, not in `core/**`.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary: The Snapshot Spine](#2-system-summary-the-snapshot-spine)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 The Official Serialization Paths (And What Compat Actually Is)](#31-the-official-serialization-paths-and-what-compat-actually-is)
  - [3.2 The Markdown Surface Today](#32-the-markdown-surface-today)
  - [3.3 The List Model Today](#33-the-list-model-today)
  - [3.4 Virtualization, Load, Save, And Memory Today](#34-virtualization-load-save-and-memory-today)
- [4. Target Model](#4-target-model)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 D1 — Markdown Builds Native Nodes, Not Compat, Not HTML](#51-d1--markdown-builds-native-nodes-not-compat-not-html)
  - [5.2 D2 — One Bidirectional Transformer Table For Import And Export](#52-d2--one-bidirectional-transformer-table-for-import-and-export)
  - [5.3 D3 — Hybrid List Nesting: Flat By Default, Structural On Block-Child](#53-d3--hybrid-list-nesting-flat-by-default-structural-on-block-child)
  - [5.4 D4 — Save Is Incremental Over The Touched Set](#54-d4--save-is-incremental-over-the-touched-set)
  - [5.5 D5 — Load Is Chunked And Anchor-First](#55-d5--load-is-chunked-and-anchor-first)
  - [5.6 D6 — Memory Is Bounded: Bake LRU Now, Skeleton/Body Paging Later](#56-d6--memory-is-bounded-bake-lru-now-skeletonbody-paging-later)
  - [5.7 D7 — The TS Core Stays The Spec And Oracle For A Future Native Core](#57-d7--the-ts-core-stays-the-spec-and-oracle-for-a-future-native-core)
- [6. Implementation Strategy](#6-implementation-strategy)
- [7. Detailed Implementation Plan](#7-detailed-implementation-plan)
  - [7.1 Markdown Import (Paste)](#71-markdown-import-paste)
  - [7.2 Markdown Export (Custom Syntax)](#72-markdown-export-custom-syntax)
  - [7.3 Structural List Nesting](#73-structural-list-nesting)
  - [7.4 Incremental Save](#74-incremental-save)
  - [7.5 Streamed / Chunked Load](#75-streamed--chunked-load)
  - [7.6 Memory Bounding](#76-memory-bounding)
- [8. Migration And Rollout](#8-migration-and-rollout)
- [9. Edge Cases And Failure Modes](#9-edge-cases-and-failure-modes)
- [10. Implementation Backlog](#10-implementation-backlog)
- [11. Future Backlog](#11-future-backlog)
- [12. Definition Of Done](#12-definition-of-done)
- [13. Final Model](#13-final-model)

## 1. Goal

Turn the markdown/lists/export/publication backlog (`note.md` §4) and the load/save/memory discussion into one coherent plan for the TypeScript editor, built so that every piece holds after the compat layer is deleted and stays aligned with the collaboration future.

The reason these look like separate features but are one document is that they are three faces of a single object. The owned-model editor's entire reason for existing is the native document graph, serialized as `EditorDocumentSnapshot`. Markdown import is "produce a snapshot fragment from text." Markdown export is "produce text from a snapshot." Structural nesting is "what shapes a snapshot may take." Load, save, and memory are "the lifecycle and resident-set management of a snapshot." Tracking them as one plan keeps their contracts from drifting — for example, the markdown export grammar and the structural nesting model must agree on how a list-item-containing-a-code-block is both shaped and serialized, and the incremental-save mechanism and the eventual CRDT op-log must agree on what "a changed block" means.

First-release boundary: §7.1 (markdown paste), §7.3 (structural nesting), and §7.4 (incremental save) are the intended first cut. §7.2 (export), §7.5 (streamed load), and §7.6 (memory) are designed here in full so the first cut does not paint them into a corner, but they can land later.

Non-goals: the Rust/WASM `editor-native` core (its own document; this one is its specification, §5.7/§11); publication/page-layout settings (docs/006 §6, a separate workstream); and any work that depends on or extends `compat.ts` (it is being removed).

## 2. System Summary: The Snapshot Spine

There is exactly one source of truth and one serialized form, and naming it precisely is what keeps this plan from sprawling.

The runtime source of truth is `EditorStore`: a `Map<NodeId, EditorNode>` (`#nodes`), a top-level body order (`#order`), a reverse parent index (`#parentOf`), the model selection, inverse-step history, and the document settings/collections. Nodes are native — a text leaf is one string (`TextContent`) plus character-anchored range marks; a structural node holds child ids; an object node holds opaque registry data plus a baked snapshot.

The serialized form is `EditorDocumentSnapshot` (`core/model/model.ts:279-294`): `{ version: 1, body: { order, blocks }, settings, collections? }`, where `blocks` is a keyed `Record<NodeId, EditorNode>`. This single shape is the spine that every official path touches:

```text
                       EditorDocumentSnapshot  (native, keyed node map)
                                  │
   load ── createEditorStore({snapshot}) ──►  EditorStore  ──► toSnapshot() ── save
                                  │                  │
   markdown ─ tokens→EditorNode[] ─ compileInsertBlocks      │
   text ◄──── snapshot→markdown (export) ◄──────────────────┘
                                  │
   reader ── <Reader value={snapshot}> (docs/028, native dispatch)
```

The view (`view/**`, React + EditContext + DOM) is a windowed projection of the store; it never owns the document. `compat.ts` is deliberately absent from this diagram: it is a one-time side door from legacy `{root:{children}}` JSON and is being deleted. Every workstream below attaches to the spine, never to compat.

## 3. Current-State Findings

### 3.1 The Official Serialization Paths (And What Compat Actually Is)

The save path is `useAutosave` → `handle.getEditorSnapshot()` → `store.toSnapshot()` → `onSave(snapshot)` (`view/use-autosave.ts:62`, `view/use-autosave.ts:21`). `toSnapshot()` (`core/store/editor-store.ts`, the `toSnapshot()` method) is `Object.fromEntries([...#nodes.entries()].filter(id !== ROOT))` plus `order`, `settings`, and `collections` — a shallow copy of the native node map. There is no compat projection and no mark re-segmentation on save.

The load path is `createEditorStore({ snapshot })`; the constructor reads `snapshot.body.blocks` and `snapshot.body.order` directly (`core/store/editor-store.ts:404-407`, `for (const node of Object.values(options.snapshot.body.blocks)) this.#nodes.set(...)`). No compat walk.

New node construction is native: `compileInsertBlocks(store, nodes: EditorNode[])` (`core/commands/objects.ts:94`) inserts pre-built native nodes at the caret. The reader consumes the same native snapshot (`packages/reader`, docs/028).

`compat.ts` (`editorSnapshotFromCompat`, `compatFromSnapshot`) imports/exports the legacy PayloadCMS-compatible Lexical shape `{ root: { children } }` and is the one-time corpus importer plus old-editor rollback interop. The file now carries a top-of-file banner saying exactly this. The current HTML-paste path detours through `sanitizeHtmlToCompat` → `editorSnapshotFromCompat` to obtain its nodes (`view/controllers/use-clipboard.ts`, `view/paste-html.ts`); that is pre-existing debt, not a pattern to extend.

Observed fact, not inference: the engine is structured so compat can be removed without touching the store, commands, offset model, reader, or any feature in this document.

### 3.2 The Markdown Surface Today

Markdown *typing affordances* shipped in `note.md` §4.1 (2026-06-26): the pure detector `detectMarkdownShortcut` (`core/markdown-shortcuts.ts`) now covers h1–h6 prefixes, task-list prefixes (`[ ] `/`[x] `), a `MARK_PAIRS` table for `**`/`*`/`~~`/`==` plus inline-code, inline links `[text](url)`, bare-URL autolink, and line→object shortcuts (`---`/`***`/`___` → `divider`, ` ``` ` → `code-block` via the `block-object` shortcut kind). The view runs the detector after each single-character input (`view/render/text-block.tsx:174`).

What does not exist: there is no markdown *paste* (a `.md` paste lands as verbatim plain text; `use-clipboard.ts` reads only `text/html` and `text/plain`) and no markdown *export* of any kind (`toMarkdown`/`toHTML` do not exist anywhere in editor or reader). These are the two gaps §7.1 and §7.2 close.

### 3.3 The List Model Today

Lists are flat-by-design (docs/018 §2.10). A `listitem` is a `TextLeafType` (`core/model/model.ts:200`); nesting depth is a visual `attrs.indent` integer rendered as a left margin, not a containment tree. The import flattens legacy nested `<list>` into flat `listitem` leaves carrying `indent: depth` (`core/registry/flat-blocks.ts`, `flattenCompatList`).

Three facts make true nesting cheaper than it looks:

- A structural `list` node and a structural `listitem` already exist in the model (`StructuralNodeType`, `core/model/model.ts:210-216`), and a structural list renders today with per-container ordinal numbering (`view/nodes/list.tsx`, `listStructuralView`).
- The import *already promotes* a block-bearing `listitem` to a structural node holding an inner text leaf plus child block ids (`core/registry/flat-blocks.ts`, `importFlatBlock` + `importListItemChildren`). So "a list item that contains blocks" is an existing, exercised shape — it is just never produced by editing.
- The correct nesting/un-nesting algebra already exists as `compileIndentItem`/`compileOutdentItem` (`core/commands/blocks.ts:386` onward), annotated UNREACHABLE BY DESIGN because nothing user-facing creates the structural-list precondition. It builds `list` containers and moves items in/out with index-correct `move-node` steps.

The reader groups flat list runs into real `<ul>`/`<ol>` by flavour at a single level (`packages/reader/src/reader/render.tsx`, `groupListRuns`, `listFlavour`, ~507-595); the checklist convergence shipped alongside §4.3c routes `checked` runs to `RichTextCheckList`/`RichTextCheckListItem`. It does not yet read `indent` to build a nested tree.

### 3.4 Virtualization, Load, Save, And Memory Today

Scroll is solved. The `OffsetModel` SPI (`core/offset-model/index.ts`) abstracts block-index→pixel geometry; `TreapOffsetModel` (the augmented treap, docs/025) is wired in `view/controllers/use-virtual-window.ts:155`, giving O(log n) `prefix`/`findIndex`/`lowerBound`, reconciled incrementally across edits (`reconcileOffsetModel`). `FlatOffsetModel` remains as the O(n) reference oracle. The window mounts only its slice; offscreen heavy object bodies collapse to placeholders (decorator virtualization, docs/009).

Load is eager and synchronous. `createEditorStore` materializes the entire `#nodes` map and `#parentOf` index from `body.blocks` up front, on the main thread, before first paint (`core/store/editor-store.ts:404-407`). Virtualization saves the *render*, not the *model build*. For a very large document this is the dominant open-time cost and a hard main-thread stall.

Save rebuilds the whole object every time. `toSnapshot()` does `Object.fromEntries([...#nodes.entries()])` — an O(n) allocation of a new map even when one dispatch touched a single block (debounced at 1s by `useAutosave`). The store already knows what changed: `#commit` builds `state.touched: Set<NodeId>` per dispatch (`core/store/editor-store.ts`, the `MutableDispatchState`). Nothing reads that set for serialization.

Edit cost is bounded. Dispatch applies steps and records inverse steps (not full snapshots); `comparePoints` is O(tree depth) via `#pathOf`, not O(n) (the only full-tree `visit` is the debug `assertParentInvariant`). Editing does not scale with document size.

Memory is unbounded. The whole model is resident; there is no budget, no LRU, no model paging. The bake cache (baked SVG/highlighted-HTML per object) grows without eviction; re-bake is pure (`core/bake/*`, `bake.worker.ts` already exists), so it is recomputable but currently never reclaimed. The scheduler (`core/scheduler.ts`) already models lanes of async work (bake, resolve), which is the natural home for any future off-thread save/load/page work.

## 4. Target Model

Restate the spine as a design invariant and hang the three feature families on it.

Invariant: `EditorDocumentSnapshot` is the only serialized form; `EditorStore` is the only runtime truth; the view is a windowed projection; compat is excluded. Every feature is expressed as one of three verbs against the snapshot.

Produce the snapshot:

- Markdown import (§7.1) maps a markdown token stream to native `EditorNode[]` and inserts via `compileInsertBlocks`. It is a snapshot-fragment producer that shares its node-building helpers with HTML paste (which migrates off compat onto the same builder).
- Structural nesting edits (§7.3) produce snapshots whose list items may be structural containers holding arbitrary block children. The set of legal snapshot shapes widens; the persistence format does not change (structural `list`/`listitem` are already in the model union).

Consume the snapshot:

- Markdown export (§7.2) walks a snapshot and emits markdown text, reading each object's *baked* representation (docs/006 §5.8), driven by the same declarative table that powers import so editor→markdown→editor round-trips losslessly for representable nodes.
- The reader consumes the snapshot natively (docs/028); export and reader are both snapshot consumers and must agree on nesting and checklist rendering.

Bound the snapshot lifecycle:

- Save (§7.4) emits the snapshot incrementally, re-serializing only the touched keys, because `body.blocks` is already a keyed map and the store already tracks `touched`.
- Load (§7.5) materializes the snapshot in chunks, anchor-first, so first paint does not wait for the whole map.
- Memory (§7.6) holds a bounded resident set: a bake LRU first, then a skeleton/body split that pages node bodies by viewport while the offset model and parent index keep working off a compact always-resident skeleton.

The connective claim that makes this a design rather than a list: incremental save (§7.4) and viewport memory paging (§7.6) both pivot on "a changed block, by key," which is exactly the unit a CRDT op-log appends and garbage-collects (docs/013/014). Building §7.4 and §7.6 around the keyed `body.blocks` + `touched` set is therefore not only the right TS optimization, it is the shape the collaboration future needs, so the two do not have to be reconciled later.

## 5. Architecture Decisions

### 5.1 D1 — Markdown Builds Native Nodes, Not Compat, Not HTML

Recommended: parse markdown to a token stream with `markdown-it` (CommonMark + GFM, synchronous; confirmed current via Context7 on 2026-06-26), then map tokens to native `EditorNode[]` and insert with `compileInsertBlocks`. Marks are built natively (`makeTextNode` with `TextMark[]` whose boundaries come from `boundaryAtOffset` over the leaf's `TextContent`), exactly as the model already represents inline formatting.

Rejected — route through compat AST (`tokens → {root:{children}} → editorSnapshotFromCompat`): compat is being deleted; building a new feature on it inverts the dependency we are trying to remove, and it is the mistake this codebase has repeatedly made. Excluded on principle, not on performance.

Rejected — `markdown → HTML → sanitizeHtmlToCompat`: double-parse (markdown→HTML string→DOM→nodes), and it inherits compat through the back door. The HTML detour also drops tables, images, and nested lists today (`view/paste-html.ts` `BLOCK_TAGS`). The only thing it reuses that is worth reusing — model construction and href sanitization — already exists on the native side (`compileInsertBlocks`, `safeHref`), so the HTML hop buys nothing.

Consequence: HTML paste should migrate onto the same native node-builder so compat loses its last non-legacy caller. That is in scope as a follow-on, not a blocker.

### 5.2 D2 — One Bidirectional Transformer Table For Import And Export

Recommended: express the markdown↔node mapping as a single declarative table of transformers (block transformers, inline/mark transformers, and per-object transformers), keyed by node type / mark kind / token type, with both a `fromTokens` and a `toMarkdown` direction. Import (§7.1) reads the `fromTokens` side; export (§7.2) reads the `toMarkdown` side. Objects contribute their own transformer through the node registry so a `callout` serializes as a `:::note` directive, a `code-block`/`mermaid` as a fenced block, a `divider` as `---`, and a `media` as an image — and each reads its *baked* fields only (docs/006 §5.8), never a live/computed value the export tier cannot reproduce.

Why bidirectional and not two independent mappers: round-trip correctness is a property of one table, not two. If import and export are separate code, `editor → md → editor` drifts silently; one table makes the round-trip a single maintained invariant with a documented lossy set (nodes with no markdown analog). This is also why export is designed now even though it ships later — the import table must be shaped to carry the export direction.

### 5.3 D3 — Hybrid List Nesting: Flat By Default, Structural On Block-Child

Recommended: keep plain lists as flat `listitem` leaves (virtualized per item, the docs/018 §2.10 win), and *promote* a list item to a structural `listitem` container the moment it gains a block child — a nested sub-list, a code block, a table, a callout. This is the exact shape the import already produces for legacy mixed items (§3.3), so the persistence format and the render dispatch already support it; only the editing commands are missing. A structural `listitem` is a scope, and `block-dispatch` already recurses over any child type, so "a code block inside a list item" needs no per-child special-casing.

Rejected — pure structural always: every list becomes a containment tree, so a 10,000-item flat list loses per-item windowing and pays recursive-window cost for content that never needed it.

Rejected — pure flat with synthesize-only nesting (reconstruct a tree from `indent` at render/serialize time, never store structure): correct and cheap for single-block-per-item nesting and worth doing for the *reader/export* tree reconstruction, but it cannot represent a list item that *contains* a code block or table — which is the capability explicitly wanted. Synthesis handles the visual tree; it does not handle block-bearing items. The hybrid keeps synthesis for plain nested lists and adds structural promotion for block-bearing items, getting both.

Open decision to settle with the host before building the export target: whether the content-api Zod union accepts nested `<list>` structure or flat `listitem`+`indent`. Either way the synthesize step (for plain nesting) and the structural promotion (for block-bearing items) produce a tree at the compat/native boundary; the host schema only decides the export target shape.

### 5.4 D4 — Save Is Incremental Over The Touched Set

Recommended: maintain the persisted snapshot incrementally. Keep a long-lived snapshot object and, on each dispatch, clone-on-write only the `touched` keys into `body.blocks` while structurally sharing the rest; `toSnapshot()` becomes O(changed). Because `body.blocks` is a keyed `Record`, the host's `onSave` can also persist changed keys rather than a blob when its backend supports it.

Rejected — keep the full `Object.fromEntries` rebuild: O(n) allocation per save for an O(1)-changed edit, the exact waste this removes.

Rejected — route save through compat: not the save path at all; see D1.

The deliberate constraint: "changed block, by key" is defined identically here and in the CRDT op-log future, so this is not a throwaway optimization.

### 5.5 D5 — Load Is Chunked And Anchor-First

Recommended: build the store from the snapshot in chunks. Materialize the always-resident skeleton (order, parent index, per-block seed heights, ids) and the nodes in or near the initial viewport anchor first, paint, then hydrate the remaining node bodies during idle time or on scroll-in. The anchor (scroll position / a deep-link target) picks the first chunk. The offset model only needs the skeleton to place the window, so first paint does not wait for the full map.

Rejected — keep eager synchronous full build: a hard main-thread stall proportional to node+mark count on open, regardless of how little is visible.

Dependency: this shares its resident-set machinery with §7.6 (memory). Chunked load is "materialize the resident set incrementally"; memory paging is "keep the resident set bounded thereafter." Build the skeleton/body split once (§7.6) and load consumes it.

### 5.6 D6 — Memory Is Bounded: Bake LRU Now, Skeleton/Body Paging Later

Recommended, in two stages. Stage one (cheap, isolated): put a size-bounded LRU on the bake cache and evict offscreen baked snapshots; re-bake is pure (`core/bake/*`), so eviction is free correctness-wise and reclaims the largest unbounded allocator. Stage two (the real model-virtualization): split each node into a skeleton (id, order position, height, parent — tiny, always resident) and a body (`TextContent`, marks, object `data` — the memory cost), hold bodies in a viewport-keyed LRU, page evicted bodies to a serialized buffer / IndexedDB, and re-materialize on scroll-in. The offset model, `#parentOf`, and `comparePoints` already operate without touching bodies, so they keep working off the skeleton; decorator virtualization (docs/009) is the existing precedent for dropping offscreen heavy *bodies* for render — this extends the same idea to memory.

Rejected — leave memory unbounded: fine until it is not; for book-scale documents the resident model is the floor and there is no relief valve.

### 5.7 D7 — The TS Core Stays The Spec And Oracle For A Future Native Core

Recommended: treat every decision above as the executable specification for a possible `editor-native` (Rust/WASM) core, and keep the boundary clean so the core can be swapped behind the existing view↔core seam rather than ported layer by layer. Concretely: keep `core/**` framework-free (already lint-enforced), keep the offset model an interface with a reference implementation (already true: `FlatOffsetModel` is the treap's oracle), and shape the snapshot/save/load contracts (D4/D5) so a native core can satisfy them with binary serialization and incremental-by-key persistence without changing `EditorDocumentSnapshot` or `onSave`. The native core is a separate document; this one is its parity target.

This is a decision recorded to constrain the TS work, not a commitment to build the native core. It costs nothing now and prevents the TS implementation from making choices (e.g., putting serialization logic where a native core could not reach it) that would force a rewrite later.

## 6. Implementation Strategy

Sequence so each phase is independently reviewable, testable, and green under `pnpm check`, and so the compat sunset is never blocked.

Phase 1 — markdown paste (§7.1). Self-contained: a new view-layer parser, a native node-builder, and a `text/markdown`/`text/plain` branch in `use-clipboard.ts`. No core changes beyond possibly a small native leaf-with-marks helper. Lands the most felt gap and establishes the transformer table that §7.2 reuses.

Phase 2 — structural list nesting (§7.3). Revive and reach `compileIndentItem`/`compileOutdentItem`, add the promote-on-block-child trigger, extend the reader/export to reconstruct/emit nested trees, and decide the virtualization policy for nested content. Reuses the structural SPI and caret-navigation machinery callout already proved.

Phase 3 — incremental save (§7.4). Replace the full-rebuild `toSnapshot()` with a touched-set-driven incremental snapshot. Pure mechanics, behind the existing `getEditorSnapshot()`/`onSave` contract, with parity against the current full snapshot.

Phase 4 — markdown export (§7.2). The `toMarkdown` direction of the Phase 1 table, with object transformers reading baked fields. Pairs with copy-as-markdown.

Phase 5 — streamed load and memory bounding (§7.5/§7.6). The skeleton/body split serves both; stage-one bake LRU can land independently and early as a quick win.

Compatibility and deletion: nothing in Phases 1–5 reads or writes `compat.ts`. The HTML-paste migration onto the native builder (a §7.1 follow-on) removes compat's last non-legacy caller; after the corpus migration, `compat.ts` and `payload-import.ts` are deletable, and the parity tests that currently exercise the compat round-trip are repointed at the native `toSnapshot`/`createEditorStore` round-trip.

## 7. Detailed Implementation Plan

### 7.1 Markdown Import (Paste)

Current problem: pasting markdown inserts verbatim plain text (`view/controllers/use-clipboard.ts` reads only `text/html` and `text/plain` and dispatches `insert-text`); the §4.1 typing detector fires only on single-character input (`view/render/text-block.tsx:174`), so it never helps paste.

Target behavior: pasting a markdown document (from a `text/markdown` clipboard type, or a `text/plain` payload that is heuristically markdown) produces a native node fragment inserted at the caret, matching the inline marks the typing path already supports (including `==highlight==` and task lists).

Implementation tasks:

- [ ] Add `markdown-it` (+ `markdown-it-mark` for `==`, `markdown-it-task-lists` for checkboxes) as a view-layer dependency; keep it out of `core/**`.
- [ ] Add `view/markdown/from-markdown.ts`: `markdownToNodes(src: string, allocator, registry): EditorNode[]`. Walk the `markdown-it` token stream (flat stream with `nesting` ±1) with a stack to build blocks; map block tokens to `makeTextNode`/`makeStructuralNode`/`makeObjectNode`; map inline tokens to a `TextContent` plus `TextMark[]` whose boundaries are `boundaryAtOffset(content, offset, stickiness)`. Sanitize link hrefs with `safeHref`.
- [ ] Express the mapping as the import direction of the D2 transformer table (`view/markdown/transformers.ts`) so §7.2 reuses it.
- [ ] In `use-clipboard.ts`, add a `text/markdown` branch and an opt-in heuristic `text/plain`→markdown branch, calling `markdownToNodes` then `compileInsertBlocks`.
- [ ] Add a small native helper if one does not exist: build a `listitem`/`paragraph` leaf with mark ranges from `(text, ranges)` so both this and the future HTML migration share it.

Edge cases: an unsafe link href clears to plain text via `safeHref`; a fenced code block becomes a `code-block` object with its language; a GFM task list maps to `listitem` with `checked` (the §4.3c shape); a markdown table maps to the `table` structural node (or, if deferred, is dropped with a logged note rather than silently); raw HTML in the markdown is escaped by `markdown-it`'s `html:false` default and never reaches the DOM.

Tests: `tests/editor/engine-markdown-paste.test.ts` — headings/lists/marks/links/fence/task-list each parse to the expected native nodes; a `javascript:` link is neutralized; `editor → md → editor` is asserted lossless for the representable set once §7.2 lands (cross-referenced parity test).

### 7.2 Markdown Export (Custom Syntax)

Current problem: no `toMarkdown`/`toHTML` exists; copy/cut write `text/plain` only (`view/controllers/use-clipboard.ts`), so an editor→editor paste downgrades to plain text and there is no markdown output at all.

Target behavior: a pure `snapshotToMarkdown(snapshot): string` that walks `body.order`/`body.blocks`, emits markdown for standard nodes, and delegates each object to its registered transformer, reading only baked fields. Copy/cut additionally write `text/markdown`.

Implementation tasks:

- [ ] Add `view/markdown/to-markdown.ts`: `snapshotToMarkdown` walking the snapshot, using the `toMarkdown` direction of the D2 table.
- [ ] Add a per-object `toMarkdown(node)` seam on the node registry (`core/registry/object-registry.ts` definition shape) returning a string from the object's baked fields; built-ins: `divider`→`---`, `code-block`→fenced with language, `callout`→`:::tone` directive, `media`→`![alt](src)`, `table`→GFM table from baked cells, `mermaid`→fenced ```mermaid```.
- [ ] Define the custom directive grammar once (the `:::tone` callout form and any other non-CommonMark object syntax) and document it inline as the export contract; ensure §7.1's import recognizes the same directives.
- [ ] Wire `text/markdown` into copy/cut alongside `text/plain`.

Edge cases: a node with no markdown analog and no directive is emitted as an HTML comment placeholder or omitted per a documented lossy set, never silently corrupting surrounding structure; nested lists emit correct indentation from the §7.3 tree; an object whose bake is missing/invalid emits its placeholder, never a live-computed value (docs/006 §5.8).

Tests: `tests/editor/engine-markdown-export.test.ts` — each node type emits expected markdown; round-trip `md → nodes → md` is stable for the representable set; the lossy set is asserted explicitly.

### 7.3 Structural List Nesting

Current problem: nesting is visual-only (`attrs.indent` margin); the structural nesting algebra (`compileIndentItem`/`compileOutdentItem`, `core/commands/blocks.ts:386+`) is UNREACHABLE because nothing produces the structural-list precondition; a list item cannot contain a code block or table from the editing surface; the reader/export render a single flat level.

Target behavior: indent/outdent build real nesting; dropping or inserting a block under a list item promotes that item to a structural `listitem` container (the existing import shape); plain nested lists still render and serialize as a proper tree; the reader and export emit nested `<ul>/<ol>` and nested markdown.

Implementation tasks:

- [ ] Reach the nesting algebra: make `compileIndent`/`compileOutdent` (`core/commands/blocks.ts:310`) build the structural-list precondition for flat top-level items (promote a flat run into a structural `list` when an item indents under its predecessor), so `compileIndentItem` stops being dead.
- [ ] Add the promote-on-block-child trigger: inserting/dropping a block (code-block, table, sub-list) onto a `listitem` converts that leaf to a structural `listitem` holding an inner text leaf plus the block child — the exact `importListItemChildren` shape (`core/registry/flat-blocks.ts`), so import and edit produce identical structures.
- [ ] Caret navigation: reuse the structural-container + gap-cursor walk (the callout path, docs/021) so arrows enter/exit a nested block.
- [ ] Reader: extend `groupListRuns`/`renderUnit` (`packages/reader/src/reader/render.tsx`) to reconstruct a nested tree from `indent` for plain lists and to render structural `listitem` children for block-bearing items; keep the §4.3c checklist routing.
- [ ] Export (§7.2): emit nested markdown from the same tree.
- [ ] Virtualization policy: decide and document that nested content inside a structural item renders within the container subtree (not independently windowed) for first release; record the recursive-windowing option as future work (and as a native-core motivation, §5.7).

Edge cases: outdenting the last item of a sublist drops the now-empty `list`/`listitem` container (the algebra already handles this, `compileOutdentItem`); a structural item with a single text child and no blocks demotes back to a flat leaf so the model never accumulates degenerate containers; ordered numbering is per-container (`listStructuralView` already numbers its own children); mixed checklist/bullet items split into separate runs (the `listFlavour` rule).

Tests: `tests/editor/engine-list-nesting.test.ts` — indent builds a structural list; a code block under an item promotes it; outdent demotes and cleans up; `tests/reader.test.tsx` — nested `<ul>`/`<ol>` render with correct depth and numbering; round-trip through `toSnapshot`/`createEditorStore` preserves the tree.

### 7.4 Incremental Save

Current problem: `toSnapshot()` (`core/store/editor-store.ts`) rebuilds the entire `body.blocks` object every call via `Object.fromEntries([...#nodes.entries()])`, O(n) per save even for a one-block edit; the `touched` set computed in `#commit` is unused for serialization.

Target behavior: `toSnapshot()` returns a snapshot whose `body.blocks` is maintained incrementally — only touched keys are re-emitted, the rest structurally shared — so save cost is O(changed).

Implementation tasks:

- [ ] Maintain a persistent `#snapshotBlocks` (or equivalent) updated in `#commit` from `state.touched`: clone-on-write touched keys, delete removed keys, share the rest.
- [ ] `toSnapshot()` returns the maintained object (plus `order`/`settings`/`collections`) instead of rebuilding; keep `version`/`collections` omission rules (docs/027 §5.4) byte-identical.
- [ ] Assert parity: the incremental snapshot deep-equals a full rebuild after an arbitrary edit sequence.
- [ ] Optional: expose changed-keys to `onSave` for hosts that persist per-key (keeps the blob path as default).

Edge cases: undo/redo must update the maintained map from the inverse steps' touched set, not bypass it; a no-op dispatch (`recordHistory:false` resolve/SWR updates, docs/026) must still reflect a genuine data change in the map but not churn untouched keys; structural moves touch parents and children consistently.

Tests: `tests/editor/engine-incremental-save.test.ts` — incremental `toSnapshot` deep-equals full rebuild across inserts/removes/moves/undo/redo; the touched-key set drives exactly the re-emitted keys.

### 7.5 Streamed / Chunked Load

Current problem: `createEditorStore` materializes the entire node map and parent index up front, synchronously, before first paint (`core/store/editor-store.ts:404-407`).

Target behavior: first paint after materializing the skeleton plus the anchor chunk; remaining node bodies hydrate during idle/on scroll-in.

Implementation tasks:

- [ ] Build the skeleton (order, parent index, seed heights, ids) from the snapshot first; this is all the offset model needs to place the initial window.
- [ ] Materialize node bodies for the anchor window synchronously; schedule the rest through the scheduler (`core/scheduler.ts`, a new load lane) in idle slices.
- [ ] Hydrate-on-access: a body requested before its chunk lands is materialized on demand (a read fault), so correctness never depends on hydration order.
- [ ] Share the skeleton/body representation with §7.6.

Edge cases: an edit landing before full hydration must force-materialize the affected bodies; selection/`comparePoints` over a not-yet-hydrated node must hydrate or operate off the skeleton path; deep-link to a late node forces its chunk first.

Tests: `tests/editor/engine-chunked-load.test.ts` — first window renders before full materialization; a read fault hydrates correctly; an early edit forces materialization; final state equals the eager build.

### 7.6 Memory Bounding

Current problem: the model and bake cache are fully resident and unbounded; the bake cache never evicts.

Target behavior: a bounded resident set — bake LRU first, then viewport-keyed body paging — while the skeleton stays resident and the offset model/parent index keep working.

Implementation tasks:

- [ ] Stage one: a size-bounded LRU on baked snapshots; evict offscreen bakes; re-bake on demand via the existing pure baker (`core/bake/*`, `bake.worker.ts`).
- [ ] Stage two: the skeleton/body split (shared with §7.5); a viewport-keyed body LRU; page evicted bodies to a serialized buffer / IndexedDB; re-materialize on scroll-in.
- [ ] Keep `#parentOf`, `comparePoints`, and the offset model operating off the skeleton (they already do not touch bodies).
- [ ] A configurable memory budget surfaced on `EditorStoreOptions`.

Edge cases: a paged-out body that is part of the current selection must stay resident (pin the selection's bodies); an edit to a paged-out body faults it in first; persistence (§7.4) must serialize from bodies, faulting any paged-out touched body before save.

Tests: `tests/editor/engine-memory-budget.test.ts` — resident body count stays within budget while scrolling a large document; a pinned selection body is never evicted; a faulted-in body matches its pre-eviction content.

## 8. Migration And Rollout

Compat sunset is the rollout's spine. None of §7 reads or writes `compat.ts`. The §7.1 follow-on (migrate HTML paste onto the native node-builder) removes compat's last non-legacy caller. After the corpus migration completes and the persisted shape is `EditorDocumentSnapshot`, `compat.ts` and `payload-import.ts` are deleted, and the round-trip parity tests are repointed from the compat round-trip to the native `toSnapshot`/`createEditorStore` round-trip.

Feature flags: markdown paste and markdown export are behind host-supplied capability (paste branch is inert if no `text/markdown` and the plain-text heuristic is off); structural nesting ships behind a profile flag if the host's Zod union is not yet ready to accept nested/structural list nodes (the schema-profile gate, docs/018 item 6, already exists for exactly this).

Deployment order: ship Phases 1–4 to the editor with no host schema change required for paste/export/save; coordinate the structural-nesting schema target (§5.3 open decision) with content-api before enabling nesting persistence; ship §7.5/§7.6 last, behind a memory-budget option that defaults to "unbounded" (today's behavior) until measured.

Rollback: each phase is independently revertible because each attaches to the snapshot spine, not to the others. Incremental save (§7.4) ships behind a parity assertion against the full rebuild, so a mismatch falls back to the full rebuild rather than risking a corrupt save.

## 9. Edge Cases And Failure Modes

- Unsafe markdown link (`javascript:`): `safeHref` clears it on import; the run stays plain text. Operator-invisible; author sees no link.
- Markdown table on paste before §7.3 table-import lands: dropped with a logged note, never silently mangled into cell text.
- Fenced code with no language: imports as a `code-block` with empty language; exports as a bare ```` ``` ```` fence.
- Structural list item demotion: a structural `listitem` reduced to a single text child and no blocks demotes to a flat leaf so the model never carries degenerate containers.
- Incremental save divergence: a parity assertion against the full rebuild catches any touched-set bug; on mismatch, fall back to full rebuild and surface a dev-only error.
- Chunked-load read fault during an edit: the affected bodies are force-materialized before the step applies; correctness never depends on hydration order.
- Paged-out selection body: pinned and never evicted; an edit to a paged-out body faults it in first.
- Save while bodies are paged out: any touched paged-out body is faulted in before serialization so the snapshot is complete.
- Compat deletion drift: the repointed native round-trip parity test must be green before `compat.ts` is removed; the file banner and the `compat-is-temporary-not-official-path` memory guard against re-introducing a dependency.

## 10. Implementation Backlog

### R1-A. Markdown Paste

Scope:

- `packages/editor/src/view/markdown/from-markdown.ts`
- `packages/editor/src/view/markdown/transformers.ts`
- `packages/editor/src/view/controllers/use-clipboard.ts`
- `packages/editor/package.json` (markdown-it + plugins)

Tasks:

- [ ] Token-stream→native-nodes mapper with native mark construction.
- [ ] `text/markdown` and opt-in `text/plain`-heuristic branches calling `compileInsertBlocks`.
- [ ] Shared leaf-with-marks helper.

Acceptance criteria:

- Pasting a markdown document produces the expected native node fragment, including task lists and `==highlight==`.
- No code path added here references `compat.ts`.

Tests:

- `tests/editor/engine-markdown-paste.test.ts`

### R1-B. Structural List Nesting

Scope:

- `packages/editor/src/core/commands/blocks.ts`
- `packages/editor/src/core/registry/flat-blocks.ts`
- `packages/reader/src/reader/render.tsx`

Tasks:

- [ ] Reach `compileIndentItem`/`compileOutdentItem`; build the structural-list precondition on indent.
- [ ] Promote-on-block-child trigger producing the `importListItemChildren` shape.
- [ ] Reader nested-tree reconstruction + structural-item children; keep checklist routing.

Acceptance criteria:

- Indent builds real nesting; a code block can live inside a list item; outdent demotes and cleans up; reader/export emit a correct nested tree.

Tests:

- `tests/editor/engine-list-nesting.test.ts`, `tests/reader.test.tsx`

### R1-C. Incremental Save

Scope:

- `packages/editor/src/core/store/editor-store.ts`

Tasks:

- [ ] Maintain `body.blocks` from `state.touched`; `toSnapshot()` returns the maintained object.
- [ ] Parity assertion vs full rebuild; undo/redo update the map from inverse touched.

Acceptance criteria:

- `toSnapshot()` is O(changed) and deep-equals the full rebuild across arbitrary edit/undo/redo sequences.

Tests:

- `tests/editor/engine-incremental-save.test.ts`

### R2-A. Markdown Export

Scope:

- `packages/editor/src/view/markdown/to-markdown.ts`
- `packages/editor/src/core/registry/object-registry.ts` (per-object `toMarkdown` seam)
- `packages/editor/src/view/controllers/use-clipboard.ts` (copy/cut `text/markdown`)

Tasks:

- [ ] `snapshotToMarkdown` over the D2 table; per-object transformers reading baked fields; directive grammar.
- [ ] Copy/cut write `text/markdown`.

Acceptance criteria:

- Each node type emits expected markdown; `md → nodes → md` stable for the representable set; lossy set documented and asserted.

Tests:

- `tests/editor/engine-markdown-export.test.ts`

### R2-B. Bake LRU (Memory Stage One)

Scope:

- `packages/editor/src/core/bake/*`

Tasks:

- [ ] Size-bounded LRU on baked snapshots; evict offscreen; re-bake on demand.

Acceptance criteria:

- Bake-cache memory stays within budget while scrolling; evicted bakes regenerate identically.

Tests:

- `tests/editor/engine-bake-lru.test.ts`

### R3-A. Chunked Load + Body Paging (Memory Stage Two)

Scope:

- `packages/editor/src/core/store/editor-store.ts`
- `packages/editor/src/core/scheduler.ts`

Tasks:

- [ ] Skeleton/body split; anchor-first materialization; idle hydration lane; read-fault hydration; viewport body LRU; page-out to a serialized buffer / IndexedDB; memory budget option.

Acceptance criteria:

- First window paints before full materialization; resident body count stays within budget; selection bodies are pinned; final state equals the eager build.

Tests:

- `tests/editor/engine-chunked-load.test.ts`, `tests/editor/engine-memory-budget.test.ts`

## 11. Future Backlog

- Recursive windowing of nested structural content (so a huge sub-list inside one item is itself virtualized) — deferred from §7.3; a strong motivation for the native core (§5.7).
- Ordered-list arbitrary start number and bullet/number style variants (`note.md` §4.3d).
- Code-fence language capture on the typing path and input redirection into the new code block (deferred from the shipped §4.1 line→object work).
- Checklist-item indent in the reader render (the live editor already indents).
- HTML-paste migration onto the native node-builder (removes compat's last non-legacy caller) — strictly a follow-on to R1-A.
- Page/publication settings (docs/006 §6) — a separate workstream that also hangs on the snapshot's `settings` field.
- `editor-native` Rust/WASM core — `docs/031_editor_native_rust_wasm_core.md`; this document is its parity spec (§5.7). The CRDT op-log (docs/013/014) folds incremental save (§7.4) and memory paging (§7.6) into one foundation when collaboration lands.

## 12. Definition Of Done

- Markdown paste produces native nodes (no compat reference), with task lists and the full §4.1 inline set; `tests/editor/engine-markdown-paste.test.ts` green.
- Structural nesting builds real trees and holds arbitrary block children; the reader and export emit correct nested output; nesting round-trips through `toSnapshot`/`createEditorStore`; `engine-list-nesting` and the reader nesting tests green.
- `toSnapshot()` is incremental and deep-equals the full rebuild across arbitrary edit/undo/redo; `engine-incremental-save` green.
- Markdown export round-trips for the representable set with a documented lossy set; copy/cut write `text/markdown`; `engine-markdown-export` green.
- Bake LRU and (when shipped) body paging keep the resident set within a configured budget while scrolling a large document; the memory tests green.
- `pnpm check` is green for every phase (format, lint, dup, semantic-dup, typecheck, test, build).
- No workstream references `compat.ts`; the compat round-trip parity test is repointed at the native round-trip ahead of compat deletion.
- `note.md` §4 resolution updated to point at this document; the relevant memories updated.

## 13. Final Model

The TypeScript editor evolves as a single object viewed three ways. `EditorDocumentSnapshot` — a keyed map of native nodes — is the only serialized form and the only runtime truth, with `toSnapshot()` and `createEditorStore({snapshot})` as its sole official ends and `compat.ts` excluded as a deletable legacy side door. Markdown import and export are the snapshot's text producer and consumer, driven by one bidirectional transformer table that builds native nodes directly and reads baked object fields, never HTML and never compat. Structural nesting widens the snapshot's legal shapes — a list item is a scope that may hold a code block, a table, or a sub-list — by promoting flat items to the structural-container shape the import already produces, while plain lists stay flat and virtualized. Load, save, and memory are the snapshot's lifecycle: streamed in anchor-first, written out incrementally by touched key, and held in a bounded resident set over an always-resident skeleton. Because "a changed block, by key" is the unit shared by incremental save, viewport paging, and the future CRDT op-log, the optimizations that make large documents tractable today are the same ones that make collaboration tractable tomorrow, and because the whole core stays framework-free with the snapshot contracts placed where a native core can satisfy them, this plan is simultaneously the TypeScript roadmap and the specification a Rust `editor-native` core would be measured against.
