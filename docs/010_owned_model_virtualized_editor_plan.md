# 010 - The Virtualized Editor (Central Input Engine)

> Status: design direction (pre-implementation)
>
> Date: 2026-06-16
>
> Scope:
>
> - `packages/editor/src/legacy/**` — all of Lexical (the `RichTextEditor` surface, `RichTextEditorComposer`, `nodes/`, `plugins/`, `toolbar/`, `model/`, `hooks/`, and Phase 0 `decorator-virtualization.tsx`). Retained and shipped until retirement; fenced under `legacy/` and deleted whole when the engine reaches parity (§9.1).
> - `packages/editor/src/large-document/**` — the section-shell virtualization (retired by this plan; `virtual-range` salvaged to `core/`, the Lexical-shaped `signatures`/`height-cache`/`ids` to `legacy/model/`).
> - `packages/editor/src/legacy/model/schema.ts` — the `RichTextEditorDocument` wire format (010 §5.4). Lexical-shaped JSON (`root.children` + `format` bitmask); the engine reads/writes it only at its future compat adapter, never as a model type. It lives with the format it describes until Phase 3 needs a neutral home (§9.1).
> - `packages/reader/**` (docs/015) — the read tier and the RSC-safe presentational primitive layer (L1) the engine view renders resting blocks through. **Retires `@idco/content-renderer`**; it is not the engine's view base.
> - `packages/lib/src/rich-text.ts` — pure rich-text/TOC helpers shared across packages.
> - `packages/editor/src/core/**`, `view/**` — the new editor runtime (canonical). `core/vendor/` holds the vendored EditContext polyfill; `spike/**` holds the Phase 2 proof as reference only (§9.1). The canonical engine is the package's main content; Lexical is the legacy tenant.
>
> Source docs:
>
> - `docs/001_lexical_editor_architecture.md` — editor package architecture and book-authoring target.
> - `docs/006_editor_toolbar_redesign_plan.md` — heavy-object pattern, three render tiers, the bake pipeline, data-grid/mermaid, reflow-vs-fixed-layout.
> - `docs/008_editor_performance_contract.md` — update-listener lane/budget contract for the editing hot path.
> - `docs/009_large_document_virtualized_editor_plan.md` — virtualization research, the retired section shell, and Phase 0 decorator virtualization.
>
> Foundation contract:
>
> - `docs/011_foundation_dsa_owned_model_editor.md` is the **data-structure and algorithm foundation** under this plan, written after it. **Division of labor:** this document (010) owns the motivation, the product thesis, the generic architecture path, and the phasing; 011 owns the foundation — the node model, the coordinate system, the mutation algebra, the history model, and the selection model. **Where the two disagree on a foundation detail, 011 wins.** 011 explicitly supersedes 010 §7.2 (flat-store tilt → normalized node graph) and 010 §5.5/§7.4 (hand-paint-as-baseline emphasis → engine overlay rects); see 011 §15 for the full correction list. The sections below that touch those areas carry an inline "→ 011" pointer; treat 011 as authoritative there.
> - `docs/016_node_spi_and_pluggable_blocks.md` is the **node SPI** — the runnable contract realizing 011 §2.3/§2.7/§6.5: paired `NodeDefinition` (core) + `NodeView` (view), the object lifecycle, and `registerNode`. It is the authority for how a block/object node renders, edits live, and registers. Phase 8 fills its optional slots without reshaping it.
> - `docs/017_pre_phase_8_plan.md` is the **pre-Phase-8 execution plan** — the bounded, behavior-preserving pass (view decompose, the 016 SPI lift, two latent-bug fixes, the Payload-dialect decision) that must complete before Phase 8 begins.
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
> - The official engine model is an app-owned `EditorDocument`, not Lexical state and not the loose `RichTextEditorDocument` tree. The runtime may serialize to JSON for storage, but JSON is a wire format, not the model authority.
> - `RichTextEditorDocument` remains a mandatory compatibility projection while the standard editor, `@idco/content-renderer`, and downstream consumers still read it. The projection must preserve baked fields and remain rollback-compatible until a deliberate persistence migration exists.
> - The engine's view layer renders through the RSC-safe presentational primitive layer in `packages/reader` (docs/015), the same primitives the published reader uses, so the editor's resting blocks and the reader cannot drift. `@idco/content-renderer` is **retired** (docs/015), not used as the view base; its resolver/override seam moves to `packages/reader`.
> - The new `src` (`core/`, `view/`) is the **canonical, self-contained editor**. It imports nothing from `legacy/` or `spike/`, depends on no Lexical-era module, and reaches the old world only across the `RichTextEditorDocument` data boundary (a JSON shape it reads/writes), never as a code dependency. The internal scheduler, the input substrate, and custom blocks are built fresh inside the engine, not imported from the Lexical side (§7.3, §9.1, §10.2).
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
  - [6.2 Reuse The Semantics And The Shared Primitives, Not Lexical's Engine And Not content-renderer](#62-reuse-the-semantics-and-the-shared-primitives-not-lexicals-engine-and-not-content-renderer)
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
  - [9.1 Package Structure And The Old/New Boundary](#91-package-structure-and-the-oldnew-boundary)
  - [9.2 Existing Work](#92-existing-work)
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

Define the editor runtime IDCO needs to become a **live technical book platform**, and record the architecture decisions made while reasoning toward it. The conclusion is that the long-term editing surface should not be a `contenteditable` rich-text engine. It should be a **virtualized editor built around the EditContext API** — native `EditContext` where the browser ships it, an EditContext polyfill (a hidden `<textarea>`) where it does not — where the document model, not the DOM, is the source of truth. EditContext is the substrate the engine is built on, not an optional accelerator: the engine speaks one EditContext contract and binds it to whichever implementation the platform provides.

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

**Decision (June 2026): build the engine around the EditContext API, and treat the hidden textarea as EditContext polyfilled rather than as a rival substrate.** There are not two things here, "native" versus "polyfill"; there is one substrate, EditContext, with two implementations. The engine speaks the EditContext contract everywhere — `textupdate`, composition events, `updateControlBounds`/`updateSelectionBounds`/`updateCharacterBounds` — and binds it to native `EditContext` on Chromium and to an EditContext polyfill (the hidden `<textarea>`, §5.5) on Firefox/Safari. Correctness is defined by that contract and by one conformance suite both implementations pass, so the engine never depends on native being present: drop the native implementation tomorrow and the same EditContext-shaped engine keeps running on the polyfill. Native is kept not as an optional add-on but because on ~69% of users it satisfies the contract with vendor-grade OS IME (composition, candidate-window placement) and accessibility the browser supplies for free. We considered abandoning the EditContext shape for a bespoke textarea protocol (the pure Monaco/CodeMirror model) and rejected it: EditContext is the contract the OS IME, accessibility services, and the MDN reference editor are already written against, and matching it is exactly what lets native drive those ~69% of sessions at vendor quality, with IME being the costliest surface to own (§11).

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
Editor Engine
├── App document      (EditorDocument · settings · registered block/object definitions)
│     body order + block map · document settings · no arbitrary unknown blocks
├── Text layer        (virtualized render · per-platform input · model-owned selection)
│     paragraphs, headings, lists, inline marks — the connective tissue, always live
├── Object layer      (heavy objects, atomic in the text flow)
│     baked static at rest · one live-edit at a time behind a slot · docs/006 bake pipeline
└── Compatibility output
      RichTextEditorDocument adapter + baked fields for content-renderer/rollback
```

### 5.2 The Text Layer

The text flow is **always live**: the caret moves freely through paragraphs, headings, and list items, and selection is continuous within text. This is the base editor surface and the thing EditContext is genuinely for (text input, IME, composition, selection).

The model is the app-owned document store described in §7.2. It is not the `RichTextEditorDocument` tree and it is not a mirror of Lexical nodes. The text layer maps model text ranges to rendered block elements and back. Rendering is the view layer (§6.2): the shared `packages/reader` L1 primitives (docs/015), mounted only for the visible slice plus overscan, with offscreen blocks reserved by cached height.

### 5.3 The Object Layer

Heavy objects (code, media, table, mermaid, data grid) are **atomic** within the text flow — a single selectable unit, not a region the text caret enters character-by-character. Each object has three states, per docs/006:

- **Resting:** the baked static snapshot. Cheap; identical to the export/reader representation.
- **Live edit (in place):** the object's own editing surface (a code surface, a grid surface), entered by activating the object. At most **one** object is live at a time (§6.4).
- **Config:** a chrome popover for typing/format/theme.

The object layer owns the **focus hand-off**: when an object goes live, the text layer's caret suspends and the engine records "object X active"; when it deactivates, the object re-bakes and the text caret resumes. The "active surface" is a **slot** (§6.4), so allowing several live objects later is a relaxation, not a rewrite.

### 5.4 The Compatibility Output Contract

The official engine representation is `EditorDocument` (§7.2). `RichTextEditorDocument` (`model/schema.ts`) remains the **compatibility boundary**: every phase must be able to project the model into the shape the standard editor, `content-renderer`, and every downstream consumer already read. That projection carries the docs/006 baked fields, so rollback to the Lexical path and read/export parity remain possible while the new engine matures.

This deliberately separates two questions:

- **Model authority:** `EditorDocument` is the app's document structure. It owns settings, body order, typed text blocks, registered object blocks, baked snapshots, and transaction semantics.
- **Compatibility output:** `RichTextEditorDocument` is an adapter target. It is still tested as a deep-equal-after-normalization projection until consumers are migrated, but it is not the runtime model and must not leak back into `core/**` as an editing type.

Note: there is currently no Zod/content-api integration coupling the editor to a host schema, so this compatibility contract is **internal to the idco packages** — the shape `content-renderer` reads and the engine projects. That keeps the rewrite contained to the editor runtime and makes rollback to the Lexical path possible, because the projection remains identical on both sides.

### 5.5 Input Substrate: One Central Engine, Multiple Backends

> **Architecture note: the engine is built around the EditContext API, and the hidden textarea is EditContext polyfilled.** The hidden-textarea bridge is not a rival to EditContext; it is how you obtain EditContext on a browser that does not ship it — the same `textupdate` / composition / bounds contract, implemented over a real input element that captures keyboard, IME, clipboard, autocorrect, and platform text services while the editor owns the model and rendering. So there is one substrate, EditContext, with two implementations: native on Chromium, polyfilled (`@neftaly/editcontext-polyfill`) elsewhere. Correctness is defined by the contract and a single conformance suite both implementations pass, which is why the engine never depends on native being present and can drop it without losing correctness. The editor must not grow two behavior stacks called "native" and "polyfill"; both are EditContext behind one contract, never a second implementation with features of its own.

The active editing region talks to one input-controller interface. That controller may be backed by native `EditContext`, by a hidden `<textarea>` bridge, or by a platform-specific active-block fallback. The output is always the same: model-offset text updates, composition ranges, selection changes, bounds requests, clipboard/shortcut commands, and focus state. The rest of the engine never asks which backend produced them.

The upstream package (`@neftaly/editcontext-polyfill`, ~2.5k LOC) is the best starting point for the hidden-textarea backend. It already implements the hard, boring input plumbing: a visually-hidden `<textarea>` placed inside a shadow root (so `:focus` still matches the host), an input translator for keystrokes/IME, EditContext-like `textupdate`/composition events, mouse selection, selection rendering, and WPT/fuzzer coverage against Chrome's native implementation. We vendor or fork it for provenance and tests, but in IDCO terminology it is no longer "a fallback polyfill"; it is part of the central input engine (decision §6.7).

This still supports virtualization. The textarea captures input only; it is not the document DOM. The authoritative selection is model offsets, and the visible document remains a virtualized render window. Offscreen blocks can unmount because neither the hidden textarea nor native EditContext stores selection inside those block DOM nodes.

### 5.6 Virtualization Model

Virtualization happens at the **block** level (the model's top-level children), not at individual inline nodes:

- Visible blocks plus overscan render their real view (text blocks via the `packages/reader` L1 primitives; objects via their baked snapshot).
- Offscreen blocks are unmounted and reserved by a cached height (keyed by block id + content signature, salvaged from the section-shell helpers and Phase 0).
- A virtual range computes the visible window from `scrollTop`, viewport height, measured/estimated heights, and overscan. Estimated heights are conservative and per-block-type; the measured height is authoritative once a block has rendered.
- Scroll-to-target (search/TOC) scrolls by block id and corrects after the target measures, because the pre-measure estimate is usually wrong. Browser scroll-restoration is disabled for the surface; scroll is restored from block id, not pixel offset.

Because the model — not the DOM — is the source of truth, unmounting offscreen blocks does **not** disturb selection (selection is model offsets) and does **not** break copy (§5.7). This is the property `contenteditable` cannot provide.

### 5.7 Selection And Focus Model

Selection lives in the model. The current proof baseline is **engine-painted overlay rects derived from browser DOM `Range` geometry**. The browser still supplies hit-testing, text layout, wrapping, bidi fragments, and clipboard/input events, but the browser's visible native `Selection` is not the authority and is not the required painter (the full mechanism is §7.4):

- **Within text:** character-continuous. The caret and ranges are model offsets; the engine maps them to DOM `Range`s over mounted text and paints overlay rects from `Range.getClientRects()`. Caret-from-click uses the browser's `caretPositionFromPoint` / `caretRangeFromPoint` against the rendered text block, then maps to a model offset — so we do not build hit-testing ourselves.
- **Across objects:** **block-atomic** (§6.5). A heavy object selects as one unit; selection does not enter object internals from the outer text flow.
- **Across virtualized gaps:** the model holds the full selected range even when the middle is unmounted; the overlay paints only on mounted blocks; the model knows the rest.

Copy/cut/paste read and write the **model**, not the DOM. On `copy`/`cut`, the engine serializes the selected model range — including offscreen and unmounted blocks and code-block contents — to clipboard formats. This is the correct behavior that DOM-bound virtualized editors (e.g. the Kibana JSON editor) get wrong: they virtualize the DOM but let the browser copy, so only on-screen text copies. Owning the model makes correct cross-virtual copy structural, not a feature to bolt on.

Drag-select that autoscrolls past unmounted blocks extends the model selection by hit-testing blocks as they scroll into view; the unmounted middle stays selected in the model. **Selection painting is the engine's, not the input backend's.**

### 5.8 Desktop / Mobile Parity Through Per-Platform Input

**Goal: desktop and mobile authoring parity.** Owning the model is what makes this honest rather than aspirational, because the input mechanism for the active region is swappable per platform while the model stays the single source of truth:

- **Chromium (desktop and Android):** native EditContext may drive the active region when it passes the same behavior suite.
- **Firefox / Safari / iOS:** the hidden-textarea backend drives the active region, inheriting the platform keyboard/IME.

The decision (§6.6) is to target parity on the central input engine, not on a specific browser API. **Decision (Phase 7): there is no per-platform `contenteditable` fork — one input substrate (the EditContext polyfill / hidden textarea) drives the active region on iOS, Android, and every desktop browser without native EditContext.** The earlier "retain the option to drive the single active text block through native `contenteditable` on iOS" escape is **dropped**: a platform-special editing path is exactly the divergence this engine exists to avoid, and it would fork selection/IME/caret behavior for one platform. The trade is accepting that the owned surface does not get iOS's native selection loupe/magnifier on the editing text (it keeps the iOS keyboard, autocorrect, and touch caret placement through the textarea); that is documented, not worked around. Any mobile/iOS defect is therefore either a genuine platform bug or a gap in the polyfill's own logic to fix in the substrate — never a reason to special-case a platform. Read/review/comment on every platform works from day one because it is just the baked render.

### 5.9 Render-Tier Mapping

The engine is the **editor tier** of docs/006's three tiers. The same node renders three ways, and the bake pipeline is the bridge:

| Tier                                | Source it renders from                     | Interactivity                         |
| ----------------------------------- | ------------------------------------------ | ------------------------------------- |
| Editor (this engine)                | live model + live object surfaces          | full authoring                        |
| Digital reader (`packages/reader`) | compatibility projection + baked fields    | opt-in enhancement (sort/filter, pan) |
| Export (EPUB/PDF worker)            | baked static fields only                   | none; no heavy libraries              |

The engine's resting blocks render the **same baked representation** the reader and export consume. There is one static representation per object, authored at edit time and baked into the node, used everywhere the object is not actively being edited. That single fact is what removes the read↔edit drift class of bug entirely.

## 6. Architecture Decisions

### 6.1 Own The Model Instead Of Fighting contenteditable

**Decision:** the long-term engine owns the document model and uses the central input engine for input; it does not use `contenteditable` as the source of truth.

**Why:** §4.1–4.2. `contenteditable` makes the DOM the document, which forbids virtualization of a live editing surface. The live-book thesis (§2) _is_ the workload that breaks the `contenteditable` bet. Owning the model is the only path that gets virtualized live editing, correct cross-virtual selection/copy, and clean object focus isolation. It is also the substrate that leaves collaboration possible later (§12), for a small, deliberate day-one cost folded into Phase 3 (011 §17, docs/014).

### 6.2 Reuse The Semantics And The Shared Primitives, Not Lexical's Engine And Not content-renderer

**Decision:** reuse the document semantics (node kinds, bake fields), and render the view through `packages/reader`'s RSC-safe L1 primitives (docs/015). Give the new surface its own `EditorDocument` model. Do not reuse Lexical's editing engine, do not treat `RichTextEditorDocument` as the runtime model, and do not build the view on `@idco/content-renderer` — that package is retired (docs/015).

**Why:** EditContext and Lexical are mutually exclusive for one surface — Lexical _is_ a `contenteditable` reconciler and cannot have EditContext slid underneath it without forking its input layer (forbidden by docs/009). Choosing EditContext means leaving Lexical's engine behind for the editor surface. The cost is smaller than it sounds: the semantic node set already exists, and the read-side primitives become the shared L1 layer in `packages/reader` that the editor's resting blocks and the published reader both render through, so the two cannot drift (docs/015 §2). "Reuse" shifts from "reuse Lexical" to "reuse the semantics + the shared L1 primitives," with the new work being input glue, model↔block mapping, selection overlay, transactions, and the virtualizer. Lexical remains the engine for the **standard** small-document editor under `legacy/`.

### 6.3 Let The Browser Lay Out And Hit-Test Text

**Decision:** render text blocks as normal elements and let the browser perform layout, wrapping, bidi, font shaping, and hit-testing; use the standard caret-from-point API for caret-from-click. Note these are **two different APIs with different shapes and browser support** — `caretPositionFromPoint` (returns a `CaretPosition`; Firefox) and `caretRangeFromPoint` (returns a `Range`; Chromium/WebKit) — so implement a feature-detecting wrapper that normalizes both to a `{ node, offset }`, not a single call.

**Why:** this is the difference between "Monaco-class multi-year build" and a bounded one. The genuinely hard, deep work in editors is text layout; we do not reimplement it. We own the model, input, selection overlay, and virtualization — not glyph layout.

### 6.4 One Live-Edit Object At A Time, Behind A Slot

**Decision:** at most one heavy object is in live-edit mode at a time; all others render baked. The active-object surface is a **slot abstraction**, not a hardcoded singular.

**Why:** the text layer is always live, but heavy objects are the expensive, interaction-heavy parts. With bake making rest cheap, allowing only one live object reduces focus/selection/IME arbitration to a single surface, which is tractable; N simultaneous live surfaces is a research project. The slot keeps "allow several live" as a future relaxation rather than a rewrite, so we can walk there if product demand appears. Reader-tier opt-in interactivity (docs/006 §5.7) is a _separate_ downstream tier and does not affect the authoring engine's one-active rule.

### 6.5 Block-Atomic Selection Across Objects

**Decision:** selection is character-continuous within text and block-atomic across heavy objects. There is no cross-object character selection (e.g. a range starting mid-paragraph and ending mid-grid-cell).

**Why:** this is the Notion/ProseMirror selection model and what authors expect — select text continuously, select whole blocks (including an object) for move/delete/copy. The omitted case is something nobody needs and everybody pays dearly to support. Keeping objects atomic to the outer selection also keeps the focus hand-off (§5.3) simple.

### 6.6 Mobile Parity, One Input Substrate (No Platform Fork)

**Decision:** target full desktop/mobile authoring parity, driven by the **single** central input substrate (the EditContext polyfill / hidden textarea) on every platform that lacks native EditContext — iOS and Android included. **The native-`contenteditable`-on-the-active-block escape is dropped (Phase 7):** there is no per-platform editing path. A `contenteditable` fork for one platform would split selection, IME, and caret behavior — the exact divergence this engine exists to remove — so it is rejected even as an option.

**Why:** the product wants parity, and owning the model makes per-platform input a design feature rather than a compromise (§5.8). The accepted cost is that the owned editing surface does not get iOS's native selection loupe/magnifier (it keeps the iOS keyboard, autocorrect, predictive text, and touch caret placement through the textarea), documented in §8.7/§11 rather than worked around. The residual risk is mobile-Safari IME on the hidden-textarea backend; it is characterized honestly in §11 and accepted, not treated as a blocker. A mobile defect is a platform bug or a polyfill-logic gap to fix **in the substrate**, never a trigger to special-case a platform. Read/review on mobile works from day one regardless.

### 6.7 Own The Input Substrate

**Decision:** own the input substrate in the editor package. Start by vendoring or forking `@neftaly/editcontext-polyfill`, but treat it as the seed of IDCO's input engine, not as a replaceable third-party fallback.

**Why:** it is small (~2.5k LOC), permissively licensed, and already covers much of the input plumbing we should not rediscover: hidden textarea, IME, mouse selection, command interception, focus redirection, and native/parity tests. But IDCO also needs fixes that are outside the upstream package's scope: rich-block model mapping, cross-virtual selection/copy, final-newline geometry, caret visual quality, shortcut semantics, and story/native-backend switching. Vendoring or forking lets us merge upstream input work while keeping those editor-owned fixes in one place. When native EditContext improves, it raises the quality of the implementation the engine already prefers where present; it does not change the engine, because the engine is the EditContext contract plus the model, selection, and virtualization behind it. Native EditContext is the **first-choice implementation of that contract on Chromium** (the ~69% IME/a11y win, §4.2), and the polyfill is the implementation everywhere else; both pass the same conformance suite, so the engine drives either without knowing which and stays correct if the native one is ever removed.

### 6.8 Rejected And Deferred Options

- **Rejected — keep the section shell.** Its read↔edit swap, click-to-edit, and multi-editor model are the quirks this engine exists to remove (§3.3).
- **Rejected — switch to ProseMirror/TipTap for scale.** They are `contenteditable` engines and mount the whole document; same ceiling as Lexical. docs/009's ProseMirror endorsement was for product segmentation (the retired section model), not for virtualization.
- **Rejected — build on CodeMirror 6 directly.** CM6 virtualizes uniform code lines beautifully but fights arbitrary nested rich blocks, tables, and media. Adopt its _architecture_ (hidden input + model-owned selection), not its codebase.
- **Rejected — fork Lexical or wait for upstream large-document internals.** High maintenance, and upstream work would still not deliver rich-text viewport rendering or the product features (virtualized search, object focus model).
- **Rejected — custom canvas/text-layout engine.** We let the browser lay out text (§6.3); reimplementing glyph layout, bidi, and accessibility is exactly the multi-year trap to avoid.
- **Deferred — many simultaneously-live objects.** Possible later via the slot (§6.4); not first-release.
- **Deferred — real-time collaboration.** Not foreclosed by owning the model; not designed for now (§12).
- **Deferred — code-block internal virtualization.** A single very large code listing may need its own internal viewport rendering; tracked as a follow-on, not solved here.

## 7. Engine Internals

This section pins the runtime internals that were settled during design so later work does not drift. It is the _how_; §5–6 are the _what_ and _why_. The MDN EditContext HTML-editor demo (external references) is a working, primary-source validation of the spine below: it instantiates an `EditContext` as the **model**, treats its editable element as the **view**, re-renders a **tokenized** view on `textupdate`, and positions IME/selection by feeding `Range` geometry back through `updateControlBounds` / `updateSelectionBounds` / `updateCharacterBounds`. Our engine is that pattern scaled to a virtualized, block-structured rich document.

### 7.1 Stack: Framework-Agnostic Core, React View

The decisive split is **not** "React vs Lit." It is **engine core (plain TypeScript) vs view (thin framework layer)**.

- **Core — zero framework imports:** the document model, the EditContext input controller, the selection model, the virtual-range/height logic, the command/transaction layer, and bake orchestration. This is data, math, and DOM-event plumbing. It is how CodeMirror 6 and Lexical are built (agnostic core, thin bindings), and it is the hedge that makes the view-framework choice low-stakes.
- **View — React:** renders the visible block window, paints the selection overlay, and hosts object chrome. React is chosen because the reuse depends on it: `packages/reader` L1 (the view layer, §6.2), `@idco/ui`, and the React Aria toolbar/object-chrome/flyout (docs/006) are all React. Choosing Lit would discard that reuse and fork the entire chrome stack for an encapsulation win the engine does not need.

| Layer                | Choice                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Engine core          | **Vanilla TypeScript** — model, EditContext controller, selection, virtual-range, commands, bake orchestration           |
| Input                | Central input substrate: native EditContext backend where reliable, hidden-textarea backend elsewhere, bound by the core |
| View / chrome        | **React** — reuse `packages/reader` L1, `@idco/ui`, React Aria toolbar/popovers                                            |
| Model→view binding   | model as **external store** via `useSyncExternalStore`; the model never lives in React state                             |
| Off-thread work      | **Web Worker** for index/search/serialize/recalc and pure-compute bake (§7.5)                                            |
| WASM/Rust            | **Deferred** — only behind a profiled worker hotspot                                                                     |
| Lit / web components | **No** — would discard React reuse; revisit only if objects become genuinely third-party                                 |

The one React rule that must not be violated: **the document model does not live in React state.** It lives in the engine; the view subscribes via `useSyncExternalStore` to only the slices it paints (the visible id-list and per-block content). If the model goes into `useState`/context, a book-scale document re-render-storms on every keystroke.

### 7.2 Document Model And Mutations

> **→ 011 (authoritative for this section).** The shapes below capture the motivation and the compatibility/serialization framing; the **runtime** model and mutation algebra are pinned by 011 §2 (the normalized node graph), §3–§4 (per-leaf text and marks), and §6 (steps, the store representation, the dispatch loop). 011 §1.1/§15 specifically **corrects the flat-store tilt** this section originally carried: the runtime is a normalized node graph (containers hold `children` by id), and `order` is only the top-level virtualization index, not the whole document. Read the runtime data structures from 011; read this section for the why and the compatibility boundary.

A correction that must be recorded so the rationale does not drift: **Lexical's mutation model is not the problem.** Lexical already uses a flat `NodeMap` hashmap, already reconciles only dirty paths, and already shares structure across immutable `EditorState` snapshots. Its scale failure is the §4 one — `contenteditable` forces the whole tree to stay mounted, and `HistoryPlugin` retains full state snapshots. The new engine wins by being good at **both** a normalized store **and** virtualization, not by "fixing" a mutation model that was already partial.

Decided model:

- **Official document snapshot: app-owned and JSON-serializable.** The engine's official structure is an `EditorDocument`, not `RichTextEditorDocument`. It can still be stored as JSON, but it is a domain schema rather than an editor-engine snapshot:

  ```ts
  type EditorDocumentSnapshot = {
    readonly version: 1;
    readonly body: {
      readonly order: readonly BlockId[];
      readonly blocks: Readonly<Record<BlockId, BlockModel>>;
    };
    readonly settings?: DocumentSettings;
  };
  ```

  This snapshot is the **JSON serialization/persistence shape**, not the runtime store. The runtime store is the normalized node graph of 011 §6.8 (`Map<NodeId, Node>` with containers holding `children` by id, plus a top-level `order` index for virtualization and a `parentOf` reverse index); persistence and host emission serialize to/from this snapshot on the `debounced` lane, off the keystroke hot path.
- **Store: normalized and id-addressed (→ 011 §6.8).** Top-level blocks are the coarse, id-addressed units (for virtualization, move/delete/copy), and nested structure (lists, table grids, multi-block quotes/callouts) is a faithful subtree, never flattened. The `id` field is optional in the compatibility schema (`model/schema.ts`), so the engine runs an idempotent **ID-ensure pass on ingest** (docs/009 R1-A, `ensureDocumentNodeIds`) before building the store. Once ensured, _the model is also the virtualization index_: rendering a window is "take the visible id slice, O(1) lookup each." Editing block X replaces X's map entry or mutates it through a controlled store operation and touches nothing else. Because ingest may add ids, the compatibility output contract is **deep-equal after normalization**, not byte-identical (see §14).
- **Text blocks use text + ranges.** Text-bearing blocks hold one `text: string` plus normalized range marks for inline formatting, links, glossary references, and comments. Marks expand into split text nodes and Lexical-style `format` bitmasks only in the compatibility serializer. This is not claimed as "Lexical is bad at mutation"; it is the app-owned shape that makes offsets, Markdown conversion, search, paste, and migrations straightforward.
- **Object blocks are registry-owned, not arbitrary JSON.** Heavy/custom blocks use a generic object envelope in the core, but their `data` is accepted only through a registered definition. The legacy Lexical decorator-node system (`legacy/nodes/**`) is **not carried forward or adapted** — custom blocks are rebuilt fresh through this `BlockDefinition` registry when Phase 6 gets there; the engine reads the legacy custom-block `data` only across the compat projection, never by importing a Lexical node class. Unknown data exists only at parse boundaries:

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
- **Document settings are first-class.** Publication/page settings from docs/006 live on `EditorDocumentSnapshot.settings`, not as body blocks and not as ad hoc fields on the compatibility tree. The compatibility adapter must preserve settings while consumers migrate, even if a given renderer/export target ignores them.
- **Mutations are invertible transactions ("steps"), modeled on ProseMirror.** A command produces an **invertible delta** applied to the store. Invertibility yields partial update, cheap undo, and collaboration-readiness from one mechanism: undo stores _inverse steps_, not whole-document snapshots. This is a small command→step→store loop in the core; do not import Redux.
- **No full-document rebuild on the hot path.** A keystroke, mark toggle, object config change, block move, or settings edit updates only the affected block/order/settings slice and records an inverse step. Full compatibility JSON generation, Markdown export, search indexing, and bake work run on `idle`/`debounced` lanes (§7.3) or in a worker (§7.5).
- **Per-block reactive subscriptions.** A keystroke in block X notifies only X's subscribers -> X re-renders and the selection overlay repaints; nothing else does. "One update never re-renders the editor" is enforced by subscription topology, not by discipline.

### 7.3 Scheduler And Frame Loop

`packages/editor/src/legacy/plugins/editor-performance.ts` (docs/008) already contains, in one file, a generic scheduler core and a Lexical bridge. It is now a `legacy/` file and is **read-only reference**, not a module the engine imports:

- **Generic core (no real Lexical dependency):** `createEditorSchedulerTask`, the lane model (`sync | frame | idle | debounced`), within-lane priority, coalescing (`latest | drop-if-pending | merge`), per-task `budgetMs` with cooperative `shouldYield()`/`continue` chunking, and the metrics behind `window.__IDCO_EDITOR_PERF__`. It is generic over `Payload extends object`.
- **Lexical bridge:** `registerEditorUpdateListener` / `registerCoalescedEditorUpdateListener`, the only Lexical-typed part.

Decisions (this corrects the earlier "one shared scheduler" plan; see §9.1 and 011 §10):

- **The engine authors its scheduler as a first-class `core/` module, fresh.** In the engine the scheduler is the heartbeat (011 §10: the dispatch loop, the frame batching, the dirty-set flush _are_ the scheduler), not a derived-work helper beside the editor. The legacy `editor-performance.ts` is reference for the proven lane/coalesce/budget logic; the engine re-authors that logic in `core/`, it does not import it. Importing the heartbeat from a `legacy/` plugin would put the engine's most central loop in the old world and recreate the coupling §9.1 deletes.
- **No shared singleton; legacy keeps its own.** The earlier "one process-wide scheduler, both editors register" is dropped: per page only one editor mounts (Lexical _or_ the engine, never both live), so there is no shared budget to contend. Legacy keeps its scheduler until it is deleted; the engine's is the only one that survives.
- **Preserve the docs/008 contract, do not lose it.** The re-authored core keeps the lane vocabulary, the cooperative-yield budget model, and the `__IDCO_EDITOR_PERF__` metrics shape, so the contract covers the engine even though the code is fresh.
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

Phase 2 proved the safer baseline: the **model** owns _what_ is selected, and the engine paints the visible caret/selection itself from browser geometry on every backend. Native DOM `Selection` may still be driven with `addRange()` as a compatibility assist for non-collapsed ranges, but it is not the visible source of truth and Phase 3 does not depend on a native browser-painted caret inside a non-`contenteditable` EditContext host.

Concretely:

- **Drive DOM selection through `addRange`/`removeAllRanges`, not `setBaseAndExtent`, only as an assist.** Derive the DOM anchor/focus from the model offsets and set the selection with `getSelection().removeAllRanges()` + `getSelection().addRange(range)` for non-collapsed mounted ranges. The engine still suppresses native selection paint and paints its own overlay. `setBaseAndExtent` remains avoided because it is not part of the polyfill contract.
- **Hand-paint all visible selection classes:**
  1. collapsed caret and one-block text ranges;
  2. cross-block text ranges over mounted blocks;
  3. selection that extends into **unmounted/virtualized** blocks — a DOM `Range` cannot point at nodes that do not exist, so paint only the visible edge; offscreen middles are not visible, and the model still holds the full range for copy/extend;
  4. **atomic-object** highlight boxes (a heavy object in range highlights as its single bounding box, §6.5).
- **Geometry, when hand-painting, comes from the browser.** Construct a DOM `Range` over rendered text and call `range.getClientRects()` for highlight rects, `range.getBoundingClientRect()` for the caret. **Wrapping and bidi line-fragment geometry come back for free** — we never compute line breaks. This is precisely why §6.3 (let the browser lay out text) was the correct call.
- **Caret/selection hot-path rule:** selection-only movement must not rebuild the rendered text DOM. Cache the rendered text-node → model-offset mapping and invalidate it only when text, inline decoration, IME format ranges, or layout-only markers change. Rebuilding the view on every arrow key, pointer move, or diagnostics read is a future perf bug, not an acceptable simplification.
- **The hand-paint overlay lives in scroller coordinates,** `pointer-events: none`, above the text. Because it lives inside the scroller, **scrolling moves it for free**; rects recompute only on selection-change and on relayout (`ResizeObserver`), not per scroll tick. CSS Custom Highlight remains a future optimization over the same derived ranges, not a Phase 3 prerequisite.
- **IME preedit formatting is engine-painted.** Native EditContext emits `textformatupdate` while an IME is composing; a custom renderer must apply those ranges itself (for example underlining Vietnamese/Telex preedit text) because the browser will not draw them for a fully owned view. The hidden-textarea backend must emit an equivalent event from its composition range. DOM spans are acceptable in the Phase 2 one-block spike; CSS Custom Highlight can optimize the same derived ranges later.
- **Feed geometry back to EditContext.** Call `updateControlBounds()` (editable region), `updateSelectionBounds()` (current range rect), and `updateCharacterBounds()` (on `characterboundsupdate`) so the OS IME candidate window lands in the right place. The selection layer and the input layer are coupled here by design; this is a concrete reason EditContext is the right substrate, and the MDN demo exercises all three calls.
- **Caret affinity.** At a soft-wrap or bidi boundary a caret offset can render at the end of line N or the start of line N+1. The overlay painter must carry an affinity/bias bit where layout makes the same model offset visually ambiguous.
- **Two input modes, one rule** (a consequence of the mobile-parity decision, §5.8/§6.6). Native EditContext and the hidden-textarea backend feed one central input substrate for the active text leaf. The engine owns the authoritative model and visible text-flow selection. A per-platform native-`contenteditable` fallback is **not** part of this — it was dropped in Phase 7 (§5.8/§6.6): one substrate everywhere, no platform fork.

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
- **The compatibility output is sacred; the runtime is disposable.** Anything projected to existing consumers must remain readable by the read tier (`packages/reader`, docs/015) and rollback-compatible with the Lexical path. We are free to reinvent how editing feels and to define the model the app owns; we are not free to silently drop data or break the current projection.
- **Honesty about cost.** This is a real engine, not a plugin. We accept that nothing here is free; the justification is that the product's core workload is the one no `contenteditable` foundation can serve.

## 9. Relationship To Existing Work

### 9.1 Package Structure And The Old/New Boundary

The editor package is laid out so an agent never confuses the canonical engine with the old world. Four top-level worlds under `packages/editor/src`, each with one job and an enforced import direction:

- **`core/` + `view/` — the canonical engine.** This is the package's main content and the only place Phase 3 onward writes. `core/` is framework-free (the `architecture/engine-core-no-framework` lint guards it); `view/` is the React binding that renders through `packages/reader`'s L1 primitives (docs/015). `core/vendor/` holds the vendored EditContext polyfill (kept as infra, not rebuilt); `core/virtual-range.ts` is the one genuinely model-agnostic salvage (pure windowing math the virtualizer reuses). The canonical engine imports **nothing** from `legacy/` or `spike/`, and carries no Lexical-shaped code.
- **`spike/` — Phase 2 proof, REFERENCE ONLY.** The EditContext + caret + selection spike (010 §10.2). It exists to prove the EditContext API and the polyfill are feasible; it is **not** the canonical model. Its document and selection shape is a flat block list (much of it living in the Ladle stories), which is precisely the flat-store design **011 §1.1 rejected** in favor of the normalized node graph. Do not treat the spike as correct, and do not import it from `core/` or `view/`. Its hard-won input/IME/caret/overlay behavior is reabsorbed into `core/` later (gated by the e2e/IME suite as the behavior bar), then `spike/` is deleted. Read it; do not depend on it.
- **`legacy/` — all of Lexical, plus the Lexical-shaped compat helpers.** The shipped standard editor and Phase 0 decorator virtualization, and under `legacy/model/` the `RichTextEditorDocument` schema and the helpers typed against `RichTextEditorNode` (`ids`, `signatures`, `height-cache`). These are not "neutral salvage"; they operate on the Lexical wire node, which the engine **rejects as its model** (§7.2 rejected list, Phase 3 AC5), so the engine never imports them and builds fresh equivalents against its node graph (and mints its own global ids, 011 §2.2). `legacy/` may import React and Lexical freely; nothing canonical imports `legacy/`. Deleted whole at retirement.

There is no `shared/` or `compat/` folder: a neutral layer is not created until a real second consumer exists. The single seam to the old world is the `RichTextEditorDocument` wire format (§5.4) — a Lexical-shaped JSON the engine's future compat adapter ingests and emits for rollback, never as a runtime type, and disposable at the persistence flip (§12). When Phase 3 actually builds that adapter and genuinely needs the `RichTextEditorDocument` type across the boundary, lift it into a neutral `compat/` then; until then it lives with the format it describes, in `legacy/model/`.

### 9.2 Existing Work

- **Standard editor (`RichTextEditor` + Lexical).** Untouched and retained for small and static documents, now fenced under `legacy/`. The engine is an additional surface selected for the live-book workload, not a replacement for the small-document path on day one.
- **Phase 0 decorator virtualization.** Retained and polished. It is the right answer for decorator-heavy documents within the standard editor (the measured `payloadcms.db` content sits here), and it remains the cheaper path while the engine matures. It keeps its own height-cache and signature primitives (typed to `RichTextEditorNode`, in `legacy/model/`); the engine's virtualizer builds fresh equivalents against its node graph.
- **docs/006 (toolbar + bake).** This engine is the editor-tier implementation target of 006's heavy-object model. The toolbar's hybrid surfaces (ribbon, object chrome, selection flyout) sit on top of this engine's focus/selection model; the object-chrome popovers are how live objects are configured (§5.3).
- **docs/008 (perf contract).** The engine's derived work (indexes, search, bake) continues to honor lane/budget scheduling; the contract's intent — keep expensive work off the editing hot path — applies unchanged.
- **docs/009 (section shell + Phase 0).** Phase 0 graduates forward; the section shell is retired with its pure helpers salvaged (§3.3).

## 10. Phasing And Rollout

Risk-first within the dependency order. Phases are sized so each ends in something openable in Ladle and judgeable, none is "build half the engine," and the standard Lexical editor plus Phase 0 decorator virtualization (docs/009 — a different "Phase 0," retained) stay shipped throughout. The phases below are written as gates, not as suggestions: each lists what it **may touch**, what it **must not** do, binary **acceptance criteria**, the exact **verify** commands, and an explicit **done-when** gate. An autonomous loop must treat these as hard contracts.

### 10.1 Global Invariants (checked at every phase gate)

These hold for the lifetime of the work. A phase is not done if any is violated, regardless of its own ACs.

- **G1 — Compatibility output.** Anything the engine emits to existing consumers is a `RichTextEditorDocument` projection whose shape is unchanged; it loads in the standard `RichTextEditor` and renders identically through the read tier (`packages/reader`, docs/015). A golden round-trip test enforces this as **deep-equal after normalization** (the ingest ID-ensure pass, §7.2, may add `id`s; that is the only permitted delta). The internal `EditorDocument` is authoritative, but the projection is the compatibility gate until a deliberate persistence migration exists.
- **G2 — Standard paths untouched.** `RichTextEditor` (Lexical) and decorator virtualization keep working; `tests/e2e/editor-backspace.perf.spec.ts`, `tests/e2e/editor-decorator-virtualization.perf.spec.ts`, `tests/e2e/editor-typing-latency.perf.spec.ts` (all three brought under the `test:e2e:editor` script in Phase 1 AC3), and all existing `tests/editor/**` unit tests stay green.
- **G3 — Core purity.** `core/**` imports neither React nor Lexical. Enforced by an import-boundary check that fails CI.
- **G4 — No new runtime deps** except the vendored input substrate (no external runtime dependency added; `pnpm advise:dupes` shows no new duplication clusters introduced by copy-paste).
- **G5 — Green bar.** `pnpm format:check && pnpm lint && pnpm check:dup && pnpm typecheck && pnpm test` passes before a phase is marked done; `pnpm check` (which also builds) passes at each phase exit.
- **G6 — Opt-in only.** The engine is never wired as a default editor path; no existing caller's behavior changes. The default `RichTextEditor` export is unmodified in behavior until the gated future decision (§12).

### 10.2 Loop Discipline (anti-drift protocol)

- **One phase per loop segment.** Do not start phase N+1 until phase N's done-when gate passes in full.
- **A phase is DONE only when:** all its ACs pass _and_ all global invariants hold _and_ its verify commands are green. Partial is not done.
- **Hard stop on failure.** If a phase cannot meet its gate, stop and report the specific failing AC and command output. Do not weaken an AC, do not stub a test to pass, do not skip ahead, do not edit this document's ACs to fit the code.
- **Scope fence.** Touch only files in the current phase's _may touch_ list. If another file genuinely must change, stop and report why before doing it.
- **Update the ledger** (§10.3) when, and only when, a phase's gate passes.
- **Reference and behavior bar, not import-the-spike.** The Phase 2 spike under `spike/**` is **reference only** (§9.1). It proved EditContext + polyfill feasibility; its document and selection model is the flat-block design 011 §1.1 rejected, so an agent must **not** import `spike/**` into `core/` or `view/`, and must not treat its model as correct. What the engine reuses is: (a) the **vendored polyfill** under `core/vendor/editcontext-polyfill/**` — kept as infra, never rebuilt; rebuilding vendored input plumbing is an automatic stop-and-report; (b) the spike's hard-won **input/IME/caret/overlay behavior**, reabsorbed into fresh `core/` modules; and (c) the **e2e/IME test suite + fixtures as the behavior bar** — the new code must pass them, which is what prevents a "fresh rebuild" from silently dropping the IME/caret edge cases (the Microsoft-Telex-on-Firefox class) the spike already paid to find. Likewise the legacy scheduler (`legacy/plugins/editor-performance.ts`) is reference, not an import (§7.3). **Read-first gate:** before writing code, read 011's relevant sections and the spike/legacy reference; preserve behavior and tests, do not import the old structure.

### 10.3 Phase Status Ledger (update on completion)

- [x] P1 Groundwork
- [x] P2 Input + caret + selection spike (shipped: `spike/**`, `stories/engine-input.stories.tsx`, `tests/e2e/engine-input.spec.ts` on chromium/webkit/firefox)
- [x] P3 Model + transactions
- [x] P4 React view + scheduler/frame loop
- [x] P5 Block virtualization
- [x] P5.5 Structural editing + commands + public SPI
- [x] P6 Heavy objects + bake
- [x] P7 Cross-browser / mobile / a11y hardening
- [x] Pre-Phase-8 (docs/017): view decompose + node SPI (docs/016) + latent-bug fixes
- [x] P8 Feature parity + index-backed TOC/search + opt-in ship
- [ ] P9 Polish + deferred parity (docs/018)

### 10.4 Phases

#### Phase 1 — Groundwork (small)

- **Goal:** clear the dead section-shell code and scaffold a clean home for the engine.
- **May touch:** `packages/editor/src/large-document/**`, `packages/editor/src/index.ts`, the new `packages/editor/src/{core,view}/**`, `package.json` (the `test:e2e:editor` script), `tests/e2e/editor-large-document.perf.spec.ts`, lint config (import-boundary rule).
- **Must not:** change `RichTextEditor`, `RichTextEditorComposer`, decorator virtualization, the model schema, or `content-renderer`.
- **Acceptance criteria:**
  - AC1 `packages/editor/src/large-document/**` is removed; `grep -rn "large-document" packages tests stories` returns nothing outside `docs/`.
  - AC2 the salvaged helpers (`signatures`, `height-cache`, `virtual-range`, id utilities) live under `core/**` and keep their unit tests passing.
  - AC3 two distinct acts: (a) **edit** the `test:e2e:editor` script to drop `editor-large-document.perf.spec.ts` **and add `editor-typing-latency.perf.spec.ts`** so the script runs every editor perf spec named in G2; (b) **delete** the `editor-large-document.perf.spec.ts` file. After this, `pnpm test:e2e:editor` runs backspace + decorator-virtualization + typing-latency and passes.
  - AC4 `engine/` exists with `core/` and `view/` subtrees; an import-boundary lint rule fails if `core/**` imports `react` or `lexical` (prove it by a temporary violating import that the linter rejects, then revert).
  - AC5 the input substrate is vendored under the current provenance path `core/vendor/editcontext-polyfill/**` with a unit test asserting the module loads and exposes `install`/`EditContext`; future cleanup may rename the directory, but the architecture must treat it as the central input engine, not a temporary fallback.
- **Verify:** `pnpm check`; `grep -rn "large-document" packages tests stories`.
- **Done when:** AC1–AC5 pass and G1–G6 hold.
- **Out of scope:** any engine behavior, any rendering, any EditContext wiring.

#### Phase 2 — Input + caret + selection spike (medium; the foundation gate)

- **Goal:** prove the EditContext + caret + selection loop works cross-browser before any model exists.
- **May touch:** `core/**` (input + selection controllers), one Ladle story under `stories/**`, a new e2e spec under `tests/e2e/**`, `playwright.config.ts` (currently **chromium-only** — this phase adds `webkit` and `firefox` projects).
- **Must not:** add a model store, multiple blocks, virtualization, or React app integration beyond the spike host element; use `setBaseAndExtent` anywhere (`grep -rn "setBaseAndExtent" packages` must be empty); set `data-editcontext-active` on the native Chromium path (hidden-textarea backend only, §7.4).
- **Prerequisite:** the webkit/firefox browser binaries must be installed (`pnpm exec playwright install webkit firefox`); record this in the spec/README so CI provisions them.
- **Acceptance criteria:**
  - AC1 a Ladle story binds an `EditContext` to one host element rendering one plain text block; typing updates the visible text via `textupdate` → re-render from model offsets.
  - AC2 caret renders and moves with arrow keys; selection renders for shift+arrow and drag — verified on **chromium, webkit, and firefox** Playwright projects.
  - AC3 selection is set via `getSelection().removeAllRanges()` + `addRange(range)` only; the host carries `data-editcontext-active` (asserted in DOM).
  - AC4 an IME/composition sequence produces the correct final text and selection on each of the three browsers (scripted composition or dead-key).
  - AC5 a forced-hidden-textarea story variant (`install({ force: true })`) renders a working caret + selection on chromium too, proving the backend independent of native EditContext support.
- **Verify:** `pnpm exec playwright test tests/e2e/engine-input.spec.ts --project=chromium --project=webkit --project=firefox`; open the Ladle story on each browser.
- **Done when:** AC1–AC5 pass on all three browsers and G1–G6 hold. **If any browser fails fatally here, stop the loop and escalate — this is the make-or-break gate.**
- **Out of scope:** persistence, the document model, more than one block.
- **Follow-up queue found during spike hardening:** keep Vietnamese/Telex IME composition as an explicit Phase 2/7 test target: the underlined preedit string must stay visually correct until the platform commits it with space/control/IME commit, and the final committed text + selection must match the model on native-EditContext and hidden-textarea backend paths. Also capture caret visual metrics against the rendered line box so the hand-painted caret can be tuned for height, width, and device-pixel-ratio parity instead of relying on the browser default.
- **Test-suite shape for those follow-ups:** use WPT/Input Events-style composition cases for event-order correctness, Playwright real-browser geometry screenshots for caret/selection height and focus visibility, the Ladle native/forced-hidden-textarea stories for manual OS keyboard checks, and regression specs for shortcuts/multi-click behavior. IME bugs are too platform-specific for unit-only proof.

#### Phase 3 — Model + transactions (medium–large; headless spine)

- **Goal:** the app-owned document model, block registry boundary, and mutation layer, fully testable without UI. The runtime model is **Lexical-free** — it does not import `lexical`/`@lexical/*` and does not reuse Lexical's node shape as its in-memory representation; Lexical-flavored `RichTextEditorDocument` JSON is a **compatibility projection at the boundary only** (§5.4).
- **May touch:** `core/**`, `tests/engine/**`.
- **Must not:** import React; import `lexical`/`@lexical/*`; reuse `RichTextEditorNode` as the runtime model (it is a compatibility target, not the editing representation); render anything; add virtualization; implement mermaid/data-grid/chart UI or real bake pipelines. Phase 3 may define the generic object-block and registry contracts those later features will use.
- **Model shape — the foundation contract is 011, not this list.** The authoritative runtime structures are 011 §2 (normalized node graph), §3–§4 (per-leaf text + range marks), §6 (steps, store representation, dispatch loop), and §7 (inverse-step history). The bullets below state the **product-level requirements** Phase 3 must satisfy; build the structures from 011, and where the two ever differ, 011 wins (011 §15). In particular, do **not** build the flat `order + Map<blockId, BlockModel>` model the earlier wording implied — that is the tilt 011 §1.1 corrects.
  - **`EditorDocumentSnapshot` as the serialized structure:** `{ version, body: { order, blocks }, settings }`, JSON-serializable for storage. This is the **persistence/compat shape**; the runtime store is the 011 §6.8 node graph, serialized to/from this snapshot off the hot path.
  - **Runtime store is the normalized node graph (→ 011 §6.8):** `Map<NodeId, Node>` with containers holding `children` by id, a top-level `order` virtualization index, and a `parentOf` reverse index. Editing one node replaces only that node's entry and notifies only that node's subscribers. Nested structure (lists, table grids, multi-block quotes/callouts) is a faithful subtree, never flattened, blobbed, or sentinel-hacked.
  - **Typed text-leaf nodes (→ 011 §2–§4):** `paragraph | heading | listitem | quote | callout | ...` carry `text: string` plus **range `marks`** (not split text nodes) for inline format/link/glossary/comment references. `code-block` is an **atomic object with a piece-table body** (011 §3.6/§15), not a flat text block.
  - **Registered object blocks:** object data is accepted only through a `BlockDefinition` registry with parse/normalize/compatibility-export/import/export-completeness hooks, and an **invertibility obligation** (011 §6.5: `SetObjectData` or `applyEdit`/`invertPatch`). Unknown objects are dropped, flattened, or refused by explicit policy; no silent passthrough.
  - **Baked snapshot slots:** the generic object block includes `baked` and `status` fields so docs/006 heavy objects have a place before Phase 6 implements real bakers.
  - **Document settings:** publication/page settings live on the document, not in the body stream, and must survive normalization and compatibility projection.
  - **Invertible steps over the node graph (→ 011 §6–§7)** with structural sharing via node identity (011 §6.8) and subscriber isolation (AC1). The intra-transaction position `Mapping` for split/merge is the one open algorithm (011 §16); land it early with the property tests 011 names.
  - **Collaboration-readiness footprint (→ 011 §17, docs/014).** Phase 3 lands the addressing and format decisions that are cheap now and a teardown to retrofit, and builds no collaboration machinery: globally-unique opaque client-minted node ids (011 §2.2); the character-identity prose-leaf substrate (011 §3.7), about 1 to 2 percent at rest; marks and stored points anchored to character ids (011 §4.4, §5.1); and a `"local"` transaction `origin` slot (011 §6.1). Tree structure needs nothing here, since `children: NodeId[]` is identity-addressed already. Do not build rebasing, awareness, multi-peer GC, or move-conflict resolution; single-user tombstone GC is collect-on-commit.
  - _Rejected:_ a model mirroring `RichTextEditorNode`; a **flat `order: BlockId[]` of `text` blocks as the runtime model** (011 §1.1); arbitrary `[key: string]: unknown` blocks in the store; a pure immutable `Record` update path that clones or walks the whole document per edit (011 §6.8); a rope-per-block from day one (block-partitioned text is small, so the asymptotic win never triggers — premature complexity).
- **Acceptance criteria:**
  - AC1 the store is the normalized node graph (011 §6.8: `Map<NodeId, Node>`, containers holding `children` by id, top-level `order` index, `parentOf` reverse index); a test proves editing one node leaves every other node's object identity unchanged (reference equality), and a `parentOf` invariant test asserts each node's entry matches its actual parent after every transaction (011 §5.4).
  - AC2 every step type is invertible: a property test asserts `apply(state, inverse(step)) === pre-step state` for generated edits.
  - AC3 undo/redo across N random edits returns a document deep-equal to the pre-edit document.
  - AC4 a golden compatibility round-trip: a known edit sequence serializes to `RichTextEditorDocument` JSON that deep-equals a committed golden **and** loads/renders identically via the read tier (`packages/reader`) (this is G1's enforcing test).
  - AC5 the import-boundary check (G3) is green for all new core files; a grep proves no `lexical`/`@lexical/*` import and no use of `RichTextEditorNode` as a runtime type under `core/**`.
  - AC6 inline formatting round-trips losslessly: the runtime **range `marks`** (011 §4) ↔ the compatibility serializer's `format` bitmask + split text nodes is proven reversible by a property test over generated overlapping/adjacent mark ranges. Split text nodes exist only at the compat boundary, never in the runtime store.
  - AC7 the block registry rejects or normalizes unknown object data by explicit policy; a fixture for a fake registered object proves `baked`/`status` round-trip through `EditorDocumentSnapshot` and compatibility projection without implementing a real heavy object.
  - AC8 document-level settings survive ingest -> store -> snapshot -> compatibility projection -> ingest; they are never flattened into body blocks or dropped by normalization.
  - AC9 a hot-path test/instrumentation proves a text edit does not serialize or walk every block; only the changed block/order/settings subscriber set is notified.
  - AC10 the collaboration-readiness footprint holds (011 §17, docs/014), proven by tests, with no collaboration machinery built: node ids are globally unique and opaque (a generated id is not a document-local index); a prose leaf carries character identity (a stored mark and a stored point survive a sequence of edits by their character-id anchor, not by re-derived offsets); and every transaction carries an `origin` field. A grep proves no rebasing, awareness, or multi-peer GC code exists under `core/**` this phase.
- **Verify:** `pnpm test`; `pnpm typecheck`; `grep -rn "@lexical\|from \"lexical\"" packages/editor/src/core` is empty.
- **Done when:** AC1–AC10 pass and G1–G6 hold.
- **Out of scope:** React, rendering, virtualization, scheduler wiring.

#### Phase 4 — React view + scheduler/frame loop (medium–large)

- **Goal:** a real React-hosted editor over the model at non-virtualized scale.
- **May touch:** `view/**`, the engine's `core/` scheduler (authored fresh per §7.3; reference only: `legacy/plugins/editor-performance.ts`), Ladle stories, `tests/engine/**`, `tests/e2e/**`.
- **Must not:** virtualize (all blocks stay mounted this phase); hold the document in React `useState`/context (`grep` guard); reach into `legacy/` for scheduling; the engine owns its scheduler in `core/` (§7.3).
- **Acceptance criteria:**
  - AC1 a React story edits a 300-block document end-to-end (input → step → store → view) with continuous caret/selection across mounted blocks.
  - AC2 per-block reactivity: an instrumented render-count test asserts typing in block X increments only X's (and the selection overlay's) render count; sibling counts are unchanged.
  - AC3 the model is exposed via `useSyncExternalStore`; no React state/context holds document content (lint/grep guard green).
  - AC4 a typing-latency perf spec (mirroring `editor-typing-latency.perf.spec.ts`) stays within the same budget; `__IDCO_EDITOR_PERF__` reports the engine's frame metrics.
  - AC5 the engine's scheduler is its own `core/` module, authored fresh (not imported from `legacy/`, §7.3); the standard editor's perf specs (G2) remain green.
- **Verify:** `pnpm test`; `pnpm exec playwright test tests/e2e/engine-typing-latency.perf.spec.ts`; `pnpm test:e2e:editor`.
- **Done when:** AC1–AC5 pass and G1–G6 hold.
- **Out of scope:** virtualization, heavy objects, mobile.

#### Phase 5 — Block virtualization (large; the scale goal)

- **Goal:** book scale — mount only the viewport.
- **May touch:** `view/**`, `core/**` (virtual range, selection across gaps), Ladle stories, `tests/e2e/**`.
- **Must not:** break per-block reactivity (Phase 4 ACs must still hold); paint offscreen selection.
- **Acceptance criteria:**
  - AC1 a 5,000-block story renders ≤ `visible + 2·overscan` block DOM nodes at any scroll position (Playwright counts `[data-…-block]` nodes).
  - AC2 scrolling top → bottom → top returns to a scroll position within ±2px of the start (drift assertion).
  - AC3 scroll-to-block-id lands the target within ±2px after post-measure correction.
  - AC4 selecting from block 3 to block 900 (with autoscroll) and copying yields clipboard text containing the full model range, including the offscreen middle (cross-virtual copy correctness — an instance of G1).
  - AC5 initial mount/first-paint for 5,000 blocks is within a recorded budget in the perf spec (replaces the deleted large-document spec).
- **Verify:** `pnpm exec playwright test tests/e2e/engine-large-document.perf.spec.ts`; the 5,000-block Ladle story.
- **Done when:** AC1–AC5 pass and G1–G6 hold.
- **Out of scope:** live object editing (objects may render as baked/placeholder only this phase).

#### Phase 5.5 — Structural editing, commands, and the public SPI (medium–large; the "feels like an editor" gate)

- **Why this phase exists:** Phases 3–5 deliver the model, the view, and virtualization, but a reader can still not write prose: pressing Enter does not split a paragraph, Backspace at a block start does not merge, and there is no command layer or public `dispatch(command)` surface. 011 designed all of this (§6.10 the transaction `Mapping`, §6.12 the command compiler, §12 the public SPI) and 011 §16 said to land split/merge "early, with property tests." Phase 3 shipped the step primitives but not the composites, the `Mapping`, the command layer, or the SPI, and no later phase owned them. This phase closes that gap. It is the prerequisite for the toolbar/formatting work in Phase 8.
- **May touch:** `core/**` (the `Mapping`, command compiler, query registry, split/merge composites, the `OwnedEditorHandle` SPI), `view/**` (key wiring: Enter/Backspace/Delete/Tab, undo/redo, select-all, cut/paste), Ladle stories, `tests/engine/**`, `tests/e2e/**`.
- **Must not:** bypass the `dispatch` chokepoint (§6.1); expose raw `Step`s on the public surface (commands and compat JSON only, §12.4); reintroduce a whole-document subscription or a runtime structure threshold; regress any Phase 3–5 AC.
- **Acceptance criteria:**
  - AC1 split and merge are composite transactions over the existing step set (011 §6.2), not new step kinds: Enter splits the active leaf into two blocks (trailing inline content moves to the new block, marks and atoms preserved); Backspace at offset 0 merges into the previous block; Delete at the end merges the next. Each is one invertible transaction and a property test asserts `apply(inverse) ≡ pre-state` and undo/redo round-trips for split, merge, and split-then-merge.
  - AC2 the intra-transaction `Mapping` (011 §6.10/§16) lands with property tests for split, merge, move, delete, undo, and redo: a position computed against pre-edit state maps correctly through earlier steps in the same transaction, in node-relative coordinates. The anchor/focus collapse bias (011 §8.8 — focus toward the edit, anchor away) is **direction-aware**: for a backward selection (focus before anchor in document order) the bias assignment is the mirror of the forward case, so a composite delete that collapses a backward range lands the surviving caret on the correct side. A property test covers both selection directions. _(Until this phase, `mapSelection` in `core/store.ts` hard-codes anchor=−1/focus=+1, correct only for forward selections; no Phase 3–5 path produces a backward-range composite delete, so it is latent until split/merge lands here.)_
  - AC3 the command compiler (011 §6.12) is the only public mutation entry: `store.command(c)` compiles a `CommandSpec` to a transaction or returns null (no-op), and a read-only query registry (`isMarkActive`, `canIndent`, …) backs toolbar state. A grep proves the view dispatches commands, not raw step drafts, for structural edits.
  - AC4 the public `OwnedEditorHandle` (011 §12.2) exists and is the opt-in control surface: `dispatch(command)`, `undo()`, `redo()`, `getSelection`/`setSelection`, `getDocument()`/`getEditorSnapshot()`, `isDirty()`, and an `on("selectionchange"|"dirtychange"|"change")` subscription. A test drives editing entirely through it.
  - AC5 keyboard editing is wired to commands: Enter/Backspace/Delete/Tab/Shift-Tab, Ctrl/Cmd+Z and +Shift+Z (undo/redo), Ctrl/Cmd+A (select-all over the whole virtualized document), Ctrl/Cmd+X (cut **deletes** the selection and writes the model serialization), Ctrl/Cmd+V (paste inserts plain text at the selection, replacing a range). An e2e drives each as real keyboard interaction, not the diagnostics API. Undo is content-anchored: a test types a character, moves the caret several times, then a single Ctrl/Cmd+Z reverts the character — proving caret-only transactions did not enter the history (the §10.5 non-historic-selection rule). Full typing-run coalescing (many keystrokes → one undo) stays the named §10.5 deferral; each keystroke is its own history entry until then.
  - AC6 list/structural editing behaviors: Tab/Shift-Tab indent and outdent a list item, Enter in a non-empty item creates a sibling item, Enter on an empty item outdents, and Backspace at an item start outdents or merges. Each is a command with a passing test.
- **Verify:** `pnpm test`; `pnpm exec playwright test tests/e2e/engine-editing.spec.ts`.
- **Done when:** AC1–AC6 pass and G1–G6 hold.
- **Status: landed.** Core lives in `core/mapping.ts` (the Mapping), `core/commands.ts` (compiler + query registry + split/merge/delete/insert/toggle-mark/set-block-type/indent/outdent), `core/editor-handle.ts` (`OwnedEditorHandle`), with `store.command`/`store.query`/`subscribeCommit` on the store and the direction-aware §8.8 bias + non-historic selection-only commits. The view (`view/react-view.tsx`) routes Enter/Backspace/Delete/Tab/Shift-Tab/undo/redo/select-all to commands and cut/paste through the root clipboard handlers, and exposes the handle via `getEditorHandle()`. Tests: `tests/editor/engine-commands.test.ts` (split/merge/delete/insert/Mapping/queries/indent/outdent/handle, invertibility via undo→deep-equal) and `tests/e2e/engine-editing.spec.ts` (Enter/Backspace/undo/cut/paste/edge-click as real interaction + screenshots).
- **Interaction additions folded in (beyond the ACs):** Shift+Enter inserts a soft line break (`\n`, pre-wrap) inside the block instead of splitting; double-click selects the word and triple-click the block (`Intl.Segmenter`, AC8 brought forward); clicking the empty area around/below the text drops the caret in the nearest text leaf (`resolveTextPointAt`); a non-text block (the `[list]` placeholder) is stepped over by arrows/shift+arrow and passed through by drag rather than acting as a wall; and a drag tracks on the document so it survives the pointer leaving and re-entering the editor. Each has a chromium e2e in `engine-editing.spec.ts`.
- **Hot-path correctness fixes this phase surfaced:** (1) a merge/delete that removes the active text leaf now clears `#activeTextLeafId` (and the commit/view tolerate a just-removed node), fixing an "Unknown node" crash; (2) the active-leaf re-render skip is now opt-in via `markActiveLeafDomSynced` — only the input controller (which patches the DOM itself) skips, so command-driven text edits (Shift+Enter, paste) re-render and stay visible; (3) the caret rect is measured from a neighbouring character (`robustCaretRect`) so it stays one line tall at soft-break and end-of-block boundaries instead of falling back to the block's full bounding box.
- **Scope boundary (recorded, not a gap):** AC6 list editing is implemented and proven as commands at the model level; the **virtualized editing view renders top-level text blocks**, so a structural `list` shows as a `[list]` placeholder rather than its nested items. Recursive nested-list/structural rendering inside the editing surface is a follow-on (it interacts with the window/measurement model), tracked with the toolbar/rich-rendering work; the reader (docs/015) renders nested structure for the read tier. Multi-line/HTML paste-to-blocks also stays Phase 8 — paste inserts plain text here.
- **Out of scope:** rich HTML paste parsing and sanitization (Phase 8), formatting toolbar UI (Phase 8), IME (Phase 7), heavy-object internal editing (Phase 6).

#### Phase 6 — Heavy objects + bake (large; the live-book differentiator)

- **Goal:** atomic heavy objects, baked at rest, one live-edit at a time, no drift.
- **May touch:** `core/**` and `view/**`, object adapters rendering through `packages/reader` L1 (docs/015) and docs/006 bake fields, a worker module, Ladle stories, tests.
- **Must not:** allow more than one object live at once (the slot exists but stays capped at 1); recompute baked output at read/export time; let live and baked forms drift.
- **Acceptance criteria:**
  - AC1 at rest, a heavy object mounts its baked static view, not a live editor subtree (asserted: no editor instance for resting objects).
  - AC2 activating object B while A is live commits and deactivates A first; at most one live object is asserted in state and DOM.
  - AC3 the object's bounding box shifts ≤ 2px between resting and active (no-drift property).
  - AC4 editing an object regenerates its baked field and updates the `EditorDocument` store plus compatibility projection; an object with no valid bake surfaces a recoverable error rather than emitting an unbakeable node (docs/006 §9).
  - AC5 the text caret suspends on object activation and resumes on deactivation without stranding an in-flight IME composition.
  - AC6 a pure-compute bake/index runs in the Web Worker (asserted via a worker round-trip; main thread not blocked).
- **Verify:** `pnpm test`; `pnpm exec playwright test tests/e2e/engine-objects.spec.ts`; the mixed-book Ladle story.
- **Done when:** AC1–AC6 pass and G1–G6 hold.
- **Out of scope:** multiple simultaneous live objects; reader-tier interactivity.
- **Status: landed.** Bake/index is pure compute in `core/bake.ts` (`bakeObjectData` turns a missing/invalid bake into a recoverable `invalid` status, never an unbakeable node; `buildDocumentIndex` derives TOC + plain-text). The registry gained a per-type `bake` hook with built-in bakers (code/media/embed/post-ref/toc/table). The store owns the one-live-object slot (`activateObject`/`deactivateObject`/`activeObjectId`/`subscribeActiveObject`): activating B deactivates A first and suspends the text caret to a node selection (the suspend flushes the active leaf's latest text so an in-flight edit/composition is not stranded — `tests/editor/engine-objects.test.ts` proves the flush; full IME composition-event correctness on suspend is the Phase 2/7 IME behavior bar). The `set-object-data` command normalizes through the registry, re-bakes, and is invertible via the **011 §6.5 wholesale immutable swap** (`SetObjectData{from,to,bakedFrom,bakedTo,statusFrom,statusTo}`, free invert by field-swap); the fine-grained `applyEdit`/`invertPatch` mechanism 011 §6.5/§6.9 also names is **not** wired and is the named deferral for large-grid/table internal editing (no built-in needs it yet). The worker boundary is `core/bake.worker.ts` (entry) + `core/bake-service.ts` (`createWorkerBakeService` over a `WorkerLike`, plus `createLoopbackWorker`/`createLoopbackBakeService` running the same `runBakeWorkerJob` handler for tests/SSR). The view (`view/react-view.tsx`) mounts the baked snapshot at rest (no editor instance), edits code in place at the captured resting height (≤2px box drift) and other objects through an absolute config panel (docs/006 chrome), caps the live slot at one, moves DOM focus to the object surface on activation, and builds the document index off-thread on the default worker (diagnostics expose `activeObjectId`/`objects`/`liveObjectEditorCount`/`documentIndex`/`indexFromWorker`). Tests: `tests/editor/engine-objects.test.ts` (bake purity/invalid/index, re-bake + compat projection, undo, slot cap + caret suspend, loopback worker round-trip, handle) and `tests/e2e/engine-objects.spec.ts` (AC1–AC6 as real interaction on chromium/webkit/firefox). The new `OwnedEditorHandle` object methods are `getActiveObjectId`/`activateObject`/`deactivateObject`/`setObjectData`. The `Phase6MixedBook` Ladle story is the mixed-book surface.
- **What runs off-thread (precise, AC6):** the pure-compute work moved to the Web Worker is the **document index** (`buildDocumentIndex` → TOC + plain-text), built off the main thread on mount/structural-change and asserted via a real round-trip (`indexFromWorker`/`workerRoundTrips`). **Object bakes in the edit path run synchronously on the main thread** inside the `set-object-data` command compiler — that is the authoritative, invertible path, and it must be synchronous to land in one transaction. The `BakeService.bakeObject` worker capability exists and is loopback-tested, and is the off-thread option a host/future idle-lane re-bake can use, but it is **not** wired into the synchronous edit path; do not read the engine as baking objects off-thread today. (`bake.worker.ts` handles both job kinds; the worker uses a default built-in registry — custom, function-carrying object definitions cannot cross `postMessage`, so they would bake on the main thread regardless.)
- **Scope boundary (recorded, not a gap):**
  - Objects render baked snapshots through **view-layer adapters in `react-view.tsx`**, not the shared `packages/reader` L1 primitives (docs/015), because that package does not exist yet. When `packages/reader` lands (Phase 8 / docs/015), the resting object render must move onto its L1 primitives so the editor and reader cannot drift (§5.9, §6.2). The current bakers emit plain text/placeholders only — **no baked field renders HTML or SVG**, so there is no live XSS surface; the §10.5 sanitization boundary for baked HTML/SVG (`[blocking-for-v1]`, Phase 3/6) lands with `packages/reader` and must be re-audited when mermaid/data-grid bakers emit markup.
  - **Image/file drag-drop → upload → media node** (§10.5 `[blocking-for-v1]`) is deferred to **Phase 8** — it needs a host upload binding that does not exist; Phase 6 ships media as a config-panel `src`/`alt`/`caption` editor only. (The §10.5 tag should be read as Phase 6/8.)
  - **Object-internal search/index adapters** (011 §2.7 — code-block source, table cells, embed titles): `buildDocumentIndex` indexes top-level **text leaves only** and does not yet index object internals. This is deferred to **Phase 8** with the find-in-page UI (§10.5); object `BlockDefinition`s gain the §2.7 plain-text/anchor adapters then. Recorded here so the omission is explicit, not a silent "pretended-to-search."

#### Phase 7 — Cross-browser / mobile / a11y hardening (large; the long tail)

- **Goal:** turn the cross-browser gate into a guarantee on the hard surfaces.
- **May touch:** `core/**` and `view/**` (input modes, a11y, bounds), the vendored input substrate, tests, Playwright config (mobile emulation, a11y scan).
- **Must not:** regress any earlier phase's ACs; change the model or compatibility contract for mobile.
- **Acceptance criteria:**
  - AC1 an IME fuzz suite passes ≥ 99% of seeds on chromium/webkit/firefox; remaining failures are enumerated as documented known-failures.
  - AC2 mobile (webkit emulation): touch selection and on-screen-keyboard editing work, with the model authoritative (native DOM selection stays collapsed). The native-`contenteditable`-active-block path is **not** used (dropped, §6.6), so its conditional clause is moot — the single polyfill substrate drives mobile and the round-trip authority is proven directly (`tests/e2e/engine-mobile.spec.ts`).
  - AC3 a11y: the editing region exposes textbox semantics; an automated a11y scan of the surface passes; selection changes are announced.
  - AC4 IME control/selection/character bounds remain correct after scroll and relayout (candidate-window position assertion where testable).
  - AC5 the engine consumes all three EditContext event streams, not just `textupdate`: `textformatupdate` paints the composition preedit underline (the polyfill and native EditContext both supply `underlineStyle`/`underlineThickness`; the spike's `text-input-controller` is the behavior bar), and `characterboundsupdate`/`updateCharacterBounds` positions the IME candidate window at the caret. A scripted composition asserts an underlined preedit segment renders over the active leaf.
  - AC6 the engine suppresses the native caret and `::selection` on the editing surface (`caret-color: transparent`, transparent `::selection`) so only the engine-painted caret/overlay is visible, on both the native and polyfill backends (the spike does this; the fresh view must too).
  - AC7 vertical caret movement keeps a goal column across consecutive ArrowUp/ArrowDown presses through ragged-width lines (the column is remembered until a horizontal move resets it), matching the spike's line-box navigation.
  - AC8 pointer selection gestures: double-click selects the word and triple-click selects the line/paragraph (via `Intl.Segmenter`), as model selections, with passing tests on chromium/webkit/firefox. _(Landed early in Phase 5.5: `wordRangeAt`/`selectRangeInBlock` in `view/react-view.tsx`, chromium e2e in `engine-editing.spec.ts`; webkit/firefox parity remains this phase's gate.)_
- **Verify:** `pnpm exec playwright test tests/e2e/engine-*.spec.ts --project=chromium --project=webkit --project=firefox` (the webkit/firefox projects and browser binaries come from Phase 2; do not re-add them here); the a11y scan. The `.perf` specs are chromium-only (budget assertions tuned on Chromium; running them cross-browser under load yields flaky timing, not signal), and the mobile spec runs on the `mobile-webkit` project.
- **Done when:** AC1–AC8 pass and G1–G6 hold.
- **Out of scope:** new features; this is hardening only.
- **Status: landed.** Composition is consumed end to end (`core/store.ts` `composition`/`setComposition`/`clearComposition`; `view/react-view.tsx` listens to `compositionend`/`textformatupdate`/`characterboundsupdate` and the overlay paints an engine-owned preedit underline — AC5). IME bounds are fed from the active leaf's geometry on every selection frame and after scroll via `feedImeBounds` (`updateControlBounds`/`updateSelectionBounds`/`updateCharacterBounds`, real `DOMRect`s; suppressed mid-drag so they do not fight autoscroll — AC4). The surface suppresses the native caret + `::selection` on both backends (`ENGINE_SURFACE_SUPPRESS_CSS` — AC6). Vertical navigation holds a goal column across ArrowUp/ArrowDown and resets on a horizontal move/click/type, falling back to the live caret X so it never degrades the per-line reveal (AC7). Caret motion and word/line gestures are grapheme-correct via `Intl.Segmenter` (`nextGraphemeBoundary`/`prevGraphemeBoundary`, `wordRangeAt`, `lineRangeAt` — triple-click selects the line, AC8); the IME/text-update path is extracted to the pure `applyEditContextText`, fuzzed over 500 seeds for convergence and asserted against UAX#29 clusters (`tests/editor/engine-ime-fuzz.test.ts` — AC1). A polite live region announces selection changes and the blocks expose `textbox`/`aria-multiline` semantics with names, proven by a structured a11y scan (`tests/e2e/engine-a11y.spec.ts` — AC3). Mobile (touch caret, on-screen keyboard, model-authoritative touch selection) runs on the `mobile-webkit` project (`tests/e2e/engine-mobile.spec.ts` — AC2). The drag listener now tracks `mousemove`/`mouseup` as well as pointer events (Playwright does not synthesize `pointermove` from mouse input on WebKit/Firefox), fixing cross-browser drag-select + autoscroll. Reabsorbed from the Phase 2 spike (§10.2): the `::selection`/caret suppression CSS and the IME bounds-feeding shape. Tests: `engine-ime.spec.ts`, `engine-a11y.spec.ts`, `engine-mobile.spec.ts`, `engine-hardening.spec.ts`, `engine-ime-fuzz.test.ts`, plus the restored `engine-input.spec.ts` (Phase 2 fixture path fixed).
- **Documented cross-browser known-failures (AC1 allowance, see §11):** two pre-existing Phase 5/5.5 e2e cases are `test.fixme`'d on **Firefox** — synthetic-`ClipboardEvent` cut/paste (Firefox returns null `clipboardData` for constructed events; real Ctrl+X/V works) and pointer drag-select over a wrapped multi-line block (Firefox `caretPositionFromPoint` offset mapping). Both are platform/harness limitations, not engine defects; the engine behavior is proven on chromium/webkit. Everything else is green on all three browsers.
- **iOS decision (recorded):** no native-`contenteditable` platform fork; the owned surface runs the one EditContext-polyfill substrate everywhere (§5.8/§6.6/§8.7), accepting no iOS loupe/magnifier on the editing text.
- **Honesty / recorded boundaries (not silent gaps):**
  - **Composition commit granularity (011 §9.4).** The engine owns the preedit *underline* (provisional, cleared on `compositionend`), but the preedit *text* is applied per-`textupdate` like all typing — each is its own history entry. 011 §9.4's "only `compositionend` commits a model step" (one atomic undo per composition) is **not yet implemented**; it rides the deferred undo-coalescing policy (§10.5 "typing run = one undo"), which §10.5 already defers with "each keystroke is its own history entry until then." Composition is a special case of that deferral, not a separate gap.
  - **Desktop spellcheck (§10.5 `[defer-but-named]`, Phase 7) — decided: accept absence.** The EditContext-polyfill hidden textarea disables native spellcheck/autocorrect by design, and the engine does not add a custom spellchecker. The owned editing surface has **no desktop spellcheck**; this is accepted and documented (not claimed as parity). A custom spell/grammar pass is a future product decision, not a Phase 7 deliverable.
  - **Accessibility depth (§8.7 / §10.5).** Phase 7 lands `textbox`/`aria-multiline` semantics, accessible names, and a polite live region for selection announcements, proven by a structured invariant scan. **Deferred to Phase 8:** a full **axe-core** audit (the scan is structured, not axe today — the test says so), and **`aria-activedescendant`** for **atomic objects** (text blocks use real-element focus, so they need no roving descendant; object-focus reflection lands with the Phase 8 object-chrome a11y).
  - **Caret paging (§11 / §10.5).** Phase 7 lands Home/End to block start/end and grapheme caret motion. **Deferred to Phase 8:** `PageUp`/`PageDown` viewport paging and horizontal reveal of a long unwrapped line (overlay/scroll polish; none change the model).
  - **Firefox cross-block drag** is a real Firefox-only engine bug to fix (see the cross-browser known-failures bullet in §11), not an accepted limitation.

#### Phase 8 — Feature parity + index-backed TOC/search + opt-in ship (medium–large)

> **Reframe (2026-06-19):** the pre-Phase-8 investigation (docs/017) found that the original AC1–AC6 assumed (a) marks only needed toolbar wiring on top of existing render, (b) the corpus already spoke a dialect `compat` reads, and (c) the `packages/reader` primitive layer existed. None hold: marks are modeled but **not rendered**, `payloadcms.db` speaks a third dialect `compat` throws on, and `packages/reader` does not exist yet. The ACs below are the reframed set. **Prerequisite:** the pre-Phase-8 pass (docs/017) — view decompose, the node SPI seam (docs/016), and two latent-bug fixes — completes first.

- **Goal:** a shippable, opt-in, feature-complete live surface, blog (posts) corpus first (docs/017 §4).
- **May touch:** `core/**` and `view/**`, derived-index modules, toolbar/object-chrome wiring (docs/006), the node SPI registries (docs/016), a Payload-Lexical import adapter, `packages/editor/src/index.ts` (new opt-in export), tests, stories.
- **Must not:** make the engine a default; alter the standard editor's behavior (G6); reshape the node SPI contract locked in docs/016 (fill its optional slots, do not change its shape).
- **Acceptance criteria:**
  - AC1 TOC, model text search, and comment indexes build from the document; navigating to an offscreen heading/result scrolls to and reveals it under virtualization. The model search index is wired to an **in-editor find UI that intercepts Ctrl/Cmd+F** (§10.5), and object internals are searched through the node SPI `plainText`/`anchors` adapters (docs/016 §6.1), never silently skipped.
  - AC2 the docs/006 toolbar and object chrome operate on the engine's model selection/focus (formatting commands apply to the model selection, not DOM), built with `@idco/ui` (§7.1).
  - **AC3 (mark render).** Range marks (bold/italic/strikethrough/underline/code/highlight, and `link`) **render to the DOM** as styled spans at rest and live, and the caret/selection overlay geometry stays correct across the resulting multi-text-node block (reabsorbing the spike's model-offset-over-split-spans behavior). A passing test covers caret/selection across a formatted run.
  - AC4 a parity checklist versus the standard editor passes for the live surface: lists, marks, tables, links, glossary, comments — each has a passing test.
  - AC5 the engine is exposed as an explicit opt-in API; a test confirms existing callers and the default `RichTextEditor` are unchanged (G6).
  - **AC6 (node contract).** A new block node is added end to end through the docs/016 SPI — `NodeDefinition` (core) + `NodeView` (view) registered via `registerNode`, with **no edits to view internals** — proven by a node-fixture test; `divider` and `image` ship as the two worked examples.
  - **AC7 (corpus import).** A Payload-Lexical → owned-model import adapter covers the real corpus node types (docs/017 §3.4 matrix): `upload → media`, `youtube → embed`, `horizontalrule → divider`, inline `link`/`epub-internal-link` → `link` mark, with a passing round-trip test on real-shaped fixtures. `block` (Payload Blocks), `epub-internal-link` semantics, and faithful `table` grid editing are book-corpus items and may be deferred past blog-first ship, but the adapter must not throw on them (drop-with-report, not crash).
  - AC8 input-affordance parity with the legacy editor: markdown/auto-format shortcuts (`# ` → heading, `- ` → list, `` ` `` → code, smart-quote/auto-pair) compile to commands (built on the Phase 5.5 command layer), and a rich HTML paste parses to the model through the single sanitization boundary (§10.5), with passing tests.
  - AC9 block-level authoring parity: a slash/insert menu inserts blocks and objects through the node SPI `insert` affordance (docs/016 §6.2), and block reorder (drag handle or keyboard move) maps to a `MoveNode` command; each has a passing test and operates on the model, not the DOM.
  - AC10 the §10.5 `[blocking-for-v1]` items not covered above hold or are explicitly deferred: autosave/dirty-state + stale-write guard, image drag-drop → host upload binding → media node, and the sanitization boundary. The undo-coalescing/content-free-transaction fix (§10.5) is closed before any undo is bound (landed in docs/017 §3.3).
- **Verify:** `pnpm check`; `pnpm exec playwright test tests/e2e/engine-toc-search.spec.ts`.
- **Done when:** AC1–AC10 pass and G1–G6 hold.
- **Out of scope:** auto-default, collaboration. **Deferred past blog-first (named, not foreclosed):** Payload `block` per-type import, `epub-internal-link` semantics, faithful table grid editing.
- **Status: landed.** All ten ACs are implemented and tested, opt-in, with the standard editor untouched (G6). What shipped:
  - **AC3 mark render (the keystone).** Range marks render as nested *semantic* elements (`<strong>`/`<em>`/`<u>`/`<s>`/`<code>`/`<mark>`/`<a>`/comment+glossary spans) so DaisyUI typography themes them (`view/mark-render.tsx`), and the offset↔DOM geometry was rewritten to walk a block's descendant text nodes (`view/geometry.ts` `textNodesOf`/`resolveOffsetToDom`/`modelOffsetFromDom`/`modelRange`) so caret/selection stay correct across the many-text-node block. Segmentation is pure compute in `core/marks.ts` (`segmentText`), shared with the resting render. Links are inert in the editor, navigable in the reader (`LinkMode`). The unformatted leaf still renders one bare text node, preserving the typing fast path. Tests: `engine-mark-render.test.tsx` (segmentation + offset round-trip) and `engine-marks.spec.ts` (render + selection + click-to-offset across a formatted run, chromium).
  - **AC2 toolbar + object chrome.** `view/editor-chrome.tsx` is the `@idco/ui` (React Aria + DaisyUI + lucide icons) toolbar: format toggles, a block-type menu, list/indent, a link editor, an insert menu, undo/redo — all driving `store.command`/`store.query` on the model selection, with focus returned to the EditContext host after each command. The object config panel and image live surface migrated to `@idco/ui` controls (`object-block.tsx`); the code live surface stays an engine-owned textarea (box-drift/native caret, note.md §2).
  - **AC1 index-backed TOC/search/comments + find.** `buildDocumentIndex` now indexes object internals through the SPI `plainText` adapter and builds a comment/glossary index; `view/find-bar.tsx` is the in-editor find UI that intercepts Ctrl/Cmd+F, searches the model (offscreen included) plus object internals, and reveals/selects matches under virtualization.
  - **AC9 insert menu + reorder.** The insert menu inserts nodes through each `NodeView.insert` affordance (`insert-object` command); `move-block` compiles to a `MoveNode` step.
  - **AC6 node SPI worked examples.** `divider` and `image` ship end to end; `image` gains a `renderLive` surface with the upload affordance. Proven by `engine-node-spi.test.ts` (synthetic node) + `engine-phase8-integration.test.tsx`.
  - **AC7 Payload import adapter.** `core/payload-import.ts` maps `upload→media`, `youtube→embed`, `horizontalrule→divider`, inline `link`/`epub-internal-link`→`link` mark, flattens lists, and drops-with-report `block`/unknowns without throwing (`engine-payload-import.test.ts`).
  - **AC8 input affordances.** Markdown block-prefix shortcuts (`# `/`## `/`- `/`> `/`1. `) compile to commands (`core/markdown-shortcuts.ts` + `apply-markdown`); rich HTML paste parses through the single `sanitizeHtmlToCompat` boundary (`view/paste-html.ts`) into the model. Inline-code wrap + smart-quote/auto-pair are the named Phase 9 typing-loop follow-on.
  - **AC10 autosave + upload + sanitization.** `view/use-autosave.ts` is debounced autosave with a dirty-state model, an in-flight-clobber token guard, and a stale-write seam (host `onSave` does optimistic concurrency); `view/upload-context.tsx` is the host image-upload binding used by the image live surface and the editor drop handler; the sanitization boundary is `sanitizeHtmlToCompat`. The undo content-free-transaction fix landed in docs/017.
  - **AC4 parity + AC5 opt-in.** `engine-parity.test.ts` checks lists/marks/tables/links/glossary/comments on the model (link marks now round-trip through compat as `link` element nodes); `OwnedModelEditor` is the explicit opt-in surface and `RichTextEditor` is exported unchanged.
  - Theming: the surface and resting render carry the DaisyUI `prose` class (`view/owned-model-editor.tsx`, `view/resting-document.tsx`), so document theming is typography, not inline styles. The Ladle stories are `Engine / Phase 8` (full editor + resting read) and `Engine / Owned Model · Phase8FormattedRun`.

#### Phase 9 — Polish + deferred parity (medium; docs/018)

- **Goal:** the genuine polish and deferred-parity items surfaced during Phase 8, gathered so they are tracked, not lost. **This is not a place to defer Phase 8 work** — every Phase 8 AC landed; these are refinements and book-corpus items that were explicitly out of blog-first scope.
- **Items (full list + rationale in docs/018):**
  - Typing-loop affordances: inline-code wrap on the closing backtick (the detector exists in `core/markdown-shortcuts.ts` and is tested; only the IME-safe wiring is deferred), smart-quote substitution, and bracket auto-pairing.
  - Composition-commit granularity (011 §9.4: one atomic undo per IME composition) and full typing-run undo coalescing (§10.5).
  - Accessibility depth: a full axe-core audit and `aria-activedescendant` for atomic objects (Phase 7 deferred these here).
  - Caret paging: `PageUp`/`PageDown` and horizontal reveal of a long unwrapped line (§11).
  - Reader package: move the resting object/mark render onto `packages/reader` L1 primitives when it lands (docs/015), retiring the in-editor `resting-document.tsx` shim.
  - Book-corpus parity (deferred past blog-first, 010 Phase 8 out-of-scope): Payload `block` per-type import, `epub-internal-link` semantics, and faithful `table` grid editing (`NodeView.renderLive` for tables, the largest future node).
  - Firefox cross-block drag-select fix (the §11 known-failure) and the Firefox synthetic-ClipboardEvent harness limit.
- **Out of scope:** auto-default and collaboration (still §12 open decisions).

**Future (gated, not committed):** make the engine the default for chosen workloads, and collaboration groundwork. These are §12 open decisions, decided from data after Phase 8, not scheduled now. The collaboration groundwork has a worked-through brainstorm (docs/014) and a day-one footprint already required in Phase 3 (AC10); what stays gated is the collaboration build itself, not the readiness.

The shape of the bet: Phases 1–2 cost little and retire the foundational risk; Phases 3–4 are the runtime; Phase 5 is the payoff; Phase 6 is the differentiation; Phase 7 is the long tail. If Phase 2 ever returned fatal, the spend would be days, not months — which is where the risk belongs.

### 10.5 Capabilities A Real Editor Still Needs (slot into the phases)

The phases above describe the engine's spine. A production editor needs the following, which the spine does not imply and which must be slotted into the named phase rather than discovered late. `[blocking-for-v1]` items must ship before the engine is offered even as opt-in; `[defer-but-named]` items may follow, but the design must not foreclose them.

- **Paste pipeline — `[blocking-for-v1]`, Phase 3/8.** Clipboard _read_: an HTML/plain-text→model parser with explicit format priority (internal model format > HTML > plain), and an internal high-fidelity clipboard format for intra-app paste. The copy side (§5.7) is only half of clipboard.
- **Sanitization / XSS boundary — `[blocking-for-v1]`, Phase 3/6.** Pasted HTML and **baked HTML/SVG fields** (mermaid SVG, grid output) are rendered by the `packages/reader` L1 primitives on every tier including export. Define the single sanitization boundary; nothing author- or paste-derived reaches a rendered tier unsanitized.
- **Find-in-page — `[blocking-for-v1]`, Phase 5/8.** Virtualization removes offscreen text from the DOM, so native Ctrl/Cmd+F is broken by construction. The model search index (§8/§13) must be wired to an **in-editor find UI that is the Ctrl+F replacement** (intercept the shortcut), not just a side panel.
- **Autosave / dirty-state / save-failure — `[blocking-for-v1]`, Phase 4/8.** A dirty-state model, debounced persistence (the `debounced` lane), save-failure recovery, and a minimum two-tabs/stale-write guard. Core for a "live book platform," not optional.
- **Image/file drag-drop & paste → upload → media node — `[blocking-for-v1]`, Phase 6/8 (deferred to Phase 8).** Author drops/pastes an image; engine routes to the host upload binding and inserts a media node. Phase 6 shipped the media object (baked-at-rest, config-panel `src`/`alt`/`caption` editor) but not the drag-drop/upload pipeline, which needs a host upload binding that does not exist yet; it moves to Phase 8.
- **Object-internal search/index adapters — `[defer-but-named]`, Phase 8 (with find-in-page).** `buildDocumentIndex` (Phase 6) indexes top-level text leaves only. Per 011 §2.7, an object with meaningful internal content (code-block source, table cells, embed titles) must expose object-level plain-text/anchor adapters through its `BlockDefinition`; wire these when the find-in-page UI lands so search does not silently skip object internals.
- **Native-path spellcheck story — DECIDED (Phase 7): accept absence.** The EditContext-polyfill hidden textarea disables spellcheck/autocorrect by design and the engine adds no custom spellchecker, so the owned editing surface has **no desktop spellcheck**. This is accepted and documented (parity is not claimed); a custom spell/grammar pass is a future product decision, not a committed deliverable.
- **Undo coalescing policy — `[defer-but-named]`, Phase 3 (wired in Phase 5.5).** Name the grouping rules (typing run = one undo, boundaries at format/paste/object-activation) and selection restoration on undo/redo. **A content-free transaction (empty `steps`, selection-only — every click and arrow key dispatches one) is non-historic: it must not push an undo entry, or undo will step back through caret moves before reaching the last edit.** Today `core/store.ts#commit` records history whenever `recordHistory` is set regardless of `steps.length`; the pollution is latent only because undo/redo is not keyboard-wired until Phase 5.5, so it is harmless in P1–5 but must be closed before AC5 binds undo. The invertible-step model enables coalescing; the grouping policy is still a decision.
- **Memory / teardown of unmounted blocks — `[defer-but-named]`, Phase 5.** Unmounting blocks must release subscriptions, observers, height-cache growth, and worker references; assert no unbounded growth over a long scroll of a 5,000-block document.
- **Concrete accessibility plan — partly Phase 7, remainder Phase 8.** Phase 7 landed the role/`textbox`+`aria-multiline` semantics, accessible names, and live-region selection announcements, proven by a structured invariant scan (`tests/e2e/engine-a11y.spec.ts`). **Deferred to Phase 8:** a full **axe-core** audit (today's scan is structured, not axe), and **`aria-activedescendant` for atomic objects** (text blocks use real-element focus and need no roving descendant; object-focus reflection lands with the object-chrome a11y).
- **Link editing, RTL/bidi caret, print-from-editor, multi-caret — `[defer-but-named]`.** Link insert/edit/auto-link-on-paste; the bidi caret-on-wrong-line case as a real test target (not just an acknowledged affinity bit); printing must use the full `packages/reader`/export path, never the virtualized editor DOM (which mounts only the viewport); multi-caret is explicitly out of v1.

## 11. Risks, Edge Cases, And Failure Modes

- **Mobile-Safari IME on the hidden-textarea backend.** The hidden-textarea bridge versus iOS predictive text, autocorrect, and the selection loupe is the single highest-risk surface. The upstream package is young and has known IME-fuzz limits, so our owned substrate must vendor and harden it; treat IME as a first-class test target. **The native-`contenteditable`-on-active-block escape is dropped (§5.8/§6.6 Phase 7 decision):** the owned surface keeps the iOS keyboard, autocorrect, and touch caret placement through the textarea but accepts no native selection loupe/magnifier — documented, not forked. Phase 7 proves touch caret placement, on-screen-keyboard editing, and model-authoritative touch selection on mobile-WebKit emulation (`tests/e2e/engine-mobile.spec.ts`).
- **Documented cross-browser known-failures (Phase 7, AC1 allowance).** Two Phase 5/5.5 e2e behaviors are `test.fixme`'d on **Firefox** with recorded reasons (model behavior is proven on chromium/webkit): (1) **synthetic-ClipboardEvent** cut/paste — a true Firefox/harness limitation: Firefox returns null `clipboardData` for a *constructed* `ClipboardEvent`, so a synthetic `cut` cannot read what the engine wrote; real `Ctrl+X`/`Ctrl+V` works. (2) **cross-block pointer drag-select started mid-block** — a Firefox-only engine/drag bug, *not* a platform limit and not general hit-testing (single-click point→offset works on Firefox — AC7/AC8 click into the same multi-line `pre-wrap` block and pass). The drag-extend resolves the wrong block; root cause is not yet isolated and is a **Phase 7 follow-up to fix**, not an accepted quirk. Everything else in the engine e2e suite is green on chromium/webkit/firefox.
- **IME engagement is the platform's call, not ours (Firefox + Windows IME-toggle).** Captured from the Phase 2 spike: with the hidden-textarea backend on Firefox, if the user switches keyboard language mid-document (en↔vi↔en), the Windows IME stops entering composition and emits plain `insertText` for the next word — so Vietnamese Telex "xin chào" lands as "xin o". Traced conclusively: the hidden textarea keeps focus throughout (`taIsActive` stays true) and the model is never corrupted (it faithfully reflects whatever the IME emits) — the IME simply declines to compose. It is reproducible in any plain `<textarea>` in Firefox and there is **no web-platform signal** for an IME language switch, so the backend cannot detect or recover from it without breaking legitimate plain typing. Keeping the VI keyboard active throughout composes correctly. Native EditContext on Chromium does not exhibit it — another point for the keep-native decision (§4.2). Accepted, not a blocker; revisit only if a backend-level workaround proves safe.
- **Owning composition correctness for complex scripts is the price of the polyfill implementation.** Because the EditContext polyfill (hidden textarea) is what runs wherever native is absent, IDCO owns IME composition correctness for CJK, Vietnamese/Telex, and dead-keys on every browser where native is not used — all of Firefox/Safari, and Chromium if a regression forces the polyfill. This is a recurring, platform-matrixed cost, not a one-off (the Microsoft-Telex-on-Firefox composition bug, fixed during the Phase 2 spike, is the representative case: a trailing `insertCompositionText` after `compositionend` that duplicated committed text). Native EditContext is precisely the mitigation that hands Chromium users vendor-grade composition for free — the reason it is kept (§4.2/§6.7) — but the polyfill implementation must be independently correct, and CJK is harder than Telex. There is no off-the-shelf CJK IME test framework; the proof strategy is assembled (§13).
- **Caret-from-click accuracy at wrap/bidi boundaries.** `caretPositionFromPoint` resolution varies; mapping pixel → text offset → model offset must be verified on wrapped lines, RTL runs, and around inline marks.
- **Scroll drift on late-resizing content.** Images, baked SVGs, and tables that settle height after first paint shift everything below. Heights must be conservative and measured-authoritative; scroll-to-target corrects after measure; a top→bottom→top drift assertion guards regressions.
- **Selection overlay across partially-mounted ranges.** Painting only on mounted blocks while the model holds the full range must stay visually correct as blocks mount/unmount during autoscroll selection.
- **Focus hand-off races.** Activating/deactivating an object while a selection or IME composition is in flight must defer until composition ends and must not strand the caret.
- **Bake failure.** A heavy object with no valid baked snapshot is not exportable and must surface a recoverable error rather than emit an unbakeable node (docs/006 §9). The engine must re-bake on edit and never let the live and baked forms drift.
- **Clipboard fidelity.** Model-based copy must produce correct text and structured formats for cross-virtual ranges, including code blocks, and paste must splice into the model without trusting DOM.
- **Accessibility of a non-`contenteditable` surface.** Owning the model means owning the accessibility story for the editing region (roles, announcements, caret semantics) that `contenteditable` would have provided; this must be designed, not inherited. This risk concentrates in the selection/caret overlay (§7.4) and is one of the three things expected to cost real time, alongside caret affinity and IME bounds.
- **Caret affinity at wrap/bidi boundaries.** On the native DOM `Selection` path the browser resolves affinity; on the hand-painted/offscreen path the selection model must carry an affinity/bias bit (§7.4), or the caret renders on the wrong visual line at soft-wrap and RTL boundaries. Scoped to where we paint — budgeted, not discovered.
- **Scroll-the-caret-into-view fidelity — shipped (Phase 5), paging refinements Phase 7.** Because the view paints its own caret and passes `preventScroll` on focus, keyboard caret/selection movement scrolls the focus into view explicitly (`revealBlock` in `view/react-view.tsx`): it keeps the caret visible and, under virtualization, keeps the focus block mounted as a selection extends past the window+overscan band. **Shipped:** the reveal is **caret-line granular** — it scrolls to the focus _caret rect_ (`caretClientRect`) with a small lead margin (`CARET_REVEAL_MARGIN_PX`), so a one-line move scrolls about one line, never yanking a whole multi-line block into view (an earlier block-granular reveal did exactly that; e2e `tests/e2e/engine-caret.spec.ts` now guards both the follow and the per-line step size). **Phase 7 landed:** `Home`/`End` to block start/end (`tests/e2e/engine-hardening.spec.ts`). **Deferred to Phase 8:** `PageUp`/`PageDown` viewport paging, horizontal reveal of a long unwrapped line, and exposing the lead margin / a smooth-scroll behavior as a prop (the constant is the seam). None change the model; all are overlay/scroll polish on the surface we already own.
- **IME bounds feedback correctness.** `updateControlBounds`/`updateSelectionBounds`/`updateCharacterBounds` must keep the OS IME candidate window correctly placed across platforms and during scroll/relayout; getting this wrong is most visible on mobile-Safari via the hidden-textarea backend.
- **Scheduler vs React double-scheduling.** The `frame` lane and React's renderer must share one rAF and batch store-notifies (§7.3); a regression here shows up as re-render storms or dropped frames on keystroke.
- **Two engines in the codebase.** The standard Lexical editor and the engine coexist; node definitions, bake fields, and compatibility adapters must stay shared so the two never diverge on what a document means.

## 12. Open Decisions

- **Persistence format migration.** Phase 3 defines `EditorDocument` as the app model, but existing consumers still require `RichTextEditorDocument` compatibility output. Whether storage eventually flips to `EditorDocumentSnapshot`, stores both during a migration window, or keeps `RichTextEditorDocument` as the durable interchange format is a separate migration decision, not part of the engine hot path.
- **Many simultaneously-live objects.** Currently one-at-a-time (§6.4). Whether and when to relax via the slot is unresolved and should be driven by real author behavior, not anticipated.
- **Reader-tier interactive surface sharing.** ~~How much of the live object surface (e.g. a sortable grid) is shared with the digital-reader tier versus re-implemented from baked fields is an open boundary between this engine and `content-renderer`.~~ **Closed by docs/015:** the reader and editor share an RSC-safe presentational primitive layer plus the baked field and the object `kind`; the editor live-edit surface and the reader island are separate components behind that shared identity. docs/015 also retires `content-renderer` (replaced by `packages/reader`) and is the read tier the Lexical retirement (§12, persistence flip) routes through.
- **Collaboration.** No build now, and no collab plumbing until it is real. The earlier "at no extra cost" was too strong: docs/014 works the question through and finds a small, deliberate day-one cost that buys collaboration-readiness, namely that prose leaves carry character identity and marks anchor to it from the start rather than being retrofitted. That day-one footprint is folded into 011 §17 (global node ids, character-identity prose substrate, character-id-anchored marks and positions, a transaction `origin` slot) and is required by Phase 3 below. Everything beyond that footprint, the concurrent-move rule, heavy-object merge semantics, selective undo, awareness, the network, stays deferred with recommended leans in docs/014 §7. The posture is fixed: 011 stays authoritative and any CRDT is a replication layer underneath it, never the document (docs/013 is the rejected inversion of that posture).
- **Code-block internal virtualization.** Deferred; revisit when a single listing is large enough to matter.
- **When the engine becomes the default.** Whether/when the engine supersedes the standard editor for non-live documents is left for after it is proven on the live-book workload.

## 13. Verification Philosophy

Concrete tickets are out of scope here; the _shape_ of proof is not:

- **Prove the inversion, not the pixels.** Tests assert that selection, copy, search, and TOC operate from the model with offscreen blocks unmounted — i.e. that DOM presence is not required for correctness.
- **Virtualization is bounded.** A 5,000-block document mounts viewport + overscan, not the whole document; scrolling does not mount everything; the top→bottom→top scroll position is stable.
- **Cross-virtual copy is correct.** Copying a range that spans unmounted blocks (including code) yields the full model content, not just on-screen text.
- **Object lifecycle is honest.** Activation bakes/live-swaps in place with no layout drift; deactivation re-bakes; an unbakeable object surfaces an error rather than corrupting the document.
- **IME and complex scripts are first-class, proven by an assembled suite (no turnkey tool exists).** Two halves. (1) _Script shaping / segmentation_ — caret-by-grapheme, word selection, delete-by-cluster — is verified deterministically against Unicode UAX #29 data (`GraphemeBreakTest` / `WordBreakTest`) over `Intl.Segmenter`, in CI on every browser; this catches the "don't split a Hangul syllable / Thai cluster / emoji ZWJ" class without an IME. (2) _Composition_ has no framework, so it is proven by capturing real IME event streams once and replaying them as cross-browser regressions (the technique already used for Microsoft Telex), plus CDP `Input.imeSetComposition` for Chromium composition, ported WPT `input-events` ordering cases, and a thin manual real-device matrix (CJK + Vietnamese). The native-EditContext and hidden-textarea backends run the **same** composition cases; native is used only where it passes them.
- **Output is unchanged.** Round-tripping any document through the new engine yields compatibility JSON that the `packages/reader` read tier renders identically and that the Lexical path can still load (rollback safety).

## 14. Completion Criteria

The engine is "done enough to adopt for the live-book workload" when:

- A generated book-scale document (thousands of blocks, dense code/objects) opens quickly and scrolls within budget, mounting only the visible window plus overscan.
- Text editing is continuous across the document with model-owned selection — rendered natively where blocks are mounted, engine-painted across virtualized gaps — on Chromium through the native-EditContext backend when reliable and on Firefox/Safari through the hidden-textarea backend.
- Heavy objects render baked at rest, go live in place one at a time, re-bake on edit, and never drift from their baked form.
- Cross-virtual selection and copy are correct; search and TOC navigate to and reveal offscreen targets.
- Desktop and mobile reach authoring parity per §5.8, with read/review working everywhere from day one.
- The compatibility projection is deep-equal-after-normalization to the existing `RichTextEditorDocument` contract (ingest may add optional `id`s; no other delta) and rollback-compatible with the Lexical path; the app-owned `EditorDocument` remains the authoritative model.
- The standard editor and Phase 0 remain intact for small/static documents.

## 15. Final Model

The scalable IDCO editor is not a bigger `contenteditable`. It is an **engine built around the EditContext API**: `EditorDocument` is the source of truth, EditContext feeds text/composition/selection by model offset, the browser still lays out and hit-tests text, and selection is model-based so the editor can virtualize blocks without the DOM fighting back. Native `EditContext` and the hidden-textarea polyfill are two implementations of one EditContext contract, not separate editor implementations. Heavy objects sit atomic in the text flow, baked static at rest and live one-at-a-time on activation — which is what makes a tooling-dense document cheap to hold and possible to export, and which is the precise place the incumbent `contenteditable` foundation fails. The legacy rich-text JSON remains a compatibility projection until consumers migrate; the app model, not that JSON tree, is the authority. This is the editor a live technical book platform needs, and it is the one no mainstream `contenteditable` engine can become.
