# 034 - Host-Placed Editor Chrome: A Placement SPI For The Rail, Toolbar, And Tabs

> Status: design-grade proposal, recommendation-only, not yet built. Greenlit through **Tier 1 (placement slot)**. **Tier 2 (headless)** is documented in full to constrain the Tier 1 shape but is explicitly **not** greenlit — do not build it. No code until the §11 API shape is locked.
> Date: 2026-06-29
> Scope: a placement seam for the persistent, layout-level editor chrome — the side rail / dock first, the formatting toolbar and tab strip as the generalization the seam is designed to reach. The anchored, transient overlays (selection flyout, slash menu, context menu, forms, the find bar, the painted caret) are out of scope by the §5 contract.
> Source docs: docs/027 (Side Panel dock + pane registry + `PanelHost`), docs/029 (overlay authority — the boundary this doc must not cross), docs/023 (toolbar layout SPI), docs/026 (host data provider SPI — the `renderPicker` ownership precedent), docs/005 (the removed TOC aside rail — the history this doc answers for), docs/025 (virtual geometry — the invariant §9.5 protects).
> Related docs: note.md (the owned-editor parity backlog); CLAUDE.md (the cross-repo release ritual a consumer-facing change follows).
> Assumptions: react-aria-components ≥1.x as used today; the §3 facts (chrome is store-driven, the dock is a scroller sibling, `EditorToolbar`/`OwnedModelEditorView`/the pane registry are already exported, `SidePanelDock` is not) hold as of this writing; content-api remains the first real consumer driving the need. These are inspectable claims, re-verify before building.

This doc is the chat-first exploration folded into a tracked design so nothing lives only in conversation.

## Table Of Contents

- [1. Purpose and scope](#1-purpose-and-scope)
- [2. The question, stated precisely](#2-the-question-stated-precisely)
- [3. Current-state ground truth](#3-current-state-ground-truth)
  - [3.1 The chrome is already store-driven and physically decoupled](#31-the-chrome-is-already-store-driven-and-physically-decoupled)
  - [3.2 "Chrome = content registry + editor-rendered shell" is the existing pattern](#32-chrome--content-registry--editor-rendered-shell-is-the-existing-pattern)
  - [3.3 The architecture already reserved this hatch and deliberately did not pull it](#33-the-architecture-already-reserved-this-hatch-and-deliberately-did-not-pull-it)
  - [3.4 What is and is not exported today](#34-what-is-and-is-not-exported-today)
- [4. The reframing: placement, not refs](#4-the-reframing-placement-not-refs)
- [5. The load-bearing contract: the anchored-vs-layout line](#5-the-load-bearing-contract-the-anchored-vs-layout-line)
  - [5.1 The test](#51-the-test)
  - [5.2 What is host-placeable](#52-what-is-host-placeable)
  - [5.3 What stays editor- and authority-owned](#53-what-stays-editor--and-authority-owned)
  - [5.4 The TOC is the instructive edge](#54-the-toc-is-the-instructive-edge)
- [6. The three-tier ladder](#6-the-three-tier-ladder)
  - [6.1 Tier 0 — batteries-included](#61-tier-0--batteries-included)
  - [6.2 Tier 1 — the placement slot (greenlit)](#62-tier-1--the-placement-slot-greenlit)
  - [6.3 Tier 2 — headless (documented, not greenlit)](#63-tier-2--headless-documented-not-greenlit)
- [7. Tier 1 design in depth](#7-tier-1-design-in-depth)
  - [7.1 The placement seam, three candidate shapes](#71-the-placement-seam-three-candidate-shapes)
  - [7.2 Why a render-prop slot, not a raw ref](#72-why-a-render-prop-slot-not-a-raw-ref)
  - [7.3 What the editor keeps owning under Tier 1](#73-what-the-editor-keeps-owning-under-tier-1)
  - [7.4 The ChromeSurface concept, applied with restraint](#74-the-chromesurface-concept-applied-with-restraint)
- [8. The proof case: the outline / TOC rail](#8-the-proof-case-the-outline--toc-rail)
- [9. Costs, risks, and failure modes](#9-costs-risks-and-failure-modes)
  - [9.1 Overlay-authority context scope](#91-overlay-authority-context-scope)
  - [9.2 Focus return across the tree boundary](#92-focus-return-across-the-tree-boundary)
  - [9.3 Roving-focus and ARIA continuity](#93-roving-focus-and-aria-continuity)
  - [9.4 Two renderers, one behavior](#94-two-renderers-one-behavior)
  - [9.5 The virtualization invariant](#95-the-virtualization-invariant)
- [10. Relationship to the existing SPIs](#10-relationship-to-the-existing-spis)
- [11. Open decisions to lock before code](#11-open-decisions-to-lock-before-code)
- [12. Verification and test plan](#12-verification-and-test-plan)
- [13. Implementation backlog](#13-implementation-backlog)
  - [HPC-0. Lock the contracts](#hpc-0-lock-the-contracts)
  - [HPC-1. Dock placement seam](#hpc-1-dock-placement-seam)
  - [HPC-2. Outline proof case](#hpc-2-outline-proof-case)
- [14. Future backlog (not greenlit)](#14-future-backlog-not-greenlit)
- [15. Definition of done](#15-definition-of-done)
- [16. Out of scope](#16-out-of-scope)
- [17. Final model](#17-final-model)

## 1. Purpose and scope

A content-CMS consumer (content-api) mounts the owned-model editor as the whole edit screen, and that screen is an editor column plus a host-owned Publish/SEO column. Today the editor's chrome — the formatting toolbar, the tab strip, the side-panel dock that holds Outline/Comments/Glossary — renders inside the editor's own DOM subtree, arranged by the editor's own flexbox. The consumer can shed the card border and stretch the surface (`chromeless`/`fillHeight`, note.md §5.9), but it cannot decide *where* the rail sits in its app. It cannot put the document outline in a global left sidebar, fold the editor toolbar into its shared top bar, or show editor panes and its own Publish panel in one dock. The request that started this doc is narrow ("render the side rail in a host-provided ref"), and the right answer is broader than the request: let the host own *placement* of the persistent chrome while the editor keeps owning *content and behavior*.

In scope: a placement seam for the persistent, layout-level chrome (the side rail/dock first, the toolbar and tab strip as the generalization the seam is designed to reach). The contract that decides which surfaces are eligible. The wiring a host-placed shell needs (the store, the panel-host seam, the overlay-authority handle, the focus reclaim, the shared document index). The proof case (the outline rail). The costs.

Out of scope by deliberate decision: moving any anchored, transient overlay (the selection flyout, slash menu, context menu, link/glossary/comment forms, the find bar, the painted caret/selection layer) out of the editor — §5.3 explains why this is a hard boundary, not a phase-2. The full headless path (Tier 2) is described but parked. No persistence, reader, or model changes. No code in this pass; this is the design only.

## 2. The question, stated precisely

"Render the side rail in the host ref" reads as a DOM-placement trick — hand the editor a `ref`, let it `createPortal` the rail there. That framing under-describes the goal and over-commits the mechanism. The goal is host-owned chrome *layout*: the host decides where the rail, toolbar, and tabs sit in its shell, while the editor keeps supplying what those surfaces render and how they behave (which command a button runs, which pane a tab opens, how roving focus and dismissal work). A raw ref is the lowest-tech way to express "placement," and it is not obviously the best one (§7.2).

So the question this doc answers is not "can the editor portal a div into a host node." It is: **which chrome surfaces can a host own the placement of, what is the seam that lets it, and what wiring must travel across the seam so the host-placed surface behaves identically to the embedded one?**

## 3. Current-state ground truth

Three facts about the code reframe the problem before any "should we." Each is grounded in the source as it stands.

### 3.1 The chrome is already store-driven and physically decoupled

The chrome talks to the editing surface entirely through values, never through the surface's DOM. `EditorToolbar` ([packages/editor/src/view/chrome/surfaces/ribbon.tsx](../packages/editor/src/view/chrome/surfaces/ribbon.tsx)) is a pure function of `store` plus a handful of handles: `focusEditor`, `onFind`, `layout` (a `ToolbarLayoutConfig`), `capabilities`, and `panelHost`. It re-derives its command context on every selection or commit through `useStoreVersion(store)` and reads and writes the model through `store.query(...)` / `store.command(...)`. The dock ([packages/editor/src/view/chrome/surfaces/side-panel-dock.tsx](../packages/editor/src/view/chrome/surfaces/side-panel-dock.tsx)) is the same: a function of `store`, `capabilities`, `panelHost`, an `indexStore`, and a `reveal` callback.

The dock is already a flex *sibling* of the scroller, never a child ([owned-model-editor.tsx:511-521](../packages/editor/src/view/owned-model-editor.tsx#L511-L521)). The comment at [:466](../packages/editor/src/view/owned-model-editor.tsx#L466) records why: keeping the dock out of the scroller means opening it only narrows the surface width, which the virtual window already treats as a resize, so it cannot corrupt offset measurement (docs/025). The hardest part of moving a rail — not breaking virtualization geometry — is therefore already solved. The coupling that remains is a short list of plain objects: `store`, the `panelHost` seam, the `overlayAuthorityRef`, `focusEditor`, and the shared `MutableDocumentIndexStore`. None of it reaches into the view.

The consequence: host-placing the chrome is mostly a composition and packaging change, not a re-architecture. The expensive groundwork (store-driven chrome, the scroller-sibling dock, the pane and toolbar registries) is done.

### 3.2 "Chrome = content registry + editor-rendered shell" is the existing pattern

The editor already separates *what* a chrome surface shows from *how* its shell is arranged, for both the dock and the toolbar. A feature teaches the dock a pane by registering one `SidePanel` ([side-panel-registry.ts](../packages/editor/src/view/spi/side-panel-registry.ts)); the dock is generic chrome that calls `listSidePanels()`, gates each by `isAvailable`, and renders the active one's `render(...)`, holding zero knowledge of Outline/Comments/Glossary. The toolbar is the same shape: tabs and slots register as content ([toolbar-layout.ts](../packages/editor/src/view/spi/toolbar-layout.ts), `command-builtins.tsx`), and the ribbon arranges them with a layout function and a responsive-collapse renderer (docs/023).

The pane registry's render contract is already a clean content seam:

```ts
export type SidePanelRenderArgs = {
  readonly store: EditorStore;
  readonly ctx: CommandContext;          // selection facts, scope, capabilities, the dock seam
  readonly reveal: (id: NodeId) => void; // engine scroll-to-block, reaches windowed-out nodes
  readonly close: () => void;
  readonly focusId?: string;             // reveal+highlight a row on open (docs/027 §16 P6)
};

export type SidePanel = {
  readonly id: string;
  readonly title: string;
  readonly iconName: string;
  isAvailable?(ctx: CommandContext): boolean;
  render(args: SidePanelRenderArgs): ReactNode;
};
```

The host already drives the dock's lifecycle through the `PanelHost` seam ([command-registry.ts](../packages/editor/src/view/spi/command-registry.ts)), a three-method object:

```ts
export type PanelHost = {
  readonly open: (paneId: string, focusId?: string) => void;
  readonly close: () => void;
  readonly toggle: (paneId: string, focusId?: string) => void;
};
```

So "side rail" is not a monolith to pry apart. It is already a content registry (panes) plus an editor-rendered shell (the dock) plus a state seam (`PanelHost`). The toolbar mirrors that decomposition. The placement SPI slots into a seam the architecture already cut; it does not invent the decomposition.

### 3.3 The architecture already reserved this hatch and deliberately did not pull it

docs/027 §8.4 ("Editor Chrome, Not Host Layout," decision D6) made the dock editor-owned on purpose, and it did so against a specific precedent: the owned-model migration *removed* a host aside rail that docs/005 had built. In the legacy `RichTextEditor`, an `aside` TOC wrapped the bordered editor frame in a side-aware grid `[rail | frame]`, with the rail a sibling of the contenteditable rendered outside it ([docs/005 §5.2](./005_side_toc_rail.md)). That was host-adjacent shell layout. docs/027 pulled the rail back into a single editor-owned dock and wrote down why: "The host owns the page frame, the reading layout, and any published TOC rail; the editor owns its toolbar and its dock." The same section reserved the escape hatch this doc cashes: "as an escape hatch, the editor may expose the panel registry and a `renderDock` slot so a host that wants the panes inside its own layout can place them." Reserved, deferred, not built.

This history matters for two reasons. First, the proposal is not cutting against the grain by accident; it is exercising a hatch the design left open. Second, the design pulled a host rail back *once* for good reasons (portability, a clean shell boundary, not letting the document's chrome leak into every consumer's layout). This doc therefore carries a burden the legacy rail did not discharge: it must explain why *this* seam is clean when the old one was not. The answer is §5 — the old rail mixed an anchored, content-derived surface (the TOC) into host grid layout with no contract about what could and could not move; this doc draws the anchored-vs-layout line first and lets only the layout-class surfaces across.

### 3.4 What is and is not exported today

The public barrel ([packages/editor/src/index.ts](../packages/editor/src/index.ts)) already exports `OwnedModelEditor`, `OwnedModelEditorView`, and `EditorToolbar`, plus the full side-panel registry (`registerSidePanel`, `getSidePanel`, `listSidePanels`, `unregisterSidePanel`) and the `PanelHost` and `SidePanel` types. It does **not** export `SidePanelDock` — the dock component is internal chrome. So a host today can register a pane and can render the standalone toolbar, but it has no public component for the dock shell and no documented way to reproduce the authority/focus/index wiring that `OwnedModelEditor` does internally. That gap is exactly the Tier 1 work: a placement seam plus the handles a placed shell needs.

## 4. The reframing: placement, not refs

State the seam in terms of ownership, not DOM. The editor owns the *content* of a chrome surface (the registered panes, the toolbar's commands and tabs) and its *behavior* (roving focus, dismissal, the command context, the dock's one-pane-at-a-time rule). The host, under this SPI, owns the *placement* of the surface's shell — where it mounts in the app, what it sits beside, whether it shares a region with host panels. The seam carries the surface from the editor to the host's chosen location with its wiring intact.

This is the same ownership split the codebase already uses for host-rendering seams. The `renderPicker` capability in docs/026 lets a host render its own pick surface (a media-library modal) while the engine still owns the overlay container's focus, dismissal, and theme placement. The host fills and places the body; the engine owns the lifecycle. The placement SPI is that shape generalized from "the picker body" to "the dock shell": the host places the container, the editor owns what goes in it and how it behaves. Mirroring `renderPicker` rather than inventing a new ownership model keeps the surface area honest and the mental model singular.

## 5. The load-bearing contract: the anchored-vs-layout line

The whole design rests on one distinction, because the request invites scope creep ("maybe extend this to toolbar or tabs or stuff"). Not every floating or docked thing in the editor is host-placeable chrome. Get this line wrong and the SPI either does too little (host can move the rail but not the toolbar) or too much (host "moves" the slash menu and breaks positioning). The line is what makes *this* seam clean where the docs/005 rail was not.

### 5.1 The test

Ask one question of any surface: **does it anchor to content geometry or selection, or to the app layout?** A surface that must position itself relative to a glyph, a selection rectangle, a table cell, or the caret is content-anchored. A surface that lives at a fixed place in the page regardless of where the caret is — the toolbar at the top, the rail on the side, the tab strip above the body — is layout-anchored. Content-anchored surfaces stay with the editor and the overlay authority. Layout-anchored surfaces are eligible for host placement.

The test is not aesthetic. It tracks a real dependency. Content-anchored surfaces need the overlay authority's machinery: the transform-free `document.body` portal layer (so a `position: fixed` envelope resolves against the viewport, [overlay-layer.tsx](../packages/editor/src/view/chrome/surfaces/overlay-layer.tsx)), the central positioning solve that clamps and flips into the viewport, and the focus-ownership policy that decides dismissal (docs/029 §4). Move one into host DOM and its positioning and dismissal break, because the host's layout establishes containing blocks and stacking contexts the authority's geometry assumes away. Layout-anchored surfaces have no such dependency; they are ordinary boxes in a flow.

### 5.2 What is host-placeable

The persistent, layout-level chrome:

- The side rail / dock — the registered workspace panes (Outline, Comments, Glossary, Insights), shown one at a time in a docked region.
- The formatting toolbar as a whole widget — the tab strip and the active tab's slots, placed together (§9.3 forbids splitting it).
- The tab strip, when a host wants the editor's tabs in its own bar, again as a coherent widget.
- The document title input, the find *trigger* button, and status affordances like word count — small layout-level controls that read or open editor state without anchoring to content.

These share the property that they sit where the page puts them and read the model through `store`. Placing them is a layout decision with no geometry contract beyond "give the editor's scroller a stable box" (§9.5).

### 5.3 What stays editor- and authority-owned

The anchored, transient surfaces, without exception in this design:

- The selection flyout, the slash menu, the context menu.
- The link, glossary, comment, and object-config forms; the table-cell `…` actions.
- The find *bar* (the sticky search form the trigger opens), as distinct from the find *button*.
- The painted caret and selection overlay, and the touch-selection layer.

Each of these is owned by the overlay authority and portaled to the transform-free body layer, or anchored to a `rootRef` inside the editor (the node/structural `renderOverlay` path, [react-view.tsx:710-726](../packages/editor/src/view/react-view.tsx#L710-L726)). The find case is the sharp illustration of the line cutting through one feature: the find *button* can live in a host top bar (layout-anchored, just calls `openFind`), but the find *bar* it opens cannot (it is a sticky form the authority positions near the surface and keeps focused while the author clicks matches). Letting "and tabs and stuff" pull any of these out would fight docs/029 directly, and docs/029 is the doc that exists to stop every floating surface from re-growing its own bespoke positioning and dismissal. This SPI does not touch it.

### 5.4 The TOC is the instructive edge

The table of contents is the surface that sits exactly on the line, which is why it is the right thing to design against first. Its `aside` form is currently a *content-anchored* floating rail rendered through the node `renderOverlay` SPI, one per document, anchored to the scroller content ([table-of-contents.tsx](../packages/editor/src/view/nodes/table-of-contents.tsx)). Yet conceptually the outline is the layout chrome a host most wants in its own sidebar. The same surface reads as content-anchored in its current implementation and layout-anchored in its intent. Designing the placement seam against the TOC forces the anchored-vs-layout question to be answered concretely rather than in the abstract: a host-placed outline must be re-expressed as a *dock pane* (the Outline pane already exists, [outline-pane.tsx](../packages/editor/src/view/chrome/panes/outline-pane.tsx)) that reads the shared document index and calls `reveal` to scroll, not as a `renderOverlay` rail relocated into host DOM. The pane form is layout-anchored and already host-driveable through the registry; the `renderOverlay` rail form is content-anchored and stays put. The TOC proves the line by making us pick the pane.

## 6. The three-tier ladder

Offer altitude rather than one seam. A consumer should pick how much control it wants, and the default should cost nothing. Three tiers, of which the first two are greenlit and the third is documented to bound the design.

### 6.1 Tier 0 — batteries-included

`<OwnedModelEditor>` renders all chrome in its own shell, arranged by its own flexbox, exactly as today. The host passes `store`, capability flags, and the `chromeless`/`fillHeight` props, and gets a working editor with toolbar, tabs, and dock. This stays the default and the documented happy path. Most consumers never leave it. Nothing in this doc removes or changes it.

### 6.2 Tier 1 — the placement slot (greenlit)

The editor still renders each chrome surface *as a component, with all its wiring intact*, but the host decides where that component mounts. The host passes a placement slot — a render-prop that receives the fully-wired surface element and returns it positioned inside the host's own layout (§7.1 picks the exact shape). The editor keeps owning the store subscription, the command context, the `panelHost` lifecycle, the overlay-authority handle, the focus reclaim, and the shared index. The host owns one thing: the box the surface lands in. This is the literal, satisfying version of "render the rail in my layout," and it is cheap precisely because §3.1 already made the chrome a function of values — the surface element is the same element `OwnedModelEditor` renders; only its parent in the tree changes. This is the tier to build.

### 6.3 Tier 2 — headless (documented, not greenlit)

The host mounts `<OwnedModelEditorView>` (the bare surface) and renders the chrome itself from public exports — `EditorToolbar` with its own `store`/`focusEditor`/`panelHost`, a (future) exported dock that reads the pane registry, the host driving `store`, `overlayAuthorityRef`, and `overlayPanelHost` by hand. The host can then interleave editor panes with its own Publish/SEO/version-history panels in one region, or compose a wholly custom chrome. About 80% of this is already possible today (the bare view and the toolbar are exported), which is exactly why it is tempting and exactly why it is risky: it is the tier where the host reproduces the authority/focus/index wiring by hand, where a small mistake gives subtly wrong focus or dismissal, and where the editor's behavior contract leaks into every consumer's code. It is documented here so Tier 1's seam is designed to *not foreclose* it, and so a future decision to greenlight it starts from a written baseline. It is not greenlit now. Do not build the standalone dock export, the hand-wired authority contract, or the headless reference composition in this pass.

The reason to draw Tier 2 even while parking it: Tier 1's slot must hand the host a *fully-wired* surface, never a kit of parts. If Tier 1 were designed as "here are the pieces, assemble them," it would be Tier 2 wearing a different hat, with the same wiring-by-hand hazard. Keeping Tier 2 visible but out of scope is what keeps Tier 1 honest about delivering a wired surface, not a toolkit.

## 7. Tier 1 design in depth

### 7.1 The placement seam, three candidate shapes

Three concrete shapes express "host places a wired surface." They are ordered by how much the editor retains control of the wiring.

The first is a **render-prop slot** on the composed editor. `OwnedModelEditor` gains props like `renderDock` and `renderToolbar`, each `(surface: ReactNode) => ReactNode`. The editor builds the wired surface element and hands it to the host's function, which returns it wrapped in the host's layout. The editor still mounts the element inside its own React tree (the function's return value renders where `OwnedModelEditor` puts it), so the overlay-authority context and the focus wrapper still enclose the surface; the host controls the surrounding markup and CSS, not the tree position. This is the smallest, safest shape: the host styles and frames, the editor keeps every context boundary.

The second is a **portal target**. `OwnedModelEditor` accepts `dockContainer?: RefObject<HTMLElement>` and `createPortal`s the wired dock into the host's node. The host gets true DOM relocation (the rail can live in a sibling column of the app shell, far from the editor in the DOM). React portals keep the React tree intact, so context still flows and events still bubble through the React parent, but the *DOM* parent is the host's. This is the shape closest to the literal request, and §7.2 explains why it is the second choice rather than the first.

The third is a **slot registry**, where the host registers named layout regions and the editor renders surfaces into them. This is over-built for the need; it reintroduces a registry where a prop suffices, and it is really Tier 2 with indirection. Rejected for Tier 1.

Recommended Tier 1 shape: the **render-prop slot** as the primary API, with the **portal target** offered as the escape hatch for the genuine "different DOM column" case. The render-prop covers most layouts (the host frames and positions with CSS while the editor keeps the tree) and is the safest; the portal covers the cases CSS cannot reach (a rail in a structurally separate region of the page) and accepts the context-scope cost §9.1 describes.

### 7.2 Why a render-prop slot, not a raw ref

A raw `ref` ("give me the host node, I'll portal there") looks like the simplest API, and it is the one the request literally asks for. It is the second choice, for three reasons. First, a portal moves the DOM parent, which moves the surface out of the editor's CSS and stacking context and, more importantly, risks moving it out of the overlay-authority provider's *DOM* neighborhood even though the React context still flows — the authority's positioning assumes a known relationship to the surface, and a host-portaled toolbar that opens the find bar must still resolve the authority correctly (§9.1). Second, a render-prop expresses the common case (frame and place with the host's own markup) without any portal at all, so the cheap 80% never pays the portal's costs. Third, a render-prop hands the host an *element*, which the host cannot accidentally mis-wire; a ref hands the editor a *location*, which is fine, but it is a strictly smaller contract than "here is the wired surface, put it where you like." The ref is offered (the portal target in §7.1) for the cases that need real DOM relocation, with the costs named.

### 7.3 What the editor keeps owning under Tier 1

The point of Tier 1 is that the host changes *where*, not *how*. Concretely, across the seam the editor retains:

- The store subscription. The surface still re-derives its command context on every selection and commit through `useStoreVersion(store)`; the host does not manage this.
- The `panelHost` lifecycle. The dock's open/active/close state stays owned by `OwnedModelEditor` (the `panelOpen`/`activePanelId` state at [owned-model-editor.tsx:308-342](../packages/editor/src/view/owned-model-editor.tsx#L308-L342)); a host-placed dock is the same dock, relocated, still driven by the same `PanelHost`.
- The overlay-authority handle. The surface stays inside the `OverlayAuthorityRefProvider` ([owned-model-editor.tsx:453](../packages/editor/src/view/owned-model-editor.tsx#L453)) under the render-prop shape, or is handed the authority explicitly under the portal shape (§9.1).
- The focus reclaim. `focusEditor` and the dead-zone mousedown reclaim (`onEditorMouseDown`, [owned-model-editor.tsx:213-227](../packages/editor/src/view/owned-model-editor.tsx#L213-L227)) keep running; the host does not reimplement focus return.
- The shared document index. Panes still read the one `MutableDocumentIndexStore` the block tree publishes into, through the `DocumentIndexProvider` the dock wraps them in; the host does not thread a second index.

The host owns the box and its surrounding layout. That is the whole of the host's new responsibility under Tier 1, and it is why Tier 1 is a packaging change rather than a behavior change.

### 7.4 The ChromeSurface concept, applied with restraint

Rail, toolbar, and tabs share a shape: a content source (a registry of contributions), a driver seam (the store plus a small control object — `panelHost` for the dock, `focusEditor`/`onFind` for the toolbar), and a shell (the component that arranges the content). It is tempting to name this "ChromeSurface" and build one unified registry and one placement mechanism for all three on day one. Resist it. The codebase's own lesson is to find the small hook that unlocks a feature class, not to SPI-ify every behavior before a second caller exists. The right move is to ship the placement slot for *one* surface (the dock, via the outline proof case), design that slot so its shape generalizes cleanly to the toolbar and tab strip (same render-prop signature, same "wired surface in, placed surface out" contract), and add the toolbar and tab slots when a real consumer need pulls them — not speculatively. Recognize the shared shape in the design; do not build the framework that abstracts it until the second and third surfaces actually arrive. The ChromeSurface idea is a naming and consistency guide for the slot signatures, not a registry to construct now.

## 8. The proof case: the outline / TOC rail

Build the seam against one surface and prove the contract end to end before generalizing. The outline rail is the right one for three reasons, each established above: the user named it; it straddles the anchored-vs-layout line (§5.4) and so forces the contract to be drawn concretely; and its pane form already exists ([outline-pane.tsx](../packages/editor/src/view/chrome/panes/outline-pane.tsx)) and is already registry-driven and index-fed, so the proof exercises the seam, not new pane code.

The proof case, concretely: a host renders `OwnedModelEditor` (or, behind the seam, the dock it owns) with a `renderDock` slot that places the dock in the host's left sidebar instead of the editor's right column. The Outline pane inside it reads the shared document index through `useDocumentIndex()`, lists the headings live as the author edits, and calls `reveal(id)` to scroll a heading into view — and the scroll must reach a windowed-out heading under virtualization (the engine `scrollToBlock`, not a `#hash`). Success is: the outline is in the host's layout, it updates live, clicking a heading scrolls the document including past the virtual window, opening and closing the dock does not corrupt offset measurement (§9.5), and a toolbar command that opens a pane (`panelHost.open`) still routes to the relocated dock. When that holds, the seam is proven and the toolbar and tab generalizations follow the same signature.

## 9. Costs, risks, and failure modes

Go in eyes open. Five costs, each real, each with a mitigation. None is a blocker for Tier 1; all are reasons the seam needs a written contract rather than an ad-hoc ref.

### 9.1 Overlay-authority context scope

The `OverlayAuthorityRefProvider` wraps the editor subtree in `OwnedModelEditor` ([owned-model-editor.tsx:453](../packages/editor/src/view/owned-model-editor.tsx#L453)). Any host-placed chrome that *opens* an overlay — a toolbar button that opens the find bar, a pane action that opens a link form — must resolve that authority. Under the render-prop shape (§7.1) this is free: the surface stays inside the provider's React tree, so the context flows. Under the portal shape it is the central hazard: the React context still flows through the portal's React parent, but a host that renders chrome *outside* `OwnedModelEditor` entirely (drifting toward Tier 2) would have no provider above it. Mitigation: expose the overlay authority as a passable *handle*, not only a React context, so a host-placed or host-rendered surface can be handed the authority explicitly and open overlays without relying on tree position. This is the single most important piece of new public surface the design adds, and it is what keeps the find button (placed) and the find bar (authority-owned) connected across the seam.

### 9.2 Focus return across the tree boundary

`focusEditor` and the dead-zone reclaim (`onEditorMouseDown`, [owned-model-editor.tsx:213-227](../packages/editor/src/view/owned-model-editor.tsx#L213-L227)) are scoped to the editor wrapper: the reclaim runs only for primary-button mousedowns that originate inside that wrapper and land on a non-focusable dead zone, returning focus to the model selection a frame later if focus fell to `<body>`. Host-placed chrome sits outside that wrapper. Toolbar commands already call `focusEditor` explicitly after running ([the `run` helper in ribbon.tsx](../packages/editor/src/view/chrome/surfaces/ribbon.tsx)), so command-driven focus return works wherever the toolbar lives. What does not extend across the boundary is the dead-zone reclaim for clicks on the *host's* chrome gaps — but that is correct, not a regression: the host owns its own layout's dead zones, and the editor trapping focus from outside its wrapper is exactly the over-eager behavior the reclaim was scoped to avoid (note.md §5.8 follow-up). Mitigation: document that host-placed chrome relies on explicit `focusEditor` calls (which commands already make) and that the editor deliberately does not reclaim focus from clicks outside its surface.

### 9.3 Roving-focus and ARIA continuity

The toolbar is one React Aria `Toolbar` with roving tab-focus and a tab strip with its own keyboard model. Place it *whole*. The failure mode is a host that wants to interleave editor toolbar items with its own buttons in one bar, or merge the editor's tabs into the app's tab system: that fragments the roving-focus contract (two widgets fighting over arrow-key navigation) and breaks the ARIA grouping screen readers announce. Mitigation: the placement seam hands the host the toolbar (or tab strip) as a single coherent widget to position, never as individual items to scatter. Tier 1 places whole surfaces; it does not expose item-level slotting. A host that genuinely needs interleaving is asking for Tier 2, which is not greenlit.

### 9.4 Two renderers, one behavior

If both the host (Tier 2) and `OwnedModelEditor` (Tier 0/1) can render `EditorToolbar`, the wiring must be identical or behavior drifts: a host that forgets to pass the overlay-authority handle, or wires a second index store, gets a toolbar that looks right and behaves subtly wrong. Even Tier 1 carries a lighter version of this: the slot must hand over a surface wired the *same* way the embedded one is. Mitigation, and a design rule: `OwnedModelEditor` should consume the *same* placement seam it exposes — it renders its chrome through the same wired-surface path a host would, so there is one wiring code path, not two. Dogfooding the seam internally is what prevents the embedded and placed surfaces from diverging. This rule also keeps Tier 1 from quietly becoming a second composition root.

### 9.5 The virtualization invariant

The dock-as-sibling rule (§3.1) is load-bearing for virtualization: the scroller must stay a stable, transform-free, independently-sized box so offset measurement (docs/025) and the `position: fixed` overlays (docs/029) keep working. A host placing the rail must not re-parent the scroller, wrap it in a transformed ancestor, or size it in a way that couples its width to the rail's open/close in a non-resize way. Mitigation: the seam's contract states the invariant explicitly — the host may place the *dock* anywhere, but the editor's *surface* must remain a transform-free box with a stable, independently-resolved size, and the host gives the editor root a definite height when using `fillHeight`. The dock and the surface are separable (that is the whole point); the surface's geometry contract is not negotiable.

## 10. Relationship to the existing SPIs

This SPI composes with the others rather than overlapping them, and naming the relationships keeps the boundaries clean.

docs/027 (Side Panel dock) owns the *content* side: the pane registry, the `PanelHost` seam, the dock's one-pane-at-a-time behavior, the responsive sheet fallback. This doc adds the *placement* side that docs/027 §8.4 reserved as the `renderDock` hatch. The pane registry is unchanged; the dock shell gains a placement seam.

docs/029 (overlay authority) is the boundary this doc must not cross (§5.3). The placement SPI covers only layout-anchored chrome; every anchored, transient surface stays with the authority. The one new public handle this doc proposes — the passable overlay-authority handle (§9.1) — extends docs/029's reach to host-placed *triggers* without moving any *surface* out of the authority's ownership.

docs/023 (toolbar layout SPI) owns the toolbar's content and arrangement (tabs, slots, responsive collapse). This doc's toolbar generalization (§7.4) places the toolbar widget; it does not touch how the toolbar arranges its own commands.

docs/026 (host data provider SPI) is the precedent for the ownership split (§4): `renderPicker` is host-fills-body, engine-owns-lifecycle, and the placement seam is that pattern at the shell scale.

docs/005 (the removed TOC aside rail) is the history this doc answers (§3.3): the old rail mixed an anchored surface into host layout with no contract; this doc draws the contract first (§5) and lets only layout-class surfaces across.

docs/025 (virtual geometry) is the invariant §9.5 protects.

## 11. Open decisions to lock before code

Lock the host-facing usage shape before any internals, because the call the consumer writes dictates the plumbing underneath (the SPI-first rule the editor has followed throughout). The decisions:

- The Tier 1 API shape: render-prop slot as primary with a portal target as the escape hatch (§7.1 recommends this), versus render-prop only, versus portal only. This is the one to settle first; everything else follows from it.
- Whether the overlay-authority handle is exposed now (§9.1) or only when a host-placed *trigger* needs it. Recommendation: now, because the find button is the first realistic host-placed trigger and it needs the handle to open the find bar.
- Whether the first surface is the dock alone (recommended, §8) or the dock and toolbar together. Recommendation: dock alone, prove it, then the toolbar follows the same signature.
- The exact slot prop names and signatures (`renderDock(surface) => ReactNode`, `dockContainer?: RefObject`), so the toolbar and tab generalizations can mirror them verbatim.

## 12. Verification and test plan

The outline proof case (§8) is the gate that says the seam is real; HPC-2 below specifies it as a buildable workstream. This section states the invariants every test defends, so a reviewer reading a future PR knows what "the seam works" means concretely.

The invariants a placed dock must satisfy, each an assertable check:

- **Relocation.** The dock renders in the host's chosen layout region, not the editor's default right column, while the editing surface stays where it is. Assert the dock's DOM ancestor is the host slot, not `data-engine-editor-body`.
- **Liveness.** The Outline pane lists headings from the shared `MutableDocumentIndexStore` and updates as the author edits, with no second worker round-trip. Assert a heading edit changes the pane's rows.
- **Jump-to-anchor under virtualization.** Clicking a heading calls the engine `reveal`/`scrollToBlock` and scrolls a windowed-out heading into view — a plain `#hash` cannot. Assert a deep heading past the virtual window scrolls into view.
- **No geometry corruption.** Opening and closing the placed dock does not corrupt offset measurement (docs/025). Assert a deep-scroll position and caret rect are unchanged across a dock open/close.
- **Lifecycle routing.** A toolbar command's `panelHost.open(paneId)` routes to the relocated dock, opening the right pane. Assert a Review-tab command opens the placed dock on the right pane.
- **Cross-seam overlays.** A host-placed find *button* opens the authority-owned find *bar* through the passable authority handle (§9.1). Assert the button (in host layout) opens the bar (authority-positioned), proving the §5.3 line holds across the seam.
- **One wiring path.** The embedded dock (Tier 0) and the placed dock (Tier 1) are wired identically because `OwnedModelEditor` consumes the same seam internally (§9.4). Assert via a shared wiring helper used by both, covered by both render paths' tests.

Verification mechanics follow the house pattern (the R-series in note.md §5): a Ladle story per state, jsdom unit tests for wiring and rendering, and cross-browser Playwright e2e (`tests/e2e/`) for the scroll/geometry/overlay assertions that need real layout. The eligibility line (§5) is also a guard, not only prose: the placement seam exposes only the layout-class surfaces, and a test asserts the anchored surfaces (find bar, flyout, slash, context menu, forms) have no placement prop and stay authority-owned.

## 13. Implementation backlog

Not greenlit to code past **HPC-0** until §11 locks the API shape. The IDs below are the shape the work takes once it is; they are sequenced proof-first so each is reviewable and testable on its own. Each consumer-facing change reaches content-api only after a republish, per the cross-repo release ritual in CLAUDE.md.

### HPC-0. Lock the contracts

Scope:

- `docs/034_host_placed_editor_chrome_spi.md` (this doc)

Tasks:

- [ ] Choose the Tier 1 API shape: render-prop slot primary (`renderDock(surface) => ReactNode`) plus an optional `dockContainer?: RefObject<HTMLElement>` portal escape hatch (§7.1 recommends this), versus render-prop only, versus portal only.
- [ ] Ratify the anchored-vs-layout line (§5) as the eligibility contract, with the find button/bar split as the worked example.
- [ ] Decide whether the overlay-authority handle is exposed now (§9.1) or only when a host-placed trigger needs it (recommendation: now).
- [ ] Confirm the dock is the first and only surface (§8); the toolbar and tab strip follow the same signature later (HPC-F1).

Acceptance criteria:

- The §11 decisions are recorded with a host-facing usage example — the exact call content-api would write.

Tests:

- None; this is a design gate, signed off by review.

### HPC-1. Dock placement seam

Scope:

- `packages/editor/src/view/owned-model-editor.tsx` (the composition root that owns the dock, `panelHost`, the authority ref, focus reclaim)
- `packages/editor/src/index.ts` (public exports for any new prop types / authority handle)
- a new placement-seam module under `packages/editor/src/view/` if the slot logic warrants its own file

Tasks:

- [ ] Add the `renderDock` render-prop (and the optional `dockContainer` portal target) to `OwnedModelEditor`.
- [ ] Render the dock through the seam, and have `OwnedModelEditor` consume the same seam internally so there is one wiring path (§9.4), not a second composition root.
- [ ] Expose the overlay-authority handle as a passable value if HPC-0 chose to (§9.1).
- [ ] Document the surface geometry invariant the host must honor (§9.5): a transform-free, independently-sized scroller box.

Acceptance criteria:

- A host can place the dock in its own layout; the embedded (Tier 0) behavior is unchanged; the `PanelHost` lifecycle, focus reclaim, and shared index all stay intact across the seam.

Tests:

- `pnpm test` jsdom unit: the placed dock renders and is wired (store subscription, `panelHost`, index) identically to the embedded dock; a story exercising the placed state.

### HPC-2. Outline proof case

Scope:

- `stories/` (a placed-dock story)
- `tests/e2e/` and `tests/editor/` (the consumer-shaped specs)
- `packages/editor/src/view/chrome/panes/outline-pane.tsx` (existing pane, exercised not rewritten)

Tasks:

- [ ] A story placing the dock in a host sidebar, driving the Outline pane against a virtualized document.
- [ ] A consumer-shaped test asserting every §12 invariant: relocation, liveness, jump-to-windowed-heading, no offset corruption across open/close, relocated `panelHost.open` routing, and the find-button-opens-find-bar cross-seam check.

Acceptance criteria:

- The §8 success criteria hold end to end, cross-browser; this is the gate that promotes the seam from "implemented" to "proven."

Tests:

- Ladle story + Playwright e2e (chromium/webkit/firefox) per the note.md §5 R-series pattern; jsdom for the wiring assertions.

## 14. Future backlog (not greenlit)

Kept separate from the release work above on purpose; none of this is greenlit, and HPC-1's signature exists partly to not foreclose it.

### HPC-F1. Toolbar and tab-strip placement

Generalize the placement seam to the formatting toolbar and the tab strip with the identical render-prop signature from HPC-1, only when a real consumer need pulls it (§7.4) — not speculatively. Place whole widgets (§9.3); no item-level slotting or interleaving with host buttons.

### HPC-F2. Tier 2 headless

The standalone dock export, the hand-wired overlay-authority contract a host reproduces, and the headless reference composition (§6.3). Requires a separate greenlight. Documented to bound HPC-1's shape, explicitly not to be built in this line of work.

## 15. Definition of done

This design (not the code) is done when each is true and signed off by review:

- The Tier 1 API shape is chosen and written as a host-facing usage example — the call content-api would write (HPC-0).
- The anchored-vs-layout line (§5) is ratified as the eligibility contract, with the find button/bar split as the worked example.
- The overlay-authority-handle decision (§9.1) is made.
- The outline proof case (§8/HPC-2) is specified as the first and only surface for the first implementation.
- The five costs (§9) are accepted with their mitigations recorded.
- Tier 2 (§6.3/HPC-F2) stays documented and parked.

The code DoD is deferred to the HPC-1 and HPC-2 acceptance criteria above; no code is written from this doc until the API shape in §11 is locked.

## 16. Out of scope

Moving any anchored, transient overlay out of the editor (§5.3) — a hard boundary, not a later phase. The full headless path (Tier 2, §6.3 / HPC-F2) — documented to bound the design, not greenlit. Item-level toolbar slotting or interleaving editor chrome with host buttons in one widget (§9.3) — a Tier 2 ask. Any persistence, reader, model, or overlay-authority change. The legacy `RichTextEditor` aside rail (docs/005) — superseded by the dock; this doc does not revive it. Code — this pass is the design only.

## 17. Final model

The editor owns what its chrome renders and how it behaves; the host owns where the persistent chrome sits. That split already exists in the code as registries (panes, toolbar tabs and slots) feeding an editor-rendered shell, with every coupling expressed as a value (`store`, `panelHost`, the authority handle, the shared index) rather than a DOM reach. Tier 1 adds one thing to that picture: a placement slot that hands the host a fully-wired chrome surface to position in its own layout, proven first against the outline rail because that surface sits exactly on the anchored-vs-layout line the whole design depends on. The line is the load-bearing decision — layout-anchored chrome crosses the seam, content-anchored overlays stay with the authority — and it is what makes this host-placed rail clean where the removed docs/005 rail was not.
