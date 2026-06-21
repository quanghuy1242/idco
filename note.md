# packages/editor — architecture gap audit + execution plan

Findings dossier on SPI gaps, hardcoded type branches, feature leaks, and duplication in the owned-model editor, plus one epic that folds in every fix and an ordered sequence to run it. The legacy Lexical editor extraction is tracked separately. No code changed yet. Scope is `src/core` and `src/view`.

## The lens

The engine has one design rule (docs/016, /020, /021, /022): register, don't hardcode. A block registers a `NodeView` + `NodeDefinition` (objects) or a `StructuralNodeView` + `StructuralDefinition` (containers), and generic code holds no node-type knowledge. Two clean SPI surfaces already exist: `src/view/node-view.ts` (objects) and `src/view/structural-view.ts` (containers).

Two parts of the codebase already do this right, and they are the shape to copy. `caretInk` is a generic slot the selection overlay reads by walking ancestors with no per-type knowledge (`selection-overlay.tsx:171-181`). The insert menu enumerates `listInsertableNodes()` + `listInsertableStructuralNodes()`, so a registered node appears with zero edits (`editor-chrome.tsx:180-205`). Every gap below is a place that rule is broken or was left half-done.

## Part A — the table

The table spans 5 active files (~2,660 lines). The split is mostly correct layering; the only real defects are one misfiled file and the overlay leak.

| File | Lines | Layer | On an SPI? |
|---|---|---|---|
| `core/table.ts` | 276 | core: seed / import / export `StructuralDefinition`s | yes, via `tableStructuralDefinitions()` into `BUILT_IN_STRUCTURAL_DEFINITIONS` |
| `view/nodes/table.tsx` | 185 | view: live + resting render, `caretInk` | yes, via `registerStructuralView` |
| `view/table-operations.ts` | 1,324 | pure model command-builders (grid map, merge/unmerge, insert/delete) | no, imported directly |
| `view/table-controls.tsx` | 494 | live hover overlay (insert/delete/resize + table chrome) | no, hardcoded in react-view |
| `view/table-interactions.tsx` | 381 | cell-range selection + cell-action button | no, hardcoded in react-view |

The layering is fine where core stays table-agnostic: core gains no table verb, so table logic splits into a core definition and a view structural-view, both registered through the same path callout and list use (`nodes/index.ts:52-61`). Every block splits across core (definition) and view (node view) this way; callout does the same and nobody calls it scattered. So the table is not uniquely scattered.

The leak is `react-view.tsx:49-50, 341-342, 400-401`. It imports and mounts `<TableControls>` + `<TableInteractions>` in both the virtualized and non-virtualized branches. Table is the only block type whose name appears in the generic view orchestrator; every other block renders blind through the dispatcher. The cause is a missing SPI slot: the node SPI covers render, insert, caretInk, and chrome, but nothing for a view-level overlay (a portal with global pointer listeners). The two overlays had nowhere to register, so they sit in the JSX, duplicated across both branches.

## Part B — the toolbar API

The toolbar drives the model, not the DOM, and that part is solid. Toggles read `store.query({type:"is-mark-active"})` and dispatch `store.command({type:"toggle-mark"})` (`editor-chrome.tsx:328-354`), state stays live through a selection+commit subscription (`useToolbarVersion`, `:110-128`), and focus survives a press. The insert menu is fully SPI-driven (`:180-205`), so a registered node shows up without touching the toolbar.

The hardcoded half is what you sensed. Formatting marks (`FORMAT_BUTTONS`, `:37-48`), block types (`BLOCK_TYPES`, `:50-98`), and the list/indent buttons are static literal arrays. No `registerMark` or `registerBlockType` SPI exists, so adding a mark or a block type means editing this file. Insert is extensible; formatting and block-type are not.

There are also two chrome systems with no shared contract. The document toolbar lives in `editor-chrome.tsx`. The table builds its own floating chrome (layout select, structure menu, cell actions) by hand from `BlockChrome` / `ChromeButton` / `ChromeSelect` in `table-controls.tsx:391-459` and `table-interactions.tsx:271-378`, each with its own literals (`TABLE_LAYOUTS`, `FILL_COLORS`). They share idco-ui primitives but no contextual-toolbar abstraction, so each feature re-rolls its chrome.

## Part C — the findings (C1–C8)

C1. `list` / `listitem` / `quote` are half-migrated structural types. `structural-view.ts` says so outright: "quote/list/listitem keep hardcoded compat branches until migrated." Only `callout` fully crossed into the SPI; `BUILT_IN_STRUCTURAL_DEFINITIONS = [callout, ...table]` has no list and no quote. Their names stay hardcoded in 8+ generic spots: `core/compat.ts` (~286-389, 469, 509, 769-866), `view/resting-document.tsx:186-224`, `view/styles.ts:386`, `core/commands/shared.ts` (201, 230, 469-520), `core/commands/text.ts:218,253`, `core/store/editor-store.ts:1176`, `view/selection-overlay.tsx:647-651`. This is the worst rot risk: callout is the finished template, but the engine still has two ways to know a container exists.

C2. Marks have no SPI. The 11 marks (bold, italic, underline, strikethrough, code, highlight, sub, superscript, link, comment, glossary) are a closed union hardcoded in `core/model.ts:164`, `view/mark-render.tsx:51` (`MARK_NESTING_ORDER`), `view/mark-render.tsx` (`wrapMark` switch), `view/editor-chrome.tsx:37`, `view/context-menu.tsx:28`, and `core/bake.ts:144`. Same conceptual size as the node SPI, none of the infrastructure.

C3. Text-leaf block types are a closed set. `paragraph` / `heading` / `quote` / `listitem` (`TextLeafType`, `model.ts:191`) can't be extended; they are hardcoded in `editor-chrome.tsx:50`, `context-menu.tsx:41`, `core/markdown-shortcuts.ts:88-94`, `core/bake.ts:141`, and `selection-overlay.tsx:647`.

C4. Overlay SPI gap. The table-controls and table-interactions leak into react-view (Part A). The fix is a generic `renderOverlay` slot, modeled on `caretInk`.

C5. Toolbar and context-menu duplicate each other, and the copies have drifted. `FORMAT_BUTTONS` (`editor-chrome.tsx`) and `FORMAT_ITEMS` (`context-menu.tsx`) are the same 6-mark list, twice. `BLOCK_TYPES` (Paragraph, H1-H4, Quote) and `BLOCK_ITEMS` (Paragraph, H1, H2, Quote) already diverge: the context menu silently lacks H3 and H4. The list-toggle command logic is also copied in both.

C6. compat has two answers to "is this an object type." `isObjectNodeType(type, registry)` (`compat.ts:901`) is registry-driven, but `isBuiltInObjectCompatType(type)` (`:905`, used at `:869`) re-hardcodes code-block/media/post-ref/embed/table-of-contents. A registered custom object passes one check and fails the other, so round-trip can diverge for third-party nodes.

C7. `view/table-operations.ts` is misfiled: 1,324 lines, pure model, no React, imports only `../core`, yet it lives in the view layer. It belongs in core.

C8. `payload-import.ts` is a third dialect adapter with no SPI reuse. It hardcodes a type switch (upload, youtube, horizontalrule, list, table, code) and a registered custom node can't teach it to map itself.

(Dropped from the earlier draft: the "table needs a feature folder" complaint. The repo groups by role, not feature: `view/nodes/` holds every node view, `view/controllers/` holds hooks, `core/commands/` and `core/store/` are the only core subfolders. `nodes/table.tsx` already sits with `callout.tsx` and `list.tsx`. A `view/table/` feature folder would be the first such divergence, so the only real relocation is C7.)

## Decisions locked in this session

- Table home: the two framework-free files go to a new `core/table/` subfolder (consistent with `core/commands/`, `core/store/`): `core/table.ts` becomes `core/table/definitions.ts`, and `view/table-operations.ts` moves to `core/table/operations.ts`. The three React files stay in `view/` under the existing role-based layout (`nodes/table.tsx` stays; the two overlays register through the new `renderOverlay` slot). `core/` is framework-free and worker-safe (it runs `core/bake.worker.ts`), so the React files cannot move there.
- spike: keep `src/spike/` as is. It backs 2 stories (`engine-input`, `engine-flow`); no removal.
- legacy: do not delete. Extract it to its own package, `packages/editor-legacy`, and shed Lexical from the owned package. Tracked separately from the SPI epic (see the Legacy extraction track).

## The epic — every SPI/cleanup fix, nothing deferred

One workstream list for the owned-model engine. Each item maps to a finding; all ship. Each carries a seam (shape + call sites + done-when) so intent survives context loss; the deep per-SPI design graduates to a `docs/0XX` doc when the workstream starts, per the project's SPI-first convention (lock the public shape before internals).

- W1. renderOverlay slot (C4). Add `renderOverlay?(args: { store; rootRef }): ReactNode` to `StructuralNodeView` and `NodeView`; add a `listOverlayViews()` enumerator in `structural-view.ts`/`node-view.ts`; `react-view.tsx` maps it once and mounts in both branches (non-virtual ~`:334-355`, virtual ~`:393-414`), replacing the hardcoded `<TableControls/>` + `<TableInteractions/>` (`:49-50, 341-342, 400-401`). The table's structural view returns `<><TableControls/><TableInteractions/></>` from the one slot (two overlays, one type). Done when: react-view imports neither table file, both branches mount via the enumeration, table stories/tests pass.
- W2. table model half → `core/table/` (C7). DONE. `git mv` of `core/table.ts` → `core/table/definitions.ts` and `view/table-operations.ts` → `core/table/operations.ts` (both R100, history preserved). Internal import fixups: `definitions.ts` (`./model`→`../model`, `./structural-registry`→`../structural-registry`); `operations.ts` (`../core` split into `../model` + `import type ... from "../store"`). Importers repointed: definitions in `structural-registry.ts:45` (the only one; `payload-import.ts`/`nodes/index.ts` were false positives — `nodes/index.ts "./table"` is the view); operations in `table-controls.tsx`, `table-interactions.tsx`, `text-block.tsx`, `tests/editor/engine-table.test.ts`. Chose deep imports (`../core/table/operations`) over a core-barrel re-export to avoid adding ~30 table symbols to `core/index.ts`; the editor already deep-imports core (the bake worker). The SPI guardrail test reads a fixed 6-file allow-list, so the moved files do not trip it. Verified: `pnpm check` green, 818/818 tests pass.
- W3. finish list/quote/listitem migration (C1). Add `StructuralDefinition`s beside `calloutStructuralDefinition()` in `core/structural-registry.ts` and into `BUILT_IN_STRUCTURAL_DEFINITIONS:174`; register their `StructuralNodeView`s in `nodes/index.ts` (quote uses the default container today); then delete the dead hardcoded branches in `compat.ts` (~286-389, 469, 509, 769-866), `resting-document.tsx:186-224`, `commands/shared.ts` (201, 230, 469-520), `commands/text.ts:218,253`, `editor-store.ts:1176`, `selection-overlay.tsx:647-651`, `styles.ts:386`. Done when: a grep for these type names in generic code returns only the registry/model definitions, generic `insert-structural` works for each, compat round-trip tests pass.
- W3-note. `listitem` is both a `TextLeafType` (flat list, docs/018 §2.10) and a structural type (nested); the migration keeps the flat-leaf render path and moves only the structural-container knowledge behind the SPI. Settle this shared identity with W5 in the docs/0XX before coding.
- W4. registerMark SPI (C2). Define `MarkDefinition { kind; element; nestingRank; attrs?; toolbar? }` plus `registerMark` / `listMarks`; move `MARK_NESTING_ORDER` and `wrapMark` (`mark-render.tsx`) and the bake comment/glossary branch (`bake.ts:144`) behind it. Scope: the 6 format marks register as toolbar toggles, the attr-bearing marks (link, comment, glossary) register as render-only (a `toolbar` flag gates which surface in W6); `TextMarkKind` stays the persisted union in `model.ts:164` because compat needs the literals, but render/toolbar wiring derives from the registry. Done when: adding a mark touches only its registration and `mark-render` has no per-kind switch for registered marks.
- W5. registerBlockType SPI (C3). Define `BlockTypeDefinition { type; tag?; label; icon; ariaRole; toolbar?; markdownPrefix? }` for text leaves; move `BLOCK_TYPES` (`editor-chrome.tsx:50`), `BLOCK_ITEMS` (`context-menu.tsx:41`), the `markdown-shortcuts.ts:84-94` block table, `bake.ts:141` heading-to-TOC, and `selection-overlay.tsx:647` aria role behind it. The block-type registry owns the text-leaf/toolbar side; the structural SPI (W3) owns the container side; both reference one shared `listitem` identity (see W3-note). Done when: adding a heading level or block type is one registration.
- W6. dedup toolbar + context-menu (C5). Replace `FORMAT_BUTTONS`/`FORMAT_ITEMS` and `BLOCK_TYPES`/`BLOCK_ITEMS` with `listMarks().filter(toolbar)` and `listBlockTypes().filter(toolbar)`; share one list-toggle command builder. Done when: no duplicated literal arrays across `editor-chrome.tsx` and `context-menu.tsx`, and the context menu shows H3/H4 (drift fixed).
- W7. compat object single-source (C6). Delete `isBuiltInObjectCompatType` (`compat.ts:905`) and route its caller (`:869`) through `isObjectNodeType(type, registry)`. Done when: one registry-driven check, and a registered custom object round-trips identically to a built-in.
- W8. payload per-node hook (C8). Add optional `fromPayload?(node, ctx)` to `NodeDefinition` / `StructuralDefinition`; `payload-import.ts` dispatches to a registered node's hook before its hardcoded fallback switch. Done when: a registered custom node maps its own Payload dialect type without editing `payload-import.ts`.

## Execution sequence — run in this order

Do the relocation before the semantic edits so later diffs land in final locations, then the small proven slice, then the big migration, then the new SPIs and their consumers, then the adapter hook. Run `pnpm check` at the end of every phase (format, lint, dup gate, typecheck, test, build).

1. Phase 0, relocation (W2). DONE (2026-06-21). Created `core/table/`, moved definitions + operations, fixed imports, `pnpm check` green, 818/818 tests pass. No behavior change; pre-positions every later table edit.
2. Phase 1, the overlay slice (W1). Add `renderOverlay`, register the two table overlays, strip them out of react-view. Smallest architectural slice, and it directly answers the original table-leak question.
3. Phase 2, finish the structural migration (W3). list, quote, listitem to core definitions; delete their hardcoded branches. Largest debt payoff; isolate it in its own phase because it touches compat and commands.
4. Phase 3, the missing SPIs (W4, W5). registerMark, then registerBlockType. New capability, no consumer rewrite yet.
5. Phase 4, dedup the consumers (W6, W7). Point toolbar and context-menu at the W4/W5 registries; collapse the compat object check. The drift (missing H3/H4) dies here.
6. Phase 5, the adapter hook (W8). Add the payload per-node `fromPayload`.

Next action: Phase 1 (W1, the `renderOverlay` slot). Phase 0 is complete.

## Legacy extraction track — separate, gated, large

Goal: move `src/legacy/` (59 files / 11,442 lines, the Lexical editor) out of `@quanghuy1242/idco-editor` into a new package `packages/editor-legacy`, so the owned engine stops carrying Lexical. This is independent of the SPI epic and does not block it. Order it whenever, but it ends with a cross-repo release because it changes a published export.

Why it pays off: the whole Lexical dependency block in `packages/editor/package.json` (`@lexical/link`, `@lexical/list`, `@lexical/mark`, `@lexical/markdown`, `@lexical/react`, `@lexical/rich-text`, `@lexical/selection`, `@lexical/table`, `@lexical/utils`, `lexical`, all `0.45.0`) exists only for legacy. After extraction the owned package sheds all of them.

Steps:

1. Verify the cut line: confirm `src/legacy/` does not import from `src/core` or `src/view` (owned engine) and vice versa, and that `src/spike/` does not import legacy. If clean, the move is mechanical; if not, break the shared import first.
2. Scaffold `packages/editor-legacy`: `package.json` (name e.g. `@quanghuy1242/idco-editor-legacy`), the Lexical deps moved over, shared deps kept (`@quanghuy1242/idco-ui`, `react-aria-components`, the `react`/`react-dom` peers), `tsconfig`, build script mirroring the editor package.
3. Move `src/legacy/` to `packages/editor-legacy/src/`, and `src/legacy.ts` becomes the new package entry `src/index.ts`.
4. Repoint the ~18 test files that deep-import `../../packages/editor/src/legacy/...` to `../../packages/editor-legacy/src/...`. Repoint any legacy stories the same way.
5. Remove legacy from the owned package: delete the deprecated root re-exports in `packages/editor/src/index.ts:223-248`, delete the `./legacy` subpath from `packages/editor/package.json` exports, and drop the now-unused Lexical deps. Decide the consumer contract: either consumers import the new package directly, or keep `@quanghuy1242/idco-editor/legacy` as a thin re-export from the new package for one deprecation window.
6. Cross-repo release per AGENTS.md: `pnpm dev:link` in the consumer, prove `pnpm check`, bump every publishable `package.json` to the same version, tag, push, then `pnpm dev:unlink`.
