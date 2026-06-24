# 015 - Reader: The Server-Native Read Tier And The Shared View Substrate

> Status: design direction (pre-implementation)
>
> Date: 2026-06-18
>
> Scope:
>
> - `packages/content-renderer/src/index.tsx` — the current `"use client"` whole-document read renderer. **Retired by this plan**, not extended.
> - `packages/ui/src/rich-text-content.tsx` and the `RichText*` family in `@quanghuy1242/idco-ui` — the current visual primitives the reader and editor both lean on; their RSC-safe core is reclaimed by this plan.
> - future `packages/reader/**` — the new read tier: an RSC-safe presentational primitive layer, a server `Reader`, and the opt-in client islands.
> - `packages/editor/src/engine/view/**` — the editor view layer (011 §11), which renders resting blocks through the **same** primitive layer this document defines.
> - `packages/editor/src/RichTextEditor.tsx` — the standard Lexical editor, retired together with the Lexical-shaped compat projection once the editor and this reader reach parity (§8).
>
> Source docs:
>
> - `docs/006_editor_toolbar_redesign_plan.md` — the three render tiers, the bake pipeline, the reader-tier opt-in interactivity.
> - `docs/010_owned_model_virtualized_editor_plan.md` — the editor, §5.9 render-tier mapping, and the reader-boundary open decision (§12) this document closes.
> - `docs/011_foundation_dsa_owned_model_editor.md` — the model, the projection, the editor view layer, and the `virtualize` toggle (§2.6) the reader does not use.
>
> Foundation contract:
>
> - 010 and 011 own the **editor**. This document owns the **reader** and the **shared view substrate** both tiers render through. Where 010 §12 left "reader-tier interactive surface sharing" open, this document closes it. Where 010/011 and this document touch the same primitive layer, the primitive layer is defined here and consumed there.
>
> External references:
>
> - React Server Components — https://react.dev/reference/rsc/server-components
> - `content-visibility` — https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility
> - `contain-intrinsic-size` — https://developer.mozilla.org/en-US/docs/Web/CSS/contain-intrinsic-size
> - The islands architecture — https://jasonformat.com/islands-architecture/
>
> Assumptions:
>
> - The reader renders the **same baked artifact** the export tier consumes (010 §5.9): heavy objects are baked to static HTML/SVG/image at author time, so the reader runs no Prism, no Mermaid, no grid engine for resting content.
> - React 19 is in use across the workspace, so Server Components and selective hydration are available; the read tier targets a Server-Component host (App Router or equivalent), and the static reader ships zero JavaScript for prose and baked objects.
> - The reader consumes the document the editor persists. Today that is the `RichTextEditorDocument` compatibility projection; after the persistence flip (§8) it is `EditorDocumentSnapshot` directly. The reader is written against a projection adapter so the flip does not rewrite the primitive layer.
> - The bake fields, document settings, and node semantics are shared truth owned by 006/010/011; this document does not redefine them, it renders them.
> - Backlog, per-ticket breakdown, and acceptance criteria are intentionally omitted; this is the architecture and the decisions, in the shape of docs/011.

## Table Of Contents

- [1. Purpose](#1-purpose)
- [2. The Drift Problem, Stated Correctly](#2-the-drift-problem-stated-correctly)
  - [2.1 Lexical's drift came from two renderers](#21-lexicals-drift-came-from-two-renderers)
  - [2.2 The fix is component identity, not engine identity](#22-the-fix-is-component-identity-not-engine-identity)
  - [2.3 The three-context triangle over one primitive layer](#23-the-three-context-triangle-over-one-primitive-layer)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 content-renderer is a client component by accident](#31-content-renderer-is-a-client-component-by-accident)
  - [3.2 The primitives already exist, partly mis-housed](#32-the-primitives-already-exist-partly-mis-housed)
  - [3.3 The bake model is what makes a server reader cheap](#33-the-bake-model-is-what-makes-a-server-reader-cheap)
- [4. Target Model](#4-target-model)
  - [4.1 The component cake: three layers, one shared base](#41-the-component-cake-three-layers-one-shared-base)
  - [4.2 The RSC-safe primitive contract](#42-the-rsc-safe-primitive-contract)
  - [4.3 Reader equals export tier plus opt-in islands](#43-reader-equals-export-tier-plus-opt-in-islands)
  - [4.4 The reader data pipeline](#44-the-reader-data-pipeline)
  - [4.5 Two read artifacts: server Reader and editor read-mode](#45-two-read-artifacts-server-reader-and-editor-read-mode)
- [5. Reader Virtualization: Let The Platform Do It](#5-reader-virtualization-let-the-platform-do-it)
  - [5.1 The editor's unmount-window is wrong for the reader](#51-the-editors-unmount-window-is-wrong-for-the-reader)
  - [5.2 content-visibility is the less-aggressive virtualization](#52-content-visibility-is-the-less-aggressive-virtualization)
  - [5.3 What stays native: find, select, copy](#53-what-stays-native-find-select-copy)
  - [5.4 The client-windowing escape hatch](#54-the-client-windowing-escape-hatch)
- [6. The Island Model](#6-the-island-model)
  - [6.1 Static by default, island by exception](#61-static-by-default-island-by-exception)
  - [6.2 The island registry mirrors the block registry](#62-the-island-registry-mirrors-the-block-registry)
  - [6.3 Hydration boundaries and progressive enhancement](#63-hydration-boundaries-and-progressive-enhancement)
- [7. Packaging: packages/reader, And Retiring content-renderer](#7-packaging-packagesreader-and-retiring-content-renderer)
  - [7.1 Why a dedicated package and not a folder in the editor](#71-why-a-dedicated-package-and-not-a-folder-in-the-editor)
  - [7.2 The dependency direction is the whole point](#72-the-dependency-direction-is-the-whole-point)
  - [7.3 What moves, what is reclaimed, what is retired](#73-what-moves-what-is-reclaimed-what-is-retired)
- [8. Retiring Lexical Through The Reader](#8-retiring-lexical-through-the-reader)
- [9. Architecture Decisions](#9-architecture-decisions)
- [10. Risks, Edge Cases, And Failure Modes](#10-risks-edge-cases-and-failure-modes)
- [11. Final Model](#11-final-model)
- [12. Reader-Side Annotation Access: Glossary And Comments](#12-reader-side-annotation-access-glossary-and-comments)

## 1. Purpose

Define the read tier of the IDCO live-book platform, and pin the one substrate that guarantees the reader and the editor cannot diverge visually. The editor work in 010/011 produced an engine whose resting blocks already render a baked static form. This document takes that static form and makes it the published reader: a **true Server Component** that ships no editor runtime, runs no heavy libraries for resting content, and renders through the **same** view components the editor mounts at rest, so a paragraph, a baked code block, or a baked table looks identical whether an author is editing it or a reader is reading it.

The reader is not a second renderer that approximates the editor. It is the editor's resting render, lifted out of the client editing shell and run on the server. That single inversion removes the read-versus-edit drift class of bug at the root, and it is the explicit reason this tier shares a primitive layer with the editor rather than re-implementing one. The plan also retires two things on the way: `@quanghuy1242/idco-content-renderer`, the current client-only read renderer, and the Lexical standard editor with its Lexical-shaped compat JSON, once the editor and this reader reach parity (§8).

## 2. The Drift Problem, Stated Correctly

### 2.1 Lexical's drift came from two renderers

A `contenteditable` editor renders the document one way for editing, inside the live editable DOM, and a separate read renderer renders it a second way for publishing. Two code paths render the same node, so they drift: a list indent, a callout border, a code-block gutter, a table header style — each is implemented twice and the two implementations fall out of sync the first time someone fixes one and forgets the other. The reader then shows something the author never saw in the editor, and the bug is unfixable in general because the two renderers are genuinely different code.

The instinct is to fix drift by making the reader reuse the editor. That instinct is wrong here, because the editor is a client-heavy engine (EditContext input, selection overlay, virtualization, scheduler), and dragging it into a server-rendered reader would forfeit the Server-Component win and ship megabytes of editing machinery to read a page. The reuse has to be narrower and lower than "the engine."

### 2.2 The fix is component identity, not engine identity

Drift is a function of how many components render block N, not of how many engines exist. If exactly one component renders a heading, a reader and an editor that both call it are pixel-identical by construction, no matter how differently each decides which blocks to paint or how each handles input. So the shared thing is the **presentational primitive**, the pure function from a node plus its baked fields to DOM, and nothing above it.

010 §5.9 already states the mechanism without naming the package boundary: "the engine's resting blocks render the same baked representation the reader and export consume… one static representation per object… removes the read↔edit drift class of bug entirely." This document makes that boundary concrete. The primitive layer is one module set, RSC-safe, imported by the editor for its resting render and by the reader for its whole render. There is one component for block N, not two kept in sync, which is a stronger guarantee than any review discipline: the mismatch is not caught, it is unrepresentable.

### 2.3 The three-context triangle over one primitive layer

There are three places a document gets rendered to a reader-facing visual. All three import the same primitive layer, and they differ only in the shell around it.

| Context | Runtime | Renders | Virtualization | Ships editor JS |
| --- | --- | --- | --- | --- |
| Editor, editing | client (heavy) | primitives + edit chrome + input + selection | unmount-window (011 §2.6) | yes |
| Editor, read preview (`mode="read"`) | client (light) | primitives only, no chrome | optional | yes (already loaded) |
| Published reader (`<Reader>`) | **server (RSC)** | primitives only + opt-in islands | `content-visibility` (§5) | no |

The triangle is the design. Because every vertex renders block N through the same primitive, the published reader matches the editing surface and matches the in-app preview, and no review step is needed to keep them aligned. The editor adds chrome and input above the primitive; the reader adds islands and a server pipeline around it; the primitive itself never knows which context it is in.

## 3. Current-State Findings

### 3.1 content-renderer is a client component by accident

`packages/content-renderer/src/index.tsx` walks the compat JSON and renders every node through the `RichText*` components from `@quanghuy1242/idco-ui`. It is product-neutral and contract-aligned, and 010 §3.1 correctly named it the right initial base for the editor's view layer. It is also marked `"use client"` at line 1, and tracing why shows the directive is incidental, not structural: the renderer uses no `useState`, `useEffect`, `useRef`, `useMemo`, or `useContext`. The only interactivity in the whole file is a checklist item rendering `<input type="checkbox" onChange={() => {}}>`, a no-op handler, and the file inherits `"use client"` from importing `rich-text-content.tsx`, which carries the directive for the same checkbox.

So the current reader is a client component for one disabled checkbox. Nothing about reading a technical book needs the client. The path to a server-native reader is not a rewrite of the rendering logic; it is removing one incidental client dependency and relocating the genuinely interactive parts to islands.

### 3.2 The primitives already exist, partly mis-housed

The visual primitives — `RichTextParagraph`, `RichTextHeading`, `RichTextList`, `RichTextBlockquote`, `RichTextCallout`, `RichTextCodeBlock`, `RichTextTable`, `RichTextMediaFigure`, the inline marks — already live in `@quanghuy1242/idco-ui` and already produce the intended visuals. Most are pure presentational components that would render fine on the server today. A few are entangled with client behavior: `RichTextCheckListItem` carries the checkbox, `RichTextCodeEditor` (the live code surface) pulls in Prism and is client by nature, and `RichTextTableOfContents` / `RichTextTocRail` add sticky and scroll-spy behavior.

The mis-housing is that a single `"use client"` file mixes pure visuals with the one or two interactive widgets, so importing any of it taints the whole import with the client boundary. The reclaim is to separate the pure primitive (a static, non-interactive baked render of every block and mark) from the interactive widget (an island), so the pure half can be imported into a Server Component without dragging the client half along.

### 3.3 The bake model is what makes a server reader cheap

The reason a true Server-Component reader is achievable rather than aspirational is the bake pipeline (006, 010 §4.3/§5.9). Every heavy object's resting state is a baked static snapshot, produced at author time, because the export tier runs no heavy libraries. A code block bakes to Prism-highlighted static HTML, a Mermaid diagram to inline SVG, a data grid to a static HTML table, an image to a sized figure. The reader renders those baked fields directly, so it never loads Prism, Mermaid, or a grid engine for resting content.

This collapses the reader to a familiar shape: **the reader is the export tier rendered to HTML, plus optional client islands for the reader-tier interactivity 006 §5.7 allows.** A technical book page is then prose plus baked statics, which is the ideal Server-Component workload, mostly static markup with a few hydration points. The bake model is doing the heavy lifting; the reader is mostly composition.

## 4. Target Model

### 4.1 The component cake: three layers, one shared base

```text
Reader / shared view substrate
├── L1  RSC-safe primitive layer   (packages/reader, the shared base)
│       pure node+baked → DOM for every block and mark; no directive, no hooks, no handlers
│       imported by the editor (resting render) AND the server reader (whole render)
├── L2a Server Reader              (packages/reader, the published read tier)
│       walks the projection, renders L1 on the server, mounts L3 islands by registry
│       content-visibility virtualization; zero editor JS
├── L2b Editor view shell          (packages/editor/engine/view, the editing tier)
│       wraps L1 with edit chrome, input, selection overlay, unmount-window virtualization
└── L3  Client enhancement islands (packages/reader, opt-in)
        checklist toggle, sortable/filterable grid, pan-zoom diagram, scroll-spy TOC
        hydrated selectively; never part of the static render
```

L1 is the shared truth, the only layer both tiers import. L2a and L2b are the two shells that never touch each other. L3 is the opt-in interactivity that lives beside the reader, attached by registry to specific baked objects. The cake direction matters: L1 is the lowest and lightest layer, and everything heavier depends down onto it, never the reverse (§7.2).

### 4.2 The RSC-safe primitive contract

L1 is a hard contract, not a convention, because one client import anywhere in it taints the whole reader. A primitive is admissible in L1 only if it obeys all of:

- No `"use client"` directive, no React hooks, no event handlers, no browser-only globals at module scope. A primitive is a pure function from `(node, baked, resolved)` to elements.
- No transitive client import. A primitive may import other L1 primitives, layout helpers, and pure utilities from `@quanghuy1242/idco-lib`, and nothing that carries `"use client"`. The import-boundary check that 010 G3 applies to the editor core applies here in mirror image: L1 must not reach the client.
- Deterministic output. Given the same node and baked fields, a primitive renders the same DOM on the server and on the client, so an editor that mounts it and a server that renders it produce the same markup. Anchor ids, numbering, and ordering come from the derived indexes (011 §11.4) passed in, never recomputed differently per context.
- Renders the baked field, never the live source. The code primitive renders `baked.html`, not source through Prism. The diagram primitive renders `baked.svg`, not a Mermaid runtime. This is what keeps L1 free of heavy libraries and identical to export.
- Sanitization is applied at the boundary, once. Baked HTML and SVG, and any pasted/author HTML, pass the single sanitizer (010 §10.5, the `Sanitizer` SPI in 011 §12.3) before L1 renders them. L1 trusts its inputs because the boundary already cleaned them; it does not re-sanitize and does not emit `dangerouslySetInnerHTML` over untrusted strings.

The editor's resting block render (011 §11, the view layer) calls L1 directly for every block it is not actively editing. The active block, the one live object, and the selection overlay are L2b concerns that wrap or replace the L1 output for exactly one block at a time; every other mounted block in the editor is a bare L1 render, the same call the server reader makes.

### 4.3 Reader equals export tier plus opt-in islands

The export tier (010 §5.9) renders baked static fields only, with no interactivity, because EPUB/PDF cannot run JavaScript. The reader is that same static render delivered as HTML, with interactivity added back only where the product opts in. Stated as one identity: `Reader = Export(static baked render) + selective L3 islands`.

This identity is load-bearing. It means the reader inherits export's "no heavy libraries, render the baked field" discipline for free, and it means any object that has a correct baked field already reads correctly with zero additional work. An island is then a pure enhancement layered over a baked object that already renders without it: a sortable grid is the baked HTML table plus a sort island, so with JavaScript off or before hydration the reader still shows the full table. The static render is always complete on its own; islands never gate content visibility.

### 4.4 The reader data pipeline

The server reader is a straight pipeline with no editing concepts in it.

```text
persisted document
   → projection adapter        (RichTextEditorDocument today; EditorDocumentSnapshot after §8)
   → resolve host data         (resolveMedia, resolvePost — the content-renderer resolvers, kept)
   → derive read indexes       (heading anchors, TOC entries — 011 §11.4 indexes, run server-side)
   → render L1 primitives       (Server Component tree, baked fields in, HTML out)
   → emit content-visibility    (per top-level block, with contain-intrinsic-size from baked height)
   → mark island mount points   (registry-matched objects get a hydration boundary; §6)
```

Three properties pin it. The pipeline takes the document the editor already persists, so there is no reader-specific storage format and no second source of truth. It runs entirely on the server for static content, so prose and baked objects ship as HTML with no client JavaScript. The derived indexes (anchors, TOC) are the same ones the editor builds (011 §11.4), run here in a server pass, so a heading's anchor in the reader matches the editor's and a TOC link resolves to the same id; the reader does not invent a parallel anchoring scheme.

The projection adapter is the seam that absorbs the §8 persistence flip. The reader is written against the adapter's output, not against the raw stored shape, so flipping storage from the Lexical-shaped compat JSON to `EditorDocumentSnapshot` swaps the adapter and leaves L1 and the pipeline untouched.

### 4.5 Two read artifacts: server Reader and editor read-mode

"Read-only" names two different artifacts, and the user-facing tension dissolves once they are separated. They share L1 and differ in everything else.

- `<Reader>` (L2a, `packages/reader`) is the **published** read tier. It is a Server Component, ships no editor runtime, and is what a reader of the finished book loads. It is the artifact "true server component reader" refers to.
- `<OwnedEditor mode="read">` (011 §12.1) is the **in-app preview**, the authoring tool's own read-only view. It is a client component because it is the editor with editing suspended, useful for an author toggling between writing and previewing without leaving the editing session. It does not ship a second renderer; it renders L1 with the chrome and input switched off.

Both render block N through L1, so the published reader matches the in-app preview matches the editing surface, the full triangle of §2.3. A host that only needs to display a finished book imports `packages/reader` and never loads the editor at all. A host that is the authoring app already has the editor loaded and can preview in place. Neither path forks the visual.

## 5. Reader Virtualization: Let The Platform Do It

### 5.1 The editor's unmount-window is wrong for the reader

The editor virtualizes by unmounting offscreen blocks (011 §2.6), and it must, because it owns input and a selection that can span the gap, so it pays for cross-virtual selection painting (011 §8.5) and cross-virtual copy (010 §5.7) to keep correctness while blocks are absent from the DOM. That machinery exists to solve an editing problem: a live caret and a model selection over blocks the DOM no longer holds.

The reader has none of that problem. There is no caret, no model selection over gaps, no input landing in an unmounted node. Inheriting the editor's unmount-window would import all of its cost (client state, a windowing controller, cross-virtual copy, scroll restoration) to solve a problem the reader does not have, and it would forfeit the Server-Component nature, because client windowing is inherently stateful and cannot render once on the server. The reader needs a virtualization that is less aggressive by design, exactly as the user framed it.

### 5.2 content-visibility is the less-aggressive virtualization

The reader's virtualization is CSS, not JavaScript: each top-level block gets `content-visibility: auto` with a `contain-intrinsic-size` placeholder sized from the baked height. The browser then skips layout and paint for offscreen blocks while keeping them in the DOM, which is the entire performance win of virtualization (you do not lay out or paint 5,000 blocks at once) without any of the editor's machinery.

This is strictly lighter than the editor's approach and it fits the reader's constraints exactly. It is pure CSS, so it composes with Server Components and ships zero JavaScript. It keeps every block in the DOM, so the reader does not own selection, copy, or find at all. It degrades gracefully: a browser without `content-visibility` renders everything, which is correct, just less optimized. The `contain-intrinsic-size` value comes from the same baked height the editor's height cache holds, so the scrollbar is stable and the page does not reflow as blocks scroll into view.

### 5.3 What stays native: find, select, copy

Because every block stays in the DOM, the reader keeps the browser's native behaviors that the editor had to re-implement. Native Ctrl/Cmd+F finds text in offscreen blocks, because the text is present (`content-visibility: auto` content is still found by in-page search and is exposed to the accessibility tree). Native select-all and copy work across the whole document, including offscreen blocks, with no cross-virtual copy code. Native selection painting via `::selection` works, with no overlay-rect painter.

So the reader sheds, rather than inherits, the three hardest editor surfaces (cross-virtual selection paint, cross-virtual copy, find-replacement UI). They were editor costs forced by the unmount-window; the reader does not unmount, so they evaporate. This is the concrete payoff of choosing the platform mechanism over the editor's: the reader is simpler than the editor here, not a scaled copy of it.

### 5.4 The client-windowing escape hatch

A pathologically large document (tens of thousands of blocks) can exceed what even `content-visibility` keeps smooth, since the DOM still holds every node. For that case the reader retains an opt-in client-windowing mode, the editor-style unmount-window without the editing parts, accepted as a deliberate trade: it breaks native find and native cross-window copy, so it is off by default and chosen only for documents large enough to need it. It is named here as a designed-for escape hatch, not the default path, because the common technical book sits comfortably inside the `content-visibility` regime and should pay none of windowing's costs.

## 6. The Island Model

### 6.1 Static by default, island by exception

The reader renders static by default and hydrates an island only where the product opts into interactivity (006 §5.7). The default is a fully static page: prose, baked code, baked diagrams, baked tables, all server-rendered HTML with no JavaScript. An island is the exception, attached to a specific baked object whose static form is already complete, adding behavior on top: a sort control over a baked table, a pan-zoom over a baked diagram, a filter over a baked grid, a checkbox toggle over a baked checklist, scroll-spy over the baked TOC.

The invariant that keeps this honest is that the static render is always complete on its own. The island enhances a baked object that already shows its content, so with JavaScript disabled, before hydration, or if an island fails to load, the reader still shows the full table, the full diagram, the full checklist. Content visibility never depends on an island. This is the opposite of a client app that renders an empty shell and fills it in, and it is what lets the reader claim "true server component" honestly.

### 6.2 The island registry mirrors the block registry

The editor has a `BlockDefinition` registry (011 §12.3) that owns parse, normalize, bake, and the live-edit surface for each object kind. The reader has a parallel, smaller registry that owns the **read-tier island** for each kind, and the two are deliberately symmetric: the same `kind` string that selects a `BlockDefinition.LiveEdit` in the editor selects a `ReaderIsland` in the reader.

```text
interface ReaderIsland<Data> {
  kind: string;                                  // matches the BlockDefinition kind
  // the static, server-rendered baked view (L1); always present, JS-free
  Static: (props: { data: Data; baked: BakedSnapshot }) => ReactNode;
  // the optional client enhancement, hydrated over the Static output
  Interactive?: ReactComponentType<ReaderIslandProps<Data>>;
  hydrate?: "visible" | "idle" | "interaction";  // when to hydrate; default: none (stay static)
}
```

An object kind with no `Interactive` is pure static, the common case. A kind with an `Interactive` and a `hydrate` policy becomes an island. Because the key is the shared `kind`, the reader's interactive grid and the editor's live grid are registered against the same identity and reference the same baked field, so they cannot show different data, and the boundary 010 §12 left open (how much of a live object surface is shared with the reader versus re-implemented) is answered concretely: the **baked field and the `kind` are shared**, the **editor live-edit surface and the reader island are separate components** behind that shared identity, each minimal, neither pretending to be the other.

### 6.3 Hydration boundaries and progressive enhancement

Each island declares a hydration policy so the reader spends client JavaScript only where it buys interactivity, and only when the reader reaches it. `visible` hydrates when the island scrolls into view, which pairs naturally with `content-visibility` since both key off viewport proximity. `idle` hydrates after first paint when the main thread is free, for cheap enhancements. `interaction` hydrates on first user intent (focus, hover, tap), for controls that cost nothing until touched. The default is no hydration, static forever.

The result is a page whose JavaScript cost scales with how much interactivity the author actually used, not with document size. A 5,000-block prose chapter with no interactive objects ships zero island JavaScript. A chapter with three sortable grids ships three small sort islands, hydrated as they scroll in. This is the islands architecture applied to a book, and it is only possible because the bake model already made every object's resting state a complete static artifact.

## 7. Packaging: packages/reader, And Retiring content-renderer

### 7.1 Why a dedicated package and not a folder in the editor

The natural wish is to keep the reader inside the editor package, since the two share L1 anyway. It cannot live there, for a mechanical reason: the editor package is client-heavy (EditContext, the selection overlay, Prism in the live code surface, the scheduler), and much of it carries `"use client"` or transitively imports modules that do. A Server-Component reader importing anything from a package whose entrypoints drag in that client code risks pulling the editor runtime into the server bundle or tripping the RSC client-boundary rules. Tree-shaking does not save this reliably, because `"use client"` boundaries and side-effecting imports are not always shaken, and the failure is silent bundle bloat or a broken server build.

So the reader gets its own package, `packages/reader`, which holds L1 (the RSC-safe primitives), L2a (the server `Reader`), and L3 (the islands). The package name is deliberately simple per the directive. The shared L1 lives here, at the bottom of the dependency graph, where both the heavy editor and the light server reader can depend onto it without either dragging the other along.

### 7.2 The dependency direction is the whole point

The arrows decide whether the RSC boundary holds.

```text
@quanghuy1242/idco-lib          (pure helpers, RSC-safe)
        ▲                ▲
        │                │
packages/reader (L1)     │       L1 = RSC-safe primitives, no client imports
   ▲          ▲          │
   │          │          │
L2a Reader   L3 islands  │       both in packages/reader; islands are "use client"
   (server)  (client)    │
                         │
        packages/editor (L2b view shell)  →  imports packages/reader L1 for resting render
```

The editor depends on the reader's L1, never the reverse. L1 depends only on `@quanghuy1242/idco-lib` and other L1 modules, so it stays RSC-safe and importable from a Server Component. L3 islands are `"use client"` and live beside the server reader, but L2a imports them only through hydration boundaries, not into its own server module scope. The editor's heavy client code sits at the top of the graph where nothing the reader imports can reach it. An import-boundary check enforces the one rule that matters: nothing in L1 may import a `"use client"` module, the mirror of 010 G3's editor-core purity rule.

### 7.3 What moves, what is reclaimed, what is retired

- **Retired:** `@quanghuy1242/idco-content-renderer` (`packages/content-renderer`). Its job, walking the projection and rendering each node, is the server reader's job, done RSC-native. Its resolvers (`resolveMedia`, `resolvePost`) and its renderer-override extension point move to `packages/reader` intact, because they are the right host-data seam. The package is removed, not extended; its two current consumers (the editor view layer at `packages/editor/src/engine/view/index.ts`, and the Ladle story) re-point at `packages/reader`.
- **Reclaimed:** the RSC-safe core of the `RichText*` primitives currently in `@quanghuy1242/idco-ui` becomes L1 in `packages/reader`. The pure primitives (paragraph, heading, list, blockquote, callout, baked code, baked table, media figure, inline marks) are the static base. The interactive ones (the checklist checkbox, the live code editor, the sticky/scroll-spy TOC) split: their static visual becomes an L1 primitive, their behavior becomes an L3 island. The `"use client"` taint that made the whole reader a client component (§3.1) is removed by this split.
- **Kept where it is:** `@quanghuy1242/idco-ui` remains the app-wide UI library for the authoring app's own chrome (buttons, dialogs, the toolbar). The reader does not depend on the interactive parts of `@idco/ui`; it depends on L1, which is the reader's own RSC-safe layer. Whether L1 physically lives in `packages/reader` or in a thin RSC-safe subpath that `@idco/ui` also re-exports is an internal placement detail, settled by the import-boundary check, not a design fork.

## 8. Retiring Lexical Through The Reader

The intent is to kill Lexical once the editor and this reader reach parity, and the reader is the consumer that makes the kill clean. Lexical lives in two places relevant here: the standard editor (`packages/editor/src/RichTextEditor.tsx`), and the Lexical-shaped `RichTextEditorDocument` JSON that is both the editor's compat projection and the document the reader consumes today. The reader touches the second.

The retirement is staged through the projection adapter (§4.4). While Lexical is alive, the reader consumes the Lexical-shaped projection through the adapter, and the editor emits that same projection, so the reader and the standard editor agree on every byte. When the editor reaches parity and persistence flips to `EditorDocumentSnapshot` (010 §12's persistence-format decision), the adapter switches to read the owned snapshot directly, the reader's L1 and pipeline do not change, and the Lexical-shaped projection stops being a runtime format. At that point the standard editor and its Lexical dependency are removed: the editor is the only editor, the server reader is the only reader, and `EditorDocumentSnapshot` is the only persisted shape. The reader never depended on Lexical, only on the projection adapter's output, so retiring Lexical is a storage and editor change that leaves the read tier intact.

This is the endgame the reader is designed for, and it is why the reader is written against an adapter rather than against the raw stored JSON: the format under the adapter is allowed to change from Lexical-shaped to EditorDocument-shaped without the read tier noticing.

## 9. Architecture Decisions

- **Decision: share a primitive layer, not an engine.** The reader and editor share L1 (pure node-to-DOM primitives) and nothing above it. This removes read-versus-edit drift by component identity (§2.2) while keeping the reader free of the editor's client runtime. Rejected: reusing the editor in read-only mode as the published reader, which would ship the editing runtime to read a page and forfeit Server Components.
- **Decision: the reader is a true Server Component for static content.** Prose and baked objects render to HTML on the server with zero client JavaScript; interactivity is opt-in islands (§4.3, §6). Rejected: a client-rendered reader, which the current `content-renderer` is only by the accident of one no-op checkbox (§3.1), and which would needlessly ship and hydrate the entire document.
- **Decision: virtualize the reader with `content-visibility`, not unmounting.** The reader keeps every block in the DOM and lets the browser skip offscreen layout/paint (§5.2), which preserves native find, select, and copy (§5.3) and stays RSC-compatible. Rejected as the default: the editor's unmount-window, which exists to solve an editing problem the reader does not have and which breaks native find and copy; kept only as an opt-in escape hatch for pathological documents (§5.4).
- **Decision: reader = export tier + opt-in islands.** The reader inherits export's "render the baked field, run no heavy libraries" discipline, so any object with a correct baked field reads correctly for free (§4.3). Rejected: re-deriving live renders in the reader (running Prism or Mermaid client-side), which would duplicate the editor's live surfaces and re-open the drift the bake model closes.
- **Decision: a dedicated `packages/reader`, with the editor depending onto it.** The reader cannot live inside the client-heavy editor package without risking the RSC boundary (§7.1); a dedicated package puts L1 at the bottom of the dependency graph where both tiers depend down onto it (§7.2). Rejected: folding the reader into the editor package; rejected: a separate `packages/reader-primitives` on top of `packages/reader`, which adds a package for no boundary the import-check does not already enforce.
- **Decision: the island registry mirrors the block registry by `kind`.** The reader's interactive island and the editor's live-edit surface are separate components keyed by the same `kind` over the same baked field (§6.2), which closes 010 §12's open reader-sharing boundary: identity and baked data are shared, surfaces are separate and minimal.
- **Decision: retire `content-renderer` and Lexical through the adapter, not through the read tier.** The reader consumes a projection adapter, so the format under it can flip from Lexical-shaped JSON to `EditorDocumentSnapshot` and Lexical can be removed without changing L1 or the pipeline (§8). Rejected: writing the reader against the raw stored JSON, which would couple the read tier to the format being retired.

## 10. Risks, Edge Cases, And Failure Modes

- **L1 purity erosion.** One careless `"use client"` import into L1, or one hook added to a primitive for convenience, taints the whole reader back into a client component and silently breaks the Server-Component guarantee. The import-boundary check (§7.2) must fail CI on any client import reaching L1, the same severity as the editor-core purity rule; without it, the boundary rots the first time someone adds a quick `useState`.
- **Baked-field staleness.** The reader renders the baked field, so a baked field that drifted from its source (an object edited without re-baking) shows the reader stale content. This is an editor invariant (010 §11, re-bake on edit; an unbakeable object surfaces an error rather than emitting a stale node), but the reader is where the staleness becomes visible, so the reader must render an explicit fallback for a missing or invalid baked field rather than rendering nothing or a broken artifact.
- **content-visibility height jumps.** A wrong `contain-intrinsic-size` makes the scrollbar lurch as blocks render in. The estimate must come from the baked/measured height the editor already caches; a poor estimate is a visible scroll-stability bug, the reader-side instance of the editor's late-resize drift risk (010 §11).
- **Anchor and TOC divergence.** If the reader derives heading anchors or TOC entries differently from the editor, a TOC link or a deep link resolves to a different id than the author saw. The reader must run the same derived-index logic (011 §11.4) as the editor, server-side, not a parallel implementation; this is a drift risk that lives in the derived indexes rather than in L1.
- **Sanitization gaps on baked HTML/SVG.** Baked Mermaid SVG, grid HTML, and pasted author HTML are rendered by L1 on every tier including export. The single sanitizer (010 §10.5) must clean them at the boundary before L1 renders them; a gap here is an XSS hole that ships to every reader. L1 itself must not be the place sanitization is decided, or it will be decided inconsistently.
- **Island hydration mismatch.** A `visible`/`idle`/`interaction`-hydrated island must hydrate over markup identical to what the server rendered, or React throws a hydration mismatch. The island's `Static` output and its `Interactive` initial render must agree on the baked DOM; the island enhances, it does not re-render a different tree.
- **The escape-hatch regression surface.** Turning on client windowing (§5.4) silently disables native find and cross-window copy for that document. It must be an explicit per-document choice with the trade stated, not an automatic threshold, or a reader loses Ctrl+F on a long page with no explanation.
- **Two registries to keep in step.** The block registry (editor) and the island registry (reader) are keyed by the same `kind`, so a new object kind needs an entry in both or it bakes without a reader island, or gains an island with no editor support. The symmetry is a maintenance obligation; a missing counterpart should degrade to the static baked render, never to a blank.

## 11. Final Model

The IDCO reader is the editor's resting render, lifted out of the client editing shell and run on the server. It shares one layer with the editor, the RSC-safe presentational primitives (L1) that turn a node and its baked fields into DOM, and it shares nothing above that layer, so a paragraph, a baked code block, or a baked table is the same component whether an author edits it or a reader reads it, and read-versus-edit drift is unrepresentable rather than merely discouraged. The reader is a true Server Component for all static content, runs no heavy libraries because it renders baked fields the way the export tier does, and adds interactivity only as opt-in islands keyed to the same `kind` the editor registers, so the static page is always complete on its own. It virtualizes with `content-visibility` rather than the editor's unmount-window, which keeps native find, select, and copy and sheds the three hardest editor surfaces instead of inheriting them. It lives in `packages/reader` at the bottom of the dependency graph, retires `@quanghuy1242/idco-content-renderer`, and reads through a projection adapter so the format beneath it can flip from Lexical-shaped JSON to `EditorDocumentSnapshot` and Lexical can be removed without the read tier changing. This is the read tier a live technical book platform needs: identical to the editor by construction, free of the editor's runtime by architecture, and native to the platform for everything the platform already does well.

## 12. Reader-Side Annotation Access: Glossary And Comments

> Status: Reader-tier follow-up for docs/027 (the Review tab / annotations work). The editor-side annotation interaction — click a marked word, read a popover, route to the dock — is docs/027 §16 P6; this section is its read-tier half, deliberately parked here because it is L1/reader work and docs/015 is not yet built. The owned engine already stores the data this needs (the glossary collection travels in the snapshot; a comment mark carries a denormalized snapshot), so this is render work on L1, not a new model.

The owned engine renders two annotation marks today (docs/027 §6.1, §7.5): a **glossary** mark, `<abbr data-engine-glossary-term="…">`, a reference to a term in `document.collections.glossary`; and a **comment** mark, a highlighted span carrying `attrs.thread` plus a thin `attrs.snapshot` (`{ author, excerpt, resolved }`). In the editor these become live (click → read popover → route to the dock, docs/027 §16 P6). In the reader they must stay read-only and RSC-safe — which is exactly the "render the baked/denormalized field, call nothing" discipline this tier already lives by (§4.3). The line is the content/metadata line from docs/027 §2.1: glossary is **content** the reader is entitled to render fully; comments are **metadata** the reader renders only as far as the document's own snapshot allows, never by calling the host.

**Glossary is content — render it from the snapshot, fully.** The glossary collection travels inside `EditorDocumentSnapshot.collections.glossary` (docs/027 §5.1), so the reader already holds every term and its definition with no host call. L1's glossary-mark primitive resolves the definition for `attrs.term` and emits `<abbr title={definition}>` — the native hover affordance, matching legacy's `<abbr>` export and the editor's tooltip, from the single source so the three cannot disagree (docs/027 §6.1/§6.6). The mechanism is a server-built `Map<termId, definition>` threaded to L1 the way the editor threads the document index: a small RSC-safe provider (or a render prop), never a client hook, so L1 stays pure (§10 "L1 purity erosion"). The reader may also emit an optional generated back-matter glossary section listing every *used* term and its definition — one registry feeds both the inline `<abbr>` and the back-matter, so they are identical by construction.

**Comments are metadata — render only the snapshot, never the host.** The reader must not call the comment source; doing so would make the published page non-static and re-open the drift the bake model closes (docs/027 §7.3, §12 "reader divergence"). So L1 paints a comment range from `attrs.snapshot` alone: a non-interactive highlight, optionally a static margin note showing the snapshot's author and excerpt, and a resolved thread either dimmed or hidden (a deployment choice). There is no reply, resolve, or thread fetch in the reader — those are editor-only, host-backed. A comment whose snapshot is absent degrades to a plain (or no) highlight rather than a blank or a fetch.

**Why this belongs to L1, not an island.** Both renders are pure functions of the snapshot — definition lookup for glossary, snapshot read for comments — so they need no client runtime and must not become islands by default (§6.1). The only interactive variant is a deployment that *wants* reader-side comment reading (a published book with a visible discussion margin); that is the island exception (§6.2), keyed by the comment `kind`, hydrating over the same static highlight L1 already emitted — it enhances, it does not re-render a different tree (§10 "island hydration mismatch").

**Acceptance shape (for whoever builds this):** editing a glossary definition once updates the reader's inline `<abbr title>` and the back-matter together, with no second copy anywhere in the snapshot (docs/027 §13 "glossary single-source"); the reader paints comment highlights and any margin notes from the snapshot with zero host calls, and a missing comment source changes nothing about the reader (docs/027 §13 "snapshot fallback", §12 "reader divergence"); and L1 stays RSC-safe — the definitions map is server-built and passed down, no `"use client"` reaches the glossary/comment primitive.
