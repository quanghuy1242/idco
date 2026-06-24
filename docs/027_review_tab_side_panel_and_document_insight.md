# Review Tab, The Side Panel Dock, And Document Insight Surfaces

> Status: Design — not yet built, not scheduled. This document settles the model, the seams, and the philosophy. The implementation backlog and ticket breakdown are deliberately omitted: the design is to be reviewed and accepted before any slice is scoped. Where a section would normally hand off to tickets, it instead states the acceptance shape so the eventual backlog has an unambiguous target.
> Date: 2026-06-24
> Scope: `packages/editor` (owned-model engine). Covers the Review tab, a generic side-panel dock, a Document Collections SPI for document-owned reference data (glossary as the first tenant), a Comment Source SPI for host-owned annotation threads (a sibling of docs/026), and the family of document-insight panes (comments, glossary, statistics, accessibility, broken references). Excludes the persistence-format flip (docs/010 §12), the reader tier extraction (docs/015, cross-referenced only), and the toolbar/ribbon layout internals (docs/023, docs/024), which this document consumes rather than redefines.
> Source docs: docs/006 §4.2/§4.6/§5 (Review intent, comment contract, data-provider sketch), docs/026 (host data provider SPI, the three-actor seam, snapshot-as-fallback, provenance gating), docs/016 (node SPI registration spine), docs/023/§024 (toolbar/command SPI).
> Related docs: docs/015 (reader tier — the glossary registry and comment snapshot both feed it), docs/011 §12 (the owned-engine SPI restatement), docs/025 (virtual geometry — the dock must not fight virtualization).
> Assumptions: the owned engine (`packages/editor`) is the target; `editor-legacy` (Lexical) is reference-only and slated for retirement (docs/015 §8), so its comment popover and inline glossary node are studied for what to keep and what to drop, never ported. The persistence format is mid-flip (docs/010 §12); everything here is specified against the owned model's node/mark shape and is format-flip-neutral.

## Table Of Contents

- [1. Purpose And Scope](#1-purpose-and-scope)
- [2. Philosophy: Review Is The Document-Insight Surface](#2-philosophy-review-is-the-document-insight-surface)
  - [2.1 Three Lines This Design Draws](#21-three-lines-this-design-draws)
  - [2.2 Derive, Do Not Store](#22-derive-do-not-store)
  - [2.3 What This Is Not: The Legacy Popover](#23-what-this-is-not-the-legacy-popover)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 Comments And Glossary Are Identity Marks With No Body](#31-comments-and-glossary-are-identity-marks-with-no-body)
  - [3.2 The Document Index Already Builds The Rollup Off-Thread](#32-the-document-index-already-builds-the-rollup-off-thread)
  - [3.3 The Marks Render Inert](#33-the-marks-render-inert)
  - [3.4 The Review Tab Is Scaffolded But Empty](#34-the-review-tab-is-scaffolded-but-empty)
  - [3.5 No Authoring, No Host Binding](#35-no-authoring-no-host-binding)
  - [3.6 The Overlay Seam Exists; The Aside Rail Was Removed](#36-the-overlay-seam-exists-the-aside-rail-was-removed)
  - [3.7 Legacy As Reference Only](#37-legacy-as-reference-only)
- [4. The Unifying Model: References Over Collections](#4-the-unifying-model-references-over-collections)
  - [4.1 A Reference Points At An Item In A Collection](#41-a-reference-points-at-an-item-in-a-collection)
  - [4.2 Two Backings: Document-Owned And Host-Owned](#42-two-backings-document-owned-and-host-owned)
  - [4.3 Where This Meets docs/026](#43-where-this-meets-docs026)
- [5. Document Collections SPI](#5-document-collections-spi)
  - [5.1 The New Document-Level Model Slot](#51-the-new-document-level-model-slot)
  - [5.2 Registration](#52-registration)
  - [5.3 Transactions And History](#53-transactions-and-history)
  - [5.4 Serialization And Index Contribution](#54-serialization-and-index-contribution)
  - [5.5 Glossary As First Tenant; Future Tenants](#55-glossary-as-first-tenant-future-tenants)
- [6. The Glossary Model](#6-the-glossary-model)
  - [6.1 Registry Plus Reference Marks](#61-registry-plus-reference-marks)
  - [6.2 The Two Authoring Flows](#62-the-two-authoring-flows)
  - [6.3 The Glossary Pane](#63-the-glossary-pane)
  - [6.4 Recommendation-Only Auto-Mark](#64-recommendation-only-auto-mark)
  - [6.5 Document-Local Versus Host-Shared Glossary](#65-document-local-versus-host-shared-glossary)
  - [6.6 Reader Consequences](#66-reader-consequences)
- [7. The Comment Model](#7-the-comment-model)
  - [7.1 Comment Source SPI: The docs/026 Sibling](#71-comment-source-spi-the-docs026-sibling)
  - [7.2 The Thread Shape](#72-the-thread-shape)
  - [7.3 The Mark Stores A Ref Plus A Snapshot](#73-the-mark-stores-a-ref-plus-a-snapshot)
  - [7.4 The Comment Pane](#74-the-comment-pane)
  - [7.5 The Marks Stop Being Inert](#75-the-marks-stop-being-inert)
  - [7.6 Anchor Stability And Orphans](#76-anchor-stability-and-orphans)
  - [7.7 Provenance Gating](#77-provenance-gating)
- [8. The Side Panel SPI: The Dock](#8-the-side-panel-spi-the-dock)
  - [8.1 One Dock, Tabbed, One Pane Visible](#81-one-dock-tabbed-one-pane-visible)
  - [8.2 Registration And The panelHost.open Seam](#82-registration-and-the-panelhostopen-seam)
  - [8.3 Responsive Behavior](#83-responsive-behavior)
  - [8.4 Editor Chrome, Not Host Layout](#84-editor-chrome-not-host-layout)
  - [8.5 Tab Order And Pinning](#85-tab-order-and-pinning)
  - [8.6 Relationship To Toolbar Tabs](#86-relationship-to-toolbar-tabs)
- [9. The Review Tab And Its Panes](#9-the-review-tab-and-its-panes)
  - [9.1 Add Actions: Flyout And Review, Never Home](#91-add-actions-flyout-and-review-never-home)
  - [9.2 Comments Pane](#92-comments-pane)
  - [9.3 Glossary Pane](#93-glossary-pane)
  - [9.4 Insights Pane: Statistics](#94-insights-pane-statistics)
  - [9.5 Insights Pane: Accessibility Lint](#95-insights-pane-accessibility-lint)
  - [9.6 Broken References](#96-broken-references)
  - [9.7 Changes And AI: Reserved](#97-changes-and-ai-reserved)
- [10. The Selection-Tracking Prerequisite](#10-the-selection-tracking-prerequisite)
- [11. Architecture Decisions](#11-architecture-decisions)
- [12. Risks, Edge Cases, And Failure Modes](#12-risks-edge-cases-and-failure-modes)
- [13. Verification Plan](#13-verification-plan)
- [14. Definition Of Done For The Design](#14-definition-of-done-for-the-design)
- [15. Final Model](#15-final-model)
- [16. Implementation Phasing](#16-implementation-phasing)
  - [16.1 Dependency Order](#161-dependency-order)
  - [16.2 Phase 0 — Lock The Contracts](#162-phase-0--lock-the-contracts)
  - [16.3 Phase 1 — Foundations](#163-phase-1--foundations)
  - [16.4 Phase 2 — Statistics Pane](#164-phase-2--statistics-pane)
  - [16.5 Phase 3 — Document Collections SPI And Glossary](#165-phase-3--document-collections-spi-and-glossary)
  - [16.6 Phase 4 — Comment Source SPI And Comment Model](#166-phase-4--comment-source-spi-and-comment-model)
  - [16.7 Phase 5 — Accessibility And Broken References](#167-phase-5--accessibility-and-broken-references)
  - [16.8 Phase 6 — Annotation Interaction](#168-phase-6--annotation-interaction)
  - [16.9 Phase 7 — Reserved](#169-phase-7--reserved)
  - [16.10 Sequencing Rationale](#1610-sequencing-rationale)

## 1. Purpose And Scope

Comments and glossary are half-migrated to the owned engine: the data model and the derived index are ported, but the authoring workflow, the host binding, and any management surface are not (§3 grounds this against the current code). This document is the design that closes that gap, and it deliberately widens the frame past "wire up comments" to the question the gap actually raises: what is the Review tab *for*, where do annotation tools live, and what is the general surface that holds them.

The answer this document argues for is that Review is not a comment feature with a sidebar bolted on. Review is the editor's **document-insight surface** — the place where everything the engine can *derive* about a document is shown back to the author: their comment threads, their glossary, their word counts, their accessibility problems, their broken references. Comments are the first tenant, not the whole tenancy. Designing only for comments would produce a second bespoke surface beside the toolbar, and the codebase has a consistent allergy to bespoke surfaces (it registers nodes, marks, commands, toolbar tabs, and data sources through one registry-by-id pattern; see docs/016, docs/023, docs/026). So the design introduces three reusable SPIs and then expresses comments and glossary as their first instances.

In scope: the Review tab and its placement rules; a generic side-panel dock (the Side Panel SPI); a Document Collections SPI for document-owned reference data; the glossary model built on it; a Comment Source SPI for host-owned threads, built as a sibling of docs/026; and the insight panes (statistics, accessibility, broken references). Out of scope by deliberate decision: the implementation backlog and tickets (held for design review), the persistence flip, the reader extraction, and track-changes/AI suggested edits (reserved with a seam but not designed here).

## 2. Philosophy: Review Is The Document-Insight Surface

### 2.1 Three Lines This Design Draws

The whole design rests on three distinctions. They are worth stating plainly because every later decision falls out of them.

**Content versus metadata.** A glossary definition is part of what the prose *means*: an abbreviation and its expansion are content the reader is entitled to. A comment thread is editorial conversation *about* the prose: it is metadata that is never part of the published meaning. This line decides where each thing is stored. Glossary is document-owned — it travels inside the document and the reader can render a back-matter glossary from it. Comments are host-owned — the document carries only an anchor, and the host owns the conversation. The two annotations look identical in the model today (both are identity marks carrying nothing but an id and a range), and that surface similarity is exactly what has to be broken: they are different kinds of thing and must diverge.

**A reference is not a copy.** The legacy editor stored a glossary term's definition inline on every occurrence, so the same term defined in twelve places was twelve copies that could drift. The correct model is that an annotation is a *reference* to a single item in a collection; editing the item updates every occurrence because there is only one item. This applies whether the collection lives in the document (glossary) or in the host (comments). "Define once, reference everywhere" is not a feature to add later; it is the data model.

**Derive, do not store.** Almost everything Review shows is a pure function of the document — the comment list, the glossary table, the word count, the heading-order problems, the dead references. The engine already has the machinery to compute exactly this kind of derived state off the main thread and publish it live (the bake cluster in `core/bake/` and the document index). So Review's panes are *consumers* of derived state, not new stores. This is the difference between a Review surface that stays correct as the author types and one that drifts and needs manual refresh.

### 2.2 Derive, Do Not Store

The third line deserves its own paragraph because it is the architectural payoff. The engine builds a `DocumentIndex` — `{ toc, text, comments }` — through a pure walk of the document (`buildDocumentIndex`, [bake.ts:146-193](../packages/editor/src/core/bake/bake.ts#L146-L193)), runs it off the main thread through the bake worker, coalesces rebuilds under the scheduler's idle lane, and publishes the result through a tiny pub/sub store that views read with `useSyncExternalStore` (`use-document-index.ts`, `document-index-store.ts`). The TOC node is already a consumer of `index.toc`. The comment rollup `index.comments` already exists and already carries both `comment` and `glossary` entries with their anchored text ([bake.ts:80-93](../packages/editor/src/core/bake/bake.ts#L80-L93)).

Every Review pane in this document is the same shape of thing: subscribe to a derived rollup, render it, dispatch edits back through commands. The comments pane reads `index.comments` filtered to `kind: "comment"`. The glossary pane reads the glossary collection joined with `index.comments` filtered to `kind: "glossary"` for occurrence counts. The statistics pane reads `index.text`. The accessibility pane reads `index.toc` (heading order) plus a small object-node walk (alt text, table headers). The broken-references pane reads the reference-block resolve status (docs/026 §7). None of these is new compute placement; they extend the existing derive-and-publish pipeline that already runs through the scheduler's idle lane. This is why Review can be rich without being expensive, and why "Review is the document-insight surface" is a statement about the engine, not a slogan.

### 2.3 What This Is Not: The Legacy Popover

The legacy Lexical editor's comment experience is a single inline popover: click a highlighted span, a popover opens at that position showing one thread, with delete and (if wired) save. There is no list, no filter, no resolved state, no navigation, no way to see all comments without scrolling the document and clicking each highlight. Glossary in legacy is the opposite extreme — fully inline-owned, each occurrence storing its own `term` and `definition` on a decorator node, with no management surface at all.

This document keeps exactly one thing from legacy: the instinct that *adding* an annotation is a selection gesture (legacy exposes the comment button in its selection flyout). Everything else is redesigned. The popover survives only as the lightweight read-on-click affordance; the real work — listing, filtering, resolving, managing, navigating — moves into a dedicated pane. The "too simple" problem is solved not by enriching the popover but by giving annotations a management surface they never had.

## 3. Current-State Findings

### 3.1 Comments And Glossary Are Identity Marks With No Body

In the owned engine, `comment` and `glossary` are identity marks alongside `link` ([marks.ts:119](../packages/editor/src/core/model/marks.ts#L119)). A `TextMark` carries `id`, `kind`, `from`, `to`, and an optional `attrs: JsonObject` ([model.ts:183-188](../packages/editor/src/core/model/model.ts#L183-L188)). The `attrs` slot is already used by `link` to hold its `href` (the segment signature reads `mark.attrs?.href`, [marks.ts:130-131](../packages/editor/src/core/model/marks.ts#L130-L131)), but `comment` and `glossary` put nothing in `attrs` today. So a comment mark and a glossary mark are, right now, just a typed range with an id and no payload.

This is the single most important finding, and it is good news: the owned model has *already* refused to store comment bodies or glossary definitions in the document. The "wrong model" — annotation content living in document state — does not exist here to undo. What is missing is the other half: a place to put the reference (`attrs`), a collection for the reference to point at, and the authoring and management surfaces. The model is correctly minimal; it is under-built, not mis-built.

### 3.2 The Document Index Already Builds The Rollup Off-Thread

`buildDocumentIndex` walks every text leaf, and for each mark of kind `comment` or `glossary` it resolves the boundary offsets and pushes a `CommentIndexEntry` of `{ id, node, kind, text }` ([bake.ts:177-186](../packages/editor/src/core/bake/bake.ts#L177-L186)). The result is part of `DocumentIndex.comments`. The rebuild runs through `bakeService.buildIndex` on the worker and is scheduled on the idle lane with `coalesce: "latest"` (`use-document-index.ts`), then published through `document-index-store` for views to read reactively. The data spine for a comments pane and the occurrence counts for a glossary pane already run, off-thread, live, today.

### 3.3 The Marks Render Inert

Both kinds render through `renderAnnotationMark`, which returns a bare `<span data-engine-mark={kind} data-engine-mark-id={id}>` with no class, no handler, and no state ([mark-render.tsx:87-94](../packages/editor/src/view/render/mark-render.tsx#L87-L94)); they are registered with nesting ranks (comment outermost at rank 1, glossary at rank 2) so they nest deterministically ([mark-render.tsx:129-130](../packages/editor/src/view/render/mark-render.tsx#L129-L130)). The span is semantically inert: it cannot be clicked to open a thread, it shows no highlight, and it cannot reflect resolved state. Turning the marks into live, clickable, state-reflecting highlights is net-new view work that this design calls out rather than assumes ported.

### 3.4 The Review Tab Is Scaffolded But Empty

The Review tab is registered through the toolbar SPI but gated off and carries no slots: `registerToolbarTab({ id: "review", isAvailable: (ctx) => ctx.capabilities.review, label: "Review" })`, with `review: false` in the default capabilities ([command-builtins.tsx:197-201](../packages/editor/src/view/chrome/surfaces/command-builtins.tsx#L197-L201)). Because no slots are registered into it, it resolves empty and is dropped from the rendered toolbar. The placement target exists; it has nothing in it.

### 3.5 No Authoring, No Host Binding

A thorough search of `packages/editor/src` finds no comment command, no glossary command, no popover component, and none of the host callbacks the legacy editor exposes (`onComment`, `comments`, `onCommentUpdate`, `onCommentDelete`). The model can carry the marks and the index can roll them up, but there is no path that adds, edits, resolves, or removes one, and no surface through which a host supplies thread data. Authoring and host binding are entirely unbuilt.

### 3.6 The Overlay Seam Exists; The Aside Rail Was Removed

The view mounts registered overlays once as singleton portals — `SelectionOverlay`, `SelectionAnnouncer`, `TouchSelectionLayer` ([react-view.tsx:497-502](../packages/editor/src/view/react-view.tsx#L497-L502)). A dock can reuse this portal seam. Separately, the side/aside TOC rail was removed by design on the principle that the shell is the host's concern. The dock this document introduces is therefore designed *against* that decision deliberately, not in ignorance of it (see §8.4): the removed thing was a reading-time layout rail owned by the host; the dock is edit-mode editor chrome and is a different surface.

### 3.7 Legacy As Reference Only

The legacy contract is `RichTextEditorBindings` with `onComment(id, quote, body)`, `comments: RichTextEditorComment[]`, `onCommentUpdate`, `onCommentDelete` ([editor-legacy/src/nodes/base.tsx:56-69](../packages/editor-legacy/src/nodes/base.tsx#L56-L69)), where `RichTextEditorComment = { id, quote, body }`. docs/006 §4.6 already judged this contract: "enough for simple annotation, but not full review workflow. Review needs room for resolved state, author metadata, timestamps, replies, permissions, and change-review state." Legacy glossary is an inline `DecoratorNode` storing `term`/`definition` per occurrence, exported as `<abbr>`. We take the flyout instinct and the `<abbr>` reader output; we drop the flat three-field thread, the per-occurrence definition copies, and the popover-only management.

## 4. The Unifying Model: References Over Collections

### 4.1 A Reference Points At An Item In A Collection

The model that unifies comments, glossary, and the docs/026 reference blocks in one sentence: **an annotation or block is a reference; a reference names an item in a collection; the item is the single source of truth.** A glossary mark references a term in the glossary collection. A comment mark references a thread in the comment collection. A media node references an asset record in a host collection (docs/026). The reference stores a stable id (and, where the collection is remote, a denormalized snapshot for static rendering); it never stores the authoritative content.

For marks, the reference lives in the `attrs` slot that already exists and is already used this way by `link` (a link "references" a URL). A glossary mark becomes `attrs: { term: termId }`; a comment mark becomes `attrs: { thread: threadId, snapshot?: {...} }`. No new field on the mark type is required — `attrs: JsonObject` is the home, and the segment-signature machinery already distinguishes identity marks by `kind#id` plus an attr ([marks.ts:126-137](../packages/editor/src/core/model/marks.ts#L126-L137)), so adding the ref attr extends an existing pattern rather than inventing one.

### 4.2 Two Backings: Document-Owned And Host-Owned

A collection has exactly one of two backings, and the content/metadata line from §2.1 decides which:

- **Document-owned collection** — the items live inside the document, travel with it, and are part of the published content. Glossary terms, and later a bibliography, a figures list, an abbreviations list. Served by the **Document Collections SPI** (§5).
- **Host-owned collection** — the items live in the host, the document carries only references plus optional snapshots, and the host owns lifecycle and permissions. Comment threads, and the docs/026 reference records (posts, media, authors). Served by host source registries: docs/026's data-source registry for display records, and this document's **Comment Source SPI** (§7) for threads.

The reference shape is identical across both backings; only the resolution target differs. This is the property that lets a glossary be document-local by default and host-shared by configuration without changing the mark (§6.5): the mark says "term X"; whether X is resolved from `document.collections.glossary` or from a host glossary source is a binding decision, not a model change.

### 4.3 Where This Meets docs/026

docs/026 built the host-owned half for *display records* and explicitly scoped comments out ("Excludes ... comments authoring", [026 line 5](../docs/026_host_data_provider_spi_reference_blocks.md)). It defined the three-actor seam — source (deployment-owned, returns host records), block (author-owned, projects a record into its data shape), engine (picker, `{ref, snapshot}` cache, resolve scheduling, gating) — and the discipline that makes a remote reference safe: stale-while-revalidate resolve (§7.2), the snapshot as the error fallback so a dangling ref renders the last good copy rather than a blank (§7.3), and provenance gating so a block whose source is unregistered hides its own affordance (§9).

This document reuses that seam wholesale for comments, with one substitution: the source's capabilities are thread operations (load/resolve/create/reply/update/remove/resolve-state) instead of record operations (load/resolve). Everything else — the snapshot fallback, SWR, provenance gating — applies unchanged. Comments are not a new architecture; they are docs/026's seam pointed at a different kind of host record. The reason to keep a *sibling* registry rather than overloading the docs/026 data-source type is that thread capabilities and display-record capabilities are genuinely different sets, and fusing them would force every display source to grow thread methods it will never implement (§11, decision D4).

## 5. Document Collections SPI

### 5.1 The New Document-Level Model Slot

The owned model today is a node tree plus per-leaf marks. It has no place for data that belongs to the document as a whole rather than to a node. The glossary registry is the first such thing, and rather than add a glossary-specific field, the model gains one generic slot:

```
EditorDocumentSnapshot {
  ...existing node tree...
  collections: { [collectionId: string]: CollectionItem[] }
}
```

`collections` is a keyed bag of arrays. `collections.glossary` holds `GlossaryTerm[]`; a future `collections.bibliography` holds `Citation[]`; the model core knows none of these shapes — it stores opaque `CollectionItem`s (each at minimum `{ id: string }`) and leaves the shape to the registered collection. This mirrors how the node registry stores opaque node `data` and leaves the shape to the registered node type (docs/016). One generic slot, many tenants.

### 5.2 Registration

A feature registers a collection the same way it registers a node or a toolbar tab:

```
registerDocumentCollection({
  id: "glossary",
  // Optional dev-time validation of an item; production trusts the snapshot.
  validate?: (item) => item is GlossaryTerm,
  // Optional contribution to the document index (see §5.4).
  indexEntries?: (items, doc) => GlossaryIndexEntry[],
})
```

The registry exposes `registerDocumentCollection` / `getDocumentCollection` / `listDocumentCollections`, matching the existing registry verbs. A reference attr names a collection by id (`attrs: { term: termId }` is understood as "item `termId` in collection `glossary`" by the glossary mark's own resolution; a fully generic ref could be `{ collection: "glossary", item: termId }`, and §11 D2 settles which form to standardize).

### 5.3 Transactions And History

Editing a collection item — adding a glossary term, changing a definition, deleting a term — must go through the same transaction and history chokepoint as node edits (`core/store/history.ts`), so that:

- glossary edits are undoable and redoable exactly like text edits, in the same undo stack and the same order;
- a single user action that touches both the collection and the node tree (type-first glossary creation marks a range *and* adds a term, §6.2) is one atomic transaction, so undo reverses both halves together and never leaves a mark pointing at a term that undo removed;
- collection mutations participate in the same change notification that drives the index rebuild, so the panes update without a separate subscription path.

This is the load-bearing requirement of the SPI and the reason the collection slot lives in the model rather than in a side store. A glossary kept outside the document's transaction log would desynchronize from undo the first time the author undoes across a definition edit. The collection is document state; it gets document state's transactional guarantees.

### 5.4 Serialization And Index Contribution

`collections` serializes as part of the document snapshot — it is plain JSON-able data, so it rides the existing serialize/deserialize path with no special transport. Bake and the document index gain a collection pass: after the node walk, `buildDocumentIndex` calls each registered collection's optional `indexEntries(items, doc)` and folds the result into the index. For glossary this produces, per term, the term text, the definition, and — by joining against the existing `index.comments` entries of `kind: "glossary"` — the occurrence count and the list of node ids where it appears. The pane reads this joined view; it never walks the document itself. Because the collection pass runs inside the same off-thread `buildDocumentIndex` already scheduled on the idle lane, glossary insight costs nothing on the main thread (§2.2).

### 5.5 Glossary As First Tenant; Future Tenants

Glossary proves the SPI; it is not special-cased by it. The forcing function mirrors docs/026 §8.2: if the glossary feature is built entirely as `registerDocumentCollection({ id: "glossary" })` plus a glossary mark that references it plus a pane that reads its index entries, with no glossary-specific hook in the model core, then the SPI is general by construction and the next tenant (bibliography/citations — document-owned references with a back-matter list, structurally identical to glossary) is a registration, not a new mechanism. If glossary needs a core hook the SPI does not provide, that hook is a gap in the SPI to close before shipping, not a glossary exception to grant.

## 6. The Glossary Model

### 6.1 Registry Plus Reference Marks

A glossary term is `GlossaryTerm = { id, term, definition, aliases?: string[], category?: string }`, stored once in `document.collections.glossary`. An inline glossary mark stores `attrs: { term: termId }` — a reference into the registry, never a copy of the definition. The number of times a term appears in the prose is the number of marks pointing at its id; the definition exists exactly once. Editing a definition is editing one registry item, and every occurrence reflects it immediately because every occurrence only ever held the id.

This is the structural cure for legacy's drift: there is no second copy to fall out of sync, so "inconsistent definitions" is not a lint to run — it is a state the model cannot represent. The only problems the model *can* represent are an unused term (a registry item no mark references) and an orphaned reference (a mark whose `termId` names a deleted item); both are surfaced by the pane (§6.3).

### 6.2 The Two Authoring Flows

Two flows reach the same registry. They are two doors to one room, not two modes.

**Define-first (structured).** The author opens the Glossary pane, clicks "New term", and types term, definition, and optional aliases. The term enters the registry with zero occurrences. The author can build an entire glossary up front — the back-matter-first workflow a technical book or manual uses — before marking anything. Marking occurrences is then optional and on the author's schedule.

**Type-first (inline).** The author selects a word in the prose and chooses "Add to glossary" from the selection flyout. Then:

- if a term (by term text or alias) already exists in the registry, a compact React Aria ComboBox offers the existing terms; choosing one links this occurrence to it — a new mark, no new item;
- if the term is new, an inline popover takes the definition, and a single atomic transaction both creates the registry item and marks the selected range (§5.3 guarantees the two halves undo together).

The flyout offer is "Add to glossary", and the disambiguation between link-existing and create-new happens inside the popover by matching the selected text against the registry. The author is never asked to pick a flow.

### 6.3 The Glossary Pane

The Glossary pane is the professional management surface the legacy editor never had: a table the author works in without scrolling the document. Columns: **Term · Definition (inline-editable) · Occurrences · Aliases · Category**. Per-row actions: edit the definition (propagates to every occurrence because there is one definition); **jump to occurrences** (the index carries the node ids, so navigation is a scroll-to-node, cheap); **delete** (warned as "this unmarks N occurrences", because deleting the term orphans its marks unless they are removed in the same transaction — the pane offers both: delete-and-unmark, or delete-and-keep-as-orphan for later re-linking); **merge** two terms into one (re-points the losing term's marks at the winner, then removes the loser, atomically). The pane header carries Add-term, search, sort, and category filter. The pane explicitly surfaces the two representable problems from §6.1 — unused terms and orphaned references — as filterable states, so the author can clean the glossary the way they would proofread.

### 6.4 Recommendation-Only Auto-Mark

The engine never marks prose on the author's behalf. When a term is defined or its aliases change, the pane may compute and *show* "12 unmarked occurrences of this term" and offer a review queue where the author accepts marks individually or as a vetted batch. The default is to do nothing until asked. This is a deliberate posture: the document belongs to the author; the strongest thing the tool does unbidden is recommend. The same posture governs the accessibility pane (§9.5) — it flags, it never rewrites. Auto-marking, silent normalization, and auto-fix are all out; surfacing and one-click-with-review are in.

### 6.5 Document-Local Versus Host-Shared Glossary

Default: the glossary is document-local — `document.collections.glossary` — and self-contained, so the document is portable and the reader renders its glossary from the document alone. But because the glossary mark holds only `{ term: termId }` resolved through a registry-by-id seam, a deployment that wants a glossary *shared across many documents* points the same mark's resolution at a host glossary source (a docs/026-style source, or a Comment-Source-style sibling for editable shared terms) instead of the document collection. The mark does not change; only the resolution backing does. So "document-level glossary versus shared glossary" is not a fork to choose at design time — document-local is the default and the only thing built first; host-shared is the same reference mechanism with an external backing, available later without reworking stored documents. This is the §4.2 "same reference shape, two backings" property cashed out for the one case the user flagged as undecided.

### 6.6 Reader Consequences

Because the glossary registry travels in the document, the reader (docs/015) renders from a single source with no host call: inline occurrences become `<abbr>` with the definition as the accessible description (matching legacy's HTML export), and an optional generated back-matter glossary section lists every used term and its definition. One registry feeds both surfaces; they cannot disagree. This is the content side of the content/metadata line paying off in the reader: glossary is content, so the reader is self-sufficient for it.

## 7. The Comment Model

### 7.1 Comment Source SPI: The docs/026 Sibling

Comments are host-owned, so the host registers a comment source — the docs/026 three-actor seam with thread capabilities:

```
registerCommentSource({
  id: "comments",
  load:        (docContext, signal) => Thread[],          // threads for this document
  resolve:     (threadId, signal) => Thread | null,       // one thread, refreshed
  create:      (anchor, body) => Thread,                  // open a new thread on a range
  reply:       (threadId, body) => Thread,                // append to a thread
  update:      (threadId, body) => void,                  // edit a comment body
  remove:      (threadId) => void,                        // delete a thread
  setResolved: (threadId, resolved) => void,              // toggle resolved state
})
```

The editor owns the picker-free seam (a comment is created from a selection, not picked from a list), the `{ref, snapshot}` cache, the SWR resolve scheduling, and the static reader render of the snapshot. The host owns the thread store, identity, permissions, and persistence. No comment source registered means no comment authoring and no comments pane — provenance gating (§7.7), identical to docs/026 §9.

### 7.2 The Thread Shape

The thread is the rich shape docs/006 §4.6 asked for and legacy lacked:

```
Thread {
  id: string
  anchor: { node: NodeId, markId: string }   // where it attaches in the document
  excerpt: string                              // the quoted range text, denormalized
  body: string
  author: { id, name, avatar? }
  createdAt, updatedAt: string
  resolved: boolean
  replies: Comment[]                           // { id, body, author, createdAt }
}
```

Authoring identity, timestamps, permissions, and reply threading live here, in the host, never in the document. The document's only knowledge of a thread is the mark that anchors it.

### 7.3 The Mark Stores A Ref Plus A Snapshot

A comment mark stores `attrs: { thread: threadId, snapshot?: CommentSnapshot }`, where `CommentSnapshot = { author, excerpt, resolved }` is a thin denormalized copy. The snapshot is the docs/026 §7.3 discipline applied to threads: it lets the reader paint a margin note statically with no host call, and it lets the editor show a sensible highlight before `resolve` returns or when the host is unreachable. SWR governs the live editor: render the snapshot instantly, `resolve` on mount, patch. Store-only would mean a thread resolved on another device never updates here; snapshot-only would mean the editor never reflects new replies. Both halves are required, and both are exactly what docs/026 §7.2-7.3 already specified for display records.

### 7.4 The Comment Pane

The Comments pane reads threads from the source (seeded by `index.comments` of `kind: "comment"` for anchors and excerpts, hydrated by `load`/`resolve` for bodies and state) and presents them as a list grouped by **Unresolved / Resolved**, matching the docs/006 §4.6 `[Comments] [Unresolved] [Resolved]` row. Each entry shows the excerpt, the author and time, the body, and replies; actions are reply, edit, resolve/reopen, delete, and jump-to-anchor. Filtering by author and a count badge for unresolved threads belong here. The pane is the management surface; the inline popover (§7.5) remains only the quick read-on-click.

### 7.5 The Marks Stop Being Inert

For real comments the inert span of §3.3 becomes a live highlight: a visible background on the marked range, a click target that opens the thread (popover for a quick read, or focuses the thread in the pane), and a visual reflection of `resolved` (a resolved thread's highlight dims or hides while keeping the anchor). This requires the SWR snapshot/thread state to flow into `renderAnnotationMark`, which today receives only the mark. The render gains read access to the resolved comment state for the mark's `thread` id. This is the one genuinely new view-layer slice the comment feature needs beyond wiring; it is called out so it is planned, not assumed.

### 7.6 Anchor Stability And Orphans

A comment (and glossary) mark anchors to a range through `MarkBoundary` (anchor node, offset, stickiness; [model.ts:177-181](../packages/editor/src/core/model/model.ts#L177-L181)). When the underlying text is edited or deleted, the range can shrink to nothing or vanish. Legacy had no story and silently lost comments. Here, because `index.comments` carries the live anchored `text` slice, a mark whose range has collapsed is detectable, and the pane shows the thread as **orphaned/detached** rather than dropping it: the conversation is preserved, flagged, and re-anchorable or dismissible by the author. The policy is keep-and-flag, never silent-delete — the §6.4 recommendation-only posture applied to anchor loss. The same treatment covers a glossary mark orphaned by a deleted term (§6.3).

### 7.7 Provenance Gating

`capabilities.review` stops being a hardcoded boolean and becomes a function of the registry: the Review tab and the Comments pane are available when a comment source is registered, exactly as docs/026 §9 gates a reference block on its data source. This makes Review visibility a per-deployment **schema-profile** decision (the `allowedNodes`/profile concept, cross-referenced in docs/006 §2.7's server-side Zod union): a blog profile that registers no comment source has no Review comments; a book profile that registers one does. The capability flag is the gate's surface; the registry is its truth. Glossary's gating is analogous but document-owned: the glossary pane appears when the glossary collection is registered, which a profile includes or omits.

## 8. The Side Panel SPI: The Dock

### 8.1 One Dock, Tabbed, One Pane Visible

The dock is a single region, docked to one side, showing registered panes as tabs along its top, with exactly one pane visible at a time. Not split panes. The decision is driven by the product's paginated book layout (docs/006 §4.5): horizontal space is scarce, and two simultaneous side columns would crowd the page. Tabs give the author switching without spending width on more than one pane. Realistically three to five panes are registered and available at once — Comments, Glossary, an Insights pane (statistics plus accessibility), Outline, and later an AI Assistant — each gated by its capability so it only appears when wired.

```
┌─ editor ─────────────────────────┬─ dock (toggleable) ───────────┐
│                                   │ [Comments][Glossary][Insights]│  ← pane tabs
│   document …                      │ ───────────────────────────── │
│   (virtualized, unaffected)       │   active pane body            │
│                                   │   (list / table / stats)      │
└───────────────────────────────────┴────────────────────────────────┘
```

### 8.2 Registration And The panelHost.open Seam

A pane registers like everything else:

```
registerSidePanel({
  id: "comments",
  title: "Comments",
  iconName: "comment",          // registered in nav-icons per the UI package rule
  isAvailable: (ctx) => ctx.capabilities.review,
  render: (ctx) => <CommentsPane ... />,
})
```

The dock is generic chrome and knows nothing about comments or glossary; it renders the available panes as tabs and shows the active one. A pane is opened by a command calling `panelHost.open(paneId)`: the Review tab's command opens `comments`, a View-tab command opens `outline`, an AI-tab command opens `assistant`. So which tab a pane "belongs to" is just which command opens it; the dock holds them all. Whether comments and glossary are two panes or one Review pane with an internal switcher is the Review feature's composition choice — the recommendation is flat sibling panes (no nested tabs), so the dock surfaces Comments, Glossary, and Insights as peers.

### 8.3 Responsive Behavior

On a wide viewport the dock is a side column. On a narrow viewport it stops being a column and becomes an overlay sheet covering part of the viewport, with the same tabs and the same panes. This reuses the responsive-collapse pattern already in `@idco/ui` (the toolbar display/collapse work) and the overlay portal seam from §3.6 — the dock is built from existing primitives, not a hand-rolled layout. The dock must not perturb the document's virtual geometry (docs/025): it changes the editor viewport's width, which the virtual window already handles as a resize, but it must never mount inside the scroller or it would corrupt offset measurement.

### 8.4 Editor Chrome, Not Host Layout

This is the boundary that lets the dock exist without reopening the removed-rail decision. The aside rail that was removed was a *reading-time* surface — a published TOC rail tied to the host's page layout — and removing it was correct because reading layout is the host's concern. The dock is a *different* surface: it is edit-mode-only editor chrome, like the toolbar, present while authoring and absent in the reader. The host owns the page frame, the reading layout, and any published TOC rail; the editor owns its toolbar and its dock. Stating the boundary this way keeps "the shell is the host's concern" intact and true — the dock is not the shell. As an escape hatch, the editor may expose the panel registry and a `renderDock` slot so a host that wants the panes inside its own layout can place them, but the editor ships a working default dock and does not require host cooperation (the opposite of the TOC rail, which was punted to the host entirely). The optional reunion: because Outline is just another registered pane, the removed outline finds a home in the dock as editor chrome, without becoming a host-layout dependency again.

### 8.5 Tab Order And Pinning

Tab order is registration order, matching the engine-wide rule that ordering is registration sequence, not explicit numbers (the "SPI ordering = registration" convention). The available set is whatever is registered and passes `isAvailable`. For the first design, tabs are neither user-reorderable nor pinnable; pinning and reordering are a later affordance if the author demand appears. This keeps the dock's state minimal (open/closed plus active pane id) and avoids persisting per-user tab layout before there is evidence it is wanted.

### 8.6 Relationship To Toolbar Tabs

Toolbar tabs (docs/023) and dock panes are different surfaces and stay separate registries. A toolbar tab is a ribbon of commands; a dock pane is a workspace. They relate only through commands: a toolbar tab's command opens a dock pane. This separation is why the Comment add-action (a command in the Review ribbon and the selection flyout) and the Comments pane (a dock workspace) are distinct registrations that happen to belong to the same feature. Fusing them would re-entangle "issue a command" with "show a workspace," which the rest of the architecture keeps apart.

## 9. The Review Tab And Its Panes

### 9.1 Add Actions: Flyout And Review, Never Home

Adding a comment or a glossary term is available in exactly two places: the **selection flyout** (the floating affordance over selected text — the primary, context-first surface) and the **Review tab** ribbon (for discoverability). It is deliberately *not* on Home. This overrides docs/006 §4.2, which parked Glossary and Comment in `home.annotate`; the override is intentional and is recorded here as decision D1 (§11). The reasoning: Link is content formatting and stays on Home; Comment and Glossary are editorial annotation, and keeping their add-actions with their management in the Review tab makes Review a self-contained annotation workspace and removes the tab-bounce that splitting add-versus-manage across two tabs would cause. The selection flyout being primary means the author never depends on a tab to annotate at all — selecting text always offers it — so the tab placement is a discoverability choice, not a workflow dependency.

### 9.2 Comments Pane

As specified in §7.4: threads grouped by unresolved/resolved, per-thread reply/edit/resolve/delete/jump, author filter, unresolved badge, host-backed through the comment source. Opened by the Review tab's Comments command into the dock.

### 9.3 Glossary Pane

As specified in §6.3: the term table with inline-editable definitions, occurrence counts and jump, delete/merge with orphan handling, unused-term and orphaned-reference filters, document-owned through the glossary collection. Opened by the Review tab's Glossary command into the dock.

### 9.4 Insights Pane: Statistics

A read-only pane over `index.text`: word count, character count, estimated reading time, heading and section counts, and a readability estimate (e.g. a Flesch score) derived from the text rollup. With real selection tracking (§10) it also shows selection-scoped counts ("selected: 142 words"). Everything here is a pure function of the already-built text index; the pane is a renderer, not a calculator, and it stays correct as the author types because the index is live.

### 9.5 Insights Pane: Accessibility Lint

Content accessibility checks, recommendation-only (§6.4), limited to what is cheap and grounded in existing derived state:

- **Heading order** — flag level skips (h1 → h3) and empty headings; nearly free from `index.toc`.
- **Image alt text** — flag media nodes with missing or empty `alt`; a small object-node walk on a field that already exists.
- **Table headers** — flag tables without a header row.
- **Link text** — flag vague text ("click here") and bare URLs.

This is *content* accessibility (is the authored document accessible to its readers), not editor accessibility (is the editing UI keyboard- and screen-reader-correct); the latter is baseline product quality, not a pane feature, and is out of scope here. Heading-order and alt-text are the first two to ship — highest value, lowest cost — with the rest following. Each finding links to its node (jump-to) and explains the fix; none is auto-applied.

### 9.6 Broken References

A pane (or a section of Insights) listing reference blocks whose `resolve` failed or whose ref is dangling — a dead post-ref, a removed media asset (docs/026 §7.3 staleness, surfaced as review signal). A failed resolve is an editorial problem the author should see before publishing, and Review is where document health lives. This is the Review-side payoff of the docs/026 resolve lifecycle: the engine already knows a reference is stale (it renders the snapshot fallback); Review is where that knowledge becomes a list the author can act on.

### 9.7 Changes And AI: Reserved

Track-changes / suggested edits and AI-proposed changes (docs/006 §4.6 "Changes", §4.7 "propose review change") are reserved, not designed here. The seam that makes room for them: a suggested edit and a human comment are both *annotations on a range with a thread of discussion and a resolved/accepted state* — the same shape the comment model already carries. So when Changes is designed, it should extend the annotation/thread model rather than introduce a parallel one, and the Review dock should hold it as another pane. Recording the seam now prevents a second annotation mechanism from growing later.

## 10. The Selection-Tracking Prerequisite

Several surfaces here need the real current selection: the Comment and Glossary add-actions (they annotate the selected range), and the selection-scoped statistics (§9.4). docs/006 §951 records that the toolbar command context currently hardcodes `hasSelectedText: false`, so selection-scoped slots cannot light up today. This is a shared prerequisite: one fix — threading the real selection (presence, range, and text) into the command/toolbar context — unblocks the annotation add-actions, the flyout's enablement, and the selection statistics together. It is called out as a prerequisite rather than folded into any one feature because all three depend on it and none should re-solve it.

## 11. Architecture Decisions

**D1 — Annotation add-actions live in the selection flyout and the Review tab, not Home.** Chosen over the docs/006 §4.2 placement on `home.annotate`. Rationale in §9.1: Link is content (Home); Comment and Glossary are editorial annotation (Review), and co-locating add with manage makes Review self-contained. Rejected: keeping them on Home (causes a tab-bounce during review passes); putting add on Home and manage on Review (the split the user identified as unnatural).

**D2 — The mark reference attr form.** Two forms are viable: a kind-specific attr (`{ term: id }`, `{ thread: id }`) that each mark interprets, or a generic `{ collection, item }` / `{ source, ref }` form. Recommendation: kind-specific attrs for the built-in marks (least ceremony, mirrors `link`'s `href`), with the generic form reserved for a future generic reference mark if custom annotation kinds appear. Settle before building so the serialized attr shape is stable.

**D3 — One generic `collections` slot, not per-feature document fields.** Chosen over adding a `glossary` field to the document. Rationale §5.1/§5.5: the next document-owned collection (bibliography) is then a registration, not a model change. Rejected: a glossary-specific field (special-cases the first tenant and forces a model change for the second).

**D4 — Comment source is a sibling registry, not an extension of the docs/026 data-source type.** Chosen because thread capabilities (create/reply/resolve) and display-record capabilities (load/resolve) are different sets; fusing them would force display sources to carry thread methods they never implement. Rejected: overloading the docs/026 source type with optional thread methods (muddies the type and the gating semantics). The seam (snapshot, SWR, provenance) is shared; the capability set is not.

**D5 — One tabbed dock, one pane visible, no split.** Chosen for the paginated layout's width budget (§8.1). Rejected: split/multiple simultaneous panes (crowds the page); a VS Code-style activity bar with the panel closed (unnecessary when toolbar commands open panes directly).

**D6 — The dock is editor chrome, distinct from the removed host aside rail.** Chosen to preserve "the shell is the host's concern" while still giving annotations a home (§8.4). Rejected: re-introducing a host-layout rail (reopens the closed decision); leaving the panel entirely host-provided (ships a broken default, the mistake the TOC rail's punt made).

**D7 — Glossary is document-owned by default, host-shared by the same mechanism.** Chosen so the document is portable and the reader self-sufficient, while leaving shared glossaries available without a stored-document rework (§6.5). Rejected: host-owned glossary by default (breaks document portability and reader self-sufficiency for content that is part of meaning).

**D8 — Recommendation-only, never auto-modify.** Chosen as a product posture (§6.4): the document is the author's; the tool surfaces and recommends, it does not silently mark, normalize, or fix. Applies to auto-mark, accessibility, and orphan handling. Rejected: auto-marking term occurrences and auto-fixing a11y issues (disrespects author ownership and risks unwanted edits).

## 12. Risks, Edge Cases, And Failure Modes

- **Anchor loss.** Editing or deleting marked text collapses a mark's range. Mitigation: keep-and-flag as orphaned (§7.6), surfaced in the pane; never silent-delete. The live `index.comments` text slice makes collapse detectable.
- **Undo across a collection edit.** A type-first glossary creation that marks a range and adds a term must be one transaction or undo desynchronizes mark and term. Mitigation: the Document Collections SPI routes edits through the same history chokepoint (§5.3); the atomicity is a hard requirement, tested explicitly.
- **Stale or unreachable comment host.** `resolve` fails or the host is down. Mitigation: the snapshot is the fallback (§7.3) — the editor shows the last good author/excerpt/resolved state and a quiet "couldn't refresh", never a blank or a crash.
- **Dock versus virtualization.** A panel mounted inside the scroller would corrupt offset measurement (docs/025). Mitigation: the dock is a sibling of the scroller in layout, changing only viewport width, which the virtual window already treats as a resize (§8.3).
- **Profile gaps.** A document stored under a book profile (with glossary and comments) opened under a blog profile (with neither). Mitigation: provenance gating hides the affordances (§7.7), and the orphan/unused surfacing means the stored marks degrade visibly rather than breaking — the schema-profile honesty the deployment profile calls for.
- **Merge correctness.** Merging two glossary terms must re-point the loser's marks and remove the loser atomically, or marks orphan mid-merge. Mitigation: single transaction; tested.
- **Selection context regression.** The selection-tracking prerequisite (§10) touches the toolbar command context; getting it wrong disables every selection-scoped slot. Mitigation: it is a shared prerequisite with its own tests, landed before the features that depend on it.
- **Reader divergence for comments.** If the reader is allowed to call the host for thread state it stops being static. Mitigation: the reader renders only the snapshot (§7.3/§6.6); live thread state is an editor concern.

## 13. Verification Plan

Design-level acceptance (the observable behaviors a future implementation must satisfy; not a ticket list):

- **Glossary single-source.** Editing one definition updates every occurrence's rendered tooltip and the reader back-matter, with no second copy anywhere in the snapshot.
- **Two flows converge.** Define-first and type-first both produce the same registry item plus reference marks; a type-first creation is one undoable transaction that reverses both halves.
- **Orphan survival.** Deleting marked text leaves the thread/term flagged as orphaned in the pane, never dropped; re-anchoring or dismissing is the author's choice.
- **Comment host-ownership.** No comment body, author, timestamp, reply, or resolved flag is present anywhere in the serialized document; only the anchor mark and an optional snapshot are.
- **Snapshot fallback.** With the comment source unreachable, comment highlights still render from the snapshot and the reader still paints margin notes statically with zero host calls.
- **Derive-don't-store.** Every pane stays correct as the author types without a manual refresh, because each reads the live document index / collection index.
- **Provenance gating.** With no comment source registered, the Review comments pane, the Comment add-actions, and the Review tab's comment entry are all absent; registering the source lights them up.
- **Dock behavior.** Exactly one pane is visible; switching tabs preserves each pane's state; on a narrow viewport the dock becomes an overlay sheet with the same tabs; the document's virtual scroll position is unperturbed by opening/closing the dock.
- **Recommendation-only.** No code path marks prose, normalizes a definition, or fixes an accessibility finding without an explicit author action.

## 14. Definition Of Done For The Design

This document is done as a *design* when: the three SPIs (Document Collections, Comment Source, Side Panel) have settled shapes and registration verbs; the glossary model (registry + reference marks + two flows + pane) is unambiguous; the comment model (source SPI + thread shape + snapshot + pane + live marks) is unambiguous; the dock model (one tabbed region, editor chrome, responsive) is settled with its boundary against the removed host rail stated; the eight architecture decisions (§11) are accepted or amended; and the placement override (D1) is confirmed. The implementation backlog, phase sequencing, and tickets are intentionally not part of this document and are to be authored only after this design is reviewed and accepted.

## 15. Final Model

Review is the editor's document-insight surface: the place where everything the engine can derive about a document is shown back to the author. It is built on three reusable seams and one posture.

The reusable seams: a **reference points at an item in a collection**, and a collection is either document-owned (the **Document Collections SPI**, glossary first) or host-owned (the **Comment Source SPI**, a sibling of docs/026's data-source SPI). A **Side Panel dock** — one tabbed region, one pane visible, editor chrome and not host layout — holds the panes that render those collections and the other derived insights (statistics, accessibility, broken references), every one of them a consumer of the off-thread document index, not a new store.

The posture: the document belongs to the author. Glossary is content and lives in the document; comments are metadata and live in the host; the tool surfaces problems and recommends fixes but never silently edits. Comments and glossary stop being two identical id-only marks and become what they always were — a host-owned conversation and a document-owned definition — joined only by the fact that both are references, and both finally have a workspace to be managed in.

## 16. Implementation Phasing

This section is *sequencing*, not the ticket backlog. The §14 gate still holds: the phases below order the work and state each phase's grounding and acceptance shape, but they are scoped into tickets only after this design is reviewed and accepted. The order is chosen to land the two unblocking foundations first, then the cheapest self-contained pane, then the document-owned heavy slice (glossary), then the host-bound slice (comments), with the remaining insight panes last. Phases with no dependency between them are explicitly marked parallel.

### 16.1 Dependency Order

The gating relationships, stated once so each phase below can reference them rather than restate them. **D2** (the serialized mark attr form, §11) gates every mark slice and must be settled before any code touches `attrs`. **Phase 1a** (selection tracking) gates the flyout enablement, both annotation add-actions, and the selection-scoped statistics. **Phase 1b** (the dock) gates every pane. **Phase 3a** (the Document Collections SPI) gates the glossary. The **docs/026 data-source registry** (already shipped) gates the Comment Source SPI's sibling shape and the broken-references pane. 1a and 1b have no dependency on each other and run in parallel; within Phase 1 they are the whole critical path.

### 16.2 Phase 0 — Lock The Contracts

A gate, not a build. Accept or amend the eight decisions in §11; the load-bearing one to settle before any mark code is **D2 — the mark reference attr form**, because it is the serialized shape and retrofitting it would break stored documents. The recommendation stands: kind-specific attrs (`{ term }`, `{ thread, snapshot? }`) mirroring `link`'s `href` ([marks.ts:126-137](../packages/editor/src/core/model/marks.ts#L126-L137)), generic `{ collection, item }` reserved for a future generic reference mark. No slice starts until D1–D8 and the D1 placement override are confirmed (§14).

### 16.3 Phase 1 — Foundations

Two independent slices, run in parallel; together they are the skeleton everything else mounts on. Neither ships a user-facing annotation feature.

**1a — Selection-tracking prerequisite (§10).** Thread the real current selection — presence, range, and text — into the command/toolbar context, replacing the hardcoded `hasSelectedText: false` (docs/006 §951). It is a shared prerequisite with its own tests: it unblocks the flyout enablement, the comment and glossary add-actions, and the selection-scoped statistics together, and none of those should re-solve it. *Acceptance:* the §12 "selection context regression" guard — every selection-scoped slot lights up from one source.

**1b — Side Panel SPI and the dock (§8).** A generic `registerSidePanel` registry modeled on [data-source-registry.ts](../packages/editor/src/view/spi/data-source-registry.ts) (module singleton, register-by-id, idempotent, registration-order listing); the one-tabbed-region dock reusing the singleton overlay portal seam ([react-view.tsx:497-502](../packages/editor/src/view/react-view.tsx#L497-L502)) and the `@idco/ui` responsive-collapse pattern; the `panelHost.open(paneId)` command seam; and `capabilities.review` flipped from the hardcoded boolean ([command-builtins.tsx:197-201](../packages/editor/src/view/chrome/surfaces/command-builtins.tsx#L197-L201)) to a function of the registry (§7.7). Ship it with **Outline as its first real pane** — Outline consumes `index.toc`, which the TOC node already reads, so it proves the dock with real content rather than a placeholder and cashes out the outline reunion of §8.4. *Acceptance:* the §13 "dock behavior" item — one pane visible, tab state preserved on switch, narrow-viewport sheet, virtual scroll position unperturbed (the §8.3 / docs/025 hazard).

### 16.4 Phase 2 — Statistics Pane

The cheapest end-to-end vertical slice (§9.4): a read-only pane over the existing `index.text`, with no new model and no host binding. It consumes 1a for selection-scoped counts. It goes here because it proves the "a pane is a consumer of the live document index inside the dock" pattern at the lowest risk before the heavy slices rely on it. *Grounding:* `index.text` already runs off-thread ([bake.ts](../packages/editor/src/core/bake/bake.ts), [use-document-index.ts](../packages/editor/src/view/controllers/use-document-index.ts)). *Acceptance:* the §13 "derive-don't-store" item — the pane stays correct as the author types with no manual refresh.

### 16.5 Phase 3 — Document Collections SPI And Glossary

The document-owned heavy slice, sequenced before comments because it is fully self-contained (no host source to stand up to demo it) and it forces the Collections SPI to be general by construction (§5.5).

**3a — Document Collections SPI (§5).** The generic `collections` slot on [EditorDocumentSnapshot](../packages/editor/src/core/model/model.ts#L261); `registerDocumentCollection` / `getDocumentCollection` / `listDocumentCollections`; the load-bearing routing of collection edits through the same transaction and history chokepoint as node edits ([core/store/history.ts](../packages/editor/src/core/store/history.ts)) so a single action that touches both the collection and the node tree is one atomic, undoable transaction (§5.3); serialization (free — plain JSON on the snapshot); and the `indexEntries(items, doc)` pass folded into [buildDocumentIndex](../packages/editor/src/core/bake/bake.ts) so collection insight rides the existing idle-lane rebuild.

**3b — Glossary model (§6).** The `GlossaryTerm` registry as the first collection tenant; the glossary mark storing `attrs: { term: termId }` (the D2 form); the two authoring flows (define-first through the pane; type-first through the selection flyout, which needs 1a); the Glossary pane (term table, inline-editable definition, occurrence count and jump-to, delete and merge with orphan handling, unused-term and orphaned-reference filters); and recommendation-only auto-mark (§6.4). *Acceptance:* the §13 "glossary single-source," "two flows converge," "orphan survival," and "recommendation-only" items, plus the §12 "undo across a collection edit" and "merge correctness" atomicity guards.

**3c — Glossary reader output (§6.6).** The `<abbr>` inline render and the generated back-matter glossary. Specified here, but built in step with the docs/015 reader extraction rather than blocking the glossary feature on the reader tier — flagged, not folded.

### 16.6 Phase 4 — Comment Source SPI And Comment Model

The host-bound slice, carrying the one genuinely new view-layer slice, so it follows the self-contained work.

**4a — Comment Source SPI (§7.1).** A new sibling registry `comment-source-registry.ts`, a near-copy of [data-source-registry.ts](../packages/editor/src/view/spi/data-source-registry.ts) with thread capabilities (load / resolve / create / reply / update / remove / setResolved) replacing record capabilities (decision D4); the `Thread` shape (§7.2); stale-while-revalidate resolve scheduling; and provenance gating — this is where `capabilities.review`'s truth lands for comments (§7.7).

**4b — Comment mark and snapshot (§7.3).** The comment mark `attrs: { thread, snapshot? }` and the `{ ref, snapshot }` cache; render the snapshot instantly, resolve on mount, patch. The snapshot is the docs/026 §7.3 discipline applied to threads — the fallback that lets the editor and reader paint without a live host call.

**4c — Live marks (§7.5).** The new view work: `renderAnnotationMark` ([mark-render.tsx:87-94](../packages/editor/src/view/render/mark-render.tsx#L87-L94)) gains read access to the resolved comment state for the mark's `thread` id, so the inert span becomes a visible highlight, a click target, and a reflection of resolved state.

**4d — Comment pane, add-action, orphans.** The Comments pane (§7.4 — threads grouped unresolved/resolved, reply/edit/resolve/delete/jump, author filter, unresolved badge); the comment add-action in the selection flyout and the Review ribbon (needs 1a); and keep-and-flag orphan handling on anchor loss (§7.6). *Acceptance:* the §13 "comment host-ownership," "snapshot fallback," "provenance gating," and "orphan survival" items, plus the §12 "stale or unreachable comment host" and "reader divergence" guards.

### 16.7 Phase 5 — Accessibility And Broken References

The remaining document-health panes (§9.5–§9.6), recommendation-only.

**5a — Accessibility lint (§9.5).** Heading-order and image alt-text first — highest value, lowest cost, off `index.toc` plus a small object-node walk — then table-headers and link-text. Each finding links to its node and explains the fix; none is auto-applied.

**5b — Broken references (§9.6).** A list of reference blocks whose resolve failed or whose ref is dangling, read off the docs/026 resolve status. The Review-side payoff of the docs/026 resolve lifecycle; gated on docs/026 being in place.

### 16.8 Phase 6 — Annotation Interaction

> Status: the editor (live) half is implemented — `useAnnotationInteraction` + `AnnotationPopover` (read popover, innermost-wins), `panelHost.open(paneId, focusId)`, and the per-pane reveal+ring. The reader (resting) half is docs/015 §12 and is built with the reader extraction.

The marks are visible after P3/P4 (the glossary `<abbr>`, the comment highlight) but still *passive* — you cannot click a marked word to read or manage it. This phase makes the annotations interactive on both tiers and is the natural payoff of the dock: a marked word becomes the entry point to its term/thread. It was surfaced during the first run-through (the marks felt inert next to the dock) and is sequenced after P5 because it depends on P3+P4 existing and reuses three seams already shipped.

The interaction model, settled:

- **Click only, both kinds (consistency).** A click on a glossary or comment mark is the single gesture; no hover-tooltip split between the two. Predictable, touch-friendly, and one code path.
- **Popover first, then route.** The click opens a lightweight *read* popover anchored at the word — the glossary definition (resolved from the one collection, no copy), or the comment thread painted from its snapshot and revalidated (SWR, §7.3). The popover carries a "Manage" / "Open in…" action that opens the dock on the right pane *focused on that item*. Read-first keeps a quick read from yanking the author into the dock, while still making the dock one click away. This supersedes the earlier "comment routes straight to the dock" idea: both kinds get the same read-popover-then-route flow.

This is **SPI work, not bespoke wiring** — the seams already exist:

- **Click delegation reuses the link pattern.** The surface already delegates a click to `useLinkInteraction` by inspecting the target's mark element ([owned-model-editor.tsx](../packages/editor/src/view/owned-model-editor.tsx)). A sibling `useAnnotationInteraction(store)` extends that one delegated handler to `[data-engine-glossary-term]` / `[data-engine-comment-thread]` (the attrs the marks already emit, §6.1/§7.5) and opens one `AnnotationPopover` (the `LinkPopover` shape). Delegated, so it is virtualization-safe and adds no per-mark handler. A precedence rule settles a span that is both a link and an annotation (innermost mark wins, by the existing nesting ranks).
- **Routing extends the dock seam.** `panelHost.open(paneId)` gains an optional focus target — `panelHost.open(paneId, focusId?)` — and each pane gains a "scroll this row/thread into view + transient highlight" contract in its `SidePanelRenderArgs`. The Glossary pane focuses the term row; the Comments pane focuses (and expands) the thread. Small additions to the `PanelHost` and `SidePanel` SPIs, not a new mechanism.

The reader half is **docs/015 §12** (read-only `<abbr title>` for glossary, snapshot-only highlight/margin note for comments, never a host call) and is built with the reader extraction, not here. *Acceptance:* clicking a glossary word reads its definition and can open the Glossary pane on that term; clicking a comment reads its thread and can open the Comments pane focused on it; the click delegation is one handler (no per-mark handlers); and `panelHost.open(paneId, focusId)` reliably reveals + highlights the target in the pane.

### 16.9 Phase 7 — Reserved

Track-changes / suggested edits and AI-proposed changes (§9.7). Not built. The seam is already stated: a suggested edit is an annotation on a range with a thread and an accepted/resolved state — the comment model's shape — so when it is designed it extends the annotation/thread model and registers as another dock pane, rather than growing a parallel mechanism.

### 16.10 Sequencing Rationale

Two ordering calls carry the phasing and are worth restating.

**Glossary before comments.** The document-owned slice is sequenced first because it needs no host to be testable end-to-end and it is what forces the Collections SPI to stay general (§5.5). The alternative — comments first, on the strength of the §2 "comments are the first tenant" framing — would require standing up a host comment source before anything is demoable, and would prove the Side Panel and index-consumer patterns against the more entangled feature.

**Reader output split out.** The glossary `<abbr>` / back-matter render (3c) and the comment snapshot render both cross into the docs/015 reader tier. They are specified inside Phases 3 and 4 but built in step with the reader extraction, so the editor-side glossary and comment features are not blocked on the reader tier landing first.
