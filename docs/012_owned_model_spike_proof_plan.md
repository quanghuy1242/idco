# 012 - Owned-Model Spike Proof Plan

> Status: implementation-grade spike proof plan (pre-Phase 3)
>
> Date: 2026-06-17
>
> Scope:
>
> - `/home/quanghuy1242/pjs/idco`
> - `stories/owned-model-input.stories.tsx`
> - `packages/editor/src/owned-model/core/**`
> - `tests/e2e/owned-model-input.spec.ts`
> - future `tests/e2e/owned-model-flow.spec.ts`
>
> Source docs:
>
> - `docs/010_owned_model_virtualized_editor_plan.md`
> - `docs/011_foundation_dsa_owned_model_editor.md`
>
> Related docs:
>
> - `docs/002_gap_cursor_and_block_flow.md`
> - `docs/006_editor_toolbar_redesign_plan.md`
> - `docs/008_editor_performance_contract.md`
> - `docs/009_large_document_virtualized_editor_plan.md`
>
> External references:
>
> - Playwright Keyboard API: <https://playwright.dev/docs/api/class-keyboard>
> - Chrome DevTools Protocol Input domain: <https://chromedevtools.github.io/devtools-protocol/tot/Input/>
>
> Assumptions:
>
> - The owned-model editor must not move to `docs/010` Phase 3 until the spike proves the foundation contracts in `docs/011`.
> - Overlay rects are the honest painting baseline. CSS Custom Highlight may remain a future optimization, but the spike must prove engine-owned rect painting first.
> - The existing `InputSpike` stays valuable and should be extended, not replaced.
> - Browser automation can replay and synthesize IME-shaped events, but it cannot prove real Microsoft Vietnamese Telex, UniKey Vietnamese Unicode, dead-key, or candidate-window behavior by itself.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 Existing Spike Files](#31-existing-spike-files)
  - [3.2 What The Current Spike Already Proves](#32-what-the-current-spike-already-proves)
  - [3.3 What The Current Spike Does Not Prove](#33-what-the-current-spike-does-not-prove)
- [4. Target Proof Model](#4-target-proof-model)
  - [4.1 Two Spike Surfaces](#41-two-spike-surfaces)
  - [4.2 Overlay Rects As The Baseline](#42-overlay-rects-as-the-baseline)
  - [4.3 Proof Matrix](#43-proof-matrix)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 Keep The Existing Input Spike](#51-keep-the-existing-input-spike)
  - [5.2 Add A Flow Spike Before Phase 3](#52-add-a-flow-spike-before-phase-3)
  - [5.3 Do Not Reintroduce Contenteditable](#53-do-not-reintroduce-contenteditable)
  - [5.4 Keep Spike Helpers Clearly Non-Public](#54-keep-spike-helpers-clearly-non-public)
  - [5.5 Split Automated Simulation From Real IME Proof](#55-split-automated-simulation-from-real-ime-proof)
- [6. Implementation Strategy](#6-implementation-strategy)
- [7. Detailed Proof Plan](#7-detailed-proof-plan)
  - [7.1 InputSpike Hardening](#71-inputspike-hardening)
  - [7.2 FlowSpike Model And Rendering](#72-flowspike-model-and-rendering)
  - [7.3 Cross-Block Selection And Overlay Rects](#73-cross-block-selection-and-overlay-rects)
  - [7.4 Model Clipboard And Paste](#74-model-clipboard-and-paste)
  - [7.5 Atomic Object Projection](#75-atomic-object-projection)
  - [7.6 Active Leaf And Dirty Node Proof](#76-active-leaf-and-dirty-node-proof)
  - [7.7 Virtualization And Performance Proof](#77-virtualization-and-performance-proof)
  - [7.8 Accessibility And Windows Manual Proof](#78-accessibility-and-windows-manual-proof)
  - [7.9 IME Trace Recorder And Replay Fixtures](#79-ime-trace-recorder-and-replay-fixtures)
- [8. Implementation Backlog](#8-implementation-backlog)
- [9. Edge Cases And Failure Modes](#9-edge-cases-and-failure-modes)
- [10. Verification Plan](#10-verification-plan)
- [11. Definition Of Done](#11-definition-of-done)
- [12. Future Backlog](#12-future-backlog)
- [13. Final Model](#13-final-model)

## 1. Goal

Prove the dangerous runtime edges of `docs/011` before starting `docs/010` Phase 3. The output of this plan is not a full editor and not the real document model. It is a strengthened spike suite that demonstrates the owned-model foundation can survive real browser input, overlay-painted selection, cross-block model selection, model clipboard, atomic objects, fake virtualization, active-leaf dirty isolation, and Windows-first manual checks that can become replayable regression fixtures.

The short version:

- Keep the current one-block `InputSpike` for input, IME, caret, browser geometry, and focused host behavior.
- Add a tiny multi-block `FlowSpike` for the parts a one-block text spike cannot prove: cross-block selection, offscreen middle ranges, object projection, model copy/paste, active leaf plus dirty-node behavior, and render-count proof.
- Treat overlay rects from `Range.getClientRects()` as the baseline painter. Do not require CSS Custom Highlight before Phase 3.
- Do not use `contenteditable` except as a later explicitly chosen iOS active-block fallback. It is not part of this proof.

Non-goals:

- No Phase 3 runtime store.
- No persistence migration.
- No toolbar/object chrome integration.
- No full compatibility serializer.
- No bake pipeline.
- No collaboration.
- No rich table editor.

## 2. System Summary

`docs/010` Phase 2 already created the first proof surface: one host element, one active text string, one EditContext-shaped input backend, and an engine-painted caret/selection overlay. The current story has three variants: native, forced polyfill, and backend switching. The current e2e file runs the same behavior over Chromium native EditContext and the hidden-textarea polyfill path.

`docs/011` raises the bar. It needs proof that the owned model can do more than edit one plain string. The foundation depends on node-relative selection, model-owned ranges, overlay rect painting, model clipboard, object atoms, active-leaf render isolation, and virtualized/offscreen middle content. Those are not Phase 3 implementation details. They are the reason to trust the architecture at all.

This document therefore defines a Phase 2.5 proof layer. It should land before the Phase 3 model/transaction work in `docs/010`.

## 3. Current-State Findings

### 3.1 Existing Spike Files

- `stories/owned-model-input.stories.tsx` mounts the current `InputSpike` story variants: `Native`, `ForcedPolyfill`, and `SwitchingHarness`.
- `packages/editor/src/owned-model/core/text-input-controller.ts` owns the one-string text model, keyboard handling, pointer selection, temporary bold demo, IME preedit rendering, and diagnostics publishing to `window.__IDCO_OWNED_INPUT__`.
- `packages/editor/src/owned-model/core/selection-overlay.ts` hand-paints caret and selection rects into `[data-owned-overlay]`, suppresses native caret/selection on `[data-owned-host]`, and feeds control/selection bounds back to the EditContext API.
- `packages/editor/src/owned-model/core/text-dom-mapping.ts` maps model offsets to DOM text node offsets and back while skipping layout-only markers.
- `packages/editor/src/owned-model/core/caret-from-point.ts` wraps `caretPositionFromPoint` and `caretRangeFromPoint`.
- `packages/editor/src/owned-model/core/editcontext-host.ts` chooses native versus polyfill and installs the polyfill against `host.ownerDocument.defaultView`.
- `packages/editor/src/owned-model/core/virtual-range.ts` already has a pure virtual-range helper.
- `tests/e2e/owned-model-input.spec.ts` is the browser proof file for the existing spike.
- `tests/editor/editcontext-polyfill.test.ts` covers basic polyfill install and buffer behavior.
- `tests/editor/owned-model-virtual-range.test.ts` covers the pure virtual range helper.

### 3.2 What The Current Spike Already Proves

The current spike already proves these useful contracts:

- Chromium native EditContext and forced polyfill share one controller contract.
- WebKit and Firefox are represented by the polyfill path in Playwright projects.
- The engine paints caret and range rectangles itself.
- Native selection is suppressed visually, so there is no double-selection artifact.
- Arrow movement, vertical movement, Shift selection, drag selection, double-click, and triple-click work in one text block.
- Enter inserts a newline through the EditContext replacement helper.
- Final-newline caret geometry has a layout marker instead of a bogus viewport-origin caret.
- IME final text can be driven on native Chromium and synthesized on the polyfill path.
- IME preedit underline is rendered by the engine.
- The Firefox Windows Vietnamese Telex duplicate and selection-desync regressions are represented as replayed browser event streams.
- The iPadOS-style mirrored-textarea path is represented by a synthetic replay.
- Focus outline parity is checked between native and forced polyfill on Chromium.

The current spike health check command is:

```bash
pnpm exec playwright test tests/e2e/owned-model-input.spec.ts --project=chromium --project=webkit --project=firefox
```

### 3.3 What The Current Spike Does Not Prove

The current spike is intentionally one plain text block. It does not prove:

- Cross-block text selection.
- Gap cursor behavior between two atomic blocks.
- Selection clipping to mounted blocks while the model selection spans unmounted blocks.
- Model-backed copy across unmounted content.
- Paste replacing a cross-block selection.
- Atomic object selection, search text, copy text, and explicit unsupported behavior.
- Active leaf snapshot pinning versus dirty-node notification.
- Per-node render-count isolation.
- Real mark remapping.
- Grapheme-aware left/right/delete. The current `InputSpike` uses one UTF-16 code unit for ArrowLeft and ArrowRight.
- Large fake document performance with only a visible window mounted.
- Screen reader behavior beyond focus outline.
- Real Windows IME behavior beyond captured/synthetic replay.
- Candidate-window behavior from Microsoft Vietnamese Telex, UniKey Vietnamese Unicode, CJK IMEs, or dead-key/composition-key paths.
- Whether a synthetic Playwright/CDP sequence exactly matches the current OS/browser/IME event order on a user's machine.

## 4. Target Proof Model

### 4.1 Two Spike Surfaces

Use two spike surfaces with separate responsibilities.

`InputSpike` remains the one-block input lab:

- Single active text surface.
- Native/forced-polyfill backend comparison.
- IME event shape.
- Caret geometry.
- Grapheme navigation.
- Single-block paste.
- Focus and keyboard smoke.

`FlowSpike` becomes the multi-block proof lab:

- A tiny model with text blocks, one atomic object, a gap position, and optional fake offscreen blocks.
- Node-relative selection over blocks.
- Overlay rect painting over mounted text and object boxes.
- Model copy and paste.
- Object projection adapters.
- Active leaf and dirty-node render counters.
- Fake virtualization and large-block-count stress.

The two spikes can live in the same Ladle story file or adjacent story files, but they should remain visually separate and testable by separate Playwright specs.

### 4.2 Overlay Rects As The Baseline

Overlay rects are the baseline painter for the spike and for Phase 3 unless a later proof justifies otherwise.

The baseline contract:

- The model owns selection.
- The overlay derives DOM `Range`s only for mounted text fragments.
- `Range.getClientRects()` supplies highlight rectangles.
- `Range.getBoundingClientRect()` or a zero-width probe supplies caret geometry.
- Atomic object selection uses the object's mounted bounding box.
- Offscreen selected middles are not painted. The model still owns them for copy, delete, paste, extend, and search.
- Native browser `Selection` is never the source of truth. It may be set as a compatibility assist for non-collapsed ranges, but overlay rects are the visible selection.
- CSS Custom Highlight is deferred. It is not a Phase 2.5 gate.

This intentionally updates the emphasis from `docs/011` §8.5. The same derived range model remains useful, but the first proven painter is absolute overlay rects.

### 4.3 Proof Matrix

| Risk | Existing InputSpike | New FlowSpike | Manual |
| --- | --- | --- | --- |
| Browser input backend | yes | reuse only | Windows smoke |
| IME and preedit | yes, plus trace replay | active-block switch only if added | Vietnamese Telex, UniKey, CJK/dead-key if available |
| Caret geometry | yes | mounted block caret | visual smoke |
| Overlay rect selection | one block | cross-block, object, virtual gaps | visual smoke |
| Copy from model | no | yes | clipboard smoke |
| Paste into model | partial future | yes | clipboard smoke |
| Atomic object projection | no | yes | none required |
| Active leaf / dirty node | no | yes | none required |
| Virtualization | pure helper only | visible window plus fake offscreen | scroll smoke |
| A11y | focus outline only | focused block/object attributes | NVDA smoke |
| Performance | no large flow | render counts plus fake 1k/5k blocks | none required |

## 5. Architecture Decisions

### 5.1 Keep The Existing Input Spike

Recommended: keep `InputSpike` as the input and IME lab.

Why:

- It already contains the native/polyfill backend comparison.
- It already has the hardest Windows/Firefox/Telex event replays.
- It is small enough to debug when browser behavior changes.
- It should not be polluted with multi-block document concerns.

Rejected: replace `InputSpike` with a broader mini-editor. That would make browser input failures harder to isolate.

### 5.2 Add A Flow Spike Before Phase 3

Recommended: add `FlowSpike` as a second tiny proof surface before Phase 3.

Why:

- `docs/011` is a multi-node model foundation. A one-string demo cannot prove the selection, clipboard, object, active-leaf, or virtualization contracts.
- A tiny fake model can prove the invariants without implementing the Phase 3 transaction engine.
- It lets the team discover browser/selection/copy problems while the code is still cheap to throw away.

Rejected: jump directly to Phase 3 model/transactions. That would mix proof failures with implementation failures and make every browser issue look like a model bug.

### 5.3 Do Not Reintroduce Contenteditable

Recommended: no `contenteditable` in Phase 2.5.

Why:

- The whole plan exists because `contenteditable` makes the DOM the live document.
- The current spike already proves engine-painted caret/selection can work without visible native selection.
- The only acceptable future `contenteditable` path is the explicitly scoped iOS single-active-block fallback named in `docs/011`, and that is a product/platform decision, not the default.

Rejected: use `contenteditable` to get native selection over the flow spike. That would prove the wrong architecture.

### 5.4 Keep Spike Helpers Clearly Non-Public

Recommended: keep any `FlowSpike` helper either story-local or under an explicitly named non-public spike folder.

Acceptable shapes:

- `stories/owned-model-flow-spike.stories.tsx` for React/story-only state.
- `packages/editor/src/owned-model/core/spike-flow/**` for pure helpers that need unit tests, not exported from `packages/editor/src/owned-model/core/index.ts`.

Avoid:

- Exporting spike-only helpers from `@idco/editor`.
- Designing final Phase 3 store APIs inside the spike.
- Reusing `RichTextEditorNode` as the runtime spike model.

### 5.5 Split Automated Simulation From Real IME Proof

Recommended: use a three-tier input proof model.

Tier 1 is normal Playwright automation:

- `keyboard.type()` for keydown/keypress/input/keyup shaped typing.
- `keyboard.insertText()` for direct text insertion paths.
- Pointer, selection, copy, paste, and keyboard navigation tests.

Tier 2 is captured-event replay:

- Manually capture real browser events from a Windows machine using Microsoft Vietnamese Telex, UniKey Vietnamese Unicode, dead-key/composition-key input, and CJK IMEs when available.
- Store sanitized JSON fixtures under `tests/fixtures/owned-model-ime/`.
- Replay those fixtures in Playwright against native and forced-polyfill stories.

Tier 3 is manual real-device proof:

- Run the same scenarios through the real OS IME and record observed behavior.
- Treat failures as architecture blockers unless the doc names a deliberate platform limitation.

Why:

- Playwright's Keyboard API can generate key and input events, but `keyboard.insertText()` intentionally dispatches only `input` without keydown/keyup/keypress. That is useful for coverage, not equivalent to a real OS IME.
- Chromium DevTools Protocol exposes experimental `Input.imeSetComposition` and `Input.insertText`, but those are Chromium-only automation hooks. They can emulate candidate text, not prove Microsoft Telex or UniKey behavior across Windows browsers.
- The current idco IME history already showed that a final-text-only test can pass while the real composition lifecycle is still wrong. Transient hidden-textarea/preedit state matters.

Rejected: mark IME as solved because Playwright can synthesize composition-like events. That gives false confidence on exactly the edge this architecture has to survive.

## 6. Implementation Strategy

Sequence the work by risk, not by final engine layer.

1. Stabilize the current `InputSpike` contract around overlay rects, grapheme movement, clipboard basics, and manual Windows notes.
2. Add the `FlowSpike` story with a tiny hardcoded model and diagnostics.
3. Add cross-block overlay selection, including object selection and virtualized gaps.
4. Add model copy/paste to prove DOM presence is not required.
5. Add render counters to prove active-leaf direct patching and dirty-node isolation.
6. Add fake 1k/5k block stress with a visible window, using `calculateVirtualRange`.
7. Add NVDA and Windows IME manual scripts.
8. Add IME trace recording and replay fixtures for real Windows event streams.
9. Only then allow Phase 3 to start.

Each workstream should end with a passing automated check or an explicit manual log format. If a proof fails, fix the spike or update the architecture before Phase 3. Do not hide a failed proof behind a future implementation task.

## 7. Detailed Proof Plan

### 7.1 InputSpike Hardening

Current problem:

- `InputSpike` proves basic movement but not grapheme-aware movement.
- It proves IME replay but not single-block paste/copy.
- It has comments and acceptance language inherited from the older native-selection hypothesis; the implementation now uses overlay rects uniformly.

Target behavior:

- The one-block spike is the canonical input, IME, caret, and single-block clipboard lab.
- Left/right/delete navigation respects grapheme clusters via `Intl.Segmenter`.
- Single-block copy and paste read/write the model state, not DOM selection text.
- The comments and tests describe overlay rects as the visible baseline.

Implementation tasks:

- Add a small grapheme boundary helper in `packages/editor/src/owned-model/core/text-input-controller.ts` or a pure helper beside it.
- Update ArrowLeft and ArrowRight to move by grapheme boundary, not by one UTF-16 unit.
- Add Backspace/Delete handling for grapheme deletion in the spike.
- Add e2e cases for emoji ZWJ, Vietnamese combining marks, and a surrogate-pair emoji.
- Add single-block copy/paste handlers that operate on `state.text`, `state.anchor`, and `state.focus`.
- Add an e2e case that selects part of the one-block model, copies it, and asserts the clipboard text.
- Add an e2e case that pastes plain text over a selected range.
- Review comments in `selection-overlay.ts`, `text-input-controller.ts`, and `owned-model-input.spec.ts` so they match overlay rects as baseline and native selection as non-authoritative.

Tests:

- `pnpm exec playwright test tests/e2e/owned-model-input.spec.ts --project=chromium --project=webkit --project=firefox`
- `pnpm test`

### 7.2 FlowSpike Model And Rendering

Current problem:

- No spike exercises more than one text block.
- No spike has node-relative points, atomic object selection, gap positions, mounted/unmounted blocks, or dirty-node diagnostics.

Target behavior:

- A `FlowSpike` story renders a tiny model:

```ts
type FlowBlock =
  | { id: "a" | "b" | "c"; kind: "text"; text: string }
  | { id: "obj"; kind: "object"; label: string; copyText?: string; searchText?: string };

type FlowSelection =
  | { type: "text"; anchor: { node: string; offset: number }; focus: { node: string; offset: number } }
  | { type: "node"; node: string }
  | { type: "gap"; node: string; side: "before" | "after" };
```

- The story renders mounted blocks only.
- The story exposes diagnostics on `window.__IDCO_OWNED_FLOW__`.
- The story can toggle one middle text block as unmounted to simulate a virtualized gap.

Implementation tasks:

- Add `FlowSpike` as a story, preferably in `stories/owned-model-input.stories.tsx` if small, or `stories/owned-model-flow.stories.tsx` if it grows.
- Keep the model local to the spike or in `owned-model/core/spike-flow/**` without public exports.
- Render three text blocks and one atomic object.
- Add a mounted/unmounted toggle for the middle text block.
- Add diagnostics: current selection, mounted ids, copied text, render counts by id, active leaf id, dirty node ids, and selection rect count.

Tests:

- New `tests/e2e/owned-model-flow.spec.ts`.
- Chromium first while building, then the full matrix before marking done.

### 7.3 Cross-Block Selection And Overlay Rects

Current problem:

- One-block selection does not prove `comparePoints`, mounted-range clipping, object selection, gap cursor, or offscreen middle handling.

Target behavior:

- Drag or keyboard selection can span text block A, atomic object OBJ, and text block C.
- The model selection includes the whole intended range.
- Overlay rects paint only mounted visible pieces.
- If block B is unmounted, its content remains selected in the model but produces no rects.
- Atomic object selection paints the object's bounding box.
- Gap cursor paints a caret-like marker before or after an object.

Implementation tasks:

- Add a spike-local `compareFlowPoints` over the hardcoded block order.
- Add `deriveFlowOverlayRects(selection, mountedBlocks)` that returns mounted text ranges plus object boxes.
- Use `Range.getClientRects()` for text blocks and `getBoundingClientRect()` for atomic object boxes.
- Add pointer drag from block A to block C.
- Add keyboard extension across block boundaries.
- Add explicit object-click and gap-click behavior.
- Ensure native browser selection is not visually responsible for any flow selection.

Tests:

- Drag from first text block into third text block and assert model endpoints plus visible rect count.
- Toggle middle block unmounted and assert the copied model range still includes it while rect count drops.
- Click atomic object and assert `{ type: "node", node: "obj" }`.
- Click before/after object gap and assert gap selection.

### 7.4 Model Clipboard And Paste

Current problem:

- `docs/011` requires clipboard to read from the model, but the current spike does not prove cross-block copy or paste.

Target behavior:

- Copy serializes the model range, including unmounted selected blocks.
- Copy includes object adapter text when the object has a projection.
- Copy reports explicit unsupported text or fallback when the object adapter is missing.
- Paste plain text replaces the model selection without trusting the DOM.
- Paste over a cross-block selection produces a predictable simple result in the spike model.

Implementation tasks:

- Add `serializeFlowSelection(selection, blocks, adapters)` as a spike helper.
- Add `replaceFlowSelectionWithText(selection, text)` as a spike helper with deliberately simple rules.
- Handle `copy` and `paste` on the flow host.
- Store last copied text in diagnostics for Playwright assertions.
- Add one object with `copyText` and one object variant without `copyText`.

Tests:

- Select from A through unmounted B into C, copy, and assert clipboard text includes B.
- Select through object with adapter, copy, and assert object text is included.
- Select through object without adapter, copy, and assert explicit fallback marker.
- Paste plain text over a cross-block range and assert the model result.

### 7.5 Atomic Object Projection

Current problem:

- `docs/011` now says opaque object internals are not invisible to document services, but no spike proves that object projection boundary.

Target behavior:

- Objects remain atomic in outer selection.
- Object copy/search/export behavior comes from an adapter.
- Missing adapter behavior is explicit.

Implementation tasks:

- Add a small spike adapter shape:

```ts
type FlowObjectAdapter = {
  copyText?: (block: FlowObjectBlock) => string;
  searchText?: (block: FlowObjectBlock) => string;
  exportText?: (block: FlowObjectBlock) => string;
};
```

- Use it in copy serialization.
- Add a tiny search field or button in the story that searches model text plus object `searchText`.
- Report search hits in diagnostics.

Tests:

- Search finds object text only when `searchText` exists.
- Search skips or reports unsupported object content explicitly when missing.
- Copy uses `copyText`, not DOM text inside the object box.

### 7.6 Active Leaf And Dirty Node Proof

Current problem:

- `docs/011` depends on the active leaf being patched directly while React notification skips that node during plain typing. No spike proves this distinction.

Target behavior:

- FlowSpike has `activeLeafId`.
- Plain typing in the active text block updates visible text without incrementing that block's React render counter.
- Structural changes, such as a demo mark toggle or block split, mark the block dirty and increment render count.
- Sibling blocks do not rerender while typing in the active leaf.

Implementation tasks:

- Add render counters by block id in the FlowSpike view.
- Add a direct text-node patch path for the active block, similar to the current one-block controller.
- Add a fake dirty set in diagnostics:

```ts
type FlowDirty = {
  nodes: string[];
  selection: boolean;
  structure: boolean;
};
```

- Add a simple mark toggle command that forces active-block rerender once.
- Add sibling counters to prove no cascade.

Tests:

- Type in block A and assert A visible text changes, A render count does not increase per character, and B/C render counts stay stable.
- Toggle mark on A and assert A render count increments once.
- Press Enter or add a block and assert `structure` changes and parent/list render behavior is explicit in diagnostics.

### 7.7 Virtualization And Performance Proof

Current problem:

- `calculateVirtualRange` is tested as a pure helper, but no story proves mounted-window behavior with selection/copy and render counters.

Target behavior:

- FlowSpike can render a 1,000 or 5,000 block fake document using a visible window plus overscan.
- Selection and copy work across a virtualized range.
- Scrolling does not mount every block.
- Typing in a mounted block does not rerender unmounted or sibling mounted blocks.

Implementation tasks:

- Add a `LargeFlowSpike` variant or a toggle inside `FlowSpike`.
- Use `calculateVirtualRange` to derive visible ids.
- Use fixed or measured heights, but keep the spike simple.
- Add diagnostics: total block count, mounted count, active id, render counts, copied text length.

Tests:

- Open 1,000-block story and assert mounted count is viewport plus overscan, not 1,000.
- Select/copy from block 3 to block 900 through a programmatic selection command and assert copied text includes the offscreen middle.
- Type in one mounted block and assert render counters do not show a cascade.

### 7.8 Accessibility And Windows Manual Proof

Current problem:

- Automated tests cannot fully prove screen reader behavior, Windows IME candidate quality, or iOS native affordances.

Target behavior:

- The spike has a repeatable manual script for Windows.
- NVDA smoke is explicit enough to repeat.
- Manual failures are recorded as architecture blockers or known platform limitations, not vague impressions.

Implementation tasks:

- Add a short manual checklist section to this doc or a future `docs/012` appendix if the checklist grows.
- For the story DOM, add attributes that make the focused block/object inspectable: `role="textbox"`, `aria-multiline`, `aria-activedescendant`, focused block id, and a live-region experiment for selection changes.
- Run Windows Chrome/Edge native path.
- Run Windows Firefox polyfill path.
- Run NVDA smoke on both.
- Run Microsoft Vietnamese Telex manually on native and polyfill paths.
- Run UniKey Vietnamese Unicode manually on native and polyfill paths when available.
- Run one dead-key or composition-key path manually when available.
- If available, run one CJK IME manual check.

Manual evidence format:

```text
Browser:
Backend:
Input method:
Story:
Scenario:
Expected:
Observed:
Pass/Fail:
Notes:
```

### 7.9 IME Trace Recorder And Replay Fixtures

Current problem:

- Playwright cannot install or drive a user's real Microsoft Telex, UniKey Vietnamese Unicode, Windows language bar state, dead-key layout, candidate window, or IME conversion menu.
- Synthetic `compositionstart`/`beforeinput`/`input` event dispatch can cover controller branches but can drift from browser-owned composition.
- CDP IME APIs are Chromium automation hooks, so they cannot stand in for Firefox/WebKit polyfill behavior or real Windows IME integration.
- Manual testing without captured artifacts is easy to forget, hard to compare, and not useful in CI.

Target behavior:

- `InputSpike` has a recorder mode that captures real event streams from the focused host and the hidden textarea/polyfill path.
- Captured traces are sanitized and saved as fixtures.
- Playwright replays those fixtures as regression tests.
- The manual checklist records which real IMEs were available, which fixtures were captured, and which gaps remain unproven on the current machine.

Trace fixture shape:

```ts
type OwnedImeTrace = {
  schemaVersion: 1;
  source: {
    os: string;
    browser: string;
    backend: "native-editcontext" | "forced-polyfill" | "polyfill";
    inputMethod: string;
    story: string;
    capturedAt: string;
  };
  scenario: {
    name: string;
    initialText: string;
    initialSelection: { anchor: number; focus: number };
    expectedFinalText: string;
    expectedFinalSelection: { anchor: number; focus: number };
  };
  events: Array<{
    atMs: number;
    type:
      | "keydown"
      | "keyup"
      | "compositionstart"
      | "compositionupdate"
      | "compositionend"
      | "beforeinput"
      | "input"
      | "selectionchange"
      | "paste";
    key?: string;
    code?: string;
    data?: string | null;
    inputType?: string;
    isComposing?: boolean;
    defaultPrevented?: boolean;
    hostSelection?: { anchor: number; focus: number };
    textarea?: { value: string; selectionStart: number; selectionEnd: number };
    model?: { text: string; anchor: number; focus: number; preeditText?: string };
  }>;
};
```

Implementation tasks:

- Add a recorder toggle to the `InputSpike` diagnostics surface.
- Record `keydown`, `keyup`, `compositionstart`, `compositionupdate`, `compositionend`, `beforeinput`, `input`, `selectionchange`, and `paste`.
- Capture both event fields and controller diagnostics after each event.
- Capture hidden textarea value/selection during composition on the polyfill path.
- Add an export button or diagnostics method that returns sanitized JSON.
- Add fixtures under `tests/fixtures/owned-model-ime/`.
- Add a replay helper in `tests/e2e/owned-model-input.spec.ts` or a small helper beside it.
- For each replay, assert transient preedit/textarea checkpoints and final model text, not only final output.
- Add a plain `<textarea>` recorder variant or small story area for baseline capture when diagnosing a browser/IME mismatch.

Fixture scenarios:

- Microsoft Vietnamese Telex: compose, commit, move caret, insert in the middle, delete during composition.
- UniKey Vietnamese Unicode: compose, commit, move caret, paste over a selection.
- Dead-key or composition key: compose accent, cancel composition, then type plain text.
- CJK IME when available: candidate update, commit, caret move, delete.
- Firefox forced/polyfill replay of any captured event stream that previously reproduced duplicate commit or selection desync.

Acceptance criteria:

- Each available real Windows IME has a captured manual evidence entry and a replay fixture.
- Unavailable IMEs are listed as current lab gaps instead of being marked green.
- Replays assert both transient composition state and final model state.
- A replay failure blocks Phase 3 unless the architecture doc names a deliberate platform limitation.

## 8. Implementation Backlog

### R12-A. Align InputSpike With Overlay Rect Baseline

Scope:

- `packages/editor/src/owned-model/core/selection-overlay.ts`
- `packages/editor/src/owned-model/core/text-input-controller.ts`
- `tests/e2e/owned-model-input.spec.ts`
- `docs/010_owned_model_virtualized_editor_plan.md`
- `docs/011_foundation_dsa_owned_model_editor.md`

Tasks:

- [ ] Update comments and acceptance wording so overlay rect painting is the baseline.
- [ ] Keep native DOM selection non-authoritative and visually suppressed.
- [ ] Move any CSS Custom Highlight requirement to future backlog.

Acceptance criteria:

- The code and docs no longer imply Custom Highlight is required before Phase 3.
- The spike still passes the current browser matrix.

Tests:

- `pnpm exec playwright test tests/e2e/owned-model-input.spec.ts --project=chromium --project=webkit --project=firefox`

### R12-B. Add Grapheme Navigation To InputSpike

Scope:

- `packages/editor/src/owned-model/core/text-input-controller.ts`
- `tests/e2e/owned-model-input.spec.ts`

Tasks:

- [ ] Add an `Intl.Segmenter`-based grapheme helper.
- [ ] Use it for ArrowLeft, ArrowRight, Backspace, and Delete.
- [ ] Add tests for emoji, surrogate pairs, and Vietnamese combining text.

Acceptance criteria:

- Navigation and deletion never split a grapheme cluster in the spike.

Tests:

- `pnpm exec playwright test tests/e2e/owned-model-input.spec.ts --project=chromium --project=webkit --project=firefox`

### R12-C. Add Single-Block Clipboard To InputSpike

Scope:

- `packages/editor/src/owned-model/core/text-input-controller.ts`
- `tests/e2e/owned-model-input.spec.ts`

Tasks:

- [ ] Handle copy from `state.text`.
- [ ] Handle plain-text paste into `state.text`.
- [ ] Assert clipboard behavior through Playwright.

Acceptance criteria:

- Copy and paste do not depend on visible native selection text.

Tests:

- `pnpm exec playwright test tests/e2e/owned-model-input.spec.ts --project=chromium --project=webkit --project=firefox`

### R12-D. Add FlowSpike Story

Scope:

- `stories/owned-model-input.stories.tsx` or `stories/owned-model-flow.stories.tsx`
- optional non-public `packages/editor/src/owned-model/core/spike-flow/**`

Tasks:

- [ ] Add a multi-block story with three text blocks and one atomic object.
- [ ] Add model selection diagnostics.
- [ ] Add mounted/unmounted block toggle.
- [ ] Add render counters and dirty diagnostics.

Acceptance criteria:

- The story proves cross-block model state without introducing the Phase 3 store.

Tests:

- New `tests/e2e/owned-model-flow.spec.ts`.

### R12-E. Add Cross-Block Overlay Selection

Scope:

- FlowSpike story/helpers.
- `tests/e2e/owned-model-flow.spec.ts`

Tasks:

- [ ] Implement node-relative text selection in the spike.
- [ ] Implement object and gap selection.
- [ ] Paint text and object overlay rects.
- [ ] Clip painting to mounted blocks while preserving full model selection.

Acceptance criteria:

- Cross-block and cross-virtual selection are model-correct and visually plausible.

Tests:

- `pnpm exec playwright test tests/e2e/owned-model-flow.spec.ts --project=chromium --project=webkit --project=firefox`

### R12-F. Add Model Copy/Paste And Object Projection

Scope:

- FlowSpike story/helpers.
- `tests/e2e/owned-model-flow.spec.ts`

Tasks:

- [ ] Serialize model ranges to clipboard text.
- [ ] Include unmounted block text.
- [ ] Include object adapter text when present.
- [ ] Make missing object adapter behavior explicit.
- [ ] Paste plain text over a cross-block selection.

Acceptance criteria:

- Copy/paste proves the model, not DOM presence, owns clipboard behavior.

Tests:

- `pnpm exec playwright test tests/e2e/owned-model-flow.spec.ts --project=chromium --project=webkit --project=firefox`

### R12-G. Add Active Leaf And Dirty Node Render Proof

Scope:

- FlowSpike story/helpers.
- `tests/e2e/owned-model-flow.spec.ts`

Tasks:

- [ ] Track `activeLeafId`.
- [ ] Direct-patch active text during plain typing.
- [ ] Track render counts per block.
- [ ] Track dirty nodes, selection dirty, and structure dirty.
- [ ] Add structural command that causes a deliberate rerender.

Acceptance criteria:

- Plain typing updates the visible active leaf without sibling rerenders.
- Structural changes rerender the correct block(s).

Tests:

- `pnpm exec playwright test tests/e2e/owned-model-flow.spec.ts --project=chromium --project=webkit --project=firefox`

### R12-H. Add Virtualized Large Flow Proof

Scope:

- FlowSpike large variant.
- `packages/editor/src/owned-model/core/virtual-range.ts`
- `tests/e2e/owned-model-flow.spec.ts`

Tasks:

- [ ] Add 1,000 and 5,000 block fake document modes.
- [ ] Use `calculateVirtualRange`.
- [ ] Assert mounted count stays bounded.
- [ ] Assert programmatic cross-virtual copy includes offscreen text.

Acceptance criteria:

- The spike proves the inversion at scale: DOM presence is not required for selection/copy correctness.

Tests:

- `pnpm exec playwright test tests/e2e/owned-model-flow.spec.ts --project=chromium --project=webkit --project=firefox`

### R12-I. Add Manual Windows Proof Script

Scope:

- `docs/012_owned_model_spike_proof_plan.md` or a follow-up appendix.

Tasks:

- [ ] Add manual Windows Chrome/Edge native EditContext checklist.
- [ ] Add manual Windows Firefox polyfill checklist.
- [ ] Add NVDA smoke checklist.
- [ ] Add Microsoft Vietnamese Telex manual checklist.
- [ ] Add UniKey Vietnamese Unicode manual checklist when available.
- [ ] Add dead-key/composition-key manual checklist when available.
- [ ] Add CJK manual checklist if an IME is available.

Acceptance criteria:

- Manual proof has repeatable steps and a stable evidence format.
- The manual proof clearly separates "tested on this machine" from "not available on this machine".

Tests:

- Manual only.

### R12-J. Add IME Trace Recorder And Replay Fixtures

Scope:

- `stories/owned-model-input.stories.tsx`
- `packages/editor/src/owned-model/core/text-input-controller.ts`
- `tests/e2e/owned-model-input.spec.ts`
- `tests/fixtures/owned-model-ime/*.json`

Tasks:

- [ ] Add recorder mode to `InputSpike`.
- [ ] Capture real event streams with controller diagnostics.
- [ ] Capture hidden textarea value/selection during composition.
- [ ] Export sanitized trace JSON.
- [ ] Add fixture schema validation in tests.
- [ ] Add Playwright replay helper.
- [ ] Replay Microsoft Vietnamese Telex and UniKey fixtures when available.
- [ ] Replay dead-key/composition-key and CJK fixtures when available.
- [ ] Assert transient preedit state, hidden textarea state, selection, and final model text.
- [ ] Add a plain textarea baseline capture path for comparison.

Acceptance criteria:

- Real Windows IME traces become durable fixtures.
- Playwright replay is treated as regression coverage, not as proof that every OS IME still behaves the same today.
- Missing IME coverage is explicit in the manual evidence log.

Tests:

- `pnpm exec playwright test tests/e2e/owned-model-input.spec.ts --project=chromium --project=webkit --project=firefox`

## 9. Edge Cases And Failure Modes

- Native selection leaks visually: keep `[data-owned-host]` native selection suppression and assert no duplicate selection layer.
- Collapsed caret reports `(0,0)`: keep the probe/empty-block fallback and test empty text plus terminal newline.
- IME composition desyncs hidden textarea and model: do not rewrite the textarea full value during composition; sync after composition ends.
- Firefox Telex trailing `insertCompositionText` repeats committed text: keep the captured event stream regression.
- Windows IME language switch emits plain text instead of composition: treat this as platform behavior unless a safe backend-level signal appears.
- Playwright IME replay passes but real Microsoft Telex or UniKey fails: treat replay as stale or incomplete, capture a new trace, and fix the architecture/test contract before Phase 3.
- CDP IME emulation passes in Chromium: do not count that as Firefox/WebKit or real Windows IME proof.
- Manual capture contains private text: discard it and recapture with short deterministic fixture text.
- Grapheme movement splits emoji or combining text: block Phase 3 until `Intl.Segmenter` navigation is proven.
- Object adapter missing: copy/search/export must use explicit unsupported/fallback behavior, never silent skip.
- Offscreen selected block unmounted: selection remains in the model, overlay rects omit only the invisible DOM, copy still includes it.
- Render counters become noisy because diagnostics update state: diagnostics must not themselves trigger the render cascade being measured.
- Large FlowSpike becomes a real editor by accident: keep the model hardcoded and non-public until Phase 3.

## 10. Verification Plan

Focused checks:

```bash
pnpm exec playwright test tests/e2e/owned-model-input.spec.ts --project=chromium --project=webkit --project=firefox
pnpm exec playwright test tests/e2e/owned-model-flow.spec.ts --project=chromium --project=webkit --project=firefox
```

Repo checks after spike changes:

```bash
pnpm format:check
pnpm lint
pnpm check:dup
pnpm typecheck
pnpm test
pnpm build
```

Full gate:

```bash
pnpm check
```

Manual Windows smoke:

- Chrome or Edge: native EditContext path.
- Chrome or Edge forced polyfill story.
- Firefox: polyfill path.
- NVDA: focus and selection announcement smoke.
- Microsoft Vietnamese Telex: type, compose, move caret, switch block, paste.
- UniKey Vietnamese Unicode: type, compose, move caret, paste over selection when available.
- Dead-key or composition-key layout: compose, cancel, commit when available.
- CJK IME if available: compose, commit, move caret, delete.

IME trace replay:

- Capture real Windows IME traces from the recorder mode.
- Store sanitized fixtures under `tests/fixtures/owned-model-ime/`.
- Replay fixtures in Playwright across native Chromium and forced-polyfill projects.
- Assert transient hidden textarea and preedit checkpoints in addition to final text.
- Keep a manual evidence row beside every captured fixture.

## 11. Definition Of Done

Phase 2.5 is done when all are true:

- `InputSpike` still passes the three-browser Playwright matrix.
- `InputSpike` uses grapheme-aware navigation and deletion.
- `InputSpike` proves single-block model copy/paste.
- `FlowSpike` exists and proves cross-block selection, object selection, gap selection, and overlay rect painting.
- `FlowSpike` proves model copy across unmounted content.
- `FlowSpike` proves object projection adapters and explicit missing-adapter behavior.
- `FlowSpike` proves active-leaf direct patching and dirty-node render isolation.
- `FlowSpike` proves bounded mounting for a fake large document.
- Manual Windows IME and NVDA smoke results are recorded.
- Available real Windows IME checks have captured trace fixtures and Playwright replay tests.
- Unavailable real IME checks are listed as explicit lab gaps, not counted as passed.
- The code and docs agree that overlay rects are the baseline painter.
- No `contenteditable` path is introduced.
- No Phase 3 runtime store or public owned-model API is introduced as part of the spike.
- `pnpm check` passes after the spike changes.

## 12. Future Backlog

- CSS Custom Highlight optimization over the same derived range model.
- iOS real-device active-block fallback decision.
- Full Phase 3 transactions, inverse steps, and model store.
- Real object definitions and bake pipeline.
- Real compatibility projection.
- Rich HTML paste parser and sanitization boundary.
- Spellcheck/autocorrect strategy.
- Model-backed find/search/TOC indexes.
- Collaboration.

## 13. Final Model

The next proof step is not a full editor. It is a stronger spike suite:

- `InputSpike` proves browser input, IME, caret, one-block clipboard, and grapheme movement.
- `FlowSpike` proves the `docs/011` document-flow claims that a single text spike cannot prove: cross-block model selection, overlay rect painting, virtual gaps, model clipboard, atomic objects, active leaf isolation, dirty-node notifications, and bounded rendering.

If those pass, Phase 3 starts with evidence rather than optimism. If they fail, the architecture gets corrected while the code is still small.
