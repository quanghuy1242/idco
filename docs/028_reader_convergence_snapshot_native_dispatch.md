# 028 - Reader Convergence: One Snapshot-Native, RSC-Safe Resting Dispatch

> Status: revised plan, pre-implementation. Created 2026-06-24 after the first build of `packages/reader` (the R0–R6 work tracked in docs/015) was found unmergeable: it shipped a *second, lossy* renderer instead of sharing the editor's. This document does **not** override docs/015 — 015 remains the architecture record (the L1/L3 layering, the three-context triangle, content-visibility, the island model are all still correct). 028 revises **how the read tier is built**: it supersedes docs/015 §4.4 (the "walk the projection → render L1" pipeline, which is what led to the fork) and the R0–R6 dispatch approach. Where 015 and 028 disagree on the build, 028 wins; where 015 describes the target architecture, it still holds.
>
> Date: 2026-06-24
>
> Scope:
>
> - `packages/reader/**` — the read tier built under docs/015. This plan deletes its forked dispatch (`src/reader/render.tsx`) and keeps its L1 primitives, islands, content-visibility, lint, scaffold, and exports.
> - `packages/editor/src/view/render/resting-document.tsx` — the editor's existing SPI-driven resting render. This plan extracts its dispatch into a shared, RSC-safe layer and turns this file into a thin client wrapper over it.
> - `packages/editor/src/view/spi/node-view.ts` / `structural-view.ts` and the built-in node views under `packages/editor/src/view/nodes/**` — the node SPI. This plan splits each node's **resting** render (RSC-safe, → reader) from its **live/interactive** render (editor-only), and makes `renderResting` an RSC-safe contract.
> - `packages/editor/src/core/**` — the `EditorDocumentSnapshot` the reader will render natively, and the bake functions (`bakeObjectData`) the resting dispatch uses; unchanged except for what the registry split needs.
>
> Source docs:
>
> - `docs/015_reader_server_native_read_tier.md` — the read-tier architecture this plan implements correctly. Especially §2.2 (component identity), §2.3 (the three-context triangle), §4.1 (the component cake), §6 (islands), §8 (retiring Lexical). 028 corrects §4.4 (the pipeline) and the R0–R6 build.
> - `docs/010 §5.9 / §6.2` — the bake pipeline and the resting/live object split the resting dispatch relies on.
> - `docs/016` / `docs/020 §4.2` — the node SPI (`NodeView` / `StructuralNodeView`, `registerNode`) this plan splits.
>
> Assumptions:
>
> - The owned editor's native document is `EditorDocumentSnapshot` (`{ body: { blocks, order }, settings, version, collections? }`). It is the source of truth; it has nothing to do with Lexical.
> - `compat` (`RichTextEditorDocument`, the Lexical-shaped `{ root: { children } }` tree with `format` bitmasks) is a **legacy-Lexical** adapter — for importing old content and for the not-yet-retired Lexical-shaped persistence (docs/015 §8). It must not appear in the read *render* path.
> - The bake functions (`bakeObjectData`, the per-node bakers) are pure and worker-safe, so they are RSC-safe and may run server-side.
> - React 19 / RSC available; the published reader targets a Next.js App Router host (or any RSC runtime).

## Table Of Contents

- [1. Purpose](#1-purpose)
  - [1.1 The short version](#11-the-short-version)
  - [1.2 Non-goals](#12-non-goals)
- [2. What Went Wrong In The First Build](#2-what-went-wrong-in-the-first-build)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 The shipped reader is a forked compat-walk](#31-the-shipped-reader-is-a-forked-compat-walk)
  - [3.2 The editor's SPI resting render is faithful but not RSC-safe](#32-the-editors-spi-resting-render-is-faithful-but-not-rsc-safe)
  - [3.3 Three divergent render paths, no parity guard](#33-three-divergent-render-paths-no-parity-guard)
  - [3.4 The node SPI registry lives in the editor (the direction problem)](#34-the-node-spi-registry-lives-in-the-editor-the-direction-problem)
- [4. Target Model](#4-target-model)
  - [4.1 One snapshot-native, RSC-safe, kind-keyed resting dispatch](#41-one-snapshot-native-rsc-safe-kind-keyed-resting-dispatch)
  - [4.2 renderResting becomes an RSC-safe contract; interactivity is islands](#42-renderresting-becomes-an-rsc-safe-contract-interactivity-is-islands)
  - [4.3 The shared resting registry lives in packages/reader](#43-the-shared-resting-registry-lives-in-packagesreader)
  - [4.4 compat leaves the render path entirely](#44-compat-leaves-the-render-path-entirely)
  - [4.5 One spacing and typography source](#45-one-spacing-and-typography-source)
  - [4.6 The document index seam (TOC)](#46-the-document-index-seam-toc)
- [5. Architecture Decisions](#5-architecture-decisions)
- [6. Salvage Assessment: What Of The First Build Survives](#6-salvage-assessment-what-of-the-first-build-survives)
- [7. Implementation Plan](#7-implementation-plan)
- [8. Edge Cases And Failure Modes](#8-edge-cases-and-failure-modes)
- [9. Test And Verification Plan](#9-test-and-verification-plan)
- [10. Definition Of Done](#10-definition-of-done)
- [11. Final Model](#11-final-model)

## 1. Purpose

Make the reader **the editor's resting render, run on the server** — literally, by sharing one dispatch — instead of a second renderer that approximates it. The first build (docs/015 R0–R6) produced a forked renderer that walks the **Lexical-compat projection** through a hand-maintained, closed `type → primitive` map. It drops dividers, image captions, and table-cell attributes (background/merge), its block spacing diverges from the editor, and it is *less faithful than the `RestingDocument` that already existed*. It cannot merge. This plan deletes that fork and converges the editor's resting render and the published reader onto one snapshot-native, RSC-safe dispatch, with a parity test so they cannot drift again.

### 1.1 The short version

The reader renders the native `EditorDocumentSnapshot` (never compat) through the **same** kind-keyed resting dispatch the editor uses at rest. That dispatch — text leaf → L1, object → its registered resting render, structural → its registered resting render — moves into `packages/reader` as an **RSC-safe** layer (no `"use client"`, no hooks, no client widgets). Each node's resting render is RSC-safe (a code block is a static `<pre>`, not the live `CodeEditor`); interactivity (code highlighting, TOC scroll-spy, checklist toggle) is an L3 island layered over that static render, for **both** the editor's preview and the published reader. `RestingDocument` becomes a thin client wrapper over the shared dispatch; `<Reader>` is the server wrapper. compat collapses to an input-edge adapter (`compat → snapshot`) used only for not-yet-migrated Lexical content, and dies with Lexical (docs/015 §8). A parity test renders the same document through both wrappers and asserts identical DOM.

### 1.2 Non-goals

- **Not** keeping the compat projection anywhere in the render path. It is legacy-Lexical; the owned editor has nothing to do with it. (Input-edge adapter only.)
- **Not** the persistence flip itself (docs/015 §8). The reader renders a snapshot; whether the snapshot comes straight from storage (post-flip) or via the `compat → snapshot` adapter (today) is the adapter's concern, not the dispatch's.
- **Not** reworking the editor's *live* editing surface. Only the **resting** render converges; live editing (input, selection, caret) is untouched.
- **Not** JS windowing in the reader — still `content-visibility` only (docs/015 §5.5).

## 2. What Went Wrong In The First Build

docs/015 §4.4 framed the reader as a pipeline: "walk the projection → render L1." Read literally, that is a *fresh walk over the persisted shape*, and the persisted shape today is the Lexical-compat tree. So the build ported `content-renderer` (the old Lexical-era read renderer) into `packages/reader`: a closed `type → primitive` map over compat nodes. That decision carried three latent properties of `content-renderer` straight into the new reader:

- It only renders the node types hardcoded in its map. `content-renderer` never rendered dividers; it read media `caption`/table cell attrs only where its map happened to. Those gaps were invisible while the only producer was the Lexical editor; the owned editor's richer model makes them glaring.
- It re-parses a *flattened legacy shape* (marks as bitmasks, media fields nested, etc.) rather than the native model, adding a translation + re-parse step — each a place to lose fidelity.
- It is a **separate dispatch** from the editor's, so "component identity" only ever held at the leaf primitive, never at the node→props mapping. The two diverged immediately.

The user had explicitly said: retire `content-renderer` because it is for Lexical, and the new editor has nothing to do with that. The build retired the *package* but reproduced its *approach*. That is the error 028 corrects.

## 3. Current-State Findings

### 3.1 The shipped reader is a forked compat-walk

`packages/reader/src/reader/render.tsx` is a closed renderer: a `defaultRenderers` map keyed by compat node type, fed `compatFromEditorStore(store)` output. Confirmed failures, all the same class (incomplete map over a flattened shape):

- **Divider dropped.** No `divider` (or `horizontalrule`) entry in the map; the node falls through to the text/children fallback and renders nothing. (`content-renderer` had no divider renderer either.)
- **Image caption dropped.** The media renderer reads a top-level `caption`; the owned model stores it nested (`data.local.caption`), so the projected node's caption never reaches `RichTextMediaFigure`.
- **Table cell attrs dropped.** The `tablecell` renderer passes only `header`, ignoring `colSpan`/`rowSpan`/`backgroundColor`/`verticalAlign` — which the compat export *does* carry and the `RichTextTableCell` primitive *does* support. Result: no cell fills, no merges, and (because `colSpan` is gone) cells shift columns ("Planning" lands in the wrong column).
- **Block spacing diverges.** The reader spaces blocks with `RichTextArticle`'s `gap-3` plus per-primitive margins; the editor uses its block model. Two independently-authored spacing systems.

### 3.2 The editor's SPI resting render is faithful but not RSC-safe

`packages/editor/src/view/render/resting-document.tsx` dispatches through the node SPI: text leaves → `RestingLeaf`, objects → `getNodeView(type).renderResting({ baked, node })` (baking on the fly via `bakeObjectData`), structural → `getStructuralView(type).renderResting`. This path **is** faithful — it renders the divider (`divider.renderResting → <hr>`), the table cell attrs (the structural view passes all of them), and the caption (from the baked media payload), because it reads the native model through the registry the editor already maintains.

But it is **not RSC-safe** as written:
- `code-block.renderResting` mounts the client `CodeEditor` (Prism) for at-rest highlighting.
- `table-of-contents.renderResting` → `TocRestingView` calls the `useDocumentIndex()` hook (reads the live index).
- `RestingDocument` itself wraps the body in `useMemo` + `DocumentIndexProvider`.

So the editor's resting render cannot be lifted into a Server Component as-is; the convergence requires making `renderResting` RSC-safe (§4.2).

### 3.3 Three divergent render paths, no parity guard

There are three renders of the same document, and they disagree: **editor-live** (model + node SPI + `ENGINE_TYPOGRAPHY_CSS`, with `.rt-*` now shared for prose), **editor-resting** (`RestingDocument`: model + node SPI + `ENGINE_RESTING_TYPOGRAPHY_CSS` — divider/cells/caption present), and **reader** (compat-walk + its own map + `.rt-*` + `gap-3` — divider/cells/caption absent, spacing off). No test renders the same document through more than one path and asserts they match, so nothing caught the drift. The reader (the newest) is the least faithful of the three.

### 3.4 The node SPI registry lives in the editor (the direction problem)

`getNodeView`/`registerNodeView` and `getStructuralView` live in `packages/editor/src/view/spi`. The reader sits **below** the editor in the dependency graph (editor → reader, never the reverse, docs/015 §7.2), so the reader cannot call the editor's registry to dispatch by kind. This is the structural reason the first build forked a closed map instead of sharing the editor's dispatch — and it is the key thing 028's registry placement (§4.3) must solve.

## 4. Target Model

### 4.1 One snapshot-native, RSC-safe, kind-keyed resting dispatch

A single pure function — call it `renderRestingDocument(snapshot, { registry, index })` → `ReactNode` — walks the native `EditorDocumentSnapshot` and dispatches each block by `node.kind`/`node.type`:

- text leaf → the L1 prose primitive (paragraph/heading/quote/list-item) with its `.rt-*` class;
- object → the registered RSC-safe resting render for `node.type` (baking on the fly via `bakeObjectData`);
- structural → the registered RSC-safe resting render for `node.type` (callout, list, table family), recursing through the same dispatch.

It is pure (no hooks, no DOM reads), so the **server `<Reader>`** calls it directly and the **client `RestingDocument`** calls it inside its thin wrapper. Same function, same output — "the reader is the editor's resting render" becomes literally true, and divider/caption/cell-attrs/spacing come from one place. This replaces both `render.tsx` (the fork) and the dispatch half of `resting-document.tsx`.

### 4.2 renderResting becomes an RSC-safe contract; interactivity is islands

The node SPI's resting render is redefined as **RSC-safe**: `renderResting({ baked, node })` returns pure DOM (L1 primitives), no client widget, no hook, no `"use client"` import. This is the L1/L3 split docs/015 §6 already prescribes, applied honestly:

- **Code block:** resting render is a static `<pre>` (the L1 `RichTextCodeBlock`, rendering baked highlighted HTML when present, else plain source) — not the live `CodeEditor`. Syntax highlighting at read time is the **live-code island** (already built); the editor's at-rest code block uses the same static render and gains the island when a host opts in. (The live *editing* surface keeps `CodeEditor`; that is `renderLive`, not `renderResting`.)
- **Table of contents:** resting render is a static list built from the **passed-in index** (§4.6), not from the `useDocumentIndex()` hook. Scroll-spy is the **scroll-spy island** (already built).
- **Checklist:** static read-only items; the toggle is the **checklist island** (already built).

So the same dispatch is RSC-safe for the server and the editor, and the three islands the first build produced are exactly the L3 layer this needs — they survive.

### 4.3 The shared resting registry lives in packages/reader

To let the reader dispatch by kind without importing the editor (§3.4), the **RSC-safe resting registry** lives in `packages/reader` (the bottom of the graph): `registerRestingObject(type, fn)` / `registerRestingStructural(type, fn)` plus `renderRestingDocument`. The **built-in RSC-safe resting renders** (paragraph/heading/quote/list, callout, list container, table family, media figure, embed, post-ref, divider, static code, static TOC) live in `packages/reader` and register there on load, so the published reader — with no editor present — has everything it needs.

The node SPI in the editor is **split**: a `NodeView`/`StructuralNodeView` keeps its **live/interactive** halves (`renderLive`, chrome, `configFields`, `insert`, `contributeCommands`) in the editor; its **resting** half registers into the reader's resting registry. The single `registerNode` call routes the resting half down to the reader registry and the live half into the editor registry (one author-facing call, two registries — the same shape docs/015 §6.2 describes for islands). A custom node thus renders identically in the editor-at-rest and the reader by registering one RSC-safe resting renderer; its editor-only interactivity stays in the editor. The editor's `RestingDocument` reads the reader registry for objects/structural (it already produces L1 output today, since the node views were repointed to reader L1 in the first build — so this is moving *where the dispatch lives*, not rewriting the renders).

```text
@quanghuy1242/idco-lib
        ▲
packages/reader  ── L1 primitives + RSC-safe resting registry + renderRestingDocument + islands
   ▲        ▲                     ▲
   │        │                     │  (editor registers its nodes' RSC-safe resting renders here)
<Reader>  RestingDocument         │
(server)  (client wrapper) ◄──────┘
        ▲
packages/editor  ── node SPI live halves; RestingDocument wrapper; live editing surface
```

### 4.4 compat leaves the render path entirely

The render path consumes `EditorDocumentSnapshot` only. compat (`RichTextEditorDocument`) is confined to a **thin input-edge adapter**, `compat → snapshot`, used solely where the persisted content is still Lexical-shaped (today's production) — implemented with the existing import (`createEditorStoreFromCompat(doc).toSnapshot()`) or a lighter direct mapping. In the story/preview and post-persistence-flip there is no compat at all (`store.toSnapshot()` / the stored snapshot feeds the reader directly). compat-export and the adapter are retired with Lexical (docs/015 §8). This is the explicit correction of the first build: the reader stops speaking Lexical's shape.

### 4.5 One spacing and typography source

The block-spacing model and prose/mark/container appearance become **one stylesheet** the shared dispatch emits — folding today's `ENGINE_RESTING_TYPOGRAPHY_CSS` and the `.rt-*` contract into a single definition. `RestingDocument`, `<Reader>`, and (for prose) the live editor all read it, so spacing and typography cannot drift across the three paths. This also closes docs/015's "#2 deferral" — the editor's resting preview is no longer a third CSS source, because it is the same dispatch + the same stylesheet.

### 4.6 The document index seam (TOC)

The shared dispatch takes the document index as **data** (`renderRestingDocument(snapshot, { index })`), built once by the caller: the server `<Reader>` builds it server-side (it already does), the client `RestingDocument` builds it in its wrapper. The dispatch and the static TOC render are pure functions of that index — no `useDocumentIndex()` hook inside the dispatch. The live editor's reactive index and the reader's scroll-spy stay where they belong (the editor's live tree; the L3 island), fed the same derived index so anchors and entries match (docs/015 §13).

## 5. Architecture Decisions

- **D1 — Render the native snapshot, never compat (in the render path).** The reader consumes `EditorDocumentSnapshot`; compat is an input-edge adapter only (§4.4). Rejected: keep the compat-walk and patch the missing types/props — that is the source of the divider/caption/cell/spacing bugs and it perpetuates the Lexical shape in a Lexical-free editor.
- **D2 — One shared dispatch, owned by `packages/reader`.** The kind-keyed resting dispatch + registry live at the bottom of the graph so both the server reader and the editor's resting wrapper call it (§4.3). Rejected: a dispatch in the editor exported to the reader (pulls the editor's client graph across the RSC boundary, docs/015 §7.1); rejected: two dispatches kept in sync by review (the current drift, §3.3).
- **D3 — `renderResting` is RSC-safe; interactivity is islands.** No client widget or hook in a resting render (§4.2). Rejected: client widgets at rest (today's `code-block`/`toc`), which make the dispatch non-RSC and force the fork.
- **D4 — Split node views into resting (reader, RSC-safe) and live (editor) halves.** One `registerNode` call, two registries (§4.3). Rejected: keep resting in the editor (reader can't reach it, §3.4); rejected: duplicate every node's resting render in the reader (the fork, by another name).
- **D5 — One spacing/typography stylesheet** shared by all three paths (§4.5). Rejected: per-path CSS (the current three-source drift).
- **D6 — Keep the first build's L1 primitives, islands, content-visibility, lint, scaffold; delete its dispatch.** The fork was the wrong piece; the substrate is right (§6).

## 6. Salvage Assessment: What Of The First Build Survives

The open question — "can we keep the unstaged code?" — answered per piece. The short answer: **most of it survives; one module is deleted.**

| First-build artifact | Verdict | Why |
| --- | --- | --- |
| `packages/reader/src/l1/**` (primitives + `.rt-*` typography) | **Keep** | These are the L1 layer the shared dispatch renders into. Already RSC-safe and self-contained. |
| `packages/reader/src/islands/**` (boundary, checklist, live-code, scroll-spy, registry, `createIslandRenderer`) | **Keep** | Exactly the L3 interactivity layer §4.2 needs, for both tiers. |
| content-visibility wrapping in `<Reader>` | **Keep** | Virtualization is unchanged (docs/015 §5). |
| Package scaffold, `exports` map, `reader-l1-purity` lint | **Keep** | Boundary + packaging are right; the lint extends to the new resting modules. |
| Editor object nodes repointed to reader L1 (`media`/`embed`/`post-ref`/`table`) + live-prose `.rt-*` | **Keep** | The resting renders already produce L1; moving the dispatch (§4.3) reuses them. |
| `packages/reader/src/reader/render.tsx` (the compat-walk + `ReaderNode`/`ReaderOptions` compat types) | **Delete** | The forked dispatch over the Lexical shape — the wrong piece (D1/D6). |
| `packages/reader/src/reader/Reader.tsx` | **Rework** | Keep the server-component shell, content-visibility, the `<style>` injection; swap its input from compat to `EditorDocumentSnapshot` and its body from `render.tsx` to `renderRestingDocument`. |
| `tests/reader.test.tsx` | **Rework** | Keep the cases; assert against the snapshot-native render and add the parity test (§9). |
| The phase-8 Preview story wiring (`compatFromEditorStore` → `<Reader>`) | **Rework** | Pass `store.toSnapshot()` (native) instead of `compatFromEditorStore`; fix the modal (§7 N8). |

So the substrate (primitives, islands, virtualization, packaging, lint) stands; the **dispatch** is replaced by the shared one, and `<Reader>` is rewired to the native snapshot. New work is the shared registry + dispatch, the node-SPI resting/live split, the RSC-safe `renderResting` (code/toc static), the one stylesheet, the adapter, the parity test, and the modal.

## 7. Implementation Plan

Sequenced so the highest-signal change lands first and each phase is reviewable + gate-green.

- **N1 — Shared RSC-safe resting registry + dispatch in `packages/reader`.** Add `registerRestingObject`/`registerRestingStructural` + `renderRestingDocument(snapshot, { registry, index })`. Move the built-in RSC-safe resting renders into reader and register them; make `code` a static `<pre>` and `table-of-contents` a static list from the passed-in index (D3). Extend the `reader-l1-purity` lint over these modules.
- **N2 — `<Reader>` renders the snapshot through the dispatch; delete the fork.** Rewire `Reader.tsx` to take `EditorDocumentSnapshot` and call `renderRestingDocument`; keep content-visibility + the typography `<style>`. Delete `render.tsx` and the compat `ReaderNode` types. *This single phase fixes divider, caption, cell attrs, and spacing together — verify against the FullEditor sample before proceeding.*
- **N3 — Node-SPI resting/live split.** Route `registerNode`'s resting half into the reader registry and keep the live half in the editor; the editor's `getNodeView` resting lookups read the reader registry. Update built-in node views accordingly.
- **N4 — `RestingDocument` becomes a thin client wrapper** over `renderRestingDocument` (builds the index, wraps islands), so editor-preview and reader are the same dispatch.
- **N5 — One spacing/typography stylesheet** (§4.5): fold `ENGINE_RESTING_TYPOGRAPHY_CSS` + `.rt-*` into one definition the dispatch emits; delete the duplicates.
- **N6 — `compat → snapshot` input adapter** (§4.4) for legacy persistence; the render path no longer imports compat.
- **N7 — Parity test** (§9): same document through `RestingDocument` and `<Reader>`, assert identical DOM.
- **N8 — Modal + story:** the Preview story passes `store.toSnapshot()`; replace `ConfirmDialog` (which forces a redundant Cancel) with a single-Close modal for both the JSON and Preview dialogs.
- **N9 — Realign docs/015 §4.4** wording to "feed the snapshot to the shared dispatch" with a pointer to 028 (kept out of this plan's edits unless approved, since 015 is the architecture record).

## 8. Edge Cases And Failure Modes

- **A node type with no registered resting render.** The dispatch must render a visible, non-silent fallback (the `renderRestingObject` status placeholder already does this for objects), never drop the block as the fork did with dividers.
- **Unbaked object on the server.** Imported/persisted objects may carry no baked snapshot; the dispatch bakes on the fly for display (pure, RSC-safe) exactly as `renderRestingObject` does today — never writes back to the model.
- **Code block without baked HTML.** Static `<pre>` shows plain source (no Prism); the live-code island upgrades to highlighting when hydrated. Acceptable per docs/015 §4.2 (render the baked field, no heavy libs); a baked-HTML pipeline is a separate bake concern.
- **RSC purity regression.** A node author adding a hook/client widget to a resting render reintroduces the fork's problem; the `reader-l1-purity` lint must cover the shared resting modules and fail CI on it.
- **Index mismatch.** If the server `<Reader>` and the client `RestingDocument` build the index differently, TOC/anchor links diverge; both must use the same derived-index logic (docs/015 §13), which the shared dispatch enforces by taking the index as data.
- **compat adapter fidelity.** The `compat → snapshot` adapter must round-trip the legacy corpus losslessly (it is the existing import path); a gap there is a migration bug, isolated to the adapter, not the render.

## 9. Test And Verification Plan

- **Parity (the guard):** render the FullEditor sample through `RestingDocument` and `<Reader>` (from the same snapshot) and assert the produced DOM matches — divider present in both, table cells carry `colSpan`/`rowSpan`/`background`, media renders its caption, block spacing identical. This test fails today and must pass after N2–N5.
- **Server-safety:** import every shared resting module + `<Reader>` in a non-DOM context; the lint + a Node import test prove no `"use client"`/hook/client-widget leaked in.
- **Per-bug regression:** explicit cases for the four found bugs (divider, caption, cell attrs, spacing).
- **Islands:** static-complete-without-JS; island hydrates over the static render; code highlight + TOC scroll-spy + checklist toggle each work post-hydration.
- **Gate:** `pnpm check` green at each phase.

## 10. Definition Of Done

- The reader renders `EditorDocumentSnapshot` through the shared, RSC-safe, kind-keyed resting dispatch; `render.tsx` (the compat-walk) is deleted; compat appears only in the input-edge adapter.
- The editor's `RestingDocument` and the published `<Reader>` call the same dispatch and emit the same stylesheet; the parity test asserts identical DOM on the FullEditor sample.
- Divider, image caption, table-cell background/merge, and block spacing match between editor and reader.
- `renderResting` is RSC-safe for all built-in nodes; interactivity is islands; the `reader-l1-purity` lint covers the shared resting modules.
- The Preview story renders from `store.toSnapshot()` (no compat) and both dialogs have a single Close.
- `pnpm check` green; docs/015 §4.4 carries a pointer to 028 (separate approval).

## 11. Final Model

The IDCO reader is the editor's resting render, lifted onto the server by **sharing one dispatch**, not by re-implementing it. A single RSC-safe, kind-keyed function renders the native `EditorDocumentSnapshot` into L1 primitives; it lives at the bottom of the dependency graph in `packages/reader`, the editor registers its nodes' RSC-safe resting renders into it, and both the editor's in-app preview (`RestingDocument`) and the published `<Reader>` call it — so a divider, an image caption, a merged colored table cell, and block spacing are defined once and cannot differ between editing and reading. Interactivity (code highlighting, TOC scroll-spy, checklist toggle) is an island layered over the static render, for both tiers. The Lexical-shaped `compat` projection is gone from the render path — it survives only as a legacy input adapter that dies with Lexical. The first build's primitives, islands, virtualization, packaging, and lint stand; only its forked compat-walk is deleted. A parity test renders the same document through both wrappers and fails the moment they drift, so "the reader matches the editor" is enforced by construction and by CI, not by claim.
