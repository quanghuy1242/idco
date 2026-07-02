# Editor backlog — forward roadmap

## What this is

Seven tracks that came out of a design discussion, each grounded against the current tree, each with its purpose (why we need it) and its decision. This file is the forward roadmap. `note.md` stays the record of closed parity work and consumer feedback; new feature direction lands here.

Three rules cut across every item: each feature round-trips editor↔reader (the snapshot-parity oracle, `[[reader-convergence-028]]`); none pulls product or runtime deps into `packages/editor` or `packages/ui` (the shared-package boundary); and the native `EditorDocumentSnapshot` (`core/model/model.ts:305`) is the single source of truth, with markdown and every export a projection of it.

Two tracks grew their own implementation-grade docs: #6 (diff, inline review, and suggested edits) is `docs/036_snapshot_diff_and_document_history_review.md` — with the **woven inline diff overlay** design system split into `docs/038_woven-overlay-design.md` — and #7 (the agentic control API) is `docs/037_agentic_control_api.md`. The three reference each other and stay separate: `037` produces proposals, `036`/`038` review them. The rest are small-to-medium.

| # | Track | Status | Size |
| --- | --- | --- | --- |
| 1 | Reflowable EPUB3 + PDF export | decided (reflowable-only); ready to scope | medium (packaging) |
| 2 | Lossless document format + per-node markdown syntax SPI | designed; ready to build (TS-only) | small–medium |
| 3 | Virtualization: object-render lag + selection scroll-desync | done (2026-07-02, note.md §7) | small–medium |
| 4 | Columns container (discrete, per-column selection) | decided; ready to scope | small–medium |
| 5 | Math: block node, then inline atom | block ready; inline is a model extension | small (block) + medium (inline) |
| 6 | Snapshot diff + inline review + suggested edits | R6-A..I shipped; woven overlay = R6-J phase, designed in `docs/038` | large |
| 7 | Agentic control API | design doc `docs/037` | medium–large |

## 1. Reflowable EPUB3 + PDF export

**Purpose.** This is a book and document platform; authors and readers need documents *out* in the formats books actually ship in — EPUB3 for e-readers, PDF for print and sharing. Without an export path the editor is a silo. Reflowable is the correct target for text-centric books: the reading device owns pagination and type size, which is an accessibility and portability win, not a compromise.

**Decision: reflowable-only. No fixed-layout engine.** Fixed-layout (authored page breaks, running headers bound to page N, widow/orphan control) is for products where the page is the artwork — picture books, comics, art-directed spreads. It is a rendering engine of its own and this platform does not need it.

"No fixed-layout engine" does not mean "no export." Two deliverables sit on the reader we already have:

**EPUB3 reflowable is a packaging job, not a renderer.** The reader emits semantic, static, RSC-safe XHTML today: `renderRestingDocument` (`packages/reader/src/reader/render.tsx`) produces `<h1 id>`, `<p>`, `<blockquote>`, `<ul>/<ol>/<li>`, `<table><th colspan rowspan>`, `<figure><img><figcaption>`, `<aside role="note">`, and the full mark set. `collectHeadings`/`projectToc`/`tocEntries` already build the hierarchical navigation. Islands are opt-in, so omitting `renderIsland` gives fully static output. What EPUB adds is the OCF zip: `container.xml`, `content.opf` (manifest + spine + metadata), `nav.xhtml` (from `tocEntries`), media resolution (rewrite CDN `src` to embedded files), embed fallback (iframe → link), and lifting the `.rt-*` typography CSS into an EPUB stylesheet.

**PDF is a paged print stylesheet over the same render.** Drive `@page` size/margins and `break-inside: avoid`, then let the print engine paginate. Paged reflow with no page model in our code. The typeset-PDF-with-authored-breaks tier is the fixed-layout engine; skip it.

**This shrinks the "page settings" work and re-targets it.** For reflowable output, A4/orientation/margins degrade to hints; the load-bearing data is publication metadata: title, author, language, identifier, cover, reading order, TOC. So the typed `settings.publication` schema to write is metadata-first, much smaller than `docs/006 §6.2`'s geometry-first sketch. The `settings` slot exists and round-trips today as an opaque bag (`model.ts:290`); give it this typed, additive shape and never strip it.

Size: EPUB3 exporter is medium (packaging + media), high leverage. PDF is small. Fixed-layout is large, don't build. Folds a decision into `docs/006 §6` (reflowable, not the deferred fork) and gives `note.md §4.5` a concrete metadata schema.

## 2. Lossless document format + per-node markdown syntax SPI

**Purpose.** Authors need to save and round-trip a document without silent data loss, and to move documents between idco and plain-markdown tools without corruption. Today markdown export is lossy by design — it drops underline/sub/sup/comment/glossary marks, object live data, tables, node/mark attrs, and the character-id identity substrate. Authors who "export to markdown and reopen" quietly lose content. The per-node markdown SPI is the second half: it lets each custom node ship its own portable syntax, so the format grows in lockstep with the node SPI instead of forcing a central-file edit for every new block.

This is document-format work that ships in `packages/editor` in TypeScript. It stands on its own; no native runtime and no Rust are involved.

**Why markdown export is lossy: it is a projection, not a serialization.** The owned model is richer than CommonMark+GFM. `MARKDOWN_LOSSY_MARK_KINDS` (`view/markdown/transformers.ts:75`) drops underline, subscript, superscript, comment, glossary; objects export baked fields only; tables, node/mark `attrs`, document settings, collections, and the character-id substrate have no markdown representation. True losslessness comes from carrying the snapshot, not from extending markdown syntax. The lossless in-app format already exists: the `EditorDocumentSnapshot`, used for copy/paste (`view/markdown/native-clipboard.ts`).

**Two file shapes.** (1) Snapshot-as-native-file: the save file is the `EditorDocumentSnapshot` (JSON), provably lossless, with lossy markdown kept as a share-export. (2) Markdown + embedded snapshot: a human-readable markdown body plus a trailing fenced block (`<!-- idco:snapshot v=1 … -->`) carrying what the projection dropped; plain readers ignore it, idco reopens losslessly. MVP embeds the full snapshot; a delta variant is a later optimization. Round-trip contract, pinned both directions by tests, with `snapshot → markdown` (block stripped) unchanged from today's lossy export.

**Whitespace: preserve semantic, normalize cosmetic — the code already does this.** Export normalizes blank lines to a single separator but preserves hard breaks (`  \n`) and code-block internals verbatim; `markdown-it` source positions (`.map`) are captured but unused (`view/markdown/from-markdown.ts`). That is the correct rule: the model is truth, so cosmetic source whitespace carries no meaning and would pollute the model if retained. No code change; write the rule down.

**Per-node markdown syntax SPI — the real gap.** Today `:::tone`/`:::toc` are hardcoded across three view files (adding one is a four-place edit), and neither `NodeDefinition` (`object-registry.ts:72`) nor `StructuralDefinition` (`structural-registry.ts:133`) carries a markdown hook; export dispatches on `baked.kind`, never a per-node serializer. `docs/030 §5.2` anticipated per-node transformers but did not build them. The node SPI already lets a node own its data, bake, plain text, and compat shape; it should own its markdown grammar too. Adopt a general `:::name{key=val}` directive grammar (the CommonMark generic-directives convention) and add a `toMarkdown/fromMarkdown` seam to the node definition (or a view-side registry keyed by type), so callout emits `:::note`, math emits `$$…$$`, a custom embed emits `:::embed{…}`, each declared by its node.

**These compose but do not substitute.** Custom directives widen the human-readable representable set; the embedded snapshot makes the format lossless. Overlapping marks, the character-id substrate, and live object data still need the snapshot. Directives make the projection richer; the snapshot is the lossless backstop.

Size: small–medium, two independent tracks (the format shapes; the markdown-syntax SPI). Extends `note.md §4.4`.

## 3. Virtualization: object-render lag + selection scroll-desync

**Purpose.** These are live UX defects on the *default* (virtualized) path — not features. Object nodes pop in late during fast scroll, causing visible layout jumps, and the painted caret/selection drifts out of sync with the text while scrolling. They degrade the core typing and reading experience for exactly the large documents virtualization exists to serve, so they undercut the editor's baseline feel for its most demanding use case. Ready to do, not large.

**Done (2026-07-02) — the closed record is `note.md §7`.** Both fixes shipped: object nodes now declare an intrinsic-height signal through a new `NodeDefinition.estimateMetrics` seam (so an async reference block seeds at the right height instead of a coarse bucket mean and popping in late — this also recovered code blocks, whose piece-table source the string heuristic had missed), and the selection overlay measures its geometry in a post-commit layout effect (so the painted caret/selection stays glued to the content on a virtualized scroll frame instead of trailing by one commit). `pnpm check` green. The original findings below stand as the problem statement.

Two distinct async races under `virtualize={true}`, separate from the closed B3 focus bug (`note.md §5.3`).

**Object nodes pop in late / layout drift on fast scroll.** Measurement is asynchronous: a block mounts, `ResizeObserver` fires after layout, coalesced through `requestFrame` into a `setMeasureVersion` bump (`view/controllers/use-virtual-window.ts:305-346`) — a 1–2 frame lag between "rendered" and "offset model knows the height." Worse for object nodes: offscreen blocks get an estimator seed (`core/offset-model/block-estimator.ts`), and an object whose data resolves async (embed, post-ref) falls to a default height, so the real height lands after the user has scrolled past. Fix: give object nodes an intrinsic height signal (media aspect ratio, code line count); keep a persistent measured-height cache keyed by NodeId so a measured block never re-seeds on re-entry; freeze or widen last-known heights during a fling.

**Painted selection lags the scroll.** The selection overlay reads `getBoundingClientRect()` in its render phase and re-renders on a selection frame version, not on scroll (`view/overlays/selection-overlay.tsx:76-180`). Since scrolling does not change the selection model, the rects are computed viewport-relative against a `root` rect that shifts during scroll, so they trail by a frame and flicker. Fix (the architectural one): paint selection in content space, not viewport space, so rects translate with the content for free and recompute only on selection or layout change. Short of that: subscribe the overlay to `scrollTop` and recompute in the same `requestFrame` that commits the virtual window.

Size: small–medium.

## 4. Columns container (discrete, per-column selection)

**Purpose.** Authors coming from Word and Confluence expect side-by-side column layouts for editorial structure — comparisons, paired callouts, magazine-style sections. It is a concrete, common authoring need the block model cannot express today (the only containers are callout and the fixed 3-tier table). This is the editing affordance, not publication pagination.

**Decision: discrete columns, Confluence-style, with text selection scoped per column (like table cells).** A `columns` structural container holds N `column` children, each an independent block flow; content never flows between columns; columns stack on narrow width. Not Word's newspaper flow (continuous text balancing across columns), which is a pagination-adjacent problem in the class we are avoiding.

**The container and caret-crossing are nearly free.** Register `columnsStructuralDefinition()` exactly like callout (`createSubtree` seeds N columns + a paragraph each) plus `columnsStructuralView`/`columnStructuralView` (wrap engine-pre-rendered children in a grid); core is untouched (`structural-registry.ts:186-216` is the callout precedent). Caret movement across containers is already generic: `selectionForNavigation` + `positionAfterBlock` + the recursive `firstPositionIn`/`lastPositionIn` descend into and escape out of any structural scope, and `stepGap` handles the gap cursor at container edges (`view/overlays/navigation.ts`). Arrow keys between columns, vertical navigation into the adjacent column, and gap-cursor insertion all work without new code.

**Net-new is small.** An `enclosingColumn` helper (a direct analog of table's `enclosingCell`, `core/table/operations.ts:668`) for Tab-between-columns, plus grid CSS. Cross-column text selection stays forbidden by the existing cross-scope shift-extend guard (`navigation.ts:394`), matching tables — the decision that keeps this bounded rather than a table-scale selection rewrite.

Size: small–medium. Structural-node SPI lineage (`docs/021`).

## 5. Math: block node first, inline atom second

**Purpose.** Technical, academic, and educational documents need mathematical notation; without it the editor cannot serve those authors at all. Block/display math is the common case (an equation on its own line) and is cheap; inline math (a formula mid-sentence) is rarer and costs a model extension. Both are in scope; they ship in two phases.

**Phase 1 — block/display math. Small, no SPI change.** A new object node exactly like `code-block`: `normalizeData` validates the LaTeX string, `bake` renders KaTeX to MathML/HTML (`BakedSnapshot`, pure and DOM-free so it runs in the bake worker), `plainText` returns the LaTeX/alt for search and export. The `simpleObjectDefinition(type, normalize, bake, plainText)` helper is the template (`object-registry.ts`). The reader already renders baked object HTML, so reader parity is nearly free, and markdown export gets `$$…$$` once the item-2 per-node markdown seam lands. One `NodeDefinition` + one `NodeView`.

**Phase 2 — inline math. A real model extension.** There is no inline-atom node kind — the model is only text/structural/object, and marks are ranges on text, not embeddable atoms (`core/model/model.ts`). Inline `$x^2$` needs a new inline primitive touching the coordinate system, selection, and mutation algebra (`docs/011`). Materially bigger than block math; schedule it as its own model-DSA slice. Fetch the KaTeX API through context7 when building either phase.

Size: block small; inline medium. Node SPI lineage (`docs/016`); inline touches the DSA foundation (`docs/011`).

## 6. Snapshot diff + inline review + suggested edits — `docs/036`

**Purpose.** Two needs, one engine. Authors and editors need to see what changed between two versions of a document (history review). The bigger driver: they need to review changes proposed by an AI or another human and accept or reject them part by part, so those changes never silently overwrite their work. That accept-before-apply gate is the trust mechanism that makes agentic editing (#7) and eventual collaboration safe — an agent or a colleague proposes, the author stays in control. Building it now is also the low-risk on-ramp to real-time collaboration, because it exercises the same attributed-op-log and (later) tombstone machinery in a single-user-authoritative context.

The full implementation-grade plan is `docs/036`. Headlines:

- **Identity diff, not text diff.** Text leaves are one string + run-encoded character ids (the durable coordinate for marks and points), and every node has a stable NodeId. For two versions of the same document you match nodes by NodeId and characters by CharacterId, so insert/delete/move/edit come out clean instead of as delete-plus-insert noise. A framework-free core `diffSnapshots(base, target): SnapshotDiff` (`core/diff/**`).
- **Two display surfaces on the reader L1.** A dedicated **diff view** (two saved versions, unified or side-by-side; shipped R6-F..H) and a live **woven inline overlay** (changes rendered in place over the editor; the change indicator shipped in R6-I, the full woven surface is the single R6-J phase, designed in `docs/038`, starting at its ghost-render spike J0). Both reuse the reader's pure per-node render, inheriting editor↔reader parity.
- **Suggested edits (Model A, ship now).** A proposal is an attributed **op-log branch** (`{ id, author, baseVersion, ops, status, threadId }`), stored host-side through a new `SuggestionSource` SPI (sibling of `CommentSource`). The inline overlay is the derived diff; **accept applies the ops, reject drops them**, at whole-proposal or per-block granularity (per-run is deferred). Attribution is nearly free (`origin` + `CharacterId.client`). The discussion, dock pane, and accept/reject affordance reuse the comment system and the overlay authority; the change content is ops, the conversation is a comment thread — kept separate. The full woven-overlay design system that renders and resolves this (single-proposal review, the `ReviewModel`/`GhostBlock` ghost pipeline, the passive-marker + review-cursor split, caret-intent reclaim, saves blocked in review mode, and a separate arbiter-exempt in-review undo segment) is `docs/038`.
- **Model B (concurrent tombstones) reserved.** Inline suggestions with tombstoned deletions for many concurrent authors is the collaboration-era upgrade; it shares Model A's review wrapper and ops, and its net-new (tombstones + convergence) is the CRDT work collaboration needs anyway (`docs/014 §7`). Model A stored as op-logs is what keeps A→B a reuse, not a rewrite.

Size: large. R6-A..I have shipped; the woven overlay + Model-A suggested edits are the single **R6-J phase** (steps J0–J8, ghost-render spike first), design-complete in `docs/038`. The producer of proposals is `docs/037`; `036`/`038` are where they land and are reviewed.

## 7. Agentic control API — `docs/037`

**Purpose.** AI features inside the editor, and external agents outside it, need to read and manipulate the document *semantically* — not by guessing pixel coordinates and clicking, which is brittle, layout-coupled, and unsafe. Concretely: if an admin has the editor open at admin.content.com, an assistant should be able to "find the heading titled X and rewrite the paragraph after it" by driving the model, not by screen-scraping and synthesizing pointer events. A stable command+query surface plus transports gives an AI action, a host script, or an external agent a precise way in; propose-by-default makes it safe.

The full plan is `docs/037`. Headlines:

- **The write surface already exists; the read surface is the gap.** `OwnedEditorHandle` (framework-free, DOM-free) drives the model with the `EditorCommand` union. Reads are caret-local only — there is no "find the heading titled X, read node N's text, resolve the range matching this text." Net-new: a `core/query/**` layer (find/read/resolve) that reuses the derived document index. The DOM is output, not input; an agent writes to the same command layer the human's keystrokes reach.
- **One serializable surface, a transport ladder.** `EditorCommand` and the snapshot are already JSON. Expose the command+query surface over adapters, in order of reach: an in-page control channel (`window.__IDCO_EDITOR__` + instance registry, semantic — no pixels), a `postMessage` bridge (origin-allowlisted, for embedded editors), a CDP `evaluate` path (drive the browser by command, not by click), and a session-keyed WebSocket/MCP relay (an external assistant attaches to a live session).
- **Capabilities and propose-by-default.** A control handle is scoped to **read**, **propose**, or **commit**. An external or AI-driven change **proposes by default** — it routes into `docs/036`'s suggested-edits system as an attributed inline suggestion the human accepts or rejects. Silent commit is a trusted, opt-in capability. This is where `037` meets `036`: the agentic API doesn't need a "suggest mode," it needs a write *target*.
- **The AI tab, vendor-neutral.** The registered-but-empty `"ai"` tab hosts actions from a host-injected provider SPI (no hardcoded vendor/endpoint/auth); the "propose review change" output produces a `docs/036` proposal. In-editor AI and external agents are the same surface from inside and outside.

The one case out of scope: editing with no browser open (headless, server-side) needs the authoritative core running server-side (`docs/031`), a future transport.

Size: medium–large. Command-surface and consumer-contract lineage (`docs/024`, `docs/033`).
