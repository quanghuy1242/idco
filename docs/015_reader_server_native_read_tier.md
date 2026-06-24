# 015 - Reader: The Server-Native Read Tier And The Shared View Substrate

> Status: design locked, pre-implementation. Rewritten 2026-06-24 from the 2026-06-18 design-direction draft to fold in the decisions taken since (prose single-source, content-visibility-only virtualization, content-renderer deleted-not-extended, the cross-repo repin) and to add an implementation-grade backlog. The architecture is settled; what remains is the build.
>
> Date: 2026-06-24 (supersedes the 2026-06-18 draft)
>
> Scope:
>
> - `packages/content-renderer/src/index.tsx` — the current `"use client"` whole-document read renderer. **Retired and deleted by this plan, never extended.** It is welded to the Lexical-shaped compat JSON it walks, so it dies with that format (§8).
> - `packages/ui/src/rich-text-content.tsx` and the `RichText*` family in `@quanghuy1242/idco-ui` — the current visual primitives the reader and the editor's object render both lean on. Their RSC-safe core **relocates** to `packages/reader` as L1 (§7.4).
> - future `packages/reader/**` — the new read tier: an RSC-safe presentational primitive layer (L1), a server `<Reader>` (L2a), and the opt-in client islands (L3).
> - `packages/editor/src/view/**` — the editor view layer (docs/020). It renders resting blocks through the **same** L1 layer this document defines, and its live editable surface adopts the **same typography class contract** (§4.3) so editing, resting, and reading cannot diverge.
> - `packages/editor-legacy/src/RichTextEditor.tsx` — the Lexical editor, retired together with the Lexical-shaped compat projection once the owned editor and this reader reach parity and persistence flips (§8).
>
> Source docs:
>
> - `docs/006_editor_toolbar_redesign_plan.md` — the three render tiers, the bake pipeline, the reader-tier opt-in interactivity.
> - `docs/010_owned_model_virtualized_editor_plan.md` — the editor, §5.9 render-tier mapping, the resting/live object split (§6.2), and the reader-boundary open decision (§12) this document closes.
> - `docs/011_foundation_dsa_owned_model_editor.md` — the model, the projection, the derived indexes (§11.4), and the `virtualize` toggle (§2.6) the reader does not use.
> - `docs/020` (editor architectural refactor) — the source of the editor's own resting renderer (`view/render/resting-document.tsx`), which decoupled the editor from `content-renderer` and is the current L2b substrate (§3.2).
>
> Related docs:
>
> - `docs/027_review_tab_document_insight.md` — the Review tab / annotations work; §12 of this document is its read-tier half and is downstream of docs/027's comment + glossary build.
> - `docs/026_host_data_provider_spi_reference_blocks.md` — reference blocks store a denormalized `snapshot`, which is what makes them reader-safe with no host call (§4.5).
> - `note.md` item 4 — the parity-backlog entry this document is the design for.
>
> External references:
>
> - React Server Components — https://react.dev/reference/rsc/server-components
> - `use client` directive (boundary semantics) — https://nextjs.org/docs/app/api-reference/directives/use-client (accessed 2026-06-24)
> - Server/Client interleaving, the children-slot pattern — https://nextjs.org/docs/app/getting-started/server-and-client-components (accessed 2026-06-24)
> - `content-visibility` — https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility
> - `contain-intrinsic-size` — https://developer.mozilla.org/en-US/docs/Web/CSS/contain-intrinsic-size
> - The islands architecture — https://jasonformat.com/islands-architecture/
>
> Assumptions:
>
> - The reader renders the **same baked artifact** the export tier consumes (010 §5.9): heavy objects bake to static HTML/SVG/image at author time, so the reader runs no Prism, no Mermaid, no grid engine for resting content.
> - React 19 is in use across the workspace, so Server Components and selective hydration are available. The published reader targets a React Server Component host — Next.js App Router specifically, or any equivalent RSC runtime — and ships zero JavaScript for prose and baked objects.
> - The reader consumes the document the editor persists. Today that is the `RichTextEditorDocument` compatibility projection (the shape `content-renderer` already walks); after the persistence flip (§8) it is `EditorDocumentSnapshot` directly. The reader is written against a projection adapter so the flip does not rewrite L1 or the pipeline.
> - The bake fields, document settings, derived indexes, and node semantics are shared truth owned by 006/010/011/020; this document renders them, it does not redefine them.

## Table Of Contents

- [1. Purpose](#1-purpose)
  - [1.1 The short version](#11-the-short-version)
  - [1.2 Non-goals and first-release boundary](#12-non-goals-and-first-release-boundary)
- [2. The Drift Problem, Stated Correctly](#2-the-drift-problem-stated-correctly)
  - [2.1 Two renderers is the disease](#21-two-renderers-is-the-disease)
  - [2.2 The fix is component identity, not engine identity](#22-the-fix-is-component-identity-not-engine-identity)
  - [2.3 The three-context triangle over one primitive layer](#23-the-three-context-triangle-over-one-primitive-layer)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 content-renderer is a client component by accident, and tied to Lexical](#31-content-renderer-is-a-client-component-by-accident-and-tied-to-lexical)
  - [3.2 The editor already owns its resting render: objects share, prose does not](#32-the-editor-already-owns-its-resting-render-objects-share-prose-does-not)
  - [3.3 The bake model is what makes a server reader cheap](#33-the-bake-model-is-what-makes-a-server-reader-cheap)
  - [3.4 content-renderer's consumers and the cross-repo surface](#34-content-renderers-consumers-and-the-cross-repo-surface)
- [4. Target Model](#4-target-model)
  - [4.1 The component cake: three layers, one shared base](#41-the-component-cake-three-layers-one-shared-base)
  - [4.2 The RSC-safe primitive contract (L1)](#42-the-rsc-safe-primitive-contract-l1)
  - [4.3 Prose single-source: a tag-independent typography class contract](#43-prose-single-source-a-tag-independent-typography-class-contract)
  - [4.4 Reader equals export tier plus opt-in islands](#44-reader-equals-export-tier-plus-opt-in-islands)
  - [4.5 The reader data pipeline and projection adapter](#45-the-reader-data-pipeline-and-projection-adapter)
  - [4.6 Two read artifacts: server Reader and editor read-mode](#46-two-read-artifacts-server-reader-and-editor-read-mode)
- [5. Reader Virtualization: content-visibility Only](#5-reader-virtualization-content-visibility-only)
  - [5.1 The editor's unmount-window is wrong for the reader](#51-the-editors-unmount-window-is-wrong-for-the-reader)
  - [5.2 content-visibility is the virtualization](#52-content-visibility-is-the-virtualization)
  - [5.3 The contain-intrinsic-size estimate is server-derived, zero JS](#53-the-contain-intrinsic-size-estimate-is-server-derived-zero-js)
  - [5.4 What stays native: find, select, copy, deep-link](#54-what-stays-native-find-select-copy-deep-link)
  - [5.5 JS windowing is an explicit non-goal](#55-js-windowing-is-an-explicit-non-goal)
- [6. The Island Model](#6-the-island-model)
  - [6.1 Static by default, island by exception](#61-static-by-default-island-by-exception)
  - [6.2 The island registry mirrors the block registry](#62-the-island-registry-mirrors-the-block-registry)
  - [6.3 Hydration boundaries and the children-slot pattern](#63-hydration-boundaries-and-the-children-slot-pattern)
- [7. Packaging: packages/reader, And Retiring content-renderer](#7-packaging-packagesreader-and-retiring-content-renderer)
  - [7.1 Why a dedicated package and not a folder in the editor](#71-why-a-dedicated-package-and-not-a-folder-in-the-editor)
  - [7.2 The dependency direction is the whole point](#72-the-dependency-direction-is-the-whole-point)
  - [7.3 Package layout and exports](#73-package-layout-and-exports)
  - [7.4 What moves, what is reclaimed, what is retired](#74-what-moves-what-is-reclaimed-what-is-retired)
  - [7.5 The import-boundary lint](#75-the-import-boundary-lint)
- [8. Retiring Lexical Through The Reader](#8-retiring-lexical-through-the-reader)
- [9. Architecture Decisions](#9-architecture-decisions)
- [10. Implementation Strategy](#10-implementation-strategy)
- [11. Detailed Plans](#11-detailed-plans)
  - [11.1 L1 typography class contract](#111-l1-typography-class-contract)
  - [11.2 L1 primitives and the relocation from @idco/ui](#112-l1-primitives-and-the-relocation-from-idcoui)
  - [11.3 Repointing the editor onto L1](#113-repointing-the-editor-onto-l1)
  - [11.4 The server Reader, adapter, and pipeline](#114-the-server-reader-adapter-and-pipeline)
  - [11.5 Islands](#115-islands)
  - [11.6 Deleting content-renderer and the cross-repo repin](#116-deleting-content-renderer-and-the-cross-repo-repin)
- [12. Reader-Side Annotation Access: Glossary And Comments](#12-reader-side-annotation-access-glossary-and-comments)
- [13. Edge Cases And Failure Modes](#13-edge-cases-and-failure-modes)
- [14. Implementation Backlog](#14-implementation-backlog)
- [15. Future Backlog](#15-future-backlog)
- [16. Test And Verification Plan](#16-test-and-verification-plan)
- [17. Definition Of Done](#17-definition-of-done)
- [18. Final Model](#18-final-model)

## 1. Purpose

Define the read tier of the IDCO live-book platform, and pin the one substrate that guarantees the reader and the editor cannot diverge visually. The editor work in 010/011/020 produced an engine whose resting blocks already render a baked static form. This document takes that static form and makes it the published reader: a true Server Component that ships no editor runtime, runs no heavy libraries for resting content, and renders through the **same** view layer the editor mounts at rest, so a paragraph, a baked code block, a callout box, or a baked table looks identical whether an author is editing it or a reader is reading it.

The reader is not a second renderer that approximates the editor. It is the editor's resting render, lifted out of the client editing shell and run on the server. That single inversion removes the read-versus-edit drift class of bug at the root, and it is the explicit reason this tier shares a primitive layer with the editor rather than re-implementing one. The plan also retires two things on the way: `@quanghuy1242/idco-content-renderer`, the current client-only read renderer (deleted, not ported), and the Lexical standard editor with its Lexical-shaped compat JSON, once the editor and this reader reach parity (§8).

### 1.1 The short version

Build `packages/reader` at the bottom of the dependency graph. It holds three layers: **L1**, RSC-safe presentational primitives (pure node-plus-baked to DOM, no directive, no hooks, no handlers) that are the single source of truth for how block N looks; **L2a**, a synchronous server `<Reader>` that walks a projection adapter, renders L1, and virtualizes with `content-visibility`; and **L3**, opt-in client islands for the few interactive widgets. The editor depends down onto L1 for its resting render and adopts L1's **typography class contract** for its live editable surface, so editing equals resting equals reading by construction. `content-renderer` is deleted and its consumers repin to `<Reader>`. After the persistence flip, the projection adapter swaps and Lexical is removed.

### 1.2 Non-goals and first-release boundary

- **Not in scope:** JS-based client windowing in the reader. It is an explicit non-goal (§5.5), not a deferred feature, because it would make the reader stateful and client-bound, contradicting the entire light-server-native premise.
- **Not in scope for first release:** reader-side comment *interaction* (reply, resolve, thread fetch). The reader paints comment highlights and margin notes from the document's own snapshot only; interactive reader comments are an island exception, downstream of docs/027 (§12).
- **Not in scope:** redefining bake fields, node semantics, document settings, or the derived indexes. Those are owned by 006/010/011/020 and consumed here.
- **First-release boundary:** the reader consumes the `RichTextEditorDocument` compat projection through the adapter (a like-for-like replacement of `content-renderer`). The `EditorDocumentSnapshot`-native adapter and the Lexical removal are sequenced after parity (§8, §15).

## 2. The Drift Problem, Stated Correctly

### 2.1 Two renderers is the disease

A `contenteditable`-style editor renders the document one way for editing, inside the live editable DOM, and a separate read renderer renders it a second way for publishing. Two code paths render the same node, so they drift: a list indent, a callout border, a code-block gutter, a table header style, a heading size — each is implemented twice, and the two implementations fall out of sync the first time someone fixes one and forgets the other. The reader then shows something the author never saw in the editor, and the bug is unfixable in general because the two renderers are genuinely different code.

The instinct to fix drift by making the reader reuse the editor is wrong here, because the editor is a client-heavy engine (EditContext input, selection overlay, virtualization, scheduler), and dragging it into a server-rendered reader would forfeit the Server-Component win and ship megabytes of editing machinery to read a page. The reuse has to be narrower and lower than "the engine."

### 2.2 The fix is component identity, not engine identity

Drift is a function of how many components render block N, not of how many engines exist. If exactly one thing renders a heading's appearance, a reader and an editor that both use it are pixel-identical by construction, no matter how differently each decides which blocks to paint or how each handles input. So the shared thing is the **presentational primitive** — the pure function from a node plus its baked fields to DOM — and nothing above it.

010 §5.9 states the mechanism without naming the package boundary: "the engine's resting blocks render the same baked representation the reader and export consume… one static representation per object… removes the read↔edit drift class of bug entirely." This document makes that boundary concrete and extends it to the one place it currently leaks — prose (§3.2, §4.3). The guarantee is stronger than review discipline: the mismatch is not caught, it is unrepresentable.

### 2.3 The three-context triangle over one primitive layer

There are three places a document gets rendered to a reader-facing visual. All three resolve block N's appearance through the same L1 source, and they differ only in the shell around it.

| Context | Runtime | Renders | Virtualization | Ships editor JS |
| --- | --- | --- | --- | --- |
| Editor, editing | client (heavy) | L1 appearance + edit chrome + input + selection | unmount-window (011 §2.6) | yes |
| Editor, read preview (`mode="read"`) | client (light) | L1 only, no chrome | optional | yes (already loaded) |
| Published reader (`<Reader>`) | **server (RSC)** | L1 only + opt-in islands | `content-visibility` (§5) | no |

The triangle is the design. Because every vertex resolves block N's appearance through L1, the published reader matches the editing surface and the in-app preview, and no review step keeps them aligned. The editor adds chrome and input above L1; the reader adds islands and a server pipeline around it; the appearance itself never knows which context it is in. The subtlety this document resolves is that for **objects** the shared thing is a literal component (the baked view), while for **prose** the shared thing is a class contract applied to different host elements (§4.3) — because prose is edited *in* the styled element, objects are edited *beside* it.

## 3. Current-State Findings

### 3.1 content-renderer is a client component by accident, and tied to Lexical

`packages/content-renderer/src/index.tsx` (≈564 lines) walks a `RichTextDocument` (its local name for the Lexical-shaped `root.children` JSON) and renders every node through the `RichText*` components from `@quanghuy1242/idco-ui`. It is product-neutral and contract-aligned, and 010 §3.1 correctly named it the right initial base for the editor's view layer. It is marked `"use client"` at line 1, and the directive is incidental, not structural: the file uses no `useState`, `useEffect`, `useRef`, `useMemo`, or `useContext`. The interactivity is one checklist item rendering `<input type="checkbox" onChange={() => {}}>`, a no-op handler, and the file inherits `"use client"` from importing `rich-text-content.tsx`, which carries the directive at line 5 for the same checkbox and for the scroll-spy TOC rail.

Two facts pin its fate. First, it is a client component for one disabled checkbox — nothing about reading a technical book needs the client. Second, it is structurally tied to the Lexical shape: it reads `node.format` for alignment (`elementAlign`, lines 459-463), `node.type` strings, and `root.children`, which is the `RichTextEditorDocument` projection that §8 retires. Extending `content-renderer` would invest in a renderer welded to a format being deleted. The decision is therefore **delete, do not extend**: the server `<Reader>` replaces it, and its useful seams (`resolveMedia`/`resolvePost` resolvers, lines 89-99, and the `renderers` override map, line 88) move to `packages/reader` intact.

### 3.2 The editor already owns its resting render: objects share, prose does not

This is the most important change since the 2026-06-18 draft, and it splits the drift surface cleanly.

The docs/020 refactor gave the editor its **own** resting renderer, `packages/editor/src/view/render/resting-document.tsx`, and the editor no longer imports `content-renderer` at runtime (nothing in `packages/editor/src` references it; the dependency in `packages/editor/package.json` is vestigial, used only by tests). So the editor's resting render is self-contained, and it is the current L2b substrate.

Within that resting render, **objects already share the L1-grade primitive**: `media`, `embed`, `post-ref`, `table`, `code-block`, and `table-of-contents` render through the same `@quanghuy1242/idco-ui` `RichText*` components in both the editor's node `renderResting` and `content-renderer`. For example `media.tsx` renders `RichTextMediaFigure` (the comment says "the same `RichTextMediaFigure` the reader uses"), and `table.tsx` renders `RichTextTable`/`RichTextTableRow`/`RichTextTableCell`. For heavy and object blocks, component identity already holds, and this document's job there is only to relocate those primitives into L1 (§7.4) so the dependency direction is correct.

**Prose does not share.** The editor's resting render emits its own raw `<p>`, `<Tag>` (heading), and `<blockquote>` (`resting-document.tsx` lines 108-135), styled by inline `blockStyleFor` output plus the engine's injected `ENGINE_TYPOGRAPHY_CSS` (`styles.ts` ≈ line 92), which targets `[data-engine-block-type]` selectors. The reader, meanwhile, renders prose through `RichTextParagraph`/`RichTextHeading`/`RichTextBlockquote`/`RichTextList`, which lean on a semantic-tag `prose` typography layer. That is **two implementations of paragraph/heading/quote/list appearance**, plus the structural container chrome (the callout box, list markers) in the same split. This is exactly the drift class §2 describes, currently live for prose and container chrome.

The reason prose duplicated is mechanical, and it is the crux of §4.3: the editor renders every editable text leaf as a `<div role="textbox">` (the caret/EditContext host), carrying its block type on `data-engine-block-type` rather than a semantic tag, *because a `prose` typography layer targets `<h2>`/`<blockquote>` and cannot style a `<div>`. The engine therefore grew its own per-type CSS. The reader uses semantic tags plus `prose`. The two typography systems were never unified.

### 3.3 The bake model is what makes a server reader cheap

A true Server-Component reader is achievable rather than aspirational because of the bake pipeline (006, 010 §4.3/§5.9). Every heavy object's resting state is a baked static snapshot produced at author time: a code block bakes to highlighted static HTML, a Mermaid diagram to inline SVG, a data grid to a static HTML table, an image to a sized figure. The reader renders those baked fields directly, so it never loads Prism, Mermaid, or a grid engine for resting content. This collapses the reader to a familiar shape: **the reader is the export tier rendered to HTML, plus optional client islands for the reader-tier interactivity 006 §5.7 allows.** A technical book page is then prose plus baked statics, the ideal Server-Component workload.

### 3.4 content-renderer's consumers and the cross-repo surface

In this repository, `@quanghuy1242/idco-content-renderer` is referenced by: `stories/content-renderer.stories.tsx` (the Ladle story), tests (`tests/editor/engine-model.test.ts`, `tests/editor/editor-foundation.test.tsx`), the root `tsconfig.json` and `vitest.config.ts` path aliases, and the vestigial dependency in `packages/editor/package.json`. There is no in-repo product that mounts it.

The real runtime consumer is the product repository (the content-api admin / the Next.js App Router host that publishes books), which imports the published `@quanghuy1242/idco-content-renderer`. Deleting `content-renderer` therefore has a **cross-repo step**: that repo repins from `@quanghuy1242/idco-content-renderer` to `@quanghuy1242/idco-reader`'s `<Reader>`, via a tagged idco release and `dev:link`/`dev:unlink` per the cross-repo dance in CLAUDE.md. In-repo deletion only needs the story and tests repointed.

## 4. Target Model

### 4.1 The component cake: three layers, one shared base

```text
Reader / shared view substrate
├── L1  RSC-safe primitive layer + typography class contract   (packages/reader, the shared base)
│       pure node+baked → DOM for every block and mark; no directive, no hooks, no handlers
│       owns the .rt-* typography class contract (§4.3), the single source of block appearance
│       imported by the editor (resting render) AND the server reader (whole render)
├── L2a Server Reader              (packages/reader, the published read tier)
│       synchronous RSC: walks the projection adapter, renders L1 on the server, mounts L3 islands by registry
│       content-visibility virtualization; zero editor JS
├── L2b Editor view shell          (packages/editor/view, the editing tier)
│       wraps L1 with edit chrome, input, selection overlay, unmount-window virtualization;
│       its live editable host applies the L1 typography classes (§4.3)
└── L3  Client enhancement islands (packages/reader, opt-in, "use client")
        checklist toggle, live code surface, scroll-spy TOC
        hydrated selectively; never part of the static render
```

L1 is the shared truth, the only layer both tiers import. L2a and L2b are the two shells that never touch each other. L3 is opt-in interactivity beside the reader, attached by registry to specific baked objects. The cake direction matters: L1 is the lowest and lightest layer, and everything heavier depends down onto it, never the reverse (§7.2).

### 4.2 The RSC-safe primitive contract (L1)

L1 is a hard contract, not a convention, because of the `use client` boundary semantics: a `"use client"` directive marks a boundary, and **every import of that file is pulled into the client bundle** (the bundler's flight loader turns each export of a client module into a client reference). One client import anywhere in L1 taints the whole reader back into a client component. A primitive is admissible in L1 only if it obeys all of:

- No `"use client"` directive, no React hooks, no event handlers, no browser-only globals at module scope. A primitive is a pure function from `(node, baked, resolved)` to elements.
- No transitive client import. A primitive may import other L1 primitives, layout helpers, and pure utilities from `@quanghuy1242/idco-lib`, and nothing that carries `"use client"`. The import-boundary check (§7.5) is the mirror of 010 G3's editor-core purity rule.
- Deterministic output. Given the same node and baked fields, a primitive renders the same DOM on the server and on the client, so an editor that mounts it and a server that renders it produce the same markup. Anchor ids, numbering, and ordering come from the derived indexes (011 §11.4) passed in, never recomputed differently per context.
- Renders the baked field, never the live source. The code primitive renders `baked.html`, not source through Prism. The diagram primitive renders `baked.svg`, not a Mermaid runtime. This is what keeps L1 free of heavy libraries and identical to export.
- Sanitization is applied at the boundary, once. Baked HTML and SVG, and any pasted/author HTML, pass the single sanitizer (010 §10.5, the `Sanitizer` SPI in 011 §12.3) before L1 renders them. L1 trusts its inputs because the boundary already cleaned them; it does not re-sanitize and does not emit `dangerouslySetInnerHTML` over untrusted strings.

The editor's resting block render calls L1 directly for every block it is not actively editing. The active block, the one live object, and the selection overlay are L2b concerns that wrap or replace the L1 output for exactly one block at a time; every other mounted block in the editor is a bare L1 render, the same call the server reader makes.

### 4.3 Prose single-source: a tag-independent typography class contract

This section is the resolution of the prose-duplication finding (§3.2) and the core design decision of this rewrite. It is also the answer to "why is prose harder than objects."

**Why objects are already solved, and prose is not.** An object is edited *beside* its appearance: the baked view is a self-contained region (an image, a highlighted `<pre>`, a table), and the editing affordance is a separate transient surface — a popover, a `<textarea>` — mounted over or beside it (010 §6.2; the live surface is mounted for exactly one object at a time and re-bakes on exit). Because the static appearance is a distinct region from the editing surface, the editor and the reader can literally render **the same component** for it (the baked `RichTextMediaFigure`, `RichTextTable`, etc.), and they already do. Prose is different in kind: prose is edited *inside* its appearance. The caret, selection, and typing happen in the very element that displays the styled text, so the editable element **must be** the styled text element. The editor cannot render a static `<p>` and edit "over" it; it renders an editable `<div role="textbox">` that *is* the paragraph. Therefore the editor cannot reuse the reader's `<p>` component for prose — it can only reuse the *appearance*.

**The single source is a typography class contract, not a component and not `prose`.** L1 defines one set of typography classes keyed by block type and mark kind — call them the `.rt-*` contract — and that contract is the single source of block appearance. It is deliberately **tag-independent** (it styles by class, not by element name), which is the property that lets it apply to both a semantic `<p>` and an editable `<div role="textbox">`. The three contexts consume it as follows:

- **Reader (L2a)** renders the L1 prose primitive, which emits a semantic element with the class: `<p class="rt-block rt-p">…</p>`, `<h2 class="rt-block rt-h2">…</h2>`.
- **Editor at rest (L2b resting render)** renders the *same* L1 prose primitive — identical element, identical class.
- **Editor live (L2b editable host)** renders its editable host with the *same* class: `<div role="textbox" class="rt-block rt-h2" data-engine-block-type="heading" data-engine-heading="h2">…</div>`. The `data-engine-*` attributes remain for the engine's own logic (caret host lookup, block-type dispatch); the *appearance* now comes entirely from `rt-h2`, not from a parallel `[data-engine-block-type]` CSS block.

The class definitions live in **one stylesheet** owned by L1 (the `.rt-*` rules: font size/weight/line-height/margins per block type, the quote rule, list markers, callout box, and the inline mark styles). Per the `@idco/ui` side-effect-free rule and the "consumers own app-global CSS" rule in CLAUDE.md, L1 does not import the stylesheet as a module side effect; it **emits class names** and ships the stylesheet as an asset (and/or an exported CSS string, mirroring how the editor injects `ENGINE_SURFACE_SUPPRESS_CSS` today). The editor host and the reader host each include that one stylesheet. The editor's current `ENGINE_TYPOGRAPHY_CSS` per-type font sizing is **deleted** and replaced by the `.rt-*` classes; the engine keeps only its genuinely functional CSS (caret/selection suppression, `pre-wrap`, `user-select`), which is not appearance and not shared with the reader.

This makes the guarantee for prose exactly as strong as for objects, by a different mechanism: there is one definition of "what an h2 looks like," and live, resting, and reader all read it. A change to heading sizing is one edit to the `.rt-h2` rule, and all three move together. Drift is unrepresentable because there is no second place to drift from.

**Structural container chrome rides the same contract.** The callout box, the list markers, and the blockquote rule have the identical split today (editor injects CSS for `[data-engine-structural="callout"]`; reader uses `RichTextCallout`/`RichTextList`). They join the `.rt-*` contract the same way: L1 owns `.rt-callout`, `.rt-list`, `.rt-li`, the editor's structural container applies them, and the per-`data-engine-structural` appearance CSS is deleted. Tables already share `RichTextTable`, so only the table *frame* class needs to land in the contract; the cell grid is unchanged.

**What stays engine-only, deliberately.** Caret painting, selection overlay rects, the `caret-color: transparent` suppression, `white-space: pre-wrap`, and `user-select: none` are *functional* editor CSS, not appearance, and are not part of L1 — the reader neither has nor wants them. The class contract is appearance only.

### 4.4 Reader equals export tier plus opt-in islands

The export tier (010 §5.9) renders baked static fields only, with no interactivity, because EPUB/PDF cannot run JavaScript. The reader is that same static render delivered as HTML, with interactivity added back only where the product opts in: `Reader = Export(static baked render) + selective L3 islands`. This identity is load-bearing. The reader inherits export's "no heavy libraries, render the baked field" discipline for free, and any object with a correct baked field already reads correctly with zero additional work. An island is a pure enhancement over a baked object that already renders without it — a sortable grid is the baked HTML table plus a sort island, so with JavaScript off or before hydration the reader still shows the full table. The static render is always complete on its own; islands never gate content visibility.

### 4.5 The reader data pipeline and projection adapter

The server reader is a straight pipeline with no editing concepts in it.

```text
persisted document
   → projection adapter        (RichTextEditorDocument today; EditorDocumentSnapshot after §8)
   → resolve host data         (resolveMedia, resolvePost — the content-renderer resolvers, kept)
   → derive read indexes       (heading anchors, TOC entries — 011 §11.4 indexes, run server-side)
   → render L1 primitives       (Server Component tree, baked fields in, HTML out)
   → emit content-visibility    (per top-level block, with contain-intrinsic-size from baked dimensions)
   → mark island mount points   (registry-matched objects get a hydration boundary; §6)
```

Three properties pin it. The pipeline takes the document the editor already persists, so there is no reader-specific storage format and no second source of truth. It runs entirely on the server for static content, so prose and baked objects ship as HTML with no client JavaScript. The derived indexes (anchors, TOC) are the same ones the editor builds (011 §11.4), run here in a server pass, so a heading's anchor matches the editor's and a TOC link resolves to the same id; the reader does not invent a parallel anchoring scheme.

Reference blocks are reader-safe without a host call: docs/026 stores a denormalized `snapshot` on each reference node (`{ ref, snapshot }`), so the reader renders the stored snapshot statically and never calls the host at read time. `resolveMedia`/`resolvePost` remain as the host-data seam for deployments that want fresh resolution, but the default path is snapshot-only.

The projection adapter is the seam that absorbs the §8 persistence flip. The reader is written against the adapter's output, not the raw stored shape, so flipping storage from the Lexical-shaped compat JSON to `EditorDocumentSnapshot` swaps the adapter and leaves L1 and the pipeline untouched.

### 4.6 Two read artifacts: server Reader and editor read-mode

"Read-only" names two different artifacts; the tension dissolves once they are separated. They share L1 and differ in everything else.

- `<Reader>` (L2a, `packages/reader`) is the **published** read tier: a Server Component, ships no editor runtime, loaded by a reader of the finished book. This is the artifact "true server component reader" refers to.
- `<OwnedEditor mode="read">` (011 §12.1) is the **in-app preview**: a client component, the editor with editing suspended, for an author toggling between writing and previewing. It renders L1 with chrome and input switched off; it does not ship a second renderer.

Both resolve block N through L1, so the published reader matches the in-app preview matches the editing surface — the full triangle of §2.3. A host that only displays a finished book imports `packages/reader` and never loads the editor; the authoring app already has the editor loaded and previews in place. Neither path forks the visual.

## 5. Reader Virtualization: content-visibility Only

### 5.1 The editor's unmount-window is wrong for the reader

The editor virtualizes by unmounting offscreen blocks (011 §2.6), and it must, because it owns input and a selection that can span the gap, so it pays for cross-virtual selection painting (011 §8.5) and cross-virtual copy (010 §5.7) to keep correctness while blocks are absent from the DOM. That machinery exists to solve an editing problem: a live caret and a model selection over blocks the DOM no longer holds. The reader has none of that problem — no caret, no model selection over gaps, no input landing in an unmounted node. Inheriting the unmount-window would import all of its cost (client state, a windowing controller, cross-virtual copy, scroll restoration) to solve a problem the reader does not have, and it would forfeit the Server-Component nature, because client windowing is inherently stateful and cannot render once on the server.

### 5.2 content-visibility is the virtualization

The reader's virtualization is CSS, not JavaScript. Each top-level block gets `content-visibility: auto` with a `contain-intrinsic-size` placeholder. The browser then skips layout and paint for offscreen blocks while keeping them in the DOM, which is the entire performance win of virtualization (you do not lay out or paint thousands of blocks at once) without any of the editor's machinery. It is pure CSS, so it composes with Server Components and ships zero JavaScript. It keeps every block in the DOM, so the reader does not own selection, copy, or find. It degrades gracefully: a browser without `content-visibility` renders everything, which is correct, just less optimized.

### 5.3 The contain-intrinsic-size estimate is server-derived, zero JS

`contain-intrinsic-size` is the placeholder size the browser reserves for a skipped block; a wrong value makes the scrollbar lurch as blocks paint in. The estimate is derived **at render time from baked data, never measured at runtime**, so there is no client measurement loop, no `ResizeObserver`, no effect — nothing that would re-introduce a client dependency. Objects that carry dimensions give a real estimate (an image's intrinsic width/height ratio, a code block's line count times line height); prose falls back to a generic per-block estimate. A poor estimate costs only minor scroll-stability, not correctness, so the generic fallback is acceptable and the whole mechanism stays RSC-pure. Where the editor's persisted/baked data already carries a measured height, the adapter passes it through as the estimate; where it does not, the per-type default applies.

### 5.4 What stays native: find, select, copy, deep-link

Because every block stays in the DOM, the reader keeps the browser's native behaviors the editor had to re-implement. Native Ctrl/Cmd+F finds text in offscreen blocks, because `content-visibility: auto` content is still found by in-page search and is exposed to the accessibility tree. Native select-all and copy work across the whole document, including offscreen blocks, with no cross-virtual copy code. Native `::selection` painting works, with no overlay-rect painter. Anchor and TOC deep links scroll to offscreen headings — the browser forces layout on the target when you jump to it. So the reader sheds, rather than inherits, the three hardest editor surfaces (cross-virtual selection paint, cross-virtual copy, find-replacement UI); they were editor costs forced by the unmount-window, and the reader does not unmount.

### 5.5 JS windowing is an explicit non-goal

A JS-based client-windowing mode (the editor-style unmount-window without the editing parts) is **explicitly not built**, and this is a closed decision, not a deferral. It is stateful and client-only, it breaks native find and cross-window copy, and shipping it would directly contradict the light-server-native premise that is the whole point of `packages/reader`. The common technical book sits comfortably inside the `content-visibility` regime, so the reader's only virtualization is `content-visibility`. If some genuinely pathological document (tens of thousands of blocks beyond what `content-visibility` keeps smooth) ever forces the question, that is a separate opt-in mode that inverts the package's value proposition, and it would be revisited only against a concrete, measured need — outside the default package and with the trade stated to the deployment. It is documented here as a boundary the reader deliberately does not cross, not a backlog item.

## 6. The Island Model

### 6.1 Static by default, island by exception

The reader renders static by default and hydrates an island only where the product opts into interactivity (006 §5.7). The default is a fully static page: prose, baked code, baked diagrams, baked tables, all server-rendered HTML with no JavaScript. An island is the exception, attached to a specific baked object whose static form is already complete, adding behavior on top: a sort control over a baked table, a pan-zoom over a baked diagram, a filter over a baked grid, a checkbox toggle over a baked checklist, scroll-spy over the baked TOC. The invariant that keeps this honest is that the static render is always complete on its own: with JavaScript disabled, before hydration, or if an island fails to load, the reader still shows the full table, the full diagram, the full checklist. Content visibility never depends on an island.

### 6.2 The island registry mirrors the block registry

The editor has a node registry (docs/016, the `NodeView`/`NodeDefinition` SPI) that owns parse, normalize, bake, and the live-edit surface for each object kind. The reader has a parallel, smaller registry that owns the **read-tier island** for each kind, and the two are deliberately symmetric: the same `kind` string that selects a `NodeView` in the editor selects a `ReaderIsland` in the reader.

```text
interface ReaderIsland<Data> {
  kind: string;                                  // matches the editor node kind
  // the static, server-rendered baked view (L1); always present, JS-free
  Static: (props: { data: Data; baked: BakedSnapshot }) => ReactNode;
  // the optional client enhancement, hydrated over the Static output
  Interactive?: ReactComponentType<ReaderIslandProps<Data>>;
  hydrate?: "visible" | "idle" | "interaction";  // when to hydrate; default: none (stay static)
}
```

An object kind with no `Interactive` is pure static, the common case. A kind with an `Interactive` and a `hydrate` policy becomes an island. Because the key is the shared `kind`, the reader's interactive grid and the editor's live grid are registered against the same identity and reference the same baked field, so they cannot show different data, and the boundary 010 §12 left open (how much of a live object surface is shared with the reader) is answered concretely: the **baked field and the `kind` are shared**, the **editor live-edit surface and the reader island are separate components** behind that shared identity, each minimal.

### 6.3 Hydration boundaries and the children-slot pattern

Each island declares a hydration policy so the reader spends client JavaScript only where it buys interactivity, and only when the reader reaches it. `visible` hydrates when the island scrolls into view (pairing naturally with `content-visibility`, since both key off viewport proximity); `idle` hydrates after first paint when the main thread is free; `interaction` hydrates on first user intent. The default is no hydration, static forever.

The mechanism uses the RSC children-slot pattern: the server renders the static L1 output, and passes it as `children` into the island's `"use client"` shell. React renders Server Component children on the server ahead of time and embeds the result in the RSC payload, with the client island as a placeholder around it. So the static markup is server-rendered and only the island shell hydrates over it — the island enhances, it never re-renders a different tree (which would be a hydration mismatch). The result is a page whose JavaScript cost scales with how much interactivity the author used, not with document size: a 5,000-block prose chapter with no interactive objects ships zero island JavaScript.

## 7. Packaging: packages/reader, And Retiring content-renderer

### 7.1 Why a dedicated package and not a folder in the editor

The reader cannot live inside the editor package, for a mechanical reason: the editor package is client-heavy (EditContext, the selection overlay, the live code surface, the scheduler), and much of it carries `"use client"` or transitively imports modules that do. A Server-Component reader importing anything from a package whose entrypoints drag in that client code risks pulling the editor runtime into the server bundle or tripping the RSC client-boundary rules, and tree-shaking does not save this reliably because `"use client"` boundaries and side-effecting imports are not always shaken. So the reader gets its own package, `packages/reader`, holding L1, L2a, and L3, at the bottom of the dependency graph where both the heavy editor and the light server reader can depend onto L1 without either dragging the other along.

### 7.2 The dependency direction is the whole point

```text
@quanghuy1242/idco-lib          (pure helpers, RSC-safe)
        ▲                ▲
        │                │
packages/reader (L1)     │       L1 = RSC-safe primitives + .rt-* class contract, no client imports
   ▲          ▲          │
   │          │          │
L2a Reader   L3 islands  │       both in packages/reader; islands are "use client"
   (server)  (client)    │
                         │
        packages/editor (L2b view shell)  →  imports packages/reader L1 for resting render + classes
```

The editor depends on the reader's L1, never the reverse. L1 depends only on `@quanghuy1242/idco-lib` and other L1 modules, so it stays RSC-safe and importable from a Server Component. L3 islands are `"use client"` and live beside the server reader, but L2a imports them only through hydration boundaries, not into its own server module scope. The editor's heavy client code sits at the top of the graph where nothing the reader imports can reach it.

### 7.3 Package layout and exports

`packages/reader` exposes two import surfaces so a Server-Component consumer never pulls island JS by importing the reader, and `"use client"` boundaries are explicit. The directive is placed at island entry points (the library-author practice), and the build must preserve it (some bundlers strip it).

```text
packages/reader/
  src/
    l1/                      # RSC-safe primitives; the package's default/server-safe surface
      index.ts               # exports RichText* primitives, the typography class names, the CSS asset path
      blocks/                # paragraph, heading, list, blockquote, callout, table, code, media, embed, post-ref
      marks/                 # strong, em, code, link, mark, glossary, comment-static
      typography.css         # the single .rt-* stylesheet (the class contract)
      typography.ts          # the .rt-* class-name constants (so the editor references them, not string literals)
    reader/
      Reader.tsx             # <Reader> server component (L2a), synchronous; NO "use client"
      adapter.ts             # projection adapter: RichTextEditorDocument -> reader nodes (snapshot later)
      indexes.ts             # server-side derived indexes (anchors, TOC), reusing 011 §11.4 logic
      resolvers.ts           # resolveMedia / resolvePost seams, moved from content-renderer
    islands/                 # "use client" entry; only imported through hydration boundaries
      index.ts               # "use client"
      checklist.tsx
      live-code.tsx
      scroll-spy-toc.tsx
      registry.ts            # the ReaderIsland registry (§6.2)
  package.json               # exports map: "." -> l1+reader (server-safe); "./islands" -> client entry
```

The `package.json` `exports` map separates the server-safe surface (`.`) from the client island surface (`./islands`), so a server-only consumer that renders static content never resolves the island module graph. `typography.ts` exports the `.rt-*` class-name constants so the editor imports the *names* (not duplicated string literals) and applies them to its editable host, and `typography.css` is the single stylesheet both hosts include.

### 7.4 What moves, what is reclaimed, what is retired

- **Retired and deleted:** `@quanghuy1242/idco-content-renderer` (`packages/content-renderer`). Its job — walking the projection and rendering each node — is the server reader's job, done RSC-native. Its `resolveMedia`/`resolvePost` resolvers and its `renderers` override map move to `packages/reader/src/reader/resolvers.ts` and the island registry. The package is removed, not extended.
- **Reclaimed (relocated):** the RSC-safe `RichText*` primitives are re-homed as L1 in `packages/reader` (re-implemented self-contained: semantic element + `.rt-*` class, no `Text`/`Alert`/`AriaLink`/`CodeEditor`/`NavIcon` dependency, so L1 carries no `"use client"`). The pure primitives (paragraph, heading, list, blockquote, callout, baked code, baked table, media figure, embed, post-ref, inline marks) are the static base; the interactive behaviors (`RichTextCheckListItem`'s toggle, the live code surface, `RichTextTocRail`'s scroll-spy) become L3 islands while their static visual stays an L1 primitive. **Sequencing correction (2026-06-24):** deleting the primitives *from* `@quanghuy1242/idco-ui` cannot happen at R1 as first drafted — `packages/editor-legacy` (the Lexical editor) still renders through the `@idco/ui` `RichText*` (six files: `RichTextEditorComposer`, `RichTextEditor`, `model/normalize`, `nodes/table-of-contents-node`, `plugins/toc-entries`, `plugins/table-plugin`), as does `tests/ui/rich-text-content.test.tsx`. So the `@idco/ui` copies stay until `editor-legacy` is retired (R7, §8); until then there are two implementations, with the owned editor + the reader on the L1 copy and only the legacy editor on the `@idco/ui` copy. Removing the `@idco/ui` primitives is therefore folded into R7, not R1/R6.
- **Repointed:** the editor's object `renderResting` functions (`media.tsx`, `table.tsx`, `embed.tsx`, `post-ref.tsx`, `code-block.tsx`, `table-of-contents.tsx`) import their `RichText*` primitive from `packages/reader` (L1) instead of `@quanghuy1242/idco-ui`. The editor's prose resting render and live editable host adopt the `.rt-*` classes (§4.3, §11.3).
- **Kept where it is:** `@quanghuy1242/idco-ui` remains the app-wide UI library for the authoring app's own chrome (buttons, dialogs, the toolbar). It no longer owns the `RichText*` read primitives.

### 7.5 The import-boundary lint

An architecture lint (extending the existing oxlint plugin at `scripts/oxlint-js-plugins/architecture.js`, wired in `.oxlintrc.json`) enforces the one rule that makes the RSC boundary hold: **nothing under `packages/reader/src/l1/**` or `packages/reader/src/reader/**` may import a `"use client"` module, a React hook, or a browser global at module scope.** This is the mirror of the editor-core purity rule (010 G3). Without it, the boundary rots the first time someone adds a convenience `useState` to a primitive, and the failure is silent bundle bloat or a broken server build, not a loud error.

## 8. Retiring Lexical Through The Reader

Lexical lives in two relevant places: the standard editor (`packages/editor-legacy/src/RichTextEditor.tsx`) and the Lexical-shaped `RichTextEditorDocument` JSON that is both the owned editor's compat projection and the document the reader consumes today. The reader touches the second. The retirement is staged through the projection adapter (§4.5). While Lexical is alive, the reader consumes the Lexical-shaped projection through the adapter, and the owned editor emits that same projection (`compatFromEditorStore`/`compatFromSnapshot`), so the reader and any legacy producer agree on every byte. When the owned editor reaches parity and persistence flips to `EditorDocumentSnapshot` (010 §12's persistence-format decision), the adapter switches to read the owned snapshot directly, L1 and the pipeline do not change, and the Lexical-shaped projection stops being a runtime format. At that point `packages/editor-legacy` and its Lexical dependency are removed: the owned editor is the only editor, the server reader the only reader, `EditorDocumentSnapshot` the only persisted shape. The reader never depended on Lexical, only on the adapter's output, so retiring Lexical leaves the read tier intact.

## 9. Architecture Decisions

- **Decision: share a primitive layer, not an engine.** The reader and editor share L1 (pure node-to-DOM primitives plus the `.rt-*` class contract) and nothing above it. This removes read-versus-edit drift by component/appearance identity (§2.2, §4.3) while keeping the reader free of the editor's client runtime. Rejected: reusing the editor in read-only mode as the published reader, which would ship the editing runtime to read a page and forfeit Server Components.
- **Decision: prose shares a tag-independent class contract, not a component.** Because prose is edited inside its styled element, the editable `<div role="textbox">` cannot be the reader's `<p>` and cannot be styled by `prose` (tag-targeted). L1 owns a single `.rt-*` stylesheet that the reader's semantic primitive, the editor's resting primitive, and the editor's editable host all apply (§4.3). Rejected: keeping `prose` for the reader and matching it with separate engine CSS (two sources, guaranteed to drift — the current bug); rejected: making the editable host a semantic element to force literal component identity (invasive to the EditContext/caret host, real contenteditable risk, and unnecessary once the class is shared).
- **Decision: the reader is a true Server Component for static content.** Prose and baked objects render to HTML on the server with zero client JavaScript; interactivity is opt-in islands (§4.4, §6). Rejected: a client-rendered reader, which the current `content-renderer` is only by the accident of one no-op checkbox (§3.1).
- **Decision: virtualize the reader with `content-visibility` only.** The reader keeps every block in the DOM and lets the browser skip offscreen layout/paint (§5.2), preserving native find, select, copy, and deep-link (§5.4) and staying RSC-compatible. Rejected entirely (not deferred): JS client windowing, which is stateful, client-only, breaks native find/copy, and contradicts the light-server-native premise (§5.5).
- **Decision: reader = export tier + opt-in islands.** The reader inherits export's "render the baked field, run no heavy libraries" discipline, so any object with a correct baked field reads correctly for free (§4.4). Rejected: re-deriving live renders in the reader (Prism/Mermaid client-side), which would duplicate the editor's live surfaces and re-open the drift the bake model closes.
- **Decision: a dedicated `packages/reader`, with the editor depending onto it.** L1 sits at the bottom of the dependency graph so both tiers depend down onto it (§7.1, §7.2). The `RichText*` primitives relocate from `@idco/ui` to L1. Rejected: folding the reader into the client-heavy editor package; rejected: leaving the primitives in `@idco/ui` and importing them into a Server Component (risks pulling `@idco/ui`'s client modules across the boundary).
- **Decision: delete `content-renderer`, do not extend it.** It is a client component by accident and welded to the Lexical-shaped JSON being retired; the server `<Reader>` replaces it and its resolvers/override-map seams move to L1 (§3.1, §7.4). Rejected: de-client-ing `content-renderer` in place, which would invest in a renderer tied to a dying format.
- **Decision: the island registry mirrors the editor node registry by `kind`.** Identity and baked data are shared; the editor live-edit surface and the reader island are separate, minimal components behind that identity (§6.2), closing 010 §12's open boundary.

## 10. Implementation Strategy

The build is sequenced so each phase is reviewable, testable, and leaves `pnpm check` green. Phases R0–R2 are in-repo and carry the correctness win (single-source appearance) before any package is published. R3–R5 build the server reader. R6 deletes `content-renderer` and triggers the cross-repo repin. R7 and §12 are sequenced after their prerequisites.

- **R0 — Scaffold + the class contract.** Create `packages/reader` with the `l1` surface and the `.rt-*` typography stylesheet + class-name constants. No consumers yet. This is the single source of appearance; everything else points at it.
- **R1 — L1 primitives, relocated.** Move the RSC-safe `RichText*` primitives from `@idco/ui` into `packages/reader/src/l1`, splitting the three interactive widgets' static halves from their behavior. `@idco/ui` re-exports nothing read-related afterward.
- **R2 — Repoint the editor onto L1 (the correctness milestone).** The editor's object `renderResting` imports L1; the editor's prose resting render renders the L1 prose primitives; the editor's live editable host and structural containers apply the `.rt-*` classes; delete the per-type appearance CSS from `ENGINE_TYPOGRAPHY_CSS`. Prove live = rest = reader.
- **R3 — Server `<Reader>` + adapter + content-visibility.** Build L2a against the `RichTextEditorDocument` adapter, server-side indexes, resolvers, and `content-visibility` emission.
- **R4 — Islands.** Build the L3 registry and the checklist / live-code / scroll-spy-TOC islands with the children-slot hydration pattern.
- **R5 — Import-boundary lint.** Add the L1 purity rule to the architecture plugin; make CI fail on any client import reaching L1.
- **R6 — Delete content-renderer + cross-repo repin.** Repoint the Ladle story and tests to `<Reader>`; delete `packages/content-renderer`; tag an idco release; repin the product repo from `idco-content-renderer` to `idco-reader`.
- **R7 (future, gated on persistence flip) — Snapshot adapter + Lexical removal.** Swap the adapter to `EditorDocumentSnapshot`; remove `packages/editor-legacy`.

## 11. Detailed Plans

### 11.1 L1 typography class contract

Current problem: prose and container-chrome appearance is defined twice — `ENGINE_TYPOGRAPHY_CSS` in `packages/editor/src/view/styles.ts` (editor) and the `prose`-dependent `RichText*` components in `@idco/ui` (reader) — and they drift (§3.2).

Target behavior: one stylesheet (`packages/reader/src/l1/typography.css`) defines `.rt-block` plus per-type `.rt-p`, `.rt-h1`..`.rt-h4`, `.rt-quote`, `.rt-list`, `.rt-li`, `.rt-callout` (+ tone variants), and mark classes `.rt-strong`, `.rt-em`, `.rt-underline`, `.rt-strike`, `.rt-code`, `.rt-link`, `.rt-mark`, `.rt-glossary`. `typography.ts` exports the class-name constants. The values are ported from the current `ENGINE_TYPOGRAPHY_CSS` and the `RichText*` classes, reconciled into one definition that reproduces today's appearance.

Tasks: author the stylesheet and constants; document that hosts include the stylesheet once (editor host injects it where it injects `ENGINE_SURFACE_SUPPRESS_CSS`; reader host imports the asset); keep functional editor CSS (caret/selection/pre-wrap/user-select) out of the contract.

Edge cases: alignment (`attrs.format` → `text-align`) and indent must compose with the classes (they are inline style/utility today and stay so, applied on top of `.rt-*`); DaisyUI theme tokens used by callout tones must resolve in both the editor surface and the reader article.

### 11.2 L1 primitives and the relocation from @idco/ui

Current problem: the read primitives live in `@idco/ui/src/rich-text-content.tsx` under a `"use client"` directive (line 5), so they cannot be imported into a Server Component.

Target behavior: the pure primitives move to `packages/reader/src/l1/blocks` and `.../marks`, with no directive and no hooks, each emitting its semantic element + `.rt-*` class. The three interactive widgets split: `checklist` checkbox, `live-code`, and `scroll-spy TOC` behavior move to `packages/reader/src/islands`; their static visual stays in L1.

Tasks: move and de-client the primitives; replace `prose`-ancestor reliance with explicit `.rt-*` classes; update `@idco/ui` to stop exporting the read primitives; update `@idco/ui` consumers (the editor, §11.3) accordingly.

Edge cases: anything in the primitives reading a browser global or hook must be quarantined into an island; `RichTextMediaFigure`/`RichTextEmbed`/`RichTextPostReference` must render purely from the resolved snapshot.

### 11.3 Repointing the editor onto L1

Current problem: the editor object renders import `RichText*` from `@idco/ui`; the editor prose resting render hand-rolls `<p>`/`<h>`/`<blockquote>` with `ENGINE_TYPOGRAPHY_CSS`; the live editable host is styled by the same per-type CSS.

Target behavior: object `renderResting` imports L1 primitives from `packages/reader`; `resting-document.tsx` prose arms render the L1 prose primitives (semantic + `.rt-*`); the live editable `<div role="textbox">` and the structural container divs apply the `.rt-*` classes via the exported constants; the per-type appearance rules are removed from `ENGINE_TYPOGRAPHY_CSS`, leaving only functional CSS.

Tasks: swap the object-node imports; rewrite the prose arms of `resting-document.tsx` to call L1; apply `.rt-*` in `text-block.tsx`/`styles.ts` (`blockStyleFor`) and in the structural container render (`block-dispatch.tsx`, callout/list views); delete the per-type font/box CSS from `ENGINE_TYPOGRAPHY_CSS`; keep the resting measurement attributes (`data-engine-resting-block`, the block id + ref for the virtual window) by wrapping the L1 primitive in the measurement container or threading the attributes through it.

Edge cases: the virtual window measures resting blocks via `registerBlock`, so the L1 primitive must accept (or be wrapped to carry) the block-id attribute and ref; alignment and indent must still flow as props/inline style on top of the class; the editor's resting object render must keep the baked-fallback behavior (`renderRestingObject`).

Acceptance: a heading, paragraph, quote, list, callout, and table look pixel-identical in the live editor, the editor at rest, and the reader; changing one `.rt-*` rule moves all three.

### 11.4 The server Reader, adapter, and pipeline

Current problem: there is no server reader; `content-renderer` is the client renderer.

Target behavior: `Reader.tsx` is a synchronous Server Component (its `resolveMedia`/`resolvePost` are sync; it awaits nothing — reference blocks render the stored snapshot, §4.5) that takes the persisted document, runs it through `adapter.ts` (`RichTextEditorDocument` → reader nodes), resolves host data via `resolvers.ts`, derives anchors/TOC server-side via `indexes.ts` (reusing 011 §11.4 logic), renders the L1 tree, emits `content-visibility` + `contain-intrinsic-size` per top-level block, and marks island mount points by `kind`.

Tasks: implement the adapter against the compat shape (mirroring `content-renderer`'s node walk, but RSC-native and via L1); port `resolveMedia`/`resolvePost` and the `renderers` override map; implement the server index derivation; implement the `content-visibility` wrapper with the baked-dimension estimate (§5.3); wire the island mount points (§6.3).

Edge cases: missing/invalid baked field renders the explicit fallback (§13), never nothing; reference-block snapshot is rendered without a host call; the adapter is the only place that knows the compat shape, so the snapshot flip (R7) touches only it.

### 11.5 Islands

Current problem: the checklist checkbox, live code, and scroll-spy TOC are the only interactive read widgets, and they currently force the whole reader client.

Target behavior: `islands/registry.ts` holds the `ReaderIsland` registry keyed by `kind`; `checklist.tsx`, `live-code.tsx`, `scroll-spy-toc.tsx` are `"use client"` enhancements that hydrate over the static L1 output via the children-slot pattern (§6.3), each with a `hydrate` policy. The `./islands` export is a separate entry so the server surface never resolves them unless used.

Tasks: build the registry; build the three islands; implement the hydration boundary wrappers (`visible`/`idle`/`interaction`); ensure the build preserves the `"use client"` directive on the island entry.

Edge cases: an island's `Interactive` initial render must match the server `Static` markup (no hydration mismatch); an island that fails to load leaves the static content intact; a `kind` with no island degrades to the static baked render.

### 11.6 Deleting content-renderer and the cross-repo repin

Current problem: `content-renderer` is still wired in `tsconfig.json`, `vitest.config.ts`, the Ladle story, tests, and `packages/editor/package.json`; the product repo imports the published package.

Target behavior: in-repo, the story and tests render `<Reader>`; the path aliases and the vestigial editor dependency are removed; `packages/content-renderer` is deleted. Cross-repo, the product repo repins from `@quanghuy1242/idco-content-renderer` to `@quanghuy1242/idco-reader`.

Tasks: repoint the story and tests; remove aliases and the vestigial dep; delete the package; bump every publishable package version to one `X.Y.Z`, tag, and publish (per CLAUDE.md); in the product repo, `dev:link`, prove `pnpm check`, swap the import, `dev:unlink` to repin the registry.

Edge cases: the product repo's reader usage (resolvers, any `renderers` overrides) must map onto the new `<Reader>` props; the publish workflow verifies tag == every package version.

## 12. Reader-Side Annotation Access: Glossary And Comments

> Status: reader-tier follow-up for docs/027. Downstream of docs/027's comment + glossary build (note.md item 3); it cannot lead, because it renders data those features produce. The owned engine already stores the data this needs (the glossary collection travels in the snapshot; a comment mark carries a denormalized snapshot), so this is render work on L1, not a new model.

The owned engine renders two annotation marks (docs/027 §6.1, §7.5): a **glossary** mark, a reference to a term in `document.collections.glossary`, and a **comment** mark, a highlighted span carrying `attrs.thread` plus a thin `attrs.snapshot` (`{ author, excerpt, resolved }`). In the editor these are live (click → popover → route to the dock, docs/027 §16 P6). In the reader they stay read-only and RSC-safe — the "render the denormalized field, call nothing" discipline this tier already lives by (§4.4). The line is docs/027 §2.1's content/metadata line: glossary is **content** the reader renders fully; comments are **metadata** the reader renders only as far as the snapshot allows, never by calling the host.

**Glossary is content — render it from the snapshot, fully.** The glossary collection travels inside `EditorDocumentSnapshot.collections.glossary` (docs/027 §5.1), so the reader holds every term and definition with no host call. L1's glossary-mark primitive resolves the definition for `attrs.term` and emits `<abbr class="rt-glossary" title={definition}>` — the native hover affordance, from the single source so the inline mark and any generated back-matter glossary cannot disagree. The definition map is server-built and threaded to L1 the way the editor threads the document index: a small RSC-safe provider or render prop, never a client hook, so L1 stays pure (§13 "L1 purity erosion").

**Comments are metadata — render only the snapshot, never the host.** The reader must not call the comment source; doing so would make the page non-static and re-open the drift the bake model closes. L1 paints a comment range from `attrs.snapshot` alone: a non-interactive highlight, optionally a static margin note showing the snapshot's author and excerpt, and a resolved thread dimmed or hidden (a deployment choice). There is no reply, resolve, or thread fetch in the reader. A comment whose snapshot is absent degrades to a plain (or no) highlight, never a blank or a fetch. The only interactive variant — a published book that *wants* reader-side comment reading — is the island exception (§6.2), keyed by the comment `kind`, hydrating over the same static highlight L1 emitted.

## 13. Edge Cases And Failure Modes

- **L1 purity erosion.** One careless `"use client"` import into L1, or one hook added to a primitive for convenience, taints the whole reader back into a client component and silently breaks the Server-Component guarantee. The import-boundary lint (§7.5) must fail CI on any client import reaching L1, the same severity as the editor-core purity rule.
- **Typography contract drift between editor host and reader host.** If the editor injects the `.rt-*` stylesheet from a stale copy while the reader imports the canonical one, the single source splits again. The class-name constants and the stylesheet must ship from L1 only; the editor must reference the exported names, never re-declare them, and both hosts must load the same `typography.css`. The lint should flag any `[data-engine-block-type]` appearance rule re-appearing in the editor CSS.
- **Baked-field staleness.** The reader renders the baked field, so a field that drifted from its source (an object edited without re-baking) shows the reader stale content. This is an editor invariant (010 §11), but the reader is where staleness becomes visible, so L1 must render an explicit fallback for a missing or invalid baked field rather than rendering nothing or a broken artifact.
- **content-visibility height jumps.** A wrong `contain-intrinsic-size` makes the scrollbar lurch as blocks render in. The estimate must come from baked dimensions or the per-type default (§5.3); it must never require a client measurement loop, which would re-introduce a client dependency.
- **Anchor and TOC divergence.** If the reader derives heading anchors or TOC entries differently from the editor, a TOC link or a deep link resolves to a different id than the author saw. The reader must run the same derived-index logic (011 §11.4) server-side, not a parallel implementation.
- **Sanitization gaps on baked HTML/SVG.** Baked Mermaid SVG, grid HTML, and pasted author HTML are rendered by L1 on every tier including export. The single sanitizer (010 §10.5) must clean them at the boundary before L1 renders them; a gap here is an XSS hole that ships to every reader. L1 itself must not decide sanitization.
- **Island hydration mismatch.** A hydrated island must hydrate over markup identical to what the server rendered, or React throws. The island's `Static` output and its `Interactive` initial render must agree on the baked DOM; the island enhances, it does not re-render a different tree.
- **`"use client"` stripped by the build.** A bundler that strips the directive from the island entry breaks the boundary. The reader's build must be configured to preserve `"use client"` and verified in the published artifact.
- **Two registries to keep in step.** The editor node registry and the reader island registry are keyed by the same `kind`; a new kind needs an entry in both or it bakes without a reader island, or gains an island with no editor support. A missing counterpart degrades to the static baked render, never to a blank.
- **Cross-repo version skew.** Deleting `content-renderer` while the product repo still imports it breaks the product build. The repin must follow the tagged release and `dev:link` proof in CLAUDE.md, not a hand-edit of `node_modules`.

## 14. Implementation Backlog

### R0-A. Scaffold packages/reader and the typography class contract

Scope:

- `packages/reader/package.json`, `tsconfig*`, build config (preserve `"use client"`).
- `packages/reader/src/l1/typography.css`, `packages/reader/src/l1/typography.ts`.
- root `tsconfig.json`, `vitest.config.ts` path aliases.

Tasks:

- [ ] Create the package at the bottom of the dependency graph; depend only on `@quanghuy1242/idco-lib` and React.
- [ ] Author the `.rt-*` stylesheet by reconciling `ENGINE_TYPOGRAPHY_CSS` and the `RichText*` classes into one definition that reproduces current appearance.
- [ ] Export the class-name constants from `typography.ts`.

Acceptance criteria:

- The package builds and exports the class names and the CSS asset; no runtime consumers yet.

Tests:

- `pnpm build` for the package; a snapshot test asserting the class-name constants are stable.

### R1-A. Relocate L1 primitives, split the interactive widgets

Scope:

- `packages/reader/src/l1/blocks/**`, `packages/reader/src/l1/marks/**`.
- `packages/ui/src/rich-text-content.tsx` (remove read primitives + `"use client"`).

Tasks:

- [ ] Move the pure `RichText*` primitives into L1, emitting semantic element + `.rt-*` class, no directive/hooks.
- [ ] Split the checklist checkbox, live code, and scroll-spy TOC behavior out (their static visuals stay L1; behavior to R4).
- [ ] Remove the read primitives from `@idco/ui` and update its exports.

Acceptance criteria:

- L1 has no `"use client"`, no hooks, no handlers; `@idco/ui` no longer exports read primitives.

Tests:

- A test importing every L1 primitive in a Node (non-DOM) context to prove server-safety; `pnpm check`.

### R2-A. Repoint the editor onto L1 (the correctness milestone)

Scope:

- `packages/editor/src/view/nodes/*` (object `renderResting` imports).
- `packages/editor/src/view/render/resting-document.tsx` (prose arms).
- `packages/editor/src/view/render/block-dispatch.tsx`, `text-block.tsx`, `styles.ts` (live host + structural classes; delete per-type appearance CSS).

Tasks:

- [ ] Object `renderResting` imports L1 primitives from `packages/reader`.
- [ ] Prose resting render calls L1 prose primitives; live editable host + structural containers apply `.rt-*` via the exported constants.
- [ ] Delete the per-type font/box rules from `ENGINE_TYPOGRAPHY_CSS`; keep only functional CSS.
- [ ] Preserve resting measurement attributes (`data-engine-resting-block`, block id, ref) by wrapping/threading.

Acceptance criteria:

- Heading/paragraph/quote/list/callout/table are pixel-identical across live, rest, and reader; one `.rt-*` edit moves all three.

Tests:

- Editor resting render tests assert the L1 classes are present; a visual/DOM test comparing live host classes and resting primitive classes; `pnpm check`.

### R3-A. Server Reader, adapter, indexes, content-visibility

Scope:

- `packages/reader/src/reader/{Reader.tsx,adapter.ts,indexes.ts,resolvers.ts}`.

Tasks:

- [ ] Implement `<Reader>` as a (synchronous) Server Component (no `"use client"`).
- [ ] Implement the `RichTextEditorDocument` adapter; port `resolveMedia`/`resolvePost` and the `renderers` override map.
- [ ] Derive anchors/TOC server-side reusing 011 §11.4 logic.
- [ ] Emit `content-visibility` + `contain-intrinsic-size` per top-level block from baked dimensions / per-type default.

Acceptance criteria:

- `<Reader>` renders a document to static HTML with zero client JS for prose + baked objects; anchors match the editor's.

Tests:

- Server-render tests (render to string) asserting markup, classes, anchors, and the `content-visibility` style; a test that the static output contains no script for a prose-only doc.

### R4-A. Islands

Scope:

- `packages/reader/src/islands/{index.ts,registry.ts,checklist.tsx,live-code.tsx,scroll-spy-toc.tsx}`.

Tasks:

- [ ] Implement the `ReaderIsland` registry keyed by `kind`.
- [ ] Build the three islands as `"use client"` enhancements with `hydrate` policies, using the children-slot pattern.
- [ ] Expose them under the `./islands` export only.

Acceptance criteria:

- A doc with no interactive objects ships zero island JS; an island hydrates over identical static markup; a missing island degrades to static.

Tests:

- A hydration test (server markup == island initial render); a test that the server surface does not resolve the island module graph.

### R5-A. Import-boundary lint

Scope:

- `scripts/oxlint-js-plugins/architecture.js`, `.oxlintrc.json`.

Tasks:

- [ ] Add a rule failing on any `"use client"` import, React hook, or module-scope browser global under `packages/reader/src/l1/**` and `.../reader/**`.
- [ ] Add a rule flagging re-introduced `[data-engine-block-type]` appearance CSS in the editor.

Acceptance criteria:

- A deliberately added client import under L1 fails `pnpm lint`.

Tests:

- A fixture that violates the rule and is expected to fail; `pnpm lint`.

### R6-A. Delete content-renderer (in-repo) + cross-repo repin

Scope:

- `stories/content-renderer.stories.tsx`, `tests/**`, `tsconfig.json`, `vitest.config.ts`, `packages/editor/package.json`, `packages/content-renderer/**`.
- Product repo (cross-repo): the reader import site.

Tasks:

- [ ] Repoint the story and tests to `<Reader>`; remove path aliases and the vestigial editor dep.
- [ ] Delete `packages/content-renderer`.
- [ ] Bump all publishable package versions to one `X.Y.Z`, tag, publish.
- [ ] In the product repo: `dev:link`, prove `pnpm check`, swap `idco-content-renderer` → `idco-reader`, `dev:unlink`.

Acceptance criteria:

- `pnpm check` green in idco with `content-renderer` gone; product repo builds against `<Reader>`.

Tests:

- `pnpm check`; product-repo `pnpm check` under `dev:link`.

## 15. Future Backlog

### R7-A. Snapshot-native adapter + Lexical removal (gated on the persistence flip)

Scope:

- `packages/reader/src/reader/adapter.ts`; `packages/editor-legacy/**`.

Tasks:

- [ ] Add an `EditorDocumentSnapshot` adapter path; switch the default once persistence flips (010 §12).
- [ ] Remove `packages/editor-legacy` and its Lexical dependency.

Acceptance criteria:

- The reader renders from `EditorDocumentSnapshot` with no change to L1; Lexical is gone from the workspace.

### §12 follow-up. Reader-side glossary and comment rendering (downstream of docs/027)

Scope:

- `packages/reader/src/l1/marks/{glossary,comment-static}.tsx`; the optional comment island.

Tasks:

- [ ] Glossary `<abbr title>` from the snapshot's collection, single-source with any back-matter.
- [ ] Static comment highlight + optional margin note from `attrs.snapshot`; no host call.
- [ ] Optional comment-reading island for deployments that opt in.

Acceptance criteria:

- Editing a glossary definition once updates inline and back-matter together; comment highlights render from the snapshot with zero host calls; a missing comment source changes nothing in the reader.

## 16. Test And Verification Plan

- **L1 server-safety:** import every L1 primitive in a non-DOM context; assert no `"use client"`, no hooks (the import-boundary lint + a Node import test).
- **Appearance identity (the core guarantee):** assert the editor live host, the editor resting primitive, and the reader primitive emit the same `.rt-*` classes for each block type; a single `.rt-h2` edit changes all three render outputs in test.
- **Server render:** render a representative document with `<Reader>` to a string; assert prose, baked objects, anchors, TOC, and `content-visibility` styles; assert zero `<script>` for a prose-only document.
- **Islands:** hydration-match test (server markup equals island initial render); island module graph absent from the server-only import surface; static-complete-without-JS assertion.
- **Reference + annotation:** reference blocks render from snapshot with no resolver call; glossary `<abbr title>` and static comment highlight render from the snapshot (when §12 lands).
- **Gate:** `pnpm check` green at each phase; product-repo `pnpm check` under `dev:link` before the R6 repin.

## 17. Definition Of Done

- `packages/reader` exists with L1 (RSC-safe primitives + `.rt-*` contract), L2a (`<Reader>`), and L3 (islands), at the bottom of the dependency graph.
- The editor's static object renders go through L1, and the **live** editable host applies the `.rt-*` classes for the migrated prose blocks (heading/quote), with the duplicated heading/quote rules deleted from the live `ENGINE_TYPOGRAPHY_CSS` and `RICH_TEXT_TYPOGRAPHY_CSS` injected on the surface — so **live = reader** for those blocks (single source). Carried follow-ups, deliberately staged (status note below): the editor's RestingDocument **preview** still uses `ENGINE_RESTING_TYPOGRAPHY_CSS` (a third source whose values match today; its migration onto L1 lands with the L1-endgame, since the published `<Reader>` — not the in-app preview — is the tier that matters); inline marks and the callout/list **container chrome** keep their editor CSS (different live DOM than the reader's static primitive); and the `@idco/ui` primitive removal is gated on R7 (above). The published `<Reader>` is the single source for the read tier today.
- `<Reader>` renders static content as a true Server Component with zero client JS, virtualizes with `content-visibility` only, and preserves native find/select/copy/deep-link.
- The import-boundary lint fails CI on any client import reaching L1, and on re-introduced editor appearance CSS.
- `content-renderer` is deleted in-repo (story + tests + aliases + vestigial dep removed) and the product repo is repinned to `<Reader>` via a tagged release.
- The `EditorDocumentSnapshot` adapter and Lexical removal are sequenced as future backlog (R7), and the reader-side annotations are sequenced behind docs/027 (§12); neither blocks the first release.
- `pnpm check` is green in idco and in the product repo under `dev:link`.

## 18. Final Model

The IDCO reader is the editor's resting render, lifted out of the client editing shell and run on the server. It shares one layer with the editor — the RSC-safe presentational primitives (L1) that turn a node and its baked fields into DOM, plus the tag-independent `.rt-*` typography class contract that is the single source of block appearance — and it shares nothing above that layer. For objects, the shared thing is a literal component (the baked view), because an object is edited beside its appearance; for prose, the shared thing is the class contract applied to different host elements, because prose is edited inside its appearance. Either way, a paragraph, a baked code block, a callout, or a table is defined once, so read-versus-edit drift is unrepresentable rather than discouraged. The reader is a true Server Component for all static content, runs no heavy libraries because it renders baked fields the way export does, and adds interactivity only as opt-in islands keyed to the same `kind` the editor registers, so the static page is always complete on its own. It virtualizes with `content-visibility` and nothing else — keeping native find, select, copy, and deep-link, and refusing JS windowing as an explicit non-goal. It lives in `packages/reader` at the bottom of the dependency graph, deletes `@quanghuy1242/idco-content-renderer` rather than extending it, and reads through a projection adapter so the format beneath it can flip from Lexical-shaped JSON to `EditorDocumentSnapshot` and Lexical can be removed without the read tier changing. This is the read tier a live technical book platform needs: identical to the editor by construction, free of the editor's runtime by architecture, and native to the platform for everything the platform already does well.
