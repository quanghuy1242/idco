# 009 - Large Document Virtualized Editor Plan

> Status: implemented through R1-G
>
> Date: 2026-06-15
>
> Scope:
>
> - `packages/editor/src/RichTextEditor.tsx`
> - `packages/editor/src/model/schema.ts`
> - `packages/editor/src/model/normalize.ts`
> - `packages/editor/src/model/serialize.ts`
> - `packages/editor/src/plugins/editor-performance.ts`
> - `packages/editor/src/plugins/toc-entries.ts`
> - `packages/content-renderer/src/index.tsx`
> - `packages/lib/src/rich-text.ts`
> - `tests/e2e/editor-backspace.perf.spec.ts`
> - future `packages/editor/src/large-document/**`
>
> Source docs:
>
> - `docs/001_lexical_editor_architecture.md`
> - `docs/005_side_toc_rail.md`
> - `docs/008_editor_performance_contract.md`
> - Lexical docs: https://lexical.dev/docs/design
> - Lexical editor-state docs: https://lexical.dev/docs/concepts/editor-state
> - Lexical listener docs: https://lexical.dev/docs/concepts/listeners
> - Lexical read/edit mode docs: https://lexical.dev/docs/concepts/read-only
> - Lexical large-document issue: https://github.com/facebook/lexical/issues/7422
> - CodeMirror viewport reference: https://codemirror.net/docs/ref/
> - ProseMirror large-document discussion: https://discuss.prosemirror.net/t/different-parsing-strategy-for-large-documents/1017
> - ProseMirror many-editor discussion: https://discuss.prosemirror.net/t/how-to-handle-thousands-of-editor-instances-on-screen/8096
>
> Related docs:
>
> - `docs/002_gap_cursor_and_block_flow.md`
> - `docs/003_block_chrome_and_table_capabilities.md`
> - `docs/004_selection_flyout_and_context_actions.md`
> - `docs/006_editor_toolbar_redesign_plan.md`
> - `docs/007_node_contract_and_ui_hygiene.md`
>
> Assumptions:
>
> - Lexical remains the live rich-text editing engine for focused editing.
> - The persisted document JSON remains the source of truth.
> - `@idco/content-renderer` remains the read-side renderer and can be reused inside an authoring shell.
> - The first implementation should prove the virtualized shell and focused-section editing flow; benchmarks verify and tune the design, but should not block the architecture from being built.
> - Real-time collaboration is out of first-release scope, but the section model must not make future collaboration impossible.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Research Findings](#3-research-findings)
  - [3.1 Lexical Does Dirty Reconciliation, Not Viewport Virtualization](#31-lexical-does-dirty-reconciliation-not-viewport-virtualization)
  - [3.2 CodeMirror Is The Reference Point For True Viewport Rendering](#32-codemirror-is-the-reference-point-for-true-viewport-rendering)
  - [3.3 ProseMirror Guidance Supports Product-Level Segmentation](#33-prosemirror-guidance-supports-product-level-segmentation)
  - [3.4 What This Means For IDCO](#34-what-this-means-for-idco)
- [4. Current-State Findings](#4-current-state-findings)
  - [4.1 Relevant Files](#41-relevant-files)
  - [4.2 Current Editor Flow](#42-current-editor-flow)
  - [4.3 Current Renderer Flow](#43-current-renderer-flow)
  - [4.4 Current Performance Contract](#44-current-performance-contract)
  - [4.5 Current Gaps For 1000-5000 Advanced Blocks](#45-current-gaps-for-1000-5000-advanced-blocks)
- [5. Target Model](#5-target-model)
  - [5.1 Short Version](#51-short-version)
  - [5.2 Ownership Boundaries](#52-ownership-boundaries)
  - [5.3 Runtime Modes](#53-runtime-modes)
  - [5.4 Data Flow](#54-data-flow)
  - [5.5 Section Identity Model](#55-section-identity-model)
  - [5.6 Virtual Shell Rendering Model](#56-virtual-shell-rendering-model)
  - [5.7 Focused Section Editing Model](#57-focused-section-editing-model)
  - [5.8 Search, TOC, Comments, And Derived Indexes](#58-search-toc-comments-and-derived-indexes)
  - [5.9 Section Boundary Editing Semantics](#59-section-boundary-editing-semantics)
- [6. Architecture Decisions](#6-architecture-decisions)
  - [6.1 Recommended Approach](#61-recommended-approach)
  - [6.1.1 Phase 0 - Decorator Body Virtualization](#611-phase-0---decorator-body-virtualization)
  - [6.2 Rejected Or Deferred Options](#62-rejected-or-deferred-options)
  - [6.3 Non-Negotiable Invariants](#63-non-negotiable-invariants)
- [7. Proposed Package Layout](#7-proposed-package-layout)
- [8. Detailed Implementation Plan](#8-detailed-implementation-plan)
  - [8.1 Workstream A - Stable Node And Section Identity](#81-workstream-a---stable-node-and-section-identity)
  - [8.2 Workstream B - Sectionization And Merge Utilities](#82-workstream-b---sectionization-and-merge-utilities)
  - [8.3 Workstream C - Virtual Read Shell](#83-workstream-c---virtual-read-shell)
  - [8.4 Workstream D - Focused Section Editor](#84-workstream-d---focused-section-editor)
  - [8.5 Workstream E - Interaction And Commit Lifecycle](#85-workstream-e---interaction-and-commit-lifecycle)
  - [8.6 Workstream F - Derived Index Pipeline](#86-workstream-f---derived-index-pipeline)
  - [8.7 Workstream G - Large-Document Feature Gates](#87-workstream-g---large-document-feature-gates)
  - [8.8 Workstream H - Performance Instrumentation](#88-workstream-h---performance-instrumentation)
  - [8.9 Workstream I - Ladle Stories And Fixtures](#89-workstream-i---ladle-stories-and-fixtures)
- [9. User Experience Plan](#9-user-experience-plan)
- [10. Migration And Rollout](#10-migration-and-rollout)
- [11. Edge Cases And Failure Modes](#11-edge-cases-and-failure-modes)
- [12. Test And Verification Plan](#12-test-and-verification-plan)
- [13. Implementation Backlog](#13-implementation-backlog)
- [14. Future Backlog](#14-future-backlog)
- [15. Definition Of Done](#15-definition-of-done)
- [16. Final Model](#16-final-model)

## 1. Goal

Build a real large-document architecture for the IDCO rich-text editor so documents with 1000-5000 blocks, including advanced custom nodes, remain usable on lower-end devices.

The direction is a virtualized editor shell plus focused Lexical editing. This is not a request to benchmark first and delay the architecture. Benchmarks belong in the plan as verification and regression protection, not as a gate before building the first vertical slice.

The target user experience is:

- A large document opens quickly.
- Scrolling remains responsive because offscreen chunks are not fully rendered.
- Clicking a visible section turns that section into a live Lexical editor.
- Edits merge back into the single persisted document JSON.
- TOC, search, comments, and indexes operate from document data, not from assumptions that every node is present in the DOM.
- Existing small-document behavior remains unchanged unless the large-document mode is explicitly enabled by size thresholds or caller preference.

### Central Product Trade

The single most important decision in this plan is not a scope cut buried in non-goals. It is the defining interaction model:

> In large-document mode, exactly one section is live-editable at a time. Editing is entered by activating a section ("click to edit"), not by placing a caret anywhere in a single continuous editable surface.

This is a genuinely different editor from today's whole-document `RichTextEditor`. What makes Confluence/Notion feel like "one document" is that the caret moves freely and selection spans arbitrary blocks. The virtual shell trades that continuity for scale. That trade is acceptable and conventional (ProseMirror/Notion-class segmentation), but it must be evaluated as the primary UX bet, not discovered later.

Concrete consequences the team must accept up front:

- Selection, copy, and formatting that span a section boundary are not available in first release.
- Undo is section-scoped first; cross-section undo is a deliberate later layer (see [5.7](#57-focused-section-editing-model) and [6.3](#63-non-negotiable-invariants)).
- Caret operations at section edges (Enter at end, Backspace at start, delete across a boundary) need explicit rules, not default editor behavior (see [5.9](#59-section-boundary-editing-semantics)).

If the team is not willing to accept the click-to-edit model, the right move is to ship Phase 0 decorator virtualization (see [6.1.1](#611-phase-0---decorator-body-virtualization)) and stop there, because Phase 0 preserves the single continuous editing surface.

Non-goals for the first release:

- Full cross-section rich-text selection.
- Collaborative editing.
- Full document native browser find across virtualized content.
- One Lexical editor root that internally virtualizes arbitrary Lexical nodes.
- Forking Lexical core.

## 2. System Summary

Today, `RichTextEditor` owns one live Lexical composer for the entire document. The persisted value is normalized into `RichTextEditorDocument`, serialized into Lexical editor-state JSON, edited inside a single `ContentEditable`, then emitted back to the host through a debounced `OnChangePlugin` path. The content renderer separately walks the same JSON tree for read-side rendering.

The proposed large-document model adds an authoring shell above Lexical:

```text
host value
  -> normalizeDocument()
  -> ensureStableDocumentNodeIds()
  -> sectionizeDocument()
  -> VirtualRichTextDocumentShell
       -> visible read chunks rendered by @idco/content-renderer
       -> offscreen measured placeholders
       -> active chunk replaced by FocusedSectionEditor
            -> RichTextEditorSectionComposer / Lexical
            -> onSectionChange
            -> replaceDocumentSection()
  -> onChange(full document)
```

Lexical remains the precise editor for the active section. It is no longer responsible for keeping thousands of advanced blocks mounted inside one editable root.

## 3. Research Findings

### 3.1 Lexical Does Dirty Reconciliation, Not Viewport Virtualization

Lexical's public architecture describes an editor-state model with current and pending states, node transforms, reconciliation, and listeners. It batches updates and reconciles dirty paths into the DOM. That is valuable, and `docs/008_editor_performance_contract.md` already builds on it by moving our expensive derived work out of the hot path.

Lexical does not expose a CodeMirror-style viewport renderer for rich-text documents. In the large-document issue `facebook/lexical#7422`, a Lexical collaborator states that Lexical has no rendering virtualization, that Lexical nodes have DOM, and that history can be memory-heavy because it stores editor-state snapshots. The same discussion notes that decorator-node contents are the part that can realistically be virtualized without changing Lexical's core renderer.

Practical conclusion: do not implement first-release large-document support by trying to make one `LexicalComposer` render only the visible subset of its own `RootNode`. That path fights Lexical's model and is unlikely to be stable around selection, composition, history, tables, decorators, and mutation listeners.

### 3.2 CodeMirror Is The Reference Point For True Viewport Rendering

CodeMirror's reference manual explicitly says its editor view only draws visible code plus a margin around it to avoid memory and browser overload in large documents. That is true viewport rendering: the editor engine itself knows the visible ranges and owns the virtualized DOM model.

IDCO's rich-text editor does not have that capability from Lexical. The architectural lesson is still useful: a large document must not require the browser to maintain the full editable DOM. We need to apply that lesson at the product shell layer: virtualize sections/chunks, and mount a live editor only where active editing is happening.

### 3.3 ProseMirror Guidance Supports Product-Level Segmentation

ProseMirror maintainers have described full rich-text editor virtualization as out of scope for core, and have recommended structuring the product so large documents are divided into chapters/pages/sub-editors where appropriate. Recent discussion around hundreds of editor instances also points to the browser layout/editing cost as the real bottleneck, not only editor library code.

This maps well to IDCO because our document is already a JSON tree and `@idco/content-renderer` already renders the read side. We can segment at the document model boundary without changing the persisted format into a foreign editor-specific structure.

### 3.4 What This Means For IDCO

The plan is not "benchmark before acting." The plan is:

1. Build the virtualized shell and focused-section editing path.
2. Use benchmarks and Playwright scenarios to prove the new path solves the intended scale class.
3. Keep the existing single-editor path for small documents.
4. Avoid promising impossible native behavior, such as browser find seeing offscreen virtualized DOM.

The first vertical slice should prove the architecture with generated 1000-5000 block documents in Ladle, even before every advanced feature is polished.

## 4. Current-State Findings

### 4.1 Relevant Files

- `packages/editor/src/RichTextEditor.tsx`: one `LexicalComposer` for the entire normalized document, full plugin stack, debounced controlled `onChange`, source preview, and TOC rail state.
- `packages/editor/src/model/schema.ts`: canonical editor document/node shape. It has `type`, `text`, `children`, and rich fields such as `anchorId`, `mediaId`, `postId`, `url`, `tone`, `format`, TOC settings, and catch-all `[key: string]: unknown`.
- `packages/editor/src/model/normalize.ts`: coerces unknown input into canonical document JSON and ensures heading anchors.
- `packages/editor/src/model/serialize.ts`: converts canonical document JSON into Lexical editor-state JSON.
- `packages/editor/src/plugins/editor-performance.ts`: global scheduler, lanes, budgets, coalescing, chunk continuation, and `window.__IDCO_EDITOR_PERF__`.
- `packages/editor/src/plugins/toc-entries.ts`: TOC dirty guards and chunked entry building.
- `packages/editor/src/plugins/heading-anchor-plugin.tsx`: currently repairs heading anchors synchronously by walking headings.
- `packages/content-renderer/src/index.tsx`: read-side React renderer for the same document JSON.
- `packages/lib/src/rich-text.ts`: shared heading/TOC helpers used by editor and renderer.
- `tests/e2e/editor-backspace.perf.spec.ts`: current Playwright performance gate for repeated editing behavior.

### 4.2 Current Editor Flow

`RichTextEditor` normalizes `value` into `document`, serializes `document` into Lexical initial editor state, registers rich text nodes/plugins, and emits `onChange` through `useDebouncedEditorStatePublisher`. This means host document emission no longer runs on every keystroke, which fixes the immediate held-Backspace problem addressed by `docs/008`.

The editor still mounts the whole document in one Lexical root. Every decorator block, table, list, heading, mark, glossary node, and plugin surface belongs to one live contenteditable tree.

### 4.3 Current Renderer Flow

`renderRichTextDocument` in `packages/content-renderer/src/index.tsx` walks the full document tree recursively and renders React nodes for every node. It supports headings, paragraphs, lists, marks, glossary, tables, media, embeds, post references, callouts, code blocks, and TOC. It also mirrors the side-rail TOC layout by finding an aside TOC node and rendering `RichTextTocLayout`/`RichTextTocRail`.

This renderer is the correct base for virtual read chunks because it is product-neutral and already understands the persisted JSON contract. It is not virtualized today; it renders the entire passed document.

### 4.4 Current Performance Contract

`docs/008_editor_performance_contract.md` makes update subscribers declare lane, budget, cost, priority, and coalescing. It prevents raw update listeners, chunks TOC entry construction, and fails Playwright scenarios on scheduler over-budget runs or slow listener warnings.

That contract protects the editing hot path, but it does not reduce DOM size. It does not solve initial mount cost for 5000 custom blocks. It does not solve browser layout cost for thousands of rendered React/DOM subtrees.

### 4.5 Current Gaps For 1000-5000 Advanced Blocks

The current architecture still has these large-document limits:

- One Lexical root owns all document nodes.
- One React tree owns all decorator components mounted by Lexical decorators.
- One read-side renderer walks all nodes when used outside the editor.
- `HistoryPlugin` remains whole-editor-state oriented.
- Browser layout still sees the full editable document.
- Browser native find/search only works for DOM that exists, which becomes a product issue once virtualized.
- The document schema lacks stable per-node identity; root children are effectively index-addressed.
- Section-level merge semantics do not exist.
- TOC/search/comment indexes are document-wide helpers, not formal async indexes with versioning.

## 5. Target Model

### 5.1 Short Version

Large documents should be edited through a virtual shell:

- Offscreen sections are not live Lexical editors.
- Visible inactive sections render as read-only content chunks.
- One active section mounts a focused Lexical editor.
- Section edits merge back into the full document.
- Small documents keep the current single-editor behavior.

### 5.2 Ownership Boundaries

`packages/editor` owns:

- document sectionization
- virtual editor shell
- focused section editor
- active-section lifecycle
- edit/commit state
- performance dashboard integration
- large-document thresholds and feature gates

`packages/content-renderer` owns:

- read-only rendering of document chunks
- renderer options for media/post/embed resolution
- chunk-safe rendering behavior

`packages/lib` owns:

- pure document helpers that must be shared by editor and renderer
- heading/TOC helpers
- future section index/search helpers if they are product-neutral

`packages/ui` owns:

- product-neutral layout primitives used by the virtual shell
- no Lexical behavior
- no document-model ownership

### 5.3 Runtime Modes

The editor should support three explicit runtime modes:

1. `standard`: current whole-document `RichTextEditor`.
2. `large-document`: virtual shell plus focused section editor.
3. `read-shell`: virtualized read-only document shell with no editing, useful for preview/review surfaces.

Mode selection should be deterministic:

```ts
type RichTextEditorMode = "standard" | "large-document" | "read-shell";

type RichTextLargeDocumentPolicy = {
  readonly mode?: RichTextEditorMode | "auto";
  readonly maxStandardBlocks?: number;
  readonly maxStandardDecoratorBlocks?: number;
  readonly sectionHeadingLevels?: readonly number[];
  readonly fallbackBlocksPerSection?: number;
  readonly overscanSections?: number;
};
```

Default policy:

- `mode: "auto"`
- `maxStandardBlocks: 300`
- `maxStandardDecoratorBlocks: 80`
- `sectionHeadingLevels: [1, 2]`
- `fallbackBlocksPerSection: 50`
- `overscanSections: 2`

The exact thresholds should be tuned after the first vertical slice exists. They are configuration, not architectural blockers.

Accepted cost of `auto`: a document just below the threshold edits as one continuous surface with full selection, native find, and document undo; the same document one block over crosses into the section model with click-to-edit and section-scoped semantics. That is a real behavior cliff for documents near the boundary, and it doubles the behavioral test matrix because every feature must be verified in both modes. This is accepted deliberately, with three mitigations:

- Keep the threshold high enough that ordinary documents never approach it (the defaults target genuinely large documents, not medium ones).
- Add hysteresis so a document hovering at the boundary does not flip modes on small edits within one session.
- Prefer shipping Phase 0 ([6.1.1](#611-phase-0---decorator-body-virtualization)) first; if Phase 0 covers the real document sizes, `auto` may rarely or never select the section shell in practice, which shrinks the cliff's blast radius.

### 5.4 Data Flow

The full document stays as one value at the public API boundary:

```ts
type VirtualRichTextEditorProps = {
  readonly value: unknown;
  readonly onChange: (value: RichTextEditorDocument) => void;
  readonly label: string;
  readonly largeDocument?: RichTextLargeDocumentPolicy;
  readonly allowedNodes?: readonly string[];
  readonly allowedEmbedDomains?: readonly string[];
  readonly mediaLibrary?: RichTextEditorBindings["mediaLibrary"];
  readonly postLibrary?: RichTextEditorBindings["postLibrary"];
  readonly onUploadMedia?: RichTextEditorBindings["onUploadMedia"];
  readonly onComment?: RichTextEditorBindings["onComment"];
  readonly comments?: RichTextEditorBindings["comments"];
  readonly onCommentUpdate?: RichTextEditorBindings["onCommentUpdate"];
  readonly onCommentDelete?: RichTextEditorBindings["onCommentDelete"];
};
```

Internal large-document flow:

```ts
const document = normalizeDocument(value);
const identified = ensureDocumentNodeIds(document);
const sections = sectionizeDocument(identified, policy);
const indexes = buildDocumentIndexes(identified, sections);

// Inactive section:
renderRichTextDocument(section.document, rendererOptions);

// Active section:
<FocusedSectionEditor
  section={activeSection}
  onCommit={(nextSectionDocument) => {
    const nextDocument = replaceDocumentSection(identified, section.id, nextSectionDocument);
    onChange(nextDocument);
  }}
/>;
```

### 5.5 Section Identity Model

Virtual editing requires stable identity. Index paths are not enough because inserting a block before the active section shifts every later path.

Add a product-neutral optional ID field to persisted nodes:

```ts
type RichTextEditorNode = {
  readonly id?: string;
  readonly type: string;
  readonly children?: readonly RichTextEditorNode[];
  // existing fields...
};
```

ID rules:

- IDs are stable once assigned.
- IDs are unique within one document.
- IDs are generated for top-level nodes first.
- Child IDs are optional in the first release, except for comment/index targets that need them.
- Normalization preserves existing IDs.
- Normalization fills missing top-level IDs.
- Pasted content gets new IDs to avoid duplicates.
- IDs are not exposed as UI labels.

Suggested ID shape:

```ts
type RichTextNodeId = `rt_${string}`;
```

The exact generator can use `crypto.randomUUID()` where available and a deterministic fallback in tests. The ID generation helper belongs in `packages/editor/src/model/ids.ts` first; if `content-renderer` later needs it, move the pure pieces to `packages/lib/src/rich-text.ts`.

### 5.6 Virtual Shell Rendering Model

The shell should virtualize sections, not individual Lexical nodes. Each section has:

```ts
type RichTextDocumentSection = {
  readonly id: string;
  readonly ordinal: number;
  readonly title: string;
  readonly startBlockId: string;
  readonly endBlockId: string;
  readonly blockIds: readonly string[];
  readonly document: RichTextEditorDocument;
  readonly headingAnchorId?: string;
  readonly level?: 1 | 2 | 3 | 4 | 5 | 6;
  readonly estimatedHeight: number;
};
```

Rendering behavior:

- Visible inactive sections render through `renderRichTextDocument(section.document, options)`.
- Active section renders through `FocusedSectionEditor`.
- Offscreen sections render as placeholders with cached heights.
- Height cache is keyed by section ID and content signature.
- ResizeObserver updates measured heights after visible sections render.
- Overscan renders N sections before/after the visible window.
- Scroll anchoring keeps the active section stable when a previous section height changes.

Scroll stability is the highest-risk part of this workstream and should be budgeted as such, not treated as a solved detail. Dynamic measurement of richly variable content drifts in practice: late-loading images, code blocks, and tables change height after first paint, and a wrong estimate for an offscreen section above the viewport shifts everything below it. Concrete requirements:

- Estimated heights must be conservative and per-block-type, and the height cache must be authoritative once a section has actually been measured.
- "Scroll to section / search result / TOC target" must scroll by section ID and then correct position after the target section measures, because the pre-measurement estimate will usually be wrong.
- Disable browser scroll-restoration for the shell container; restore scroll from section ID, not pixel offset.
- Add a Playwright assertion that scrolling top-to-bottom-to-top returns to a stable position, to catch cumulative drift as a regression.

Virtualization library:

- Prefer `@tanstack/react-virtual` for first implementation if adding a dependency is acceptable.
- If avoiding a dependency, implement a small section virtualizer with `scrollTop`, measured heights, binary search over cumulative heights, and overscan.
- The dependency decision should be made at implementation time, but the shell API should not leak the chosen virtualizer.

### 5.7 Focused Section Editing Model

`FocusedSectionEditor` is a section-scoped Lexical editor. It receives a section document and emits a section document.

```ts
type FocusedSectionEditorProps = {
  readonly section: RichTextDocumentSection;
  readonly onChange: (section: RichTextEditorDocument) => void;
  readonly onCommit: (section: RichTextEditorDocument) => void;
  readonly onCancel?: () => void;
  readonly bindings: RichTextEditorBindings;
  readonly allowedNodes: readonly string[];
};
```

Commit lifecycle:

1. User activates a section by click, keyboard command, or TOC navigation.
2. Shell mounts `FocusedSectionEditor` in place of the read chunk.
3. Lexical initializes from the section document.
4. Section edits debounce through the existing scheduler.
5. The shell keeps a dirty section draft.
6. On blur, explicit save, section switch, or host save, the draft merges into the full document.
7. The read shell re-renders the committed chunk.

Important behavior:

- Only one active Lexical section should exist in the first release.
- Switching active sections must flush/commit the previous active section.
- The active editor should keep its local Lexical `HistoryPlugin` for section-level undo.
- Full-document undo is a separate future layer, and the section-scoped limitation is user-visible (see [6.3](#63-non-negotiable-invariants)). Treat it as a candidate to pull forward if it tests badly, not a guaranteed deferral.
- The active section should overscan/mount neighbor read chunks, not neighbor editors.

### 5.8 Search, TOC, Comments, And Derived Indexes

Virtualization means DOM presence is no longer a reliable source of truth. Derived features must read the document JSON.

Required indexes:

```ts
type RichTextDocumentIndexes = {
  readonly version: number;
  readonly sections: readonly RichTextDocumentSection[];
  readonly headings: readonly RichTextHeadingIndexEntry[];
  readonly comments: readonly RichTextCommentIndexEntry[];
  readonly textRuns: readonly RichTextTextRunIndexEntry[];
};
```

TOC:

- Keep using `collectRichTextTocEntries`.
- Add section ID and heading node ID to heading index entries.
- TOC click should scroll to a section, activate only if requested, and then focus/select the target heading if entering edit mode.

Search:

- First release should implement shell search from JSON text.
- Search results should include section ID, node ID/path, preview text, and offsets.
- Selecting a search result scrolls to the section, activates it, and then maps the result to a Lexical selection when possible.
- Native browser find is not enough because virtualized offscreen DOM is absent.

Comments:

- Comment marks should be indexed from JSON.
- Clicking a comment in a side panel scrolls to and activates the containing section.
- Cross-section comments are deferred unless the mark model already guarantees one section.

### 5.9 Section Boundary Editing Semantics

Section-scoped editing is free everywhere except at the two edges of the active section. Those edge cases are where block-segmented editors historically break, so they are specified here as first-class behavior rather than discovered during implementation.

The active section editor only owns its own blocks. Any caret operation that would cross into an adjacent section is a shell-level operation, not a Lexical-internal one. Default rules for first release:

- **Enter at end of last block in the active section.** Stays within the section: a new empty block is appended to the active section document. It does not spill into the next section. Rationale: the next section is not mounted, and the user's intent is almost always "keep writing here."
- **Backspace at start of first block in the active section (collapsed selection).** Two acceptable behaviors; pick one and keep it deterministic:
  1. **No-op-with-affordance (recommended for first release):** the caret does nothing and the shell shows a subtle "merge with previous section" affordance. Simple, never silently mutates an unmounted section.
  2. **Auto-merge:** commit the active section, then re-sectionize so the boundary heading/blocks fold into the previous section, then re-activate. Correct-feeling but requires re-sectionization mid-edit and careful caret restoration. Defer unless user testing demands it.
- **Delete-forward at end of last block.** Mirror of Backspace-at-start: no-op-with-affordance in first release.
- **Range selection that would extend past a section edge.** The active editor clamps selection to its own root. Selection cannot grow into an inactive chunk. Inactive chunks may still be selected by the browser as read-only text (for copy), but that selection is not an editable range.
- **Typing/paste that structurally splits across the boundary.** Not possible, because the active editor cannot address blocks outside its section. Paste lands entirely inside the active section.

Re-sectionization triggers must be explicit. A commit that changes the active section's block count (added/removed top-level blocks) re-runs `sectionizeDocument` against the full document so the fallback size cap and heading boundaries stay correct. This is the only place section membership changes, which keeps merge deterministic.

Open question to resolve during Workstream D/E: whether the no-op-with-affordance edges feel acceptable in the `MixedBook` Ladle story, or whether auto-merge must be pulled into first release. Decide from the fixture, not from theory.

## 6. Architecture Decisions

### 6.1 Recommended Approach

Use a virtualized document shell with focused section editing.

Reasons:

- It directly reduces DOM and React subtree size.
- It keeps Lexical in the role it handles well: precise editing of a bounded active document.
- It reuses the existing persisted JSON shape.
- It reuses `@idco/content-renderer`.
- It creates a durable product-level architecture for books/long documents.
- It avoids relying on unsupported Lexical internals.

The first release should be built as a new large-document surface, not by replacing the current `RichTextEditor` path. The shell can internally reuse existing pieces and later become the default when thresholds are exceeded.

### 6.1.1 Phase 0 - Decorator Body Virtualization

Before building the section shell, ship a cheaper milestone that may capture most of the win with none of the interaction-model cost.

The dominant cost in IDCO documents is not plain text. Lexical handles a few thousand paragraphs acceptably. The cost is decorator nodes, and IDCO has many: `media-node`, `embed-node`, `code-block-node` (Prism), `glossary-node`, `callout-node`, `post-ref-node`, `table-node`, `table-of-contents-node`. Each mounts a React subtree. One thousand decorator blocks is the realistic pain class, and `facebook/lexical#7422` explicitly notes that decorator contents are the part that can be virtualized without changing Lexical's core renderer.

Phase 0 approach:

- Keep the current single `LexicalComposer` and the whole-document editing surface.
- Wrap each decorator node body in an offscreen-aware renderer: when the decorator's host element is outside the viewport plus margin, render a cheap measured placeholder instead of the full React body; restore the real body when it scrolls near.
- Use one shared `IntersectionObserver`/viewport tracker rather than per-node listeners.
- Cache each decorator's measured height by node ID and content signature so placeholders do not cause layout jump.
- The persisted JSON, selection, undo, and native browser find are all unchanged because the Lexical node tree is unchanged. Only the decorator's rendered body is swapped for a placeholder.

Why this matters to sequencing:

- It preserves the single continuous editing surface, so it sidesteps the central trade in [Central Product Trade](#central-product-trade), the boundary-edit rules in [5.9](#59-section-boundary-editing-semantics), and the section-scoped undo limitation entirely.
- It is strictly smaller than the section shell and reuses the same height-cache and signature primitives the shell needs ([height-cache.ts](#7-proposed-package-layout), `signatures.ts`), so the work is not throwaway.
- If Phase 0 plus the existing `docs/008` hot-path contract is enough for the real document sizes in production, the section shell can stay deferred indefinitely. Measure after Phase 0 before committing to the shell.

Limits of Phase 0 (why it is not the whole answer):

- It does not reduce the number of element nodes (paragraphs, headings, list items) in the live DOM. A document that is 5000 plain paragraphs is still a 5000-node contenteditable.
- It does not reduce `HistoryPlugin` snapshot memory.
- It does not bound initial mount of the element tree, only decorator bodies.

So Phase 0 is the right first ship for decorator-heavy documents, and the section shell remains the answer for documents that are large in raw block count. Build Phase 0 first, measure, and let the data decide how far the shell needs to go.

### 6.2 Rejected Or Deferred Options

Rejected for first release: virtualize arbitrary children inside one live Lexical root.

- Lexical owns the contenteditable DOM and expects registered nodes to reconcile into that root.
- Selection, IME, mutation observers, tables, history, decorators, and plugins depend on the live tree.
- Lexical does not provide a public hook to render only a viewport slice of the root.

Rejected as the main strategy: optimize only listeners and derived work.

- `docs/008` already addresses the immediate hot-path issue.
- That work does not reduce DOM size or initial mount cost for thousands of blocks.

Deferred: fork Lexical or wait for upstream large-document internals.

- The upstream issue discusses possible NodeMap/keyToDOMMap data-structure work, but that does not provide full rich-text viewport rendering.
- Forking core would be high maintenance and still would not solve product features such as virtualized search and section-level editing UX.

Deferred: multiple always-mounted Lexical editors, one per section.

- This avoids one giant root but still mounts too many editors if the document has hundreds of sections.
- It creates many plugin stacks, histories, event handlers, and React subtrees.
- It is acceptable only for visible/active sections.

Deferred: custom canvas editor.

- It would require reimplementing selection, accessibility, IME, clipboard, tables, screen-reader behavior, and rich-text semantics.
- It is not aligned with the current package architecture.

### 6.3 Non-Negotiable Invariants

- The public value remains one `RichTextEditorDocument`.
- Stable IDs are preserved across normalize/serialize/render.
- **Stable top-level IDs and JSON-derived indexes are adopted in the standard editor immediately, not gated behind large-document mode.** They carry no UX cost, and gating them lets new features keep baking in the "every node is mounted / addressed by index" assumption that this whole plan exists to remove (see [context.md](../context.md) and [10. Migration And Rollout](#10-migration-and-rollout) Phase 1). The boundary is established for all paths now; only the virtual rendering is phased.
- Inactive virtual chunks are read-only and never pretend to be editable.
- The active section is the only live editable Lexical root in first release.
- All cross-section derived behavior reads document JSON or formal indexes, not offscreen DOM.
- Section merge is deterministic and guarded against stale drafts.
- **Undo is section-scoped in first release, and this is a user-visible limitation, not an internal detail.** After editing section A then section B, `Ctrl+Z` operates on the active section only; a committed change to a previously-active section is not reachable by undo until the document-level undo layer exists. This must be stated in user-facing docs and is a candidate for pulling forward if it tests badly (see [5.7](#57-focused-section-editing-model)).
- Existing small-document editor behavior remains available.
- No product-specific code enters `packages/editor`, `packages/lib`, `packages/content-renderer`, or `packages/ui`.

## 7. Proposed Package Layout

Add a large-document folder under `packages/editor/src`:

```text
packages/editor/src/
  large-document/
    index.ts
    policy.ts
    ids.ts
    signatures.ts
    sectionize.ts
    merge-section.ts
    indexes.ts
    height-cache.ts
    virtual-range.ts
    VirtualRichTextDocumentShell.tsx
    FocusedSectionEditor.tsx
    SectionReadChunk.tsx
    SectionPlaceholder.tsx
    LargeDocumentToolbar.tsx
    use-large-document-controller.ts
```

Suggested ownership:

- `policy.ts`: thresholds and mode selection.
- `ids.ts`: ensure/generate node IDs.
- `signatures.ts`: cheap section content signatures for height cache invalidation.
- `sectionize.ts`: split document into section documents.
- `merge-section.ts`: replace a section in the full document.
- `indexes.ts`: headings/comments/search text runs.
- `height-cache.ts`: measured and estimated section heights.
- `virtual-range.ts`: virtual range calculation if not using a library.
- `VirtualRichTextDocumentShell.tsx`: main large-document surface.
- `FocusedSectionEditor.tsx`: active-section Lexical wrapper.
- `SectionReadChunk.tsx`: renderer wrapper for inactive visible section.
- `SectionPlaceholder.tsx`: offscreen height placeholder.
- `LargeDocumentToolbar.tsx`: shell-level search, section navigation, mode controls.
- `use-large-document-controller.ts`: active section, drafts, commit, scroll and index state.

Public exports from `packages/editor/src/index.ts`:

```ts
export { RichTextEditor } from "./RichTextEditor";
export { VirtualRichTextEditor } from "./large-document";
export type {
  RichTextLargeDocumentPolicy,
  RichTextDocumentSection,
  RichTextDocumentIndexes,
} from "./large-document";
```

## 8. Detailed Implementation Plan

### 8.1 Workstream A - Stable Node And Section Identity

Current problem:

- The document shape does not guarantee stable node IDs.
- Sectionization and merge would need fragile index paths.
- Pasting or external values can introduce duplicate IDs once IDs exist.

Target behavior:

- Every top-level root child has a stable `id`.
- IDs survive editor round-trips.
- Missing IDs are filled during normalization.
- Duplicate IDs are repaired.

Implementation tasks:

- Add `id?: string` to `RichTextEditorNode` in `packages/editor/src/model/schema.ts`.
- Add `packages/editor/src/large-document/ids.ts`.
- Implement `ensureDocumentNodeIds(document, options?)`.
- Implement duplicate repair with a document-local `Set`.
- Preserve IDs in `normalizeNode`.
- Ensure `lexicalNode` passes IDs through for supported element/decorator nodes.
- Ensure decorator block export keeps ID in `__data` where appropriate.
- Add tests for missing IDs, duplicate IDs, paste-like duplicated subtrees, and serialize/normalize round-trip.

Tests:

- `tests/editor/large-document-ids.test.ts`
- Existing `tests/editor/serialize-table.test.tsx`
- Existing `tests/content-renderer.test.tsx`

Acceptance criteria:

- A normalized document with 5000 root children has 5000 unique top-level IDs.
- Re-normalizing the same document does not churn IDs.
- A duplicated subtree receives repaired IDs only where needed.

### 8.2 Workstream B - Sectionization And Merge Utilities

Current problem:

- There is no formal section model.
- TOC has headings, but headings are not used as editing boundaries.
- A section draft cannot be merged back safely.

Target behavior:

- A pure helper splits a document into stable sections.
- A pure helper replaces a section in the full document.
- Section boundaries are deterministic.

Implementation tasks:

- Add `packages/editor/src/large-document/sectionize.ts`.
- Add `packages/editor/src/large-document/merge-section.ts`.
- Define `RichTextDocumentSection`.
- Implement heading-based sectionization:
  - An `h1` or `h2` starts a section by default.
  - Content before the first heading becomes an intro section.
  - A section includes its boundary heading and following blocks until the next same-or-higher configured section heading.
- Implement fallback sectionization:
  - If heading sections are too large or absent, split every `fallbackBlocksPerSection` top-level blocks.
  - Never split inside table rows/cells because root children are top-level blocks only.
- Enforce a hard section-size cap so heading-based sectionization cannot reintroduce the original problem. A document with one `h1` followed by 2000 paragraphs would otherwise produce one 2000-block section, i.e. one giant Lexical root when activated, which is exactly what the shell exists to prevent. Rules:
  - After heading-based sectionization, any section whose block count exceeds `fallbackBlocksPerSection` is sub-split into deterministic chunks of at most `fallbackBlocksPerSection` blocks.
  - Sub-split sections keep the parent heading's identity for TOC/anchor purposes but get distinct section IDs (for example a stable `:partN` suffix), so TOC still points at the heading while editing stays bounded.
  - Sub-splitting is deterministic and content-derived so the same document always produces the same section boundaries, which keeps merge and height-cache keys stable.
  - Document the resulting nuance: a single heading can map to multiple editable sections. This is acceptable because activation is per-section, but it must be visible in diagnostics and must not confuse the heading index ([5.8](#58-search-toc-comments-and-derived-indexes)).
- Implement `replaceDocumentSection(document, sectionId, sectionDocument, expectedVersion?)`.
- Preserve blocks outside the section by object identity where possible.
- Return a conflict result when section IDs no longer match the draft's expected block IDs.

Example types:

```ts
type ReplaceSectionResult =
  | { readonly ok: true; readonly document: RichTextEditorDocument }
  | { readonly ok: false; readonly reason: "missing-section" | "stale-section" };
```

Tests:

- `tests/editor/large-document-sectionize.test.ts`
- `tests/editor/large-document-merge-section.test.ts`

Acceptance criteria:

- A heading-structured document splits predictably.
- A no-heading document splits by block count.
- Replacing one section does not reorder or mutate other sections.
- Stale section replacement fails with a typed reason.

### 8.3 Workstream C - Virtual Read Shell

Current problem:

- `content-renderer` renders every node it receives.
- The editor shell always mounts the whole document.

Target behavior:

- The shell renders only visible sections plus overscan.
- Offscreen sections occupy measured placeholder height.
- Inactive visible sections use `@idco/content-renderer`.

Implementation tasks:

- Add `VirtualRichTextDocumentShell.tsx`.
- Add `SectionReadChunk.tsx`.
- Add `SectionPlaceholder.tsx`.
- Add `height-cache.ts`.
- Add `virtual-range.ts` or integrate `@tanstack/react-virtual`.
- Wrap each section in a stable keyed container with `data-section-id`.
- Use `ResizeObserver` to measure rendered section height.
- Cache height by `{ sectionId, signature }`.
- Use an estimated height for unseen sections:
  - base height per block type
  - higher estimate for media, code, table, embed, and callout blocks
  - fallback minimum height
- Preserve scroll position when measurement updates above the viewport.

Tests:

- `tests/editor/large-document-virtual-range.test.ts`
- `tests/editor/large-document-height-cache.test.ts`
- Playwright story smoke for 1000 generated blocks.

Acceptance criteria:

- The DOM contains visible section chunks plus overscan, not all sections.
- Scrolling updates visible sections without remounting active editor.
- Placeholder heights converge as sections are measured.

### 8.4 Workstream D - Focused Section Editor

Current problem:

- `RichTextEditor` can only edit the whole document.
- It renders label, TOC layout, source preview, and full plugin stack around one root.

Target behavior:

- A section-scoped editor can mount inside a virtual shell.
- It reuses Lexical nodes/plugins where appropriate.
- It emits section documents, not full documents.

Implementation tasks:

- Extract a composer-level component from `RichTextEditor.tsx`, for example `RichTextEditorComposer`.
- Keep public `RichTextEditor` as the whole-document wrapper.
- Add `FocusedSectionEditor.tsx` that uses the extracted composer with:
  - no read-only JSON source preview
  - no document-level side TOC rail by default
  - large-document-safe plugin policy
  - section-scoped `onChange`
- Decide which plugins remain enabled in section mode:
  - keep text/list/table/link/mark/glossary/basic blocks
  - keep toolbar/slash/context menu if needed
  - keep gap cursor/block controls inside the section
  - disable document side rail plugin inside focused sections
  - make heading anchor repair local or transform-based
- Add `onCommit`, `onCancel`, and `flush` behavior.

Tests:

- `tests/editor/focused-section-editor.test.tsx`
- Existing editor tests for insertion, table, glossary, comments, and selection.

Acceptance criteria:

- A section document can be edited independently.
- The emitted section document can be merged into the full document.
- Existing rich-text features still work inside the active section.

### 8.5 Workstream E - Interaction And Commit Lifecycle

Current problem:

- There is no active section state.
- There is no draft/commit lifecycle.
- There is no explicit behavior for switching sections while dirty.

Target behavior:

- Clicking an inactive section activates it.
- The active section saves on blur, section switch, host save, or explicit command.
- Dirty drafts are protected from stale replacement.

Implementation tasks:

- Add `use-large-document-controller.ts`.
- Track:
  - `activeSectionId`
  - `draftBySectionId`
  - `documentVersion`
  - `pendingCommit`
  - `sectionIndexes`
  - `scrollTarget`
- Add `activateSection(sectionId, intent?)`.
- Add `commitActiveSection(reason)`.
- Add `cancelActiveSection()` for escape/revert.
- Add version guard:
  - when section activates, capture section signature/block IDs
  - when commit runs, compare current section signature/block IDs
  - fail gracefully if stale
- Add host imperative flush hook if needed:
  - `ref.flushPendingSection()`

Tests:

- `tests/editor/large-document-controller.test.ts`
- Playwright: click section, type, switch section, verify full document JSON changed once.

Acceptance criteria:

- Switching active sections commits the previous draft.
- Stale commits do not overwrite unrelated document changes.
- Escape/cancel returns to read chunk without mutating full document.

### 8.6 Workstream F - Derived Index Pipeline

Current problem:

- TOC and renderer helpers traverse the whole document in direct calls.
- Search does not exist as a virtualized JSON index.
- Comments are host-owned but not section-indexed.

Target behavior:

- The shell builds and updates document indexes outside the critical editing path.
- TOC/search/comment navigation works even when DOM chunks are offscreen.

Implementation tasks:

- Add `indexes.ts`.
- Build heading index:
  - section ID
  - node ID or path
  - heading level/tag
  - text
  - anchor ID
- Build text run index:
  - section ID
  - node ID/path
  - plain text
  - offsets
- Build comment index:
  - mark IDs
  - section ID
  - preview text
- Integrate with `createEditorSchedulerTask` for chunked index construction.
- Add versioning so stale index results are ignored.
- Wire TOC click:
  - scroll to section
  - optionally activate section
  - select/focus heading when active editor is ready
- Add first-pass shell search:
  - query JSON text index
  - show results outside contenteditable
  - selecting a result scrolls and activates target section

Tests:

- `tests/editor/large-document-indexes.test.ts`
- Playwright: search result outside current viewport scrolls to target and activates section.

Acceptance criteria:

- TOC navigation does not depend on offscreen DOM.
- Search finds text in offscreen sections.
- Index work can yield and resume under scheduler budget.

### 8.7 Workstream G - Large-Document Feature Gates

Current problem:

- All editor chrome and plugins assume the whole editor is live.
- Heavy affordances can become expensive in large documents.

Target behavior:

- Large-document mode uses a deliberate plugin/chrome policy.
- Nonessential features degrade gracefully.

Implementation tasks:

- Add `policy.ts`.
- Implement `documentScale(document)`:
  - root block count
  - decorator block count
  - table cell count
  - total text length
  - heading count
- Add `selectEditorMode(document, policy)`.
- Add `LargeDocumentFeaturePolicy`:

```ts
type LargeDocumentFeaturePolicy = {
  readonly sourcePreview: "disabled" | "debounced";
  readonly sideTocRail: "shell-index" | "disabled";
  readonly blockChrome: "active-section-only" | "visible-sections";
  readonly decoratorBodies: "visible-only" | "always";
  readonly history: "section" | "document";
};
```

- Disable read-only JSON source preview in large-document mode.
- Keep block handles/chrome active-section-only at first.
- Ensure decorator-heavy chunks can render read placeholders or lightweight renderer variants if needed.

Tests:

- `tests/editor/large-document-policy.test.ts`

Acceptance criteria:

- Documents above threshold enter large-document mode in `auto`.
- Feature policy is visible in dev diagnostics.
- Small documents keep current behavior.

### 8.8 Workstream H - Performance Instrumentation

Current problem:

- `docs/008` tracks editor update listeners but not virtual shell metrics.

Target behavior:

- Large-document shell metrics appear in the same diagnostics story and Playwright artifacts.

Implementation tasks:

- Extend `window.__IDCO_EDITOR_PERF__` or add a sibling dashboard field for:
  - mode
  - section count
  - rendered section count
  - active section ID
  - measured height count
  - section activation time
  - section commit time
  - index build duration
  - full document block count
  - decorator block count
- Add Playwright scenarios:
  - initial load 1000 paragraph blocks
  - initial load 5000 paragraph blocks
  - initial load 1000 decorator blocks
  - scroll through 5000 blocks
  - activate middle section and type
  - activate offscreen search result
- Keep benchmark thresholds as regression guardrails after the feature exists.

Tests:

- `tests/e2e/editor-large-document.perf.spec.ts`

Acceptance criteria:

- CI artifacts show virtual shell metrics.
- Perf tests prove DOM section count is bounded during scroll.
- Perf tests prove active-section typing stays within existing editor responsiveness budgets.

### 8.9 Workstream I - Ladle Stories And Fixtures

Current problem:

- There is no story that exercises huge documents or virtual section editing.

Target behavior:

- Ladle makes the architecture visible and manually testable.

Implementation tasks:

- Add fixture generator:
  - paragraphs
  - headings
  - mixed decorator blocks
  - tables
  - comments/marks
  - glossary terms
- Add stories:
  - `LargeDocument.Paragraphs1000`
  - `LargeDocument.Paragraphs5000`
  - `LargeDocument.Decorators1000`
  - `LargeDocument.MixedBook`
  - `LargeDocument.SearchAndToc`
- Show diagnostics panel:
  - block count
  - section count
  - rendered section count
  - active section
  - last commit duration

Tests:

- Playwright smoke against the new Ladle story.

Acceptance criteria:

- A reviewer can open the story, scroll a huge document, activate a section, type, and see the full JSON update.

## 9. User Experience Plan

Large-document editing should feel like one document, but it must be honest about editing focus.

Primary interaction:

1. User scrolls the document.
2. Visible sections render read-only but look like normal document content.
3. Hover/focus shows a subtle "Edit section" affordance or direct click-to-edit behavior.
4. Activating a section swaps the read chunk for Lexical in place.
5. Toolbar and slash/context actions work inside that active section.
6. Leaving the section commits it and returns it to read rendering.

Visual states:

- Inactive visible section: normal read rendering, no heavy editor chrome.
- Hovered section: lightweight section boundary affordance.
- Active clean section: editor chrome visible.
- Active dirty section: save/commit state visible in shell diagnostics or subtle status.
- Committing section: prevent section switch races; show brief pending state if needed.
- Commit conflict: keep the draft active and show recoverable conflict state.

Keyboard behavior:

- Tab/Shift+Tab inside active editor remains editor behavior.
- Escape cancels section editing if no popover/menu owns Escape.
- Ctrl/Cmd+S flushes active section and calls host save path if exposed.
- Search shortcut should open shell search, not rely on browser find for virtualized content.

Selection behavior:

- First release supports rich selection inside one active section.
- Cross-section selection can fall back to read-only browser selection on inactive chunks, but formatting/editing across sections is deferred.
- Drag block across sections is deferred.

Accessibility:

- Inactive chunks should not claim `contenteditable`.
- Active editor should keep Lexical's accessibility semantics.
- Section activation controls need labels such as "Edit section: {title}".
- Search results and TOC navigation must move focus predictably.

## 10. Migration And Rollout

Phase 0: Decorator body virtualization in the existing editor.

- Ship [6.1.1](#611-phase-0---decorator-body-virtualization) first: offscreen decorator bodies render measured placeholders inside the current single Lexical root.
- No new editing surface, no section model, no change to selection/undo/find.
- Measure decorator-heavy documents (1000 decorator blocks) after this lands.
- Gate the decision to build the section shell on this measurement. If Phase 0 plus `docs/008` covers real production sizes, later phases can stay deferred.

Phase 1: Add pure model helpers, and adopt the invariants in the standard editor.

- IDs, sectionization, merge, indexes.
- Stable top-level IDs and JSON-derived indexes are turned on for the standard `RichTextEditor` immediately, not only for large-document mode. This costs no UX change and stops new features from baking in index-addressing and DOM-presence assumptions (see [6.3](#63-non-negotiable-invariants)).
- Other helpers (sectionize/merge) are added but unused by UI in this phase.
- Existing editor tests continue to pass.

Phase 2: Add virtual read shell.

- Read-only virtual shell renders existing documents.
- Add Ladle story.
- No editing yet.

Phase 3: Add focused section editor.

- Click a section, edit it, commit back.
- Keep behind explicit `largeDocument={{ mode: "large-document" }}`.

Phase 4: Add auto mode.

- `RichTextEditor` chooses large-document mode when document scale exceeds thresholds.
- Small documents remain on standard editor.

Phase 5: Add shell search/TOC/comment index integration.

- Replace DOM-dependent behavior with index-backed behavior for virtual mode.

Rollback:

- Because the persisted document remains one JSON shape, rollback is straightforward if IDs are allowed fields.
- If IDs are added to persisted documents, older renderers should ignore them via `[key: string]: unknown`.
- Keep standard `RichTextEditor` export untouched until large-document mode is proven.

## 11. Edge Cases And Failure Modes

- Missing node IDs: normalization assigns them before sectionization.
- Duplicate node IDs: normalization repairs duplicates and preserves the first occurrence.
- Empty document: sectionization returns one empty editable section.
- No headings: fallback block-count sections.
- One massive table: table remains one section; do not split table internals in first release.
- One huge code block: section remains huge; code editor internals may need separate virtualization later.
- Media height changes after load: ResizeObserver updates height cache and scroll anchoring adjusts.
- Active section deleted externally: commit returns `missing-section`; UI keeps draft and offers recovery.
- Active section moved externally: commit returns `stale-section`; UI keeps draft and offers manual retry.
- TOC target in inactive section: scroll to section first; activate only if edit intent is requested.
- Search result in offscreen section: scroll by section ID, then activate and resolve node path/ID.
- Browser native find: cannot be complete in virtualized mode; shell search is required.
- Enter at end of active section: appends a block within the section; does not spill into the next section (see [5.9](#59-section-boundary-editing-semantics)).
- Backspace at start of active section: no-op-with-affordance in first release; auto-merge into the previous section is deferred.
- Delete-forward at end of active section: no-op-with-affordance, mirror of Backspace-at-start.
- Range selection extending past a section edge: clamped to the active section root; inactive chunks remain read-only browser-selectable text only.
- Active section block count changes on commit: triggers re-sectionization so the size cap and heading boundaries stay correct; this is the only path that changes section membership.
- IME composition during section switch: defer commit/switch until composition ends.
- Undo after section commit: section-local undo works while active; full-document undo is future work.
- Copy/paste across sections: native copy works for visible DOM only; structured cross-section copy is future work.
- Print/export: use full `@idco/content-renderer` or an export-specific full render path, not the virtual shell DOM.

## 12. Test And Verification Plan

Unit tests:

- `tests/editor/large-document-ids.test.ts`
- `tests/editor/large-document-sectionize.test.ts`
- `tests/editor/large-document-merge-section.test.ts`
- `tests/editor/large-document-indexes.test.ts`
- `tests/editor/large-document-policy.test.ts`
- `tests/editor/large-document-virtual-range.test.ts`
- `tests/editor/large-document-height-cache.test.ts`

Component tests:

- `tests/editor/focused-section-editor.test.tsx`
- `tests/editor/virtual-rich-text-shell.test.tsx`

E2E tests:

- `tests/e2e/editor-large-document.perf.spec.ts`

Required scenarios:

- Load 1000 paragraph blocks.
- Load 5000 paragraph blocks.
- Load 1000 decorator-heavy blocks.
- Scroll from top to middle to bottom.
- Activate middle section and type.
- Commit active section and verify full JSON update.
- Search for text outside the current viewport and activate result.
- TOC click to heading outside the current viewport.

Verification commands:

```sh
pnpm test
pnpm test:e2e:editor
pnpm check
```

Performance expectations:

- Rendered section count remains bounded by viewport plus overscan.
- Active section typing uses the existing editor perf budget from `docs/008`.
- Initial large-document shell mount should scale with section count metadata plus visible chunks, not full block DOM.
- Scroll should not mount all sections.

## 13. Implementation Backlog

### R0. Decorator Body Virtualization (ship first)

Scope:

- `packages/editor/src/nodes/decorator-block.tsx`
- `packages/editor/src/nodes/base.tsx`
- `packages/editor/src/large-document/height-cache.ts`
- `packages/editor/src/large-document/signatures.ts`
- `tests/e2e/editor-large-document.perf.spec.ts`

Tasks:

- [x] Add a shared viewport tracker (`IntersectionObserver`) for decorator hosts.
- [x] Render measured placeholders for offscreen decorator bodies; restore real bodies near the viewport.
- [x] Cache decorator height by node ID and content signature to prevent layout jump.
- [x] Verify selection, undo, and native find are unchanged (single root, unchanged node tree).
- [x] Add a 1000-decorator-block perf scenario and measure before deciding on the section shell.

Acceptance criteria:

- 1000-decorator-block document mounts and scrolls within budget without mounting all decorator bodies.
- No change to persisted JSON, selection, undo, or browser find.
- Measurement recorded so the team can decide whether the section shell is still needed.

Tests:

- `pnpm test:e2e:editor`

### R1-A. Stable Document IDs

Scope:

- `packages/editor/src/model/schema.ts`
- `packages/editor/src/model/normalize.ts`
- `packages/editor/src/model/serialize.ts`
- `packages/editor/src/large-document/ids.ts`
- `tests/editor/large-document-ids.test.ts`

Tasks:

- [x] Add optional `id` to `RichTextEditorNode`.
- [x] Preserve IDs through normalize/serialize.
- [x] Generate missing top-level IDs.
- [x] Repair duplicate IDs.
- [x] Add round-trip tests.

Acceptance criteria:

- Every top-level block in a normalized large document has a unique stable ID.
- Existing documents without IDs still load.

Tests:

- `pnpm test -- tests/editor/large-document-ids.test.ts`

### R1-B. Sectionization And Merge

Scope:

- `packages/editor/src/large-document/sectionize.ts`
- `packages/editor/src/large-document/merge-section.ts`
- `tests/editor/large-document-sectionize.test.ts`
- `tests/editor/large-document-merge-section.test.ts`

Tasks:

- [x] Define `RichTextDocumentSection`.
- [x] Implement heading-based sections.
- [x] Implement fallback block-count sections.
- [x] Implement section replacement.
- [x] Implement stale/missing section result.

Acceptance criteria:

- A section can be replaced without corrupting siblings.
- Heading and fallback sections are deterministic.

Tests:

- `pnpm test -- tests/editor/large-document-sectionize.test.ts tests/editor/large-document-merge-section.test.ts`

### R1-C. Virtual Read Shell

Scope:

- `packages/editor/src/large-document/VirtualRichTextDocumentShell.tsx`
- `packages/editor/src/large-document/SectionReadChunk.tsx`
- `packages/editor/src/large-document/SectionPlaceholder.tsx`
- `packages/editor/src/large-document/height-cache.ts`
- `packages/editor/src/large-document/virtual-range.ts`

Tasks:

- [x] Render visible sections only.
- [x] Render placeholders for offscreen sections.
- [x] Measure visible section height.
- [x] Preserve scroll anchoring after measurement.
- [x] Add diagnostics for rendered/total sections.

Acceptance criteria:

- A 5000-block story does not mount 5000 block DOM nodes in the shell.

Tests:

- `pnpm test -- tests/editor/large-document-virtual-range.test.ts`

### R1-D. Focused Section Editor

Scope:

- `packages/editor/src/RichTextEditor.tsx`
- `packages/editor/src/large-document/FocusedSectionEditor.tsx`
- `packages/editor/src/large-document/use-large-document-controller.ts`
- `tests/editor/focused-section-editor.test.tsx`

Tasks:

- [x] Extract reusable composer internals from `RichTextEditor`.
- [x] Mount section-scoped Lexical editor.
- [x] Emit section document changes.
- [x] Commit section draft into full document.
- [x] Flush active section on switch/unmount.

Acceptance criteria:

- Clicking a section activates Lexical and edits merge back into the full document.

Tests:

- `pnpm test -- tests/editor/focused-section-editor.test.tsx`

### R1-E. Large-Document Public Surface

Scope:

- `packages/editor/src/large-document/index.ts`
- `packages/editor/src/index.ts`
- `packages/editor/src/RichTextEditor.tsx`

Tasks:

- [x] Export `VirtualRichTextEditor`.
- [x] Add optional `largeDocument` policy to `RichTextEditor`.
- [x] Support explicit `mode: "large-document"`.
- [x] Keep default standard mode until auto thresholds are ready.

Acceptance criteria:

- Callers can opt into the virtual editor without breaking existing usage.

Tests:

- Existing editor tests plus new shell smoke.

### R1-F. Index-Backed TOC And Search

Scope:

- `packages/editor/src/large-document/indexes.ts`
- `packages/editor/src/large-document/LargeDocumentToolbar.tsx`
- `packages/lib/src/rich-text.ts`

Tasks:

- [x] Build heading/text/comment indexes from JSON.
- [x] Wire TOC to section scroll.
- [x] Add shell search over text index.
- [x] Activate target section from search result.

Acceptance criteria:

- Search and TOC work for offscreen sections.

Tests:

- `pnpm test -- tests/editor/large-document-indexes.test.ts`
- Playwright search/TOC scenario.

### R1-G. Large Document Ladle Stories

Scope:

- `stories/**`
- `tests/e2e/editor-large-document.perf.spec.ts`

Tasks:

- [x] Add generated fixtures.
- [x] Add 1000/5000 block stories.
- [x] Add mixed decorator-heavy story.
- [x] Add diagnostics panel.
- [x] Add Playwright smoke.

Acceptance criteria:

- Reviewers can manually validate virtual scroll and focused editing.

Tests:

- `pnpm test:e2e:editor`

## 14. Future Backlog

- Cross-section rich-text selection and formatting.
- Document-level undo/redo across section commits.
- Collaborative editing with section-aware conflict handling.
- Drag/drop blocks across sections.
- Virtualized table internals for very large tables.
- Virtualized code editor internals for massive code blocks.
- Print/export path that renders the full document outside the virtual shell.
- Browser-find bridge that opens shell search on Ctrl/Cmd+F.
- Section minimap and comments panel.
- Section prefetching based on scroll velocity.
- Worker-backed index building for extremely large documents.
- Upstream Lexical performance contributions if section editing still exposes Lexical-internal scaling limits.

## 15. Definition Of Done

- `VirtualRichTextEditor` exists and can render a generated 5000-block document through a virtual shell.
- A visible section can be activated into a live Lexical editor.
- Edits in the active section commit back into the full `RichTextEditorDocument`.
- Offscreen sections are placeholders, not full read DOM and not Lexical editors.
- Stable top-level node IDs survive normalize/serialize/render round-trips.
- TOC navigation and shell search work for offscreen sections.
- Large-document metrics are exposed in the editor perf dashboard or equivalent diagnostics.
- Unit tests cover IDs, sectionization, merge, indexes, policy, and height/range helpers.
- Playwright covers large-document load, scroll, activation, typing, commit, search, and TOC navigation.
- Existing standard editor behavior remains unchanged for small documents.
- Documentation explains the native browser find limitation, the section-scoped undo limitation, and the click-to-edit interaction trade.
- Phase 0 decorator virtualization is shipped and measured, and the decision to build the section shell is recorded against that measurement.
- Stable IDs and JSON-derived indexes are active in the standard editor, not only in large-document mode.
- Section boundary behavior (Enter/Backspace/delete/selection at edges) is implemented and covered by tests per [5.9](#59-section-boundary-editing-semantics).
- No heading-based section exceeds the size cap; oversized headings sub-split deterministically.
- Scroll stability is asserted by a top-to-bottom-to-top Playwright drift test.

## 16. Final Model

The scalable editor is not a single giant Lexical surface. It is a document-level virtual shell that renders most of the document as measured, read-only chunks and mounts Lexical only for the active section. The persisted document remains one JSON value, section identity makes replacement safe, and derived features operate from JSON indexes instead of DOM presence.

This gives IDCO a realistic path to 1000-5000 advanced blocks: reduce what the browser mounts, keep Lexical focused, and make large-document behavior explicit instead of hoping scheduler improvements can compensate for a full live DOM.
