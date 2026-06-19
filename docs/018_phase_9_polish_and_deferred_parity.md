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
- **Faithful `table` grid editing.** Tables import as an opaque object that round-trips but is not edited cell-by-cell. A faithful `row → cell → block` grid with a `NodeView.renderLive` is the largest future node (011 §2.4) and is books, not blog.

### 2.7 Cross-browser known-failures

- **Firefox cross-block drag-select** is a real Firefox-only engine/drag bug (not a platform limit), `test.fixme`'d in `engine-caret.spec.ts` — root-cause and fix (§11).
- The Firefox **synthetic-`ClipboardEvent`** cut/paste `test.fixme` is a genuine harness limit (real Ctrl+X/V works); leave it.

## 3. Verification

Each item ships with the proof shape docs/010 §13 already names: typing-loop items against the IME fuzz + UAX#29 suites; accessibility against axe-core; paging and drag as real-browser Playwright specs; table editing against the object lifecycle ACs (010 Phase 6). No item changes the compatibility projection or the model authority.
