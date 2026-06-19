# 017 - Pre-Phase-8 Plan: View Decompose, Node SPI Lift, And Foundation Cleanup

> Status: DONE. The bounded, behavior-preserving pass landed (view decompose, the node SPI lift per docs/016, the two latent-bug fixes, the Payload-dialect decision) and Phase 8 (docs/010) has since built on it. Kept as the record of that pass.
>
> Date: 2026-06-19
>
> Scope:
>
> - `packages/editor/src/view/react-view.tsx` — the ~3.3k-line view to decompose.
> - `packages/editor/src/core/{registry,store,compat}.ts` — the SPI seam and two latent-bug fixes.
> - `docs/010` — the Phase 2 ledger correction and the Phase 8 AC reframe land here.
> - `note.md` (repo root) — the working notes this document formalizes and supersedes.
>
> Relationship to the other docs:
>
> - **Formalizes `note.md`.** `note.md` is the raw cleanup notes; this is the sequenced, gated plan. Treat this document as authoritative; keep `note.md` as scratch.
> - **Realizes docs/016.** The node SPI is sketched in 016; this document is when the internals are lifted onto it (behavior-preserving).
> - **Precedes docs/010 Phase 8.** Phase 8 builds on the decomposed view and the SPI seam this pass produces.

## Table Of Contents

- [1. Why A Pre-Phase-8 Pass](#1-why-a-pre-phase-8-pass)
- [2. The Gate](#2-the-gate)
- [3. Work Items, In Order](#3-work-items-in-order)
  - [3.0 Flip the Phase 2 ledger checkbox](#30-flip-the-phase-2-ledger-checkbox)
  - [3.1 Decompose react-view.tsx](#31-decompose-react-viewtsx)
  - [3.2 Lift node behavior behind the SPI seam](#32-lift-node-behavior-behind-the-spi-seam)
  - [3.3 Two latent-bug fixes](#33-two-latent-bug-fixes)
  - [3.4 Compat decision + Payload dialect coverage matrix](#34-compat-decision--payload-dialect-coverage-matrix)
  - [3.5 CSS to daisyui and chrome to @idco/ui](#35-css-to-daisyui-and-chrome-to-idcoui)
- [4. Blog-First Priority](#4-blog-first-priority)
- [5. Explicitly Not In This Pass](#5-explicitly-not-in-this-pass)
- [6. Definition Of Done](#6-definition-of-done)

## 1. Why A Pre-Phase-8 Pass

The pre-Phase-8 investigation (summarized in `note.md` and the findings below) established three things:

1. **The view is a ~3.3k-line monolith** (`react-view.tsx`). Starting Phase 8's feature work inside it spreads fragility instead of reducing it.
2. **The node lifecycle has no render contract.** Object resting render and live-edit are hardcoded `switch`/`inPlaceCode` branches in the view; only the data half is registry-driven (docs/016 §2). Phase 8 features (marks, image, divider, embed, table) would pile onto those switches and then be rewritten.
3. **Two latent correctness bugs and one dialect mismatch** would surface the moment Phase 8 binds undo and tries to import real data.

Doing the decompose *and* landing the SPI seam first is cheaper than doing them during Phase 8, because the decompose's endpoint (`object-block.tsx`) is exactly where the hardcoded render switch lives — relocating it without the SPI means carefully moving code that Phase 8 immediately rewrites.

## 2. The Gate

The behavior bar for the entire pass, unchanged by any item below:

- `pnpm test` (vitest, 627) green with **no assertion changes**.
- The engine e2e suite (`tests/e2e/engine-*.spec.ts` on chromium/webkit/firefox) green with no assertion changes.

Every item is behavior-preserving except the two bug fixes (§3.3), which add tests rather than change existing ones. If an item cannot stay behavior-preserving, it is not a pre-Phase-8 item — it is Phase 8.

## 3. Work Items, In Order

### 3.0 Flip the Phase 2 ledger checkbox

`docs/010 §10.3` marks `P2` unchecked, but Phase 2 shipped: `packages/editor/src/spike/**`, `stories/engine-input.stories.tsx`, `tests/e2e/engine-input.spec.ts` (17 tests including the AC3 `data-editcontext-active` assertion and AC4 IME composition), the webkit/firefox Playwright projects, and `grep setBaseAndExtent packages` is empty. Flip `- [ ] P2` → `- [x] P2`. Trivial; do it first so the ledger stops misreporting the make-or-break gate.

### 3.1 Decompose react-view.tsx

Pure move, zero behavior change, one module at a time (note.md §4). The decompose order matters because the SPI gates only the last two extractions:

**No SPI dependency — proceed immediately, in this order:**

1. `styles.ts` — style constants + suppress CSS. **First**, because it is the seam for the daisyui migration (§3.5). Preserve the load-bearing CSS verbatim (note.md §2): `caret-color: transparent` + `::selection` suppression (`ENGINE_SURFACE_SUPPRESS_CSS`) with the `[data-engine-object-editor] { caret-color: auto }` override; `user-select: none` on text blocks; `position: relative`/`absolute` layering; `white-space: pre-wrap`; measured-height/virtualization geometry.
2. `geometry.ts` — pure DOM geometry (`robustCaretRect`, `caretClientRect`, `textRangeClientRects`, `characterClientRects`, `pointToModelPosition`, `caretPositionAtPoint`, `makeRect`/`toDomRect`). No React; easiest.
3. `navigation.ts` — `selectionForNavigation`, `verticalNavigation`, grapheme/word/`lineRangeAt`, `applyEditContextText`, `diffText`.
4. `selection-overlay.tsx` — `SelectionOverlay`, `SelectionAnnouncer`, `selectionRects`, `feedImeBounds`.
5. `store-hooks.ts` — `useEditorNode`/`useEditorOrder`/`useSelectionFrameVersion`.

**Gated on the SPI seam (§3.2) — land last:**

6. `text-block.tsx` — `EngineTextBlock` + EditContext controller + composition handlers.
7. `object-block.tsx` — `EngineObjectBlock`, `BakedObjectView`, `CodeLiveSurface`, `ObjectConfigPanel`. This is where the SPI lift lands.

8. `react-view.tsx` — reduced to the `OwnedModelEditorView` shell + wiring.

**Coupling points to make explicit** (note.md §4): the shared mutable `registryRef` (blocks + overlay both read/write it), the prop-threaded `goalColumnRef`, and the per-block EditContext controller lifecycle. Turn these into one small typed context/object passed explicitly rather than threaded prop-by-prop.

### 3.2 Lift node behavior behind the SPI seam

Land the docs/016 contract as a behavior-preserving refactor (the "lift behind the seam", 016 §10):

- Move the resting `switch (baked.kind)` arms (code/media/embed/post-ref) into their `NodeView.renderResting` bodies **verbatim**; replace the switch with a `NodeView` registry lookup.
- Move `CodeLiveSurface` into the code-block `NodeView.renderLive`; make the generic `ObjectConfigPanel` the default `renderLive` fallback.
- Reduce `EngineObjectBlock` to a dispatcher with no node-type knowledge.
- Add the two paired registries (`NodeDefinition` already exists as `BlockDefinition`; add the `NodeView` registry) and `registerNode` (016 §7).

Lock the **full** SPI surface (016 §6) including the optional slots (`plainText`/`anchors`/`applyEdit`/`invertPatch`/`insert`); implement only the slots with existing behavior to wrap. Optional slots degrade to documented fallbacks. The remaining slots are filled in Phase 8 without reshaping the contract.

Ship `divider` (016 §8) as the proof a brand-new node is one file + one `registerNode`, with a node-fixture test. This is the only *new behavior* in §3.2, and it is additive (a new node type), not a change to existing behavior.

### 3.3 Two latent-bug fixes

Both are correctness bugs independent of new features; fixing them now keeps Phase 8 clean. Each adds a test rather than changing an existing assertion.

- **Undo pollution (010 §10.5) — ALREADY CLOSED (confirmed 2026-06-19).** `core/store.ts#commit` already sets `recordHistory = draft.steps.length > 0` ([store.ts:507](../packages/editor/src/core/store.ts)), so a content-free (selection-only) transaction is non-historic and does not clear the redo stack, and a no-op (no steps, no selection change) returns null. The engine-editing assertion "caret moves are not undoable" covers it. No fix needed; left here as the verified record.
- **Inline-link mark recovery (compat).** `compat.ts#marksFromInlineChildren` only recovers marks from `text`/`linebreak` children; an inline element (`link`, `epub-internal-link`) advances the offset but emits no `link` mark, so links flatten to plain text on import. The model has a `link` mark kind; the import path must produce it (011 §2.3). ~1435 link-like nodes are affected in the corpus.

### 3.4 Compat decision + Payload dialect coverage matrix

**Decision only in this pass; the import-adapter code is Phase 8.**

The investigation found that `payloadcms.db` (139 docs: 12 posts, 127 chapters) speaks **vanilla Payload/Lexical**, a third dialect distinct from both the owned model and the legacy editor's `RichTextEditorDocument`. `compat.ts` bridges owned-model ⇄ `RichTextEditorDocument`; nothing bridges Payload-Lexical → either. With the default `reject` policy, `compat` throws on the first unrecognized node; with `drop`, it silently loses content.

Coverage matrix (real corpus node types vs. what `compat`/registry handle):

| DB node type | Count | Handled today | Disposition |
| --- | --- | --- | --- |
| paragraph, heading, text, list, listitem, quote, linebreak | bulk | Yes | keep |
| `epub-internal-link` | 1377 | No (inline) | Phase 8 adapter → `link` mark (books) |
| `block` (Payload Blocks) | 404 | No → throws | Phase 8, per blockType (books) |
| `upload` (images) | 111 | No → throws | Phase 8 alias `upload → media` (blog) |
| `table`/`tablecell`/`tablerow` | 23 tables | Blob, no resting render | Phase 8 faithful grid (books) |
| `horizontalrule` | 21 | No → throws | **divider node, §3.2** (blog) |
| `link` | 58 | No (inline) | Phase 8 adapter → `link` mark (blog) |
| `youtube` | 3 | No → throws | Phase 8 alias `youtube → embed` (blog) |

Format bitmasks in the corpus (1/2/16/64 and combos) are all representable; no loss there.

**The decision to record:** keep `compat.ts` as the owned-model ⇄ `RichTextEditorDocument` bridge, and build a **separate Payload-Lexical → owned-model import adapter** in Phase 8 (010 Phase 8 AC, reframed). Do not overload `compat` with Payload-dialect knowledge. The pre-Phase-8 artifact is this matrix and the decision, not adapter code.

### 3.5 CSS to daisyui and chrome to @idco/ui

**Done:** the durable seam. All style constants and the load-bearing CSS are isolated in `view/styles.ts` (§3.1), and the object chrome (`ObjectConfigPanel`, `CodeLiveSurface`) is isolated in `view/object-block.tsx` (§3.2). That is the seam the daisyui/`@idco/ui` swap plugs into.

**Deferred into Phase 8 (decided during execution, 2026-06-19):** the actual `ObjectConfigPanel`/`CodeLiveSurface` → `@idco/ui` component swap, and the inline-style → daisyui className swap. Reason, found while attempting it behavior-preservingly:

- The engine e2e suite is the unchanging behavior bar (§2) and hard-depends on engine data attributes — `data-engine-config-field="src"`, `data-engine-object-editor`, `data-engine-object-baked`. `@idco/ui` components (`Button`, `form` fields) have **closed prop APIs with no `data-*` passthrough**, so swapping them either drops those attributes (breaking the green bar with assertion changes — forbidden by §2) or requires changing `@idco/ui` itself (cross-package scope creep affecting other consumers) or rewriting the e2e selectors (changing the behavior bar).
- The editor renders through inline-`style` placeholders and carries **no tailwind/daisyui pipeline of its own**; daisyui classes only resolve in a consuming app's build, so a className swap is unverifiable in the editor's own test/story harness.
- Phase 8 rebuilds the object chrome together with the toolbar, slash/insert menu, and format flyout — all `@idco/ui` from day one (010 §7.1) — and the engine e2e selectors evolve with that chrome. Doing the swap there, once, avoids a throwaway migration here that fights the test contract.

The focus-restore integration (note.md §3: on `@idco/ui` overlay close, call `getEditorHandle().focus()` rather than let React Aria restore to a stale element; model selection survives focus loss by 011 §8.6) is recorded here and lands with that Phase 8 chrome, since there is no React Aria overlay in the engine until then.

## 4. Blog-First Priority

The blog (posts) corpus needs: paragraph/heading/text/list/quote (have), **link** (recovery fix §3.3), **image** (`upload → media` alias + `NodeView` + upload binding), **divider** (§3.2), **youtube embed** (`youtube → embed` alias), table (blob acceptable for now). The book corpus additionally needs `block` (404 Payload Blocks), `epub-internal-link`, and faithful table editing.

So blog-first lets Phase 8 **defer** `block`, `epub-internal-link`, and faithful table editing — but only cleanly because the node SPI (§3.2) exists, so image/divider/youtube are drop-in definitions and the book-only nodes drop in later without touching the engine. The SPI is precisely what makes "blog now, books later" cheap rather than a rewrite.

## 5. Explicitly Not In This Pass

These are Phase 8, not pre-Phase-8:

- Mark DOM-ization (rendering bold/italic/link/highlight as styled spans, with overlay geometry preserved across multi-text-node blocks).
- The Payload-Lexical import adapter code (decision and matrix only here, §3.4).
- Filling the optional SPI slots (`plainText`/`anchors`/`applyEdit`/`invertPatch`/`insert` UI).
- Toolbar, slash/insert menu UI, find-in-page, autosave/dirty-state, image upload transport, sanitization boundary.
- Faithful table grid editing.

## 6. Definition Of Done

- §3.0 ledger flipped.
- `react-view.tsx` decomposed into the modules in §3.1; the shell is the `OwnedModelEditorView` wiring only.
- The docs/016 SPI seam is landed: object resting/live render goes through the `NodeView` registry; `EngineObjectBlock` carries no node-type knowledge; `divider` ships as a registered node with a fixture test.
- The two §3.3 bugs are fixed with added tests (or §3.3 undo confirmed already-covered).
- §3.4 matrix and decision recorded; `compat`'s role documented as unchanged.
- §3.5 seam delivered: styles isolated in `styles.ts`, chrome isolated in `object-block.tsx`, load-bearing CSS preserved. The `@idco/ui`/daisyui component swap is deferred into Phase 8 with the recorded reason (the `@idco/ui` closed-prop API vs the engine's data-attribute e2e contract).
- The gate (§2) is green with no assertion changes (beyond the additive tests in §3.2/§3.3).
