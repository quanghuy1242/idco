# 010 - Owned-Model Virtualized Editor (Central Input Engine)

> Status: design direction (pre-implementation)
>
> Date: 2026-06-16
>
> Scope:
>
> - `packages/editor/src/RichTextEditor.tsx` — current whole-document Lexical surface (standard mode, retained).
> - `packages/editor/src/RichTextEditorComposer.tsx` — extracted composer; current `DecoratorVirtualizationContext` host.
> - `packages/editor/src/nodes/decorator-virtualization.tsx` — Phase 0 decorator-body virtualization (retained, polished).
> - `packages/editor/src/large-document/**` — the section-shell virtualization (retired by this plan; pure helpers salvaged).
> - `packages/editor/src/model/schema.ts` — existing `RichTextEditorDocument` shape (the compatibility output contract).
> - `packages/content-renderer/src/index.tsx` — read-side renderer; becomes the view layer of the new engine.
> - `packages/lib/src/rich-text.ts` — pure rich-text/TOC helpers shared by editor and renderer.
> - future `packages/editor/src/owned-model/**` — the new editor runtime.
>
> Source docs:
>
> - `docs/001_lexical_editor_architecture.md` — editor package architecture and book-authoring target.
> - `docs/006_editor_toolbar_redesign_plan.md` — heavy-object pattern, three render tiers, the bake pipeline, data-grid/mermaid, reflow-vs-fixed-layout.
> - `docs/008_editor_performance_contract.md` — update-listener lane/budget contract for the editing hot path.
> - `docs/009_large_document_virtualized_editor_plan.md` — virtualization research, the retired section shell, and Phase 0 decorator virtualization.
>
> External references:
>
> - EditContext API — https://developer.mozilla.org/en-US/docs/Web/API/EditContext_API
> - Chrome EditContext introduction — https://developer.chrome.com/blog/introducing-editcontext-api
> - EditContext browser support — https://caniuse.com/mdn-api_editcontext
> - `@neftaly/editcontext-polyfill` — upstream hidden-textarea EditContext compatibility package (Firefox 125+, Safari 15.4+).
> - CodeMirror 6 viewport rendering — https://codemirror.net/docs/ref/
> - Lexical large-document position — https://github.com/facebook/lexical/issues/7422
> - MDN EditContext HTML-editor demo (model/view split, tokenized render, Range-based bounds) — https://mdn.github.io/dom-examples/edit-context/html-editor/ (source: `mdn/dom-examples` `edit-context/html-editor/editor.js`)
>
> Assumptions:
>
> - The official engine model is an app-owned `OwnedDocument`, not Lexical state and not the loose `RichTextEditorDocument` tree. The runtime may serialize to JSON for storage, but JSON is a wire format, not the model authority.
> - `RichTextEditorDocument` remains a mandatory compatibility projection while the standard editor, `@idco/content-renderer`, and downstream consumers still read it. The projection must preserve baked fields and remain rollback-compatible until a deliberate persistence migration exists.
> - `@idco/content-renderer` already understands the compatibility JSON and is the correct initial base for the engine's view layer; it can later learn to consume `OwnedDocument` directly without changing the editor runtime.
> - docs/006's heavy-object / bake model is accepted product direction and is the foundation this engine builds on, not a competing idea.
> - The standard whole-document Lexical editor (`RichTextEditor`) and Phase 0 decorator virtualization remain shipped and supported for small/static documents during and after this work.
> - Real-time collaboration is explicitly out of scope; the architecture must merely not foreclose it.
> - Backlog and per-ticket implementation breakdown are intentionally omitted from this document; this is the philosophy, the proposal, and the decisions.

## Table Of Contents

- [1. Purpose](#1-purpose)
- [2. The Product Thesis](#2-the-product-thesis)
  - [2.1 Two Book Models](#21-two-book-models)
  - [2.2 Why Mainstream Editors Break And We Intend Not To](#22-why-mainstream-editors-break-and-we-intend-not-to)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 What Is Built](#31-what-is-built)
  - [3.2 What The Real Data Says](#32-what-the-real-data-says)
  - [3.3 The Section Shell Is Retired](#33-the-section-shell-is-retired)
- [4. The Core Problem](#4-the-core-problem)
  - [4.1 contenteditable Owns The DOM, So It Cannot Virtualize](#41-contenteditable-owns-the-dom-so-it-cannot-virtualize)
  - [4.2 The Input Layer Moves The Source Of Truth Off The DOM](#42-the-input-layer-moves-the-source-of-truth-off-the-dom)
  - [4.3 The Bake Model Makes Rest Cheap By Design](#43-the-bake-model-makes-rest-cheap-by-design)
  - [4.4 What The Engine Actually Has To Solve](#44-what-the-engine-actually-has-to-solve)
- [5. Target Model](#5-target-model)
  - [5.1 Four Layers](#51-four-layers)
  - [5.2 The Text Layer](#52-the-text-layer)
  - [5.3 The Object Layer](#53-the-object-layer)
  - [5.4 The Compatibility Output Contract](#54-the-compatibility-output-contract)
  - [5.5 Input Substrate: One Central Engine, Multiple Backends](#55-input-substrate-one-central-engine-multiple-backends)
  - [5.6 Virtualization Model](#56-virtualization-model)
  - [5.7 Selection And Focus Model](#57-selection-and-focus-model)
  - [5.8 Desktop / Mobile Parity Through Per-Platform Input](#58-desktop--mobile-parity-through-per-platform-input)
  - [5.9 Render-Tier Mapping](#59-render-tier-mapping)
- [6. Architecture Decisions](#6-architecture-decisions)
  - [6.1 Own The Model Instead Of Fighting contenteditable](#61-own-the-model-instead-of-fighting-contenteditable)
  - [6.2 Reuse The View And Semantics, Not Lexical's Engine](#62-reuse-the-view-and-semantics-not-lexicals-engine)
  - [6.3 Let The Browser Lay Out And Hit-Test Text](#63-let-the-browser-lay-out-and-hit-test-text)
  - [6.4 One Live-Edit Object At A Time, Behind A Slot](#64-one-live-edit-object-at-a-time-behind-a-slot)
  - [6.5 Block-Atomic Selection Across Objects](#65-block-atomic-selection-across-objects)
  - [6.6 Mobile Parity, Native Input On The Active Block](#66-mobile-parity-native-input-on-the-active-block)
  - [6.7 Own The Input Substrate](#67-own-the-input-substrate)
  - [6.8 Rejected And Deferred Options](#68-rejected-and-deferred-options)
- [7. Engine Internals](#7-engine-internals)
  - [7.1 Stack: Framework-Agnostic Core, React View](#71-stack-framework-agnostic-core-react-view)
  - [7.2 Document Model And Mutations](#72-document-model-and-mutations)
  - [7.3 Scheduler And Frame Loop](#73-scheduler-and-frame-loop)
  - [7.4 Selection And Caret Overlay](#74-selection-and-caret-overlay)
  - [7.5 Web Worker Boundary](#75-web-worker-boundary)
- [8. Philosophy And Principles](#8-philosophy-and-principles)
- [9. Relationship To Existing Work](#9-relationship-to-existing-work)
- [10. Phasing And Rollout](#10-phasing-and-rollout)
  - [10.1 Global Invariants](#101-global-invariants-checked-at-every-phase-gate)
  - [10.2 Loop Discipline](#102-loop-discipline-anti-drift-protocol)
  - [10.3 Phase Status Ledger](#103-phase-status-ledger-update-on-completion)
  - [10.4 Phases](#104-phases)
  - [10.5 Capabilities A Real Editor Still Needs](#105-capabilities-a-real-editor-still-needs-slot-into-the-phases)
- [11. Risks, Edge Cases, And Failure Modes](#11-risks-edge-cases-and-failure-modes)
- [12. Open Decisions](#12-open-decisions)
- [13. Verification Philosophy](#13-verification-philosophy)
- [14. Completion Criteria](#14-completion-criteria)
- [15. Final Model](#15-final-model)

## 1. Purpose

Define the editor runtime IDCO needs to become a **live technical book platform**, and record the architecture decisions made while reasoning toward it. The conclusion is that the long-term editing surface should not be a `contenteditable` rich-text engine. It should be an **owned-model, virtualized editor** built around a central input engine — native EditContext where it behaves, a hidden-textarea backend where that is more reliable — where the document model, not the DOM, is the source of truth.

This document is the philosophy and the decision record. It deliberately omits a backlog and per-ticket implementation breakdown; those will be split out once this direction is accepted. The goal here is that a different engineer can read this and understand _what_ we are building, _why_ `contenteditable` cannot get us there, and _which trades we have already settled_.

## 2. The Product Thesis

### 2.1 Two Book Models

IDCO targets two distinct artifacts, and they are not "big and small" versions of one thing:

- **Static book.** Imported EPUB/PDF down the line. Finished, read-dominant, machine-sharded at import. There is "no fancy" here; the heaviness has been designed out by the importer.
- **Live book.** Native authoring, and the real target. The defining move is that the author brings their **actual working context into the page** — their GraphQL schema, their data tables, parts of their toolchain — as first-class blocks, not screenshots. The document becomes a place where tooling _lives_.

Both models flow through **one** authoring surface (decision §6, confirmed). The static book is that surface in a read-dominant configuration; the live book is the same surface with the full object and editing capability set.

The static book is the _floor_ of difficulty. Sizing the engine against imported static content is a category error: it is the model with the weight removed. The live book is heavier **by design**, because density of integrated tooling is the product, not an accident.

### 2.2 Why Mainstream Editors Break And We Intend Not To

Mainstream wiki-style editors (the large enterprise document/collaboration tools, typically built on `contenteditable` engines such as ProseMirror) collapse on exactly the workload IDCO is aiming at: a long document dense with interactive, integrated objects. This is not a tuning problem; it is the consequence of an architectural bet. These editors keep their embedded widgets/macros **live at rest** inside one `contenteditable` surface, so a document full of them is a document full of always-mounted, always-interactive subtrees that the browser must keep in the editable DOM.

IDCO's differentiation is to be good at the precise thing that foundation is worst at. That has a hard implication: **we cannot inherit that foundation and expect a different outcome.** A `contenteditable` rich editor (ProseMirror, Lexical, Slate, TipTap) buys IME, accessibility, selection, and native find "for free" by making the DOM the document — and the price of that free lunch is that the whole document must stay in the DOM, which is definitionally incompatible with virtualization. The mainstream made that trade correctly for _their_ market (comments, chat, short docs); it is the wrong trade for a book platform.

## 3. Current-State Findings

### 3.1 What Is Built

- **Standard editor.** `RichTextEditor.tsx` mounts one `LexicalComposer` for the whole document, with the full plugin/toolbar stack and a debounced controlled `onChange`. This is the correct, shipped path for small and static documents and is retained.
- **Phase 0 decorator virtualization.** `nodes/decorator-virtualization.tsx` keeps the single Lexical root but renders a decorator block's React body only near the viewport; offscreen bodies collapse to a measured, height-reserved placeholder. It uses one shared `IntersectionObserver`, a height cache keyed by node id + content signature, and publishes `window.__IDCO_DECORATOR_VIRT__`. It is toggled by the `decoratorVirtualization` prop via `DecoratorVirtualizationContext` in `RichTextEditorComposer.tsx`. It is self-contained and has **no dependency on the section shell**.
- **The bake model (docs/006).** Heavy objects (code block, media, table, mermaid, data grid) already have a committed interaction shape: resting state shows a **baked static, publish-ready** representation; editing happens **in place**; configuration lives in a chrome popover. Every heavy object must produce a baked static snapshot because the export tier runs no heavy libraries. This is load-bearing for everything below.
- **content-renderer.** `packages/content-renderer/src/index.tsx` already walks the compatibility JSON and renders every node read-side. It is product-neutral and contract-aligned.

### 3.2 What The Real Data Says

A real imported technical book (`payloadcms.db`, 127 chapter documents) measured:

- **Median chapter:** 13 top-level blocks, ~5 KB. Most "chapters" are tiny EPUB fragments.
- **Heaviest authored chapters:** ~260–320 top-level blocks, ~840–1,190 total nodes, and critically **40–55 live `Code` blocks each**. The villain is not paragraph count; it is **code-block density** — dozens of live code editors per chapter.
- The largest single documents (600–800 blocks) are generated EPUB **index/TOC artifacts**, not authored editing targets, and should be discounted.

Interpretation: this static-import data is comfortably inside Phase 0 + standard Lexical territory, with headroom. It does **not** force the engine. The engine is justified by the **live-book target**, which is denser and which authors will push harder than any importer does. The data lowered the urgency; it did not change the destination.

### 3.3 The Section Shell Is Retired

`packages/editor/src/large-document/**` implemented the docs/009 section shell: offscreen → placeholder, visible-inactive → `content-renderer`, active → a **separate** Lexical root swapped in on click, with `setTimeout`-based scroll correction. It is retired by this plan. Its quirks — read↔edit DOM swap and layout drift, click-to-edit, one-section-at-a-time, multiple editor instances — are exactly what this engine is designed to avoid. docs/009 itself flagged this as the risky UX bet and named "ship Phase 0 and stop there" as the honest fallback.

The **pure helpers are salvaged**, not deleted wholesale: `signatures.ts`, `height-cache.ts`, sectionization/ID utilities, and `virtual-range.ts` feed the new engine's virtualizer and bake-signature caches. Nothing about the model layer is thrown away; the editor _runtime_ is.

## 4. The Core Problem

### 4.1 contenteditable Owns The DOM, So It Cannot Virtualize

In a `contenteditable` editor the DOM _is_ the document. The browser's caret and `Selection` live inside DOM nodes. The moment you unmount an offscreen block, you destroy the nodes that selection points into: a selection spanning that region corrupts, "select all" sees only mounted DOM, Backspace at a boundary deletes the wrong node, IME composition lands in the wrong place. Virtualizing an editable `contenteditable` means mutating the very tree the browser believes is the document, on every scroll, while keeping a live selection across gaps of nodes that no longer exist.

This is why **no mainstream `contenteditable` editor virtualizes a live editing surface.** It is not an oversight; `contenteditable`, editing, and virtualization are at war over who owns selection. (Read-only virtualization with `contenteditable=false` offscreen is fine — but that is reading, not editing.)

### 4.2 The Input Layer Moves The Source Of Truth Off The DOM

The input layer keeps its own text buffer and selection offsets, decoupled from the DOM. Native EditContext is one browser-provided way to do that; the hidden-textarea bridge is the proven editor way to do the same thing on platforms where native EditContext is absent or unreliable. Input events arrive as offsets into **our model**, not DOM positions. Which blocks are painted becomes a pure rendering decision, because the input pipeline talks to the model, not the DOM. Selection is model-based by construction. Virtualization stops being a fight and becomes "render the visible slice."

This is precisely the CodeMirror 6 / Monaco architecture — a hidden input surface plus a model-owned selection — with native EditContext treated as an optional platform backend rather than the whole design. It is not a novel research bet; it is the proven approach to virtualized editing, adapted to IDCO's rich-document model.

Browser support (June 2026): native EditContext exists in Chrome/Edge/Opera 121+ (~69% global). Not in Firefox or Safari, with no committed timeline, and the native path still has behavior gaps a real editor must verify. The engine therefore standardizes on **one central input substrate** (§5.5, §6.7) instead of maintaining "native" and "polyfill" as separate editor implementations.

**Decision (June 2026): keep native EditContext, but demote it.** The hidden-textarea backend is the **baseline** that must be fully correct on its own on every browser; native EditContext is an **opt-in optimization on Chromium**, kept _only_ because it hands ~69% of users vendor-grade OS IME (composition, candidate-window placement) and accessibility for free — not because the engine depends on it. Remove native tomorrow and the editor stays correct everywhere; it simply paints and handles more itself. We considered going textarea-everywhere (the pure Monaco/CodeMirror model) and rejected it for exactly that 69%: declining native would hand our IME engine to Chromium users who would otherwise get the browser's, and IME is the costliest surface to own (§11).

### 4.3 The Bake Model Makes Rest Cheap By Design

docs/006's bake pipeline is the second half of the answer, and it is what separates IDCO from those incumbent editors. Every heavy object's **resting state is a baked static snapshot** — mandatory, because the export tier runs no heavy libraries. So a document with hundreds of heavy objects is **cheap at rest**: each resting object is effectively an image/static table, not a live subtree.

Two consequences:

- The inactive-render path does not "drift" from the edit path the way the section shell did. The baked snapshot is the canonical publish artifact every node must produce anyway, not a parallel renderer that approximates the editor.
- The engine does **not** need to isolate many simultaneously-live interactive surfaces. At rest they are baked. Only the **one** object being edited is live (§6.4). This shrinks the hardest part of the problem from "host N live sub-applications in one editable doc" to "host one live surface well, over a virtualized field of baked blocks."

### 4.4 What The Engine Actually Has To Solve

With bake handling resting cost and one-active-object handling interaction isolation, the engine's residual, honest job is sharp and bounded:

1. **Virtualize text at book scale.** Plain paragraphs/headings/lists are still DOM nodes that `contenteditable` cannot virtualize. Owning the model removes that ceiling.
2. **Own caret, focus, and selection** across a virtualized field, including block-atomic selection spanning baked objects and clean focus hand-off when one object goes live.
3. **Route input per platform** so desktop and mobile reach editing parity (§5.8).

It explicitly does **not** have to build a text-layout engine; the browser still lays out and hit-tests text (§6.3).

## 5. Target Model

### 5.1 Four Layers

```text
Owned-Model Editor
├── App document      (OwnedDocument · settings · registered block/object definitions)
│     body order + block map · document settings · no arbitrary unknown blocks
├── Text layer        (virtualized render · per-platform input · model-owned selection)
│     paragraphs, headings, lists, inline marks — the connective tissue, always live
├── Object layer      (heavy objects, atomic in the text flow)
│     baked static at rest · one live-edit at a time behind a slot · docs/006 bake pipeline
└── Compatibility output
      RichTextEditorDocument adapter + baked fields for content-renderer/rollback
```

### 5.2 The Text Layer

The text flow is **always live**: the caret moves freely through paragraphs, headings, and list items, and selection is continuous within text. This is the base owned-model surface and the thing EditContext is genuinely for (text input, IME, composition, selection).

The model is the app-owned document store described in §7.2. It is not the `RichTextEditorDocument` tree and it is not a mirror of Lexical nodes. The text layer maps model text ranges to rendered block elements and back. Rendering is the view layer (§6.2): `content-renderer` block components or their owned-model adapters, mounted only for the visible slice plus overscan, with offscreen blocks reserved by cached height.

### 5.3 The Object Layer

Heavy objects (code, media, table, mermaid, data grid) are **atomic** within the text flow — a single selectable unit, not a region the text caret enters character-by-character. Each object has three states, per docs/006:

- **Resting:** the baked static snapshot. Cheap; identical to the export/reader representation.
- **Live edit (in place):** the object's own editing surface (a code surface, a grid surface), entered by activating the object. At most **one** object is live at a time (§6.4).
- **Config:** a chrome popover for typing/format/theme.

The object layer owns the **focus hand-off**: when an object goes live, the text layer's caret suspends and the engine records "object X active"; when it deactivates, the object re-bakes and the text caret resumes. The "active surface" is a **slot** (§6.4), so allowing several live objects later is a relaxation, not a rewrite.

### 5.4 The Compatibility Output Contract

The official engine representation is `OwnedDocument` (§7.2). `RichTextEditorDocument` (`model/schema.ts`) remains the **compatibility boundary**: every phase must be able to project the owned model into the shape the standard editor, `content-renderer`, and every downstream consumer already read. That projection carries the docs/006 baked fields, so rollback to the Lexical path and read/export parity remain possible while the new engine matures.

This deliberately separates two questions:

- **Model authority:** `OwnedDocument` is the app's document structure. It owns settings, body order, typed text blocks, registered object blocks, baked snapshots, and transaction semantics.
- **Compatibility output:** `RichTextEditorDocument` is an adapter target. It is still tested as a deep-equal-after-normalization projection until consumers are migrated, but it is not the runtime model and must not leak back into `owned-model/core/**` as an editing type.

Note: there is currently no Zod/content-api integration coupling the editor to a host schema, so this compatibility contract is **internal to the idco packages** — the shape `content-renderer` reads and the engine projects. That keeps the rewrite contained to the editor runtime and makes rollback to the Lexical path possible, because the projection remains identical on both sides.

### 5.5 Input Substrate: One Central Engine, Multiple Backends

> **Architecture note: stop treating this as "the polyfill path."** The hidden-textarea bridge is not an embarrassing workaround; it is the standard substrate used by serious virtualized editors because the real input element captures keyboard, IME, clipboard, autocorrect, and platform text services while the editor owns the model and rendering. In IDCO this becomes the **central input engine**. The hidden-textarea backend is the **baseline**: it defines correctness and runs on every browser. Native EditContext is an **opt-in optimization** layered on Chromium for the IME and accessibility quality the OS gives a true editing host for free — used only where it passes the same behavior suite as the baseline, and droppable without losing correctness. The editor must not grow two behavior stacks called "native" and "polyfill"; native is a backend swap behind one contract, never a second implementation with features of its own.

The active editing region talks to one input-controller interface. That controller may be backed by native `EditContext`, by a hidden `<textarea>` bridge, or by a platform-specific active-block fallback. The output is always the same: model-offset text updates, composition ranges, selection changes, bounds requests, clipboard/shortcut commands, and focus state. The rest of the engine never asks which backend produced them.

The upstream package (`@neftaly/editcontext-polyfill`, ~2.5k LOC) is the best starting point for the hidden-textarea backend. It already implements the hard, boring input plumbing: a visually-hidden `<textarea>` placed inside a shadow root (so `:focus` still matches the host), an input translator for keystrokes/IME, EditContext-like `textupdate`/composition events, mouse selection, selection rendering, and WPT/fuzzer coverage against Chrome's native implementation. We vendor or fork it for provenance and tests, but in IDCO terminology it is no longer "a fallback polyfill"; it is part of the central input engine (decision §6.7).

This still supports virtualization. The textarea captures input only; it is not the document DOM. The authoritative selection is model offsets, and the visible document remains a virtualized render window. Offscreen blocks can unmount because neither the hidden textarea nor native EditContext stores selection inside those block DOM nodes.

### 5.6 Virtualization Model

Virtualization happens at the **block** level (the model's top-level children), not at individual inline nodes:

- Visible blocks plus overscan render their real view (text blocks via `content-renderer` components; objects via their baked snapshot).
- Offscreen blocks are unmounted and reserved by a cached height (keyed by block id + content signature, salvaged from the section-shell helpers and Phase 0).
- A virtual range computes the visible window from `scrollTop`, viewport height, measured/estimated heights, and overscan. Estimated heights are conservative and per-block-type; the measured height is authoritative once a block has rendered.
- Scroll-to-target (search/TOC) scrolls by block id and corrects after the target measures, because the pre-measure estimate is usually wrong. Browser scroll-restoration is disabled for the surface; scroll is restored from block id, not pixel offset.

Because the model — not the DOM — is the source of truth, unmounting offscreen blocks does **not** disturb selection (selection is model offsets) and does **not** break copy (§5.7). This is the property `contenteditable` cannot provide.

### 5.7 Selection And Focus Model

Selection lives in the model. It is **rendered by the browser's native DOM `Selection`** where blocks are mounted on an EditContext host, and **hand-painted by the engine only across the gaps native selection cannot reach** — virtualized middles and the hidden-textarea backend path (the full mechanism is §7.4):

- **Within text:** character-continuous. The caret and ranges are model offsets; on the native path the browser renders the selection over mounted blocks once the engine sets it from those offsets. Caret-from-click uses the browser's `caretPositionFromPoint` / `caretRangeFromPoint` against the rendered text block, then maps to a model offset — so we do not build hit-testing ourselves.
- **Across objects:** **block-atomic** (§6.5). A heavy object selects as one unit; selection does not enter object internals from the outer text flow.
- **Across virtualized gaps:** the model holds the full selected range even when the middle is unmounted; the overlay paints only on mounted blocks; the model knows the rest.

Copy/cut/paste read and write the **model**, not the DOM. On `copy`/`cut`, the engine serializes the selected model range — including offscreen and unmounted blocks and code-block contents — to clipboard formats. This is the correct behavior that DOM-bound virtualized editors (e.g. the Kibana JSON editor) get wrong: they virtualize the DOM but let the browser copy, so only on-screen text copies. Owning the model makes correct cross-virtual copy structural, not a feature to bolt on.

Drag-select that autoscrolls past unmounted blocks extends the model selection by hit-testing blocks as they scroll into view; the unmounted middle stays selected in the model. The backend-local selection renderer covers only its own contiguous region; **cross-block selection painting is the engine's, not the input backend's.**

### 5.8 Desktop / Mobile Parity Through Per-Platform Input

**Goal: desktop and mobile authoring parity.** Owning the model is what makes this honest rather than aspirational, because the input mechanism for the active region is swappable per platform while the model stays the single source of truth:

- **Chromium (desktop and Android):** native EditContext may drive the active region when it passes the same behavior suite.
- **Firefox / Safari / iOS:** the hidden-textarea backend drives the active region, inheriting the platform keyboard/IME.

The decision (§6.6) is to target parity on the central input engine, not on a specific browser API. Where a platform's native text-editing affordances (iOS selection loupe, predictive text, autocorrect) are better served by the platform itself, the engine retains the option to drive the **single active text block** through native `contenteditable` on that block only — possible precisely because virtualization means exactly one region is active at a time, and the model remains authoritative regardless of how keystrokes arrive. Read/review/comment on every platform works from day one because it is just the baked render.

### 5.9 Render-Tier Mapping

The engine is the **editor tier** of docs/006's three tiers. The same node renders three ways, and the bake pipeline is the bridge:

| Tier                                | Source it renders from                     | Interactivity                         |
| ----------------------------------- | ------------------------------------------ | ------------------------------------- |
| Editor (this engine)                | live model + live object surfaces          | full authoring                        |
| Digital reader (`content-renderer`) | compatibility projection + baked fields    | opt-in enhancement (sort/filter, pan) |
| Export (EPUB/PDF worker)            | baked static fields only                   | none; no heavy libraries              |

The engine's resting blocks render the **same baked representation** the reader and export consume. There is one static representation per object, authored at edit time and baked into the node, used everywhere the object is not actively being edited. That single fact is what removes the read↔edit drift class of bug entirely.

## 6. Architecture Decisions

### 6.1 Own The Model Instead Of Fighting contenteditable

**Decision:** the long-term engine owns the document model and uses the central input engine for input; it does not use `contenteditable` as the source of truth.

**Why:** §4.1–4.2. `contenteditable` makes the DOM the document, which forbids virtualization of a live editing surface. The live-book thesis (§2) _is_ the workload that breaks the `contenteditable` bet. Owning the model is the only path that gets virtualized live editing, correct cross-virtual selection/copy, and clean object focus isolation. It is also the substrate that leaves collaboration possible later (§12) at no cost now.

### 6.2 Reuse The View And Semantics, Not Lexical's Engine

**Decision:** reuse the existing document semantics and `content-renderer` as the first view layer, but give the new surface its own `OwnedDocument` model. Do not reuse Lexical's editing engine, and do not treat `RichTextEditorDocument` as the runtime model for this surface.

**Why:** EditContext and Lexical are mutually exclusive for one surface — Lexical _is_ a `contenteditable` reconciler and cannot have EditContext slid underneath it without forking its input layer (forbidden by docs/009). Choosing EditContext means leaving Lexical's engine behind for the owned-model surface. The cost is smaller than it sounds: the semantic node set and read renderer already exist. "Reuse" shifts from "reuse Lexical" to "reuse the semantics + renderer adapters," with the new work being input glue, owned-model↔block mapping, selection overlay, transactions, and the virtualizer. Lexical remains the engine for the **standard** small-document editor.

### 6.3 Let The Browser Lay Out And Hit-Test Text

**Decision:** render text blocks as normal elements and let the browser perform layout, wrapping, bidi, font shaping, and hit-testing; use the standard caret-from-point API for caret-from-click. Note these are **two different APIs with different shapes and browser support** — `caretPositionFromPoint` (returns a `CaretPosition`; Firefox) and `caretRangeFromPoint` (returns a `Range`; Chromium/WebKit) — so implement a feature-detecting wrapper that normalizes both to a `{ node, offset }`, not a single call.

**Why:** this is the difference between "Monaco-class multi-year build" and a bounded one. The genuinely hard, deep work in editors is text layout; we do not reimplement it. We own the model, input, selection overlay, and virtualization — not glyph layout.

### 6.4 One Live-Edit Object At A Time, Behind A Slot

**Decision:** at most one heavy object is in live-edit mode at a time; all others render baked. The active-object surface is a **slot abstraction**, not a hardcoded singular.

**Why:** the text layer is always live, but heavy objects are the expensive, interaction-heavy parts. With bake making rest cheap, allowing only one live object reduces focus/selection/IME arbitration to a single surface, which is tractable; N simultaneous live surfaces is a research project. The slot keeps "allow several live" as a future relaxation rather than a rewrite, so we can walk there if product demand appears. Reader-tier opt-in interactivity (docs/006 §5.7) is a _separate_ downstream tier and does not affect the authoring engine's one-active rule.

### 6.5 Block-Atomic Selection Across Objects

**Decision:** selection is character-continuous within text and block-atomic across heavy objects. There is no cross-object character selection (e.g. a range starting mid-paragraph and ending mid-grid-cell).

**Why:** this is the Notion/ProseMirror selection model and what authors expect — select text continuously, select whole blocks (including an object) for move/delete/copy. The omitted case is something nobody needs and everybody pays dearly to support. Keeping objects atomic to the outer selection also keeps the focus hand-off (§5.3) simple.

### 6.6 Mobile Parity, Native Input On The Active Block

**Decision:** target full desktop/mobile authoring parity. Drive the active region through the central input engine; retain the option to drive the single active text block through native `contenteditable` on platforms where that serves the user better.

**Why:** the product wants parity, and owning the model makes per-platform input a design feature rather than a compromise (§5.8). The residual risk is mobile-Safari IME on the hidden-textarea backend; it is characterized honestly in §11 but is accepted, not treated as a blocker. Read/review on mobile works from day one regardless.

### 6.7 Own The Input Substrate

**Decision:** own the input substrate in the editor package. Start by vendoring or forking `@neftaly/editcontext-polyfill`, but treat it as the seed of IDCO's input engine, not as a replaceable third-party fallback.

**Why:** it is small (~2.5k LOC), permissively licensed, and already covers much of the input plumbing we should not rediscover: hidden textarea, IME, mouse selection, command interception, focus redirection, and native/parity tests. But IDCO also needs fixes that are outside the upstream package's scope: rich-block model mapping, cross-virtual selection/copy, final-newline geometry, caret visual quality, shortcut semantics, and story/native-backend switching. Vendoring or forking lets us merge upstream input work while keeping those editor-owned fixes in one place. When native EditContext improves, it becomes another backend of this substrate; it does not delete the engine, because the engine is the model, selection, virtualization, and backend contract. Native EditContext stays as a **demoted, opt-in backend** (the ~69% Chromium IME/a11y win, §4.2), gated behind the same conformance suite as the baseline: an optimization the engine can drop without losing correctness, never the path correctness is defined against.

### 6.8 Rejected And Deferred Options

- **Rejected — keep the section shell.** Its read↔edit swap, click-to-edit, and multi-editor model are the quirks this engine exists to remove (§3.3).
- **Rejected — switch to ProseMirror/TipTap for scale.** They are `contenteditable` engines and mount the whole document; same ceiling as Lexical. docs/009's ProseMirror endorsement was for product segmentation (the retired section model), not for virtualization.
- **Rejected — build on CodeMirror 6 directly.** CM6 virtualizes uniform code lines beautifully but fights arbitrary nested rich blocks, tables, and media. Adopt its _architecture_ (hidden input + model-owned selection), not its codebase.
- **Rejected — fork Lexical or wait for upstream large-document internals.** High maintenance, and upstream work would still not deliver rich-text viewport rendering or the product features (virtualized search, object focus model).
- **Rejected — custom canvas/text-layout engine.** We let the browser lay out text (§6.3); reimplementing glyph layout, bidi, and accessibility is exactly the multi-year trap to avoid.
- **Deferred — many simultaneously-live objects.** Possible later via the slot (§6.4); not first-release.
- **Deferred — real-time collaboration.** Not foreclosed by the owned model; not designed for now (§12).
- **Deferred — code-block internal virtualization.** A single very large code listing may need its own internal viewport rendering; tracked as a follow-on, not solved here.

## 7. Engine Internals

This section pins the runtime internals that were settled during design so later work does not drift. It is the _how_; §5–6 are the _what_ and _why_. The MDN EditContext HTML-editor demo (external references) is a working, primary-source validation of the spine below: it instantiates an `EditContext` as the **model**, treats its editable element as the **view**, re-renders a **tokenized** view on `textupdate`, and positions IME/selection by feeding `Range` geometry back through `updateControlBounds` / `updateSelectionBounds` / `updateCharacterBounds`. Our engine is that pattern scaled to a virtualized, block-structured rich document.

### 7.1 Stack: Framework-Agnostic Core, React View

The decisive split is **not** "React vs Lit." It is **engine core (plain TypeScript) vs view (thin framework layer)**.

- **Core — zero framework imports:** the document model, the EditContext input controller, the selection model, the virtual-range/height logic, the command/transaction layer, and bake orchestration. This is data, math, and DOM-event plumbing. It is how CodeMirror 6 and Lexical are built (agnostic core, thin bindings), and it is the hedge that makes the view-framework choice low-stakes.
- **View — React:** renders the visible block window, paints the selection overlay, and hosts object chrome. React is chosen because the reuse depends on it: `content-renderer` (the view layer, §6.2), `@idco/ui`, and the React Aria toolbar/object-chrome/flyout (docs/006) are all React. Choosing Lit would discard that reuse and fork the entire chrome stack for an encapsulation win the engine does not need.

| Layer                | Choice                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Engine core          | **Vanilla TypeScript** — model, EditContext controller, selection, virtual-range, commands, bake orchestration           |
| Input                | Central input substrate: native EditContext backend where reliable, hidden-textarea backend elsewhere, bound by the core |
| View / chrome        | **React** — reuse `content-renderer`, `@idco/ui`, React Aria toolbar/popovers                                            |
| Model→view binding   | model as **external store** via `useSyncExternalStore`; the model never lives in React state                             |
| Off-thread work      | **Web Worker** for index/search/serialize/recalc and pure-compute bake (§7.5)                                            |
| WASM/Rust            | **Deferred** — only behind a profiled worker hotspot                                                                     |
| Lit / web components | **No** — would discard React reuse; revisit only if objects become genuinely third-party                                 |

The one React rule that must not be violated: **the document model does not live in React state.** It lives in the engine; the view subscribes via `useSyncExternalStore` to only the slices it paints (the visible id-list and per-block content). If the model goes into `useState`/context, a book-scale document re-render-storms on every keystroke.

### 7.2 Document Model And Mutations

A correction that must be recorded so the rationale does not drift: **Lexical's mutation model is not the problem.** Lexical already uses a flat `NodeMap` hashmap, already reconciles only dirty paths, and already shares structure across immutable `EditorState` snapshots. Its scale failure is the §4 one — `contenteditable` forces the whole tree to stay mounted, and `HistoryPlugin` retains full state snapshots. The new engine wins by being good at **both** a normalized store **and** virtualization, not by "fixing" a mutation model that was already partial.

Decided model:

- **Official document snapshot: app-owned and JSON-serializable.** The engine's official structure is an `OwnedDocument`, not `RichTextEditorDocument`. It can still be stored as JSON, but it is a domain schema rather than an editor-engine snapshot:

  ```ts
  type OwnedDocumentSnapshot = {
    readonly version: 1;
    readonly body: {
      readonly order: readonly BlockId[];
      readonly blocks: Readonly<Record<BlockId, BlockModel>>;
    };
    readonly settings?: DocumentSettings;
  };
  ```

  The runtime store loads this snapshot into `order: BlockId[]` plus `Map<BlockId, BlockModel>` for O(1) lookup and per-block subscriptions. Persistence and host emission serialize snapshots on the `debounced` lane; they are not part of the keystroke hot path.
- **Store: normalized and id-addressed.** Top-level blocks are the coarse, id-addressed units (for virtualization, move/delete/copy). The `id` field is optional in the compatibility schema (`model/schema.ts`), so the engine runs an idempotent **ID-ensure pass on ingest** (docs/009 R1-A, `ensureDocumentNodeIds`) before building the store. Once ensured, _the model is also the virtualization index_: rendering a window is "take the visible id slice, O(1) lookup each." Editing block X replaces X's map entry or mutates it through a controlled store operation and touches nothing else. Because ingest may add ids, the compatibility output contract is **deep-equal after normalization**, not byte-identical (see §14).
- **Text blocks use text + ranges.** Text-bearing blocks hold one `text: string` plus normalized range marks for inline formatting, links, glossary references, and comments. Marks expand into split text nodes and Lexical-style `format` bitmasks only in the compatibility serializer. This is not claimed as "Lexical is bad at mutation"; it is the app-owned shape that makes offsets, Markdown conversion, search, paste, and migrations straightforward.
- **Object blocks are registry-owned, not arbitrary JSON.** Heavy/custom blocks use a generic object envelope in the core, but their `data` is accepted only through a registered definition. Unknown data exists only at parse boundaries:

  ```ts
  type ObjectBlock<Data = unknown> = {
    readonly id: BlockId;
    readonly kind: string;
    readonly data: Data;
    readonly baked?: BakedSnapshot;
    readonly status?: "ready" | "dirty" | "invalid" | "unresolved";
  };

  type BlockDefinition<Data> = {
    readonly kind: string;
    readonly parse: (value: unknown) => Data | null;
    readonly normalize: (value: Data) => Data;
    readonly toCompatibilityValue: (block: ObjectBlock<Data>) => unknown;
    readonly fromCompatibilityValue?: (value: unknown) => ObjectBlock<Data> | null;
    readonly bake?: (block: ObjectBlock<Data>) => Promise<BakedSnapshot>;
    readonly isExportComplete?: (block: ObjectBlock<Data>) => boolean;
    readonly toMarkdown?: (block: ObjectBlock<Data>) => string;
  };
  ```

  A `mermaid`, `data-grid`, `chart`, `record-ref`, or future host block is valid only if its definition exists. The engine does not preserve and render unknown blocks by accident; it drops, flattens, or refuses them according to an explicit policy surfaced by the registry.
- **Document settings are first-class.** Publication/page settings from docs/006 live on `OwnedDocumentSnapshot.settings`, not as body blocks and not as ad hoc fields on the compatibility tree. The compatibility adapter must preserve settings while consumers migrate, even if a given renderer/export target ignores them.
- **Mutations are invertible transactions ("steps"), modeled on ProseMirror.** A command produces an **invertible delta** applied to the store. Invertibility yields partial update, cheap undo, and collaboration-readiness from one mechanism: undo stores _inverse steps_, not whole-document snapshots. This is a small command→step→store loop in the core; do not import Redux.
- **No full-document rebuild on the hot path.** A keystroke, mark toggle, object config change, block move, or settings edit updates only the affected block/order/settings slice and records an inverse step. Full compatibility JSON generation, Markdown export, search indexing, and bake work run on `idle`/`debounced` lanes (§7.3) or in a worker (§7.5).
- **Per-block reactive subscriptions.** A keystroke in block X notifies only X's subscribers -> X re-renders and the selection overlay repaints; nothing else does. "One update never re-renders the editor" is enforced by subscription topology, not by discipline.

### 7.3 Scheduler And Frame Loop

`packages/editor/src/plugins/editor-performance.ts` (docs/008) already contains, in one file, a generic scheduler core and a Lexical bridge:

- **Generic core (no real Lexical dependency):** `createEditorSchedulerTask`, the lane model (`sync | frame | idle | debounced`), within-lane priority, coalescing (`latest | drop-if-pending | merge`), per-task `budgetMs` with cooperative `shouldYield()`/`continue` chunking, and the metrics behind `window.__IDCO_EDITOR_PERF__`. It is generic over `Payload extends object`.
- **Lexical bridge:** `registerEditorUpdateListener` / `registerCoalescedEditorUpdateListener`, the only Lexical-typed part.

Decisions:

- **Promote the generic core into the engine core; leave the Lexical bridge with the standard editor.** The split follows the seam that already exists.
- **One process-wide scheduler, shared by both editors.** A single main thread means a single budget is the _correct_ model. Both the standard Lexical editor and the new engine register into the same singleton → one budget accounting, one `__IDCO_EDITOR_PERF__` dashboard, one docs/008 contract covering both.
- **The lane vocabulary becomes the engine's heartbeat.** In Lexical the scheduler only managed _derived_ work beside the editor; here the engine owns the hot path, and the lanes map almost one-to-one onto its work:

| Lane        | Engine work                                                                      |
| ----------- | -------------------------------------------------------------------------------- |
| `sync`      | input → model step (immediate, this turn)                                        |
| `frame`     | render the visible window + paint the selection overlay (rAF, coalesce `latest`) |
| `idle`      | measure block heights, build search/TOC indexes, prefetch neighbor blocks        |
| `debounced` | emit `onChange` to host, bake objects, serialize                                 |

- **docs/008's budget gate graduates in meaning.** An over-budget **`frame`-lane** run is now a _dropped frame_ — directly user-visible — not just a slow derived listener. Extend the metrics (visible block count, render time, selection-paint time) alongside the existing snapshot; do not replace it.
- **One rAF loop; batch store-notifies into the frame lane.** The scheduler's `frame` lane and React's renderer must not fight. The flow is: model step (`sync`) → mark dirty → one coalesced `frame` task → notify the external store → React renders only the visible slice. Notifies are batched into the frame lane so `useSyncExternalStore` does not trigger a synchronous re-render per keystroke.

### 7.4 Selection And Caret Overlay

An **unproven, load-bearing hypothesis** the MDN demo suggests: attaching an `EditContext` makes the element a focusable **editing host**, and an editing host may get a **native, browser-painted caret driven by the ordinary DOM `Selection`** — without `contenteditable`. The demo sets the selection (it uses `setBaseAndExtent`; we use `addRange` instead, see below) and the browser paints over it. **But whether Chromium paints a _blinking caret_ for a collapsed `addRange` on a non-`contenteditable` EditContext host is exactly what Phase 2 must prove** — it cannot be asserted from the demo or the upstream compatibility package source. Treat this as a hypothesis with a fallback, not a fact:

> The **model** owns _what_ is selected. **If** native DOM `Selection` renders the common case (mounted blocks on an EditContext host, to be confirmed in Phase 2), use it; **otherwise the engine hand-paints the caret and selection itself** — the same overlay it already needs for the gaps. Either way the engine hand-paints what native selection cannot express.

If Phase 2 shows the native caret does not appear for a collapsed `addRange`, the fallback is to hand-paint the caret unconditionally (exactly what the hidden-textarea backend already does), and the "native-where-possible" optimization simply does not apply on the native path — no architectural change, only more painting.

Concretely:

- **Drive selection through `addRange`/`removeAllRanges`, not `setBaseAndExtent`.** Derive the DOM anchor/focus from the model offsets and set the selection with `getSelection().removeAllRanges()` + `getSelection().addRange(range)`. Re-apply after any re-render, because rebuilding the DOM clears the selection. The call form is load-bearing for cross-browser parity: on the hidden-textarea backend path the patched Selection methods paint an equivalent overlay; `setBaseAndExtent` is not patched and would silently do nothing there.
- **The hidden-textarea backend can render selection for us, but with constraints (verified in `selection-renderer.ts`).** On Firefox/Safari the element is not a real editing host, so the backend monkey-patches `Selection.prototype.addRange`/`removeAllRanges` to draw its own caret + selection overlays. Three constraints the engine must honor: (1) it finds the target host by walking up from `range.startContainer` to the nearest `[data-editcontext-active]` element — so **a single such host must wrap the whole mounted window**, and any selection whose start is outside it (an unmounted/offscreen edge) is the engine's hand-paint job, not the backend's; (2) it injects absolutely-positioned overlay children into that host and forces `position: relative` on it — the block container **must tolerate injected children + a forced position** (the React view must not reconcile them away); (3) it suppresses native `::selection` on `[data-editcontext-active]` and its descendants. Consequence of (3): **set the `data-editcontext-active` marker only on the hidden-textarea backend path, never on native Chromium** — setting it natively would suppress the native `::selection` painting the native path depends on.
- **Hand-paint only what neither native selection nor the backend-local renderer can express:**
  1. selection that extends into **unmounted/virtualized** blocks — a DOM `Range` cannot point at nodes that do not exist, so paint only the visible edge; offscreen middles are not visible, and the model still holds the full range for copy/extend;
  2. **atomic-object** highlight boxes (a heavy object in range highlights as its single bounding box, §6.5).
- **Geometry, when hand-painting, comes from the browser.** Construct a DOM `Range` over rendered text and call `range.getClientRects()` for highlight rects, `range.getBoundingClientRect()` for the caret. **Wrapping and bidi line-fragment geometry come back for free** — we never compute line breaks. This is precisely why §6.3 (let the browser lay out text) was the correct call.
- **Caret/selection hot-path rule:** selection-only movement must not rebuild the rendered text DOM. Cache the rendered text-node → model-offset mapping and invalidate it only when text, inline decoration, IME format ranges, or layout-only markers change. Rebuilding the view on every arrow key, pointer move, or diagnostics read is a future perf bug, not an acceptable simplification.
- **The hand-paint overlay lives in scroller coordinates,** `pointer-events: none`, above the text. Because it lives inside the scroller, **scrolling moves it for free**; rects recompute only on selection-change and on relayout (`ResizeObserver`), not per scroll tick. The CSS Custom Highlight API (`Highlight` ranges, as the demo uses for IME formats) is the preferred painting primitive where supported, with absolutely-positioned rects as the fallback.
- **IME preedit formatting is engine-painted.** Native EditContext emits `textformatupdate` while an IME is composing; a custom renderer must apply those ranges itself (for example underlining Vietnamese/Telex preedit text) because the browser will not draw them for a fully owned view. The hidden-textarea backend must emit an equivalent event from its composition range. DOM spans are acceptable in the Phase 2 one-block spike; the CSS Custom Highlight API remains the preferred scalable primitive once the multi-block overlay exists.
- **Feed geometry back to EditContext.** Call `updateControlBounds()` (editable region), `updateSelectionBounds()` (current range rect), and `updateCharacterBounds()` (on `characterboundsupdate`) so the OS IME candidate window lands in the right place. The selection layer and the input layer are coupled here by design; this is a concrete reason EditContext is the right substrate, and the MDN demo exercises all three calls.
- **Caret affinity.** At a soft-wrap or bidi boundary a caret offset can render at the end of line N or the start of line N+1. On the native-selection path the browser resolves this; the engine only owns an affinity/bias bit on the hand-painted/offscreen path. Smaller than a full custom concern, but still real where we paint.
- **Two input modes, one rule** (a consequence of the mobile-parity decision, §5.8/§6.6). On the native-EditContext backend the browser _may_ paint the in-host caret/selection (Phase 2 to confirm; else the engine paints it); on the native-`contenteditable`-active-block path (mobile fallback) the browser paints the caret/selection _within the active block_. Either way, the engine always hand-paints **cross-block** selection and offscreen edges. The rule: **the engine always owns cross-block selection and the authoritative model; intra-host/intra-block caret painting belongs to whoever owns input there (browser, hidden-textarea backend, or engine fallback).**

### 7.5 Web Worker Boundary

A Web Worker is used, scoped precisely:

- **Worker:** search/text-index build, serialization of large documents, data-grid recalc, and _pure-compute_ bake. This is the docs/008 spirit — expensive derived work off the editing path.
- **Main thread, always:** input → step → render, caret, selection, and virtualization. These must be synchronous with input at sub-frame latency; a worker round-trip would add jank, not remove it.
- **The worker is a compute _service_, not a second scheduler.** The `idle`/`debounced` lanes call into it and await results; the main scheduler owns main-thread lanes only. Do not build a distributed cross-thread scheduler.
- **Not all bake is worker-able.** Pure compute (recalc, index, serialize) is. DOM/SVG-rendering bake (mermaid, charts) needs the DOM, so it stays main-thread or uses `OffscreenCanvas` only where the renderer supports it. Promise "pure-compute bake and indexing in a worker," not "all bake in a worker."

## 8. Philosophy And Principles

- **The model is the document; the DOM is a view.** Every capability that historically depended on DOM presence (selection, copy, find, TOC, search) reads the model or a derived index instead. This is the inversion the whole plan turns on.
- **Bake is the differentiator, not the engine alone.** docs/006's "static at rest, live on activation" is what makes a tooling-dense document cheap to hold and possible to export. The engine virtualizes and edits; bake is why rest is affordable.
- **Stay on the browser's happy path for the deep things.** Text layout and hit-testing are the browser's job; platform text input belongs to the central input substrate. We own orchestration — model, selection, virtualization, focus — not primitives we have no business reimplementing.
- **One surface, configured, not many surfaces.** Static vs live, desktop vs mobile, read vs edit are _configurations_ of one engine and one model, never separate code paths that drift.
- **The compatibility output is sacred; the runtime is disposable.** Anything projected to existing consumers must remain readable by `content-renderer` and rollback-compatible with the Lexical path. We are free to reinvent how editing feels and to define the app-owned model; we are not free to silently drop data or break the current projection.
- **Honesty about cost.** This is a real engine, not a plugin. We accept that nothing here is free; the justification is that the product's core workload is the one no `contenteditable` foundation can serve.

## 9. Relationship To Existing Work

- **Standard editor (`RichTextEditor` + Lexical).** Untouched and retained for small and static documents. The owned-model engine is an additional surface selected for the live-book workload, not a replacement for the small-document path on day one.
- **Phase 0 decorator virtualization.** Retained and polished. It is the right answer for decorator-heavy documents within the standard editor (the measured `payloadcms.db` content sits here), and it remains the cheaper path while the engine matures. Its height-cache and signature primitives are shared with the engine's virtualizer.
- **docs/006 (toolbar + bake).** This engine is the editor-tier implementation target of 006's heavy-object model. The toolbar's hybrid surfaces (ribbon, object chrome, selection flyout) sit on top of this engine's focus/selection model; the object-chrome popovers are how live objects are configured (§5.3).
- **docs/008 (perf contract).** The engine's derived work (indexes, search, bake) continues to honor lane/budget scheduling; the contract's intent — keep expensive work off the editing hot path — applies unchanged.
- **docs/009 (section shell + Phase 0).** Phase 0 graduates forward; the section shell is retired with its pure helpers salvaged (§3.3).

## 10. Phasing And Rollout

Risk-first within the dependency order. Phases are sized so each ends in something openable in Ladle and judgeable, none is "build half the engine," and the standard Lexical editor plus Phase 0 decorator virtualization (docs/009 — a different "Phase 0," retained) stay shipped throughout. The phases below are written as gates, not as suggestions: each lists what it **may touch**, what it **must not** do, binary **acceptance criteria**, the exact **verify** commands, and an explicit **done-when** gate. An autonomous loop must treat these as hard contracts.

### 10.1 Global Invariants (checked at every phase gate)

These hold for the lifetime of the work. A phase is not done if any is violated, regardless of its own ACs.

- **G1 — Compatibility output.** Anything the engine emits to existing consumers is a `RichTextEditorDocument` projection whose shape is unchanged; it loads in the standard `RichTextEditor` and renders identically through `@idco/content-renderer`. A golden round-trip test enforces this as **deep-equal after normalization** (the ingest ID-ensure pass, §7.2, may add `id`s; that is the only permitted delta). The internal `OwnedDocument` is authoritative, but the projection is the compatibility gate until a deliberate persistence migration exists.
- **G2 — Standard paths untouched.** `RichTextEditor` (Lexical) and decorator virtualization keep working; `tests/e2e/editor-backspace.perf.spec.ts`, `tests/e2e/editor-decorator-virtualization.perf.spec.ts`, `tests/e2e/editor-typing-latency.perf.spec.ts` (all three brought under the `test:e2e:editor` script in Phase 1 AC3), and all existing `tests/editor/**` unit tests stay green.
- **G3 — Core purity.** `owned-model/core/**` imports neither React nor Lexical. Enforced by an import-boundary check that fails CI.
- **G4 — No new runtime deps** except the vendored input substrate (no external runtime dependency added; `pnpm advise:dupes` shows no new duplication clusters introduced by copy-paste).
- **G5 — Green bar.** `pnpm format:check && pnpm lint && pnpm check:dup && pnpm typecheck && pnpm test` passes before a phase is marked done; `pnpm check` (which also builds) passes at each phase exit.
- **G6 — Opt-in only.** The engine is never wired as a default editor path; no existing caller's behavior changes. The default `RichTextEditor` export is unmodified in behavior until the gated future decision (§12).

### 10.2 Loop Discipline (anti-drift protocol)

- **One phase per loop segment.** Do not start phase N+1 until phase N's done-when gate passes in full.
- **A phase is DONE only when:** all its ACs pass _and_ all global invariants hold _and_ its verify commands are green. Partial is not done.
- **Hard stop on failure.** If a phase cannot meet its gate, stop and report the specific failing AC and command output. Do not weaken an AC, do not stub a test to pass, do not skip ahead, do not edit this document's ACs to fit the code.
- **Scope fence.** Touch only files in the current phase's _may touch_ list. If another file genuinely must change, stop and report why before doing it.
- **Update the ledger** (§10.3) when, and only when, a phase's gate passes.

### 10.3 Phase Status Ledger (update on completion)

- [x] P1 Groundwork
- [ ] P2 Input + caret + selection spike
- [ ] P3 Model + transactions
- [ ] P4 React view + scheduler/frame loop
- [ ] P5 Block virtualization
- [ ] P6 Heavy objects + bake
- [ ] P7 Cross-browser / mobile / a11y hardening
- [ ] P8 Feature parity + index-backed TOC/search + opt-in ship

### 10.4 Phases

#### Phase 1 — Groundwork (small)

- **Goal:** clear the dead section-shell code and scaffold a clean home for the engine.
- **May touch:** `packages/editor/src/large-document/**`, `packages/editor/src/index.ts`, the new `packages/editor/src/owned-model/**`, `package.json` (the `test:e2e:editor` script), `tests/e2e/editor-large-document.perf.spec.ts`, lint config (import-boundary rule).
- **Must not:** change `RichTextEditor`, `RichTextEditorComposer`, decorator virtualization, the model schema, or `content-renderer`.
- **Acceptance criteria:**
  - AC1 `packages/editor/src/large-document/**` is removed; `grep -rn "large-document" packages tests stories` returns nothing outside `docs/`.
  - AC2 the salvaged helpers (`signatures`, `height-cache`, `virtual-range`, id utilities) live under `owned-model/core/**` and keep their unit tests passing.
  - AC3 two distinct acts: (a) **edit** the `test:e2e:editor` script to drop `editor-large-document.perf.spec.ts` **and add `editor-typing-latency.perf.spec.ts`** so the script runs every editor perf spec named in G2; (b) **delete** the `editor-large-document.perf.spec.ts` file. After this, `pnpm test:e2e:editor` runs backspace + decorator-virtualization + typing-latency and passes.
  - AC4 `owned-model/` exists with `core/` and `view/` subtrees; an import-boundary lint rule fails if `core/**` imports `react` or `lexical` (prove it by a temporary violating import that the linter rejects, then revert).
  - AC5 the input substrate is vendored under the current provenance path `owned-model/vendor/editcontext-polyfill/**` with a unit test asserting the module loads and exposes `install`/`EditContext`; future cleanup may rename the directory, but the architecture must treat it as the central input engine, not a temporary fallback.
- **Verify:** `pnpm check`; `grep -rn "large-document" packages tests stories`.
- **Done when:** AC1–AC5 pass and G1–G6 hold.
- **Out of scope:** any engine behavior, any rendering, any EditContext wiring.

#### Phase 2 — Input + caret + selection spike (medium; the foundation gate)

- **Goal:** prove the EditContext + caret + selection loop works cross-browser before any model exists.
- **May touch:** `owned-model/core/**` (input + selection controllers), one Ladle story under `stories/**`, a new e2e spec under `tests/e2e/**`, `playwright.config.ts` (currently **chromium-only** — this phase adds `webkit` and `firefox` projects).
- **Must not:** add a model store, multiple blocks, virtualization, or React app integration beyond the spike host element; use `setBaseAndExtent` anywhere (`grep -rn "setBaseAndExtent" packages` must be empty); set `data-editcontext-active` on the native Chromium path (hidden-textarea backend only, §7.4).
- **Prerequisite:** the webkit/firefox browser binaries must be installed (`pnpm exec playwright install webkit firefox`); record this in the spec/README so CI provisions them.
- **Acceptance criteria:**
  - AC1 a Ladle story binds an `EditContext` to one host element rendering one plain text block; typing updates the visible text via `textupdate` → re-render from model offsets.
  - AC2 caret renders and moves with arrow keys; selection renders for shift+arrow and drag — verified on **chromium, webkit, and firefox** Playwright projects.
  - AC3 selection is set via `getSelection().removeAllRanges()` + `addRange(range)` only; the host carries `data-editcontext-active` (asserted in DOM).
  - AC4 an IME/composition sequence produces the correct final text and selection on each of the three browsers (scripted composition or dead-key).
  - AC5 a forced-hidden-textarea story variant (`install({ force: true })`) renders a working caret + selection on chromium too, proving the backend independent of native EditContext support.
- **Verify:** `pnpm exec playwright test tests/e2e/owned-model-input.spec.ts --project=chromium --project=webkit --project=firefox`; open the Ladle story on each browser.
- **Done when:** AC1–AC5 pass on all three browsers and G1–G6 hold. **If any browser fails fatally here, stop the loop and escalate — this is the make-or-break gate.**
- **Out of scope:** persistence, the document model, more than one block.
- **Follow-up queue found during spike hardening:** keep Vietnamese/Telex IME composition as an explicit Phase 2/7 test target: the underlined preedit string must stay visually correct until the platform commits it with space/control/IME commit, and the final committed text + selection must match the model on native-EditContext and hidden-textarea backend paths. Also capture caret visual metrics against the rendered line box so the hand-painted caret can be tuned for height, width, and device-pixel-ratio parity instead of relying on the browser default.
- **Test-suite shape for those follow-ups:** use WPT/Input Events-style composition cases for event-order correctness, Playwright real-browser geometry screenshots for caret/selection height and focus visibility, the Ladle native/forced-hidden-textarea stories for manual OS keyboard checks, and regression specs for shortcuts/multi-click behavior. IME bugs are too platform-specific for unit-only proof.

#### Phase 3 — Model + transactions (medium–large; headless spine)

- **Goal:** the app-owned document model, block registry boundary, and mutation layer, fully testable without UI. The runtime model is **Lexical-free** — it does not import `lexical`/`@lexical/*` and does not reuse Lexical's node shape as its in-memory representation; Lexical-flavored `RichTextEditorDocument` JSON is a **compatibility projection at the boundary only** (§5.4).
- **May touch:** `owned-model/core/**`, `tests/owned-model/**`.
- **Must not:** import React; import `lexical`/`@lexical/*`; reuse `RichTextEditorNode` as the runtime model (it is a compatibility target, not the editing representation); render anything; add virtualization; implement mermaid/data-grid/chart UI or real bake pipelines. Phase 3 may define the generic object-block and registry contracts those later features will use.
- **Model shape (decided — app-owned, registry-ready, non-Lexical):**
  - **`OwnedDocumentSnapshot` as the official structure:** `{ version, body: { order, blocks }, settings }`, JSON-serializable for storage but not shaped like Lexical/editor state.
  - **Runtime store as ordered ids + `Map<blockId, BlockModel>`:** editing one block/order/settings slice touches only that slice and notifies only relevant subscribers.
  - **Typed text blocks:** `paragraph | heading | listitem | quote | callout | code-block | ...` carry `text: string` plus range `marks` for inline format/link/glossary/comment references.
  - **Registered object blocks:** object data is accepted only through a `BlockDefinition` registry with parse/normalize/compatibility-export/import/export-completeness hooks. Unknown objects are dropped, flattened, or refused by explicit policy; no silent passthrough.
  - **Baked snapshot slots:** the generic object block includes `baked` and `status` fields so docs/006 heavy objects have a place before Phase 6 implements real bakers.
  - **Document settings:** publication/page settings live on the document, not in the body stream, and must survive normalization and compatibility projection.
  - **Flat per-block text string now**, with the rope/piece-table option deferred to a single block type (`code-block`) later, addable without touching the store or step layer.
  - **Invertible diff steps over the normalized store** (AC2/AC3) with structural sharing/subscriber isolation (AC1) — also what keeps CRDT collaboration possible later (§12) at no cost now.
  - _Rejected:_ a model mirroring `RichTextEditorNode`; arbitrary `[key: string]: unknown` blocks in the normalized store; a pure immutable `Record` update path that clones or walks the entire document per edit; a rope-per-block from day one (block-partitioned text is small, so the asymptotic win never triggers — premature complexity).
- **Acceptance criteria:**
  - AC1 the store is normalized (ordered id list + `Map<blockId, BlockModel>`); a test proves editing one block leaves every other block's object identity unchanged (reference equality).
  - AC2 every step type is invertible: a property test asserts `apply(state, inverse(step)) === pre-step state` for generated edits.
  - AC3 undo/redo across N random edits returns a document deep-equal to the pre-edit document.
  - AC4 a golden compatibility round-trip: a known edit sequence serializes to `RichTextEditorDocument` JSON that deep-equals a committed golden **and** loads/renders identically via `content-renderer` (this is G1's enforcing test).
  - AC5 the import-boundary check (G3) is green for all new core files; a grep proves no `lexical`/`@lexical/*` import and no use of `RichTextEditorNode` as a runtime type under `owned-model/core/**`.
  - AC6 inline formatting round-trips losslessly: range-based `marks` ↔ serialized `format` bitmask + split text nodes is proven reversible by a property test over generated overlapping/adjacent mark ranges.
  - AC7 the block registry rejects or normalizes unknown object data by explicit policy; a fixture for a fake registered object proves `baked`/`status` round-trip through `OwnedDocumentSnapshot` and compatibility projection without implementing a real heavy object.
  - AC8 document-level settings survive ingest -> store -> snapshot -> compatibility projection -> ingest; they are never flattened into body blocks or dropped by normalization.
  - AC9 a hot-path test/instrumentation proves a text edit does not serialize or walk every block; only the changed block/order/settings subscriber set is notified.
- **Verify:** `pnpm test`; `pnpm typecheck`; `grep -rn "@lexical\|from \"lexical\"" packages/editor/src/owned-model` is empty.
- **Done when:** AC1–AC9 pass and G1–G6 hold.
- **Out of scope:** React, rendering, virtualization, scheduler wiring.

#### Phase 4 — React view + scheduler/frame loop (medium–large)

- **Goal:** a real React-hosted editor over the model at non-virtualized scale.
- **May touch:** `owned-model/view/**`, the promoted `scheduler-core` (moved from `plugins/editor-performance.ts` per §7.3), Ladle stories, `tests/owned-model/**`, `tests/e2e/**`.
- **Must not:** virtualize (all blocks stay mounted this phase); hold the document in React `useState`/context (`grep` guard); fork the Lexical bridge’s behavior in the shared scheduler.
- **Acceptance criteria:**
  - AC1 a React story edits a 300-block document end-to-end (input → step → store → view) with continuous caret/selection across mounted blocks.
  - AC2 per-block reactivity: an instrumented render-count test asserts typing in block X increments only X's (and the selection overlay's) render count; sibling counts are unchanged.
  - AC3 the model is exposed via `useSyncExternalStore`; no React state/context holds document content (lint/grep guard green).
  - AC4 a typing-latency perf spec (mirroring `editor-typing-latency.perf.spec.ts`) stays within the same budget; `__IDCO_EDITOR_PERF__` reports the engine's frame metrics.
  - AC5 one shared scheduler singleton serves both editors; the standard editor's perf specs (G2) remain green.
- **Verify:** `pnpm test`; `pnpm exec playwright test tests/e2e/owned-model-typing-latency.perf.spec.ts`; `pnpm test:e2e:editor`.
- **Done when:** AC1–AC5 pass and G1–G6 hold.
- **Out of scope:** virtualization, heavy objects, mobile.

#### Phase 5 — Block virtualization (large; the scale goal)

- **Goal:** book scale — mount only the viewport.
- **May touch:** `owned-model/view/**`, `owned-model/core/**` (virtual range, selection across gaps), Ladle stories, `tests/e2e/**`.
- **Must not:** break per-block reactivity (Phase 4 ACs must still hold); paint offscreen selection.
- **Acceptance criteria:**
  - AC1 a 5,000-block story renders ≤ `visible + 2·overscan` block DOM nodes at any scroll position (Playwright counts `[data-…-block]` nodes).
  - AC2 scrolling top → bottom → top returns to a scroll position within ±2px of the start (drift assertion).
  - AC3 scroll-to-block-id lands the target within ±2px after post-measure correction.
  - AC4 selecting from block 3 to block 900 (with autoscroll) and copying yields clipboard text containing the full model range, including the offscreen middle (cross-virtual copy correctness — an instance of G1).
  - AC5 initial mount/first-paint for 5,000 blocks is within a recorded budget in the perf spec (replaces the deleted large-document spec).
- **Verify:** `pnpm exec playwright test tests/e2e/owned-model-large-document.perf.spec.ts`; the 5,000-block Ladle story.
- **Done when:** AC1–AC5 pass and G1–G6 hold.
- **Out of scope:** live object editing (objects may render as baked/placeholder only this phase).

#### Phase 6 — Heavy objects + bake (large; the live-book differentiator)

- **Goal:** atomic heavy objects, baked at rest, one live-edit at a time, no drift.
- **May touch:** `owned-model/**`, object adapters reusing `content-renderer` object rendering and docs/006 bake fields, a worker module, Ladle stories, tests.
- **Must not:** allow more than one object live at once (the slot exists but stays capped at 1); recompute baked output at read/export time; let live and baked forms drift.
- **Acceptance criteria:**
  - AC1 at rest, a heavy object mounts its baked static view, not a live editor subtree (asserted: no editor instance for resting objects).
  - AC2 activating object B while A is live commits and deactivates A first; at most one live object is asserted in state and DOM.
  - AC3 the object's bounding box shifts ≤ 2px between resting and active (no-drift property).
  - AC4 editing an object regenerates its baked field and updates the `OwnedDocument` store plus compatibility projection; an object with no valid bake surfaces a recoverable error rather than emitting an unbakeable node (docs/006 §9).
  - AC5 the text caret suspends on object activation and resumes on deactivation without stranding an in-flight IME composition.
  - AC6 a pure-compute bake/index runs in the Web Worker (asserted via a worker round-trip; main thread not blocked).
- **Verify:** `pnpm test`; `pnpm exec playwright test tests/e2e/owned-model-objects.spec.ts`; the mixed-book Ladle story.
- **Done when:** AC1–AC6 pass and G1–G6 hold.
- **Out of scope:** multiple simultaneous live objects; reader-tier interactivity.

#### Phase 7 — Cross-browser / mobile / a11y hardening (large; the long tail)

- **Goal:** turn the cross-browser gate into a guarantee on the hard surfaces.
- **May touch:** `owned-model/**` (input modes, a11y, bounds), the vendored input substrate, tests, Playwright config (mobile emulation, a11y scan).
- **Must not:** regress any earlier phase's ACs; change the model or compatibility contract for mobile.
- **Acceptance criteria:**
  - AC1 an IME fuzz suite passes ≥ 99% of seeds on chromium/webkit/firefox; remaining failures are enumerated as documented known-failures.
  - AC2 mobile (webkit emulation): touch selection and on-screen-keyboard editing work; if the native-`contenteditable`-active-block path is used, a round-trip test proves the model stays authoritative.
  - AC3 a11y: the editing region exposes textbox semantics; an automated a11y scan of the surface passes; selection changes are announced.
  - AC4 IME control/selection/character bounds remain correct after scroll and relayout (candidate-window position assertion where testable).
- **Verify:** `pnpm exec playwright test tests/e2e/owned-model-*.spec.ts --project=chromium --project=webkit --project=firefox` (the webkit/firefox projects and browser binaries come from Phase 2; do not re-add them here); the a11y scan.
- **Done when:** AC1–AC4 pass and G1–G6 hold.
- **Out of scope:** new features; this is hardening only.

#### Phase 8 — Feature parity + index-backed TOC/search + opt-in ship (medium–large)

- **Goal:** a shippable, opt-in, feature-complete live-book surface.
- **May touch:** `owned-model/**`, derived-index modules, toolbar/object-chrome wiring (docs/006), `packages/editor/src/index.ts` (new opt-in export), tests, stories.
- **Must not:** make the engine a default; alter the standard editor's behavior (G6).
- **Acceptance criteria:**
  - AC1 TOC, model text search, and comment indexes build from the document; navigating to an offscreen heading/result scrolls to and reveals it under virtualization.
  - AC2 the docs/006 toolbar and object chrome operate on the engine's model selection/focus (formatting commands apply to the model selection, not DOM).
  - AC3 a parity checklist versus the standard editor passes for the live-book surface: lists, marks, tables, links, glossary, comments — each has a passing test.
  - AC4 the engine is exposed as an explicit opt-in API; a test confirms existing callers and the default `RichTextEditor` are unchanged (G6).
- **Verify:** `pnpm check`; `pnpm exec playwright test tests/e2e/owned-model-toc-search.spec.ts`.
- **Done when:** AC1–AC4 pass and G1–G6 hold.
- **Out of scope:** auto-default, collaboration.

**Future (gated, not committed):** make the engine the default for chosen workloads, and collaboration groundwork. These are §12 open decisions, decided from data after Phase 8, not scheduled now.

The shape of the bet: Phases 1–2 cost little and retire the foundational risk; Phases 3–4 are the runtime; Phase 5 is the payoff; Phase 6 is the differentiation; Phase 7 is the long tail. If Phase 2 ever returned fatal, the spend would be days, not months — which is where the risk belongs.

### 10.5 Capabilities A Real Editor Still Needs (slot into the phases)

The phases above describe the engine's spine. A production editor needs the following, which the spine does not imply and which must be slotted into the named phase rather than discovered late. `[blocking-for-v1]` items must ship before the engine is offered even as opt-in; `[defer-but-named]` items may follow, but the design must not foreclose them.

- **Paste pipeline — `[blocking-for-v1]`, Phase 3/8.** Clipboard _read_: an HTML/plain-text→model parser with explicit format priority (internal model format > HTML > plain), and an internal high-fidelity clipboard format for intra-app paste. The copy side (§5.7) is only half of clipboard.
- **Sanitization / XSS boundary — `[blocking-for-v1]`, Phase 3/6.** Pasted HTML and **baked HTML/SVG fields** (mermaid SVG, grid output) are rendered by `content-renderer` on every tier including export. Define the single sanitization boundary; nothing author- or paste-derived reaches a rendered tier unsanitized.
- **Find-in-page — `[blocking-for-v1]`, Phase 5/8.** Virtualization removes offscreen text from the DOM, so native Ctrl/Cmd+F is broken by construction. The model search index (§8/§13) must be wired to an **in-editor find UI that is the Ctrl+F replacement** (intercept the shortcut), not just a side panel.
- **Autosave / dirty-state / save-failure — `[blocking-for-v1]`, Phase 4/8.** A dirty-state model, debounced persistence (the `debounced` lane), save-failure recovery, and a minimum two-tabs/stale-write guard. Core for a "live book platform," not optional.
- **Image/file drag-drop & paste → upload → media node — `[blocking-for-v1]`, Phase 6.** Author drops/pastes an image; engine routes to the host upload binding and inserts a media node.
- **Native-path spellcheck story — `[defer-but-named]`, Phase 7.** The hidden-textarea backend disables spellcheck/autocorrect by design; the native EditContext surface does not get native spellcheck for free. Decide the desktop spellcheck approach or explicitly accept its absence — do not claim parity (§5.8) without it.
- **Undo coalescing policy — `[defer-but-named]`, Phase 3.** Name the grouping rules (typing run = one undo, boundaries at format/paste/object-activation) and selection restoration on undo/redo. The invertible-step model enables it; the policy is still a decision.
- **Memory / teardown of unmounted blocks — `[defer-but-named]`, Phase 5.** Unmounting blocks must release subscriptions, observers, height-cache growth, and worker references; assert no unbounded growth over a long scroll of a 5,000-block document.
- **Concrete accessibility plan — `[defer-but-named]`, Phase 7.** §11 admits a11y "must be designed, not inherited" but gives no plan; before Phase 7's a11y scan can mean anything, define the role/`textbox` semantics, `aria-activedescendant` for atomic objects, and live-region selection announcements.
- **Link editing, RTL/bidi caret, print-from-editor, multi-caret — `[defer-but-named]`.** Link insert/edit/auto-link-on-paste; the bidi caret-on-wrong-line case as a real test target (not just an acknowledged affinity bit); printing must use the full `content-renderer`/export path, never the virtualized editor DOM (which mounts only the viewport); multi-caret is explicitly out of v1.

## 11. Risks, Edge Cases, And Failure Modes

- **Mobile-Safari IME on the hidden-textarea backend.** The hidden-textarea bridge versus iOS predictive text, autocorrect, and the selection loupe is the single highest-risk surface. The upstream package is young and has known IME-fuzz limits, so our owned substrate must vendor and harden it; retain the native-`contenteditable`-on-active-block option (§5.8/§6.6); treat IME as a first-class test target.
- **IME engagement is the platform's call, not ours (Firefox + Windows IME-toggle).** Captured from the Phase 2 spike: with the hidden-textarea backend on Firefox, if the user switches keyboard language mid-document (en↔vi↔en), the Windows IME stops entering composition and emits plain `insertText` for the next word — so Vietnamese Telex "xin chào" lands as "xin o". Traced conclusively: the hidden textarea keeps focus throughout (`taIsActive` stays true) and the model is never corrupted (it faithfully reflects whatever the IME emits) — the IME simply declines to compose. It is reproducible in any plain `<textarea>` in Firefox and there is **no web-platform signal** for an IME language switch, so the backend cannot detect or recover from it without breaking legitimate plain typing. Keeping the VI keyboard active throughout composes correctly. Native EditContext on Chromium does not exhibit it — another point for the keep-native decision (§4.2). Accepted, not a blocker; revisit only if a backend-level workaround proves safe.
- **Owning composition correctness for complex scripts is the price of the baseline.** Because the hidden-textarea backend is the baseline, IDCO owns IME composition correctness for CJK, Vietnamese/Telex, and dead-keys on every browser where native is not used — all of Firefox/Safari, and Chromium if a regression forces the baseline. This is a recurring, platform-matrixed cost, not a one-off (the Microsoft-Telex-on-Firefox composition bug, fixed during the Phase 2 spike, is the representative case: a trailing `insertCompositionText` after `compositionend` that duplicated committed text). Native EditContext is precisely the mitigation that hands Chromium users vendor-grade composition for free — the reason it is kept (§4.2/§6.7) — but the baseline must be independently correct, and CJK is harder than Telex. There is no off-the-shelf CJK IME test framework; the proof strategy is assembled (§13).
- **Caret-from-click accuracy at wrap/bidi boundaries.** `caretPositionFromPoint` resolution varies; mapping pixel → text offset → model offset must be verified on wrapped lines, RTL runs, and around inline marks.
- **Scroll drift on late-resizing content.** Images, baked SVGs, and tables that settle height after first paint shift everything below. Heights must be conservative and measured-authoritative; scroll-to-target corrects after measure; a top→bottom→top drift assertion guards regressions.
- **Selection overlay across partially-mounted ranges.** Painting only on mounted blocks while the model holds the full range must stay visually correct as blocks mount/unmount during autoscroll selection.
- **Focus hand-off races.** Activating/deactivating an object while a selection or IME composition is in flight must defer until composition ends and must not strand the caret.
- **Bake failure.** A heavy object with no valid baked snapshot is not exportable and must surface a recoverable error rather than emit an unbakeable node (docs/006 §9). The engine must re-bake on edit and never let the live and baked forms drift.
- **Clipboard fidelity.** Model-based copy must produce correct text and structured formats for cross-virtual ranges, including code blocks, and paste must splice into the model without trusting DOM.
- **Accessibility of a non-`contenteditable` surface.** Owning the model means owning the accessibility story for the editing region (roles, announcements, caret semantics) that `contenteditable` would have provided; this must be designed, not inherited. This risk concentrates in the selection/caret overlay (§7.4) and is one of the three things expected to cost real time, alongside caret affinity and IME bounds.
- **Caret affinity at wrap/bidi boundaries.** On the native DOM `Selection` path the browser resolves affinity; on the hand-painted/offscreen path the selection model must carry an affinity/bias bit (§7.4), or the caret renders on the wrong visual line at soft-wrap and RTL boundaries. Scoped to where we paint — budgeted, not discovered.
- **IME bounds feedback correctness.** `updateControlBounds`/`updateSelectionBounds`/`updateCharacterBounds` must keep the OS IME candidate window correctly placed across platforms and during scroll/relayout; getting this wrong is most visible on mobile-Safari via the hidden-textarea backend.
- **Scheduler vs React double-scheduling.** The `frame` lane and React's renderer must share one rAF and batch store-notifies (§7.3); a regression here shows up as re-render storms or dropped frames on keystroke.
- **Two engines in the codebase.** The standard Lexical editor and the owned-model engine coexist; node definitions, bake fields, and compatibility adapters must stay shared so the two never diverge on what a document means.

## 12. Open Decisions

- **Persistence format migration.** Phase 3 defines `OwnedDocument` as the app model, but existing consumers still require `RichTextEditorDocument` compatibility output. Whether storage eventually flips to `OwnedDocumentSnapshot`, stores both during a migration window, or keeps `RichTextEditorDocument` as the durable interchange format is a separate migration decision, not part of the engine hot path.
- **Many simultaneously-live objects.** Currently one-at-a-time (§6.4). Whether and when to relax via the slot is unresolved and should be driven by real author behavior, not anticipated.
- **Reader-tier interactive surface sharing.** How much of the live object surface (e.g. a sortable grid) is shared with the digital-reader tier versus re-implemented from baked fields is an open boundary between this engine and `content-renderer`.
- **Collaboration.** No plan now. The owned model and existing stable IDs keep CRDT possible later at no extra cost; we will not design collab plumbing until it is real, but we will avoid model decisions that are collab-hostile.
- **Code-block internal virtualization.** Deferred; revisit when a single listing is large enough to matter.
- **When the engine becomes the default.** Whether/when the owned-model engine supersedes the standard editor for non-live documents is left for after it is proven on the live-book workload.

## 13. Verification Philosophy

Concrete tickets are out of scope here; the _shape_ of proof is not:

- **Prove the inversion, not the pixels.** Tests assert that selection, copy, search, and TOC operate from the model with offscreen blocks unmounted — i.e. that DOM presence is not required for correctness.
- **Virtualization is bounded.** A 5,000-block document mounts viewport + overscan, not the whole document; scrolling does not mount everything; the top→bottom→top scroll position is stable.
- **Cross-virtual copy is correct.** Copying a range that spans unmounted blocks (including code) yields the full model content, not just on-screen text.
- **Object lifecycle is honest.** Activation bakes/live-swaps in place with no layout drift; deactivation re-bakes; an unbakeable object surfaces an error rather than corrupting the document.
- **IME and complex scripts are first-class, proven by an assembled suite (no turnkey tool exists).** Two halves. (1) _Script shaping / segmentation_ — caret-by-grapheme, word selection, delete-by-cluster — is verified deterministically against Unicode UAX #29 data (`GraphemeBreakTest` / `WordBreakTest`) over `Intl.Segmenter`, in CI on every browser; this catches the "don't split a Hangul syllable / Thai cluster / emoji ZWJ" class without an IME. (2) _Composition_ has no framework, so it is proven by capturing real IME event streams once and replaying them as cross-browser regressions (the technique already used for Microsoft Telex), plus CDP `Input.imeSetComposition` for Chromium composition, ported WPT `input-events` ordering cases, and a thin manual real-device matrix (CJK + Vietnamese). The native-EditContext and hidden-textarea backends run the **same** composition cases; native is used only where it passes them.
- **Output is unchanged.** Round-tripping any document through the new engine yields compatibility JSON that `content-renderer` renders identically and that the Lexical path can still load (rollback safety).

## 14. Completion Criteria

The engine is "done enough to adopt for the live-book workload" when:

- A generated book-scale document (thousands of blocks, dense code/objects) opens quickly and scrolls within budget, mounting only the visible window plus overscan.
- Text editing is continuous across the document with model-owned selection — rendered natively where blocks are mounted, engine-painted across virtualized gaps — on Chromium through the native-EditContext backend when reliable and on Firefox/Safari through the hidden-textarea backend.
- Heavy objects render baked at rest, go live in place one at a time, re-bake on edit, and never drift from their baked form.
- Cross-virtual selection and copy are correct; search and TOC navigate to and reveal offscreen targets.
- Desktop and mobile reach authoring parity per §5.8, with read/review working everywhere from day one.
- The compatibility projection is deep-equal-after-normalization to the existing `RichTextEditorDocument` contract (ingest may add optional `id`s; no other delta) and rollback-compatible with the Lexical path; the app-owned `OwnedDocument` remains the authoritative model.
- The standard editor and Phase 0 remain intact for small/static documents.

## 15. Final Model

The scalable IDCO editor is not a bigger `contenteditable`. It is an **owned-model engine**: `OwnedDocument` is the source of truth, a central input substrate feeds text/composition/selection by model offset, the browser still lays out and hit-tests text, and selection is model-based so the editor can virtualize blocks without the DOM fighting back. Native EditContext and hidden textarea are backends of that substrate, not separate editor implementations. Heavy objects sit atomic in the text flow, baked static at rest and live one-at-a-time on activation — which is what makes a tooling-dense document cheap to hold and possible to export, and which is the precise place the incumbent `contenteditable` foundation fails. The legacy rich-text JSON remains a compatibility projection until consumers migrate; the app model, not that JSON tree, is the authority. This is the editor a live technical book platform needs, and it is the one no mainstream `contenteditable` engine can become.
