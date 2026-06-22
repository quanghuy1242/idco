# 023 - Toolbar SPI And Ribbon-Lite Authoring Surface

> Status: design-grade proposal (no implementation backlog by request)
>
> Date: 2026-06-22
>
> Scope:
>
> - `packages/editor/src/view/chrome/editor-chrome.tsx` — the current persistent toolbar (`EditorToolbar`), the surface this document redesigns.
> - `packages/editor/src/view/chrome/chrome-commands.ts` — store-command helpers shared by toolbar + context menu (the shared-command precedent).
> - `packages/editor/src/view/spi/mark-registry.ts` — `MarkDefinition` + `listMarks` (format-mark descriptors the toolbar already projects).
> - `packages/editor/src/view/spi/block-type-registry.ts` — `BlockTypeDefinition` + `listBlockTypes` (block-type chooser descriptors).
> - `packages/editor/src/view/spi/node-view.ts`, `packages/editor/src/view/spi/structural-view.ts` — `NodeViewInsert` / `StructuralNodeViewInsert` (the insert-menu affordance the toolbar projects).
> - `packages/editor/src/view/spi/index.ts` — the view SPI barrel that would export the new toolbar SPI.
> - `packages/editor/src/core/store/editor-store.ts` — `store.command` / `store.query` (the dispatch/read contract toolbar items are wired to).
> - `packages/editor/src/core/model/model.ts` — `DocumentSettings = JsonObject` (the publication-settings boundary, untyped today).
> - `packages/editor/src/view/nodes/table/table.tsx` — `tableStructuralView` (Insert→Table's target node and its parameterless `insert.createCommand`).
> - `tests/editor/engine-chrome.test.tsx`, `tests/e2e/engine-toolbar.spec.ts` — current toolbar coverage the new model must keep green.
>
> Source docs:
>
> - `docs/006_editor_toolbar_redesign_plan.md` — the ribbon-lite philosophy, task-tab IA, three-surface model, and the §7.1 "separate toolbar tabs and slots from registry groups" decision this document carries into the owned engine. Note: doc 006 targets the legacy Lexical editor; its §2 current-state findings are obsolete here.
> - `docs/016_node_spi_and_pluggable_blocks.md`, `docs/021_structural_node_spi.md` — the node/structural SPI whose "register, don't hardcode" rule this document extends to the toolbar.
> - `docs/020_editor_architectural_refactor.md` — the curated public-surface and view-layer contract the toolbar SPI must respect.
>
> Related docs:
>
> - `docs/004_selection_flyout_and_context_actions.md` — the selected-text-run surface (legacy), relevant to the three-surface orthogonality decision (§5.7).
> - `docs/022_live_editable_table.md` — the table node and its chrome (`renderOverlay`), the object-chrome surface that the toolbar must stay orthogonal to.
>
> Assumptions:
>
> - The owned-model engine is the only editor in scope. The legacy Lexical toolbar (`editor-legacy`) is out of scope and is not modified.
> - "Register, don't hardcode" (docs/016 §10) is the governing rule: the toolbar must become a registered, slotted surface, not a fixed JSX layout.
> - First release supports exactly two tabs with real content — **Home** and **Insert** (Insert ships only the Table tool via a dimension picker). Every other tab (Data, View, Review, AI) must be *registrable* but ships empty/hidden, so adding one later is registration, not a redesign.
> - The toolbar is product-neutral. Host data/services arrive through typed bindings or capability flags, never product fetch/auth/persistence imports (docs/020, AGENTS.md).
> - All interactive primitives are React Aria behavior + DaisyUI styling (AGENTS.md, idco-ui SKILL). No hand-rolled menus/popovers/tabs.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 What Is Already Registry-Driven](#31-what-is-already-registry-driven)
  - [3.2 What Is Hardcoded](#32-what-is-hardcoded)
  - [3.3 What Does Not Exist Yet](#33-what-does-not-exist-yet)
  - [3.4 The Owned Engine Has No Command Registry](#34-the-owned-engine-has-no-command-registry)
  - [3.5 Adjacent Surfaces And Boundaries](#35-adjacent-surfaces-and-boundaries)
  - [3.6 Why Doc 006 Cannot Be Lifted Verbatim](#36-why-doc-006-cannot-be-lifted-verbatim)
- [4. Design Principles Carried Forward](#4-design-principles-carried-forward)
- [5. Target Model: The Toolbar SPI](#5-target-model-the-toolbar-spi)
  - [5.1 Three Layers: Registries, Layout, Renderer](#51-three-layers-registries-layout-renderer)
  - [5.2 The Action Descriptor SPI](#52-the-action-descriptor-spi)
  - [5.3 The Toolbar Context](#53-the-toolbar-context)
  - [5.4 Tabs, Slots, And Items](#54-tabs-slots-and-items)
  - [5.5 The Pure Layout Function](#55-the-pure-layout-function)
  - [5.6 Capability Gating](#56-capability-gating)
  - [5.7 Three Surfaces And The Selection Flyout Question](#57-three-surfaces-and-the-selection-flyout-question)
  - [5.8 Public Surface Additions](#58-public-surface-additions)
- [6. Architecture Decisions](#6-architecture-decisions)
  - [6.1 Separate Layout Layer From Registries (Recommended)](#61-separate-layout-layer-from-registries-recommended)
  - [6.2 Inline Command Wiring On Actions, Not A Command Registry (Recommended)](#62-inline-command-wiring-on-actions-not-a-command-registry-recommended)
  - [6.3 Layout Config: Built-In Default + Host Override (Recommended)](#63-layout-config-built-in-default--host-override-recommended)
  - [6.4 Container-Query Responsive, Measured Overflow Last (Recommended)](#64-container-query-responsive-measured-overflow-last-recommended)
  - [6.5 Rejected And Deferred Options](#65-rejected-and-deferred-options)
- [7. First-Release Surface: Home And Insert](#7-first-release-surface-home-and-insert)
  - [7.1 Home Tab](#71-home-tab)
  - [7.2 Insert Tab And The Table Dimension Picker](#72-insert-tab-and-the-table-dimension-picker)
  - [7.3 Migrating The Three Hardcoded Buttons](#73-migrating-the-three-hardcoded-buttons)
  - [7.4 Empty-But-Registrable Tabs](#74-empty-but-registrable-tabs)
- [8. Selection, Focus, And Overlay Integration](#8-selection-focus-and-overlay-integration)
- [9. Risks, Caveats, Edge Cases, And Failure Modes](#9-risks-caveats-edge-cases-and-failure-modes)
- [10. Test And Verification Plan](#10-test-and-verification-plan)
- [11. Definition Of Done](#11-definition-of-done)
- [12. Final Model](#12-final-model)

## 1. Goal

Replace the owned editor's fixed-layout toolbar with a registered, slotted, capability-gated **ribbon-lite** surface that makes the authoring model visible (task tabs with named homes for commands) and is extensible without editing the toolbar component. The toolbar must become an SPI: a host or a future feature adds a tab, a slot, or an action by *registering a descriptor*, the same way a block is added today via `registerNode` (docs/016).

This document carries the design philosophy of docs/006 — a modern collapsed ribbon (one command row per tab), commands with one obvious home, complex tools in focused popovers, responsive behavior that preserves the active tab, and three orthogonal command surfaces by selection scope — into the owned-model engine, and specifies the SPI shape that realizes it.

First-release boundary: ship **Home** (full text/block editing) and **Insert** (Table only, via a dimension picker). All other tabs (Data, View, Review, AI) are part of the SPI's type and layout model from day one but ship with no registered content, so they do not appear until a feature or host registers into them. The point of the first release is the *mechanism*, proven against two real tabs and by migrating the three buttons that are hardcoded today.

Non-goals (explicitly out of this document):

- No implementation backlog or ticket breakdown. This is a design specification; sequencing into work items happens elsewhere.
- No Data/AI/View/Review tab *content*, no mermaid, data-grid, publication-layout UI, or bake pipeline. Those are separate workstreams from docs/006 §5–§6; this SPI must *enable* them but does not build them.
- No new command set. The toolbar dispatches the store commands that already exist (`toggle-mark`, `set-block-type`, `indent`, `set-link`, `insert-structural`, …).
- No hand-rolled overlays/menus/tabs; React Aria behavior + DaisyUI styling only.

## 2. System Summary

The owned editor renders three command surfaces, distinguished by what is selected when the author invokes a command (docs/006 §3.11):

- The **ribbon** (this document) owns *creation* and *document-global* work — formatting the current selection/block, inserting objects, and future view/review/AI modes. It is the persistent toolbar.
- **Object chrome** owns configuring the *selected object* — already implemented as the structural `renderOverlay` SPI slot (docs/021, docs/022): the table's hover controls and the callout's tone chrome mount through it, not through the toolbar.
- The **selection flyout** owns the *selected text run* — present in the legacy editor (docs/004), **not present** in the owned engine today (§3.5, §5.7).

The ribbon reads engine state through `store.query` and mutates through `store.command`; it never touches the DOM selection directly (`editor-chrome.tsx` header, lines 10–11). Toolbar state stays live through `useToolbarVersion(store)`, which re-reads queries on every selection/commit (`editor-chrome.tsx:49`). The model selection survives focus loss so a toolbar press does not collapse the caret (docs/011 §8.6). This SPI changes *how the toolbar is composed*, not this query/command/focus spine.

## 3. Current-State Findings

### 3.1 What Is Already Registry-Driven

Three of the toolbar's surfaces already project from descriptor registries, and the same registries feed the context menu so the two cannot drift (the W6 dedup):

- **Format marks** — `EditorToolbar` reads `listMarks().filter((m) => m.toolbar)` (`editor-chrome.tsx:86`). A `MarkDefinition` (`spi/mark-registry.ts`) with a `toolbar: { icon, label }` becomes a toggle button. Display order is registration order.
- **Block-type chooser** — `listBlockTypes().filter((b) => b.chooser)` (`editor-chrome.tsx:87`). A `BlockTypeDefinition` (`spi/block-type-registry.ts`) with `chooser: true` becomes a dropdown entry; each carries `label`, `icon`, `preview`, `ariaRole`.
- **Insert menu** — `listInsertableNodes()` + `listInsertableStructuralNodes()` (`editor-chrome.tsx:129–135`). A node/structural view with an `insert` affordance (`{ label, group?, keywords?, icon?, createCommand() }`) appears automatically; the toolbar dispatches `store.command(view.insert.createCommand())`.

These prove the "register a descriptor → it appears" pattern works and is the foundation the toolbar SPI extends. They also prove the engine already separates *what a thing is* (the descriptor) from *how the toolbar renders it*.

### 3.2 What Is Hardcoded

Everything that is not one of those three projections is literal JSX inside the single `EditorToolbar` component:

- **List buttons** (bulleted, numbered) — literal `<Button>` calling `listToggleCommand(active, kind)` (`editor-chrome.tsx:297–318`).
- **Indent / outdent** — literal `<Button>` dispatching `{ type: "indent" | "outdent" }` (`editor-chrome.tsx:319–336`).
- **Link** button + edit popover — fully inline (`editor-chrome.tsx:340+`), including the `set-link` / `clear-link` wiring and the `active-link-href` query.
- **The toolbar composition itself** — the order, the `<Sep/>` grouping, and which built-in groups exist are fixed in the component body. There is no data describing the layout; the layout *is* the JSX.

The consequence: any new control — even a host's one custom button — requires editing `editor-chrome.tsx`. The three hardcoded buttons are themselves the proof that no action-registration mechanism exists; if it did, they would use it.

### 3.3 What Does Not Exist Yet

- **No task tabs.** The toolbar is one flat row; there is no Home/Insert/View/Review/Data/AI concept.
- **No slot/layout layer.** There is no data structure describing "which group owns which control, in what order," and no pure function computing a visible layout. Composition is imperative JSX.
- **No action descriptor SPI.** There is no `registerToolbarAction` analogue to `registerMark`/`registerBlockType`.
- **No capability gating.** Nothing hides a control or group based on host bindings or current selection beyond per-button `disabled` checks.
- **No designed responsive behavior.** The toolbar root is a flex-wrap row; on narrow widths it wraps into a noisy second line rather than collapsing by semantic group (the exact failure docs/006 §2.1 calls out for the legacy editor, reproduced here).

### 3.4 The Owned Engine Has No Command Registry

Doc 006 assumes a central `commands.ts` registry with `CommandGroup`/`CommandSurface`/`CommandPlacement` metadata, and its `ToolbarItem` model references commands by `commandId` (006 §7.1). The owned engine has **no such registry**. Commands are typed discriminated unions dispatched ad hoc: `store.command({ type: "toggle-mark", … })`, `store.query({ type: "is-mark-active", … })`, `store.command({ type: "set-block-type", … })`, `store.command({ type: "set-link", href })`, `store.query({ type: "active-link-href" })`. There is no descriptor that says "command X exists, lives in group Y, shows on surface Z."

This is a structural divergence from 006, not a gap to fill: the owned engine already distributes command *metadata* across the per-concern registries (a `MarkDefinition.toolbar` is the bold button's metadata; a `BlockTypeDefinition.chooser` is the heading entry's metadata). The toolbar SPI should follow that grain — descriptors that carry their own command wiring — rather than reintroduce a monolithic command registry. §6.2 makes this an explicit decision.

### 3.5 Adjacent Surfaces And Boundaries

- **Object chrome exists.** `view/chrome/` holds `context-menu.tsx`, `link-popover.tsx`, `find-bar.tsx`. Per-object floating chrome lives elsewhere (the table controls in `view/nodes/table/`), registered through the structural `renderOverlay` slot. So the "configure the object from the object" surface (006 §7.8) is already realized and must not be duplicated by the ribbon.
- **No selection flyout.** Unlike the legacy editor (docs/004) there is no floating text-run toolbar in the owned engine. The only text-run surface today is the right-click `context-menu`. This matters for the three-surface model (§5.7).
- **Publication-settings boundary is opaque.** `DocumentSettings = JsonObject` (`core/model/model.ts:256`) rides on the snapshot (`settings` field), so a document-level settings layer *exists* but is untyped and unmodeled. Doc 006 §6 wants a typed publication-settings contract; that is out of scope here, but the View tab's eventual home for it is noted so the SPI does not preclude it.

### 3.6 Why Doc 006 Cannot Be Lifted Verbatim

Doc 006's §2 (Baseline Toolbar, Baseline Command Registry, host bindings) describes `packages/editor/src/plugins/toolbar-plugin.tsx` and `model/commands.ts` — files that now live in the extracted `editor-legacy` package. Those findings are obsolete for the owned engine. What survives unchanged is the *design intent*: §1 (goal), §3 (product principles), §4 (target tab model), §7.1 (tabs/slots vs registry groups), §7.8 (object chrome over contextual tabs), §8.1/§8.3/§8.6/§8.9 (layout helper, rendering, responsive, overlay focus). This document re-grounds that intent on the owned engine's registries and store-command model.

## 4. Design Principles Carried Forward

From docs/006 §3, adapted to the owned engine and constrained to what the toolbar SPI must honor:

1. **Task tabs come first.** The active tab names the kind of work (edit / insert / view / review / data / AI). The first release shows Home and Insert; the model understands all tabs.
2. **One command, one obvious home.** Paragraph/heading/list/alignment/marks belong to Home. Object creation belongs to Insert (and later Data). The SPI must make a control's home explicit (its slot), not inferred from a label.
3. **Creation is not transformation.** Inserting a table is an Insert action; turning a paragraph into a heading is a Home transform. They are different item kinds in the SPI (`insert` vs `blockType`).
4. **Complex tools get focused popovers.** Table dimensions, link editing, future media/TOC settings open React Aria `Popover`/`Dialog`, never rows inside a menu. The SPI's `popover` action kind exists for this.
5. **The toolbar shows the product model.** If the desktop toolbar still reads as one flat row after this work, the design failed even if the internals improved (006 §3.7).
6. **Responsive preserves the active tab.** Collapse by semantic slot; never collapse the model into a generic `More` bucket (006 §3.8, §7.2).
7. **Three surfaces, orthogonal by scope.** Ribbon = creation/global; object chrome = selected object; flyout = selected text run. The SPI must not let the ribbon duplicate object chrome (006 §3.11, §7.8).
8. **Object configuration lives on the object.** No Word-style contextual ribbon tabs; configuration is chrome (already true via `renderOverlay`). The ribbon owns creation and selection/text editing only (006 §7.8).
9. **Provenance is gating, not navigation (006 §3.15/§7.9).** Whether a tool is host-backed only decides whether it is *enabled/visible*, never which tab it lives in. Image stays an Insert tool even when its picker is host-backed.
10. **A tab earns its place by being full.** Capability-gating may hide a tab whose bindings are absent; the design must also not raise a tab too thin to read as finished. Hence first release ships only Home and Insert with content (006 §3.16).

## 5. Target Model: The Toolbar SPI

### 5.1 Three Layers: Registries, Layout, Renderer

The toolbar is decomposed into three layers, mirroring docs/006 §7.1 but grounded on owned-engine constructs:

- **Layer 1 — Registries (what exists).** The existing `mark-registry`, `block-type-registry`, node/structural `insert` affordances, plus a *new* `toolbar-action-registry`. Each holds descriptors that carry their own command wiring and metadata. This layer answers "what controls exist and how does each behave."
- **Layer 2 — Layout (the product surface).** A pure, DOM-free function that places registry items into **tabs** and **slots**, applies **capability gating**, and returns a fully resolved, ordered structure. This is the layer doc 006 calls the "toolbar layout model" (§8.1). It answers "which tab/slot owns each control, in what order, and whether it is visible."
- **Layer 3 — Renderer (pixels).** `EditorToolbar` consumes the resolved layout and renders tabs (React Aria `Tabs`), slots (grouped rows with `<Sep/>`), and items (React Aria `Button`/`MenuTrigger`/`DialogTrigger` + DaisyUI). It owns responsive collapse and overlay focus, nothing else. It contains no command knowledge and no fixed group order.

The hard rule: Layer 3 holds zero command/layout knowledge; all of it is data flowing from Layers 1→2. That is what makes the toolbar pluggable — a host changes the surface by registering into Layer 1 or supplying a Layer 2 config, never by editing Layer 3.

### 5.2 The Action Descriptor SPI

The missing primitive. An action is any toolbar control that is not already covered by a mark, block-type, or insert descriptor — today that is list, indent, link, and any future or host-custom button. Shape:

```ts
// packages/editor/src/view/spi/toolbar-action-registry.ts (new)

export type ToolbarActionKind = "toggle" | "button" | "dropdown" | "popover";

export type ToolbarActionContext = {
  readonly store: EditorStore;
  /** Live selection facts derived once per render (see §5.3). */
  readonly selection: ToolbarSelectionFacts;
  /** Host/runtime capability flags (see §5.6). */
  readonly capabilities: ToolbarCapabilities;
};

export type ToolbarAction = {
  /** Stable id, unique across actions; also the slot-placement key. */
  readonly id: string;
  /** The slot this action lands in, e.g. "home.lists" (see §5.4). */
  readonly slot: string;
  /** Order within the slot; ties break by registration order. */
  readonly order?: number;
  readonly kind: ToolbarActionKind;
  readonly label: string;
  /** Registered lucide icon name (nav-icons registry). */
  readonly icon: string;
  /** Toggle highlight state; read through the store, never the DOM. */
  isActive?(ctx: ToolbarActionContext): boolean;
  /** Disabled (visible but greyed) by current selection/capability. */
  isDisabled?(ctx: ToolbarActionContext): boolean;
  /** Visible at all; absence keeps it out of the layout entirely. */
  isAvailable?(ctx: ToolbarActionContext): boolean;
  /** For "toggle"/"button": the store mutation to run on press. */
  run?(ctx: ToolbarActionContext): void;
  /** For "dropdown"/"popover": the focused body (React Aria + DaisyUI). */
  render?(ctx: ToolbarActionContext & { close: () => void }): ReactNode;
  /** Lower = collapses sooner under width pressure (see §6.4). */
  readonly responsivePriority?: number;
};

export function registerToolbarAction(action: ToolbarAction): void;
export function getToolbarAction(id: string): ToolbarAction | undefined;
export function listToolbarActions(): readonly ToolbarAction[];
export function unregisterToolbarAction(id: string): void;
```

`isAvailable` vs `isDisabled` is deliberate and mirrors the product principle that provenance gates availability (§4.9): `isAvailable: false` removes the control (a host without a binding never sees it); `isDisabled: true` shows it greyed (the action is supported but not valid for the current selection). The two map to different author meanings and must not be collapsed.

Registration is idempotent by `id` (re-import / HMR replaces, matching `registerMark`/`registerNodeView`). Built-in actions register through a named `registerBuiltInToolbarActions()` entry point. The correctness path is the **orchestrator-explicit call**: `react-view.tsx` imports the registrar as a named binding and calls it in the same init block that already runs `registerBuiltInNodeViews()` / `registerBuiltInMarks()` / `registerBuiltInBlockTypes()` (`view/react-view.tsx:77–84`). Because the editor surface the consumer imports references the registrar by name, the module stays reachable and registration is deterministic and ordered — so the package keeps `sideEffects: false` and tree-shaking stays on. A bare `registerBuiltInToolbarActions();` at module load may remain as a convenience for direct deep-imports and tests, but it is *not* what correctness depends on (that is the `sideEffects` resolution in §9, F3 of note.md).

### 5.3 The Toolbar Context

Every predicate and renderer receives a `ToolbarActionContext` computed once per toolbar render, so item resolution is a pure function of state, not of ad-hoc DOM reads. The selection facts are the owned-engine analogue of doc 006 §8.9's "the toolbar must track real selected text":

```ts
export type ToolbarSelectionFacts = {
  readonly hasSelection: boolean;       // non-collapsed range exists
  readonly selectedText: string;        // the run text, "" when collapsed
  readonly blockType: string | null;    // active text-leaf block type
  readonly activeMarks: ReadonlySet<TextMarkKind>;
  readonly inObject: boolean;           // caret inside an object/structural scope
};
```

These derive entirely from `store.query` (e.g. `is-mark-active`, the active block type, `active-link-href`) computed under the existing `useToolbarVersion` subscription, so they stay live without new machinery. The current toolbar hardcodes `hasSelectedText: false` in places (006 §8.9 flagged the same legacy bug); the SPI requires real selection facts because AI-selection and comment-on-selection actions depend on them later.

### 5.4 Tabs, Slots, And Items

```ts
export type ToolbarTabId = string; // built-ins: "home" | "insert" | "view" | "review" | "data" | "ai"

export type ToolbarTab = {
  readonly id: ToolbarTabId;
  readonly label: string;
  readonly order: number;
  /** Hidden entirely when this returns false (e.g. no AI provider). */
  isAvailable?(ctx: ToolbarActionContext): boolean;
};

export type ToolbarSlot = {
  /** Dotted id "tab.group", e.g. "home.text", "insert.tables". */
  readonly id: string;
  readonly tab: ToolbarTabId;
  readonly order: number;
  /** Optional group label for dense/mobile presentation. */
  readonly label?: string;
};

/** A placement maps a registry source into a slot. The layout walks these. */
export type ToolbarItem =
  | { readonly kind: "mark"; readonly markKind: TextMarkKind; readonly slot: string; readonly order?: number }
  | { readonly kind: "blockType"; readonly slot: string; readonly order?: number } // the whole chooser as one control
  | { readonly kind: "insert"; readonly nodeType: string; readonly slot: string; readonly order?: number }
  | { readonly kind: "action"; readonly actionId: string; readonly slot: string; readonly order?: number }
  | { readonly kind: "component"; readonly id: string; readonly slot: string; readonly order?: number; render(ctx: ToolbarActionContext): ReactNode };
```

The five item kinds are the owned-engine translation of doc 006 §7.1's `ToolbarItem` union. `commandId`/`dataSource`/`providerAction` from 006 collapse into `action` (carrying inline command wiring) and `insert` (the node SPI's affordance); `component` is the escape hatch for arbitrary host React when no descriptor kind fits (a custom AI prompt box, a host status chip). The `blockType` item is a single control (the chooser dropdown), not one item per block type — the chooser owns its own internal list from `listBlockTypes()`.

### 5.5 The Pure Layout Function

```ts
export type ResolvedToolbarItem = { kind; control: /* normalized render spec */; disabled: boolean; priority: number };
export type ResolvedToolbarSlot = { id: string; label?: string; items: ResolvedToolbarItem[] };
export type ResolvedToolbarTab = { id: ToolbarTabId; label: string; slots: ResolvedToolbarSlot[] };
export type ResolvedToolbarLayout = { tabs: ResolvedToolbarTab[]; defaultTab: ToolbarTabId };

export function computeToolbarLayout(
  config: ToolbarLayoutConfig,
  ctx: ToolbarActionContext,
): ResolvedToolbarLayout;
```

`computeToolbarLayout` is **pure and DOM-free** (doc 006 §8.1): given a layout config and the context, it resolves tabs (drop those whose `isAvailable` is false), resolves slots, resolves each placement against its registry (`mark` → `getMark`, `blockType` → `listBlockTypes`, `insert` → the node/structural view, `action` → `getToolbarAction`), drops unavailable items, computes `disabled`, sorts by `order` then registration order, and drops now-empty slots and now-empty tabs. It answers every question doc 006 §8.1 lists (which tabs, default tab, which slots, which items, which are hidden by capability, which are disabled by selection, which labels can collapse) without measuring anything. This is the unit-testable heart of the SPI: a feature's appearance is asserted by calling this function, no DOM.

### 5.6 Capability Gating

```ts
export type ToolbarCapabilities = {
  readonly insertTable: boolean;   // true in first release
  readonly media: boolean;         // !!bindings.mediaLibrary (future)
  readonly review: boolean;        // !!bindings.comments (future)
  readonly ai: boolean;            // !!bindings.ai (future)
  readonly [key: string]: boolean; // open for host-defined tabs/actions
};
```

Capabilities are computed once from `EditorToolbar` props/bindings and threaded into the context. Gating is configured per deployment, not per document, so the tab set is stable, not shimmering (doc 006 §3.16/§4.1). In the first release `insertTable` is the only true non-Home capability; `media`/`review`/`ai` are false, so Data/Review/AI tabs resolve to empty and are dropped by `computeToolbarLayout`. This is how "registrable but hidden" is enforced: the type model knows the tabs; the layout function removes the empty ones.

### 5.7 Three Surfaces And The Selection Flyout Question

The ribbon is one of three surfaces (§4.7). Object chrome already exists (`renderOverlay`). The **selection flyout does not exist in the owned engine** (§3.5). Doc 006's model puts text-run actions (e.g. apply bold to a selection, add a comment to a range) on the flyout. The owned engine currently puts all formatting on the persistent toolbar's Home row and offers a right-click context menu.

This document does not build a flyout (it is not Home or Insert), but the SPI must take a *position* so the third surface is not architecturally precluded:

- The toolbar SPI's `ToolbarActionContext` and `ToolbarSelectionFacts` are surface-agnostic by design. A future selection flyout is the *same registry projected into a different host* (a floating React Aria popover anchored to the selection rect), filtering actions by a `surface` tag rather than rebuilding the descriptor set.
- Therefore: add an optional `surfaces?: readonly ("ribbon" | "flyout" | "contextMenu")[]` field to `ToolbarAction` (default `["ribbon"]`). First release uses only `ribbon`. This single field reserves the orthogonality without building the flyout, and prevents a later flyout from being a parallel descriptor system (the duplication doc 006 §3.11 warns against).

This is a recorded design position, not deferred silence: the flyout is out of first-release scope, the `surfaces` field is in the SPI from day one so it never becomes a breaking change.

### 5.8 Public Surface Additions

New exports on `packages/editor/src/view/spi/index.ts` (and the curated root `packages/editor/src/index.ts`, per docs/020 §4.5):

- Types: `ToolbarAction`, `ToolbarActionKind`, `ToolbarActionContext`, `ToolbarSelectionFacts`, `ToolbarCapabilities`, `ToolbarTab`, `ToolbarSlot`, `ToolbarItem`, `ToolbarLayoutConfig`, `ResolvedToolbarLayout`.
- Functions: `registerToolbarAction`, `getToolbarAction`, `listToolbarActions`, `unregisterToolbarAction`, `registerToolbarTab`, `registerToolbarSlot`.
- `computeToolbarLayout` stays orchestrator-internal (deep-imported by `EditorToolbar` and tests), mirroring how `listOverlayStructuralViews`/`listTabHandlers` are internal (note.md W1/VP6) — it is the engine's composition function, not host API.

`EditorToolbar`'s props gain `layout?: ToolbarLayoutConfig` and `capabilities?: Partial<ToolbarCapabilities>` (both optional; defaults reproduce the built-in Home+Insert surface). The existing props (`store`, `focusEditor`, `onFind?`, `className?`) are preserved so current call sites keep compiling.

## 6. Architecture Decisions

### 6.1 Separate Layout Layer From Registries (Recommended)

Recommended: keep the descriptor registries (Layer 1) ignorant of tabs/slots, and put all product-surface placement in a separate layout layer (Layer 2). A `MarkDefinition` says "bold renders like this and toggles this command"; it does not say "bold lives in home.text." Placement is a `ToolbarItem` in the layout config.

Why: this is doc 006 §7.1's core insight, and it is what makes the surface reconfigurable. If placement lived on the descriptor, reordering the toolbar or moving a control to a different tab would mean editing every descriptor and would make two layouts (e.g. desktop vs mobile, or a host override) impossible. Separating them means the same registries drive any number of layouts. It also keeps the descriptors reusable across surfaces (the flyout, §5.7) without dragging ribbon-placement into them.

Cost: a small amount of indirection — a control is defined in one place (registry) and placed in another (layout config). This is the right trade; it is the same separation docs/016 already chose for the node SPI (a node defines itself; the insert menu enumerates it).

### 6.2 Inline Command Wiring On Actions, Not A Command Registry (Recommended)

Recommended: a `ToolbarAction` carries its own `run`/`isActive`/`render` that call `store.command`/`store.query` directly. Do **not** introduce a central command registry (doc 006's `commands.ts` model) as a prerequisite.

Why: the owned engine already distributes command metadata across the per-concern registries and dispatches typed command unions on the store (§3.4). A central command registry would be a second source of truth competing with `mark-registry`/`block-type-registry`, and would force every action through an indirection (`commandId` → lookup → dispatch) that buys nothing here because the toolbar is the only consumer that needs the metadata. Inline wiring keeps each action self-contained and testable (call `run(ctx)`, assert the store command fired).

Rejected alternative — replicate `commands.ts`: this is what doc 006 assumed because Lexical's command model is string-keyed and surface-shared (toolbar/slash/flyout/context all referenced `commandId`). In the owned engine, slash/context/flyout can each project the *same registries* the toolbar does; they do not need a shared command-id namespace. Building one is speculative infrastructure for surfaces that do not exist yet, and it contradicts the engine's existing grain. If a real need appears (e.g. a keyboard-shortcut registry that must reference the same actions), revisit then — the `ToolbarAction.id` is already a stable key that such a system could adopt.

### 6.3 Layout Config: Built-In Default + Host Override (Recommended)

Recommended: ship a built-in `DEFAULT_TOOLBAR_LAYOUT` (the ordered tab→slot→item mapping for Home + Insert) and let `EditorToolbar` accept a `layout?: ToolbarLayoutConfig` prop that *replaces or patches* it. Registration (`registerToolbarTab`/`registerToolbarSlot`/`registerToolbarAction`) adds capability; the layout config arranges it.

Why: two distinct extension needs exist. A *feature* (or host) that adds a control wants to register a descriptor and have it appear in a known slot — that is registration. A *host* that wants a different arrangement (hide a group, reorder tabs, insert a custom component between groups) wants to supply a layout — that is configuration. Conflating them (only registration, or only a config) makes one of the two awkward. The default layout means zero-config consumers get the designed surface; the override means a host is never blocked by the built-in arrangement.

Decision detail: the override is a *merge*, not a wholesale replace, by default — a host that only wants to add one slot should not have to re-declare Home. Provide both: `layout: { extends: "default", add: [...], hide: [...], reorder: [...] }` for the common case, and an explicit full-replacement form for a host that wants total control.

### 6.4 Container-Query Responsive, Measured Overflow Last (Recommended)

Recommended responsive staging (doc 006 §8.6), in order: (1) hide optional labels (icon-only + tooltip) via CSS container queries on the toolbar element; (2) collapse a whole slot into a single overflow `MenuTrigger` when its container width crosses a threshold, lowest `responsivePriority` first; (3) horizontal scroll of the active row as the final fallback. Measured JS collapse is used **only** for true overflow detection that container queries cannot express, never as the primary mechanism.

Why: doc 006 §8.9 explicitly warns that JS measurement causes layout thrash and fights the editor's focus model; container queries move the common cases (label hiding, group collapse) to the browser. The `responsivePriority` on each action is what makes collapse *semantic* (collapse the rarely-used group first) rather than collapsing whatever happens to be last in the DOM. The hard constraint from doc 006 §3.8/§7.2: collapse must preserve the active tab and never degrade into a generic `More` bucket that owns discovery — overflow is a width fallback for an already-designed slot, not a home for commands.

Rejected: flex-wrap (today's behavior). It preserves access but destroys the designed structure (006 §2.1) and is exactly what this redesign removes.

### 6.5 Rejected And Deferred Options

- **Rejected: mechanical registry rendering.** Render the toolbar by iterating registries in registration order (no layout layer). This is what doc 006 §2.2 calls out as not-a-design: it produces a flat strip with no product model, no tabs, no named homes. The whole point is the layout layer.
- **Rejected: keep the fixed JSX and add props for each new button.** This does not scale — every host control needs an editor change, the exact problem (§3.2) being solved.
- **Rejected: a desktop `More` menu as the Insert/discovery home (006 §7.2).** Overflow is measured-collapse only; it never owns Insert/Data discovery.
- **Rejected: Word-style contextual ribbon tabs for object config (006 §7.8).** Object configuration stays on object chrome (`renderOverlay`), which already exists; a contextual tab would duplicate it and break surface orthogonality.
- **Deferred (explicitly, not silently): the selection flyout, Data/View/Review/AI tab content, typed publication settings.** Out of first-release scope; the SPI reserves their shape (`surfaces` field §5.7, capability flags §5.6, empty-tab handling §5.6) so each is later additive, never a breaking change.

## 7. First-Release Surface: Home And Insert

### 7.1 Home Tab

Home edits the current text, block, and selection. Built-in default layout (doc 006 §4.2, minus alignment which the owned engine does not expose as a control today, and minus glossary/comment which are deferred surfaces):

```txt
Home:
[Undo] [Redo] | [Block type v] | [B] [I] [U] [S] [Code] ... | [Bulleted] [Numbered] [Outdent] [Indent] | [Link]
```

Slot mapping:

- `home.history` — `Undo`/`Redo` actions (kind `button`, wired to the store's history commands). New actions; today the toolbar has no history buttons, so this is additive and optional (gate behind `isAvailable` if history commands are absent).
- `home.text` — the block-type chooser (item kind `blockType`, the existing `listBlockTypes().filter(b => b.chooser)` control) placed first, matching doc 006 §4.2's "Text style before inline formatting."
- `home.format` — the format marks (item kind `mark`, one per `listMarks().filter(m => m.toolbar)` entry: bold, italic, underline, strikethrough, code). Unchanged behavior, now placed by the layout rather than mapped inline.
- `home.lists` — bulleted/numbered list + outdent/indent, migrated from hardcoded JSX to registered actions (§7.3).
- `home.annotate` — link (migrated action, §7.3). Glossary/comment are reserved for this slot later but not registered in first release.

Home is always available (no capability gate). Its slots resolve from the registries plus four new built-in actions (undo, redo — optional; list-bulleted, list-numbered, outdent, indent, link — migrated).

### 7.2 Insert Tab And The Table Dimension Picker

Insert ships exactly one tool in first release: Table, as a focused dimension picker (doc 006 §4.3), not a fixed-size insert.

```txt
Insert:
[Table v]
```

Slot mapping:

- `insert.tables` — a single `action` of kind `popover`, id `insert.table`, gated by `capabilities.insertTable`. Its `render(ctx)` is a React Aria `DialogTrigger`/`Popover`/`Dialog` containing a compact dimension grid with a live preview label (e.g. "4 x 2 table"); on apply it dispatches an insert command for a table of the chosen rows×cols and restores the saved selection.

Critical finding and design point: the current table insert affordance is **parameterless**. `tableStructuralView.insert.createCommand()` returns `{ type: "insert-structural", structuralType: "table" }` (`view/nodes/table/table.tsx`), and `insert-structural` builds the subtree from the definition's `createSubtree(allocator)` — a fixed default table. A dimension picker requires a *parameterized* insert. Two options:

- Recommended: make `insert.table` a first-class `popover` action (not the generic `insert` projection) whose `run` builds and dispatches a sized table. This needs the engine to accept table dimensions at insert time. The cleanest seam is to extend the `insert-structural` command (or add a table-specific command) to carry an optional `params` object the structural definition's `createSubtree` can read (`createSubtree(allocator, params?)`). This is a small, contained core change and keeps the table's grid-building logic in `core/table/definitions.ts` where it belongs.
- Rejected for first release: insert a fixed 3×3 then resize via table chrome. This contradicts doc 006 §4.3 (Table opens a dimension picker) and pushes the sizing burden onto the author post-insert.

Because Insert in first release is *only* Table, the generic `insert` item kind (projecting `listInsertableNodes`) is specified in the SPI (§5.4) but the default layout places only the table action. Other registered insertables (callout, code-block, media, etc.) remain reachable through the existing insert path until a later release gives Insert its full slot set; the SPI does not remove them, it just does not yet place them on the ribbon. This is an intentional first-release narrowing, recorded so it is not mistaken for a regression.

### 7.3 Migrating The Three Hardcoded Buttons

The proof that the action SPI works is migrating list, indent, and link from literal JSX (§3.2) to registered `ToolbarAction`s, with byte-identical behavior:

- `home.lists` / `list-bulleted` — kind `toggle`, `isActive: (ctx) => /* bullet active */`, `run: (ctx) => ctx.store.command(listToggleCommand(active, "bullet"))`. The existing `listToggleCommand` helper (`chrome-commands.ts`) is reused verbatim.
- `home.lists` / `list-numbered` — same, `"number"`.
- `home.lists` / `outdent`, `indent` — kind `button`, `run: (ctx) => ctx.store.command({ type: "outdent" | "indent" })`.
- `home.annotate` / `link` — kind `popover`, `isActive: (ctx) => typeof ctx.store.query({ type: "active-link-href" }) === "string"`, `render` is the existing link editor form (the `set-link`/`clear-link` wiring moves into the action's `render`).

After migration, `editor-chrome.tsx` contains no literal control JSX — only the renderer that walks the resolved layout. This is the completion signal for the mechanism: if a built-in button can be a registered action, so can a host's.

### 7.4 Empty-But-Registrable Tabs

`view`, `review`, `data`, `ai` are present in `ToolbarTabId` and may be referenced by `ToolbarSlot`/`ToolbarAction`, but the default layout registers no slots/actions for them and their capabilities are false in first release. `computeToolbarLayout` drops empty tabs (§5.6), so they do not render. This is the enforcement of doc 006 §3.16 ("a tab earns its place by being full") and the guarantee that adding, say, an AI tab later is `registerToolbarTab` + `registerToolbarAction` + flipping `capabilities.ai`, not a toolbar rewrite.

## 8. Selection, Focus, And Overlay Integration

This is the highest-risk area (doc 006 §8.9) and it is in the first release because Home's link action and Insert's table picker both open React Aria overlays that portal outside the toolbar DOM, and the owned engine paints its own caret through an EditContext host whose focus must survive.

- **Saved selection.** Before any `popover`/`dropdown` action opens, the toolbar captures the model selection; on apply, the action restores it so "insert at cursor" and "apply to selection" survive the overlay taking focus. The owned engine already keeps the model selection alive across focus loss (docs/011 §8.6); the SPI's requirement is that every `popover` action's `render` uses that saved selection on apply rather than reading the (now-blurred) live selection. This generalizes what `link-popover.tsx` does today.
- **Control-surface allowlist.** The editor greys out / disables formatting when focus leaves its known control surfaces. The toolbar's React Aria overlays portal outside the toolbar element, so the allowlist must include them, or opening the table picker would flip the editor to "not editable" and disable the very toolbar that opened it. This is an existing concern for `link-popover`/`context-menu`/`find-bar`; the SPI requires that any registered `popover`/`dropdown` action's portal is treated as part of the editor focus model. The cleanest mechanism is a stable `data-engine-toolbar-overlay` marker the focus model recognizes, set by the renderer on every action overlay, so host-registered actions inherit the behavior without each host re-solving focus.
- **ARIA composition.** A React Aria `Tabs` whose panels contain a React Aria `Toolbar` (roving tabindex) must not fight the outer toolbar's key handling (doc 006 §8.9). The renderer must verify the tab strip and the active command row compose correctly: tab switching is one of the `Tabs` roles; arrow-key control traversal is the inner `Toolbar`'s roving tabindex; they must not both claim the same keys. This is a renderer-layer obligation, validated by keyboard e2e (§10).
- **Live selection facts.** `ToolbarSelectionFacts` (§5.3) must be real, not the legacy hardcoded `hasSelectedText: false`. The link action's enable state and any future selection-scoped action depend on it. It is computed under the existing `useToolbarVersion` subscription so it costs no new re-render machinery.

None of these are deferred: link (popover + saved selection + allowlist) and the table picker (popover + parameterized insert + saved selection) exercise all of them in first release, so the focus/overlay integration is built and verified now, not when later tabs arrive.

## 9. Risks, Caveats, Edge Cases, And Failure Modes

- **Module-load registration vs `sideEffects: false` (note.md F3) — resolved.** A registrar self-called only at module load is a side effect in a package marked `"sideEffects": false` (`packages/editor/package.json:5`); a bundler may treat the file as dead and drop it, and the standalone toolbar would render with no built-in actions. **Decision: keep `sideEffects: false` and resolve via the orchestrator-explicit call** — `react-view.tsx` imports `registerBuiltInToolbarActions` by name and calls it alongside the existing `registerBuiltInNodeViews` / `registerBuiltInMarks` / `registerBuiltInBlockTypes` (`view/react-view.tsx:77–84`). This is the established pattern in the codebase, needs no `package.json` change, and is strictly more robust than bundler config because the editor component the consumer imports keeps the registrar reachable by reference. Do **not** flip the package to `sideEffects: true` (forbidden for the shared packages, AGENTS.md). The pin-one-file escape hatch (`"sideEffects": ["./src/view/spi/toolbar-action-registry.ts"]`) is the documented fallback *only* if the registrar ever cannot be reached from the orchestrator; first release uses the explicit call and does not need it.
- **Parameterless insert affordance.** The table dimension picker needs a parameterized insert (§7.2); the current `insert-structural` command + `createSubtree(allocator)` is fixed-size. This is a required core change (extend `createSubtree` to accept params, or a table-specific command). Risk: touching the structural insert contract affects every structural type; mitigation is an *optional* params argument so existing definitions are unaffected.
- **Focus/overlay regressions (the dominant risk).** A toolbar overlay that is not in the editor's control-surface allowlist will disable the editor while open; a popover that reads the live (blurred) selection instead of the saved one will insert at the wrong place or no-op. These are subtle and not caught by unit tests of the layout function — they need e2e on real browsers (the same suite that caught the spike-fold issues). Treat the focus model as the integration bar, not the layout data model.
- **ARIA double-keyboard.** Nested `Tabs` + `Toolbar` roving tabindex can produce arrow keys that both move tabs and move controls, or a focus trap. Must be validated with keyboard e2e across chromium/webkit/firefox; the owned engine already runs `engine-toolbar.spec.ts` on that matrix.
- **Responsive thrash.** JS-measured collapse that runs on every resize/scroll causes layout jank and can fight the painted-caret geometry. Mitigation: container-query-first (§6.4); reserve measured collapse for true overflow only.
- **Capability shimmer.** If capabilities were recomputed per document or per selection, tabs would appear/disappear mid-session (doc 006 §3.16). Invariant: capabilities are derived from props/bindings once per editor instance, not from document content; `computeToolbarLayout` may gate *items* by selection (`isDisabled`) but must gate *tabs* only by capability.
- **Layout override foot-guns.** A host override that hides a slot Home depends on (e.g. removing `home.text`) could produce an unusable toolbar. Mitigation: the merge form (`extends: "default"`) is the documented path; full replacement is opt-in and the host owns the consequences. The layout function should not crash on an empty tab (it drops it) or a placement referencing an unregistered action (it skips it, optionally warns in dev).
- **Empty Insert tab.** If `capabilities.insertTable` were false, Insert would resolve empty and be dropped — leaving only Home. That is acceptable (a deployment with no table support), but the default must keep `insertTable: true` so the standard product shows Insert.
- **Selection facts cost.** Computing `ToolbarSelectionFacts` via multiple `store.query` calls every `useToolbarVersion` bump must stay cheap (queries are O(selection), not O(document)). If a future fact is expensive, memoize it against the commit version rather than recomputing per render.
- **Context menu / future flyout drift.** The context menu already shares the mark/block registries (W6). When the flyout is later added, it must project the *same* registries filtered by the `surfaces` field (§5.7), not a parallel descriptor set, or the three surfaces drift (doc 006 §3.11). The `surfaces` field exists from day one to prevent this.
- **Public-surface creep.** Exporting the toolbar SPI widens the package API (docs/020 §4.5 wants a small, honest root). Keep `computeToolbarLayout` internal; export only the registration functions and descriptor types. Re-evaluate each export against "could a host need this to add a control."
- **Test-path coupling.** Existing toolbar tests (`engine-chrome.test.tsx`, `engine-toolbar.spec.ts`) assert the current DOM/behavior; the migration must keep them green or update them to the new structure deliberately (not weaken them), the same discipline applied to the editor-table alias tests.

## 10. Test And Verification Plan

Design-level acceptance (proving the model, not pixels):

- **Layout function unit tests** assert, with no DOM: Home and Insert tabs resolve; Data/View/Review/AI resolve empty and are dropped under first-release capabilities; `home.text` precedes `home.format`; the block-type chooser is one control; the migrated list/indent/link actions resolve into `home.lists`/`home.annotate`; an unavailable action (`isAvailable: false`) is absent; a disabled action (`isDisabled: true`) is present but greyed.
- **Action SPI contract tests** assert: `registerToolbarAction` is idempotent by id; `listToolbarActions` returns registration order; a custom action registered into a slot appears in `computeToolbarLayout` output; `surfaces` defaults to `["ribbon"]`; `run(ctx)` fires the expected `store.command` (assert against a fake store).
- **Capability tests** assert: flipping `capabilities.insertTable` to false drops the Insert tab; a host-defined capability key gates a host-defined action/tab.
- **Migration parity tests** assert the three migrated buttons behave identically: bullet/numbered toggle the same commands and reflect active state; outdent/indent dispatch the same commands; link opens the editor, reads `active-link-href`, and applies `set-link`/`clear-link`.
- **Table picker tests** assert: the dimension picker inserts a table of the chosen rows×cols (parameterized insert), at the saved selection, and the toolbar is not disabled while the picker is open.
- **Keyboard/focus e2e** (chromium/webkit/firefox, extending `engine-toolbar.spec.ts`): tab switching via `Tabs` roles; arrow-key control traversal via the inner `Toolbar`; opening the link and table overlays does not blur-disable the editor; saved selection is restored on apply; no double-key behavior.
- **Responsive e2e**: narrowing the surface hides labels (icon-only + tooltip), then collapses the lowest-priority slot into overflow, then horizontal-scrolls — and never wraps into a second row or surfaces a generic `More` that owns Insert.
- **Regression**: existing `engine-chrome.test.tsx` and `engine-toolbar.spec.ts` stay green or are deliberately updated to the new structure; full `pnpm check` passes.

## 11. Definition Of Done

- The toolbar renders from a resolved layout produced by a pure `computeToolbarLayout`; `EditorToolbar` contains no literal control JSX and no fixed group order.
- `registerToolbarAction` exists and is the path for non-mark/block/insert controls; list, indent, and link are registered actions, not inline JSX, with byte-identical behavior.
- Home and Insert tabs render with their first-release slots; Insert ships the Table dimension picker backed by a parameterized insert; Data/View/Review/AI are registrable but resolve empty and do not render.
- A host can add a tab, slot, or action by registration, and can rearrange the surface via the `layout` override (merge form), without editing `editor-chrome.tsx`.
- `ToolbarSelectionFacts` are real (no hardcoded `hasSelectedText: false`); every `popover` action saves and restores the model selection; every toolbar overlay is in the editor's control-surface focus allowlist.
- Responsive behavior collapses by semantic slot (labels → slot overflow → scroll), preserves the active tab, and never wraps or degrades into a generic `More`.
- The `sideEffects`/module-load registration hazard (§9) is resolved by wiring `registerBuiltInToolbarActions` into `react-view.tsx`'s registration block (alongside the node/mark/block-type registrars); the package stays `"sideEffects": false` and is not flipped to `true`.
- Layout function, action SPI, capability gating, and migration parity are unit-tested; focus/overlay/keyboard and responsive behavior are e2e-verified across chromium/webkit/firefox; `pnpm check` is green.
- New exports are limited to registration functions and descriptor types; `computeToolbarLayout` stays internal.

## 12. Final Model

The owned editor's toolbar becomes a three-layer, ribbon-lite surface. Layer 1 is the descriptor registries — the existing mark, block-type, and node-insert registries plus a new `toolbar-action-registry` — each descriptor carrying its own store-command wiring and metadata. Layer 2 is a pure, DOM-free `computeToolbarLayout` that places those descriptors into capability-gated tabs and slots and returns a fully resolved, ordered structure. Layer 3 is `EditorToolbar`, which renders that structure with React Aria + DaisyUI, owning only responsive collapse and overlay focus — no command or layout knowledge.

First release ships Home (block-type chooser, format marks, lists, indent, link — the last three migrated off hardcoded JSX onto the action SPI) and Insert (Table only, via a dimension picker backed by a parameterized structural insert). Data, View, Review, and AI exist in the type and layout model but resolve empty and do not render, so each is added later by registration and a capability flag, never by rewriting the toolbar.

The design preserves the engine's three orthogonal surfaces: the ribbon owns creation and selection/text editing; object chrome (the existing `renderOverlay` slot) owns configuring a selected object; and a future selection flyout — reserved by the `surfaces` field but not built here — will own the selected text run by projecting the same registries into a floating host. The hardest part, and the reason focus/overlay integration is in the first release rather than deferred, is that the link and table overlays exercise the saved-selection, control-surface-allowlist, and nested-ARIA concerns now; the SPI is only as good as that integration, so it is built and verified with the first two tabs, not assumed.
