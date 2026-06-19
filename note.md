# Pre-Phase-8 cleanup & refactor notes

> Formalized into `docs/017_pre_phase_8_plan.md` (sequenced + gated) and `docs/016_node_spi_and_pluggable_blocks.md` (the node SPI). This file is now scratch; 017 is authoritative.

Working notes for the cleanup/refactor pass to do **before** starting docs/010 Phase 8 (feature parity + toolbar/menus). Everything here is cleanup and decomposition — no new engine behavior. Do it as its own pass with the green suite as the gate, then start Phase 8 on a tidy view.

The safety net for all of this: `pnpm test` (vitest, 627) + the engine e2e (`tests/e2e/engine-*.spec.ts` on chromium/webkit/firefox). Treat them as the behavior bar — every refactor below must keep them green with no assertion changes.

---

## 1. The boundary (what to touch vs. what to leave)

Three layers. Two get replaced by the `@idco/ui` foundation; one is the moat and stays.

- **CSS / styling → replace with daisyui + design tokens.** All the inline `style={}` objects and style constants are placeholders. Safe to swap.
- **Chrome primitives (modal / button / popover / menu / select / dialog) → `@idco/ui` (React Aria + DaisyUI).** This is docs/010 §7.1. Do not hand-roll any of these.
- **Engine core → leave it. The engine is good.** `EditorStore`, steps, model-owned selection, the EditContext substrate, virtualization, caret/overlay painting. There is nothing in the UI foundation to replace it with — that's the whole point of docs/010. Replacing it would un-build Phases 2–7.

---

## 2. Load-bearing CSS — DO NOT lose these when swapping to daisyui

These ~5 properties are functional, not decorative. Preserve them through any restyle:

- `caret-color: transparent` + the `::selection` suppression on the editing surface (the engine paints its own caret/selection; `ENGINE_SURFACE_SUPPRESS_CSS`). Keep the `[data-engine-object-editor] { caret-color: auto }` override so the live code editor keeps its native caret.
- `user-select: none` on text blocks (native selection must not fight the overlay).
- `position: relative` (content) / `position: absolute` (overlay rects) layering.
- `white-space: pre-wrap` on text blocks (soft breaks + caret geometry depend on it).
- the measured-height / virtualization geometry (block height, spacers).

Everything else (colors, spacing, borders, fonts) is free to move to daisyui.

---

## 3. Chrome → `@idco/ui` migration targets

Current hand-rolled spots to migrate:

- **`ObjectConfigPanel`** (Phase 6, in `packages/editor/src/view/react-view.tsx`): raw `<input>` + hand-styled "Done" `<button>` in an absolute div → `@idco/ui` Button + form fields, and the panel itself → a Popover/Dialog.
- Code-block **language picker**, any **link editor** → `@idco/ui` Select / fields.
- Phase 8 additions (toolbar, slash/insert menu, format flyout, confirmations) → `@idco/ui` from day one.

**Focus integration note (important):** the engine owns focus via the hidden EditContext host. React Aria overlays focus-trap and focus-restore on close. Point their restore target at the editor's input host — call `getEditorHandle().focus()` (or the view focuser) on close instead of letting React Aria restore to a stale element. Model selection survives focus loss by design (011 §8.6), so the popover→edit round-trip is clean.

---

## 4. Break up `packages/editor/src/view/react-view.tsx` (it's ~3k lines)

It's fragile — edits shift line numbers and the coupling makes it scary to touch. Decompose by concern, **pure move, zero behavior change, one module at a time**:

- `geometry.ts` — pure DOM geometry: `robustCaretRect`, `caretClientRect`, `textRangeClientRects`, `characterClientRects`, `pointToModelPosition`, `caretPositionAtPoint`, `makeRect`/`toDomRect`. (No React — easiest first.)
- `navigation.ts` — `selectionForNavigation`, `verticalNavigation`, grapheme/word/`lineRangeAt`, `applyEditContextText`, `diffText`. (Mostly pure; partly exported already.)
- `selection-overlay.tsx` — `SelectionOverlay`, `SelectionAnnouncer`, `selectionRects`, `feedImeBounds`.
- `text-block.tsx` — `EngineTextBlock` + the EditContext controller + composition handlers.
- `object-block.tsx` — `EngineObjectBlock`, `BakedObjectView`, `CodeLiveSurface`, `ObjectConfigPanel`. (Also where the daisyui chrome swap lands.)
- `store-hooks.ts` — `useEditorNode` / `useEditorOrder` / `useSelectionFrameVersion`.
- `styles.ts` — style constants + suppress CSS (the seam for the daisyui migration).
- `react-view.tsx` — just the `OwnedModelEditorView` shell + wiring.

**Coupling points to handle deliberately** (this is what makes the split reduce fragility instead of spreading it):

- the shared mutable `registryRef` (blocks + overlay both read/write it),
- the prop-threaded `goalColumnRef`,
- the per-block EditContext controller lifecycle.

Consider turning those into one small typed context/object passed explicitly rather than threaded prop-by-prop.

Order: extract `styles.ts` first, then swap its contents to daisyui (§2 caveats).

---

## 5. PrismJS for code blocks (when added)

- Put it in the **shared reader / primitive layer (docs/015)** so the editor resting view, the reader, and export render identical highlighted code (no drift, §5.9). `packages/reader` doesn't exist yet (Phase 8) — until then the editor highlights its own resting view; move it to the shared layer when reader lands.
- It's **pure compute** (string → tokens → HTML) → can run as a worker baker (§7.5, the Phase 6 `bake.worker` is the slot).
- Baked Prism HTML goes through the **sanitization boundary** (§10.5, Phase 8) — low risk (it's the author's own code) but route it through the boundary, not `dangerouslySetInnerHTML`.
- Keep Prism **out of the framework-free `core/**`** (G3/G4). It's a view/bake dep.
- Live-edit highlighting = transparent-textarea-over-highlighted-`<pre>`; reuse the existing hand-rolled Prism code editor in `@idco/ui` rather than building a second.

---

## 6. Known follow-ups already recorded in docs/010 (don't lose these)

- **Firefox cross-block drag-select is a real Firefox-only bug** (not a platform limit), `test.fixme`'d in `engine-caret.spec.ts`, tracked in §11 — root-cause and fix. (Single-click point→offset works on Firefox, so it's drag-specific.)
- **Deferred to Phase 8** (in §10.5): axe-core audit, `aria-activedescendant` for atomic objects, `PageUp`/`PageDown` viewport paging + horizontal reveal of a long unwrapped line. Desktop spellcheck = decided (accept absence).
- The Firefox synthetic-`ClipboardEvent` cut/paste `test.fixme` is a genuine harness limit (real Ctrl+X/V works) — leave it.

---

## 7. Playwright is slow — optimization options

Already done: `.perf` specs are chromium-only (cross-browser perf budgets only flake under load). Further options when wanted:

- Only IME/caret/selection specs truly need 3 browsers; objects/a11y/structural editing could be chromium-only with a small tagged cross-browser subset.
- Raise worker parallelism for everything **except** the timing-sensitive autoscroll/drag specs (those need real-time rAF → keep serial).
- Replace the fixed autoscroll `waitForTimeout` with polling.
- Run the full 3-browser matrix in CI / on demand; local iteration on chromium only.
