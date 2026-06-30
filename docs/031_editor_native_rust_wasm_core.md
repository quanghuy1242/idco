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
> - `docs/035_editor_desktop_native_rust_gui.md` — the native-desktop sibling. Where 031 reads the Rust core from a TS browser view over an FFI seam, 035 adds a second, native view that links the core directly (no seam, so 031's §5.6 FFI-read gate does not apply to it). 035 is why N10 (runtime-agnostic core) is a near-term requirement rather than a future nicety: one crate must compile to both wasm (this document) and native (035), so it can depend on neither `tokio` nor browser futures.
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
  - [5.7 N7 — The Arena Is A Hard Memory Cap On The Model (The Non-Speed Motivation)](#57-n7--the-arena-is-a-hard-memory-cap-on-the-model-the-non-speed-motivation)
  - [5.8 N8 — A Wasm-Arena BodyStore Is The Cheaper Memory Path; The Full Swap Earns Itself On Speed + Collab](#58-n8--a-wasm-arena-bodystore-is-the-cheaper-memory-path-the-full-swap-earns-itself-on-speed--collab)
  - [5.9 N9 — Keep TS As The Permanent Oracle; Retire Only The Shipped Runtime Fallback](#59-n9--keep-ts-as-the-permanent-oracle-retire-only-the-shipped-runtime-fallback)
  - [5.10 N10 — The Core Is Runtime-Agnostic; Async Lives In Per-Target Hosts (The Wasm/Tokio Split)](#510-n10--the-core-is-runtime-agnostic-async-lives-in-per-target-hosts-the-wasmtokio-split)
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

The motivation is not "Rust is fast." It is three specific facts about this codebase that make a native core an unusually good bet here, and one fact that makes it a gated bet rather than a leap. The good bets: `core/**` is already framework-free, so the boundary a WASM swap needs already exists (docs/020); the dominant remaining bottleneck is representation cost — eager O(n) load, full-rebuild save, unbounded memory (docs/030 §3.4) — which is precisely where Rust's value lives; and the documented collaboration future (docs/013/014) is Rust-native territory (CRDT engines like `yrs`, `diamond-types`, `automerge-rs` are all Rust), so a native core is a foundation, not just an optimization. Within that representation-cost bet, the single cleanest and least-contingent win is *memory determinism*: a fixed WASM arena is the only way to give the model a real **hard** memory cap (N7), where pure JS can only purge toward a *soft* budget (docs/030 §5.6) — and unlike the load-speed win, this one does not depend on the boundary-read gate. The gating fact: the editor's hot path crosses the JS↔WASM boundary on every read, so the entire payoff hinges on that boundary being cheap, which must be *measured*, not assumed.

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

The serialized contract is native and stable. `EditorDocumentSnapshot` (`core/model/model.ts:305`) is produced by `toSnapshot()` and consumed by `createEditorStore({snapshot})` and the reader (docs/028), with no compat in the path (docs/030 §3.1). A Rust core satisfies the same contract by adopting/emitting the same logical shape.

The worker plumbing exists. `bake.worker.ts` runs baking off-thread today, coordinated by a lane in `core/scheduler.ts`. The worker-offload pattern this document needs is already proven for one task.

Compat is excluded. `compat.ts` is a deletable legacy importer (its own banner; the `compat-is-temporary-not-official-path` memory); the native core never speaks it.

### 3.2 The Representation Costs That Motivate This

From docs/030 §3.4, restated as the costs Rust addresses:

- Load is eager, synchronous, O(n): `createEditorStore` materializes the whole `#nodes` map and `#parentOf` index before first paint (`core/store/editor-store.ts:404-407`). JS object allocation per node + mark dominates; GC pressure compounds it.
- Save rebuilds the whole object: `toSnapshot()` does `Object.fromEntries([...#nodes.entries()])` even for a one-block edit; the `touched` set the store already computes is unused for serialization.
- Memory is unbounded: the full model is resident as JS objects (heavy per-node overhead, hidden classes, GC), and the bake cache never evicts. docs/030 §7.6 bounds this *softly* in TS (purge bodies to a `BodyStore`, budget arbiter) but cannot hard-cap it; the one cost the TS soft cap cannot relieve — the always-resident skeleton as JS objects on a very large doc (the "skeleton floor") — is what the integer-id arena compacts (N7).
- Scroll is already solved (treap, O(log n)) — so the native win is load/memory/GC-jank and a *hard* memory cap (N7), not scroll.

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

The model lives on main, in WASM. The arena-stored node graph, the treap, marks, commands, history, and selection run in WASM linear memory; the JS view reads the visible window through synchronous FFI into shared memory; input is sub-frame. Workers run only pure compute and hand back copies/Transferables. The arena is pre-sized to a ceiling and evicts to the cold store rather than growing, so the model carries a *hard* memory cap (N7) — the JS view/DOM heap stays browser-controlled, so the cap is on the model, not the whole app.

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

Recommended: keep `core/scheduler.ts` as a main-thread lane coordinator and extend it with worker-offload lanes for the pure tasks of N1 (bake/highlight already exists; add diagram render, bulk import). It never brokers the model. Reconciliation with N10 (§5.10): "keep the scheduler" means keep its *pure lane and budget logic* in the shared core — its *waking mechanism* (the `requestAnimationFrame`/idle/debounce-timer cadence in today's `core/scheduler.ts`) is browser-coupled and moves to the per-target host, which N10 requires; the host drives the lanes, the core decides what a lane does. So N5 and N10 do not actually conflict once the scheduler is split into shared logic plus a host-owned wake loop.

Rejected — recast the scheduler as a model-RPC bridge to a worker: only needed if the model lived in a worker (rejected in N1). With the model on main, the model boundary is same-thread FFI, which needs no coordinator; the scheduler coordinates *compute offload*, which it already does for bake.

### 5.6 N6 — The TS Core Is The Executable Oracle; The Gate Is Measured

Recommended: the TS core (docs/030) remains production and the parity oracle. The full swap is gated on a vertical-slice spike (§7.1) measured on a deliberately huge benchmark document against the TS core. The gate metrics: load time, save time, memory footprint, scroll jank, and — the decisive one — **per-frame FFI read cost** (the number that decides whether main-thread WASM reads are actually as cheap as N1 claims). Native must beat TS on the tail (the huge-doc case; small docs will not show it) by a margin that justifies a second language and toolchain. One factor sits partly outside the speed gate: *memory determinism* (N7). A guaranteed hard cap on the model is a capability the TS path structurally cannot offer, so if a deployment makes "never exceed N MB" a product requirement, that can justify the swap even when the speed margin is modest — record it in the spike report as a separate axis, not folded into the speed numbers.

Rejected — commit to the full port unmeasured: the entire payoff hinges on the boundary read cost, which is the one thing intuition gets wrong; a wrong guess here adds a language for a regression. "Gate fails → stay in TS and do docs/030's worker+streaming version" is a valid, planned outcome.

### 5.7 N7 — The Arena Is A Hard Memory Cap On The Model (The Non-Speed Motivation)

Recommended: treat *memory determinism* — a real, enforceable hard cap on the model — as the decisive non-speed reason to go native, distinct from and stronger than the load-speed reason. The load-speed win is contingent on the §5.6 FFI gate; the memory-determinism win is structural (no GC, a fixed arena) and does not depend on the boundary economics. docs/030 §5.6/§7.6 can only deliver a *soft* budget in pure JS: you cannot force GC, set a heap ceiling, or measure precisely (accounted bytes are 2-5× off from RSS), so the TS path purges toward a target and calibrates — it never guarantees a ceiling. The arena is what turns "near a target" into "≤ the target."

The mechanism, stated honestly with WASM's constraints. WASM linear memory grows but never shrinks (`memory.grow`, no `memory.shrink`), so you do not cap by shrinking — you **pre-size the arena to the ceiling** (`WebAssembly.Memory({ maximum })`), allocate nodes/bodies inside it with a slot allocator (`slotmap`, N3/§7.3), and on a full arena **evict to the cold store (IndexedDB) instead of growing**. Overflow is deterministic, freed slots recycle, and bytes-used is an exact arena offset — none of the JS heap's opacity. This is the Figma model: a fixed wasm heap with eviction, not a GC'd graph.

The honest boundary: the cap covers **only the model in the arena**, never the entire app. The JS view (React fiber tree, the mounted DOM window, the FFI window-read buffer, decoded strings on the JS side) lives on the JS heap, which nothing controls. So even native gives `model ≤ cap (guaranteed)` + `view heap = browser-controlled (uncapped)`; "100MB for the whole app" stays aspirational on the view side. Windowing already bounds the mounted DOM, which is the largest view-side consumer, but it is not a hard cap.

Why this is the cleanest motivation: the TS soft-cap work (docs/030 §7.6 — skeleton/body split, body LRU, `BodyStore` SPI, budget arbiter) is the *executable spec* this arena implements natively (N6), so it is not throwaway. And the one thing the TS soft cap cannot relieve — the always-resident skeleton itself, as JS objects, on a very large document (docs/030 §7.6 "skeleton floor") — is exactly what the integer-id arena compacts, so native is precisely the relief valve for the case TS cannot serve.

Rejected — rely on the TS soft cap alone where a guaranteed ceiling is a product requirement (mobile webview, embedded host with its own budget): a soft cap oscillates near a target and can be wrong by the RSS multiplier; if the requirement is "never exceed," only the arena satisfies it. Rejected — claim the native cap bounds the whole app: it bounds the model arena; the view heap is intrinsically browser-controlled, and saying otherwise would overstate the guarantee.

### 5.8 N8 — A Wasm-Arena BodyStore Is The Cheaper Memory Path; The Full Swap Earns Itself On Speed + Collab

Recommended: do not justify the full-core swap (N2) on memory determinism, because a much smaller move already delivers the hard cap. The bytes that dominate memory are the *bodies* (`TextContent`, marks, object `data`); the model graph the hot path touches — treap, `#parentOf`, `comparePoints` — is *body-blind* and runs on the small skeleton. So memory can be capped by putting only the bodies in a fixed WASM arena behind docs/030 §7.6's `BodyStore` SPI (a wasm-arena `BodyStore`, "Tier 1"), leaving the entire model graph in TypeScript. Bodies decode to a JS copy on mount/edit — coarse, once per viewport-body, *not per frame* — and overflow past the arena ceiling spills to IndexedDB. This is the memory-determinism win **without N2 and without the per-frame FFI gate that gates all of 031**, for a fraction of the build (one wasm module + a body serialize/decode seam, not a Rust treap/marks/commands/steps port plus parity shim).

This reshapes 031's gate. Memory is no longer a reason for the full swap; the wasm-arena `BodyStore` claims it on the docs/030 timeline. The full swap must therefore earn itself on the *other* axes: per-frame read speed on huge docs, the eventual CRDT op-log (Rust-native), and the one thing Tier 1 cannot cap — the always-resident **skeleton floor** (the skeleton as JS objects on an enormous document; only the full arena compacts it). The §7.1 spike must ask explicitly, before any stage-two commitment: *does the wasm-arena `BodyStore` already get the memory win?* If yes, native proceeds only if the speed and collaboration numbers justify it on their own.

Rejected — go straight to the full swap for memory: pays N2's cost and takes the FFI gate risk to cap bytes a single wasm module caps behind an existing SPI. Rejected — never build the arena because Tier 1 exists: Tier 1 caps bodies, not the skeleton floor; a document large enough to overflow the skeleton still needs Tier 2.

### 5.9 N9 — Keep TS As The Permanent Oracle; Retire Only The Shipped Runtime Fallback

Recommended: "keep both TS and native" resolves differently per tier, and the distinction is what keeps the maintenance honest. Under the wasm-arena `BodyStore` (N8/Tier 1) there is only *one* core — TypeScript — with a pluggable body backend (JS-Map/IndexedDB default; wasm-arena option). "Both" there is two storage backends behind one SPI, with *zero* algorithm duplication; keep both, it costs almost nothing. Under the full swap (Tier 2) there are genuinely two cores, and "keep both" must be split: keep the TS core as the **permanent parity oracle** (in CI, validated against the native core — the `FlatOffsetModel` precedent, maintained to oracle quality, never shipped), and **retire the TS core as a shipped runtime fallback** (two production implementations of every algorithm, kept parity-green forever, for a no-WASM audience that barely exists in modern browsers). Per-document routing (small docs → TS, huge → native, both in production) is *possible* because the snapshot contract round-trips identically, but it is the heaviest model and is taken only on a measured warmup-cost need.

Rejected — discontinue the TS core entirely after cutover: it is the oracle that makes "native" mean "verified," and the Tier-1 production core; deleting it removes both the correctness reference and the cheaper memory path. Rejected — ship both cores to production permanently as a fallback: a permanent double-implementation tax for an almost-empty no-WASM audience; the oracle belongs in CI, not in the shipped bundle.

### 5.10 N10 — The Core Is Runtime-Agnostic; Async Lives In Per-Target Hosts (The Wasm/Tokio Split)

Recommended: the `editor-native` core crate is **synchronous at its public API and depends on no async runtime** — no `tokio`, no `wasm-bindgen-futures`, no embedded executor. All async orchestration (worker offload, persistence I/O, debounced autosave, network) lives in **per-target host crates**: the wasm/browser host (this document's subject) and — once docs/035's native desktop editor exists — the native/desktop host. This was implicit in N1/N5 (model on main, synchronous FFI reads, the scheduler coordinates compute offload rather than running the model) but is made an explicit, load-bearing rule here because it is the precondition for the *one* core crate serving both wasm and native, which docs/035 turns from a future nicety into a near-term requirement.

The forcing fact. The desktop host wants `tokio` (the de-facto native async runtime), but a full-featured `tokio` does not work under `wasm32-unknown-unknown`: with the features a native host wants (`rt-multi-thread`/`net`, typically via `features=['full']` — tokio enables *nothing* by default) it does not *build* for wasm, and the wasm-compatible subset (`sync`/`macros`/`io-util`/`rt`/`time`) that compiles fails at *runtime* — the timers panic (`Instant::now` traps), there are no OS threads for a multi-threaded scheduler (a single-threaded cooperative event loop owned by the browser), and the runtime has a history of breaking outright on that target. Either way a `tokio`-dependent core cannot ship to wasm; a browser-futures-dependent core cannot run native. The only stable resolution is that the core depends on **neither**. The *hot path* is already this shape — the model is a synchronous state machine on the main thread, reads are synchronous FFI, commands are synchronous steps (N1). But the present TypeScript `core/**` is not yet runtime-free, and N10 should not pretend otherwise: `core/scheduler.ts` drives lane cadence with rAF/idle/`setTimeout`, `core/bake/bake.worker.ts` is a Web Worker, and `core/store/body-store.ts`/`history-pool.ts` are async. So N10 is partly *prerequisite work*, not a property already held: the scheduler's pure lane/budget logic stays shared (reconciled with N5 below), while its wake loop, the bake worker, and the async stores relocate to the host. Async is a host concern by design; N10 forbids ever letting a runtime leak below the seam, and the port is what makes that true in fact.

How the core exposes work that *wants* to be async without importing a runtime:

- **Synchronous core, host-driven cadence.** The hot path (apply a command, read a window) is synchronous; the host decides *when* to call it (`requestAnimationFrame` in the browser, a winit redraw / `tokio` interval natively). The core never spawns a task.
- **Pure compute as plain functions.** Bake/highlight, markdown/HTML parse (N4), snapshot encode (N3/§7.6) are `fn(input) -> output`. The host runs them where it wants — a Web Worker (browser, N5/§7.7) or a `tokio`/`rayon` thread (native). The core does not know which, which is exactly why the same function serves both worker lanes.
- **Cooperative long work via a step/poll interface, not futures.** If a long operation (bulk import, full re-bake) must yield, the core exposes a `step()`/`poll()` that does bounded work and returns progress, and the host drives it across frames or threads. No `async fn` in the core — that is what keeps it runtime-free.
- **Channels at the host boundary, runtime-agnostic.** Where a worker/thread result must flow back, use a runtime-agnostic channel (`std::sync::mpsc` natively; `postMessage`/`Transferable` adoption in the browser host, §7.7), never a `tokio` channel in shared code. If any shared async ever proves unavoidable, restrict it to the runtime-agnostic `futures` traits (`Future`/`Stream`) with no executor — but the default and strong preference is that the core has *no* `async` at all.

Compile-target split: the `wasm-bindgen` bindings live in the browser host crate behind `#[cfg(target_arch = "wasm32")]`; the native host links the same core plus its own `tokio`/`winit`/`vello` deps behind `#[cfg(not(target_arch = "wasm32"))]`. The core crate's `Cargo.toml` carries neither, and CI builds the core for `wasm32-unknown-unknown` to catch a runtime leak before it ships.

Rejected — pick one runtime (tokio) and polyfill it on wasm (`tokio` with only the `rt`/single-thread feature, or `wasm-bindgen-futures` shims): brittle, drags a large dependency into wasm for little gain, and still cannot use tokio's threaded scheduler in the browser; the sync-core/host-async split avoids the problem rather than papering over it. Rejected — make the core `async` over a runtime-agnostic executor (`smol`/`async-executor`) embedded in the core: it couples the core to an executor's scheduling and complicates the synchronous hot path N1 depends on; async belongs to the host, not the spine.

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
- [ ] The skeleton/body split (docs/030 §7.6) expressed natively so memory paging is cheap; the compact integer-id skeleton removes the TS "skeleton floor" that defeats a soft cap on huge docs.
- [ ] Hard cap (N7): pre-size the arena (`WebAssembly.Memory({ maximum })`), recycle freed slots, and evict to the cold store on a full arena instead of growing (linear memory never shrinks). docs/030 §7.6's soft-cap arbiter is the executable spec this implements natively.

Acceptance criteria:

- Resident memory for the benchmark doc is materially below the TS core (a gate metric).
- The model stays within the configured arena ceiling under a scroll-the-whole-doc workload (eviction holds the cap), with the explicit caveat that the JS view/DOM heap is not covered.

Tests:

- Memory-footprint comparison in the benchmark harness; an arena-stays-within-ceiling assertion under full-document traversal.

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

The TS core ships first and stays the permanent oracle (N9). docs/030 lands in TypeScript; the native core arrives later, behind a capability/feature flag. The TS core is kept forever as the CI parity oracle and as the Tier-1 production core (the wasm-arena `BodyStore`, N8, leaves the model graph in TS); what is *retired* — not kept — is the idea of shipping the TS core as a redundant runtime fallback in a full-swap world, since WASM is universal in modern browsers. A genuine no-WASM target, if one exists, is the only reason to ship the TS runtime alongside native.

Memory ladder before the swap: the wasm-arena `BodyStore` (N8) is the intermediate rollout step that delivers the hard cap on bodies on the docs/030 timeline, without N2 and without the FFI gate. It ships behind the `BodyStore` SPI as a deployment choice (Tier 1), and only if a document large enough to overflow the skeleton floor, or the speed/collaboration case, materializes does the full swap (Tier 2) follow.

Gate before commit: the §7.1 spike must clear §5.6 before any stage-two work begins. A failed gate ends the native effort with a documented number and a redirect to docs/030's worker+streaming load/save.

Module-by-module cutover under parity: each adapted algorithm (§7.4) replaces its TS counterpart only after passing the TS oracle on the full `tests/editor/**` corpus through the parity shim. The view and the host contract never change during cutover, so each step is reversible.

Compat is already gone: the native core never speaks the legacy shape; the corpus migration and `compat.ts` deletion (docs/030 §8) precede stage two.

Toolchain and build: `packages/editor-native` adds a Rust + wasm-pack build to the monorepo; CI gains a Rust test job and a WASM build artifact; the TS binding stays thin so `@idco/editor`'s public API is unchanged.

## 9. Edge Cases And Failure Modes

- FFI read-cost regression (the gate's decisive risk): if per-frame reads are not cheap, the design fails the gate; outcome is "stay in TS," not "ship it slow." The spike exists to catch this before commit.
- WASM unsupported / disabled: under Tier 1 (wasm-arena `BodyStore`, N8) the core *is* TypeScript, so a missing arena just means the JS-Map/IndexedDB `BodyStore` (soft cap) — fully functional, no separate fallback. Under Tier 2 (full swap) this is the one case that justifies shipping the TS runtime alongside native (N9); otherwise the TS core lives in CI as the oracle, not the bundle.
- Memory win already claimed by Tier 1 (the N8 gate question): if the §7.1 spike shows the wasm-arena `BodyStore` already meets the memory requirement, the full swap must justify itself on speed + collaboration + the skeleton floor alone; "we need a hard cap" is no longer a reason to take N2 or the FFI gate.
- Linear-memory growth: WASM linear memory only grows, never shrinks (no `memory.shrink`), so the hard cap (N7) is delivered by *pre-sizing* the arena to the ceiling and evicting to the cold store on full, not by reclaiming pages. The skeleton/body paging (§7.3, docs/030 §7.6) + bake LRU + slot reuse bound the resident set; without them a long session pins the high-water mark. Memory bounding is a prerequisite, not an add-on.
- Cap scope misread: N7 caps the model arena, not the whole app; the JS view/DOM heap is browser-controlled. A spec or report that says "100MB app cap" overstates it — say "model arena cap" and note windowing bounds (not caps) the view side.
- Worker transfer hazards: a `Transferable` buffer is detached after transfer; the producer must not reuse it; the adopt step must validate the buffer before mapping it into the arena.
- Parity drift between Rust and TS: any divergence is a build-breaking parity-test failure; the TS oracle is authoritative, and the native module falls back until fixed.
- Debugging across the boundary: source maps and panic→JS-error plumbing must exist from the spike, or boundary bugs become opaque; budget for it explicitly.
- CRDT history swap (future): when the op-log replaces the step algebra, the inverse-step history tests are repointed at op-log equivalents; until then, history is the adapted step algebra.
- Async-runtime leak into the core (N10): a transitive dependency that pulls `tokio` (or any executor / browser-futures crate) into the core breaks the wasm build, and a native-only dependency breaks the desktop build the moment docs/035 reuses the crate. The core's `Cargo.toml` forbids runtime deps and a CI job builds the core for `wasm32-unknown-unknown`; a leak fails that build rather than shipping a core that only compiles for one target. The fix is always to move the async to a host crate, never to polyfill a runtime under the wrong target.

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

- The §7.1 spike is built and a go/no-go report with the gate metrics (load, save, memory, scroll, per-frame FFI read cost) is committed; the decision is explicit. Memory determinism (N7) is recorded as a separate axis: whether a pre-sized arena holds the model within a fixed ceiling under full-document traversal, noting the cap covers the model, not the view heap. The report also answers the N8 question — whether a wasm-arena `BodyStore` already meets the memory requirement without the full swap — so memory is not double-counted as a swap justification.
- If go: the native core passes the full `tests/editor/**` corpus through the parity shim; load/save/memory beat the TS core on the benchmark by the recorded margin; the model arena holds its configured hard cap (N7) where the TS path could only purge toward a soft budget; the view and `getEditorSnapshot()`/`onSave`/`createEditorStore` contracts are unchanged; the TS core stays the CI parity oracle (N9, not a shipped runtime fallback unless a no-WASM target exists); `markdown-it`/`sanitizeHtmlToCompat` are removable on the native path.
- If no-go: the report documents the failing metric and redirects to docs/030's worker+streaming load/save; no native core ships.
- Either way, the TS core stays the parity oracle; no decision is taken on faith.
- `note.md` §4 / docs/030 cross-reference this document as the native sibling; the relevant memories updated.

## 13. Final Model

editor-native is a parity-gated representation swap, not a rewrite. The `EditorDocumentSnapshot` contract and the framework-free view↔core seam stay exactly as they are, so the native core is something the existing TypeScript core is continuously measured against rather than replaced by faith: same input, same snapshot. The model lives in main-thread WASM where the JS view reads it through cheap synchronous FFI, keeping input sub-frame, while only pure, coarse compute — bake, highlight, diagram, bulk import — goes to workers as copy-in/copy-out tasks, which is why the "chatty bridge" fear dissolves: the chatty part never crosses a thread. Inside the core, algorithms whose value is the algorithm are adapted faithfully against their TS oracle, representations whose value is the layout are redesigned for Rust's arena, binary, and rope, and compat is never spoken at all. The arena is also the one place the *whole* model gets a hard memory cap — pre-sized to a ceiling, recycling slots, evicting to the cold store rather than growing — which is the cleanest, least-contingent reason to go native, since docs/030's pure-JS path can only purge toward a soft budget and the always-resident skeleton it cannot shrink is exactly what the integer-id arena compacts (the cap covers the model, never the browser-owned view heap). But that motivation does not by itself buy the full swap: because the bytes that dominate memory are body-blind to the hot path, a wasm-arena `BodyStore` (N8) hard-caps the *bodies* behind docs/030's existing SPI without moving the model graph into WASM and without the per-frame FFI gate — so the memory win has a cheaper Tier-1 home, and the full swap must earn itself on speed, the CRDT future, and the skeleton floor that only Tier 2 caps. And "keep both" is not a dilemma: under Tier 1 there is one TS core with a pluggable body backend, and under Tier 2 the TS core stays the permanent CI oracle (N9) while only the redundant shipped runtime fallback is retired. Rust's parser ecosystem makes import faster and dependency-free without ever touching the browser-owned live DOM, which stays TypeScript. And because incremental save, memory paging, and the eventual CRDT op-log all pivot on the same unit — a changed block by key — the native core is simultaneously the answer to today's load/save/memory costs and the foundation collaboration will stand on. The whole proposal reduces to one disciplined move: build the smallest vertical slice that can measure the one number intuition gets wrong (the per-frame boundary read cost), and let that number, not enthusiasm, decide whether the rest is built.
