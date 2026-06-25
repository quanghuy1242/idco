# 031 — editor-native: a Rust/WASM core for the owned-model editor

> Status: implementation-grade research and proposal
>
> Date: 2026-06-26
>
> Scope:
>
> - `/home/quanghuy1242/pjs/idco/packages/editor` — the owned-model editor. This document proposes replacing the implementation behind `packages/editor/src/core/**` with a Rust/WASM core (`editor-native`) while keeping `packages/editor/src/view/**` (React + EditContext + DOM) in TypeScript.
> - A new package `packages/editor-native` (Rust crate compiled to WASM) and its thin TS binding.
>
> Source docs:
>
> - `docs/030_ts_editor_markdown_nesting_snapshot_lifecycle.md` — the TS editor plan. This document is its native sibling and inherits its spine (the `EditorDocumentSnapshot` is the single source of truth; compat is off-spine and deletable). §5.7 of 030 ("the TS core stays the spec and oracle") is the seed this document grows from.
> - `docs/010_owned_model_virtualized_editor_plan.md` — the owned-model foundation and the framework-free `core/**` boundary (G3/G4 lint).
> - `docs/025_virtual_geometry_offset_model_and_fling.md` — the `OffsetModel` SPI + treap; the interface-with-reference-oracle pattern this document generalizes.
> - `docs/028_reader_convergence_snapshot_native_dispatch.md` — the reader consumes the native snapshot; relevant to a future native reader in Workers.
> - `docs/013_collaborative_owned_model_yjs_adaptation.md` / `docs/014_crdt_future_proofing_brainstorm.md` — the collaboration future that tips this from "perf play" to "foundation."
>
> Related docs:
>
> - `note.md` §4 / docs/030 — the markdown/nesting/save/memory work whose representation costs (load, save, memory) motivate this core.
>
> Assumptions:
>
> - This is a measured proposal, not a commitment. The whole document is gated on a vertical-slice benchmark (§7.1): the TS core remains the production implementation and the parity oracle until the native core beats it on the tail by a margin that justifies a second language. If the gate fails, the conclusion is "stay in TS, do docs/030's worker+streaming version" and that is a successful outcome of this plan, not a failure.
> - `compat.ts` is deleted (or scheduled for deletion) before the native core lands; the native core never speaks the legacy PayloadCMS-Lexical shape. See `compat-is-temporary-not-official-path` memory and the compat file banner.
> - `core/**` is already framework-free by lint (docs/020), so the boundary this swap needs already exists; the view (EditContext/DOM) is intrinsically browser-side and stays TypeScript.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary: Three Zones, One Contract](#2-system-summary-three-zones-one-contract)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 What Is Already Native-Ready](#31-what-is-already-native-ready)
  - [3.2 The Representation Costs That Motivate This](#32-the-representation-costs-that-motivate-this)
  - [3.3 The Rust Ecosystem That Maps Onto Core](#33-the-rust-ecosystem-that-maps-onto-core)
- [4. Target Model](#4-target-model)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 N1 — Model On Main Thread, Pure Compute Off Main](#51-n1--model-on-main-thread-pure-compute-off-main)
  - [5.2 N2 — Swap The Whole Core Behind The View↔Core Seam, Not Layer By Layer](#52-n2--swap-the-whole-core-behind-the-viewcore-seam-not-layer-by-layer)
  - [5.3 N3 — Adapt Algorithms, Redesign Representations](#53-n3--adapt-algorithms-redesign-representations)
  - [5.4 N4 — Rust Parsers For Import, JS For The Live DOM](#54-n4--rust-parsers-for-import-js-for-the-live-dom)
  - [5.5 N5 — The Scheduler Extends As A Compute-Offload Coordinator](#55-n5--the-scheduler-extends-as-a-compute-offload-coordinator)
  - [5.6 N6 — The TS Core Is The Executable Oracle; The Gate Is Measured](#56-n6--the-ts-core-is-the-executable-oracle-the-gate-is-measured)
- [6. Implementation Strategy](#6-implementation-strategy)
- [7. Detailed Implementation Plan](#7-detailed-implementation-plan)
  - [7.1 The Vertical-Slice Spike (The Gate)](#71-the-vertical-slice-spike-the-gate)
  - [7.2 The Boundary Contract](#72-the-boundary-contract)
  - [7.3 Model Storage Redesign](#73-model-storage-redesign)
  - [7.4 Algorithm Adaptation](#74-algorithm-adaptation)
  - [7.5 Import And Export In Rust](#75-import-and-export-in-rust)
  - [7.6 Binary And Incremental Persistence](#76-binary-and-incremental-persistence)
  - [7.7 Worker Compute Lanes](#77-worker-compute-lanes)
- [8. Migration And Rollout](#8-migration-and-rollout)
- [9. Edge Cases And Failure Modes](#9-edge-cases-and-failure-modes)
- [10. Implementation Backlog](#10-implementation-backlog)
- [11. Future Backlog](#11-future-backlog)
- [12. Definition Of Done](#12-definition-of-done)
- [13. Final Model](#13-final-model)

## 1. Goal

Decide whether to replace the implementation behind `packages/editor/src/core/**` with a Rust/WASM core, and if so, define exactly how — what is adapted, what is redesigned, where the threading boundary sits, and what numbers justify the commit.

The motivation is not "Rust is fast." It is three specific facts about this codebase that make a native core an unusually good bet here, and one fact that makes it a gated bet rather than a leap. The good bets: `core/**` is already framework-free, so the boundary a WASM swap needs already exists (docs/020); the dominant remaining bottleneck is representation cost — eager O(n) load, full-rebuild save, unbounded memory (docs/030 §3.4) — which is precisely where Rust's value lives; and the documented collaboration future (docs/013/014) is Rust-native territory (CRDT engines like `yrs`, `diamond-types`, `automerge-rs` are all Rust), so a native core is a foundation, not just an optimization. The gating fact: the editor's hot path crosses the JS↔WASM boundary on every read, so the entire payoff hinges on that boundary being cheap, which must be *measured*, not assumed.

This document is therefore structured as a measured proposal. The TypeScript core (docs/030) is the production implementation and the parity oracle. A vertical-slice spike (§7.1) measures the boundary economics; only if the numbers clear the gate (§5.6) does the full swap proceed. "Stay in TypeScript" is an explicit, acceptable outcome.

Non-goals: building collaboration/CRDT (a later milestone the model is shaped to meet, not this document's work); a server-side native reader (future backlog, §11); changing `EditorDocumentSnapshot`, `onSave`, or any view-facing contract (the swap is invisible above the seam); and porting `compat.ts` (it is deleted, never spoken by the native core).

## 2. System Summary: Three Zones, One Contract

The architecture is three zones separated by where latency and purity live, joined by one unchanged contract.

```text
  ┌─ MAIN THREAD ─────────────────────────────┐      ┌─ WORKER(S) ───────────────┐
  │                                            │      │                           │
  │  JS view (React + EditContext + DOM)       │      │  pure compute (Rust/WASM) │
  │        │  FFI (sync, zero-copy reads)      │      │   - bake / highlight      │
  │        ▼                                   │      │   - diagram / mermaid     │
  │  editor-native core (Rust/WASM)            │      │   - bulk import parse     │
  │   model arena · treap · marks · commands   │◄─────┤     (bytes → snapshot     │
  │   history · selection                      │ xfer │      buffer, Transferable)│
  └────────────────────────────────────────────┘      └───────────────────────────┘
                        │
        EditorDocumentSnapshot  (the unchanged boundary contract)
        load: adopt buffer   ·   save: emit (binary, incremental)   ·   reader: docs/028
```

Zone one, main thread, is latency-critical: the model lives in WASM linear memory and the JS view reads it through synchronous FFI calls into shared memory — no `postMessage`, no serialization, zero-copy window reads. The input path (EditContext text update → model step → render) stays sub-frame because it never leaves the thread.

Zone two, workers, is for pure, coarse, non-latency-critical compute: bake/highlight, diagram render, and bulk import parsing. These take a copy and return a copy (one message in, one out), so there is no chattiness and no shared model. Bulk import returns a compact snapshot buffer by `Transferable` (zero-copy hand-off), which main-thread WASM adopts into its arena.

The contract joining them is `EditorDocumentSnapshot` — exactly as today (docs/030 §2). Load adopts a buffer into the arena; save emits it (binary and incremental); the reader consumes it (docs/028). Above the seam, `getEditorSnapshot()`/`onSave`/`createEditorStore({snapshot})` are unchanged, which is what lets the swap be invisible to the host and reversible.

## 3. Current-State Findings

### 3.1 What Is Already Native-Ready

The boundary exists. `core/**` is framework-free by lint (docs/020 G3/G4) — model, store, commands, offset model, bake-of-pure-data carry no React/DOM. The view consumes core only through narrow interfaces, so the swap target is a seam, not a tangle.

The interface-with-oracle pattern is already in place where it matters most. `OffsetModel` is an interface (`core/offset-model/index.ts`) with two interchangeable implementations — `FlatOffsetModel` (the O(n) reference oracle) and `TreapOffsetModel` (the O(log n) terminal impl wired in `view/controllers/use-virtual-window.ts:155`). This is precisely the shape a Rust impl drops into, and the oracle is precisely how you parity-test it.

The serialized contract is native and stable. `EditorDocumentSnapshot` (`core/model/model.ts:279-294`) is produced by `toSnapshot()` and consumed by `createEditorStore({snapshot})` and the reader (docs/028), with no compat in the path (docs/030 §3.1). A Rust core satisfies the same contract by adopting/emitting the same logical shape.

The worker plumbing exists. `bake.worker.ts` runs baking off-thread today, coordinated by a lane in `core/scheduler.ts`. The worker-offload pattern this document needs is already proven for one task.

Compat is excluded. `compat.ts` is a deletable legacy importer (its own banner; the `compat-is-temporary-not-official-path` memory); the native core never speaks it.

### 3.2 The Representation Costs That Motivate This

From docs/030 §3.4, restated as the costs Rust addresses:

- Load is eager, synchronous, O(n): `createEditorStore` materializes the whole `#nodes` map and `#parentOf` index before first paint (`core/store/editor-store.ts:404-407`). JS object allocation per node + mark dominates; GC pressure compounds it.
- Save rebuilds the whole object: `toSnapshot()` does `Object.fromEntries([...#nodes.entries()])` even for a one-block edit; the `touched` set the store already computes is unused for serialization.
- Memory is unbounded: the full model is resident as JS objects (heavy per-node overhead, hidden classes, GC), and the bake cache never evicts.
- Scroll is already solved (treap, O(log n)) — so the native win is load/memory/GC-jank, not scroll.

These are representation costs — object overhead, full-map rebuilds, GC — which is exactly the category where a Rust arena + binary serialization + no-GC linear memory wins, and exactly the category a faithful 1:1 port would *fail* to win (see §5.3).

### 3.3 The Rust Ecosystem That Maps Onto Core

Candidate crates, to be confirmed during the spike, grouped by the core concern they serve (these are architecture-level candidates; exact crate/version selection is part of §7.1):

- Markdown parse: `comrak` (full GFM — tables, task lists, strikethrough) or `pulldown-cmark` (CommonMark + extensions; powers rustdoc/mdBook). Replaces the TS `markdown-it` dependency (docs/030 §7.1) on the native path.
- HTML parse + sanitize (paste): `html5ever`/`scraper` (Servo's parser) or `lol-html` (Cloudflare's streaming rewriter, runs in Workers), plus `ammonia` (HTML sanitizer on html5ever). Replaces both `markdown-it` and the hand-rolled `sanitizeHtmlToCompat` on the native path.
- Big-text representation: `ropey`/`crop` (ropes) for large leaves only.
- Model storage: `slotmap`/arena patterns for integer-id contiguous node storage.
- Binary serialization: `rkyv` (zero-copy deserialize) or `bincode`.
- CRDT (future): `yrs` (Yjs in Rust), `diamond-types`, `automerge-rs`.

The point of listing these is that core's concerns are not exotic — every one has a mature, fast Rust crate, which is why the adaptation is tractable.

## 4. Target Model

The native core is a representation swap behind a stable contract. Three invariants define it.

The contract is unchanged. `EditorDocumentSnapshot` remains the only serialized form and the only thing crossing the seam in bulk; `getEditorSnapshot()`/`onSave`/`createEditorStore({snapshot})` are byte-compatible above the seam (the internal serialization may become binary, but the logical shape the host and reader see is the same). This is what makes the swap reversible and the host oblivious.

The model lives on main, in WASM. The arena-stored node graph, the treap, marks, commands, history, and selection run in WASM linear memory; the JS view reads the visible window through synchronous FFI into shared memory; input is sub-frame. Workers run only pure compute and hand back copies/Transferables.

The internals are selectively rebuilt. Algorithms whose value is the algorithm are adapted faithfully (treap, marks, segmentText, commands, steps), with the TS impl as the parity oracle. Representations whose value is the layout are redesigned for Rust (arena storage, binary + incremental serialization, rope-for-large-leaves). Compat is not ported. History is adapted now and redesigned at the CRDT milestone.

The throughline that makes this one design rather than a rewrite: because the contract is `EditorDocumentSnapshot` and the boundary is the existing framework-free seam, the native core is *measured against* the TS core continuously (same input → same snapshot), so "native" never means "unverified" — it means "a faster implementation of a spec we already have and test."

## 5. Architecture Decisions

### 5.1 N1 — Model On Main Thread, Pure Compute Off Main

Recommended: the model lives in main-thread WASM; the JS view reads it via synchronous FFI into shared linear memory. Workers run only stateless, coarse, pure compute (bake/highlight, diagram render, bulk import parse), receiving a copy and returning a copy or a `Transferable` buffer. No `SharedArrayBuffer` for the model, because the model never leaves main.

The reasoning that dissolves the worker fear: chattiness is only a problem when the *model* is across a thread boundary. Keep the model on main and per-frame reads are FFI (cheap, synchronous, zero-copy); put only coarse pure tasks in workers and each is one message in, one out. Bulk import — the one heavy task that benefits from a worker — parses bytes into a snapshot buffer and `Transfer`s it (zero-copy) to main, which adopts it into the arena, so heavy import runs off-thread without the model ever living there.

Rejected — model in a worker (with `SharedArrayBuffer` + Atomics): every view read becomes a cross-thread access, the input hot path round-trips a thread boundary (a latency risk no editor should take), and the synchronization complexity is large. The earlier worry about a "chatty bridge" was really a worry about *this* design; it does not apply once the model stays on main.

### 5.2 N2 — Swap The Whole Core Behind The View↔Core Seam, Not Layer By Layer

Recommended: replace `core/**` as one unit behind the existing view↔core seam. The seam is already narrow and interface-shaped; the bulk crossing is the window read per frame.

Rejected — port one module at a time (e.g. only the treap in Rust, store/commands in JS): a single-module port puts the boundary *through* the core — a Rust treap would need the JS store to feed it order/height changes on every edit, so the boundary lands in the hot mutation loop, the worst place, and a spike built that way *mismeasures* (it shows a worse number than the final design where the boundary is around the core, crossed in bulk). The clean boundary is around the whole core; the spike (§7.1) honors this by being a vertical slice (a minimal whole-core that serves a window), not a horizontal layer.

### 5.3 N3 — Adapt Algorithms, Redesign Representations

Recommended: decide per module with one rule — is the value the algorithm or the representation? Algorithm → faithful adaptation; representation → redesign.

| Core concern | Decision | Why |
| --- | --- | --- |
| Offset model (treap) | Adapt | Augmented-treap algorithm is already correct/O(log n); `FlatOffsetModel` stays the oracle. |
| Mark anchoring, `segmentText` | Adapt | Pure boundary math; the cleverness is the code. |
| Command compilers, step/inverse algebra | Adapt | Pure transformations; logic is the value. |
| Node storage (`Map<NodeId, object>`) | Redesign | Arena/slotmap, integer ids, contiguous — the memory/GC win lives here; a HashMap-of-boxed-structs port forfeits it. |
| Serialization (`toSnapshot` JSON) | Redesign | Binary (`rkyv`/`bincode`) + incremental-by-key (docs/030 §7.4). |
| `TextContent` (big text) | Redesign (selective) | Rope (`ropey`) for large leaves only; short paragraphs keep simple strings — evaluate per-leaf. |
| History | Adapt now, redesign at CRDT | Step algebra ports today; the op-log replaces it when collab lands (docs/013/014). |
| `compat.ts` | Do not port | Deleted; the native core never speaks the legacy shape. |

Rejected — literal 1:1 transliteration: it would keep the JS representations (hashmap, JSON, strings) and therefore *not win the very costs that motivate the project* (§3.2). Rejected — from-scratch redesign of everything: throws away correct, tested algorithms and inflates the parity-test surface. The selective rule keeps the redesign small and the oracle meaningful.

### 5.4 N4 — Rust Parsers For Import, JS For The Live DOM

Recommended: on the native path, parse markdown and HTML in Rust. Markdown → native nodes via `comrak`/`pulldown-cmark` (no JS markdown dependency); HTML paste → parse + sanitize + build native nodes in one pass via `html5ever`/`lol-html` + `ammonia` (replacing both `markdown-it` and `sanitizeHtmlToCompat`). `lol-html` being streaming also serves chunked import (docs/030 §7.5).

Boundary that must stay sharp: the *live editing surface* is the browser's EditContext/DOM, which WASM cannot touch except through JS bindings; Rust speeds up *parsing external text* (paste/import — pure string→nodes), not the live DOM. So the view (EditContext, caret geometry, contenteditable host) stays TypeScript; only the import/export path moves into Rust. This supersedes docs/030 §7.1's `markdown-it` recommendation *for the native path only* — same contract ("produce native `EditorNode[]` from markdown"), different (faster, dependency-free) implementation. The two documents are alternative implementations of one contract, not a conflict.

### 5.5 N5 — The Scheduler Extends As A Compute-Offload Coordinator

Recommended: keep `core/scheduler.ts` as a main-thread lane coordinator and extend it with worker-offload lanes for the pure tasks of N1 (bake/highlight already exists; add diagram render, bulk import). It never brokers the model.

Rejected — recast the scheduler as a model-RPC bridge to a worker: only needed if the model lived in a worker (rejected in N1). With the model on main, the model boundary is same-thread FFI, which needs no coordinator; the scheduler coordinates *compute offload*, which it already does for bake.

### 5.6 N6 — The TS Core Is The Executable Oracle; The Gate Is Measured

Recommended: the TS core (docs/030) remains production and the parity oracle. The full swap is gated on a vertical-slice spike (§7.1) measured on a deliberately huge benchmark document against the TS core. The gate metrics: load time, save time, memory footprint, scroll jank, and — the decisive one — **per-frame FFI read cost** (the number that decides whether main-thread WASM reads are actually as cheap as N1 claims). Native must beat TS on the tail (the huge-doc case; small docs will not show it) by a margin that justifies a second language and toolchain.

Rejected — commit to the full port unmeasured: the entire payoff hinges on the boundary read cost, which is the one thing intuition gets wrong; a wrong guess here adds a language for a regression. "Gate fails → stay in TS and do docs/030's worker+streaming version" is a valid, planned outcome.

## 6. Implementation Strategy

Two stages with a hard gate between them, so no irreversible cost is paid before the boundary economics are known.

Stage one — the spike (§7.1). Build the smallest whole-core vertical slice that proves or kills the design: a Rust/WASM core holding the model in an arena, serving a window slice to a JS view through FFI, with one worker bake lane. Measure the gate metrics (§5.6) against the TS core on a huge benchmark doc. This is days-to-weeks of work, not the full port, and it answers the only question that matters before committing.

Stage two — the full swap (§7.2–§7.7), only if the gate clears. Land the boundary contract, the storage redesign, the algorithm adaptation (oracle-tested module by module), import/export in Rust, binary+incremental persistence, and the worker lanes. Each adapted algorithm is parity-tested against its TS oracle before it replaces it; the view never changes; the host contract never changes.

Compatibility and reversibility throughout: because the contract is `EditorDocumentSnapshot` and the seam is unchanged, the TS core can remain a runtime fallback (WASM-unsupported environments, or a feature flag) during and after the migration, and any module can fall back to its TS oracle if a parity test regresses. Compat is already gone before stage two.

## 7. Detailed Implementation Plan

### 7.1 The Vertical-Slice Spike (The Gate)

Current problem: the native payoff is unproven; the per-frame FFI read cost (N1) is the load-bearing unknown.

Target behavior: a minimal `editor-native` core holds a model (arena), applies a basic edit, and serves a window slice to a JS view through FFI, with one worker bake lane; the gate metrics are measured against the TS core.

Implementation tasks:

- [ ] `packages/editor-native` Rust crate + wasm-bindgen/wasm-pack build; a thin TS binding exposing: adopt-snapshot, apply-step, read-window, emit-snapshot.
- [ ] Arena-stored nodes (integer ids), a faithful treap adaptation (oracle: `FlatOffsetModel`), and a window-read that returns the visible slice as one compact buffer (not per-node calls).
- [ ] A worker bake lane reachable through the scheduler pattern.
- [ ] A huge benchmark document (e.g. 50k–200k blocks with marks) and a harness measuring load, save, memory, scroll jank, and per-frame FFI read cost for both cores.

Acceptance criteria:

- The slice renders a window from the Rust-held model and round-trips a snapshot identical to the TS core's for the same input.
- The gate metrics are recorded; a go/no-go recommendation is written with the numbers.

Tests:

- A parity harness: same input → same `EditorDocumentSnapshot` (Rust vs TS); a benchmark report committed under `docs/` or `bench/`.

### 7.2 The Boundary Contract

Current problem: the view reads the model constantly; a chatty FFI shape would erase the gains.

Target behavior: a bulk, zero-copy read contract — the view requests a window and receives one borrowed view into linear memory (offsets/lengths into shared bytes), never N per-node calls; commands cross as compact encoded steps.

Implementation tasks:

- [ ] Define the window-read buffer layout (block ids, types, text spans, mark ranges, geometry) and a TS-side decoder that reads it without copying strings where possible.
- [ ] Define the step/command encoding crossing JS→WASM (a compact tagged form, not a JSON object per step).
- [ ] Define snapshot adopt (Transferable buffer → arena) and emit (arena → buffer) entry points.

Acceptance criteria:

- A window render issues O(1) FFI calls per frame (one bulk read), not O(window).
- No per-node string copy on the steady-state read path.

Tests:

- An FFI-call-count assertion on a render frame; a no-copy assertion on the read path.

### 7.3 Model Storage Redesign

Current problem: `Map<NodeId, JS object>` carries per-node object overhead and GC pressure (§3.2).

Target behavior: arena/slotmap storage with integer node ids, contiguous layout, and the reverse parent index and order maintained as compact structures.

Implementation tasks:

- [ ] Node arena (slotmap) with integer ids; a stable mapping to/from the external `NodeId` brand at the boundary.
- [ ] Parent index + body order as compact arrays/structures.
- [ ] The skeleton/body split (docs/030 §7.6) expressed natively so memory paging is cheap.

Acceptance criteria:

- Resident memory for the benchmark doc is materially below the TS core (a gate metric).

Tests:

- Memory-footprint comparison in the benchmark harness.

### 7.4 Algorithm Adaptation

Current problem: the algorithms are correct in TS and must be reproduced exactly, not reinvented.

Target behavior: faithful Rust ports of the treap, mark anchoring, `segmentText`, command compilers, and step/inverse algebra, each parity-tested against its TS oracle before replacing it.

Implementation tasks:

- [ ] Treap (oracle: `FlatOffsetModel`).
- [ ] Mark boundary anchoring + `segmentText` (oracle: the TS `marks.ts`/`segmentText`).
- [ ] Command compilers + step apply/invert (oracle: the TS command + store tests).

Acceptance criteria:

- Every adapted module is byte-for-byte parity with its TS oracle across the existing test corpus.

Tests:

- The existing `tests/editor/**` corpus run against the native core through a parity shim.

### 7.5 Import And Export In Rust

Current problem: the TS path depends on `markdown-it` and a hand-rolled HTML sanitizer; both can move into the core and get faster.

Target behavior: markdown→native-nodes via `comrak`/`pulldown-cmark`; HTML paste parse+sanitize+build via `html5ever`/`lol-html` + `ammonia`; markdown export via native string building — all producing/consuming the same `EditorNode[]`/snapshot contract as docs/030 §7.1/§7.2.

Implementation tasks:

- [ ] Rust markdown→nodes (GFM incl. task lists and `==` via the chosen crate's extensions).
- [ ] Rust HTML→nodes with sanitization in one pass.
- [ ] Rust nodes→markdown (the export direction; baked-fields-only for objects, docs/006 §5.8).

Acceptance criteria:

- Paste/import/export parity with docs/030's TS implementations on the same fixtures; `markdown-it` and `sanitizeHtmlToCompat` removable on the native path.

Tests:

- The docs/030 markdown paste/export fixtures run against the native parsers.

### 7.6 Binary And Incremental Persistence

Current problem: JSON `toSnapshot` is O(n) and large; the native path can do better while keeping the logical contract.

Target behavior: emit/adopt a compact binary form (`rkyv`/`bincode`) for load/save, incremental by touched key (docs/030 §7.4), while the logical `EditorDocumentSnapshot` the host/reader sees is unchanged (the binary is an internal transport; the host still receives a snapshot, possibly via a cheap decode).

Implementation tasks:

- [ ] Binary encode/decode of the snapshot; zero-copy adopt on load.
- [ ] Incremental emit keyed to the touched set.
- [ ] A logical-snapshot compatibility shim so `getEditorSnapshot()`/`onSave` keep their current shape for the host.

Acceptance criteria:

- Load and save times on the benchmark doc materially below the TS core; the host contract unchanged.

Tests:

- Load/save benchmark comparison; a round-trip parity test (binary → logical snapshot equals the TS snapshot).

### 7.7 Worker Compute Lanes

Current problem: heavy compute on main thread blocks input.

Target behavior: bake/highlight, diagram render, and bulk import run in worker WASM as pure tasks; results return by copy or `Transferable`; the scheduler coordinates the lanes (N5).

Implementation tasks:

- [ ] Generalize the existing bake worker pattern to a small set of pure-task lanes.
- [ ] Bulk import lane: bytes → snapshot buffer (Transferable) → main adopts.
- [ ] Scheduler lane registration + result adoption.

Acceptance criteria:

- A large import does not block the main thread; bake/highlight stay off the input path.

Tests:

- A main-thread-not-blocked assertion during a large import (timing-based); bake-off-main assertion.

## 8. Migration And Rollout

The TS core ships first and stays the fallback. docs/030 lands in TypeScript; the native core arrives later, behind a capability/feature flag, with the TS core retained for WASM-unsupported environments and as a per-module fallback if a parity test regresses.

Gate before commit: the §7.1 spike must clear §5.6 before any stage-two work begins. A failed gate ends the native effort with a documented number and a redirect to docs/030's worker+streaming load/save.

Module-by-module cutover under parity: each adapted algorithm (§7.4) replaces its TS counterpart only after passing the TS oracle on the full `tests/editor/**` corpus through the parity shim. The view and the host contract never change during cutover, so each step is reversible.

Compat is already gone: the native core never speaks the legacy shape; the corpus migration and `compat.ts` deletion (docs/030 §8) precede stage two.

Toolchain and build: `packages/editor-native` adds a Rust + wasm-pack build to the monorepo; CI gains a Rust test job and a WASM build artifact; the TS binding stays thin so `@idco/editor`'s public API is unchanged.

## 9. Edge Cases And Failure Modes

- FFI read-cost regression (the gate's decisive risk): if per-frame reads are not cheap, the design fails the gate; outcome is "stay in TS," not "ship it slow." The spike exists to catch this before commit.
- WASM unsupported / disabled: fall back to the TS core behind the same seam; the editor stays fully functional in TypeScript.
- Linear-memory growth: WASM linear memory only grows; the skeleton/body paging (§7.3, docs/030 §7.6) and the bake LRU bound the resident set, and the arena reuses slots — without these, a long session leaks. Memory bounding is a prerequisite, not an add-on.
- Worker transfer hazards: a `Transferable` buffer is detached after transfer; the producer must not reuse it; the adopt step must validate the buffer before mapping it into the arena.
- Parity drift between Rust and TS: any divergence is a build-breaking parity-test failure; the TS oracle is authoritative, and the native module falls back until fixed.
- Debugging across the boundary: source maps and panic→JS-error plumbing must exist from the spike, or boundary bugs become opaque; budget for it explicitly.
- CRDT history swap (future): when the op-log replaces the step algebra, the inverse-step history tests are repointed at op-log equivalents; until then, history is the adapted step algebra.

## 10. Implementation Backlog

### N1-A. Vertical-Slice Spike + Benchmark Harness

Scope:

- `packages/editor-native/**` (new Rust crate + wasm build)
- `bench/**` or `docs/` (benchmark report)

Tasks:

- [ ] Minimal arena model + treap (oracle: `FlatOffsetModel`) + bulk window-read FFI + one worker bake lane.
- [ ] Huge benchmark doc + harness measuring load/save/memory/scroll/FFI-read-cost for both cores.

Acceptance criteria:

- A committed go/no-go report with the gate metrics; a window renders from the Rust model with snapshot parity.

Tests:

- Parity harness (same input → same snapshot); benchmark report.

### N2-A. Boundary Contract

Scope:

- `packages/editor-native/**`, the TS binding, `packages/editor/src/view/**` read sites

Tasks:

- [ ] Bulk window-read buffer layout + decoder; step encoding; snapshot adopt/emit.

Acceptance criteria:

- O(1) FFI calls per render frame; no steady-state per-node string copy.

Tests:

- FFI-call-count and no-copy assertions.

### N3-A. Storage + Algorithm Adaptation (Oracle-Gated)

Scope:

- `packages/editor-native/**`, `tests/editor/**` via a parity shim

Tasks:

- [ ] Arena storage; treap, marks/`segmentText`, commands, steps adapted and parity-tested.

Acceptance criteria:

- The full `tests/editor/**` corpus passes against the native core; memory below TS on the benchmark.

Tests:

- `tests/editor/**` through the native parity shim.

### N3-B. Rust Import/Export

Scope:

- `packages/editor-native/**`

Tasks:

- [ ] `comrak`/`pulldown-cmark` markdown→nodes; `lol-html`/`html5ever`+`ammonia` HTML→nodes; nodes→markdown export.

Acceptance criteria:

- Parity with docs/030 §7.1/§7.2 fixtures; `markdown-it`/`sanitizeHtmlToCompat` removable on the native path.

Tests:

- docs/030 paste/export fixtures against the native parsers.

### N3-C. Binary + Incremental Persistence

Scope:

- `packages/editor-native/**`, `packages/editor/src/view/use-autosave.ts` integration

Tasks:

- [ ] Binary encode/decode; incremental emit by touched key; logical-snapshot shim for the host.

Acceptance criteria:

- Load/save below TS on the benchmark; host contract unchanged.

Tests:

- Load/save benchmark; binary→logical snapshot parity.

### N3-D. Worker Compute Lanes

Scope:

- `packages/editor-native/**`, `packages/editor/src/core/scheduler.ts` equivalent

Tasks:

- [ ] Pure-task lanes (bake/highlight, diagram, bulk import); Transferable adoption.

Acceptance criteria:

- Large import does not block main; bake/highlight off the input path.

Tests:

- Main-thread-not-blocked timing assertion.

## 11. Future Backlog

- CRDT op-log core (`yrs`/`diamond-types`/`automerge-rs`): replaces the step/inverse history and folds incremental save (docs/030 §7.4) and memory paging (docs/030 §7.6) into one foundation when collaboration lands (docs/013/014).
- Native reader in Workers: compile the same Rust to WASM for the Cloudflare export/EPUB worker (docs/006 §2.7) and the server reader (docs/028), collapsing the editor↔reader `segmentText` duplication (note.md §3 cluster A) into a single source compiled for both targets.
- Multi-threaded WASM (threads proposal / `wasm-bindgen-rayon`) for parallel bulk operations, once browser support and the build justify it.
- Rope-everywhere reevaluation if large-leaf editing becomes common.

## 12. Definition Of Done

- The §7.1 spike is built and a go/no-go report with the gate metrics (load, save, memory, scroll, per-frame FFI read cost) is committed; the decision is explicit.
- If go: the native core passes the full `tests/editor/**` corpus through the parity shim; load/save/memory beat the TS core on the benchmark by the recorded margin; the view and `getEditorSnapshot()`/`onSave`/`createEditorStore` contracts are unchanged; the TS core remains a fallback; `markdown-it`/`sanitizeHtmlToCompat` are removable on the native path.
- If no-go: the report documents the failing metric and redirects to docs/030's worker+streaming load/save; no native core ships.
- Either way, the TS core stays the parity oracle; no decision is taken on faith.
- `note.md` §4 / docs/030 cross-reference this document as the native sibling; the relevant memories updated.

## 13. Final Model

editor-native is a parity-gated representation swap, not a rewrite. The `EditorDocumentSnapshot` contract and the framework-free view↔core seam stay exactly as they are, so the native core is something the existing TypeScript core is continuously measured against rather than replaced by faith: same input, same snapshot. The model lives in main-thread WASM where the JS view reads it through cheap synchronous FFI, keeping input sub-frame, while only pure, coarse compute — bake, highlight, diagram, bulk import — goes to workers as copy-in/copy-out tasks, which is why the "chatty bridge" fear dissolves: the chatty part never crosses a thread. Inside the core, algorithms whose value is the algorithm are adapted faithfully against their TS oracle, representations whose value is the layout are redesigned for Rust's arena, binary, and rope, and compat is never spoken at all. Rust's parser ecosystem makes import faster and dependency-free without ever touching the browser-owned live DOM, which stays TypeScript. And because incremental save, memory paging, and the eventual CRDT op-log all pivot on the same unit — a changed block by key — the native core is simultaneously the answer to today's load/save/memory costs and the foundation collaboration will stand on. The whole proposal reduces to one disciplined move: build the smallest vertical slice that can measure the one number intuition gets wrong (the per-frame boundary read cost), and let that number, not enthusiasm, decide whether the rest is built.
