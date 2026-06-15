# 005 - Side Table-Of-Contents Rail

> Status: implemented
>
> Date: 2026-06-15
>
> Scope:
>
> - `/home/quanghuy1242/pjs/idco/packages/editor` - TOC node, placement-aware decorate, editor shell rail, settings UI.
> - `/home/quanghuy1242/pjs/idco/packages/content-renderer` - read-side shell rail and in-flow skip parity.
> - `/home/quanghuy1242/pjs/idco/packages/ui` - presentational `RichTextTableOfContents` (kept layout-free).
> - `/home/quanghuy1242/pjs/idco/packages/lib` - TOC settings normalization and types.
> - `/home/quanghuy1242/pjs/idco/stories` - Ladle verification surface for the aside rail.
> - `/home/quanghuy1242/pjs/idco/tests` - normalization, round-trip, and render coverage.
>
> Source docs:
>
> - `AGENTS.md` - React Aria behavior + DaisyUI styling contract.
> - `.agents/skills/idco-ui/SKILL.md` - shared UI package rules and verification requirements.
> - DaisyUI 5 docs - grid/flex layout, panel styling, sticky positioning utilities.
> - Lexical docs - `DecoratorBlockNode`, `decorate`, editor-state read/serialize.
>
> Related docs:
>
> - `docs/001_lexical_editor_architecture.md` - one-JSON-contract model; columns/multi-column layout parked as future work.
> - `docs/002_gap_cursor_and_block_flow.md` - block flow and gap cursor geometry that must stay untouched.
> - `docs/003_block_chrome_and_table_capabilities.md` - block chrome / `BlockShell` conventions.
> - `docs/004_selection_flyout_and_context_actions.md` - overlay and shell interaction precedents.
>
> Assumptions:
>
> - Lexical stays pinned at `0.45.0` across all `@lexical/*` packages.
> - The TOC stays a node in the document JSON so the editor and renderer agree on one contract; placement is a property of that node, not editor-level chrome that lives outside the doc.
> - An `aside` TOC is page chrome: at most one per document acts as the rail. Additional `aside` TOC nodes fall back to a placeholder/inline rendering.
> - The contenteditable stays a flat block stream. The rail renders outside the contenteditable so block machinery (drag gutter, `draggable-block-plugin`, gap cursor, `selection-geometry`, slash menu) is not touched.
> - This is not the general column/layout node. That remains separate future work; a layout node would give "TOC scrolls in a column" but not the sticky rail, so the rail is worth building on its own.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. Current-State Findings](#2-current-state-findings)
  - [2.1 The TOC Is A Decorator Node](#21-the-toc-is-a-decorator-node)
  - [2.2 One JSON Contract Across Editor And Renderer](#22-one-json-contract-across-editor-and-renderer)
  - [2.3 Why Not A Layout/Column Node](#23-why-not-a-layoutcolumn-node)
- [3. Target Behavior](#3-target-behavior)
- [4. Data Model](#4-data-model)
- [5. Technical Design](#5-technical-design)
  - [5.1 Node: Placement-Aware Decorate](#51-node-placement-aware-decorate)
  - [5.2 Editor Shell And Rail Plugin](#52-editor-shell-and-rail-plugin)
  - [5.3 Renderer Parity](#53-renderer-parity)
  - [5.4 Presentational Component](#54-presentational-component)
- [6. Implementation Plan](#6-implementation-plan)
- [7. Edge Cases And Failure Modes](#7-edge-cases-and-failure-modes)
- [8. Open Questions](#8-open-questions)
- [9. Tests And Verification](#9-tests-and-verification)
- [10. Definition Of Done](#10-definition-of-done)
- [11. As-Built Notes](#11-as-built-notes)

## 1. Goal

Add a second presentation mode to the table of contents: a sticky **side rail** that pins beside the article and follows the reader as they scroll, in the style of Docusaurus / GitBook "On this page". The existing in-flow TOC block stays the default.

The rail is a reading affordance. It must look and behave identically in the live editor and in the published renderer, because both walk the same document JSON.

This is explicitly **not** the general column/multi-column layout node (parked in `docs/001`). That feature is larger and cross-cutting; it would let the TOC scroll inside an editable column, but it would not produce a sticky rail. The two are complementary, not alternatives.

## 2. Current-State Findings

### 2.1 The TOC Is A Decorator Node

`packages/editor/src/nodes/table-of-contents-node.tsx` defines `TableOfContentsNode extends RichTextDecoratorBlockNode`. It is atomic (no editable children), renders through `decorate()` inside a hover-chrome `BlockShell`, and carries its settings in `__data`:

- `title`, `minLevel`, `maxLevel`, `numbering`, `style` (`panel` / `plain` / `compact`).
- Settings are edited from a React Aria `DialogTrigger` + `Popover` (`TableOfContentsSettingsButton`).

The editor view recomputes entries from the whole document via `collectRichTextTocEntries(normalizeDocument(editorState.toJSON()), settings)` on every update. This is already document-wide, so it is independent of where the node sits or how it is presented.

### 2.2 One JSON Contract Across Editor And Renderer

`packages/content-renderer/src/index.tsx` maps `"table-of-contents"` to `renderTableOfContents(...)`, which renders the same `RichTextTableOfContents` presentational component from `@idco/ui` that the editor uses. `normalizeTocSettings` and the TOC types live in `@idco/lib`. Any new field must be normalized in `@idco/lib` and honored on both sides or the published output drifts from the editor.

### 2.3 Why Not A Layout/Column Node

A column/layout node is a nested element container that holds blocks. In this codebase nearly every block-level system assumes blocks are direct children of root: the left drag gutter (`pl-12` on the contenteditable in `RichTextEditor.tsx`), `draggable-block-plugin`, the gap cursor (`docs/002`), `selection-geometry`, slash-menu insertion, plus `model/schema.ts` + `model/normalize.ts` + the renderer + responsive collapse. All of that would need container awareness. It deserves its own design doc. The side rail avoids all of it by keeping the TOC atomic and rendering the rail outside the contenteditable.

## 3. Target Behavior

- A TOC node has a placement: `inline` (today's behavior) or `aside`.
- When `aside`, the editor frame and the rendered article both reserve a side track (left by default) and render the TOC there with `position: sticky`, so it stays visible while the body scrolls.
- In the editor, the in-flow node renders a compact placeholder chip ("Table of contents — pinned left", with the settings button, an inline/aside toggle, and remove) so the node stays selectable, configurable, and deletable, and the WYSIWYG stays legible.
- In the renderer, the in-flow node renders nothing at its flow position (it is chrome); only the rail renders.
- The settings popover gains a placement toggle (inline / aside) and a side picker (left / right).
- Entry collection, level range, numbering, and title behave exactly as today.

## 4. Data Model

Extend the TOC node `__data` (the `RichTextEditorNode` payload that already carries `title`/`minLevel`/`maxLevel`/`numbering`/`style`):

```ts
type TocPlacement = "inline" | "aside";
type TocSide = "left" | "right";

// added to the normalized TOC settings
placement: TocPlacement; // default "inline"
side: TocSide;           // default "left"
```

- Defaults applied in `normalizeTocSettings` (`@idco/lib`) and `normalizeTableOfContentsNode` (`packages/editor/src/model/normalize.ts`), mirroring how the existing settings get their defaults.
- Serialization rides the existing `__data` passthrough used by every other TOC setting; verify the round-trip rather than add a new path.
- `collectRichTextTocEntries` is unchanged.

## 5. Technical Design

### 5.1 Node: Placement-Aware Decorate

In `TableOfContentsEditor`:

- Read `settings.placement`.
- When `inline`, render exactly as today (`BlockShell` + `RichTextTableOfContents`).
- When `aside`, render a compact placeholder via `BlockShell` (icon + "Table of contents — pinned {side}") whose chrome exposes the settings button, an inline/aside toggle, and remove. The placeholder does not render the entry list; the rail does.
- Extend `TableOfContentsSettingsButton` with a placement toggle and side picker (React Aria `Select`/segmented control, DaisyUI styling), wired through `useDecoratorNodeUpdater`.

### 5.2 Editor Shell And Rail Plugin

- Add `packages/editor/src/plugins/toc-rail-plugin.tsx`: an update-listener plugin that scans the editor state for the first `aside` TOC node, recomputes its entries and settings, and publishes them through a small React context (e.g. `TocRailContext`).
- `RichTextEditor.tsx` consumes that context. When a rail exists, it wraps the existing bordered editor frame in a side-aware grid `[rail | frame]` (or `[frame | rail]` for right). The rail is a **sibling of the contenteditable**, not a child, rendering `RichTextTableOfContents` with `position: sticky` and a configurable `top` offset.
- The contenteditable keeps its current `pl-12` drag gutter untouched; the rail width is reserved outside the frame, so the gutter and the rail do not compete for the same space.
- No changes to selection, gap cursor, drag, or slash plugins, because the rail lives outside the editable region.

### 5.3 Renderer Parity

- In `packages/content-renderer/src/index.tsx`, detect an `aside` TOC node at the top level. When present, wrap the rendered article in the same side-aware grid and render the sticky rail with `RichTextTableOfContents`.
- Skip rendering the in-flow `table-of-contents` node when its placement is `aside` (it is chrome, represented by the rail). When `inline`, render as today.
- Keep the grid/rail/skip logic structurally identical to the editor shell so editor and published output match.

### 5.4 Presentational Component

- `RichTextTableOfContents` in `@idco/ui` stays presentational and layout-free. Reuse the existing `compact`/`plain` styles for the rail; stickiness and the reserved track live in the shells, not in this component.
- If a rail-specific visual treatment is wanted, add it as a style/variant rather than embedding positioning logic in the list.

## 6. Implementation Plan

1. Add `docs/005_side_toc_rail.md` (this document).
2. `@idco/lib`: add `placement`/`side` to TOC settings types and `normalizeTocSettings` defaults; round-trip test.
3. `packages/editor/src/model/normalize.ts`: apply the same defaults in `normalizeTableOfContentsNode`.
4. TOC node: placement-aware `decorate()` (placeholder when `aside`) and extend the settings popover with placement toggle + side picker.
5. Add `plugins/toc-rail-plugin.tsx` and `TocRailContext`; publish the first aside TOC's settings + entries.
6. `RichTextEditor.tsx`: consume the context and render the side-aware grid + sticky rail around the editor frame.
7. `content-renderer/src/index.tsx`: mirror the grid + rail and skip the in-flow aside node.
8. Stories: add an aside-TOC story (long content, left and right) so Playwright can verify stickiness and parity.
9. Tests: normalization defaults, JSON round-trip of `placement`/`side`, and a render assertion that `aside` yields a rail + placeholder while `inline` is unchanged.
10. Run format, lint, typecheck, tests, build, and `pnpm check`.
11. Playwright against the running Ladle story: confirm the rail pins on scroll, the placeholder shows in flow, switching inline/aside and left/right works, and the rendered output matches the editor with no console errors.

## 7. Edge Cases And Failure Modes

- **Multiple aside TOCs.** The first aside node becomes the rail; the rest render as placeholder/inline. Define and test this deterministically.
- **Sticky offset / scroll container.** The rail's `top` and the ancestor it sticks within vary by host. Ship a sensible default and an override; do not assume the Ladle page layout.
- **Left rail vs drag gutter.** The rail sits outside the frame and content keeps `pl-12`, so they should not overlap; confirm visually at narrow frame widths.
- **Editor/renderer drift.** The grid/rail/skip logic must match on both sides or published output diverges from the editor. Cover with a parity test.
- **Empty document / no headings.** The rail should degrade gracefully (hidden or empty-state), matching the inline TOC's current empty behavior.
- **Switching aside -> inline.** The placeholder becomes the full inline TOC at its flow position; the reserved track collapses.

## 8. Open Questions

- **Responsive.** On narrow screens, hide the rail or fall back to inline at the node's flow position? Default proposal: fall back to inline.
- **In-flow representation when aside.** Compact placeholder chip (proposed) or fully hidden with configuration moved to the insert / block menu?
- **Scroll-spy.** Highlight the active heading in the rail as the reader scrolls — include now or defer? Default proposal: defer to a later phase.
- **Rail width.** Fixed default vs a `railWidth` setting on the node.

## 9. Tests And Verification

Static and unit gates:

- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm check`

Focused test expectations:

- `normalizeTocSettings` returns `placement: "inline"` and `side: "left"` by default and preserves explicit values.
- A document with an `aside` TOC round-trips `placement`/`side` through serialize/normalize.
- Editor renders a rail + in-flow placeholder for an `aside` TOC and the full inline TOC for an `inline` TOC.
- Renderer renders the rail and skips the in-flow node for `aside`; renders inline as today otherwise.

Playwright verification against Ladle:

- Load the aside-TOC story with no console errors.
- Scroll the body and confirm the rail stays pinned.
- Toggle inline/aside and left/right and confirm the layout updates.
- Compare the editor rail against the renderer rail for the same document.

## 10. Definition Of Done

Done means:

- `docs/005_side_toc_rail.md` exists and reflects the implemented design.
- A TOC node supports `placement: "inline" | "aside"` and `side: "left" | "right"`, normalized with defaults and round-tripped in JSON.
- The editor renders an `aside` TOC as a sticky rail outside the contenteditable plus an in-flow placeholder, with no regression to drag, gap cursor, selection, or slash behavior.
- The renderer mirrors the rail and skips the in-flow aside node, matching the editor.
- `RichTextTableOfContents` stays presentational; positioning lives in the shells.
- Unit tests cover normalization/round-trip/render; browser verification covers stickiness and editor/renderer parity.
- `pnpm check` passes.

## 11. As-Built Notes

Implemented files:

- `packages/lib/src/rich-text.ts` adds `RichTextTocPlacement`/`RichTextTocSide` types, the `placement`/`side` fields on `RichTextTocSettings`, defaults (`inline` / `left`), and their normalization in `normalizeTocSettings`.
- `packages/ui/src/rich-text-content.tsx` adds two presentational primitives: `RichTextTocRail` (a `hidden lg:block` sticky `<aside>` wrapping `RichTextTableOfContents`, `compact` style) and `RichTextTocLayout` (a side-aware `lg:grid` shell that reserves a `16rem` rail column and renders children as-is when no rail is passed). Both shells use these so editor and renderer stay identical.
- `packages/editor/src/model/normalize.ts` projects `placement`/`side` through `normalizeTableOfContentsNode` so they round-trip in the document JSON; `model/schema.ts` lists them on `RichTextEditorNode`.
- `packages/editor/src/nodes/table-of-contents-node.tsx` branches `decorate()`: an `aside` TOC renders a compact placeholder (label + "Show inline instead") via `BlockShell`; the settings popover gains a Placement select (Inline / Side rail) and a Rail-side select (Left / Right) shown only when `aside`.
- `packages/editor/src/plugins/toc-rail-plugin.tsx` (`TableOfContentsRailPlugin`) scans the editor state on every update for the first `aside` TOC and publishes `{ entries, title, side }` (or `null`) to the shell.
- `packages/editor/src/RichTextEditor.tsx` holds the rail state, mounts the plugin inside the composer, and wraps the editor frame (the `overflow-hidden` bordered box) in `RichTextTocLayout` so the sticky rail sits *outside* the contenteditable — block plugins are untouched.
- `packages/content-renderer/src/index.tsx` mirrors the shell: `renderRichTextDocument` detects a top-level `aside` TOC and wraps the article in `RichTextTocLayout` + `RichTextTocRail`; `renderTableOfContents` returns an `lg:hidden` inline copy for the aside node (narrow-screen fallback) and the normal inline TOC otherwise.
- `stories/editor.stories.tsx` adds the `SideTableOfContents` story (long content, `placement: "aside"`).
- `tests/lib/rich-text.test.ts` and `tests/content-renderer.test.tsx` cover the normalize defaults/coercion and the rail + inline-fallback render.

Resolved open questions:

- **Responsive.** Below `lg` the rail is hidden (`display:none`) and the TOC renders inline at its flow position (renderer) / the placeholder shows (editor). Verified at an 800px viewport.
- **In-flow representation when aside.** Compact placeholder chip with a "Show inline instead" shortcut, plus full Placement/Side controls in the settings popover.
- **Scroll-spy.** Deferred (not implemented).
- **Rail width.** Fixed at `16rem`; no per-node width setting yet.

Verification completed:

- `pnpm check` passes (format:check, lint, check:dup, typecheck, 521 tests, build). The only lint output is the pre-existing `oxc(no-map-spread)` warning in `packages/ui/src/scope-builder.tsx`.
- Playwright against a fresh Ladle server (the long-running dev server does not hot-reload in this environment) confirmed, with no console/page errors: the rail renders left of the frame with heading entries; it stays pinned while scrolling (inner sticky `y` held at 16px after a 600px scroll); the in-flow placeholder is present; switching Rail side moves the rail to the right of the frame; switching Placement to Inline removes the rail and renders a normal inline TOC inside the frame; and the rail is hidden at an 800px (sub-`lg`) viewport.

### Follow-up polish

- **Rail alignment.** `RichTextTocRail` neutralizes the TOC's own `my-2`/`my-3` (`[&>nav]:my-0`) so the rail top lines up with the editor frame / article top (verified: 0px delta) instead of sitting a row lower.
- **Renderer stories.** `stories/content-renderer.stories.tsx` adds `SideTableOfContentsLeft` and `SideTableOfContentsRight` showing the published sticky rail on either side.
- **TOC numbering (general fix).** `collectRichTextTocEntries` now numbers and indents by the *relative* nesting of headings actually present (a small `levels`/`counts` stack) instead of absolute level with `.filter(part => part > 0)`. The old logic fabricated a leading "1" for a deep heading that had no shallower ancestor — e.g. changing the document's first `h2` to `h1` (excluded by `minLevel`) left an orphan `h3` that collided with the first real `h2` at "1". Numbering is now continuous with no duplicates; covered by a new test and verified live.
- **Heading anchors track text (general fix).** `heading-anchor-plugin` now re-derives each heading's anchor id from its current text (Markdown/GitHub-style) instead of freezing the first id, so renaming a heading updates its anchor and the TOC link. Writes use the `history-merge` tag to avoid extra undo steps. The read-side `ensureRichTextHeadingAnchors` keeps preferring a stored id, so published documents retain whatever anchors were saved.
