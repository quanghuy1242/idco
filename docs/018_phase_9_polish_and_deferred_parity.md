# 018 - Phase 9: Polish And Deferred Parity

> Status: backlog (post-Phase-8). Not started.
>
> Date: 2026-06-19
>
> Relationship to the other docs:
>
> - **010 owns the phasing.** This document expands docs/010 §10.4 "Phase 9" into its tracked items. Where 010 and this document differ, 010 wins.
> - **011 owns the foundation.** The composition-commit and undo-coalescing items realize 011 §9.4 and the §10.5 grouping policy; this document does not change the model.
> - **016 owns the node SPI.** The table live-edit item fills `NodeView.renderLive` for `table`; it does not reshape the SPI.
> - **015 owns the reader.** The "move resting render onto reader L1" item lands when `packages/reader` exists.

## 1. Why This Document Exists

Phase 8 (docs/010 §10.4) landed feature parity, the toolbar/chrome, mark rendering, the node SPI worked examples, the Payload import adapter, markdown shortcuts, HTML paste, find-in-page, and autosave — all opt-in, all tested, with the standard editor untouched. During that work a set of **genuine refinements** and **explicitly-out-of-blog-first book-corpus items** surfaced. This document gathers them so they are tracked rather than lost.

The discipline this document protects: **Phase 9 is not an excuse to defer Phase 8.** Every Phase 8 acceptance criterion is implemented and green. The items here are either typing-loop refinements that are risky to do well inside the IME path, accessibility-audit depth, or book-corpus features that blog-first does not need. Each item names why it waits.

## 2. Items

**Reading this list — three tiers, only one is "now."** "Implement Phase 9" means the *do-now* tier, not all of §2. Building the gated tiers blind would test against fixtures with no real consumer (011 §2.6).

- **Do now** (real Phase 9 polish; has consumers): §2.0, §2.1, §2.2, §2.3, §2.4, §2.8, §2.9, §2.10 (flat-list completeness — `listType`/ordinals/margins), §2.11 (**the measurement guardrail only**), §2.14 (the Lexical baseline UI: selection flyout, TOC rail, drag-handle, comment/glossary authoring).
- **Trigger-gated** (build *with* the first consumer, never speculatively): §2.11 (SPI height seam, windowed-list primitive, recursive structural tier), §2.10 (multi-block-container recursive render + virtualize), §2.6 / §2.13 (table + data-grid internal windowing).
- **Separate workstreams** (larger than Phase-9 polish): §2.5 (reader package), §2.12 (the conformance audit itself), §2.13 (mermaid, data-grid Tier 2, tabbed toolbar, publication settings, fixed-layout pagination).

The general rule behind the tiering: front-load what is *hard and foundational* (risk of getting it wrong late is high); build-on-demand what is *easy and has no consumer yet* (waiting costs nothing because the seam is already locked in 011 §2.6).

### 2.0 Mark parity gaps

- **Collapsed-caret pending format.** Toggling bold/italic/link with a collapsed caret is a no-op today (`compileToggleMark`/`compileLink` need a non-empty range). A standard editor stores a pending format applied to the next typed character; that needs store-held pending-mark state and an apply-on-insert hook.
- **Comment / glossary compat export.** Comment and glossary range marks are modeled and indexed (`buildDocumentIndex`), but `compatInlineChildren` only projects format marks and links to the legacy JSON, so comments/glossary do not yet round-trip through the `RichTextEditorDocument` compat shape (the legacy `@lexical/mark` MarkNode projection). Wire their export/import when comment parity with the standard editor is needed.

### 2.1 Typing-loop affordances

- **Inline-code wrap.** Typing the closing backtick of `` `x` `` should wrap the run in a `code` mark and remove both backticks. The pure detector already exists and is tested (`core/markdown-shortcuts.ts` `detectMarkdownShortcut` returns the `inline-code` shape); only the IME-safe wiring (a range edit that re-anchors the surviving marks correctly through the EditContext sync) is deferred, because it mutates text mid-composition.
- **Smart-quote substitution** (straight to curly) and **bracket auto-pairing**. Both mutate as the user types and interact with the composition/undo path; they are named in 010 Phase 8 AC8 and moved here so they can be designed against the IME fuzz suite rather than bolted on.

### 2.2 Composition commit + undo coalescing

- **Composition-commit granularity (011 §9.4).** Today the preedit *underline* is engine-owned and cleared on `compositionend`, but the preedit *text* applies per-`textupdate` like all typing (each keystroke is its own history entry). 011 §9.4's "only `compositionend` commits a model step" (one atomic undo per composition) rides the deferred undo-coalescing policy.
- **Typing-run coalescing (§10.5).** "Typing run = one undo", with boundaries at format/paste/object-activation, plus selection restoration on undo/redo. The invertible-step model already enables it; the grouping policy is the decision.

### 2.3 Accessibility depth

- A full **axe-core** audit of the editing surface (Phase 7 shipped a structured invariant scan, not axe).
- **`aria-activedescendant` for atomic objects** (text blocks use real-element focus and need no roving descendant; object-focus reflection lands with the object-chrome a11y).

### 2.4 Caret paging

- `PageUp` / `PageDown` viewport paging and horizontal reveal of a long unwrapped line. None change the model; all are overlay/scroll polish on the surface the engine already owns (§11).

### 2.5 Reader package

- When `packages/reader` lands (docs/015), move the resting object and mark render onto its L1 primitives and retire the in-editor `view/resting-document.tsx` shim, so the editor's resting render and the published reader cannot drift. Route baked HTML/SVG (mermaid, grid) through the reader's sanitization boundary when those bakers emit markup.

### 2.6 Book-corpus parity (deferred past blog-first)

- **Payload `block` per-type import.** The import adapter drops-with-report Payload Blocks today; mapping specific block types is a per-type effort tied to the book corpus.
- **`epub-internal-link` semantics.** Imported as a plain `link` mark today (href preserved); the internal anchor-resolution semantics are a book-reader concern.
- **Faithful `table` grid editing.** Tables import as an opaque object that round-trips but is not edited cell-by-cell. A faithful `row → cell → block` grid with a `NodeView.renderLive` is the largest future node (011 §2.4) and is books, not blog. This is also the first node that needs the **fine-grained `applyEdit`/`invertPatch` object mechanism** (011 §6.5/§6.9) — Phase 6 wired only the wholesale immutable `SetObjectData` swap and explicitly deferred the per-edit patch path because no built-in needed it; large-grid editing does, so it lands with this item. And it is the first object to **implement the 011 §2.6 windowing contract**: a 10,000-row grid windows its own rows, declares its full/estimated height to the engine's block-window math, and opts into nested scroll — the engine cannot window it because the rows live in opaque `data`, so the node owns it (see §2.11).

### 2.7 Cross-browser known-failures

- **Firefox cross-block drag-select** is a real Firefox-only engine/drag bug (not a platform limit), `test.fixme`'d in `engine-caret.spec.ts` — root-cause and fix (§11).
- The Firefox **synthetic-`ClipboardEvent`** cut/paste `test.fixme` is a genuine harness limit (real Ctrl+X/V works); leave it.

### 2.8 Editor block-type + object-surface parity gaps

These are blog-relevant blocks that the standard (legacy Lexical) editor authors fully but the owned-model surface only half-supports today. They are named here so Phase 8's "feature parity" claim is honest about its edges.

- **Code block — syntax highlighting + language.** The live edit surface is a bare auto-sizing `<textarea>` (`view/object-block.tsx` `CodeLiveSurface`) and the resting render is an unhighlighted `<pre><code>` (`code-block` `NodeView.renderResting`). The legacy editor highlights code and carries a language. `@idco/ui` already ships `CodeEditor` (Prism) and `CodeBlock`; the deferred work is routing the code node's live/resting render through them and adding a language selector, **while preserving the resting↔live no-shift height contract** (010 §6.4 AC3) — the reason it is a `<textarea>` today is that its auto-sized height matches the baked `<pre>` exactly, and a swap must keep that property. Tracked, not done. Placement rules for the Prism work when it lands (folded from the deleted `note.md`): highlighting is pure compute (string → tokens → HTML), so run it as a worker baker (the Phase 6 `bake.worker` is the slot); route the baked HTML through the §10.5 sanitization boundary, not `dangerouslySetInnerHTML`; keep Prism out of the framework-free `core/**` (G3/G4) — it is a view/bake dep; and put the highlighter in the shared reader/primitive layer (docs/015) once `packages/reader` exists so editor-resting, reader, and export render identical code with no drift (until then the editor highlights its own resting view). Live-edit highlighting is the transparent-textarea-over-highlighted-`<pre>` technique, reusing `@idco/ui`'s `CodeEditor` rather than building a second.
- **Block `indent` level — persist + resting render.** The indent/outdent commands set an `attrs.indent` level on flat blocks (the fallback for the import's flat list items, docs/010 §14 hardening), rendered as a left margin on the editing surface. It is not yet carried through the compat projection (`compat.ts` `pickAttrs` does not include `indent`, so it is dropped on save) nor applied by `resting-document.tsx`, so it is editor-session-only and the resting/reader render does not reflect it. Wire `indent` into the attr round-trip (import + export) and the resting style when indent needs to persist.
- **List + structural-block model.** The `[list]` placeholder and the flat-list completeness gaps (ordered lists, `listType`, list margins, the dead nesting branch) are their own topic — see §2.10.
- **Media / embed resting render — real `<img>`/`<iframe>`, not placeholders.** The built-in `media` and `embed` `NodeView.renderResting` are deliberately lightweight placeholders (`🖼 {src}` thumb, `🔗 {url}`), shared by the editor at rest and the reader via `renderRestingObject`. A published reader wants the actual image and an embed player. Rendering real media — with the resting↔live no-shift contract (010 §6.4 AC3) preserved and baked HTML/SVG routed through the §10.5 sanitization boundary — lands with the reader layer (docs/015) so editor and reader stay identical.
- **Callout — authorable + styled.** `callout` is a modeled text-leaf type: it round-trips, renders as `<aside role="note">` at rest (`resting-document.tsx`), and has an a11y label (`ariaLabelForLeaf`). But it is **not creatable from the editor** — the block-type menu (`view/editor-chrome.tsx` `BLOCK_TYPES`) offers only paragraph/heading/quote — and the editing surface has no callout typography (`ENGINE_TYPOGRAPHY_CSS`), so a callout is indistinguishable from a paragraph while editing. The legacy editor authors callouts (often with a variant/icon). The deferred work is the block-type menu entry, the editor-surface + resting styling, and any variant attribute — modeled but not yet wired end to end.

### 2.9 Lifecycle + remaining deferred capabilities (§10.5)

These are the `[defer-but-named]` capability items from docs/010 §10.5 that were not closed in Phases 5–8 and had no other home; gathered here so they are tracked, not lost.

- **Memory / teardown of unmounted blocks** (§10.5, Phase 5). Unmounting an offscreen block must release its subscriptions, observers, height-cache growth, and worker references; there must be a test asserting **no unbounded growth over a long top→bottom→top scroll of a 5,000-block document**. The teardown paths exist (frame-cancel + `task.cancel` on unmount), but the explicit no-leak assertion over a long scroll is the named, unbuilt proof.
- **RTL / bidi caret as a real test target** (§10.5 / §11 caret affinity). The selection model carries the affinity/`assoc` bit, but the bidi caret-on-wrong-line case at soft-wrap and RTL boundaries is only *acknowledged*, not yet a dedicated cross-browser test. Make it one so the affinity handling is proven, not assumed.
- **Print-from-editor via the reader/export path** (§10.5). Printing must render through the full `packages/reader`/export path, never the virtualized editor DOM (which mounts only the viewport, so a browser print would drop every offscreen block). Lands with the reader package (§2.5).
- **Multi-caret — explicit non-goal (recorded).** Out of v1 by decision (§10.5); noted here only so its absence is not mistaken for an untracked gap.

### 2.10 List + structural-block model (flat-by-design)

**Decision (recorded): lists are flat top-level `listitem` text leaves + attrs; the structural `list` node is never produced by editing or import.** The model has three node kinds (`text`, `object`, `structural`); `structural` is used only by ROOT and a `list` container. But for editing the `list` container is *vestigial*: the toolbar List button toggles a flat top-level `listitem` leaf (parent = ROOT), plain indent uses the `attrs.indent` fallback (`compileIndentAttr`), and the import flattens lists — so `currentListItem` (`core/commands.ts`) never gates into the structural-nesting path, and **no user-creatable or imported document contains a structural `list` node**. The only producer is a hand-built snapshot (the `phase55-editing` story). Consequences: nested-list rendering is *not* a recursive-renderer task — flat leaves + a depth attr **is** the nested-list model; and the `[list]` placeholder (`view/react-view.tsx` `EngineBlock`) guards a representation the engine does not produce. The genuinely-future use of `structural` is multi-block containers (a quote/callout holding block children), tracked separately below and in the virtualization note.

The flat model is the right call (it virtualizes per item for free, no sub-block windowing), but it trades away what a `<ul>`/`<ol>` container gives for free. Those are the concrete gaps:

- **`listType` attr (bullet vs ordered).** Every `listitem` renders a hardcoded `•` (`view/styles.ts` `::before`); there is **no ordered-list support on the editor surface**. Add a `listType` (`bullet`/`number`) attr, carried through the compat round-trip alongside `indent` (§2.8).
- **Ordered-list numbering via render-time adjacency.** Flat items have no container to scope a CSS counter to. Numbering needs the view (which already iterates `order`) to detect runs of consecutive `listitem`s and assign each its ordinal — "grouping" computed at paint, not stored in a parent node. This is also where first/last-in-run is derived. **Required regardless of representation:** a real `<ol>` container would not help, because CSS `counter()` counts only the *mounted* `<li>`s — under virtualization, item 6 mounted alone renders as "1". So ordinals must be model-computed even *with* a structural container, which removes the main reason to reach for a structural list at all (and is why lists stay flat).
- **List-boundary margins.** Items are uniformly styled (`LIST_ITEM_PADDING_Y`), so the engine cannot add extra space *before the first* / *after the last* item — it can't tell which is which without neighbour-awareness. Derive first/last from the same adjacency scan as numbering.
- **Editor↔reader ordered-list drift.** The resting/reader render uses real `<ul>`/`<ol>` with `list-style:decimal` (`view/styles.ts`), but the editor renders flat `•` `listitem`s — so an ordered list would show numbers in the reader and bullets in the editor, and flattening can lose the ordered/`listType` info. Carrying `listType` through the import + compat projection is what makes the two agree (the §6.2 no-drift rule).
- **Quarantine the dead nesting branch.** `compileIndentItem`'s `makeStructuralNode("list")` path (`core/commands.ts`) is unreachable from any user-creatable document (it only fires atop a pre-existing structural list). It is annotated UNREACHABLE-BY-DESIGN and kept dormant as the correct nesting algebra for the day multi-block containers exist; revisit (keep vs delete) when that work is scoped.
- **`phase55-editing` fixture.** It is the only structural-`list` producer and exists to exercise the `[list]` placeholder path. Either relabel it explicitly as a "structural node → placeholder" smoke test or switch it to flat `listitem` leaves so no real-shaped fixture implies structural lists are a supported authoring output.

**Future structural use — multi-block containers.** A `quote`/`callout` that holds *block* children (paragraphs + a nested list inside one callout) is the genuine future need for the `structural` kind, and the only thing that needs the **engine-side half of the 011 §2.6 windowing contract** — `calculateVirtualRange` applied recursively to the container's `children`, offsets composed. Per 011 §2.6 this is a framework capability (structural is a first-class extension point), so the recursive tier is built when an extension first produces a large container, not deferred indefinitely. See §2.11 for the build artifacts.

### 2.11 Virtualization contract — build artifacts (011 §2.6)

011 §2.6 fixes the philosophy: one windowing contract (*report full height, mount your viewport, let the model own offscreen selection*), implemented by whoever can enumerate the internals — the engine for structural `children`, the node for opaque object `data`. These are the concrete things to build against it; none exist yet.

**Rendering is separable from virtualizing.** A structural container can be *rendered* recursively today with **no contract and no API design** — a small change in `EngineBlock` to map a structural node's `children` through the same block dispatch. Block-level virtualization already mounts and unmounts the whole container as one top-level block, which is correct for any *small* subtree (011 §2.6 "a block mounts with its whole subtree"). So the `[list]` placeholder is a **render gap, not a virtualization gap** — replacing it for realistic small lists/callouts costs ~20 lines, not the contract. The artifacts below are needed only when a single container's subtree is large enough that mounting it whole hurts.

**Build order (do not over-build).** Of the four artifacts below, only the **measurement guardrail is "do now"** — it is the trigger detector. The **SPI height seam** and **windowed-list primitive** are built *with the first large object that needs them* (the faithful grid, §2.6/§2.13), and the **recursive structural tier** is built *with the first large multi-block container* (§2.10). None should be built speculatively in a "implement all of Phase 9" pass — there is no consumer yet, so they would be tested against fixtures. This is the over-specification guard the doc owes an implementer.

- **NodeView height/scroll SPI seam (docs/016).** Today the engine measures a block's `offsetHeight` for its window math. A self-virtualizing object's mounted DOM is only its viewport slice, so `offsetHeight` is wrong. The SPI must let a node **declare its full/estimated height** (used instead of `offsetHeight` when the node self-windows) and **opt into nested scroll** when it is taller than the viewport. This is the API surface that lets an object implement its half of the contract; it does not reshape the SPI, it fills an optional slot (docs/016 §6.5).
- **Reusable windowed-list primitive (batteries).** Expose `core/virtual-range.ts` `calculateVirtualRange` (and a thin height-reporting wrapper) as a public utility so an object author windows rows/lines by reuse, not reimplementation. Delegation without batteries is a footgun; a small object ignores it and just renders.
- **Recursive structural windowing tier.** The engine-side half: window a structural container's `children` with the same `calculateVirtualRange`, composing child offsets as `container offset + child-in-container offset`, and descend scroll-to-block/selection into containers (selection already composes via 011 §8.5). Built when an extension first produces a large multi-block container (§2.10).
- **Per-block size measurement guardrail.** Instrument the per-block mounted-DOM-node count (or baked line/row count) in the perf diagnostics (`window.__IDCO_EDITOR_PERF__` neighborhood), so any single block crossing a threshold is a **data trigger** for the two items above instead of a guess. This is what makes 010 §12's "revisit when a listing is large enough to matter" actionable; cheap to add in the height-measure layout effect.

### 2.12 Conformance audit against the 006 contract (not the toy Lexical editor)

Correction to the parity framing: the legacy Lexical editor in `legacy/**` was a throwaway/for-fun surface, never the real product. **The authoritative spec is docs/006** (the editor + publication contract). So "parity" means *the owned engine fulfils the contract*, not *it matches the toy code*. Retiring `legacy/**` (010 §9.1) is then trivial — there is no real feature there to preserve.

But **006 is a *delta* doc**: it was written against the Lexical editor's *existing* capabilities, so it does **not** re-list what Lexical already provided (a full editable `table`, comments, glossary, a selection flyout, a TOC rail, a block drag-handle). Those are still required capabilities — they are just assumed, not written down. So the real required set is **the Lexical baseline + the 006 deltas**, and an audit that reads only 006 undercounts. The baseline gaps found by inventorying `legacy/**` are §2.14.

What we proved was narrow: Phase 8 AC4 = a **curated 6-item checklist** on the model (`tests/editor/engine-parity.test.ts`: lists, marks, tables, links, glossary, comments represent + round-trip), and §2.8 lists gaps found **ad-hoc**. Neither is a systematic walk. The deferred work:

- **Enumerate both layers:** the **Lexical baseline** (`legacy/**` `nodes/`, `plugins/`, `toolbar/` — §2.14) *and* the **006 deltas** (§4 toolbar tabs, §5 heavy objects + data provider, §6 publication/page-layout — §2.13), into one capability inventory.
- **Map each to the owned engine:** present-and-tested / present-untested / gap / deliberately-dropped-with-reason.
- **The result is the conformance checklist** that defines "done" and drives the rest of Phase 9.

### 2.13 006 contract — unbuilt capabilities (named, sized honestly)

A first pass over docs/006 against the shipped blog-first surface. These are **006-contract** items, not blog parity; several are **their own workstreams, not Phase-9 polish**, and are recorded here only so the gap between "blog-first parity (shipped)" and "the 006 product (largely unbuilt)" is explicit.

- **Mermaid object (006 §5.6).** Heavy object: store `source` + baked `svg`, in-place code surface for source, config popover (theme/direction/alignment), a first-class "couldn't render — error near line N" state that keeps the last good diagram, and lazy-loaded/host-supplied `mermaid` (hundreds of KB). The renderer/export only place the baked SVG. *Medium node, fits the existing heavy-object/bake pattern.*
- **Data grid object (006 §5.4/§5.7).** A **separate** node from `table` (`data-grid`, cells `data-cell`). Tier 1: typed columns (text/number/currency/date), per-column format/align, optional total row, header-popover config — most of what a book needs, *medium*. Tier 2: formulas + a recalc engine (dependency graph, ordering, circular-ref detection, `#REF!`/`#DIV/0!` propagation) — *large, scope against real demand*. Reader-interactivity (sort/filter) opt-in per grid; export bakes computed **values**, never formulas. **Virtualization is the node's own**: a large grid windows its rows via the §2.11 windowed-list primitive and declares its full height through the SPI height seam — the same object-side half of the 011 §2.6 contract as the table (§2.6), not a new mechanism. This is the answer to "what do we do for data-object virtualization": nothing engine-side; the data-grid implements its half of the one contract.
- **Shared visual-bake path (006 §5.7/§5.8).** Mermaid diagrams and data-grid charts bake to SVG/image through **one** path — "build that pipeline once." Today bake exists for text/placeholder fields only; the visual-bake path is unbuilt. Couples to the §10.5 sanitization boundary when bakers emit markup.
- **Tabbed toolbar model (006 §4).** Phase 8 shipped a single flat toolbar; 006 specifies task tabs — **Home / Insert / Data / View / Review / AI** — plus a mobile command tray. Home/Insert ≈ shipped; **Data** (the data-grid surface), **View** (publication/layout controls), **Review** (comment/track surface beyond inline marks), and **AI** are unbuilt. *Data/View are medium; AI is its own product.*
- **Publication / page-layout settings (006 §6).** Document-level `publication` settings (page size, orientation, margins, headers/footers, page numbers, running title) with a durable place in the model `settings` that normalization never strips; renderer-parity rules; and **page-break / keep-together as body nodes** (§6.5). *Medium for the settings + preservation.*
- **Output targets + reflow-vs-fixed-layout decision (006 §6.4, open).** Web reader (flow) / reflowable EPUB / fixed-layout PDF. Fixed-layout pagination (running headers/footers, page numbers, widow/orphan) is "effectively its own rendering engine" — *a large, separate workstream*; the editor's only obligation is to **preserve the settings it accepts**, which is the medium part. The reflowable-vs-fixed choice is an unresolved open decision (mirror 010 §12).

### 2.14 Legacy Lexical baseline gaps (006 assumed these; never re-listed)

Found by inventorying `packages/editor/src/legacy/**` against the owned surface. These capabilities the toy Lexical editor *had* and 006 silently assumed; the owned engine lacks or only partially has them. They belong in the conformance checklist (§2.12) alongside the 006 deltas.

- **Editable `table`.** Legacy `nodes/table-node.tsx` + `plugins/table-plugin.tsx` + `table-controls-plugin.tsx` gave a real authored table (cells, headers, row/col ops). The owned `table` is an **opaque object that round-trips but is not edited cell-by-cell**. This is the same item as the faithful `row → cell → block` grid (§2.6 / §2.13) — recorded here too because it is the canonical example of a 006-omitted baseline.
- **Selection flyout** (`plugins/selection-flyout-plugin.tsx`). A floating format toolbar that appears on a text selection. The owned engine has only the top toolbar (`editor-chrome.tsx`); no on-selection flyout. *Medium; reuses the existing format commands + `AnchoredPopover`.*
- **TOC rail** (`plugins/toc-rail-plugin.tsx`). A sidebar table-of-contents navigation. The owned engine builds the TOC *index* (Phase 8 AC1) and has find, but no rail UI that lists headings and scroll-reveals them. *Medium; the index + `scrollToBlock` already exist, this is the rail component.*
- **Block drag-handle / block-controls gutter** (`plugins/draggable-block-plugin.tsx` + `block-controls-plugin.tsx`). A hover gutter handle to drag-reorder blocks. The owned engine has the `move-block`/`MoveNode` **command** (AC9) but no drag-handle **UI**. *Small–medium; the command exists, this is the affordance.*
- **Comment + glossary authoring UI** (`plugins/comment-plugin.tsx`, `toolbar/comment-button.tsx`, `toolbar/glossary-button.tsx`, `nodes/glossary-node.tsx`). Legacy authored comments and glossary terms from the toolbar. The owned engine *models and indexes* comment/glossary marks but has **no authoring entry** in `editor-chrome.tsx` and **no compat export** (§2.0). So they are read/indexed but not creatable or round-trippable end to end.
- **Verify-not-assume (lower confidence, audit during §2.12):** gap-cursor affordance, heading-anchor slugs, slash menu coverage, TOC body node + post-ref node render — each has *some* owned counterpart (gap selection type, heading-anchor model, insert menu, toc/post-ref bakers); the audit confirms whether each is parity or partial rather than assuming.

## 3. Verification

Each item ships with the proof shape docs/010 §13 already names: typing-loop items against the IME fuzz + UAX#29 suites; accessibility against axe-core; paging and drag as real-browser Playwright specs; table editing against the object lifecycle ACs (010 Phase 6). No item changes the compatibility projection or the model authority.
