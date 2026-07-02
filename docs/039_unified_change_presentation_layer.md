# The Unified Change-Presentation Layer (Diff View + Woven Overlay Consolidation)

> Status: implementation-grade spec, decisions resolved, ready to build
>
> Date: 2026-07-02
>
> Scope:
>
> - `packages/reader/src/diff/**` (becomes the shared presentation library)
> - `packages/editor/src/view/overlays/review-change-indicator.tsx`, `packages/editor/src/view/render/ghost-block.tsx`, `packages/editor/src/view/review-cursor.ts`, `packages/editor/src/view/overlays/review-cursor-surface.tsx`, `packages/editor/src/view/render/review-context.ts`
> - `packages/editor/src/core/diff/**` (unchanged algorithm; one new derived index)
> - `packages/editor/src/core/registry/object-registry.ts` (the `renderDiff` seam)
> - `stories/engine-review-*.stories.tsx` (collapse to one end-to-end story)
>
> Source docs:
>
> - `docs/036_snapshot_diff_and_document_history_review.md` (the diff engine, the diff view, R6-A..I)
> - `docs/038_woven-overlay-design.md` (the woven overlay design, R6-J J0..J7)
>
> Related docs:
>
> - `docs/037_agentic_control_api.md` (the producer of proposals; `renderDiff` must not break the serializable summary an agent reads)
> - `docs/016_node_spi_and_pluggable_blocks.md` (the `NodeDefinition` object SPI that `renderDiff` extends)
> - `docs/028_reader_convergence_snapshot_native_dispatch.md` (the reader is server-safe; `renderDiff` stays RSC-safe)
>
> Assumptions:
>
> - The `SnapshotDiff` engine (`diffSnapshots`) is correct and stays the single source of "what changed"; this document changes presentation, not detection.
> - The editor already depends on the reader (`packages/editor/src/view/nodes/table/table.tsx` and six other files import `@quanghuy1242/idco-reader`), and the reader must never import the editor (`packages/reader/src/diff/types.ts:5`).

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 Relevant Files](#31-relevant-files)
  - [3.2 Current Behavior](#32-current-behavior)
  - [3.3 Current Problems](#33-current-problems)
- [4. Target Model](#4-target-model)
  - [4.1 The Reader Is The Shared Presentation Library](#41-the-reader-is-the-shared-presentation-library)
  - [4.2 One Renderer, Two Layouts](#42-one-renderer-two-layouts)
  - [4.3 Resting Signals, Reflow On Demand](#43-resting-signals-reflow-on-demand)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 Resolved Decisions](#51-resolved-decisions)
  - [5.2 Rejected Or Not-Needed Options](#52-rejected-or-not-needed-options)
- [6. The Shared Presentation Spec](#6-the-shared-presentation-spec)
  - [6.1 The Change Vocabulary And The tierOf Classifier](#61-the-change-vocabulary-and-the-tierof-classifier)
  - [6.2 The Three Shared Render Atoms](#62-the-three-shared-render-atoms)
  - [6.3 The Token And Shape Map](#63-the-token-and-shape-map)
- [7. The Presentation Rules](#7-the-presentation-rules)
  - [7.1 R-GI: The Global Change Indicator](#71-r-gi-the-global-change-indicator)
  - [7.2 R-NL: Status Is Color And Shape, Never A Redundant Text Label](#72-r-nl-status-is-color-and-shape-never-a-redundant-text-label)
  - [7.3 R-RO: Removed Content Is Read-Only, Struck, Never A Card](#73-r-ro-removed-content-is-read-only-struck-never-a-card)
  - [7.4 R-SB: Side-By-Side Maps Base Line To Target Line](#74-r-sb-side-by-side-maps-base-line-to-target-line)
  - [7.5 R-T1: Woven Text Is Editable-Insert Plus Inert-Delete](#75-r-t1-woven-text-is-editable-insert-plus-inert-delete)
  - [7.6 R-RG: The Element Ring Is The Only Non-Gutter Marker](#76-r-rg-the-element-ring-is-the-only-non-gutter-marker)
  - [7.7 R-EX: The Inline-Expand Band](#77-r-ex-the-inline-expand-band)
- [8. The Per-Node Diff SPI](#8-the-per-node-diff-spi)
- [9. Woven Overlay Redesign](#9-woven-overlay-redesign)
- [10. Diff View Changes](#10-diff-view-changes)
- [11. Diff Engine And Snapshot Changes](#11-diff-engine-and-snapshot-changes)
- [12. 037 Integration](#12-037-integration)
- [13. Migration And Rollout](#13-migration-and-rollout)
- [14. Edge Cases And Failure Modes](#14-edge-cases-and-failure-modes)
- [15. Implementation Backlog](#15-implementation-backlog)
- [16. Future Backlog](#16-future-backlog)
- [17. Definition Of Done](#17-definition-of-done)
- [18. Final Model](#18-final-model)

## 1. Goal

Make the diff view (`packages/reader/src/diff/diff-view.tsx`) and the woven inline overlay (the `packages/editor/src/view` review stack) render the same change through one shared presentation library, so a reviewer sees a consistent, legible result on both surfaces and no change class is illegible on either. Three concrete outcomes:

1. A text edit is visible as red/green track changes in the live editor, not only as a gutter bar plus a "9 characters inserted" count.
2. Every "this block changed" signal uses one indicator (the left gutter bar), with one status color system, on both surfaces. A removed block stops being a bespoke red card, and the vestigial deletion tick is deleted.
3. An opaque or custom node (code block source, mermaid, canvas, calc) shows a real diff of its own kind through a per-node SPI, on both surfaces, instead of a truncated `code: const x =…  →  const y =…` string.

Non-goals for this document: changing the `diffSnapshots` algorithm, collaboration beyond single-proposal review (`docs/038 §11`), and the native/Rust surface (`docs/031`, `docs/035`) which will consume the same vocabulary later.

Short version: the reader owns how a change looks; the woven overlay owns where a change is anchored, how it is navigated, and the editable half of a text change. Everything visual has exactly one implementation.

## 2. System Summary

Three layers are involved and only the middle one is rebuilt here.

- The engine (`packages/editor/src/core/diff/**`): `diffSnapshots(base, target)` returns a `SnapshotDiff` (`packages/editor/src/core/diff/types.ts`) with a recursive `blocks: BlockDiff[]` in merged-spine order, plus `settingsChanged`, `collections`, and `stats`. This layer is pure (it imports model types and `isRecord`, never the store) and stays as-is.
- The presentation layer (this document): today it exists twice. The reader `DiffView` is a mature ~1400-line track-changes renderer. The woven overlay is a separate set of markers and ghosts in the editor that never implemented text track-changes and invented its own marker vocabulary.
- The two surfaces: the read-only reader page (`<DiffView>`) and the live editor review mode (`ReviewCursorSurface` + the passive markers + `GhostBlock`).

The package graph is the constraint that decides the whole design. The editor depends on the reader; the reader must not depend on the editor (`packages/reader/src/diff/types.ts:5`). The reader mirrors the engine's diff types as structural supertypes (`NodeId → string`, `JsonValue → unknown`), so `diffSnapshots`' output is assignable to `ReaderSnapshotDiff` with no cast. Any code that both surfaces share must live at or below the reader, and the editor consumes it upward.

## 3. Current-State Findings

### 3.1 Relevant Files

- `packages/editor/src/core/diff/types.ts` — the `SnapshotDiff` / `BlockDiff` / `TextLeafDiff` / `TextRunDiff` / `MarkChange` / `AttrDiff` / `ObjectDiff` vocabulary. Complete and correct.
- `packages/reader/src/diff/diff-view.tsx` — the diff view. `renderRunSpans` (line 298) is the track-changes engine (insert = underline, delete = strikethrough, per-run marks, plus the text-alignment fallback `fallbackRuns`). `renderChangeDetail` (line 432) renders attr / mark / object-field rows. `card` + `StatusTag` (lines 108, 129) render the change card with a text status label. `buildRows` (line 1249) aligns side-by-side rows.
- `packages/reader/src/diff/types.ts` — the reader-local mirror of the diff shapes, and the stated boundary (`editor depends on reader, not the reverse`).
- `packages/editor/src/view/overlays/review-change-indicator.tsx` — the passive marker layer. `changedElements` (line 142) routes a top-level change to a gutter `bar` and a nested attr/object change to a `ring`; `deletionAnchors` (line 188) computes the red tick on a removed block's surviving neighbor; `REVIEW_INDICATOR_CSS` (line 440) is the bar + ring + tick stylesheet.
- `packages/editor/src/view/render/ghost-block.tsx` — the removed-block render. `GHOST_BOX` gives it a red `borderInlineStart`, a background wash, and an uppercase "REMOVED {type}" badge.
- `packages/editor/src/view/review-cursor.ts` — `reviewEntryDetail` (line 103), the one-line summary shown in the surface; `reviewCursorEntries` (line 153), the top-level cursor stops.
- `packages/editor/src/view/overlays/review-cursor-surface.tsx` — the floating control. `STATUS_CHIP` + `STATUS_LABEL` (lines 55, 88) render the text status word ("Edited", "Removed").
- `packages/editor/src/core/registry/object-registry.ts:494` — the code block's `diffData` seam, returning `{path:"code", base:<whole source>, target:<whole source>}`.
- `stories/engine-diff.stories.tsx`, `engine-diff-detail.stories.tsx`, `engine-review-ghost.stories.tsx`, `engine-review-decoration.stories.tsx`, `engine-review-cursor.stories.tsx`, `engine-review-changes.stories.tsx`, `engine-review-mode.stories.tsx` — seven stories, one per J-phase, no end-to-end flow.

### 3.2 Current Behavior

The reader `DiffView` renders a change as a bordered card with a colored left edge, a text status tag, inline track-changes for text, detail rows for invisibles, and a side-by-side mode with row alignment. It is read-only and reflows freely.

The woven overlay renders the proposed document live. A changed top-level block gets a blue gutter bar (`REVIEW_INDICATOR_CSS`, `::after` in the left inset). A nested attr/object change gets a two-tone ring. A removed block renders as a `GhostBlock` (its own red-bordered wash box with a badge) and also stamps a red tick on its surviving neighbor. The `ReviewCursorSurface` floats beside the cursor block with the one-line detail and accept/reject.

### 3.3 Current Problems

- P1 — Text track-changes is missing in the live editor. `changedElements` excludes text runs (`review-change-indicator.tsx:133`, "T1 woven track-changes → J6"), and J6 shipped the plumbing (undo, save gate, focus) but not the visual. A proposal's inserted text is applied into the store and renders as ordinary black glyphs; the only signal is the gutter bar plus a count. A reviewer cannot see what changed. The reader already has the renderer (`renderRunSpans`); the editor does not use it.
- P2 — Three visual languages for one concept. "This block differs" is a thin blue gutter bar for a change, a full red card baked into `GhostBlock` for a removal, and a red neighbor tick for the same removal. The gutter bar sits 8px outside the block; the ghost border sits on the block's own edge. They do not match, and `docs/038 §1–§2` forbids cards in the woven surface, which the ghost box violates.
- P3 — The deletion tick is redundant. `deletionAnchors` dates to R6-I, when removed blocks were not rendered and a tick was the only hint. J2 now renders the whole ghost in place, so the tick is a second signal for the same removal ("the little tick growing to cover the whole block").
- P4 — The ring cannot carry a T2 change. A re-colored cell shows a ring that says "something changed here" but never `fill: red → green`; the before state is gone. The reader `renderChangeDetail` shows exactly that transition. For invisible changes the woven overlay is strictly less legible, and the only recovery today is a per-top-level-block one-line chip.
- P5 — Opaque and custom nodes get a truncated string, not a diff. The code block's `diffData` returns the whole source on both sides; `renderChangeDetail` runs it through `fmtVal`, which truncates at 48 characters. There is no line diff anywhere. A custom node without a `diffData` seam reports block-level `changed` with no fields, so the woven overlay shows a ring and "1 field changed" and the diff view shows "Changed" with no body.
- P6 — Seven scattered stories, no end-to-end demo. Each J-phase has its own isolated fixture; nothing shows the full agent-proposal review flow.

## 4. Target Model

### 4.1 The Reader Is The Shared Presentation Library

The reader becomes the single home for every change *visual*. The editor's woven overlay consumes those visuals upward. This is forced by the package graph (`editor → reader` is legal, `reader → editor` is not) and it is the right split anyway: the reader is already 90% of a presentation library (`renderRunSpans`, `renderChangeDetail`, `RICH_TEXT_DIFF_CSS`).

The reader owns and exports:

- `tierOf(...)` — the pure classifier that maps a change to a disclosure tier (§6.1).
- `partitionTextRuns(textLeafDiff)` — the pure run partition both surfaces render (§6.2).
- `<ChangeDetail block={...} />` — the read-only detail rows for invisibles (attr / mark / object-field), lifted out of `renderChangeDetail` as a reusable component.
- `<DiffView>` — the whole-document read-only surface, and the element-scoped surface the woven band embeds.
- The `getNodeDiffRenderer` resolver contract and the status token map plus CSS (§6.3, §8).

The editor's woven overlay owns only what is intrinsically live-surface:

- Anchoring every marker to a real `data-engine-block-id` element (§9).
- The resting-state markers: the gutter bar, the element ring, the ghost (§7).
- The review cursor and navigation (`review-cursor.ts`, `review-cursor-surface.tsx`).
- The editable half of a text change: it decorates its own live inserted runs and injects inert deleted runs, driven by the reader's partition (§7.5).
- The expand/collapse interaction for the inline band (§7.7).

All shared reader code is typed against the reader mirror supertypes. The editor passes its real `SnapshotDiff` into those functions with no cast, exactly as `<DiffView>` already accepts it.

### 4.2 One Renderer, Two Layouts

The diff view and the woven overlay stop being two renderers. They become two *layouts* over one renderer:

- The diff view layout reflows freely: cards, injected detail rows, side-by-side columns, context folding.
- The woven layout does not reflow at rest: gutter bar, ring, inline track-changes, ghost, floating chip, and an on-demand inline band.

"How does an insert look, a delete, a re-colored cell, a code diff" has exactly one answer, in the reader. "Where does it sit, how do you reach it" differs per layout.

### 4.3 Resting Signals, Reflow On Demand

The woven overlay supports every change class. The capability it lacked was an on-demand inline band, not a floating modal. The no-reflow rule only has to hold in the *resting* state, so typing never makes the document jump. A reviewer who explicitly expands a change to inspect it may reflow, the same way expanding a folded region reflows.

- Resting state: zero-reflow markers (bar, ring, inline track-changes runs, ghost). You can type.
- Expanded state (reviewer-triggered): an inline band renders `<DiffView embedStyles={false}>` scoped to that one element, pushing siblings down, collapsing when the cursor leaves or the change resolves.

This is what serves realtime review against an agent: the surface stays live, accept/reject mutates in place, the agent can stream more changes, and the reviewer reaches diff-view fidelity without leaving the document.

## 5. Architecture Decisions

### 5.1 Resolved Decisions

- D1 — The reader is the shared presentation library; the editor consumes it. Rationale: the only legal shared home given `editor → reader`, and the reader already holds the renderers. (§4.1)
- D2 — The woven overlay supports every tier, via resting markers plus an on-demand inline band, not "map only". Rationale: the no-reflow rule is a resting-state rule; explicit expansion may reflow. (§4.3)
- D3 — `renderDiff` is injected, not imported. The reader takes a `getNodeDiffRenderer(type)` resolver prop; the function is defined on the editor's `NodeDefinition` next to `diffData`; the consumer wires the resolver into `<DiffView>`. Rationale: the reader cannot reach the editor's registry, and a product's node renderers are product code. This mirrors the existing `DiffOptions.getNodeDefinition` injection into `diffSnapshots`. (§8)
- D4 — The woven inline band imports the reader's `<DiffView>` directly. Rationale: `editor → reader` is already used seven times; a framework component is safe to import, and forcing every host to wire a band renderer is friction the injected node resolver already covers. The distinction: framework component imported, product node renderers injected. (§7.7)
- D5 — Tier by disclosure weight: a one-line invisible (attr, single object field) uses the floating chip; an opaque or complex change (code source, custom node, a structured attr like `colWidths`) uses the inline band. Rationale: a one-liner does not justify a reflow; a code diff does. (§6.1, §7.7)
- D6 — Status is carried by the indicator color and the content shape, never by a redundant text label. Drop "REMOVED"/"EDITED"/"ADDED" words from the ghost badge, the diff-view `StatusTag`, and the cursor surface chip. Keep an icon and a visually-hidden label for assistive tech. Rationale: the left indicator color already encodes status; a word repeats it. (§7.2)
- D7 — One block-level indicator: the gutter bar, status-hued, shared by both surfaces. The diff view card's left color edge and the woven gutter bar are the same token. A removed block gets a red bar, not a card. (§7.1)
- D8 — Delete `deletionAnchors` and its tick CSS. The rendered ghost with its own red bar is the removal's signal. (§7.3, §9)
- D9 — `GhostBlock` becomes minimal and read-only: inert struck content plus the red gutter bar from the passive layer, no border, no wash, no badge. (§7.3, §9)

### 5.2 Rejected Or Not-Needed Options

- Hoist `core/diff` below the reader and delete the reader mirror. Not needed, and rejected as unnecessary risk. The mirror already gives a shared type surface: the engine's readonly diff is assignable to the reader supertypes with no cast, so every shared reader function can accept the editor's real diff directly. Killing the mirror would require moving the whole model type layer (`packages/editor/src/core/model`) down a package, a large refactor that buys nothing this design needs. The mirror stays as the seam, not as debt. This resolves the "do it all here vs defer" question by showing the hoist is not part of the work at all.
- A new `@idco/diff-present` package. Rejected: it would sit below the reader and re-import the reader's block renderers to draw anything, which is circular in spirit. The reader is that package already.
- Keep `renderInlineDiff` as a *live-weave* seam (an object weaving its own diff into the editable surface, the seam `docs/038 §6` dropped). Rejected for the same reason `docs/038` dropped it: a code diff belongs in a read-only surface, not smeared into a live Prism editor. `renderDiff` is read-only and is used identically by the diff-view card and the woven band. One seam, read-only, two consumers.
- A per-block floating detail modal for T3. Rejected in favor of the inline band (D5): a modal detaches the detail from the spot and blocks the surrounding text; the band keeps context and stays live.

## 6. The Shared Presentation Spec

### 6.1 The Change Vocabulary And The tierOf Classifier

Every change resolves to one of four disclosure tiers through a pure function the reader exports:

```ts
// packages/reader/src/diff/vocabulary.ts
export type DisclosureTier = "woven" | "marked" | "band" | "pane";

export type ChangeKind =
  | "text.insert" | "text.delete"
  | "mark.add" | "mark.remove" | "mark.change"
  | "attr.block" | "attr.element"
  | "object.field" | "object.opaque"
  | "block.add" | "block.remove" | "block.move"
  | "child.add" | "child.remove" | "child.move"
  | "collection" | "settings";

// `getRenderer` lets a node override the default tier for its own opaque changes
// (a code block routes its text change to `band`, not `woven`).
export function tierOf(
  kind: ChangeKind,
  nodeType: string | undefined,
  getRenderer?: (type: string) => NodeDiffRenderer | undefined,
): DisclosureTier;
```

Tier is a property of `(kind × nodeType)`. The default table below is the contract; a node type overrides only its own opaque path by supplying a `renderDiff` (§8), which promotes `object.field`/`object.opaque` and its inner `text.*` to `band`.

| Change kind | Anchor | Default tier | Woven at rest | Diff view | Node override |
| --- | --- | --- | --- | --- | --- |
| `text.insert` | range | woven | editable run: wash + underline | `rt-diff-ins` span | code block → band |
| `text.delete` | range | woven | inert struck ghost span, inline | `rt-diff-del` span | code block → band |
| `mark.add` | range | woven | the mark itself renders (bold shows bold) | run + mark | — |
| `mark.remove` | range | marked | dotted underline on the run + chip | `rt-diff-detail` row | — |
| `mark.change` (link href, comment thread) | range | marked | dotted underline + chip (`old → new` href) | detail row | — |
| `attr.block` (align, indent, heading level) | block | marked | gutter bar + chip | detail row | — |
| `attr.element` (cell fill, `colWidths`) | element | marked | ring + chip; structured value → band | detail row / re-color | array/object value → band |
| `object.field` (code `language`, image `alt`) | element | marked | ring + chip | detail row | → band |
| `object.opaque` / custom (mermaid, canvas, calc, code `source`) | element | band | ring + inline-expand `<DiffView>` via `renderDiff` | card body = `renderDiff` | required |
| `block.add` | block | woven | real green content + green bar | card | — |
| `block.remove` | block | woven | inert ghost (struck) + red bar | card, struck body | — |
| `block.move` | block | marked | amber bar + "from ¶N" chip | two-ended card | — |
| `child.add` / `child.remove` / `child.move` (row, item, cell) | container | woven | green/ghost row spliced in place, bar on container | nested inline | — |
| `collection` (glossary, bibliography) | none | pane | Changes pane row | not in body | — |
| `settings` (document theme) | none | pane | Changes pane row | not in body | — |

The vocabulary is a superset of CriticMarkup's five verbs and CKEditor 5's suggestion types (insertion, deletion, attribute, format, plus a generic type for widgets). The `object.opaque` row is the generic-widget escape hatch every serious track-changes system needs, and `renderDiff` is how a node fills it.

### 6.2 The Three Shared Render Atoms

Only three pieces of rendering are genuinely shared. Everything else is per-layout arrangement.

Atom 1 — the text run partition (pure, reader-owned). Given a `TextLeafDiff`, return the ordered runs tagged `keep`/`insert`/`delete` with their character-id ranges. This is the only shared T1 piece, because the *span* rendering must differ: the diff view renders a read-only tinted span, the woven overlay decorates its own editable inserted run and injects an inert deleted run.

```ts
// packages/reader/src/diff/runs.ts
export type RunSlice = {
  readonly op: "keep" | "insert" | "delete";
  readonly text: string;
  readonly ids?: readonly CharId[]; // present on the identity path; drives store lookup in the editor
  readonly markChanged: boolean;    // this keep-run sits under a changed mark → dotted overlay
};
export function partitionTextRuns(text: ReaderTextLeafDiff): RunSlice[];
```

The diff view's `renderRunSpans` is refactored to call `partitionTextRuns` and then render each slice as a read-only span. The editor's new T1 decorator calls the same `partitionTextRuns`, uses `RunSlice.ids` to find each run in the live leaf, and renders the editable/ghost pair (§7.5).

Atom 2 — the change-detail rows (read-only React, reader-owned). Lift `renderChangeDetail` (`diff-view.tsx:432`) into an exported component:

```tsx
// packages/reader/src/diff/change-detail.tsx
export function ChangeDetail(props: {
  readonly block: ReaderBlockDiff;
  readonly base: ReaderSnapshot;
  readonly target: ReaderSnapshot;
}): ReactNode; // attr rows, mark-change rows (incl. removals), object-field rows
```

The diff view keeps rendering it inside the card; the woven chip renders the *same* component for the change under the cursor, so `fill: red → green` shows in the chip verbatim. This closes P4 without a new renderer.

Atom 3 — the per-node diff renderer (read-only React, injected). One resolver, one component (§8). Used identically by the diff-view card body and the woven band.

### 6.3 The Token And Shape Map

Status is carried by shape first, color second (`docs/038 §9`). The map is one exported table both surfaces read:

| Status | Semantic token | Bar / card edge | Content shape |
| --- | --- | --- | --- |
| added | `--color-success` | green bar | green wash on the content |
| removed | `--color-error` | red bar | strikethrough, read-only |
| changed | `--color-info` | blue bar | track-changes runs / ring |
| moved | `--color-warning` | amber bar | "from ¶N", no content tint |

Shapes: `underline + wash` = insert, `strikethrough` = delete, `ring (two-tone)` = element attr/object change, `bar` = block-level change, `dotted underline` = a ranged invisible (mark removed). Color is a secondary, collision-aware channel: the gutter bar sits in the left inset outside the prose so it may carry a hue safely; an element ring sits on content so it uses the two-tone `focusRing` contrast, not a single hue. The reader exports the token table and the shared `RICH_TEXT_DIFF_CSS`; the editor injects the same stylesheet plus a thin woven-only rule file for the anchored markers.

## 7. The Presentation Rules

These are the load-bearing rules an implementer follows. Each states what both surfaces do, so nothing diverges again.

### 7.1 R-GI: The Global Change Indicator

There is one block-level change indicator: a status-hued left bar. It is the same visual token on both surfaces.

- Woven: the `::after` gutter bar in the left inset (today's `REVIEW_INDICATOR_CSS`), status-hued.
- Diff view: the card's left color edge (`rt-diff-card-<status>`) is the same bar in the same status color. Reuse the token; do not keep a second palette.

```
Woven (live editor)                    Diff view (read-only)
┌ bar in the inset, outside prose      ┌ card edge bar, same color
│                                      │ ┌───────────────────────────┐
▎ Paragraph 2 with an edit …           ▎ │ Paragraph 2 with an edit … │
│                                      │ └───────────────────────────┘
  blue = changed, green = added,         same colors, same meaning
  red = removed, amber = moved
```

The bar is the breadcrumb "something in this block differs" at any block level. A nested element that the bar cannot reach (a table cell) uses the ring (R-RG), which is the only exception.

### 7.2 R-NL: Status Is Color And Shape, Never A Redundant Text Label

The left indicator color plus the content shape already encode status. Do not print the status word.

- Delete the ghost badge "REMOVED PARAGRAPH" (`ghost-block.tsx` `GHOST_BADGE`). The red bar plus strikethrough says removed.
- Delete the diff-view `StatusTag` label text ("Edited", "Removed", "Added", "Moved") from `card`. Keep the small status icon and add a visually-hidden `<span class="sr-only">` for assistive tech.
- Delete the cursor surface `STATUS_CHIP` word (`review-cursor-surface.tsx`). The bar under the cursor and the detail line carry it.

Keep the *detail*, which is not the status word: "3 characters inserted", `fill: red → green`, "from ¶5". Detail says what changed; the indicator says how.

```
Before                                  After
┌─────────────────────────────┐         ┌─────────────────────────────┐
│ ✎ EDITED   3 chars inserted │   →     │ ✎  3 characters inserted    │   (bar is blue)
└─────────────────────────────┘         └─────────────────────────────┘

REMOVED PARAGRAPH                        ▎ Paragraph 14 body text …        (bar is red,
Paragraph 14 body text …  (struck)         (struck, read-only)              text struck)
```

Accessibility: the icon carries `aria-hidden`, and each change element carries an `aria-label` or an `sr-only` span with the full status ("Removed paragraph", "Edited, 3 characters inserted"), so dropping the visible word does not drop the announced one.

### 7.3 R-RO: Removed Content Is Read-Only, Struck, Never A Card

Removed content is always inert and always struck, on both surfaces, and it never wears a card, border, wash, or badge.

- Woven: `GhostBlock` renders the base node's content struck, `contentEditable={false}`, pointer and selection off, `aria-hidden`, plus a hidden AX label. The passive layer paints its red gutter bar (R-GI). No `GHOST_BOX` border, no wash, no badge.
- Diff view: a removed block renders struck (`rt-diff-struck`) inside its card, whose edge bar is red. A removed object or container that cannot be struck is dimmed (`rt-diff-dim`), still no separate "removed" word.
- The caret skips a woven ghost like an atomic widget; the per-block EditContext never binds to it (`docs/038 §3`). This is unchanged behavior; only the styling collapses to the shared language.

The deletion tick is gone (D8): the rendered ghost with its red bar is the signal, so nothing rides the surviving neighbor.

### 7.4 R-SB: Side-By-Side Maps Base Line To Target Line

Side-by-side must let the eye trace a line from base to target. Matched blocks share a row; an unmatched block leaves a gap opposite it; a move shows the block on both sides at its two positions.

- Anchors (`unchanged`, `changed`) share a row on both columns (`buildRows`, `isAnchor` at `diff-view.tsx:1246`).
- A removed block occupies its base row on the left; the right column shows a `rt-diff-gap` opposite it. An added block occupies its target row on the right; the left shows a gap.
- A moved block renders real on both sides: at its base row on the left and its target row on the right, each with a gap opposite, so the amber bar traces the travel.
- No status word is printed in a cell (R-NL); the row's bar color and the gap opposite carry add/remove, and the two-ended placement carries move.

```
        Base (old)                     Target (new)
 ¶1  ▎ unchanged line ───────────────  ▎ unchanged line          (anchor, shared row)
 ¶2  ▎ old wording (struck)            ▎ new wording (wash+ul)    (changed, shared row)
 ¶3  ▎ removed line (red, struck)      ░ (gap)                    (removed → gap opposite)
 ¶4  ░ (gap)                           ▎ added line (green)       (added → gap opposite)
 ¶5  ▎ moved block (amber) ──────┐     ░ (gap)                    (move: base row)
                                 └───▶ ▎ moved block (amber)      (move: target row)
```

This is mostly the current `buildRows` behavior; the rule pins it so a future edit does not drop the gap alignment, and R-NL removes the per-cell status word so the columns read as parallel prose.

### 7.5 R-T1: Woven Text Is Editable-Insert Plus Inert-Delete

In the live editor a text change is real track changes, not a count. The inserted characters are already in the store (the proposal was applied optimistically, `origin:"suggested"`); the deleted characters are not.

- Insert: the woven decorator finds the inserted run in the live leaf by `RunSlice.ids` and decorates it with wash + underline. It stays editable, so a reviewer can tweak a suggestion and the tweak folds into the proposal (`docs/038 §3`, live-proposed).
- Delete: the woven decorator injects an inert span carrying the base run's text, struck, `contentEditable={false}`, so the caret steps over it. This is a character-level ghost, the same read-only rule as a block ghost (R-RO).
- Both are positioned by the shared `partitionTextRuns` output; only the span construction is editor-specific.

```
Store text (live):   The quick brown fox
Proposal:            insert "very " before "quick", delete "brown "
Woven render:        The ┃very ┃quick ~~brown ~~fox
                         └wash+underline (editable)   └struck inert ghost (read-only)
```

Mechanism (the load-bearing part, because a wrong version corrupts the caret). A text leaf renders through `renderLeafMarks(node)` (`packages/editor/src/view/render/mark-render.tsx`) inside an EditContext host (`text-block.tsx`, the `<div role="textbox">`). The geometry that maps a model offset to a DOM position (`packages/editor/src/view/overlays/geometry.ts`, and `characterClientRects` / `offsetFromClientPoint` / `caretClientRect`) depends on one invariant, stated at the top of `mark-render.tsx`: the concatenation of the rendered text nodes, in document order, equals the leaf's full model text. The EditContext buffer is the store text (`ensureController` builds it from `current.content.text`). So the woven T1 decorator must preserve that invariant against the store text, and the two run kinds sit on opposite sides of it:

- Inserted run: it *is* in the store, so it stays a normal counted text node, wrapped like a mark. Render a review-aware variant of `renderLeafMarks` that intersects the mark segments with the run boundaries from `partitionTextRuns` and tags each inserted sub-segment with `data-engine-review-op="insert"` (wash + underline). This is geometry-neutral exactly as a `<strong>` is, because the wrapper still contains the same store characters.
- Deleted run: it is *not* in the store, so its ghost text must not be counted. Render it as an inert `<span data-engine-ghost-run contenteditable="false" aria-hidden="true">` carrying the base run's text, struck. Then `geometry.ts`'s text-node walk (and `characterClientRects`, `offsetFromClientPoint`, `caretClientRect`, `patchHostText`) must skip any node under `[data-engine-ghost-run]`, so "concat of *counted* text nodes == store text" still holds. This skip rule is the one new invariant; without it every caret and click past a deletion is off by the ghost's length.
- Fast-path gate: the typing fast path (`patchHostText` in `onTextUpdate`) writes a flat `textContent`, which would wipe the decorated spans. It is already disabled for a marked leaf (`leafHasMarks`, `text-block.tsx:144`). Generalize that gate to `leafHasMarks(node) || hasReviewDecoration(node)`, so a review-decorated leaf renders React-owned spans and re-renders from the model, exactly like a marked leaf. The inserted characters stay editable because they are real store text under an ordinary (styled) wrapper; only the ghost is inert.

Edge: `docs/038 §5.3` notes the canonical `replaceText` path can produce an id-less `removed` slice. When `RunSlice.ids` is absent, the decorator falls back to offset positioning within the leaf and does not attempt a cross-leaf move; this is the same weakest-identity-last ladder J1 already documents, surfaced as a decoration limit rather than a correctness one.

### 7.6 R-RG: The Element Ring Is The Only Non-Gutter Marker

A change on a nested element the gutter bar cannot reach (a table cell, an inline object) gets a two-tone ring, and the ring is the only marker besides the bar. The ring signals "an attr/object changed here"; the detail comes from the chip or the band.

- The ring is clickable and is the affordance to open detail: a click (or the review cursor landing on it) shows the `ChangeDetail` chip for a one-line change (D5) or expands the band for a structured/opaque one (R-EX).
- The ring uses the two-tone `focusRing` contrast (`review-change-indicator.tsx` current `RING_ATTR` CSS), so it survives a status-hued cell fill and the object hover chrome. This is kept; what changes is that the ring now leads somewhere (the chip/band) instead of being terminal.
- Wiring: do not attach a listener per ring (a ring is a `data-*` attribute, not a component). Delegate one `click` listener on the review root; on a hit, `event.target.closest('[data-engine-review-ring]')` gives the element, its `data-engine-block-id` gives the id, `blockDiffIndex(diff).get(id)` gives the `BlockDiff` (§11), and `tierOf` decides chip vs band. The delegated listener also survives virtualization remounts, the same reason the passive markers use `data-*` + one observer.

### 7.7 R-EX: The Inline-Expand Band

An opaque or complex change expands, on demand, into an inline band that renders the reader `<DiffView>` scoped to that one element. The band is the woven layout's equivalent of the diff view's card body.

- Collapsed (resting): ring or bar only, no reflow.
- Expanded (reviewer opens it): an inline block below the element renders `<DiffView diff={scopedDiff} embedStyles={false} showStats={false} getNodeDiffRenderer={...} />`. Siblings push down.
- Collapse on: cursor leaves the element, the change is accepted/rejected, or the reviewer toggles it.
- The host injects `RICH_TEXT_DIFF_CSS` once; every band sets `embedStyles={false}` (the mechanism `diff-view.tsx:71` already documents for banding).

Constructing `scopedDiff` (no new engine call). The full `SnapshotDiff` already carries `base` and `target` and the recursive `blocks` tree; a scoped diff is a projection, not a re-diff. Given the element's id, resolve its `BlockDiff` with `blockDiffIndex(diff).get(id)` (§11) and wrap it:

```ts
const scopedDiff: ReaderSnapshotDiff = {
  base: diff.base, target: diff.target, // carried; DiffView resolves nodes from them
  blocks: [blockDiffIndex(diff).get(id)!],
  settingsChanged: false, collections: [],
  stats: statsFor([blockDiffIndex(diff).get(id)!]), // one-block recount, or reuse diff.stats when scoping the whole doc
};
```

`<DiffView>` renders that one block through its normal card path, so the band is the exact card body the whole-document diff view would show for this element, with no second renderer and no second diff pass.

```
Resting:                               Expanded (clicked the ring):
                                       ▎ ```                     (band: scoped DiffView)
▢ const x = 1;   ◯ring                 ▎  1 - const x = 1;
                                       ▎  1 + const y = 2;
                                       ▎ ``` language: js → ts
  next paragraph …                       next paragraph … (pushed down)
```

## 8. The Per-Node Diff SPI

Add one read-only, injected seam so opaque and custom nodes render a real diff of their own kind. It extends the object SPI (`docs/016`) next to the existing `diffData`.

```ts
// packages/editor/src/core/registry/object-registry.ts (NodeDefinition)
export type NodeDiffRenderer = (args: {
  readonly base: JsonValue;
  readonly target: JsonValue;
  readonly status: "added" | "removed" | "changed";
}) => ReactNode; // read-only, RSC-safe: no client hooks, no store access

interface NodeDefinition {
  // Pure, serializable summary — unchanged. Feeds the diff, the chip, and a 037 agent
  // across a process boundary. Keep it.
  diffData?(base: JsonValue, target: JsonValue): readonly ObjectFieldChange[];
  // New: the rich visual detail. Read-only. Consumed identically by the diff-view card
  // body and the woven band. Absent → fall back to the `diffData` field rows.
  renderDiff?: NodeDiffRenderer;
}
```

Wiring (D3, D4): the reader's `<DiffView>` and the woven band take a `getNodeDiffRenderer(type)` prop. The consumer builds it from the editor registry once and passes it to both. The reader never imports the editor; it calls the injected function. `diffData` stays the serializable summary; `renderDiff` is the visual. A node ships either, both, or neither:

- Neither: block-level "changed", no body (today's behavior).
- `diffData` only: the field rows (`language: js → ts`).
- `renderDiff` only: the rich visual, and the summary falls back to "content changed".
- Both: rows for the chip summary, the rich visual for the band and card.

Reference implementations to ship in this document's scope:

- Code block (`object-registry.ts:494`): keep `diffData` for the `language` field summary; add `renderDiff` that splits `pieceTableText(base.code)` and `pieceTableText(target.code)` on `\n` and runs the line diff through the engine's existing `diffSequences<string>` (`packages/editor/src/core/diff/lcs.ts:43`, the same LCS the block diff uses), then renders a unified line diff (kept lines plain, `insert` green, `delete` struck) with the code block's existing syntax classes. Reuse `diffSequences`; do not add a second diff algorithm. The `code` field stops being a truncated string and becomes a real code diff (closes P5).
- Table: `renderDiff` renders the grid with changed cells re-colored and a `colWidths` row-count delta, so a structural table change reads as a table, not a JSON array. `attr.element` on a cell still uses the ring at rest and this band on expand.
- Media / embed / post-ref: `renderDiff` renders base vs target thumbnails side by side (`added`/`removed`/`changed`), using the reader's existing figure renderers.
- Custom nodes (mermaid, canvas, calc): documented contract, not shipped here. Mermaid renders base vs target baked SVG; calc (mini-table) renders a cell diff like the table; canvas renders base vs target raster. Each is `renderDiff` on that node's definition; the tier promotes to `band` automatically because the renderer exists (`tierOf`, §6.1).

## 9. Woven Overlay Redesign

Current problem: three marker mechanisms, a card-shaped ghost, a redundant tick, and no text track-changes.

Target behavior: one bar, one ring, one read-only ghost, real inline track-changes, and detail through the shared reader atoms.

Implementation tasks:

- Rewrite `GhostBlock` (`ghost-block.tsx`) to the minimal read-only form (R-RO): struck content, inert, hidden AX label, no `GHOST_BOX` border/wash/badge. It keeps emitting `data-engine-block-id` so the passive layer paints its red bar.
- Delete `deletionAnchors`, `ReviewDeletionAnchor`, and the `removed-before`/`removed-after` CSS from `review-change-indicator.tsx` and `REVIEW_INDICATOR_CSS` (D8). Remove the deletion-tick composition from `applyReviewIndicators`.
- Keep `changedElements` routing the bar and the ring, but make the ring an affordance (R-RG): it opens the chip or the band. Add the click/keyboard handler in the woven layer, keyed by `data-engine-block-id`.
- Add the T1 woven decorator (R-T1): a new module `packages/editor/src/view/overlays/review-text-runs.tsx` that consumes `partitionTextRuns` from the reader, locates runs in the live leaf by char id, decorates inserted runs, and injects inert deleted-run spans. It runs in review mode only, keyed off the diff for the changed leaf.
- Replace the cursor surface chip content (`review-cursor-surface.tsx`): drop `STATUS_CHIP`/`STATUS_LABEL` text (R-NL); render the reader `<ChangeDetail>` for the change under the cursor (per-element, using the id-indexed `BlockDiff`, §11) instead of the one-line `reviewEntryDetail` string. Keep prev/next/accept/reject.
- Add the inline-expand band (R-EX): a woven component that renders the reader `<DiffView>` scoped to the current element with `embedStyles={false}`, toggled by the ring/cursor, collapsing on cursor-leave or resolve.
- The review cursor still stops per top-level block (`reviewCursorEntries`), and a nested change is reached by landing on its top-level block and then focusing the ringed element; keep `reviewEntryDetail` only as the aggregate count in the cursor header, not as the detail body.

## 10. Diff View Changes

Current problem: a separate palette and a text status label, and no per-node diff.

Target behavior: the same indicator token as the woven surface, no status word, and the per-node renderer in the card body.

Implementation tasks:

- Refactor `renderRunSpans` (`diff-view.tsx:298`) to call the new `partitionTextRuns` and render slices; behavior identical, one partition shared with the editor.
- Extract `renderChangeDetail` into the exported `<ChangeDetail>` component (§6.2); the card and list-item paths render it as today.
- Drop the `StatusTag` label text from `card`/`StatusTag`; keep the icon, add an `sr-only` status span (R-NL). Confirm the byte-parity guarantee for `unchanged` blocks is untouched (only changed blocks lose the word).
- Point the card edge bar at the shared status token table (§6.3) so it equals the woven bar (R-GI).
- Add the `getNodeDiffRenderer` prop; in `changedInner`'s object branch (`diff-view.tsx:552`) render `renderDiff` when present, else the `diffData` field rows.
- Keep side-by-side `buildRows` as is; add a test that pins the gap-opposite alignment and two-ended move (R-SB).

## 11. Diff Engine And Snapshot Changes

The engine algorithm does not change. Two additive helpers only.

- `blockDiffIndex(diff): Map<NodeId, BlockDiff>` — a pure derived index over the recursive `blocks` tree, so the woven chip and band resolve the `BlockDiff` for a nested element (a cell) in O(1). New file `packages/editor/src/core/diff/index-blocks.ts`, mirrored in the reader if the reader needs it for the band.
- Consume `replaces`/`replacedBy` in the review model. The types already carry the pairing (`types.ts:93`); `buildReviewModel` renders a replacement as stacked ghost-then-added today. Pair them so a replacement shows as one unit (a struck base directly above its green replacement, one bar). This is the `docs/038` open item L.
- Keep the reader mirror (§5.2). Add any new shared shape (`RunSlice`) to both the engine types and the reader mirror as a supertype, the existing convention.

## 12. 037 Integration

The producer/consumer split (`docs/037`, `docs/038 §10`) is preserved. An agent acts on the command layer and lands a `Proposal` (an attributed op-log branch); the woven overlay renders `diffSnapshots(current, applyProposal(current, proposal))`. Two constraints this document keeps:

- `renderDiff` is render-time and never enters the `SnapshotDiff`. The diff an agent reads across a process boundary stays pure and serializable; `diffData` remains the field-level summary the agent sees. A headless agent gets the same `ObjectFieldChange[]` it gets today.
- The shared vocabulary (`ChangeKind`, `tierOf`) is pure and framework-free, so an out-of-process consumer can classify a change without React. Only the render atoms are React, and only the two in-editor surfaces use them.

## 13. Migration And Rollout

Reuse as-is: `diffSnapshots` and the whole `SnapshotDiff`; the reader `<DiffView>` structure, `buildRows`, `renderBlock` reuse via `cloneElement`; the two-tone ring CSS; the review cursor navigation; the save gate and review-mode plumbing (J6); attribution (J7).

Move (no behavior change): `renderRunSpans` internals to `partitionTextRuns`; `renderChangeDetail` to `<ChangeDetail>`. Both stay in the reader; the editor imports them.

Delete: `deletionAnchors` + `ReviewDeletionAnchor` + tick CSS; `GHOST_BOX` border/wash/`GHOST_BADGE`; the `StatusTag` label text; `STATUS_CHIP`/`STATUS_LABEL` text in the cursor surface; the second status palette in the diff-view card.

Add: `tierOf` + `ChangeKind` (`vocabulary.ts`); `partitionTextRuns` (`runs.ts`); `<ChangeDetail>` (`change-detail.tsx`); `NodeDiffRenderer` + `getNodeDiffRenderer` resolver; the woven T1 decorator (`review-text-runs.tsx`); the inline-expand band; the code-block/table/media `renderDiff`; `blockDiffIndex`; the `replaces`/`replacedBy` pairing; one end-to-end story.

Rollout order: the shared reader atoms first (they are additive and covered by existing diff-view tests), then the diff-view refactor to consume them (parity-tested), then the woven redesign, then the `renderDiff` seam and reference implementations, then the story consolidation. No feature flag: the woven overlay is opt-in already (`review` props), and every step keeps `pnpm check` green.

## 14. Edge Cases And Failure Modes

- Id-less deleted text run (`docs/038 §5.3`): `RunSlice.ids` absent. Woven falls back to offset positioning inside the leaf; no cross-leaf ghost move. Expected: the delete-ghost still shows; only cross-leaf identity is unavailable.
- A deleted-run ghost is inside the EditContext host but the geometry walker was not taught to skip it: every caret and click past the deletion is off by the ghost's length, and the EditContext buffer desyncs from the DOM. This is the single worst failure of R-T1. Prevented by the `[data-engine-ghost-run]` skip (P4) and pinned by the caret-after-deletion offset assertion; if that test is missing, treat R-T1 as unshipped.
- The reader mirror drifts from the engine diff (a new engine field the mirror does not widen): the editor's `SnapshotDiff` stops being assignable and every shared reader function breaks at the call site. Prevented by the `diff-mirror.assert.ts` type test in `pnpm check` (P1); a red typecheck here means widen the mirror, never cast at the boundary.
- A ring on an element whose top-level ancestor also has a bar: both show. The bar breadcrumbs the block; the ring pinpoints the element. This is intended composition, not duplication (unlike the deleted tick).
- A removed container (a whole table deleted): one ghost, struck/dimmed, red bar. Its subtree is not individually ghosted (`docs/038 §5.2`); the band on expand renders the full removed table via `renderBlock` on the base node.
- A code block with a `renderDiff` throwing: the band catches and falls back to the `diffData` field rows; never blanks the review. Add a boundary in the band.
- The inline band open while the reviewer types elsewhere: typing does not touch the band (it is on a different element); the band collapses when the cursor moves onto its element's neighbors or the change resolves. Typing never triggers an expand.
- Accessibility with the status word dropped (R-NL): every change element carries an `sr-only` status label and the icon is `aria-hidden`, so a screen reader still announces "Removed paragraph" / "Edited". A visual-only regression here fails the AX test.
- Side-by-side with an all-removed or all-added document: every left or right cell is a gap opposite real content; `buildRows` already handles empty anchor sets. Pin with a test.
- A collection/settings change with no block anchor: routes to the Changes pane (`docs/038 §17`), never woven. Unchanged.

## 15. Implementation Backlog

### P1. The shared reader atoms

Scope:

- `packages/reader/src/diff/vocabulary.ts` (new)
- `packages/reader/src/diff/runs.ts` (new)
- `packages/reader/src/diff/change-detail.tsx` (new, from `renderChangeDetail`)
- `packages/reader/src/diff/tokens.ts` (new, the status token table)

Tasks:

- [ ] Implement `ChangeKind`, `DisclosureTier`, `tierOf(kind, nodeType, getRenderer?)`.
- [ ] Implement `partitionTextRuns(text): RunSlice[]` and unit-test it against `TextLeafDiff` fixtures (identity path + text-alignment fallback).
- [ ] Extract `<ChangeDetail>` from `renderChangeDetail`; keep the diff view rendering it.
- [ ] Export the status token table and confirm one palette.
- [ ] Widen `RunSlice` into the reader mirror (`packages/reader/src/diff/types.ts`) as a structural supertype, so the editor's real slice is assignable (the same convention the mirror already uses for `ReaderTextRunDiff`).
- [ ] Add a compile-time assignability guard: a `tests/reader/diff-mirror.assert.ts` type test that asserts `SnapshotDiff` (engine) is assignable to `ReaderSnapshotDiff` (mirror) and fails `pnpm typecheck` if a future engine field breaks the supertype relation. This is the one thing that would silently break every shared reader function.

Acceptance criteria:

- `tierOf` returns the table in §6.1 for every kind, and promotes an object with a supplied `renderDiff` to `band`.
- `partitionTextRuns` returns runs whose concatenation equals the union text, with char ids preserved on the identity path.
- The engine diff stays assignable to the reader mirror with no cast; the assignability guard is in `pnpm check`.

Tests:

- `tests/reader/diff-vocabulary.test.ts`, `tests/reader/diff-runs.test.ts`, `tests/reader/diff-mirror.assert.ts`

### P2. Diff view consumes the atoms

Scope:

- `packages/reader/src/diff/diff-view.tsx`

Tasks:

- [ ] Refactor `renderRunSpans` to call `partitionTextRuns`.
- [ ] Render `<ChangeDetail>` in the card and list-item paths.
- [ ] Drop `StatusTag` label text (R-NL); keep the icon; add `sr-only` status.
- [ ] Point the card edge bar at the shared token (R-GI).
- [ ] Pin side-by-side gap alignment and two-ended move (R-SB).

Acceptance criteria:

- Existing diff-view snapshots differ only by the removed status word and the shared bar token; `unchanged` blocks stay byte-identical to `<Reader>`.

Tests:

- `tests/reader/diff-view.test.tsx` (extend), `review-*.spec.ts` screenshots regenerated

### P3. The per-node diff SPI

Scope:

- `packages/editor/src/core/registry/object-registry.ts`
- `packages/reader/src/diff/diff-view.tsx` (the `getNodeDiffRenderer` prop + band body)

Tasks:

- [ ] Add `NodeDiffRenderer` and `renderDiff?` to `NodeDefinition`.
- [ ] Add the `getNodeDiffRenderer` resolver prop to `<DiffView>`; render `renderDiff` in the object branch, else `diffData` rows.
- [ ] Implement the code-block `renderDiff` (Myers line diff over `pieceTableText`).
- [ ] Implement the table and media/embed/post-ref `renderDiff`.
- [ ] Document the mermaid/canvas/calc contract (not shipped).

Acceptance criteria:

- A code-block source change renders a line diff, not a truncated string; a node without `renderDiff` falls back to `diffData` rows; a throwing `renderDiff` falls back and never blanks.

Tests:

- `tests/editor/node-diff-renderer.test.tsx`, `tests/reader/diff-view-object.test.tsx`

### P4. Woven overlay redesign

Scope:

- `packages/editor/src/view/render/ghost-block.tsx`
- `packages/editor/src/view/render/mark-render.tsx` (the review-aware leaf variant)
- `packages/editor/src/view/render/text-block.tsx` (the fast-path gate)
- `packages/editor/src/view/overlays/geometry.ts` (skip `[data-engine-ghost-run]`)
- `packages/editor/src/view/overlays/review-change-indicator.tsx`
- `packages/editor/src/view/overlays/review-text-runs.tsx` (new: the T1 run decorator, built on the mark-render variant)
- `packages/editor/src/view/overlays/review-cursor-surface.tsx`
- `packages/editor/src/view/overlays/review-band.tsx` (new)

Tasks:

- [ ] Minimal read-only `GhostBlock` (R-RO); remove `GHOST_BOX` border/wash/badge; add `sr-only` label (reuse `visuallyHiddenStyle`, `packages/editor/src/view/styles.ts:169`).
- [ ] Delete `deletionAnchors`, `ReviewDeletionAnchor`, tick CSS, tick composition (D8).
- [ ] Review-aware `renderLeafMarks`: intersect mark segments with `partitionTextRuns` boundaries; tag inserted sub-segments `data-engine-review-op="insert"`; inject each deleted run as an inert `<span data-engine-ghost-run contenteditable="false" aria-hidden="true">` at its position (R-T1).
- [ ] `geometry.ts` (and `characterClientRects`/`offsetFromClientPoint`/`caretClientRect`/`patchHostText`): skip any node under `[data-engine-ghost-run]` in the text-node walk, so "concat of counted text nodes == store text" holds with a ghost present. Add the invariant to the file header.
- [ ] Generalize the fast-path gate in `text-block.tsx` to `leafHasMarks(node) || hasReviewDecoration(node)` so a review-decorated leaf renders React-owned spans and never takes the `patchHostText` flat write.
- [ ] Make the ring an affordance that opens the chip or band via one delegated `click` listener on the review root (R-RG).
- [ ] Cursor surface: drop `STATUS_CHIP`/`STATUS_LABEL` text, render `<ChangeDetail>` for the element under the cursor (per-element via `blockDiffIndex`).
- [ ] Add the inline-expand band embedding the reader `<DiffView>` with the projected `scopedDiff` (R-EX).

Acceptance criteria:

- A removed block shows one red bar and struck read-only content, no card, no tick.
- A text edit shows wash+underline inserts and struck inert deletes inline; the caret placed by click or arrow *after* a deletion lands on the correct store offset (the geometry-skip invariant holds), proven by a Playwright caret-position assertion.
- The ring opens `fill: red → green` in the chip; a code block opens a line diff in the band.

Tests:

- `review-decoration.spec.ts`, `review-cursor.spec.ts`, `review-mode.spec.ts` (extend), new `review-text-runs.spec.ts` (includes the caret-after-deletion offset assertion via `window.__IDCO_ENGINE_VIEW_API__`)

### P5. Engine helpers

Scope:

- `packages/editor/src/core/diff/index-blocks.ts` (new)
- `packages/editor/src/view/review-model.ts`

Tasks:

- [ ] `blockDiffIndex(diff): Map<NodeId, BlockDiff>`.
- [ ] Pair `replaces`/`replacedBy` in `buildReviewModel` (docs/038 item L).

Acceptance criteria:

- A nested cell's `BlockDiff` resolves in O(1); a replacement renders as one unit (struck base above green replacement, one bar).

Tests:

- `tests/editor/engine-review-model.test.tsx` (extend)

### P6. One end-to-end story

Decision on the story set (resolved, not "fold or delete"): after this feature the review/diff story count is exactly two.

- Keep `stories/engine-diff.stories.tsx` (whole-document diff view) as the reference-surface story.
- Add `stories/engine-change-review.stories.tsx` as the one canonical end-to-end review story.
- Delete `engine-diff-detail`, `engine-review-ghost`, `engine-review-decoration`, `engine-review-cursor`, `engine-review-changes`, `engine-review-mode` once the canonical story covers their cases (they were per-J-phase spike fixtures, not documentation surfaces).
- `stories/engine-review.stories.tsx` is `docs/027` (side-panel/Outline) and is unrelated; leave it.

Scope:

- `stories/engine-change-review.stories.tsx` (new), `stories/_fake-suggestion-source.ts` (new mock), the six deletions above.

Tasks:

- [ ] Build the canonical story: a mocked 037 agent (`_fake-suggestion-source`) emits a `Proposal`; enter review mode; exercise a woven text edit (R-T1), a removed-block ghost (R-RO), a re-colored cell (ring + chip), a code-block edit (band + line diff), and a glossary/settings change in the Changes pane; step the cursor; accept/reject whole and per block.
- [ ] Delete the six per-phase stories after the canonical story's Playwright spec covers their assertions.

Acceptance criteria:

- One story shows every tier and route end to end; the remaining review/diff story count is two (`engine-diff` + `engine-change-review`), plus the unrelated `engine-review` (027).

Tests:

- Playwright drive of the canonical story; screenshots in `test-results/change-review/`

## 16. Future Backlog

- Mermaid / canvas / calc `renderDiff` implementations (contract defined here, `docs/016` node authors ship them).
- Multi-proposal attribution and merged-store review (`docs/038 §11` explicitly single-proposal today).
- The native/Rust surface (`docs/031`, `docs/035`) consuming `tierOf` + the vocabulary with its own layout.
- A text-level intra-word `simplifyChanges` pass (the prosemirror-changeset nicety) if run granularity reads noisy.

## 17. Definition Of Done

- One text edit renders as red/green track changes in the live editor and in the diff view, from one `partitionTextRuns`.
- One block-level indicator (the status-hued left bar) is used by both surfaces; a removed block shows a red bar and struck read-only content with no card, no border, no badge, no tick.
- No visible status word ("REMOVED"/"EDITED"/"ADDED") on either surface; an `sr-only` label and icon preserve the announced status; the AX test passes.
- A code-block source change renders a real line diff on both surfaces through `renderDiff`; a custom node without a seam degrades to `diffData` rows without blanking.
- Side-by-side maps each base line to its target line with a gap opposite an unmatched block and a two-ended move; a test pins it.
- `blockDiffIndex` resolves a nested element's `BlockDiff`; the chip shows `fill: red → green` for the cell under the cursor; a replacement renders as one unit.
- One canonical end-to-end story exists; the J-phase stories are folded or deleted; `pnpm check` is green and `pnpm check:docs` passes for every new public export.

## 18. Final Model

The `SnapshotDiff` engine stays the one source of what changed. The reader becomes the one source of how a change looks: a pure classifier (`tierOf`), a pure run partition (`partitionTextRuns`), a read-only detail component (`ChangeDetail`), a read-only per-node renderer (`renderDiff`, injected), and one status token map. The diff view and the woven overlay are two layouts over that library. The diff view reflows into cards and columns; the woven overlay signals at rest with one bar, one ring, one read-only ghost, and real inline track-changes, and it reflows on demand into an inline band that embeds the same `<DiffView>`. Status is the indicator's color and the content's shape, never a repeated word. A removed block is always read-only and struck, never a card. Every change class is legible on both surfaces, and a new node type joins by shipping one `renderDiff`.
