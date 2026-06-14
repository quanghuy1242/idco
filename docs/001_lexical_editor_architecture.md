# 001 — Lexical Editor Architecture and Roadmap

> Status: implementation-grade research and proposal
>
> Date: 2026-06-13
>
> Scope:
>
> - `/home/quanghuy1242/pjs/idco/packages/editor` (new home for the live editor)
> - `/home/quanghuy1242/pjs/idco/packages/ui` (current home: `rich-text-editor.tsx`, `rich-text-nodes.tsx`, `code-editor.tsx`, `rich-text-content.tsx`)
> - `/home/quanghuy1242/pjs/idco/packages/content-renderer` (read-side renderer)
> - `/home/quanghuy1242/pjs/idco/stories` (Ladle previews)
>
> Source docs:
>
> - `AGENTS.md` (UI philosophy, package boundary, cross-repo release)
> - `.agents/skills/idco-ui/SKILL.md` (React Aria + DaisyUI contract)
>
> Related docs:
>
> - Memory: `idco-ui-react-aria-daisyui-philosophy`, `rich-text-live-editor`, `standardize-dont-diverge-ui-patterns`
>
> Assumptions:
>
> - Lexical stays pinned at `0.45.0` across all `@lexical/*` packages.
> - The editor remains product-neutral: host apps inject `mediaLibrary` / `postLibrary` / `onUploadMedia` bindings.
> - The document JSON is the persisted source of truth; it must stay round-trippable through both the editor and `@idco/content-renderer`.
> - Collaborative (Yjs) editing is out of first-release scope but must not be precluded by the schema.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 Relevant Files](#31-relevant-files)
  - [3.2 Current Behavior](#32-current-behavior)
  - [3.3 Current Problems](#33-current-problems)
- [4. Target Model](#4-target-model)
  - [4.1 Package Layout](#41-package-layout)
  - [4.2 Document Schema And Capabilities](#42-document-schema-and-capabilities)
  - [4.3 Node Taxonomy](#43-node-taxonomy)
- [5. Architecture Decisions](#5-architecture-decisions)
- [6. Implementation Strategy](#6-implementation-strategy)
- [7. Detailed Implementation Plan](#7-detailed-implementation-plan)
  - [7.1 Caret Around Block Nodes](#71-caret-around-block-nodes)
  - [7.2 Per-Block Formatting Capabilities](#72-per-block-formatting-capabilities)
  - [7.3 Flyout (Slash) Menu And Block Handle](#73-flyout-slash-menu-and-block-handle)
  - [7.4 Right-Click Context Menu](#74-right-click-context-menu)
  - [7.5 Live Tables](#75-live-tables)
  - [7.6 Editor Feature Gaps Vs Confluence/Docs](#76-editor-feature-gaps-vs-confluencedocs)
  - [7.7 Inline Tooltip / Glossary](#77-inline-tooltip--glossary)
  - [7.8 Inline Comments](#78-inline-comments)
  - [7.9 Paragraph Alignment](#79-paragraph-alignment)
- [8. Migration And Rollout](#8-migration-and-rollout)
- [9. Edge Cases And Failure Modes](#9-edge-cases-and-failure-modes)
- [10. Implementation Backlog](#10-implementation-backlog)
- [11. Future Backlog](#11-future-backlog)
- [12. Definition Of Done](#12-definition-of-done)
- [13. Final Model](#13-final-model)

## 1. Goal

Turn the prototype Lexical editor that currently lives inside `@idco/ui` into a dedicated, well-architected `@idco/editor` package capable of supporting a **serious book-authoring system** — the target bar is Confluence / Google Docs, not a barebone rich-text box. This document captures the full plan; the first implementation slice migrates the editor, fixes the structural correctness bugs, and stands up a dedicated Ladle story so progress is visible live.

Non-goals for the first release: real-time collaboration (Yjs), full Markdown import/export fidelity, and exhaustive language coverage in code blocks. These are tracked in [Future Backlog](#11-future-backlog).

Boundary: the editor stays product-neutral per `AGENTS.md`. It must not import worker source, Better Auth, Drizzle, Hono, or Cloudflare runtime types. All product data (media, post references) arrives through injected async bindings.

## 2. System Summary

Editing and rendering are two sides of one JSON contract:

```
host app ──value (doc JSON)──▶ @idco/editor (Lexical) ──onChange(doc JSON)──▶ host app ──persist──▶ DB
                                                                                                  │
host app ◀──────────────────── @idco/content-renderer (read-only React) ◀──────────────────────────┘
```

The document is a Lexical-shaped tree (`{ root: { children: [...] } }`). The editor (de)serializes between the persisted doc shape and Lexical's internal editor state; the renderer walks the same tree to produce React output. Both sides must agree on node types, attributes, and the text-format bitmask (`bold:1, italic:2, strikethrough:4, underline:8, code:16, subscript:32, superscript:64, highlight:128`).

## 3. Current-State Findings

### 3.1 Relevant Files

- `packages/ui/src/rich-text-editor.tsx` (1123 lines) — `RichTextEditor` composer + `LexicalToolbar` + doc↔Lexical (de)serialization (`normalizeDocument`, `normalizeNode`, `lexicalEditorState`, `lexicalNode`) + `EditorDocumentSyncPlugin`.
- `packages/ui/src/rich-text-nodes.tsx` (913 lines) — five `DecoratorNode` subclasses (`CalloutNode`, `CodeBlockNode`, `EmbedNode`, `MediaNode`, `PostRefNode`), their inline editor components, `INSERT_RICH_TEXT_NODE_COMMAND`, `RichTextNodePlugin`, `RichTextEditorBindingsContext`, `BlockShell` chrome.
- `packages/ui/src/code-editor.tsx` (173 lines) — controlled Prism textarea, shared by the code-block editor and the read-only renderer.
- `packages/ui/src/rich-text-content.tsx` (229 lines) — display primitives (`RichTextArticle`, `RichTextParagraph`, `RichTextHeading`, etc.).
- `packages/content-renderer/src/index.tsx` (367 lines) — `renderRichTextDocument` tree-walker, `defaultRenderers` map, text-format bitmask.
- `packages/editor/src/index.ts` — placeholder reserved for exactly this migration.
- `stories/editors-builders.stories.tsx` — `CodeAndRichText` story exercises `RichTextEditor`.
- `.ladle/vite.config.ts` — source aliases for `@idco/ui`, `@idco/lib`, `@idco/content-renderer` (no `@idco/editor` alias yet).
- `tsconfig.json` — already maps `@idco/editor` → `packages/editor/src/index.ts`.

### 3.2 Current Behavior

- The editor supports paragraph, heading (h1–h4), quote, bullet/numbered lists, inline bold/italic/underline/strikethrough/code, undo/redo, and five custom block widgets inserted via an "Insert" toolbar menu (also triggered by typing `/`).
- Custom blocks are `DecoratorNode`s with `isInline() => false`. Each renders a React editor surface inside a hover-chrome `BlockShell`.
- The callout block's text is a plain `<textarea>`, not Lexical rich text.
- Code blocks reuse the Prism `CodeEditor`. Media and post-ref blocks use async `ResourceSelector` (`variant="menu"`).
- The editor emits the doc on every change and mirrors a read-only JSON view below the editor.
- The toolbar disables inline formatting when focus leaves the editable text (e.g. while a block widget holds focus) via `FOCUS_COMMAND` / `BLUR_COMMAND` tracking.

### 3.3 Current Problems

1. **No caret before/after block nodes.** Because the custom nodes extend bare `DecoratorNode` and are not keyboard-selectable block decorators, when such a block is the first or last child of the root there is no adjacent text position; the user cannot place the caret after it to continue writing. This is the headline bug.
2. **Formatting cannot be scoped per block.** Quote is real rich text, so bold/italic *do* apply there (undesired); callout is a `<textarea>`, so formatting *cannot* apply there even though the toolbar buttons are not block-aware. There is no capability model describing which formats a block allows.
3. **No caret-anchored flyout menu and no context menu.** The `/` key opens the toolbar's Insert menu, anchored to the toolbar rather than the caret. There is no Notion-style block handle and no right-click context menu.
4. **No live table.** The editor has no table node at all. `@idco/ui`'s `DataTable` is an unrelated read-only display grid.
5. **No inline links.** `@idco/content-renderer` renders `link` nodes, but the editor exposes no way to create one — a hard gap for any serious editor.
6. **No inline tooltip/glossary, no inline comments, no paragraph alignment.** Element `format` (alignment) is dropped by both the serializer and the renderer.
7. **Serialization is duplicated.** Node shape, the format bitmask, and normalization logic exist independently in `rich-text-editor.tsx` and `content-renderer`. They will drift.
8. **Two 1000-line files.** All nodes, all serialization, and the toolbar are monolithic, making the planned growth hard to manage.

## 4. Target Model

### 4.1 Package Layout

`@idco/editor` (`packages/editor`, published as `@quanghuy1242/idco-editor`) owns the live editor. `@idco/ui` keeps generic primitives (`CodeEditor`, `Menu`, `Tooltip`, `Popover`, `ResourceSelector`, `FileDropzone`, layout/typography) and the read-side display primitives. `@idco/editor` depends on `@idco/ui`; `@idco/ui` must not depend back on `@idco/editor` (no cycle).

```
packages/editor/src/
  index.ts                       # public surface
  RichTextEditor.tsx             # composer config assembly only
  model/
    schema.ts                    # node-type registry, doc/Lexical types, format bitmask (single source of truth)
    capabilities.ts              # per-node allowed inline formats + allowed child blocks
    serialize.ts                 # doc -> Lexical editorState JSON
    normalize.ts                 # untrusted JSON -> canonical doc
  nodes/
    block-decorator-node.tsx     # shared RichTextDecoratorBlockNode base (extends DecoratorBlockNode)
    callout-node.tsx
    code-block-node.tsx
    embed-node.tsx
    media-node.tsx
    post-ref-node.tsx
    comment-mark-node.ts         # @lexical/mark-based inline comment ranges
    glossary-node.tsx            # inline tooltip/dictionary
  plugins/
    toolbar-plugin.tsx
    floating-text-toolbar-plugin.tsx
    slash-menu-plugin.tsx
    block-handle-plugin.tsx
    context-menu-plugin.tsx
    boundary-paragraph-plugin.tsx
    link-plugin.tsx
    alignment-plugin.tsx
    table-plugin.tsx             # wraps @lexical/table + resizer
    comment-plugin.tsx
    markdown-shortcut-plugin.tsx
    document-sync-plugin.tsx
  context/
    bindings-context.ts          # mediaLibrary / postLibrary / onUploadMedia / allowedEmbedDomains
    capability-context.ts        # current-selection capabilities for the toolbar
  hooks/
    use-decorator-node-updater.ts
    use-remove-node.ts
  toolbar/
    toolbar-button.tsx
    toolbar-divider.tsx
    block-style-menu.tsx
```

### 4.2 Document Schema And Capabilities

`model/schema.ts` is the single source of truth: the `RichTextEditorNode` shape, the `RichTextEditorDocument` shape, the text-format bitmask, the canonical list of node types, and the heading/list/tone enums. `@idco/content-renderer` should import the node-type and bitmask constants from here (or from a shared sub-path) instead of re-declaring them, eliminating drift (problem 7).

`model/capabilities.ts` declares, per block type, which inline formats and which child block types are allowed:

```ts
type BlockCapability = {
  readonly inlineFormats: ReadonlySet<TextFormatType>; // empty = plain text only
  readonly canAlign: boolean;
  readonly canComment: boolean;
};
// quote      -> no inline formats, no align
// callout    -> no inline formats (or a restricted set), no align
// paragraph  -> all inline formats, align
// heading    -> bold/italic/code subset, align
// table-cell -> all inline formats
```

The toolbar reads the capability for the block at the current selection and disables/hides controls accordingly (problem 2).

### 4.3 Node Taxonomy

- **Element nodes (real rich text):** paragraph, heading, quote, list, listitem, table/row/cell. Caret and formatting work natively. Callout should migrate from `<textarea>` to a real `ElementNode` so it participates in the capability model (recommended; see [5](#5-architecture-decisions)).
- **Block decorator nodes (atomic widgets):** code-block, embed, media, post-ref. Re-based on `DecoratorBlockNode` so they are keyboard-selectable and the caret can move past them.
- **Inline nodes:** link (`@lexical/link`), comment mark (`@lexical/mark` `MarkNode`), glossary term.

## 5. Architecture Decisions

### 5.1 Recommended Approach

- **Base custom blocks on `DecoratorBlockNode`** (`@lexical/react/LexicalDecoratorBlockNode`) instead of bare `DecoratorNode`. It provides `selectNext/selectPrevious/selectStart/selectEnd`, the prerequisites for selecting/navigating atomic blocks. Pair it with an on-demand **block insert control** (a hover "+" in the gutter) rather than forcing persistent boundary paragraphs — see §7.1 for why the boundary-paragraph approach was rejected.
- **Use the official `@lexical/table`** (`TablePlugin`, `$insertTableRowAtSelection`, `$insertTableColumnAtSelection`, `TableCellNode`/`TableRowNode`/`TableNode`, header/merge/horizontal-scroll/tab-nav options). Cells are real element nodes, so caret, formatting, and inline comments work inside cells for free. Column resize is the one piece outside the package; port the playground `TableCellResizer` with DaisyUI styling.
- **Use the official `@lexical/mark` `MarkNode`** for inline comments — it carries a set of overlapping thread IDs and has `$wrapSelectionInMarkNode`. Comment threads live outside the document; the doc only stores mark IDs.
- **Use the official `@lexical/link`** for inline links and `@lexical/markdown` for shortcut input.
- **Every overlay/menu/toolbar is React Aria behavior + DaisyUI styling**, sourced from `@idco/ui` primitives (`Menu`, `Popover`, `Tooltip`, `Toolbar`). No hand-rolled dropdowns/popovers, per `AGENTS.md`.
- **Extract one shared schema module** so the editor and renderer cannot disagree.
- **Migrate callout to a real `ElementNode`** so #2 (per-block capabilities) is uniform; the `<textarea>` special case is removed.

### 5.2 Rejected Or Deferred Options

- **Keep bare `DecoratorNode` + custom arrow-key hacks.** Rejected: re-implements what `DecoratorBlockNode` already provides and is fragile at document boundaries.
- **Build a custom table node family.** Rejected: `@lexical/table` is official, handles selection/merge/keyboard, and is far less risky than hand-rolling grid selection.
- **Keep the editor in `@idco/ui`.** Rejected: it will grow large and product-feature-shaped; `packages/editor` is already reserved for it and keeps `@idco/ui` lean.
- **Real-time collaboration now.** Deferred: large surface; schema is designed not to preclude it.

## 6. Implementation Strategy

Sequenced so every phase compiles, passes `pnpm check`, and is visible in Ladle:

1. **Scaffold + migrate.** Create the `@idco/editor` package, move and split the editor into the modular layout, extract `model/schema.ts`, add the Ladle alias, and point the story/tests at `@idco/editor`. Behavior unchanged.
2. **Correctness.** Caret around blocks (`DecoratorBlockNode` + BoundaryParagraphPlugin) and per-block capabilities. These fix bugs, not features.
3. **High-value, low-risk features.** Inline links, paragraph alignment, Markdown shortcuts.
4. **Authoring feel.** Slash menu (caret-anchored), block handle, context menu, floating selection toolbar.
5. **Tables** via `@lexical/table` + resizer.
6. **Comments + glossary tooltips.**

Compatibility bridge: while consumers still import `RichTextEditor` from `@idco/ui`, keep the export working until the consumer repin lands (see [8](#8-migration-and-rollout)).

## 7. Detailed Implementation Plan

### 7.1 Caret Around Block Nodes

Current problem: bare `DecoratorNode` blocks have no adjacent caret slot, and a block's nested inputs (code textarea, media fields) trap focus, so the keyboard cannot reach the gap *between* two adjacent blocks or the slot after the last block.

Target behavior (revised after review): the user can insert a block in any gap on demand, Confluence-style, **without** the editor keeping persistent empty paragraphs. The earlier "boundary paragraph" approach (forcing a leading/trailing empty paragraph) was rejected — it left a permanent blank line and still did not cover the gap between two adjacent blocks.

Implemented approach:

- `nodes/base.tsx` exports `RichTextDecoratorBlockNode extends DecoratorBlockNode` (carries `__data`, `getData/setData/exportJSON`, `afterCloneFrom`); all five blocks re-based on it so each block is keyboard-selectable as a unit.
- `plugins/block-controls-plugin.tsx`: a hover "+" in the left margin (portaled to `document.body`, fixed-positioned so the editor's `overflow-hidden` does not clip it). Hovering any top-level block reveals the control; pressing it inserts an empty paragraph immediately after that block via `target.insertAfter($createParagraphNode())` and `paragraph.select()` to drop the caret in. This reaches the code↔media gap and the after-last-block slot.
- **Block insertion does not wrap the block in blank lines.** `INSERT_RICH_TEXT_NODE_COMMAND` (in `nodes/index.tsx`) replaces the caret's empty paragraph in place rather than splitting it (`$insertNodeToNearestRoot` left a blank line before *and* after). It only adds a single trailing paragraph when the inserted decorator block has no following sibling (a caret home); when content already follows, no paragraph is added and the caret moves into the next block. Covered by `tests/editor/insertion.test.tsx`.
- The left gutter padding (`pl-12`) is wide enough that the drag/insert block handle sits clear of the text instead of overlapping the first characters.

Follow-ups (backlog): a true gap-cursor (Lexical has none natively) and a drag handle for block reordering (R2-A); an affordance to insert *above* the first block when it is a decorator.

Tests:

- `tests/editor/editor-foundation.test.tsx`: alignment round-trips through the renderer. The "+" affordance is position/hover driven (jsdom returns zero-size rects), so it is verified manually in Ladle rather than unit-tested.

### 7.2 Per-Block Formatting Capabilities

Current problem: formatting is not block-aware; quote allows bold/italic, callout cannot format at all.

Target behavior: the toolbar reflects the capability of the current block (quote/callout = plain text; paragraph = full formatting).

Implementation tasks:

- [ ] Add `model/capabilities.ts` with a `capabilityFor(blockType)` lookup.
- [ ] In `toolbar-plugin.tsx`, compute the current block type during `refreshToolbar` (already partly done via `blockKind`) and disable inline-format buttons not in the capability set.
- [ ] Migrate callout to a real `ElementNode` so its capability is uniform (recommended) and remove the `<textarea>` path.

Tests:

- `tests/editor/capabilities.test.tsx`: with selection in a quote, the bold button is disabled; in a paragraph, enabled.

### 7.3 Flyout (Slash) Menu And Block Handle

Current problem: `/` opens the toolbar menu anchored to the toolbar.

Target behavior: typing `/` opens a menu anchored at the caret rect; a left-gutter `+`/drag handle appears per block.

Implementation tasks:

- [ ] `plugins/slash-menu-plugin.tsx`: track the `/` trigger and caret DOM rect; render an `@idco/ui` `Popover`+`Menu` against a virtual anchor (`getBoundingClientRect`). Filter items by `allowedNodes` + bindings (reuse `canInsertStarterNode`).
- [ ] `plugins/block-handle-plugin.tsx`: a hover handle in the left gutter that opens the same insert menu and (later) supports drag reordering.

Tests:

- `tests/editor/slash-menu.test.tsx`: typing `/` opens the menu; selecting an item inserts the node at the caret.

### 7.4 Right-Click Context Menu

Current problem: none exists.

Target behavior: right-clicking a block opens a context menu (duplicate, delete, turn into, comment).

Implementation tasks:

- [ ] Confirm React Aria's current context-menu support for the pinned version; if absent, build a thin `onContextMenu` → virtual-anchor adapter that drives an `@idco/ui` `Menu`.
- [ ] `plugins/context-menu-plugin.tsx`: wire block-level actions through Lexical commands.

Tests:

- `tests/editor/context-menu.test.tsx`: right-click → menu open → "delete" removes the block.

### 7.5 Live Tables

Current problem: no table node.

Target behavior: insert table; add/remove rows and columns; resize columns; navigate with Tab; format inside cells; optional header row.

Implementation tasks:

- [ ] Add `@lexical/table@0.45.0`.
- [ ] Register `TableNode`, `TableRowNode`, `TableCellNode`; mount `TablePlugin` (consider `hasCellMerge`, `hasHorizontalScroll`, `hasTabHandler`).
- [ ] `plugins/table-plugin.tsx`: wrap insert via `INSERT_TABLE_COMMAND`.
- [ ] `plugins/table-controls-plugin.tsx`: Word/Docs-style hover affordances — "+" buttons at every column boundary (top) and row boundary (left) insert a column/row exactly there (`$insertTableColumnAtSelection` / `$insertTableRowAtSelection` against the boundary cell); internal column boundaries also expose a persistent drag handle for column resize (`TableNode.setColWidths`, with `.rt-table { table-layout: fixed }`). Visibility is keyed off the cursor being within a band around the table, so the handle no longer vanishes the moment the pointer reaches it. Row/column *deletion* stays in the toolbar.
- [ ] Add table serialization to `serialize.ts`/`normalize.ts` and a renderer for `@idco/content-renderer`.

Tests:

- `tests/editor/table.test.tsx`: insert a 2x2 table; add a row; the doc serializes with the expected `table`/`tablerow`/`tablecell` nodes.

### 7.6 Editor Feature Gaps Vs Confluence/Docs

Target behavior (prioritized): inline links; alignment; highlight/text color; checklists (data already supports `checked`); indent/outdent; horizontal rule; Markdown shortcuts; paste/HTML import (`@lexical/clipboard`); collapsible sections; anchors/TOC; mentions/emoji; find-and-replace; word count; autosave hook.

Implementation tasks (first-release subset):

- [ ] `plugins/link-plugin.tsx` using `@lexical/link` + a link-edit `Popover` from `@idco/ui`.
- [ ] `plugins/markdown-shortcut-plugin.tsx` using `@lexical/markdown` transformers limited to allowed nodes.
- [ ] Checklist toggle in the toolbar (list type `check`).

Tests:

- `tests/editor/links.test.tsx`: select text, apply link, doc contains a `link` node round-trippable through the renderer.

### 7.7 Inline Tooltip / Glossary

Target behavior: an inline term that shows a definition/footnote popover on hover/focus.

Implementation tasks:

- [ ] `nodes/glossary-node.tsx`: an inline node carrying `{ term, definition }`, rendered with an `@idco/ui` `Tooltip`/`Popover`.
- [ ] Toolbar/slash action to wrap the selection as a glossary term.
- [ ] Renderer support in `@idco/content-renderer`.

Tests:

- `tests/editor/glossary.test.tsx`: wrapping a selection produces a glossary node with the entered definition.

### 7.8 Inline Comments

Target behavior: highlight a range, attach a comment thread; overlapping ranges supported; threads stored outside the doc.

Implementation tasks:

- [ ] Add `@lexical/mark@0.45.0`; register `MarkNode`.
- [ ] `nodes/comment-mark-node.ts`: thin wrapper if extra metadata is needed.
- [ ] `plugins/comment-plugin.tsx`: `$wrapSelectionInMarkNode` on "add comment"; a comment sidebar/popover (`@idco/ui`) keyed by mark ID; the host app owns thread persistence via a binding.
- [ ] Renderer renders marks as highlighted spans linking to threads.

Tests:

- `tests/editor/comments.test.tsx`: wrapping a selection adds a mark with the thread ID; removing the thread removes the mark.

### 7.9 Paragraph Alignment

Current problem: element `format` is dropped by serializer and renderer.

Target behavior: left/center/right/justify on paragraphs and headings.

Implementation tasks:

- [ ] `plugins/alignment-plugin.tsx` (or toolbar buttons) dispatching `FORMAT_ELEMENT_COMMAND`.
- [ ] Thread element `format` through `serialize.ts`/`normalize.ts`.
- [ ] Render alignment in `@idco/content-renderer` (map `format` to text-align classes).

Tests:

- `tests/editor/alignment.test.tsx`: centering a paragraph serializes `format: "center"` and the renderer applies `text-center`.

## 8. Migration And Rollout

- **In-repo:** add `@idco/editor` aliases to `.ladle/vite.config.ts`; point `stories/` and `tests/` at `@idco/editor`; move lexical deps into `packages/editor/package.json`.
- **`@idco/ui` exports:** during transition, `@idco/ui` may keep re-exporting `RichTextEditor` from `@idco/editor` to avoid breaking the `content-api` consumer — but only if no import cycle results (editor depends on ui). The safer path is to drop the `@idco/ui` editor export and update the consumer in the same release.
- **Cross-repo (per `AGENTS.md`):** edit idco → in `content-api` run `pnpm dev:link` and prove `pnpm check` → bump every publishable `packages/*/package.json` (and root) to the same `X.Y.Z` → commit, tag `vX.Y.Z`, push → in the consumer run `pnpm dev:unlink`.
- **Renderer:** ship schema-constant sharing without changing the persisted JSON shape, so existing stored documents keep rendering.
- **Rollback:** each phase is independently revertable; the schema move is additive (no stored-doc format change).

## 9. Edge Cases And Failure Modes

- Document whose only child is a block widget → BoundaryParagraphPlugin must add leading/trailing paragraphs without an infinite update loop.
- Untrusted/legacy JSON (missing fields, old `code` type, `tag`-only lists) → `normalize.ts` must coerce to canonical shape (preserve today's behavior).
- Block decorator focus vs editor focus → formatting controls must not act on a focused widget; capabilities + focus tracking both gate this.
- Media `resolve`/`load` rejects or aborts → preview stays empty; alt/caption remain editable.
- Embed URL outside `allowedEmbedDomains` → input flagged, preview suppressed (existing behavior preserved).
- Table operations at edges (delete last row/column, merged cells) → rely on `@lexical/table` semantics; cover with tests.
- Overlapping comment marks → `MarkNode` supports ID sets; deleting a thread must strip only its ID, not the span.
- `dangerouslySetInnerHTML` in `CodeEditor`/renderer → keep Prism-escaped output; no raw user HTML injection.

## 10. Implementation Backlog

All first- and second-wave items below are **implemented** (2026-06-13). The whole gate (`pnpm check`) is green: format, lint, duplicate gate, typecheck, 443 tests, build.

### R1-A. Package Scaffold And Migration — Done

- `@idco/editor` (`@quanghuy1242/idco-editor`) created with the modular layout in [4.1](#41-package-layout); editor moved out of `@idco/ui`; `model/schema.ts` is the single source of truth; Ladle + Vitest + tsconfig aliases added; dedicated `stories/editor.stories.tsx`.

### R1-B. Caret Around Blocks — Done (approach revised)

- Decorator blocks re-based on `DecoratorBlockNode`. The persistent boundary-paragraph approach was **rejected** (left a permanent blank line and never covered the gap between two blocks). Replaced by on-demand affordances: the gutter block handle's "+" (`plugins/draggable-block-plugin.tsx`) inserts a paragraph after any block, and `plugins/block-controls-plugin.tsx` turns a click in the empty area below the last block into a fresh trailing paragraph. See §7.1.

### R1-C. Per-Block Capabilities — Done

- `model/capabilities.ts` + toolbar gating: bold/italic/etc and alignment are disabled in quote and callout. (Callout stays a plain `<textarea>`, so it is inherently plain-text; converting it to a real `ElementNode` remains an optional refinement, not required for the capability behavior.)

### R1-D. Inline Links + Alignment + Markdown Shortcuts — Done

- Alignment (`FORMAT_ELEMENT_COMMAND`) threaded through `serialize`/`normalize` and rendered. Inline links via `@lexical/link` + `plugins/link-plugin.tsx` + `toolbar/link-button.tsx` (React Aria URL popover). Markdown shortcuts via `@lexical/markdown` + `plugins/markdown-shortcut-plugin.tsx` (curated transformer list excluding fenced-code). Check lists via `@lexical/react` `CheckListPlugin` + toolbar button.

### R2-A. Slash Menu + Block Handle + Context Menu — Done

- Caret-anchored "/" command menu via `LexicalTypeaheadMenuPlugin` (`plugins/slash-menu-plugin.tsx`). Drag-to-reorder block handle via `DraggableBlockPlugin_EXPERIMENTAL` (`plugins/draggable-block-plugin.tsx`), vertically centered, with grip + insert "+". Right-click context menu (`plugins/context-menu-plugin.tsx`) built on the **React Aria** `@idco/ui` `Menu` at a virtual cursor anchor — deliberately not the Floating-UI-based `LexicalNodeContextMenuPlugin`, to keep the `@idco/ui` behavior contract.

### R2-B. Tables — Done

- `@lexical/table` `TablePlugin` (cell merge, tab nav, horizontal scroll) via `plugins/table-plugin.tsx`; insert from the toolbar Insert menu and the slash menu. Row/column **insert** is a hover affordance on the table itself (`plugins/table-controls-plugin.tsx`, Word/Docs-style "+" at each boundary); the toolbar's table group keeps only row/column **delete**. Column resize is part of the same controls plugin and now works (the old `table-resizer-plugin.tsx` handle disappeared as soon as the cursor reached it; replaced). Table cells carry comfortable `px-5 py-2.5` padding. **Passthrough element nodes (table/row/cell, link, mark) are serialized with `indent: 0`** — without it Lexical's reconciler writes an inline `padding-inline-start: calc(undefined * …)` onto cells (it only clears the property when `indent === 0`), which silently overrode the cell padding for documents loaded from JSON while freshly inserted cells looked fine. Table nodes round-trip through the model passthrough and render in `@idco/content-renderer`.

### R2-C. Comments + Glossary — Done

- Inline comments via `@lexical/mark` `MarkNode` + `toolbar/comment-button.tsx`: a popover captures the comment body, then `$wrapSelectionInMarkNode` (generated id) highlights the range and the `onComment(id, quote, body)` binding notifies the host (threads live outside the doc). **The `onComment` binding is threaded through `RichTextEditor`'s props** — previously it was declared on the bindings type but never wired, so comments highlighted but never reached the host. Inline glossary via `nodes/glossary-node.tsx`: a tooltip shows the definition, and in editor mode clicking the term opens a popover to edit its term/definition or **remove it (which unwraps to plain text, keeping the word — it does not delete it)**. Wrapping a selection as a glossary term preserves any leading/trailing whitespace the selection swept up. Inline links: `plugins/link-plugin.tsx` adds a floating editor so a plain click on a link opens a popover to change it, clear (unlink) it, or open it in a new tab; **there is no `ClickableLinkPlugin`, so a click never navigates in the editor**. Both render in `@idco/content-renderer`.
- **Selection survives overlays.** `hooks/use-selection-restore.ts` snapshots the editor selection when a link/glossary/comment popover opens and refocuses the editor at that selection when it closes (React Aria otherwise returns focus to the off-editor trigger, losing the caret). Actions that mutate the document mark themselves handled so the restore does not clobber the post-edit selection.

## 11. Future Backlog

- Real-time collaboration (Yjs / `@lexical/yjs`).
- Full Markdown import/export and `.docx`/HTML paste fidelity.
- Equations/math, columns/multi-column layout, draggable block reordering.
- Find-and-replace, word count, autosave, version history.
- CodeMirror 6 swap behind the existing `CodeEditor` engine prop.

## 12. Definition Of Done

- `@idco/editor` exists with the modular layout; the editor no longer lives in `@idco/ui` source (or `@idco/ui` only re-exports without a cycle).
- A dedicated Ladle story renders the editor from `@idco/editor`.
- Caret can be placed before/after any block; quote/callout formatting is disabled per capabilities.
- `pnpm check` passes (format, lint, dup gate, typecheck, test, build).
- The persisted document JSON shape is unchanged; `@idco/content-renderer` still renders existing documents.
- This document's first-release backlog items (R1-A..R1-D) are implemented or explicitly deferred with a reason.

## 13. Final Model

`@idco/editor` is a product-neutral Lexical package built from small, single-concern modules: a shared schema, a per-block capability map, decorator blocks that behave like Confluence blocks, and one plugin per authoring feature — all styled with DaisyUI and behaving via React Aria. The persisted JSON contract is shared with `@idco/content-renderer`, so editing and rendering can never drift. Heavy features (tables, comments, glossary, slash/context menus) land as isolated plugins/nodes on top of a correct foundation.
