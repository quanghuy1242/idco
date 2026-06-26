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
  - [5.2 D2 — Import And Export Are Separate; Export Is Lossy One-Way](#52-d2--import-and-export-are-separate-export-is-lossy-one-way)
  - [5.3 D3 — Structural Nesting, Attached At Body Order So Flat Siblings Stay Windowed (Option A)](#53-d3--structural-nesting-attached-at-body-order-so-flat-siblings-stay-windowed-option-a)
  - [5.4 D4 — Save Is Incremental Over The Touched Set](#54-d4--save-is-incremental-over-the-touched-set)
  - [5.5 D5 — Optimize Load In Place First; Lazy Load Falls Out Of Paging](#55-d5--optimize-load-in-place-first-lazy-load-falls-out-of-paging)
  - [5.6 D6 — Memory Is A Soft Budget: An Arbiter Over Pools, Purging Bodies To A Cold Store](#56-d6--memory-is-a-soft-budget-an-arbiter-over-pools-purging-bodies-to-a-cold-store)
  - [5.7 D7 — The TS Core Stays The Spec And Oracle For A Future Native Core](#57-d7--the-ts-core-stays-the-spec-and-oracle-for-a-future-native-core)
- [6. Implementation Strategy](#6-implementation-strategy)
- [7. Detailed Implementation Plan](#7-detailed-implementation-plan)
  - [7.1 Markdown Import (Paste)](#71-markdown-import-paste)
  - [7.2 Markdown Export (Custom Syntax)](#72-markdown-export-custom-syntax)
  - [7.3 Structural List Nesting](#73-structural-list-nesting)
  - [7.4 Incremental Save](#74-incremental-save)
  - [7.5 Load: In-Place Optimization, Then Lazy Via Paging](#75-load-in-place-optimization-then-lazy-via-paging)
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

First-release boundary: §7.1 (markdown paste), §7.3 (structural nesting), and §7.4 (incremental save) are the intended first cut, alongside the cheap step-zero load optimization (§7.5). §7.2 (lossy export + native clipboard), the lazy-load consequence of §7.5, and §7.6 (memory budget) are designed here in full so the first cut does not paint them into a corner, but they can land later.

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

Markdown *typing affordances* shipped in `note.md` §4.1 (2026-06-26): the pure detector `detectMarkdownShortcut` (`core/markdown-shortcuts.ts`) now covers h1–h6 prefixes, task-list prefixes (`[ ] `/`[x] `), a `MARK_PAIRS` table for `**`/`*`/`~~`/`==` plus inline-code, inline links `[text](url)`, bare-URL autolink (trailing-punctuation-trimmed, GFM-style), and line→object shortcuts (`---`/`***`/`___` → `divider`, ` ``` ` → `code-block` via the `block-object` shortcut kind). The view runs the detector after each single-character input (`view/render/text-block.tsx:174`). The ` ``` ` → `code-block` affordance now drills the caret into the new code surface on creation (the `activateOnInsert` NodeView flag + `activateInsertedObject`, shared with the slash/insert palette); only code-fence *language* capture on the typing path remains (§11).

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
- Structural nesting edits (§7.3) produce snapshots whose list items may be structural containers holding arbitrary block children, attached the Option A way (D3): a promoted structural `listitem` sits at `body.order` beside flat windowed `listitem` leaves, so un-nested lists keep per-item windowing and only the nested subtree mounts as a unit. The set of legal snapshot shapes widens (a structural `listitem` may sit directly in body order); the persistence format does not otherwise change (structural `list`/`listitem` are already in the model union).

Consume the snapshot:

- Markdown export (§7.2) walks a snapshot and emits markdown text, reading each object's *baked* representation (docs/006 §5.8) through a view-layer transformer — a *lossy one-way* projection to an open format with a documented lossy set, not a round-trip guarantee (D2). Lossless editor→editor copy/paste rides the native snapshot fragment on a custom clipboard type, not markdown.
- The reader consumes the snapshot natively (docs/028); export and reader are both snapshot consumers and must agree on nesting and checklist rendering.

Bound the snapshot lifecycle:

- Save (§7.4) emits the snapshot incrementally, re-serializing only the touched keys, because `body.blocks` is already a keyed map and the store already tracks `touched`.
- Load (§7.5) is optimized in place first — gate the dev invariants (`assertParentInvariant`/`freezeNode`) out of the production build, measure, and only then let lazy load arrive as the cold-start of §7.6 paging rather than a separate chunked-load feature.
- Memory (§7.6) holds a calibrated *soft* budget (a hard byte cap is undeliverable in pure JS): a budget arbiter over typed pools — a skeleton/body split purging cold bodies to an injected `BodyStore`, a bake LRU, and a history pool — while the offset model and parent index keep working off a compact always-resident skeleton. The hard-cap path is the native arena (docs/031 §N7).

The connective claim that makes this a design rather than a list: incremental save (§7.4) and viewport memory paging (§7.6) both pivot on "a changed block, by key," which is exactly the unit a CRDT op-log appends and garbage-collects (docs/013/014). Building §7.4 and §7.6 around the keyed `body.blocks` + `touched` set is therefore not only the right TS optimization, it is the shape the collaboration future needs, so the two do not have to be reconciled later.

## 5. Architecture Decisions

### 5.1 D1 — Markdown Builds Native Nodes, Not Compat, Not HTML

Recommended: parse markdown to a token stream with `markdown-it` (CommonMark + GFM, synchronous; confirmed current via Context7 on 2026-06-26), then map tokens to native `EditorNode[]` and insert with `compileInsertBlocks`. Marks are built natively (`makeTextNode` with `TextMark[]` whose boundaries come from `boundaryAtOffset` over the leaf's `TextContent`), exactly as the model already represents inline formatting.

Rejected — route through compat AST (`tokens → {root:{children}} → editorSnapshotFromCompat`): compat is being deleted; building a new feature on it inverts the dependency we are trying to remove, and it is the mistake this codebase has repeatedly made. Excluded on principle, not on performance.

Rejected — `markdown → HTML → sanitizeHtmlToCompat`: double-parse (markdown→HTML string→DOM→nodes), and it inherits compat through the back door. The HTML detour also drops tables, images, and nested lists today (`view/paste-html.ts` `BLOCK_TAGS`). The only thing it reuses that is worth reusing — model construction and href sanitization — already exists on the native side (`compileInsertBlocks`, `safeHref`), so the HTML hop buys nothing.

Consequence: HTML paste should migrate onto the same native node-builder so compat loses its last non-legacy caller. That is in scope as a follow-on, not a blocker.

### 5.2 D2 — Import And Export Are Separate; Export Is Lossy One-Way

Recommended: treat markdown import and markdown export as two separate mappers that share a single declarative *type↔syntax correspondence* (the spec of which node type / mark kind maps to which markdown construct), not one bidirectional table of paired functions. Import (§7.1) reads tokens and builds native `EditorNode[]`; export (§7.2) reads a snapshot and emits text. They agree because they consult the same correspondence and a round-trip test pins the representable set — the guarantee is a property enforced by a test, not by forcing both directions through one code object. The two operations have genuinely different shapes (import needs the allocator + registry to construct nodes; export reads each object's *baked* fields, docs/006 §5.8, and builds strings), so one literal table makes them awkward without buying anything the shared spec + round-trip test does not.

Export is a lossy one-way projection to an open format, by design — the xlsx→xls / "save to an open format" model. It emits the best representable markdown and *drops what markdown cannot carry* (merged table cells, comment/glossary marks, object internals with no markdown analog), with an explicit, documented lossy set. It is not a round-trip-lossless guarantee and must never pretend to be: a node with no analog is emitted as a documented placeholder or omitted, never silently mangled into surrounding structure.

The lossless path is the native clipboard, not markdown. For editor→editor copy/paste, the clipboard carries the native snapshot fragment under a custom type (`application/x-idco-snapshot`) — lossless, marks and object data intact — and markdown is the *interop/open* format for leaving the app (the Google-Docs pattern: own format plus a portable one). This is what removes the pressure that made bidirectional markdown seem necessary: internal fidelity rides the native clipboard, so export's lossiness never degrades an in-app workflow.

Per-object export transformers live in the view layer (a view-side table keyed by node type, or the `NodeView`), not on the core object registry — markdown stays out of `core/**` per this document's own assumption (§the assumptions block). Built-in object exports: `divider`→`---`, `code-block`/`mermaid`→fenced block with language, `callout`→`:::tone` directive, `media`→`![alt](src)`, `table`→GFM table from baked cells (merged cells dropped to the lossy set). Each reads baked fields only, never a live/computed value the export tier cannot reproduce.

### 5.3 D3 — Structural Nesting, Attached At Body Order So Flat Siblings Stay Windowed (Option A)

Recommended: real structural nesting (indent/outdent build a containment tree, and a list item may hold a code block, table, or sub-list), but attached so the common case keeps its windowing. The mechanics already exist: `compileIndentItem`/`compileOutdentItem` (`core/commands/blocks.ts:614+`) operate *inside* a structural `list`, building/reusing sublist containers with index-correct `move-node` steps; the only missing piece is how the *first* structure is created from flat body-level leaves. That choice is the whole design, because virtualization windows over the *top-level* `body.order` — each top-level block is one mount unit, and nothing inside a top-level block is independently windowed (when a block scrolls in, its whole subtree mounts). So structural nesting never breaks windowing for *un-nested* lists (their items stay top-level leaves); it only decides how much windowing a *nested* list keeps.

Build **Option A**: promote only the parent item to a structural `listitem` (holding its text leaf + a sublist) and leave its siblings as flat windowed `listitem` leaves at `body.order`. Only the nested subtree under that one item mounts as a unit; every flat sibling stays individually windowed. This requires the model to allow a structural `listitem` directly in `body.order` as a sibling of flat `listitem` leaves, and the reader's `groupListRuns` to merge a *heterogeneous* run (flat leaves + structural items) into one `<ul>`/`<ol>` with coherent numbering. It is a modest generalization of the existing `else`-branch of `compileIndentItem` (the "wrap previous leaf into a structural item holding [prevLeaf, sublist[item]]" path) to the body-root case — not a rewrite.

Rejected — **Option B** (wrap the whole contiguous list run into one structural `list` at `body.order`, then run the existing algebra unchanged): cheapest to build, but the instant you indent *one* item the list's entire run collapses from N windowed leaves into one structural top-level block that mounts its whole subtree — so a 500-item list with one nested item de-virtualizes all 500. A real cliff triggered by a common action. Keep Option B only as the fallback if the model/host genuinely cannot allow a structural `listitem` at `body.order`, and then document the cliff.

Rejected — pure flat / `attrs.indent` only (visual nesting, no containment): cannot represent a list item that *contains* a code block or table — a flat leaf is one text string with no children — which is exactly the capability wanted.

Rejected — pure structural always (every list is a containment tree): a 10,000-item un-nested flat list loses per-item windowing for content that never needed it.

Residual cost, recorded honestly: under Option A a *huge* nested sub-list under one item still mounts as a unit (the nested subtree is not itself windowed). For book content — shallow outlines and sub-bullets — this never bites. The escape is *recursive windowing* (windowing inside a structural container), deferred to Future Backlog (§11) and a genuine motivation for the native core (§5.7, docs/031).

Open decisions to settle before building: (1) confirm the model union + reader accept a structural `listitem` at `body.order` (the Option A precondition); if not, fall back to Option B with the documented cliff. (2) With the host (content-api Zod union): whether the *export target* accepts nested `<list>` structure or flat `listitem`+`indent` — this decides only the export shape (export is lossy one-way, D2), not the editor-side model above.

### 5.4 D4 — Save Is Incremental Over The Touched Set

Recommended: maintain the persisted snapshot incrementally. Keep a long-lived snapshot object and, on each dispatch, clone-on-write only the `touched` keys into `body.blocks` while structurally sharing the rest; `toSnapshot()` becomes O(changed). Because `body.blocks` is a keyed `Record`, the host's `onSave` can also persist changed keys rather than a blob when its backend supports it.

Rejected — keep the full `Object.fromEntries` rebuild: O(n) allocation per save for an O(1)-changed edit, the exact waste this removes.

Rejected — route save through compat: not the save path at all; see D1.

The deliberate constraint: "changed block, by key" is defined identically here and in the CRDT op-log future, so this is not a throwaway optimization.

### 5.5 D5 — Optimize Load In Place First; Lazy Load Falls Out Of Paging

Separate three problems the earlier framing conflated: *render cost* (solved — windowing over `body.order`, the treap, O(log n)), *open/load cost* (one-time O(n) model build before first paint), and *steady-state memory* (§7.6). Load and memory have different solutions and different ROI; "chunked load" is not its own feature.

Recommended, step zero (pure JS, no async, no chunking): make the synchronous build cheap. The constructor runs three O(n) passes (`core/store/editor-store.ts:402-415`): ingest+`freezeNode`, `#rebuildParentIndex`, and `assertParentInvariant` — and `assertParentInvariant` *also* runs on every structural edit (`editor-store.ts:1187`). Two of the three are dev invariants paid in production: `assertParentInvariant` only re-verifies the authoritative `#rebuildParentIndex` (pure overhead in prod), and `freezeNode` (`core/model/model.ts:542`) deep-freezes every node's attrs/runs/marks/baked as an immutability tripwire. Gate both behind a dev flag and fold the parent-index build into the ingest pass. This plausibly cuts load 2-3× — and removes a full-tree walk from every structural edit — at zero architectural cost. Measure the real worst-case chapter after gating; if it then builds inside a frame budget, the load conversation is over with no async machinery at all.

Recommended, then by consequence: do **not** build a standalone "chunked/anchor-first load." Lazy/incremental load is a *consequence* of the §7.6 skeleton/body paging — once a body is materialized on access (read fault), open only needs the always-resident skeleton (order, parent index, seed heights, ids) plus the viewport-anchor bodies; the rest hydrate on scroll-in/idle through the same machinery that pages them out. The anchor (scroll position / deep-link) picks the first resident bodies. So there is one mechanism (§7.6), and load is the cold-start view of it.

Rejected — keep the eager full build with the dev invariants firing in prod: pays two redundant O(n) passes on open (and one on every structural edit) for guards that production does not need.

Rejected — build chunked async load as a separate feature before measuring step zero and before paging exists: it drags in read-faults, hydration ordering, and edit-before-hydration correctness to hide a cost step zero may have already removed, and it duplicates the resident-set machinery §7.6 owns.

### 5.6 D6 — Memory Is A Soft Budget: An Arbiter Over Pools, Purging Bodies To A Cold Store

The honest constraint first: pure JS cannot enforce a *hard* byte cap. You cannot force GC, set a heap ceiling, or prevent the engine from holding freed objects; measurement is coarse and gated (`measureUserAgentSpecificMemory()` is async + cross-origin-isolated + sampled; `performance.memory` is Chrome-only/deprecated); and your accounted payload is not actual RSS — engine overhead, hidden classes, and the object graph typically make true heap 2-5× your estimate. So "a hard 100MB cap on the app" is not a thing pure JS delivers. A true hard cap needs a fixed WASM linear-memory arena (docs/031 §N7) — and even there only the *model* is capped, never the JS view/DOM heap. This document targets the achievable TS shape: a *soft* budget that purges toward a target and is calibrated to measured RSS.

Recommended, three stages.

Stage one (cheap, isolated): a size-bounded LRU on the bake cache; evict offscreen baked snapshots; re-bake is pure (`core/bake/*`), so eviction is free correctness-wise and reclaims the largest unbounded allocator.

Stage two (the real model-virtualization): split each node into a *skeleton* (id, order position, height, parent — tiny, always resident) and a *body* (`TextContent`, marks, object `data` — the memory cost). Hold bodies in a viewport-keyed LRU and *purge* cold bodies to an injected cold store (in-memory default; IndexedDB in the view layer — the `BodyStore` SPI on `EditorStoreOptions`, which keeps `core/**` pure and lets docs/031's native arena satisfy the same seam). Re-materialize on access. Three existing facts make this safe and is why it is not too late to add: the offset model, `#parentOf`, and `comparePoints` are body-blind (they run off the skeleton); nodes are immutable+frozen, so a purged body re-materializes with no aliasing hazard; and `getNode(id)` is the single read choke point where the read-fault slots in. Crucially, **purge bodies, never the skeleton** — and because windowing already unmounts offscreen blocks, the bodies you purge have no live React reference; the DOM-unmount boundary and the model-purge boundary are the same boundary (decorator virtualization, docs/009, is the render-side precedent). Async wrinkle: IndexedDB reads are ~1-5ms, so prefetch about-to-enter bodies using the OffsetModel + velocity predictor (docs/025 fling) so the read overlaps the scroll and no gap shows.

Stage three (the budget arbiter — the unified ceiling): one accounted budget divided across typed pools, rebalanced under pressure. The skeleton + offset model are a *floor*, not a pool (always resident, unevictable); the elastic pools each expose `estimateBytes()` + `evict()` + a cold store — resident bodies (→ IndexedDB), the bake cache (→ recompute), and *undo/redo history* (grows with edit count, uncapped today — drop/cold-store oldest beyond its sub-budget). The arbiter caps the sum and steals budget between idle pools (a long scroll wants body budget; a long edit session wants history budget). High/low-water hysteresis keeps the resident set oscillating around the target rather than slamming a ceiling. Default the budget generous/unbounded (today's behavior) and calibrate the accounted-to-RSS multiplier on a real large doc before tightening; expose a `memoryBudget` option hosts set (mobile webview tight, desktop loose).

Rejected — leave memory unbounded: fine until it is not; for book-scale documents the resident model is the floor and there is no relief valve.

Rejected — promise a hard byte cap in pure JS: undeliverable (no forced GC, no heap ceiling, accounted ≠ RSS); claiming it would be a lie the runtime cannot keep. The hard-cap path is the native arena (docs/031 §N7); the floor that ultimately defeats a *TS* cap — the skeleton itself, as JS objects, for a very large doc — is exactly what the native integer-id arena compacts.

### 5.7 D7 — The TS Core Stays The Spec And Oracle For A Future Native Core

Recommended: treat every decision above as the executable specification for a possible `editor-native` (Rust/WASM) core, and keep the boundary clean so the core can be swapped behind the existing view↔core seam rather than ported layer by layer. Concretely: keep `core/**` framework-free (already lint-enforced), keep the offset model an interface with a reference implementation (already true: `FlatOffsetModel` is the treap's oracle), and shape the snapshot/save/load contracts (D4/D5) so a native core can satisfy them with binary serialization and incremental-by-key persistence without changing `EditorDocumentSnapshot` or `onSave`. The native core is a separate document; this one is its parity target.

This is a decision recorded to constrain the TS work, not a commitment to build the native core. It costs nothing now and prevents the TS implementation from making choices (e.g., putting serialization logic where a native core could not reach it) that would force a rewrite later.

## 6. Implementation Strategy

Sequence so each phase is independently reviewable, testable, and green under `pnpm check`, and so the compat sunset is never blocked.

Phase 1 — markdown paste (§7.1). Self-contained: a new view-layer parser, a native node-builder, and a `text/markdown`/`text/plain` branch in `use-clipboard.ts`. No core changes beyond possibly a small native leaf-with-marks helper. Lands the most felt gap and establishes the type↔syntax correspondence (D2) whose export side §7.2 consumes.

Phase 2 — structural list nesting (§7.3). Generalize the `compileIndentItem` `else`-branch to the body-root case (Option A: structural `listitem` at `body.order`, flat siblings stay windowed leaves), add the promote-on-block-child trigger, and extend the reader/export to merge heterogeneous runs and emit nested trees. Reuses the structural SPI and caret-navigation machinery callout already proved.

Phase 3 — incremental save (§7.4). Replace the full-rebuild `toSnapshot()` with a touched-set-driven incremental snapshot. Pure mechanics, behind the existing `getEditorSnapshot()`/`onSave` contract, with parity against the current full snapshot.

Phase 4 — markdown export + native clipboard (§7.2). The export side of the Phase 1 correspondence (separate from import, lossy one-way), object transformers in the view layer reading baked fields, plus the native snapshot fragment on the clipboard for lossless in-app paste.

Step zero (anytime, independent) — load in-place optimization (§7.5): gate the dev invariants (`assertParentInvariant`/`freezeNode`) out of the production path and measure. Cheap, isolated, no dependency on any phase; lands the biggest load win first and may remove the need for any async load.

Phase 5 — memory bounding + lazy load (§7.6/§7.5). The budget arbiter over the skeleton/body split, the `BodyStore` cold path, and the history pool; lazy load is the cold-start of this paging, not a separate feature. Stage-one bake LRU can land independently and early as a quick win.

Compatibility and deletion: nothing in Phases 1–5 reads or writes `compat.ts`. The HTML-paste migration onto the native builder (a §7.1 follow-on) removes compat's last non-legacy caller; after the corpus migration, `compat.ts` and `payload-import.ts` are deletable, and the parity tests that currently exercise the compat round-trip are repointed at the native `toSnapshot`/`createEditorStore` round-trip.

## 7. Detailed Implementation Plan

### 7.1 Markdown Import (Paste)

Current problem: pasting markdown inserts verbatim plain text (`view/controllers/use-clipboard.ts` reads only `text/html` and `text/plain` and dispatches `insert-text`); the §4.1 typing detector fires only on single-character input (`view/render/text-block.tsx:174`), so it never helps paste.

Target behavior: pasting a markdown document (from a `text/markdown` clipboard type, or a `text/plain` payload that is heuristically markdown) produces a native node fragment inserted at the caret, matching the inline marks the typing path already supports (including `==highlight==` and task lists).

Implementation tasks:

- [ ] Add `markdown-it` (+ `markdown-it-mark` for `==`, `markdown-it-task-lists` for checkboxes) as a view-layer dependency; keep it out of `core/**`. Lazy-load it on first paste (`import()` inside the clipboard handler) so ~100KB of parser does not sit in the initial editor bundle.
- [ ] Add `view/markdown/from-markdown.ts`: `markdownToNodes(src: string, allocator, registry): EditorNode[]`. Walk the `markdown-it` token stream (flat stream with `nesting` ±1) with a stack to build blocks; map block tokens to `makeTextNode`/`makeStructuralNode`/`makeObjectNode`; map inline tokens to a `TextContent` plus `TextMark[]` whose boundaries are `boundaryAtOffset(content, offset, stickiness)`. Sanitize link hrefs with `safeHref`.
- [ ] Express the mapping as the import side of the D2 correspondence (`view/markdown/transformers.ts`) so §7.2's export side stays consistent with it (one spec, round-trip-tested — not a shared bidirectional function object).
- [ ] In `use-clipboard.ts`, read the native fragment (`application/x-idco-snapshot`) first for a lossless in-app paste; otherwise add a `text/markdown` branch and an opt-in heuristic `text/plain`→markdown branch, calling `markdownToNodes` then `compileInsertBlocks`.
- [ ] Add a small native helper if one does not exist: build a `listitem`/`paragraph` leaf with mark ranges from `(text, ranges)` so both this and the future HTML migration share it.

Edge cases: an unsafe link href clears to plain text via `safeHref`; a fenced code block becomes a `code-block` object with its language; a GFM task list maps to `listitem` with `checked` (the §4.3c shape); a markdown table maps to the `table` structural node (or, if deferred, is dropped with a logged note rather than silently); raw HTML in the markdown is escaped by `markdown-it`'s `html:false` default and never reaches the DOM.

Tests: `tests/editor/engine-markdown-paste.test.ts` — headings/lists/marks/links/fence/task-list each parse to the expected native nodes; a `javascript:` link is neutralized; `editor → md → editor` is asserted lossless for the representable set once §7.2 lands (cross-referenced parity test).

### 7.2 Markdown Export (Custom Syntax)

Current problem: no `toMarkdown`/`toHTML` exists; copy/cut write `text/plain` only (`view/controllers/use-clipboard.ts`), so an editor→editor paste downgrades to plain text and there is no markdown output at all.

Target behavior: two outputs with two purposes (D2). A pure `snapshotToMarkdown(snapshot): string` that walks `body.order`/`body.blocks`, emits markdown for standard nodes, and delegates each object to its view-layer transformer reading only baked fields — the *lossy open-format* projection. And a native snapshot fragment on a custom clipboard type for *lossless* editor→editor copy/paste. Copy/cut write `application/x-idco-snapshot` (lossless) plus `text/markdown` (open) plus `text/plain` (fallback).

Implementation tasks:

- [ ] Add `view/markdown/to-markdown.ts`: `snapshotToMarkdown` walking the snapshot, using the export side of the D2 correspondence; standard nodes inline, objects via their view-layer transformer.
- [ ] Add a per-object export transformer in the view layer (a table keyed by node type, or a `NodeView` method) returning a string from the object's baked fields — markdown stays out of `core/**`; built-ins per D2 (`divider`→`---`, `code-block`/`mermaid`→fenced with language, `callout`→`:::tone` directive, `media`→`![alt](src)`, `table`→GFM table from baked cells).
- [ ] Define the custom directive grammar once (the `:::tone` callout form and any other non-CommonMark object syntax) and document it inline as the export contract; ensure §7.1's import recognizes the same directives.
- [ ] Put the native fragment (`application/x-idco-snapshot`) on copy/cut for lossless in-app paste; the §7.1 paste path reads it first and only falls back to markdown/HTML/plain when it is absent.
- [ ] Wire `text/markdown` and `text/plain` into copy/cut alongside the native type.

Edge cases: export is lossy by design — a node with no markdown analog (merged table cell, comment/glossary mark, opaque object internal) drops to the documented lossy set, emitted as a documented placeholder or omitted, never silently corrupting surrounding structure; nested lists emit correct indentation from the §7.3 tree; an object whose bake is missing/invalid emits its placeholder, never a live-computed value (docs/006 §5.8); the native clipboard fragment carries everything markdown drops, so an in-app paste never observes the lossy set.

Tests: `tests/editor/engine-markdown-export.test.ts` — each node type emits expected markdown; the lossy set is asserted explicitly; a round-trip `md → nodes → md` is stable *for the representable set only* (not a lossless guarantee); a native-clipboard copy→paste round-trips byte-identically through `application/x-idco-snapshot`.

### 7.3 Structural List Nesting

Current problem: nesting is visual-only (`attrs.indent` margin); the structural nesting algebra (`compileIndentItem`/`compileOutdentItem`, `core/commands/blocks.ts:614+`) only runs *inside* an existing structural `list`, and nothing creates that first structural list from flat body-level leaves, so it is unreachable; a list item cannot contain a code block or table from the editing surface; the reader/export render a single flat level.

Target behavior (Option A, D3): indent/outdent build real nesting by promoting *only the parent item* to a structural `listitem` at `body.order` while flat siblings stay windowed leaves; dropping or inserting a block under a list item promotes that item to a structural `listitem` container (the existing import shape); the reader and export emit nested `<ul>/<ol>` and nested markdown; un-nested flat lists are untouched and keep per-item windowing.

Implementation tasks:

- [ ] Reach the nesting algebra the Option A way: generalize the `else`-branch of `compileIndentItem` (`core/commands/blocks.ts:652-683`) to the body-root case — indenting a flat `body.order` item under its predecessor promotes the predecessor to a structural `listitem` (holding its text leaf + a sublist) *in place at `body.order`*, leaving the other flat siblings as leaves. Do **not** wrap the whole run into one structural `list` (that is Option B, the windowing cliff in D3).
- [ ] Allow a structural `listitem` at `body.order`: confirm/extend the model union so a structural `listitem` can sit directly in body order as a sibling of flat `listitem` leaves (the D3 Option A precondition); if the union cannot, fall back to Option B and document the cliff.
- [ ] Add the promote-on-block-child trigger: inserting/dropping a block (code-block, table, sub-list) onto a `listitem` converts that leaf to a structural `listitem` holding an inner text leaf plus the block child — the exact `importListItemChildren` shape (`core/registry/flat-blocks.ts`), so import and edit produce identical structures.
- [ ] Caret navigation: reuse the structural-container + gap-cursor walk (the callout path, docs/021) so arrows enter/exit a nested block.
- [ ] Reader: extend `groupListRuns`/`renderUnit` (`packages/reader/src/reader/render.tsx`) to merge a *heterogeneous* run — flat `listitem` leaves interleaved with structural `listitem` items — into one `<ul>`/`<ol>` with coherent (continuous) numbering, rendering structural items' block children inline; keep the §4.3c checklist routing.
- [ ] Export (§7.2): emit nested markdown from the same tree (lossy one-way; constructs with no markdown analog drop to the documented lossy set).
- [ ] Virtualization policy: document that the nested subtree under a structural item mounts within the container (not independently windowed) for first release, while flat siblings and un-nested lists keep per-item windowing; record recursive windowing of a large nested subtree as future work and a native-core motivation (§5.7, docs/031).

Edge cases: outdenting the last item of a sublist drops the now-empty `list`/`listitem` container (the algebra already handles this, `compileOutdentItem`); a structural item reduced to a single text child and no blocks demotes back to a flat leaf so the model never accumulates degenerate containers (and so flat siblings + the demoted leaf re-merge into one windowed run); ordered numbering is continuous across the heterogeneous flat/structural run, not restarted per structural item; mixed checklist/bullet items split into separate runs (the `listFlavour` rule).

Tests: `tests/editor/engine-list-nesting.test.ts` — indent promotes the predecessor to a structural `listitem` at `body.order` while flat siblings stay leaves; a code block under an item promotes it; outdent demotes and cleans up (and re-merges into one run); `tests/reader.test.tsx` — a heterogeneous flat/structural run renders as one `<ul>`/`<ol>` with correct depth and continuous numbering; round-trip through `toSnapshot`/`createEditorStore` preserves the tree.

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

### 7.5 Load: In-Place Optimization, Then Lazy Via Paging

Current problem: `createEditorStore` runs three O(n) passes synchronously before first paint (`core/store/editor-store.ts:402-415`) — ingest+`freezeNode`, `#rebuildParentIndex`, `assertParentInvariant` — and `assertParentInvariant` also fires on every structural edit (`editor-store.ts:1187`). Two of the three are dev invariants paid in production (D5).

Target behavior, step zero: the synchronous build is cheap enough to fit a frame budget for the real worst-case chapter, with no async machinery. Then, if measurement still shows a stall on a genuinely huge document, lazy load arrives as the cold-start of §7.6 paging — not as a separate feature.

Implementation tasks:

- [ ] Gate `assertParentInvariant` behind a dev flag (it re-verifies the authoritative `#rebuildParentIndex`; pure overhead in prod, on every load *and* every structural edit).
- [ ] Gate or lazy-apply `freezeNode` (`core/model/model.ts:542`) in production; it is an immutability tripwire, an O(n) deep walk over attrs/runs/marks/baked on open.
- [ ] Fold the parent-index build into the ingest pass (one walk, not two).
- [ ] Instrument and record load time on a synthetic large snapshot (20k–50k nodes with marks) before and after gating; decide from the number whether any async load is needed at all.
- [ ] Only if the measured number still stalls: consume §7.6's skeleton + viewport-anchor bodies for first paint and let the rest hydrate via §7.6's read-fault path; do not build a parallel chunked-load mechanism.

Edge cases (only relevant once lazy load via §7.6 is in play): an edit landing before a body hydrates force-materializes it; `comparePoints` touches content (`editor-store.ts:1063`) but only for selection endpoints, which are pinned resident; a deep-link to a late node faults its body first.

Tests: `tests/editor/engine-load-perf.test.ts` — a load-pass count/timing assertion proving the dev invariants are gated out of the production build path; (if lazy load lands) `engine-chunked-load.test.ts` — a read fault hydrates correctly, an early edit forces materialization, final state equals the eager build.

### 7.6 Memory Bounding

Current problem: the model and bake cache are fully resident and unbounded; the bake cache never evicts; undo/redo history grows with edit count with no cap; and the skeleton (always resident) is the floor under all of it. A hard byte cap is not achievable in pure JS (D6); the target is a calibrated *soft* budget.

Target behavior: one accounted budget arbiter over typed pools — a resident-body LRU purging cold bodies to an injected cold store, a bake LRU, and a history pool — kept near a target by high/low-water hysteresis, while the skeleton + offset model stay resident and body-blind operations keep working.

Implementation tasks:

- [ ] Stage one — bake LRU: a size-bounded LRU on baked snapshots; evict offscreen bakes; re-bake on demand via the existing pure baker (`core/bake/*`, `bake.worker.ts`).
- [ ] Stage two — skeleton/body split: skeleton = `{id, parent, order index, height}` (always resident); body = `TextContent` + marks + object `data`. A viewport-keyed body LRU; **purge bodies (never the skeleton)** to a cold store; re-materialize on access. Route every read through `getNode(id)` so it can read-fault a purged body; rely on windowing already unmounting offscreen blocks so purged bodies have no live reference.
- [ ] `BodyStore` SPI on `EditorStoreOptions`: an interface `{ get(id), put(id, body), evict(id) }` with an in-memory default (tests + today's behavior) and an IndexedDB implementation in the view layer; `core/**` stays pure and docs/031's native arena satisfies the same seam.
- [ ] Prefetch-on-velocity: use the OffsetModel + velocity predictor (docs/025 fling) to materialize about-to-enter bodies before they are visible, so the ~1-5ms IndexedDB read overlaps the scroll and no gap shows.
- [ ] Stage three — budget arbiter: a single accounted budget divided across pools; each elastic pool exposes `estimateBytes()` + `evict()`; the arbiter caps the sum, rebalances between idle pools, and runs high/low-water hysteresis. Pools: resident bodies (→ `BodyStore`), bake cache (→ recompute), and the undo/redo history pool (below). The skeleton + offset model are the floor (not a pool).
- [ ] Stage three — undo/redo history pool: today the inverse-step history grows with edit count and is never capped (`core/store/editor-store.ts`, the history stacks). Give it a bounded sub-budget with a configurable depth *and* byte cap; on overflow, evict the **oldest** entries (the deepest undo states), never the most recent. Unlike body purge, history eviction is *lossy by design* — a dropped inverse step is undo the user can no longer reach — so the config picks the policy per deployment: `drop` (cheap; deep undo is forgotten past the cap) or `cold-store` (keep deep undo by paging old inverse steps to the `BodyStore`/IndexedDB, re-materialized if the user undoes that far, at storage cost). Coordinate with §7.4: the inverse steps and their `touched` sets are the unit, so eviction must keep the maintained `#snapshotBlocks` and the live history consistent.
- [ ] Calibration + config: `EditorStoreOptions` exposes `memoryBudget` (overall, default generous/unbounded) and a `history` config — `{ maxDepth?, maxBytes?, overflow: "drop" | "cold-store" }` (default `drop`, generous depth) — so a host caps undo independently of the body budget (mobile webview: shallow `drop`; desktop authoring: deep or `cold-store`). Calibrate the accounted-to-RSS multiplier on a real large document before exposing a tight target.

The cap is a three-tier ladder over the *same* `BodyStore` seam, so a deployment buys exactly the determinism it needs without committing to the native core (docs/031). Tier 0 (this section, now): the JS in-memory + IndexedDB `BodyStore` — a calibrated *soft* budget, fine for bounded book chapters. Tier 1 (a `BodyStore` implementation, medium cost): a **wasm-arena `BodyStore`** — bodies live in a fixed, pre-sized WASM linear-memory arena (decode a copy to JS on mount/edit — coarse, per viewport-body, *not* per frame; overflow past the ceiling spills to IndexedDB), giving a **hard cap on the bodies that dominate memory** while the model graph, treap, commands, and history stay in TypeScript. Crucially this needs no model-graph-in-WASM and so takes none of docs/031's per-frame FFI gate risk, because the hot path (treap/`#parentOf`/`comparePoints`) is body-blind and stays on the resident skeleton. Tier 2 (docs/031 full swap): the whole model — *including* the skeleton floor this tier cannot cap — moves into the arena. Tier 1 caps bodies (the ~90% case); only Tier 2 caps the skeleton too.

Edge cases: a purged body that is part of the current selection stays resident (pin selection bodies; `comparePoints` reads content, `editor-store.ts:1063`, only for endpoints); a dirty (touched, unsaved) body must page to a *durable* store, not be dropped — IndexedDB is persistence here and §7.4's touched set is the dirty signal; an edit to a purged body faults it in first; persistence (§7.4) faults any purged touched body before serializing; undo past the history cap with `drop` simply stops at the cap (a surfaced, intentional limit, never an error or a corrupt state), and with `cold-store` the oldest inverse steps fault back from IndexedDB before applying; a new edit always clears the redo stack first, so eviction never has to reconcile a half-truncated redo; the skeleton floor is unevictable, so on a doc large enough that the skeleton alone exceeds budget the only relief is the native arena (Tier 2 / docs/031 §N7); under a wasm-arena `BodyStore` (Tier 1) the body encode/decode crosses JS↔WASM on mount/edit only (viewport-sized, not per-frame), and a body decoded for editing is the live copy until re-encoded on the next commit.

Tests: `tests/editor/engine-memory-budget.test.ts` — resident body count stays within budget while scrolling a large document; a pinned selection body is never purged; a faulted-in body matches its pre-purge content; the arbiter rebalances budget between a scroll-heavy and an edit-heavy workload; a dirty body survives purge via the durable store; the history pool honors `maxDepth`/`maxBytes` — `drop` truncates the oldest undo and undo stops cleanly at the cap, `cold-store` re-materializes a deep undo from the durable store and applies it identically.

## 8. Migration And Rollout

Compat sunset is the rollout's spine. None of §7 reads or writes `compat.ts`. The §7.1 follow-on (migrate HTML paste onto the native node-builder) removes compat's last non-legacy caller. After the corpus migration completes and the persisted shape is `EditorDocumentSnapshot`, `compat.ts` and `payload-import.ts` are deleted, and the round-trip parity tests are repointed from the compat round-trip to the native `toSnapshot`/`createEditorStore` round-trip.

Feature flags: markdown paste and markdown export are behind host-supplied capability (paste branch is inert if no `text/markdown` and the plain-text heuristic is off); structural nesting ships behind a profile flag if the host's Zod union is not yet ready to accept nested/structural list nodes (the schema-profile gate, docs/018 item 6, already exists for exactly this).

Deployment order: ship Phases 1–4 to the editor with no host schema change required for paste/export/save; coordinate the structural-nesting schema target (§5.3 open decision) with content-api before enabling nesting persistence; ship §7.5/§7.6 last, behind a memory-budget option that defaults to "unbounded" (today's behavior) until measured.

Rollback: each phase is independently revertible because each attaches to the snapshot spine, not to the others. Incremental save (§7.4) ships behind a parity assertion against the full rebuild, so a mismatch falls back to the full rebuild rather than risking a corrupt save.

## 9. Edge Cases And Failure Modes

- Unsafe markdown link (`javascript:`): `safeHref` clears it on import; the run stays plain text. Operator-invisible; author sees no link.
- Markdown table on paste before §7.3 table-import lands: dropped with a logged note, never silently mangled into cell text.
- Fenced code with no language: imports as a `code-block` with empty language; exports as a bare ```` ``` ```` fence.
- Export lossiness is by design (D2): a construct with no markdown analog (merged table cell, comment/glossary mark, opaque object internal) drops to the documented lossy set; the lossless path is the native clipboard fragment, so an in-app paste never observes the loss.
- Structural list item demotion (Option A): a structural `listitem` reduced to a single text child and no blocks demotes to a flat leaf so the model never carries degenerate containers; the demoted leaf re-merges into its windowed flat run.
- Heterogeneous list run numbering: ordered numbering is continuous across interleaved flat leaves and structural items, not restarted per structural item.
- Incremental save divergence: a parity assertion against the full rebuild catches any touched-set bug; on mismatch, fall back to full rebuild and surface a dev-only error.
- Load read fault during an edit (only once lazy load via §7.6 is in play): the affected bodies are force-materialized before the step applies; correctness never depends on hydration order.
- Purged selection body: pinned and never purged; `comparePoints` reads content only for endpoints, which are pinned; an edit to a purged body faults it in first.
- Dirty body under memory pressure: a touched/unsaved body pages to a durable store (IndexedDB, the §7.4 touched set as the dirty signal), never dropped; save faults any purged touched body in before serializing so the snapshot is complete.
- Undo/redo history at the cap: history is its own budgeted pool (`history: { maxDepth?, maxBytes?, overflow }`); `drop` discards the oldest undo states and undo stops cleanly at the cap (a surfaced, intentional limit — eviction here is lossy by design, unlike body purge), while `cold-store` pages old inverse steps to IndexedDB and faults them back on a deep undo. A new edit clears redo first, so eviction never truncates a partial redo stack.
- Skeleton floor exceeds budget: the skeleton is unevictable, so on a document large enough that the skeleton alone overflows the budget, the soft TS cap cannot relieve it — the relief is the native arena (docs/031 §N7).
- Memory budget is soft, not hard: accounted bytes are calibrated to RSS but not equal to it; the budget keeps the resident set *near* a target via hysteresis, it does not guarantee a ceiling (only the native arena does).
- Compat deletion drift: the repointed native round-trip parity test must be green before `compat.ts` is removed; the file banner and the `compat-is-temporary-not-official-path` memory guard against re-introducing a dependency.

## 10. Implementation Backlog

The backlog is organized by theme, not by release order. Sequencing and the first-release cut are defined in §1 and §6; each item carries its own priority note. Three themes: Markdown I/O, Structural Nesting, and Snapshot Lifecycle & Performance.

### Markdown I/O

Import and export are one theme — both sides of the D2 type↔syntax correspondence (one spec, round-trip-tested for the representable set), with the native clipboard riding export. Markdown stays out of `core/**`.

#### MIO-1. Markdown Paste (Import)

Priority: first-cut (§6 Phase 1).

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

#### MIO-2. Markdown Export + Native Clipboard

Priority: later (§6 Phase 4).

Scope:

- `packages/editor/src/view/markdown/to-markdown.ts`
- `packages/editor/src/view/markdown/transformers.ts` (per-object export transformer, view layer — not core)
- `packages/editor/src/view/controllers/use-clipboard.ts` (copy/cut `application/x-idco-snapshot` + `text/markdown` + `text/plain`; paste reads the native type first)

Tasks:

- [ ] `snapshotToMarkdown` over the export side of the D2 correspondence; per-object transformers reading baked fields; directive grammar. Lossy one-way; markdown stays out of `core/**`.
- [ ] Native snapshot fragment on copy/cut (`application/x-idco-snapshot`) for lossless in-app paste; paste reads it before markdown/HTML/plain.
- [ ] Copy/cut also write `text/markdown` and `text/plain`.

Acceptance criteria:

- Each node type emits expected markdown; the lossy set is documented and asserted; `md → nodes → md` stable for the representable set only (not a lossless guarantee); a native-clipboard copy→paste round-trips byte-identically.

Tests:

- `tests/editor/engine-markdown-export.test.ts`

### Structural Nesting

A document-model capability — distinct from markdown I/O and from the lifecycle/perf work: a list item becomes a scope that can hold block children.

#### SN-1. Structural List Nesting

Priority: first-cut (§6 Phase 2).

Scope:

- `packages/editor/src/core/commands/blocks.ts`
- `packages/editor/src/core/registry/flat-blocks.ts`
- `packages/reader/src/reader/render.tsx`

Tasks:

- [ ] Option A indent: generalize the `compileIndentItem` `else`-branch to `body.order` (promote the predecessor to a structural `listitem` in place; flat siblings stay leaves); confirm the model union allows a structural `listitem` at body order (else Option B fallback + documented cliff).
- [ ] Promote-on-block-child trigger producing the `importListItemChildren` shape.
- [ ] Reader: merge heterogeneous flat/structural runs into one list with continuous numbering + structural-item block children; keep checklist routing.

Acceptance criteria:

- Indent promotes one item to a structural `listitem` at body order while flat siblings stay windowed; a code block can live inside a list item; outdent demotes, cleans up, and re-merges; the reader renders a heterogeneous run as one correctly-numbered list.

Tests:

- `tests/editor/engine-list-nesting.test.ts`, `tests/reader.test.tsx`

### Snapshot Lifecycle & Performance

Save/load/memory internals (the §4 "bound the snapshot lifecycle" family). Membership is thematic; priority varies per item and is noted on each.

> Resolution (2026-06-26): SLP-1 and SLP-2 are implemented and green under `pnpm check`. SLP-1 maintains `body.blocks` incrementally from each commit's `touched` set (plus insert/remove subtree descendants) with copy-on-write, a dev-gated parity check, and the `assertIncrementalSnapshotParity` oracle; the production return path is tested under `setDevInvariants(false)`. SLP-2 gates the `freezeNode` deep-walk and the `assertParentInvariant` walk out of the production build (`core/dev-flags.ts`) and folds the parent-index build into the single ingest pass. Recorded SLP-2 benchmark (synthetic 20k-node snapshot with one mark per node, `engine-load-perf` `console.info`): production load ~17.5 ms vs dev ~28.1 ms (gating saves ~38%); 17.5 ms fits a frame budget at this scale, so per §7.5 no async load is warranted for the targeted chapter size — lazy load remains the deferred cold-start of §7.6 paging.
>
> SLP-3 ships the **bake LRU primitive** (`core/bake/bake-cache.ts`, a byte-bounded recency cache implementing `MemoryPool`, unit-tested in `engine-bake-lru`). It is **not yet wired into the live bake path**: the editor today stores baked snapshots *inline* on `node.baked` and the view re-bakes on demand (`view/render/resting-document.tsx`) — there is no central cache to bound — so routing inline bakes through the LRU (and registering it on the arbiter) lands with the deferred body-paging follow-on, where the bake becomes an evictable body. The primitive existing now is the prerequisite that prevents that follow-on from painting itself into a corner.
>
> SLP-4 landed its self-contained, non-invasive tier: the `MemoryArbiter` + `MemoryPool` contract (`core/memory/pool.ts`), the `BodyStore` SPI + in-memory default (`core/store/body-store.ts`), and the budgeted undo `HistoryPool` (`core/store/history-pool.ts`, depth/byte caps with `overflow: "drop" | "cold-store"`), wired through `EditorStoreOptions` (`memoryBudget`, `history`, `bodyStore`) and `store.memoryArbiter`. The invasive remainder of SLP-4 — the full skeleton/body viewport pager (purge-on-scroll, read-fault via `getNode`, velocity prefetch), the view-layer IndexedDB `BodyStore`, lazy-load-as-cold-start, and the optional wasm-arena Tier 1 — is deliberately left as documented seams, matching this item's "larger, later" priority and §1's "can land later"; the seams (the `BodyStore` SPI, the arbiter, `getNode` as the read choke point) are in place so it does not paint itself into a corner. Tests: `engine-incremental-save`, `engine-load-perf`, `engine-bake-lru`, `engine-memory-budget`.

#### SLP-1. Incremental Save

Priority: first-cut (§6 Phase 3), though an internals/perf item — the full-rebuild `toSnapshot()` is O(n) on every 1s autosave, so it stalls recurringly on a large doc and the fix is cheap and self-contained behind the existing `onSave` contract.

Scope:

- `packages/editor/src/core/store/editor-store.ts`

Tasks:

- [ ] Maintain `body.blocks` from `state.touched`; `toSnapshot()` returns the maintained object.
- [ ] Parity assertion vs full rebuild; undo/redo update the map from inverse touched.

Acceptance criteria:

- `toSnapshot()` is O(changed) and deep-equals the full rebuild across arbitrary edit/undo/redo sequences.

Tests:

- `tests/editor/engine-incremental-save.test.ts`

#### SLP-2. Load In-Place Optimization (Step Zero)

Priority: independent quick win, anytime — lands the biggest load win for near-zero cost, no dependency on any other item.

Scope:

- `packages/editor/src/core/store/editor-store.ts`
- `packages/editor/src/core/model/model.ts`

Tasks:

- [ ] Gate `assertParentInvariant` behind a dev flag (off the production load + structural-edit path).
- [ ] Gate or lazy-apply `freezeNode` in production.
- [ ] Fold the parent-index build into the ingest pass.
- [ ] Record before/after load time on a synthetic 20k–50k-node snapshot; decide whether any async load is warranted.

Acceptance criteria:

- The production load path runs neither the freeze deep-walk nor the parent-invariant walk; structural edits no longer re-run the invariant walk; load time on the benchmark drops measurably.

Tests:

- `tests/editor/engine-load-perf.test.ts` (pass-count/timing assertion)

#### SLP-3. Bake LRU (Memory Stage One)

Priority: independent quick win, anytime — the cheapest memory reclaim (the largest unbounded allocator).

Scope:

- `packages/editor/src/core/bake/*`

Tasks:

- [ ] Size-bounded LRU on baked snapshots; evict offscreen; re-bake on demand.

Acceptance criteria:

- Bake-cache memory stays within budget while scrolling; evicted bakes regenerate identically.

Tests:

- `tests/editor/engine-bake-lru.test.ts`

#### SLP-4. Memory Arbiter + Body Paging + Lazy Load + History (Memory Stage Two/Three)

Priority: the larger, later memory project.

Scope:

- `packages/editor/src/core/store/editor-store.ts`
- `packages/editor/src/core/scheduler.ts`
- a view-layer `BodyStore` (IndexedDB) implementation

Tasks:

- [ ] Skeleton/body split; viewport body LRU; **purge bodies (not skeleton)** to a `BodyStore` cold store; read-fault via `getNode`; prefetch-on-velocity (docs/025).
- [ ] `BodyStore` SPI on `EditorStoreOptions` (in-memory default; IndexedDB impl in view layer); dirty bodies page to a durable store.
- [ ] Budget arbiter over typed pools (bodies, bake, history) with `estimateBytes()`/`evict()`, high/low-water hysteresis, cross-pool rebalance; `memoryBudget` option calibrated to RSS, default generous.
- [ ] Undo/redo history pool: cap the inverse-step stacks by depth + bytes; `history: { maxDepth?, maxBytes?, overflow: "drop" | "cold-store" }` on `EditorStoreOptions` (default `drop`); evict oldest, keep §7.4 `#snapshotBlocks`/history consistent; history eviction is lossy-by-design (drop) or paged (cold-store).
- [ ] Lazy load as the cold-start of paging (skeleton + anchor bodies first), not a separate mechanism.
- [ ] Optional Tier 1: a wasm-arena `BodyStore` implementation (pre-sized arena, slot recycle, evict-to-IndexedDB on full; decode-on-mount, encode-on-commit) that *hard*-caps bodies behind the same SPI — model graph stays TS, no per-frame FFI. Ships independently of docs/031's full swap.

Acceptance criteria:

- Resident body count stays within the soft budget while scrolling; selection + dirty bodies are pinned/durable; a faulted-in body matches its pre-purge content; the arbiter rebalances between scroll-heavy and edit-heavy workloads; the history pool honors its depth/byte cap (`drop` stops undo cleanly at the cap, `cold-store` re-materializes deep undo); lazy first paint equals the eager build's final state.

Tests:

- `tests/editor/engine-memory-budget.test.ts`, `tests/editor/engine-chunked-load.test.ts`

## 11. Future Backlog

- Recursive windowing of nested structural content (so a huge sub-list inside one item is itself virtualized) — deferred from §7.3 Option A; a strong motivation for the native core (§5.7).
- Ordered-list arbitrary start number and bullet/number style variants (`note.md` §4.3d).
- Code-fence language capture on the typing path (deferred from the shipped §4.1 line→object work). Input redirection into the new code block already shipped: a line→object affordance for an editable in-place object drills into its surface via the `activateOnInsert` NodeView flag + `activateInsertedObject`, the same activation the slash/insert palette uses.
- Checklist-item indent in the reader render (the live editor already indents).
- HTML-paste migration onto the native node-builder (removes compat's last non-legacy caller) — strictly a follow-on to MIO-1 (markdown paste).
- Page/publication settings (docs/006 §6) — a separate workstream that also hangs on the snapshot's `settings` field.
- `editor-native` Rust/WASM core — `docs/031_editor_native_rust_wasm_core.md`; this document is its parity spec (§5.7). The CRDT op-log (docs/013/014) folds incremental save (§7.4) and memory paging (§7.6) into one foundation when collaboration lands.

## 12. Definition Of Done

- Markdown paste produces native nodes (no compat reference), with task lists and the full §4.1 inline set; the native clipboard fragment is read first for lossless in-app paste; `tests/editor/engine-markdown-paste.test.ts` green.
- Structural nesting (Option A) builds real trees and holds arbitrary block children with a structural `listitem` at `body.order` beside windowed flat leaves; the reader merges heterogeneous runs and emits correct nested output; nesting round-trips through `toSnapshot`/`createEditorStore`; `engine-list-nesting` and the reader nesting tests green.
- `toSnapshot()` is incremental and deep-equals the full rebuild across arbitrary edit/undo/redo; `engine-incremental-save` green.
- Markdown export is a lossy one-way projection with an asserted documented lossy set (not a round-trip guarantee); copy/cut write `application/x-idco-snapshot` + `text/markdown` + `text/plain`; a native copy→paste is byte-lossless; `engine-markdown-export` green.
- Load: the dev invariants (`assertParentInvariant`/`freezeNode`) are gated out of the production build path and the load-perf benchmark is recorded; `engine-load-perf` green.
- Memory: the bake LRU plus (when shipped) the budget arbiter over the skeleton/body split and history pool keep the resident set near a calibrated *soft* budget while scrolling a large document, purging bodies (never the skeleton) to the `BodyStore`; the memory tests green. Hardening the cap is a ladder over the same `BodyStore` seam: Tier 0 = JS soft budget (this doc); Tier 1 = a wasm-arena `BodyStore` that *hard*-caps bodies without a full native core or its FFI gate; Tier 2 = the native arena that also caps the skeleton floor (docs/031 §N7).
- `pnpm check` is green for every phase (format, lint, dup, semantic-dup, typecheck, test, build).
- No workstream references `compat.ts`; the compat round-trip parity test is repointed at the native round-trip ahead of compat deletion.
- `note.md` §4 resolution updated to point at this document; the relevant memories updated.

## 13. Final Model

The TypeScript editor evolves as a single object viewed three ways. `EditorDocumentSnapshot` — a keyed map of native nodes — is the only serialized form and the only runtime truth, with `toSnapshot()` and `createEditorStore({snapshot})` as its sole official ends and `compat.ts` excluded as a deletable legacy side door. Markdown import builds native nodes directly (never HTML, never compat); markdown export is a separate, *lossy one-way* projection to an open format that reads baked object fields, while lossless editor→editor copy/paste rides the native snapshot fragment on a custom clipboard type — the two share one type↔syntax spec held honest by a round-trip test, not one bidirectional table. Structural nesting widens the snapshot's legal shapes — a list item is a scope that may hold a code block, a table, or a sub-list — by promoting only the parent item to a structural `listitem` at `body.order` beside windowed flat leaves (Option A), so un-nested lists keep per-item windowing and only the nested subtree mounts as a unit. Load, save, and memory are the snapshot's lifecycle: load is optimized in place first (the dev invariants gated out of production) with lazy load falling out of paging rather than built as a feature; save is written out incrementally by touched key; memory is a calibrated *soft* budget — an arbiter over a skeleton/body split, a bake LRU, and a history pool, purging bodies (never the skeleton) to an injected `BodyStore`, with the honest admission that a *hard* byte cap belongs to the native arena, not pure JS. Because "a changed block, by key" is the unit shared by incremental save, viewport paging, and the future CRDT op-log, the optimizations that make large documents tractable today are the same ones that make collaboration tractable tomorrow, and because the whole core stays framework-free with the snapshot contracts placed where a native core can satisfy them, this plan is simultaneously the TypeScript roadmap and the specification a Rust `editor-native` core would be measured against.
