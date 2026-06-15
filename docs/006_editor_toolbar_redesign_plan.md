# 006 - Editor Toolbar And Publication Surface Design

> Status: design direction
>
> Date: 2026-06-15
>
> Revision: expanded to cover the hybrid surface model (ribbon + object chrome + flyout), the heavy-object pattern and three render tiers, mermaid and data-grid objects, the author-time bake pipeline, and the reflowable-versus-fixed-layout output decision.
>
> Scope:
>
> - `/home/quanghuy1242/pjs/idco/packages/editor/src/model/commands.ts` - command registry, command grouping, command availability, and command metadata.
> - `/home/quanghuy1242/pjs/idco/packages/editor/src/model/insert-actions.ts` - starter node catalog used by slash, context, and toolbar object tools.
> - `/home/quanghuy1242/pjs/idco/packages/editor/src/model/schema.ts` - persisted editor document shape, node taxonomy, and document-level settings boundary.
> - `/home/quanghuy1242/pjs/idco/packages/editor/src/model/normalize.ts` - untrusted and legacy document normalization.
> - `/home/quanghuy1242/pjs/idco/packages/editor/src/model/serialize.ts` - canonical document to Lexical state conversion.
> - `/home/quanghuy1242/pjs/idco/packages/editor/src/nodes/base.tsx` - host binding contract for media, post references, comments, uploads, and data-provider expansion.
> - `/home/quanghuy1242/pjs/idco/packages/editor/src/plugins/toolbar-plugin.tsx` - persistent editor toolbar layout.
> - `/home/quanghuy1242/pjs/idco/packages/editor/src/toolbar/**` - toolbar controls, tab layout, popovers, buttons, and overflow behavior.
> - `/home/quanghuy1242/pjs/idco/packages/content-renderer/src/index.tsx` - read-side renderer parity for document body, TOC, host-backed nodes, and publication settings.
> - `/home/quanghuy1242/pjs/idco/packages/lib/src/rich-text.ts` - pure rich-text helpers shared by editor and renderer.
> - `/home/quanghuy1242/pjs/idco/tests/editor/**` and `/home/quanghuy1242/pjs/idco/tests/content-renderer.test.tsx` - command, schema, editor, and renderer coverage.
> - `/home/quanghuy1242/pjs/idco/stories/editor.stories.tsx` - Ladle visual verification surface.
>
> Source docs:
>
> - `AGENTS.md` - editor/shared UI behavior must use React Aria behavior plus DaisyUI styling.
> - `.agents/skills/idco-ui/SKILL.md` - shared UI rules and verification expectations.
> - `docs/001_lexical_editor_architecture.md` - editor package architecture and book-authoring target.
> - `docs/002_gap_cursor_and_block_flow.md` - caret, gap cursor, and block flow behavior.
> - `docs/003_block_chrome_and_table_capabilities.md` - implemented table chrome, layout, header, and TOC capabilities.
> - `docs/004_selection_flyout_and_context_actions.md` - implemented selected-text flyout and context command model.
> - `docs/005_side_toc_rail.md` - TOC side rail and editor/renderer parity.
> - `../content-api/docs/015_book-content-model.md` - host book content model; the strict Zod node union the editor's output must pass at the API boundary.
> - `../content-api/docs/017_epub-import.md` - host EPUB import/export worker constraints; the export side runs without browser globals or heavy render libraries.
>
> Assumptions:
>
> - The previous failed `006_toolbar_command_surface_organization.md` and its implementation are intentionally removed. This document starts from the clean toolbar baseline and captures the accepted design direction before implementation is split into smaller parts.
> - The command registry refactor in `commands.ts` is still useful, but the persistent toolbar must not be a mechanical rendering of registry groups.
> - The toolbar should learn from mature document editors such as OneNote by using task tabs, visible command groups, focused tool popovers, and responsive grouping. It should not clone a full desktop ribbon.
> - The product goal is book publication, not a generic rich-text field. Toolbar design must account for authoring, host-backed data, page/publication settings, review workflows, and provider-driven AI without forcing all of those concerns into one flat command row.
> - The editor remains product-neutral. Product data and services come through typed host bindings or explicit providers. The editor must not import product worker source, persistence code, auth runtime code, or product-specific fetch clients.
> - The toolbar uses a hybrid surface model, not a single paradigm: a modern collapsed ribbon (one command row per tab) for creation and document-global work, plus per-object chrome popovers for configuring a selected object, plus the existing selection flyout for the selected text run. These three surfaces are orthogonal by selection scope and must not duplicate each other.
> - The ribbon choice is deliberate and is about information architecture, not nostalgia. A modern collapsed ribbon front-loads the cost of giving every command a named home, which is the correct trade for a product whose capability set is large and growing. The failure mode to avoid is not ribbon density; it is hollow tabs.
> - Heavy objects (code block, media, table, mermaid diagram, data grid) follow one pattern: the resting state shows the baked, static, publish-ready result; editing happens in place (never by navigating to a separate app); configuration lives in a chrome popover.
> - Output spans three render tiers — editor, digital reader (`@idco/content-renderer`), and export (EPUB/PDF). Author-time computes; publication bakes. The baked static representation is the load-bearing baseline for every object; interactivity is a progressive enhancement available only on tiers that can run JS.
> - The editor stays product-neutral, but its output is consumed by a host that validates content against a strict node union and exports through a worker that cannot run heavy render libraries. A new node type is a coordinated contract change across editor, renderer, host schema, and export — not a local editor concern.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. Current-State Findings](#2-current-state-findings)
  - [2.1 Baseline Toolbar](#21-baseline-toolbar)
  - [2.2 Baseline Command Registry](#22-baseline-command-registry)
  - [2.3 Existing Host-Backed Capability](#23-existing-host-backed-capability)
  - [2.4 Existing Publication-Adjacent Capability](#24-existing-publication-adjacent-capability)
  - [2.5 Missing Document-Level Publication Contract](#25-missing-document-level-publication-contract)
  - [2.6 Unknown Node Boundary](#26-unknown-node-boundary)
  - [2.7 Host Content Contract](#27-host-content-contract)
- [3. Product Principles](#3-product-principles)
- [4. Target Toolbar Model](#4-target-toolbar-model)
  - [4.1 Task Tabs](#41-task-tabs)
  - [4.2 Home](#42-home)
  - [4.3 Insert](#43-insert)
  - [4.4 Data](#44-data)
  - [4.5 View](#45-view)
  - [4.6 Review](#46-review)
  - [4.7 AI](#47-ai)
  - [4.8 Mobile Command Tray](#48-mobile-command-tray)
- [5. Data Provider Contract](#5-data-provider-contract)
  - [5.1 Current Contract](#51-current-contract)
  - [5.2 Target Contract](#52-target-contract)
  - [5.3 Data Tools And Node Ownership](#53-data-tools-and-node-ownership)
  - [5.4 Table Versus Data Grid](#54-table-versus-data-grid)
  - [5.5 Heavy Object Pattern And Render Tiers](#55-heavy-object-pattern-and-render-tiers)
  - [5.6 Mermaid Diagram Object](#56-mermaid-diagram-object)
  - [5.7 Data Grid Object](#57-data-grid-object)
  - [5.8 Bake Pipeline And Export Completeness](#58-bake-pipeline-and-export-completeness)
- [6. Publication And Page Layout Contract](#6-publication-and-page-layout-contract)
  - [6.1 Body Content Versus Publication Settings](#61-body-content-versus-publication-settings)
  - [6.2 Document Settings Shape](#62-document-settings-shape)
  - [6.3 Renderer Parity](#63-renderer-parity)
  - [6.4 Output Targets And Reflow Versus Fixed Layout](#64-output-targets-and-reflow-versus-fixed-layout)
  - [6.5 Page Breaks Are Body, Page Layout Is Settings](#65-page-breaks-are-body-page-layout-is-settings)
- [7. Architecture Decisions](#7-architecture-decisions)
  - [7.1 Separate Toolbar Tabs And Slots From Registry Groups](#71-separate-toolbar-tabs-and-slots-from-registry-groups)
  - [7.2 No Desktop More Menu As A Product Surface](#72-no-desktop-more-menu-as-a-product-surface)
  - [7.3 No Duplicated Text Structure Tools](#73-no-duplicated-text-structure-tools)
  - [7.4 Focused Popovers For Complex Tools](#74-focused-popovers-for-complex-tools)
  - [7.5 Explicit Data Surface](#75-explicit-data-surface)
  - [7.6 Controlled Host Extensibility](#76-controlled-host-extensibility)
  - [7.7 Publication Settings Are Not Body Blocks](#77-publication-settings-are-not-body-blocks)
  - [7.8 Object Chrome Over Contextual Tabs](#78-object-chrome-over-contextual-tabs)
  - [7.9 Provenance Is Gating, Not Navigation](#79-provenance-is-gating-not-navigation)
  - [7.10 Bake At Author Time](#710-bake-at-author-time)
- [8. Implementation Direction](#8-implementation-direction)
  - [8.1 Toolbar Layout Model](#81-toolbar-layout-model)
  - [8.2 Command And Insert Metadata](#82-command-and-insert-metadata)
  - [8.3 Toolbar Rendering](#83-toolbar-rendering)
  - [8.4 Data Surface Rendering](#84-data-surface-rendering)
  - [8.5 Publication Settings Preservation](#85-publication-settings-preservation)
  - [8.6 Responsive Behavior](#86-responsive-behavior)
  - [8.7 Mermaid Implementation](#87-mermaid-implementation)
  - [8.8 Data Grid Implementation](#88-data-grid-implementation)
  - [8.9 Selection And Focus For Tab Overlays](#89-selection-and-focus-for-tab-overlays)
- [9. Edge Cases And Failure Modes](#9-edge-cases-and-failure-modes)
- [10. Test And Verification Plan](#10-test-and-verification-plan)
- [11. Completion Criteria](#11-completion-criteria)
- [12. Final Model](#12-final-model)

## 1. Goal

Redesign the persistent rich-text editor toolbar into a compact task-tab authoring surface that can grow toward a serious book-publication editor without becoming a flat row of unrelated buttons or a hidden bucket of commands.

The toolbar model should make these concepts visible:

- `Home` edits the current selection, text, and block.
- `Insert` creates document objects grouped by author intent (image, table, callout, code, embed, TOC), regardless of whether a picker is host-backed.
- `Data` is the home for mini-app objects (data grid, chart, mermaid) and host-managed references — objects that open their own in-place editor and bake to a static result.
- `View` owns reading, preview, layout, and publication-view controls.
- `Review` owns collaboration review and comment-thread management.
- `AI` owns provider-driven generation, transformation, and analysis tools.

The toolbar is a modern collapsed ribbon (one command row per tab) for creation and document-global work; it is paired with per-object chrome for configuring a selected object and the selection flyout for the selected text run (§3.11, §7.8). The important part is the information architecture: commands have obvious homes, tools are grouped by author intent rather than data provenance, page/publication settings have a real boundary, heavy objects bake to a static publish-ready baseline, and responsive behavior preserves the active task instead of collapsing the product model into a generic `More` menu.

Non-goals for this document:

- No sequenced checklist. This document describes the target model and constraints so smaller implementation parts can be planned separately.
- No full OneNote ribbon clone.
- No product-specific fetch, auth, persistence, or route code inside `@idco/editor`.
- No hand-rolled interactive primitives. Toolbar tabs, popovers, menus, dialogs, listboxes, selection, dismissal, and focus behavior must use React Aria behavior with DaisyUI styling.

## 2. Current-State Findings

### 2.1 Baseline Toolbar

`packages/editor/src/plugins/toolbar-plugin.tsx` builds `segments` by looping over `COMMAND_GROUP_ORDER` from `commands.ts`.

Current desktop order:

1. History.
2. Text style dropdown.
3. Inline format buttons.
4. Alignment buttons.
5. List buttons.
6. Indent buttons.
7. Annotation buttons.
8. `More`.

The toolbar root is a React Aria `Toolbar` with:

```tsx
className="flex flex-wrap items-center gap-1 border-b border-base-300 bg-base-200 px-2 py-2"
```

That means the current responsive behavior is wrapping. It preserves access, but it does not preserve a designed command structure. As commands grow, the toolbar becomes a long flat strip and then wraps into a noisy second line.

### 2.2 Baseline Command Registry

`packages/editor/src/model/commands.ts` defines one registry with:

- `CommandGroup`: `history`, `blockStyle`, `inlineFormat`, `align`, `list`, `indent`, `annotate`, `insert`.
- `CommandSurface`: `toolbar`, `flyout`, `slash`, `context`.
- `CommandPlacement`: `primary` or `more`.

This registry is useful, but it is not a toolbar design. It answers which commands exist and which surfaces may show them. It does not answer:

- which commands are transformations versus local object creation versus host-backed data insertion;
- which commands belong on Home, Insert, Data, View, Review, or AI;
- which commands should be merged into compound controls;
- which groups deserve visible toolbar space;
- which commands are responsive fallbacks;
- which commands need a focused popover instead of a menu item;
- which commands are host-provided and therefore visible only when a provider exists.

`packages/editor/src/model/insert-actions.ts` currently owns starter nodes and extra list/table insert actions. It includes paragraph, heading, table of contents, callout, code, embed, media, post ref, bullet list, numbered list, check list, and table. `commands.ts` maps all insert actions to `group: "insert"` with toolbar placement `"more"`. So the toolbar's `More` button is currently not just overflow. It is the Insert catalog.

### 2.3 Existing Host-Backed Capability

The editor already depends on host-backed data, but the UI model does not name that concept.

`packages/editor/src/nodes/base.tsx` defines `RichTextEditorBindings` with:

- `mediaLibrary.load`.
- `mediaLibrary.resolve`.
- `postLibrary.load`.
- `onUploadMedia`.
- `allowedEmbedDomains`.
- comment callbacks and comment data.

`packages/editor/src/RichTextEditor.tsx` threads those bindings through editor props. `packages/editor/src/model/insert-actions.ts` uses those bindings to hide `media` and `post-ref` when the host did not provide the corresponding provider.

This means the editor already has a host-data capability model. The problem is that this capability is hidden inside Insert gating. A user looking at the toolbar cannot tell that the editor supports host-backed media, post references, or future resource-backed tools. A consumer also does not get a general editor-defined interface for new data providers.

### 2.4 Existing Publication-Adjacent Capability

The editor already has several publication-adjacent features:

- Heading anchors are persisted on heading nodes.
- Table of contents blocks store settings only and compute entries from current headings.
- TOC can render inline or as an aside rail.
- Tables support layout modes, header row, header column, row numbers, responsive behavior, and renderer parity.
- The renderer walks the same rich-text JSON and resolves media and post references through host-provided resolver options.

These are real book-publication features, but they are still exposed as scattered block features. There is no View or publication surface that says "preview the published structure," "show the outline rail," "show page layout," or "review the publication format."

### 2.5 Missing Document-Level Publication Contract

`packages/editor/src/model/schema.ts` defines the editor document as:

```ts
export type RichTextEditorDocument = {
  readonly root: {
    readonly children: readonly RichTextEditorNode[];
  };
};
```

`packages/editor/src/model/normalize.ts` rebuilds incoming values as `{ root: { children } }`. `packages/content-renderer/src/index.tsx` does the same when rendering. That means document-level fields such as page size, margins, publication mode, headers, footers, page numbering, front matter, or export settings are not represented in the contract and would be dropped unless deliberately preserved.

This is the largest structural gap for a book-publication editor. Page layout should not be treated as a normal body block, but the editor and renderer need a boundary for it.

### 2.6 Unknown Node Boundary

`normalizeNode` preserves known nodes and a small set of passthrough Lexical element types: link, autolink, mark, table, editor-table, tablerow, and tablecell. Unknown nodes are not preserved as opaque custom blocks. If an unknown node has children, normalization flattens to normalized children; otherwise it disappears.

That is a safe default, but it means "the host can pass arbitrary data blocks" is not true today. A Data tab must either create editor-owned known nodes or introduce an explicit host-node registry with editor rendering, read rendering, normalization, serialization, allowed-node gating, and failure behavior.

### 2.7 Host Content Contract

The editor is product-neutral, but it has a concrete first consumer whose constraints shape what any new node must satisfy. The book platform (`../content-api`) does three things the editor must design around:

- It validates chapter content with a strict Zod discriminated union at the API boundary and restricts the runtime shape to "a small set of nodes the renderer and editor both understand" (`015_book-content-model.md`). A new node type such as a mermaid diagram or a data grid is not accepted by being permissive in the editor; it must be a deliberate, registered addition to that union. This reinforces — from the server side — the same rule as §2.6: nothing passes by accident.
- It renders on two further tiers beyond the editor: a digital web reader and an export pipeline. The EPUB worker (`017_epub-import.md`) runs as a separate Cloudflare Worker that deliberately avoids browser globals and heavy libraries (no `epubjs`, pure-JS parsing). The export side cannot run a charting library, a diagram renderer, or a spreadsheet engine. It can only assemble pre-baked pieces.
- It already models async/unready media with a fallback (`lowResUrl` / placeholder) rather than assuming render-time work completed. Any new heavy node should inherit the same discipline: a self-sufficient baked representation that never depends on render-time computation.

The consequence for this document: a new node is a coordinated contract change across editor, `@idco/content-renderer`, the host node union, and export — not a local editor feature. The bake pipeline (§5.8) exists precisely to satisfy the export tier's "no heavy libraries" rule.

## 3. Product Principles

The toolbar should follow these rules:

1. **Task tabs come first.** The active tab tells the author what kind of work they are doing: edit, insert, connect data, view/publication, review, or AI.
2. **One command has one obvious home.** Paragraph, headings, lists, and alignment belong to Home. Local document objects belong to Insert. Host-backed objects and structured data belong to Data. Review state belongs to Review. Provider-driven AI belongs to AI.
3. **Creation tools are not transformations.** Creating a table, media block, data grid, diagram, callout, or TOC is different from turning the current paragraph into a heading or list.
4. **Host-backed tools are first-class.** Media libraries, post references, generic record pickers, datasets, diagrams, and spreadsheet-like blocks should not be hidden behind a generic Insert menu.
5. **Complex tools get focused popovers or panels.** Table dimensions, media picking, resource picking, references, TOC settings, review threads, and AI prompts should open focused tools, not become rows inside one large menu.
6. **Publication settings are not body content.** A4/A5/Letter, margins, page headers, page footers, page numbers, and export settings belong to document or host publication settings, not ordinary rich-text nodes.
7. **The main toolbar must show the product model.** If the desktop toolbar looks unchanged, the design failed even if command metadata improved.
8. **Responsive behavior preserves the active tab.** Resize can hide labels, collapse groups, or scroll as a fallback, but it must not redefine the toolbar around a generic `More` bucket.
9. **Mobile is not a mini desktop toolbar.** Mobile keeps the same task-tab information architecture, but uses a tabbed command tray and semantic popovers or sheets for dense groups.
10. **Slash remains the broad command catalog.** Slash is the right place for a searchable insertion and command catalog. The persistent toolbar is not the full catalog.
11. **Three command surfaces, orthogonal by selection scope.** The selection flyout owns the selected *text run*. Object chrome owns the *selected object* (table, callout, code, media, mermaid, data grid). The ribbon owns *creation* and *document-global* work. A command belongs to exactly one of these by what is selected when you invoke it; they must not become duplicate routes to the same action.
12. **Object configuration lives on the object, not in a contextual tab.** Per-object settings (table layout, callout tone, mermaid theme, data-grid columns) open from chrome attached to the object, because proximity beats a gaze/cursor round-trip to the top of the screen. The editor does not use Word-style contextual ribbon tabs.
13. **Heavy objects share one shape: resting = baked, edit = in place, config = popover.** The resting state is the static publish-ready result. Editing happens in place via a richer mode (a code surface, a grid surface) — never by navigating to a separate sub-application. Configuration is a chrome popover.
14. **Author-time computes; publication bakes.** Anything computed or rendered from a heavy library (a diagram, a chart, computed cells) is baked into the node at author time as a static representation. The export tier consumes only baked output. Live interactivity is a progressive enhancement layered on top of a mandatory static baseline, available only on tiers that can run JS.
15. **Provenance is a gating rule, never a navigation axis.** Whether a picker is host-backed is invisible plumbing. Authors are basic users; they look for "add a picture," not "add a host-backed resource." Group tools by what the object *is* to the author; use host bindings only to decide whether an entry is enabled.
16. **A tab earns its place by being full and by mapping to author intent.** Capability-gating may hide a tab when its host bindings are absent; the design must also not raise a tab whose contents are too thin to read as finished. Per host deployment the tab set is stable (bindings are configured once at integration time), so gating is not runtime shimmer.

## 4. Target Toolbar Model

### 4.1 Task Tabs

The toolbar model should support these task tabs:

```txt
Home | Insert | Data | View | Review | AI
```

Tabs are part of the editor toolbar, not the outer application shell. They are compact, embedded, and scoped to the rich-text authoring surface.

Visibility can be capability-driven. For example, Data should appear when data providers or host-backed nodes exist; Review should appear when comment/review bindings exist; AI should appear when an AI provider exists. The layout model should still understand all tabs so adding a provider does not require redesigning the toolbar.

The tab row is a modern *collapsed* ribbon: one command row per tab, not a multi-row 2007-era ribbon. Switching tabs is one click and costs no persistent vertical space beyond the single active row, which may itself be collapsible for a distraction-free writing state. This is why a ribbon is the right spine here rather than a minimalist single toolbar: the editor's capability set is large and growing, and a ribbon front-loads the information-architecture cost of giving every command a named home. The risk to manage is hollow tabs, not ribbon density (§3.16).

Capability-gating is by host binding, configured once per deployment, so the tab set a given author sees is stable, not shimmering per document. Contextual *appearance* is reserved for object chrome — a table's controls appear when a table is selected — not for contextual ribbon tabs (§7.8).

### 4.2 Home

Home edits the current block, text, and selection.

```txt
Home:
[Undo] [Redo] | [Text style v] | [B] [I] [U] [S] [Code] | [Bullets] [Numbers] [Check] [Outdent] [Indent] [Align v] | [Link] [Glossary] [Comment]
```

Home details:

- `Text style` comes before inline formatting. OneNote puts font family and font size before `B/I/U/S`; this editor does not have font family or font size controls, so `Text style` is the leading semantic text control.
- `B`, `I`, `U`, `S`, and inline code stay flat because they are frequent binary toggles with familiar icons.
- Bullet, numbered, and check lists are paragraph structure controls, not Insert objects.
- Outdent and indent sit next to list controls because they are paragraph/list structure controls.
- Alignment becomes one dropdown trigger showing the active alignment. Four flat alignment buttons take too much space for an embedded editor.
- Link, glossary, and comment stay on Home because they are selection actions. Comment thread management belongs to Review, but adding a comment to a selected range is a Home action.

### 4.3 Insert

Insert creates document objects, grouped by what the object *is* to the author (§3.15), not by where its data comes from.

```txt
Insert:
[Table v] | [Image] [Callout] [Code block] [Quote] | [Embed] | [Table of contents]
```

Insert details:

- Table is first and opens a focused dimension picker instead of inserting a fixed 3 by 3 table.
- Image lives here even though the media picker is host-backed. Authors look for "add a picture" under Insert; host-backing only gates whether the entry is enabled (§3.15, §7.9). The picker happens to call `mediaLibrary` / `onUploadMedia`, which is invisible plumbing.
- Callout, code block, quote, embed, and table of contents are visible object tools.
- Paragraph, heading, bullet list, numbered list, and check list do not appear on Insert; they are Home text-structure transforms (§7.3). Slash still includes them.
- Insert is a *categorized* surface, not a flat row. Internal groups ("Basic", "Media", "Data & charts", "Diagrams") let it grow without spawning sibling tabs prematurely. A category graduates into its own tab (for example Data) only when it is dense enough to read as finished and shares a distinct workflow — see §4.4 and §7.9.

Table details:

- Icon: `Table`.
- Label behavior: show `Table` on roomy desktop, icon-only on narrow widths with tooltip.
- Trigger styling: DaisyUI button classes through the local toolbar button abstraction.
- Behavior: React Aria `DialogTrigger`, `Popover`, `Dialog`, and `Button`, because the picker contains interactive controls.
- Picker: a compact dimension grid with a preview label such as `4 x 2 table`.
- Header row remains default-on to match current behavior. Header row/column changes remain in table chrome after insertion.

### 4.4 Data

Data is the home for *mini-app objects*: structured or computed objects that have their own in-place editor and bake to a static result, plus host-managed references that are not the everyday "add a picture" action.

```txt
Data:
[Data grid] [Chart] [Diagram (mermaid)] | [Dataset] [Record] | [Post ref] [Citation]
```

Data details:

- The unifying idea is *object nature*, not provenance: these objects open their own editing surface (a grid, a diagram source, a chart config) rather than being drop-and-fill content. Image is therefore an Insert tool, not a Data tool — moved here in this revision from the earlier provenance-based grouping (§3.15).
- Data grid, chart, and mermaid diagram all follow the heavy-object pattern (§5.5) and the bake pipeline (§5.8).
- Post reference, record, dataset, and citation are host-managed references; they may insert known nodes and open focused provider popovers (`ResourceSelector`, `FileDropzone`, `DataTable`).
- Naming caveat: "Data" undersells diagrams — a mermaid flowchart is not data. If the family grows, the honest split is two groups or tabs ("Charts & data" vs "Diagrams"); for now they are categories under one Data tab. This is recorded as an open structural choice in §7.9, not a settled label.
- Data tools may insert editor-owned nodes (`data-grid`, `chart`, `mermaid`, `dataset-ref`, `record-ref`, `citation`) or supply a full host-node definition (§5.3). They never rely on accidental passthrough (§2.6, §2.7).

### 4.5 View

View owns how the author inspects the document and publication shape.

```txt
View:
[Preview] [Outline] [TOC rail] | [Page layout] [Page size] [Margins] | [Zoom] [Full page]
```

View details:

- View does not create content. It changes the author's inspection and layout surface.
- Existing TOC rail behavior belongs conceptually to View even though the TOC node itself is inserted from Insert.
- Page layout controls such as A4, A5, Letter, margins, page headers, page footers, page numbers, and print/paginated preview belong here.
- If the host owns book-level publication settings, View should still display and edit those settings through typed props or settings bindings rather than storing product-specific state inside body nodes.

### 4.6 Review

Review owns collaboration and editorial review state.

```txt
Review:
[Comments] [Unresolved] [Resolved] | [Changes] [Review status]
```

Review details:

- Adding a new inline comment can remain a Home selection action.
- Viewing, filtering, resolving, editing, and navigating comment threads belongs to Review.
- The existing comment contract is enough for simple annotation, but not full review workflow. Review needs room for resolved state, author metadata, timestamps, replies, permissions, and change-review state.
- Review should be host-backed. The document stores mark ids; the host owns thread data.

### 4.7 AI

AI owns provider-driven generation, transformation, and analysis.

```txt
AI:
[Rewrite] [Continue] [Summarize] [Outline] [Generate metadata] [Ask]
```

AI details:

- AI actions must be injected through a provider contract. The editor should not hardcode a vendor, endpoint, product route, auth model, or persistence behavior.
- AI actions should declare scope: selection, block, document, data source, or publication metadata.
- AI actions should declare output behavior: replace selection, insert below, create block, propose review change, or return text into a focused dialog.
- AI belongs to its own tab because it is a mode of operation, not a formatting command.

### 4.8 Mobile Command Tray

Mobile keeps the same task-tab philosophy and changes the interaction model.

Mobile shell:

```txt
[Home] [Insert] [Data] [View] [Review] [AI]
-------------------------------------------
active tab command row
```

Rules:

- The tab row is visible when the toolbar is visible.
- The active command row is single-line and horizontally scrollable.
- No wrapping.
- No generic `More` as the main discovery model.
- Dense groups open semantic sheets or popovers.
- Touch targets use accessible labels and stable hit areas.

Suggested mobile examples:

```txt
Home:
[Text style] [B] [I] [U] [S] [Code] [Paragraph] [Link] [Glossary] [Comment]

Insert:
[Table] [Image] [Callout] [Code block] [Quote] [Embed] [TOC]

Data:
[Data grid] [Chart] [Diagram] [Dataset] [Record] [Post ref] [Citation]
```

The active row may scroll horizontally. That is acceptable because the active tab identity remains visible and stable.

## 5. Data Provider Contract

### 5.1 Current Contract

The current binding contract is specific:

```ts
type RichTextEditorBindings = {
  readonly allowedEmbedDomains?: readonly string[];
  readonly mediaLibrary?: {
    readonly load: (query: string, signal?: AbortSignal) => Promise<readonly RichTextEditorMediaOption[]>;
    readonly resolve?: (mediaId: string, signal?: AbortSignal) => Promise<RichTextEditorMediaOption | null>;
  };
  readonly postLibrary?: {
    readonly load: (query: string, signal?: AbortSignal) => Promise<readonly RichTextEditorPostOption[]>;
  };
  readonly onUploadMedia?: (files: File[]) => void | readonly RichTextEditorNode[] | Promise<readonly RichTextEditorNode[] | void>;
  readonly onComment?: (commentId: string, quote: string, body: string) => void;
  readonly comments?: readonly RichTextEditorComment[];
  readonly onCommentUpdate?: (commentId: string, body: string) => void;
  readonly onCommentDelete?: (commentId: string) => void;
};
```

That is enough for media, post references, uploads, and comments. It is not enough to define a general Data tab.

### 5.2 Target Contract

The editor should expose a data-provider contract that can represent host-backed insertion without making the editor product-specific.

Shape sketch:

```ts
type RichTextEditorDataKind =
  | "media"
  | "post"
  | "record"
  | "dataset"
  | "data-grid"
  | "diagram"
  | "citation"
  | "custom";

type RichTextEditorDataSource = {
  readonly id: string;
  readonly label: string;
  readonly kind: RichTextEditorDataKind;
  readonly icon?: string;
  readonly source: ResourceSource;
  readonly insertLabel?: string;
  readonly toNode: (option: ResourceOption) => RichTextEditorNode;
  readonly resolve?: (id: string, signal?: AbortSignal) => Promise<ResourceOption | null>;
};

type RichTextEditorBindings = {
  readonly dataSources?: readonly RichTextEditorDataSource[];
  // existing specific bindings can remain as compatibility adapters
};
```

The exact exported names can change, but the responsibilities should not:

- Providers describe what kind of data they expose.
- Providers own loading/searching options.
- The editor owns how a provider appears in the Data tab.
- Provider selection creates known editor nodes.
- Renderer resolution is explicit, not guessed from arbitrary node shape.

### 5.3 Data Tools And Node Ownership

Data tools should create known node types unless a host node registry exists.

Recommended known nodes:

- `media` for media library/upload output (inserted from Insert, not Data — node ownership is independent of tab placement; §7.9).
- `post-ref` for content/post references.
- `record-ref` or `data-ref` for generic records.
- `dataset-ref` for linked datasets.
- `data-grid` (cells `data-cell`) for embedded spreadsheet-like structured content (§5.7).
- `mermaid` for diagram content baked to SVG (§5.6); `chart` for data-grid-driven charts baked to SVG (§5.8).
- `citation` for source/citation references.

A node's type and which tab inserts it are separate concerns: a `media` node is a Data-family node type in the sense of host-resolved content, yet it is created from the Insert tab because that matches author intent (§3.15).

Unknown host nodes should not silently pass through the editor. If arbitrary host blocks are allowed, they need an explicit registry:

```ts
type RichTextHostNodeDefinition = {
  readonly type: string;
  readonly label: string;
  readonly icon?: string;
  readonly normalize: (value: unknown) => RichTextEditorNode | null;
  readonly renderEditor: (props: HostNodeEditorProps) => React.ReactNode;
  readonly renderReadOnly: (node: RichTextEditorNode) => React.ReactNode;
};
```

That registry should be a deliberate extension point, not an accidental consequence of preserving unknown JSON.

### 5.4 Table Versus Data Grid

The editor has two different grid concepts:

- `table`: local document table for authoring and layout. It belongs to Insert.
- `data-grid` or `spreadsheet`: structured data object, linked dataset, or mini Excel-like block. It belongs to Data.

They should not share one node type. A rich-text table has cells, layout, headers, row numbers, and responsive rendering. A data grid needs data typing, formulas or computed cells, import/export behavior, validation, sorting/filtering, and possibly host synchronization. Treating both as `table` would make the table model carry too many meanings.

### 5.5 Heavy Object Pattern And Render Tiers

Code block, media, table, mermaid, and data grid are all *heavy objects*. They share one interaction shape and one rendering model.

Interaction shape:

- **Resting state** shows the baked, static, publish-ready result. For code it is highlighted code; for media the image; for mermaid the rendered SVG; for a data grid the formatted static table.
- **Editing** happens in place via a richer mode — a code surface for source, a grid surface for cells — revealed on the object. It never navigates to a separate sub-application. This is what keeps the experience unified rather than scattered.
- **Configuration** is a chrome popover attached to the object (theme, language, tone, column types). Source or data that is too large for a popover lives in the in-place edit mode, not the popover.

Render tiers (the same node renders differently per target):

- **Editor** — full interaction; the author edits data, source, formulas, and config.
- **Digital reader (`@idco/content-renderer`)** — interaction is *allowed* as progressive enhancement: a reader may sort/filter a grid or pan a diagram, because this tier runs JS.
- **Export (EPUB / PDF)** — the *baked static snapshot only*. The export worker runs no heavy libraries (§2.7), so it can only place pre-baked output.

The baked static representation is the load-bearing baseline. An object that cannot bake to a static form cannot appear in an exported book. Interactivity is layered on top of that baseline, never a substitute for it. "Mostly read-only on the reader" is therefore not a vague fallback; it is the export tier, and producing its snapshot is mandatory.

The in-place edit mode has a space ceiling that a popover would hit first. For the densest objects (a large data grid) the edit mode may be an **expand-to-edit** surface — a temporary larger in-place editor that collapses back to the baked result. Expand-to-edit is still in place; it is not a separate app, so it honors the no-scatter rule.

### 5.6 Mermaid Diagram Object

Mermaid is the merge of two patterns the editor already owns: the code block's edit affordance and media's resting display. It adds no new interaction vocabulary.

- **Resting:** the rendered diagram (SVG), displayed like media displays an image — full width, no layout drift.
- **Editing:** clicking in reveals an in-place code surface (the existing hand-rolled code editor) holding the mermaid source. The source is multi-line, so it is *not* a popover. The author toggles between source and preview; the two are never shown side by side, because a two-column layout drifts as the document reflows.
- **Config popover:** theme, direction, alignment, and the source↔preview toggle.

Findings that distinguish mermaid from media:

- **Rendering is fallible.** A half-typed graph throws a parser error on nearly every keystroke. The block needs a first-class "couldn't render — error near line N" state and must keep showing the last good diagram while the author fixes the source. A broken image is just blank; a broken diagram must degrade gracefully.
- **Bake the SVG into the node.** Store both `source` (to re-edit) and the rendered `svg` (to display, print, and export). The renderer drops the SVG; it never runs mermaid. This keeps reading fast, makes export possible at all (§2.7), and makes the printed diagram deterministic and immune to mermaid version drift.
- **The library is heavy.** `mermaid` is hundreds of KB and pulls in d3-like dependencies. It must be lazy-loaded on first mermaid node, or supplied by the host as a binding, so hosts that never use diagrams do not pay for it. The renderer needs none of it because the SVG is baked.

### 5.7 Data Grid Object

The "excel-like" object (`data-grid`; cells are `data-cell`) splits into two tiers that must not be conflated. Both bake to a static table for export.

**Tier 1 — structured table.** Typed columns (text, number, currency, date), per-column format and alignment, and an optional auto-total row. No formula language; cells hold values. Selecting a column header opens a chrome popover for its type/format. This delivers most of what a *book* needs from "a spreadsheet" and reuses the existing table rendering. Its resting state is a clean formatted static table, which is also its export output.

**Tier 2 — spreadsheet.** Formulas, cell references, and a recalculation engine: dependency graph, recalc ordering, circular-reference detection, and error propagation (`#REF!`, `#DIV/0!`). This is genuinely large and a permanent maintenance cost. Because a book's published output is static, even Tier 2 computes at author time and bakes the resulting *values*; the renderer and export never recalculate. Formulas therefore buy author convenience, not output capability — scope them against real author demand.

Node identity and boundaries:

- The data grid is a separate node from `table` (§5.4). The dividing line is sharp: the moment a cell is computed or type-validated, it is a data grid; a purely presentational grid (alignment, a visual total) can stay table chrome.
- **Sort/filter implies tabular records**, which means the columns mean something — that is already the data grid's floor, not a table feature. Keep the `table` node "dumb" (layout only); promote to `data-grid` the instant sort/filter is wanted. A "static table the reader can sort" *is* a data grid v0.
- A data grid may drive a **live chart**. On the digital reader the chart can be interactive; for export the chart bakes to an SVG/image — the *same* bake pipeline as mermaid (§5.6, §5.8). Build that pipeline once.
- **The node must be export-complete on its own**: it embeds the baked static table (computed values, not formulas) and the baked chart image, alongside the live fields (column types, formulas, chart config) used by the editor and digital reader. Export reads only the baked fields and must never need to resolve anything at render time (mirrors the host's media fallback discipline, §2.7).
- **Reader interactivity defaults off and is opt-in per grid.** Books are linear narrative; if prose says "as the table above shows, March is highest" and a reader re-sorts, the reference breaks. Sort/filter is an author-enabled enhancement, not an automatic behavior.

### 5.8 Bake Pipeline And Export Completeness

Baking turns a computed or rendered object into a self-sufficient static representation stored in the node. It is the mechanism that satisfies the export tier's "no heavy libraries" rule (§2.7) and the load-bearing-baseline principle (§3.14).

Rules:

- **Bake at author time, in the editor.** The editor already loads the diagram/charting/spreadsheet libraries, so it computes the snapshot on change and writes it into the node. The export worker then only assembles baked pieces and stays dependency-free, consistent with the EPUB worker's constraints.
- **Visuals bake to SVG/image** (mermaid diagram, data-grid chart) through one shared path. Computed cells bake to their resolved *values*.
- **Baked fields are mandatory and standalone.** A node with no valid baked snapshot is not exportable; the editor must produce one or surface an error (§9). Nothing in the baked output may depend on a host resolver, a font, or a runtime library being present at export.
- **Live fields ride alongside.** Source, formulas, column types, and chart config persist for re-editing and for digital-reader interactivity, but they are never required by export.
- **Re-bake on edit.** Any change to source, data, or config invalidates and regenerates the baked snapshot so it never drifts from the live representation.

## 6. Publication And Page Layout Contract

### 6.1 Body Content Versus Publication Settings

The document body and publication settings are different layers.

Body content:

- Paragraphs.
- Headings.
- Lists.
- Tables.
- Callouts.
- Code blocks.
- Media.
- Embeds.
- References.
- TOC blocks.
- Data blocks.

Publication settings:

- Page size: A4, A5, Letter, custom.
- Orientation.
- Margins.
- Page headers.
- Page footers.
- Page numbers.
- Running chapter title.
- Print/export mode.
- Front matter and back matter behavior.
- Reading/paginated preview options.

Publication settings should not be modeled as ordinary rich-text body blocks. They should be document-level or host book-level settings.

### 6.2 Document Settings Shape

The editor document should preserve document-level settings if they are part of the value. A book host may still own final book-level layout, but the editor must not silently strip settings that it accepts.

Shape sketch:

```ts
type RichTextEditorDocument = {
  readonly root: {
    readonly children: readonly RichTextEditorNode[];
  };
  readonly settings?: RichTextDocumentSettings;
};

type RichTextDocumentSettings = {
  readonly publication?: RichTextPublicationSettings;
};

type RichTextPublicationSettings = {
  readonly pageSize?: "a4" | "a5" | "letter" | "custom";
  readonly orientation?: "portrait" | "landscape";
  readonly margins?: {
    readonly top?: number;
    readonly right?: number;
    readonly bottom?: number;
    readonly left?: number;
    readonly unit?: "mm" | "in" | "px";
  };
  readonly header?: RichTextPageRegionSettings;
  readonly footer?: RichTextPageRegionSettings;
  readonly pageNumbers?: {
    readonly enabled?: boolean;
    readonly position?: "header" | "footer";
    readonly align?: "left" | "center" | "right";
  };
};
```

The exact fields can be refined when page layout UI is designed. The key requirement is that document-level settings have a durable place and that normalization/serialization do not erase them.

### 6.3 Renderer Parity

The renderer must read the same document settings boundary. If the editor can show paginated preview or a TOC rail in a publication layout, the renderer needs the same information or an explicit host override.

Renderer behavior should be clear:

- If the host provides publication settings externally, renderer options can override document settings.
- If document settings are present and no host override exists, renderer uses them.
- If neither exists, renderer uses default article layout.
- Unknown publication settings should be ignored safely, not rendered as body content.

### 6.4 Output Targets And Reflow Versus Fixed Layout

Publication settings (§6.1–6.2) only "mean something" relative to the output target, and there are three:

- **Digital web reader (`@idco/content-renderer`)** — flowing article layout; page size and margins are at most a max-width hint. Interactivity is allowed (§5.5).
- **Reflowable EPUB (EPUB 2 / EPUB 3 reflowable)** — the reader's device owns pagination, font size, and margins. Page size, fixed margins, running headers, and page numbers largely *do not apply*; they degrade to hints or are dropped. The body's structure (headings, TOC, anchors) is what matters.
- **Fixed-layout (PDF, EPUB 3 fixed-layout)** — the document owns pagination. Page size, orientation, margins, running headers/footers, page numbers, and widow/orphan control are all load-bearing.

This fork is an explicit open decision the host must make, and it determines how much of §6.2 is real versus theater:

- If the book targets **reflowable** output, most of `RichTextPublicationSettings` is advisory and the renderer/export may ignore it safely.
- If the book targets **fixed-layout / PDF**, those settings drive a paged-media rendering stage — page breaks, running headers/footers, page numbers, widow/orphan control. That stage is effectively its own rendering engine and is a substantial workstream in its own right; the toolbar (View) only exposes the *controls*, it does not implement pagination.

The editor's obligation is the same either way: preserve the settings it accepts (§8.5) and never strip them, so the host can honor or ignore them per target. The reflowable-versus-fixed-layout choice for the book platform's EPUB output (EPUB 2 vs EPUB 3, reflowable vs fixed) is unresolved and is tracked here rather than assumed.

### 6.5 Page Breaks Are Body, Page Layout Is Settings

A nuance inside §7.7: *global* page layout (size, margins, running headers, numbering) is document settings, not body. But a *manual* page break or a "keep together" / "keep with next" marker is authored inline and is therefore a **body node**, like any other block. The principle "publication settings are not body blocks" governs global layout; per-location pagination hints legitimately live in the body stream and must round-trip like other nodes.

## 7. Architecture Decisions

### 7.1 Separate Toolbar Tabs And Slots From Registry Groups

Add a toolbar-specific tab and slot layout layer.

The command registry should describe commands. The toolbar layout should describe the product surface: which tab owns a command, which slot inside that tab owns it, and whether it is a flat button, dropdown, focused tool, provider tool, or responsive fallback.

Shape sketch:

```ts
type ToolbarTabId = "home" | "insert" | "data" | "view" | "review" | "ai";

type ToolbarSlotId =
  | "home.history"
  | "home.text"
  | "home.paragraph"
  | "home.annotate"
  | "insert.tables"
  | "insert.objects"
  | "insert.references"
  | "data.media"
  | "data.records"
  | "data.structured"
  | "view.preview"
  | "view.publication"
  | "review.comments"
  | "review.changes"
  | "ai.selection"
  | "ai.document";

type ToolbarItem =
  | { readonly kind: "command"; readonly commandId: string }
  | { readonly kind: "component"; readonly id: string }
  | { readonly kind: "insertAction"; readonly actionId: string }
  | { readonly kind: "dataSource"; readonly sourceId: string }
  | { readonly kind: "providerAction"; readonly actionId: string };
```

This avoids making `CommandGroup` do two jobs. `CommandGroup` remains useful for slash/context/flyout grouping. `ToolbarTabId` and `ToolbarSlotId` become the persistent toolbar design.

### 7.2 No Desktop More Menu As A Product Surface

Remove the always-visible toolbar `More` from the accepted desktop layout.

There can be overflow, but it must be driven by measured collapse state and absent when no group is collapsed. It should not own insert, data, or object discovery on a normal desktop viewport.

Renaming `More` to `Insert` or `Data` while keeping the same giant catalog is not the design. It changes the label without changing the model.

### 7.3 No Duplicated Text Structure Tools

Keep paragraph, heading, and lists out of Insert and Data object tools.

Reasons:

- Paragraph and heading are already the Text Style control.
- Lists are paragraph structure, not inserted objects.
- Duplicating them creates two competing mental models.
- Slash can still include paragraph, heading, and lists because slash is a broad command catalog.

### 7.4 Focused Popovers For Complex Tools

Use focused popovers, dialogs, panels, or sheets for tools that contain interactive controls:

- Table dimensions.
- Media selection.
- File upload.
- Record selection.
- Dataset selection.
- Data grid setup.
- Diagram setup.
- TOC settings.
- Page layout settings.
- Comment threads.
- AI prompts and result review.

Use React Aria overlay primitives such as `DialogTrigger`, `Popover`, `Dialog`, `Modal`, `MenuTrigger`, `Menu`, `ListBox`, `ComboBox`, `Tabs`, and React Aria `Button` where appropriate. Use DaisyUI semantic classes for appearance.

Do not put interactive grids or form controls inside React Aria `MenuItem`.

### 7.5 Explicit Data Surface

Data is not merely a subset of Insert. Data is the home for *mini-app objects* — structured or computed objects that open their own in-place editor and bake to a static result (data grid, chart, mermaid diagram) — plus host-managed references (record, dataset, post ref, citation).

This supersedes the earlier provenance-based framing. The Insert/Data split is by *object nature*, not by whether a tool is host-backed (§3.15, §7.9). Image is therefore an **Insert** tool even though its picker calls a host library; host-backing only gates availability, it does not move the tool to Data. The discriminator for Data is "does the object have its own editor and a bake step," not "does it touch the host."

### 7.6 Controlled Host Extensibility

Host extensibility must be explicit.

The editor should not preserve and render unknown blocks by accident. Unknown data can carry security, rendering, and migration risk. If hosts need custom blocks, they need a typed registry that describes normalization, editor rendering, read rendering, command placement, and failure behavior.

### 7.7 Publication Settings Are Not Body Blocks

Page layout, page headers, page footers, page numbers, and export settings should not be inserted into the root body stream as normal rich-text nodes.

They should live in document settings or in host-owned book settings passed through a typed binding. View can expose the controls, but the body remains the authored content.

### 7.8 Object Chrome Over Contextual Tabs

Configure a selected object from chrome attached to the object, not from a Word-style contextual ribbon tab.

Rationale:

- Proximity. The author's eyes and cursor are already on the object; a contextual tab forces a round trip to the top of the screen and back.
- The editor already ships object chrome (table layout/header/row-number popovers, code language, callout tone). A contextual tab would be a more distant duplicate of controls that already exist.
- It keeps the three surfaces orthogonal (§3.11): flyout = text run, chrome = object, ribbon = creation/global. A contextual tab would blur chrome and ribbon together.

The ribbon therefore owns *creation* (Insert/Data) and *editing of text and selection* (Home); the object's *configuration* is chrome. Creation is a transient act that belongs on a browse surface; configuration is ongoing and belongs with the thing.

### 7.9 Provenance Is Gating, Not Navigation

Group tools by what the object is to the author, never by whether its data is host-backed (§3.15). Media is an Insert tool because authors expect "add a picture" there; `mediaLibrary` / `onUploadMedia` only gate whether it is enabled. Data is the home for *mini-app objects* (own editor, bake to static) and host-managed references, not for "everything host-backed."

Recorded structural choice (open): Insert and Data may be one categorized Insert surface or two sibling tabs.

- A single categorized Insert (groups: Basic, Media, Data & charts, Diagrams) is simplest for a basic author — one entry point, internal grouping, no boundary to learn, and it avoids raising a thin tab.
- A separate Data tab is justified once its mini-app objects are dense enough to read as finished and share a distinct workflow; promotion of a category to a tab is cheap, demotion is churn (§3.16).

Either way, the navigation the author sees follows intent, and slash remains the search-anything fallback so "I just want a picture" never depends on knowing which tab owns it.

### 7.10 Bake At Author Time

Computed and rendered objects bake to a static representation at author time, stored in the node (§5.8). The export worker assembles baked pieces and runs no heavy libraries (§2.7); the digital reader may enhance the baked baseline with interactivity; the printed/exported artifact uses the baked baseline alone. This single rule governs mermaid, data-grid charts, and computed cells, and is the reason new heavy nodes are a cross-cutting contract (§2.7) rather than editor-local.

## 8. Implementation Direction

This section describes how the model should be built. It is intentionally not a checklist.

### 8.1 Toolbar Layout Model

Introduce a pure toolbar layout helper that consumes command state, insert actions, data providers, review bindings, view capabilities, and AI providers, then returns visible tabs and slots.

The helper should be testable without DOM measurement. It should answer:

- which tabs are available;
- which tab is selected by default;
- which slots appear in each tab;
- which commands or providers belong to each slot;
- which items are hidden by allowlist or missing provider;
- which items are disabled by current selection capability;
- which item labels can collapse responsively.

### 8.2 Command And Insert Metadata

Extend command and insert metadata so layout does not infer meaning from labels.

Useful metadata:

```ts
type CommandDomain =
  | "editing"
  | "textStructure"
  | "localObject"
  | "hostData"
  | "view"
  | "review"
  | "ai";

type CommandComplexity = "direct" | "menu" | "focusedTool";

type CommandSource = "editor" | "host";
```

Insert actions should distinguish:

- paragraph/list/heading transformations;
- local object creation;
- host-backed data creation;
- reference creation;
- structured data creation.

### 8.3 Toolbar Rendering

`LexicalToolbar` should render from the toolbar layout, not directly from `COMMAND_GROUP_ORDER`.

Desktop should show:

- compact task tabs;
- one active command row;
- visibly grouped slots;
- icon-only states with tooltips when labels are hidden;
- focused popovers for complex tools;
- overflow only when measured collapse requires it.

Home starts with `Text style` before inline formatting. Insert starts with Table. Data starts with host-backed tools when providers exist.

### 8.4 Data Surface Rendering

Data should adapt current specific bindings into the more general provider model:

- `mediaLibrary` becomes a media data source.
- `onUploadMedia` becomes an upload tool.
- `postLibrary` becomes a post/reference data source.

Provider tools should use existing shared UI where possible:

- `ResourceSelector` for async, sync, or paginated picker flows.
- `FileDropzone` for uploads.
- `DataTable` for structured data previews or selectable tabular data.
- React Aria popovers/dialogs for focused setup flows.

The node produced by a provider must be known to the editor and renderer, or the provider must supply a full host-node definition.

### 8.5 Publication Settings Preservation

The document schema, normalization, serialization, and renderer should preserve document-level settings.

`normalizeDocument` should normalize body children and normalize or safely preserve `settings`. `lexicalEditorState` should still convert only body content into Lexical state, because Lexical root state is not the right place for publication settings. `onChange` should emit the full canonical document including settings.

The renderer should read settings from the document or from explicit renderer options.

### 8.6 Responsive Behavior

Responsive behavior should be staged per active tab:

1. Hide optional labels before hiding controls.
2. Use compound controls for dense groups.
3. Collapse by semantic slot, not random individual buttons.
4. Show overflow only when a slot is actually collapsed.
5. Use horizontal scroll as the final narrow-width fallback.

Pinned controls:

- Home keeps `Text style` and inline basics visible as long as possible.
- Insert keeps `Table` visible as long as possible.
- Data keeps at least one configured data path visible when providers exist.
- View keeps preview/layout entry points visible.
- Review keeps comment-thread entry visible when comments exist.
- AI keeps the primary provider action visible when an AI provider exists.

### 8.7 Mermaid Implementation

- Add a `mermaid` node to the editor schema, normalization, serialization, and the renderer, and register it in the host content union (§2.7).
- Node shape: `source` (mermaid DSL), baked `svg`, and optional config (`theme`, `direction`, `align`). Reuse the hand-rolled code surface for the source edit mode; reuse the media-style resting display for the SVG.
- Bake the SVG at author time on source change (§5.8); keep the last good SVG and show an error state when the source does not parse (§9).
- Lazy-load `mermaid` (or accept it as a host binding); the renderer must not import it.

### 8.8 Data Grid Implementation

- Add a `data-grid` node (cells `data-cell`) separate from `table` (§5.4, §5.7), with normalization, serialization, renderer support, and host-union registration.
- Tier 1 first: typed columns, per-column format/alignment, optional total row; column config via chrome popover; baked static table embedded in the node.
- A large grid uses expand-to-edit (§5.5) rather than nested scroll inside the flowing document.
- An optional chart binding bakes to SVG via the shared pipeline (§5.8).
- Reader sort/filter is opt-in per grid and defaults off (§5.7).
- Tier 2 (formulas/recalc) is bounded by real demand; if built, it still bakes values and the renderer/export never recalculate.

### 8.9 Selection And Focus For Tab Overlays

Tab tools that open React Aria `Popover` / `Modal` portal outside the toolbar DOM, so the current focus and selection handling needs to extend to them:

- Capture a saved selection (the insertion `RangeSelection`) before opening any focused tool, and restore it on apply, so "insert at cursor" survives the picker taking focus.
- Extend the editor's control-surface allowlist (currently flyout / action-popover / context-menu / slash-menu / toolbar) so tab overlays do not flip `canFormat` to false and grey out the toolbar while open.
- The toolbar command context currently hardcodes `hasSelectedText: false`; AI selection-scoped actions and the Comment action need the real selection, so the toolbar must track actual selected text for those slots.
- Prefer CSS container queries over JS measurement for responsive label/group collapse to avoid layout thrash; reserve measured collapse for true overflow.
- Verify the ARIA composition: a React Aria `Tabs` whose panels contain a `Toolbar` (roving tabindex) must not fight the outer toolbar's key handling.

## 9. Edge Cases And Failure Modes

- **Allowlist excludes a node:** the corresponding tool is hidden. Slash/context behavior should follow the same allowlist.
- **Data provider is missing:** the Data tab hides the provider tool. If no data providers exist, the Data tab can be hidden.
- **Data provider load fails:** the focused picker shows an error state and does not insert an incomplete node.
- **Data provider returns stale ids:** the node can remain in the document, but editor/read rendering should show a recoverable unresolved state.
- **Media upload fails:** the upload tool returns to idle with an error message and does not replace existing media.
- **Post reference resolver is unavailable in renderer:** the renderer can fall back to stored title/url if present, or show an unresolved reference primitive.
- **Unknown node arrives:** normalization should drop, flatten, or preserve only according to an explicit host-node registry. Silent arbitrary rendering is not allowed.
- **Document settings are unsupported by a host:** settings should be preserved where possible and ignored safely where unsupported.
- **Page layout conflicts with host book settings:** host-level settings can override document settings, but the precedence must be explicit.
- **Popover steals selection:** use the existing selection restoration and toolbar refocus patterns.
- **Flyout instability:** editor-owned overlays must be treated as part of the editor focus model to avoid remount/flicker while applying formatting.
- **Mobile width is tight:** command rows scroll horizontally and dense groups open semantic popovers/sheets. They do not wrap.
- **More/overflow confusion:** overflow is a responsive fallback, not the semantic place for Insert or Data.
- **Mermaid source does not parse:** show an error state with the failing location and keep the last good SVG; do not blank the diagram or write an invalid bake.
- **Heavy library unavailable:** if `mermaid` or a chart library fails to load or is not provided, the object shows its baked SVG if present, otherwise a recoverable unresolved state; the editor never hard-crashes on a missing render library.
- **Data grid has no valid baked snapshot:** the object is not exportable; the editor surfaces this rather than emitting a node export cannot render.
- **Reader re-sorts an interactive grid:** prose that references row order can desync; sort/filter is therefore opt-in per grid and off by default.
- **Export target is reflowable:** fixed-layout settings (page size, margins, running headers, page numbers) are dropped or treated as hints, not rendered as body; the body structure still exports faithfully.
- **Export target is fixed-layout:** pagination, running headers/footers, page numbers, and widow/orphan control are honored by the paged-media stage; the editor only supplies controls and preserved settings, not the pagination engine.
- **Tab overlay takes focus:** the saved insertion selection is restored on apply and the toolbar does not grey out while the overlay is open (§8.9).
- **New node rejected by the host union:** an unregistered node type is refused at the API boundary; adding a node means updating editor, renderer, host union, and export together (§2.7).

## 10. Test And Verification Plan

Automated coverage should prove the model, not pixel-perfect layout:

- Toolbar layout tests assert tab availability, slot ordering, and provider-driven visibility.
- Home tests assert `Text style` appears before `Bold`, `Italic`, `Underline`, `Strike`, and inline code.
- Insert tests assert Table appears first and text-structure transformations are excluded.
- Data tests assert media/post providers appear under Data and are hidden when providers are missing.
- Slash/context tests assert the broad command catalog still includes valid insert actions.
- Serialization tests assert document settings are preserved through normalization and editor change emission.
- Renderer tests assert document settings are read or safely ignored, and host-backed nodes resolve through renderer options.
- Existing selection flyout tests continue to pass.
- Existing table, TOC, heading-anchor, comment, media, and post-ref tests continue to pass.
- Mermaid tests assert the source bakes to a stored SVG, the renderer uses the baked SVG without importing mermaid, and an unparseable source yields an error state that keeps the last good SVG.
- Data grid tests assert typed columns and total rows bake to a static table, the node is export-complete (baked fields standalone), `table` and `data-grid` are distinct node types, and reader sort/filter is off unless opted in.
- Bake tests assert that editing source/data/config re-bakes the snapshot and that export reads only baked fields.
- Render-tier tests assert the editor, digital reader, and export tiers render the same node from full-interactive, enhanced, and baked-static representations respectively.
- Surface-orthogonality tests assert object configuration is reachable from chrome (not a contextual tab) and that creation actions are not duplicated across flyout, chrome, and ribbon.
- Insert/Data grouping tests assert Image is an Insert tool while data-grid/chart/mermaid are Data (mini-app) tools, and that host-backing gates availability without moving an item between tabs.

Visual verification should use Ladle:

- Desktop Home tab.
- Desktop Insert tab with Table first.
- Desktop Data tab with media and post providers configured.
- Narrow desktop active-tab row without wrapping.
- Phone-width Home command tray.
- Phone-width Insert command tray.
- Phone-width Data command tray.
- Table picker.
- Data provider picker.
- TOC rail or preview/page-layout view when available.
- Mermaid resting (SVG), source edit mode, and error state.
- Data grid resting static table, expand-to-edit, and an interactive (sort/filter) reader preview.
- Data-grid-driven chart, baked.

Full verification remains `pnpm check` after implementation changes.

## 11. Completion Criteria

- The toolbar is organized by task tabs, not raw command groups.
- Home edits the current text and block.
- Insert creates document objects grouped by author intent (image included), not by data provenance.
- Data is the home for mini-app objects (data grid, chart, mermaid) and host-managed references.
- View has a clear owner boundary for preview, TOC rail, and page/publication layout.
- Review has a clear owner boundary for comment-thread and collaboration state.
- AI has a provider-driven owner boundary and no product-specific implementation inside the editor.
- `More` is not the desktop Insert or Data catalog.
- Paragraph, heading, and list transformations are not duplicated inside Insert or Data tools.
- The document model has an explicit publication/settings boundary or a documented host-owned equivalent that the editor does not strip.
- Unknown host-backed blocks are handled through explicit contracts, not accidental JSON passthrough.
- Editor and renderer parity is maintained for any node or setting that affects published output.
- Mobile uses task tabs plus a command tray instead of wrapping the desktop row.
- The toolbar is a modern collapsed ribbon (one row per tab) for creation and globals; object configuration is reached from object chrome, not contextual tabs; text-run actions stay on the selection flyout. The three surfaces do not duplicate each other.
- Tools are grouped by author intent, not provenance; Image is an Insert tool and host-backing only gates availability.
- Heavy objects (code, media, table, mermaid, data grid) follow resting = baked, edit = in place, config = popover, with expand-to-edit for the densest.
- Every heavy object bakes a self-sufficient static representation at author time; the export tier renders only baked output and the digital reader may enhance it with interactivity.
- Mermaid stores source plus a baked SVG, degrades gracefully on parse errors, and the renderer needs no mermaid library.
- The data grid is a distinct node from the table, is export-complete on its own, defaults reader interactivity off, and treats formulas (if built) as author-time convenience that still bakes values.
- New node types are registered across editor, renderer, host content union, and export as one coordinated contract.
- Publication settings are preserved by the editor and interpreted by the output target; the reflowable-versus-fixed-layout choice is an explicit, recorded open decision.
- Tab overlays preserve the insertion selection and do not disable the toolbar while open.

## 12. Final Model

The editor should have a persistent compact task-tab toolbar that shows the book-authoring model directly.

The toolbar is a hybrid, not a single paradigm. A modern collapsed ribbon (one row per tab) owns creation and document-global work; per-object chrome owns configuring a selected object; the selection flyout owns the selected text run. These three surfaces are orthogonal by selection scope and never duplicate each other.

Home edits the current text and block, with `Text style` leading the inline formatting controls because the editor has no font-family or font-size controls. Insert creates document objects grouped by author intent — Table first, Image alongside it even though its picker is host-backed, with focused popovers for richer tools. Data is the home for mini-app objects (data grid, chart, mermaid) and host-managed references; each opens its own in-place editor and bakes to a static result. View owns preview, outline, TOC rail, and publication layout controls. Review owns comment-thread and collaboration state. AI owns provider-driven generation, transformation, and analysis.

Heavy objects share one shape — resting shows the baked static result, editing happens in place, configuration is a chrome popover — and render across three tiers: the editor (full interaction), the digital reader (interactivity as enhancement), and export (baked static only, because the export worker runs no heavy libraries). Author-time computes; publication bakes. The baked static representation is the load-bearing baseline for every object, and the reflowable-versus-fixed-layout output decision determines how much of the publication-settings layer is honored versus treated as a hint.

On mobile, the same model becomes a touch-first command tray with one horizontal active row and semantic overlays for dense tools. Slash remains the broad command catalog. Responsive overflow is a fallback for width, not the product model.
