# 029 - Editor Overlay Authority SPI: One Manager For Every Floating Surface

> Status: design-grade proposal with implementation backlog — not yet built, long-term backlog item (note.md item 2 "Editor overlay SPI"). The goal is a comprehensive, conflict-free interface for *every* floating surface in the owned-model editor, not a patch for any one popover bug. It supersedes the per-call-site overlay handling that commits `4ee6d7d` ("Focus steal issue again") and `2bbefc7` ("A bunch of jokers - popover issues") most recently patched.
>
> Date: 2026-06-25
>
> Scope:
>
> - `packages/editor/src/view/chrome/surfaces/` — the existing flat-surface family (`selection-flyout.tsx`, `slash-menu.tsx`, `context-menu.tsx`, `ribbon.tsx`, `use-command-surfaces.ts`) that this generalizes into one authority.
> - `packages/editor/src/view/overlays/touch-selection.tsx` — the touch selection/caret toolbars that today coexist (and visually collide) with the desktop flyout; this file splits into a geometry half (grips/rects, stays) and a floating-surface half (toolbar, folds into the authority).
> - `packages/editor/src/view/chrome/link-popover.tsx`, `packages/editor/src/view/chrome/annotation-popover.tsx`, `packages/editor/src/view/chrome/find-bar.tsx` — standalone anchored popovers to bring under the authority.
> - `packages/editor/src/view/render/object-block.tsx` (the object config popover), `packages/editor/src/view/nodes/table-of-contents.tsx` (a stray raw `AriaPopover`), `packages/editor/src/view/nodes/table/table-interactions.tsx` (cell `…` popover + body-portaled range/hover paint), `packages/editor/src/view/nodes/table/table-controls.tsx` (row/col handles + menu).
> - `packages/editor/src/view/spi/` — where the new SPI modules live (`overlay-authority.ts`, `anchor-target.ts`, and extensions to `command-surface.ts`), siblings to `command-registry.ts`, `command-surface.ts`, `node-view.ts`, `structural-view.ts`, `side-panel-registry.ts`.
> - `packages/ui/src/popover.tsx` — `AnchoredPopover`/`PopoverTrigger`; the authority standardizes on the controlled-anchored primitive and treats trigger-coupled `PopoverTrigger` as an editor anti-pattern. No editor focus semantics move into `@idco/ui` (boundary lint forbids it).
> - `packages/editor/src/core/` focus machinery — `EditContext` host re-grab, `focusSelectionSoon`, `focusEditor` — which gains a `suspendReclaim`/`resumeReclaim` seam the authority drives (§7.1, the load-bearing mechanic).
>
> Reference (shape only, NOT ported):
>
> - `packages/editor-legacy/src/plugins/selection-flyout-plugin.tsx` and the legacy floating-link/draggable-block plugins — proven shapes for the close-on-interact-outside guards and anchored editing surfaces. The owned engine has its own registries; legacy is consulted for the *idea*, not imported.
>
> Source docs:
>
> - `docs/024_command_surface_spi.md` — the command-projection SPI (`resolveCommandList(surface, ctx)`) this document treats as the *content* half of every overlay. §7.2 (selection flyout), §7.3 (slash menu), §7.4 (table cell/structure), §8 (the coordinator) are the direct antecedents. This doc is the *envelope* half that §024 left to each host.
> - `docs/023_toolbar_spi_and_ribbon_lite_surface.md` — the toolbar SPI; the ribbon is one consumer of the envelope. The "register, don't hardcode" rule and `display`/responsive-collapse model carry over.
> - `docs/027_review_tab_side_panel_and_document_insight.md` — the side-panel dock SPI (a *docked* region, not a floating surface) and the comment/glossary affordances whose read-popovers are in scope.
> - `docs/025_virtual_geometry_offset_model_and_fling.md` — the offset/geometry model the anchor resolver (§7.6) must respect when re-anchoring across virtualized scroll.
>
> Related docs:
>
> - `docs/016_node_spi_and_pluggable_blocks.md`, `docs/021_structural_node_spi.md` — the node SPIs whose `contributeCommands` slots feed surface content; the overlay authority renders that content but does not change its projection.
> - `docs/026_host_data_provider_spi_reference_blocks.md` — sibling SPI (host-owned data); the link/glossary/comment forms that drill into the selection surface read host data through it.
> - `note.md` item 2 — the backlog entry this document expands and replaces.
>
> Assumptions:
>
> - The owned-model engine (`packages/editor`) is the only editor in scope; `editor-legacy` is reference-only and slated for retirement.
> - The UI philosophy holds without exception: React Aria for *behavior* (focus, keyboard, ARIA, overlays, dismissal, positioning) and DaisyUI 5 for *appearance*. The authority is a thin editor-owned *policy* layer composed **on top of** `@idco/ui`'s React Aria primitives, never a hand-rolled overlay engine. Hand-rolling is the documented last resort, used today only by the slash menu and only because no RA-focus path exists for a focus-transparent menu over a live caret (§3, §7.5).
> - "Register, don't hardcode" (docs/016 §10, docs/024 §6) governs: a surface gains content by a contributor declaring it, never by the renderer growing a per-type branch. The overlay authority extends this rule from *content* to *envelope*.
> - This is a long-term, no-deferral design. Where a mechanic is load-bearing (focus reclaim, dismissal reconciliation, positioning collision, transparent-keyboard routing) it is specified concretely here so the build never re-derives it. "Most correct, no later patches" is the explicit bar set for this work.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary: Three Authorities In Conflict](#2-system-summary-three-authorities-in-conflict)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 The Floating-Surface Census](#31-the-floating-surface-census)
  - [3.2 What React Aria's Popover Is Actually Doing](#32-what-react-arias-popover-is-actually-doing)
  - [3.3 Every Symptom, Mapped To Its Authority](#33-every-symptom-mapped-to-its-authority)
  - [3.4 The Coordinator Already Does Half The Job](#34-the-coordinator-already-does-half-the-job)
  - [3.5 The Mobile Double-Bar: The Coexistence Gap In One Picture](#35-the-mobile-double-bar-the-coexistence-gap-in-one-picture)
- [4. Target Model: Envelope + Projector = One Surface System](#4-target-model-envelope--projector--one-surface-system)
  - [4.1 The Core Realization](#41-the-core-realization)
  - [4.2 Two Orthogonal Axes: Content-Kind × Focus-Mode](#42-two-orthogonal-axes-content-kind--focus-mode)
  - [4.3 Anchor-Targets Are The Spine](#43-anchor-targets-are-the-spine)
  - [4.4 Compose Vs Arbitrate: The Two-Level Co-Slot Rule](#44-compose-vs-arbitrate-the-two-level-co-slot-rule)
  - [4.5 Drill-In Is A Bounded Mode Stack](#45-drill-in-is-a-bounded-mode-stack)
  - [4.6 The Contract Shapes](#46-the-contract-shapes)
  - [4.7 Usage Shapes](#47-usage-shapes)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 Recommended: One Manager, Anchor-Target Spine, Orthogonal Axes](#51-recommended-one-manager-anchor-target-spine-orthogonal-axes)
  - [5.2 Composing A Surface From Multiple Contributors (Co-Slot)](#52-composing-a-surface-from-multiple-contributors-co-slot)
  - [5.3 Scope: Replace Every Floating Surface, With One Clean Cut](#53-scope-replace-every-floating-surface-with-one-clean-cut)
  - [5.4 Rejected And Deferred Options](#54-rejected-and-deferred-options)
- [6. Implementation Strategy](#6-implementation-strategy)
  - [6.1 Phase Map](#61-phase-map)
- [7. The Five Load-Bearing Mechanics](#7-the-five-load-bearing-mechanics)
  - [7.1 The Focus-Reclaim Seam (View → Core)](#71-the-focus-reclaim-seam-view--core)
  - [7.2 Reconciling Persistent Envelope State With Volatile Projected Content](#72-reconciling-persistent-envelope-state-with-volatile-projected-content)
  - [7.3 The Two-Level Co-Slot Rule, Precisely](#73-the-two-level-co-slot-rule-precisely)
  - [7.4 Central Positioning Solve With Collision Avoidance](#74-central-positioning-solve-with-collision-avoidance)
  - [7.5 Focus-Transparent Keyboard Routing](#75-focus-transparent-keyboard-routing)
  - [7.6 Smaller But Required: Foreign-Modal Coordination And The Controlled Primitive](#76-smaller-but-required-foreign-modal-coordination-and-the-controlled-primitive)
- [8. Detailed Implementation Plan](#8-detailed-implementation-plan)
  - [8.1 The Authority Core](#81-the-authority-core)
  - [8.2 The Anchor Resolver](#82-the-anchor-resolver)
  - [8.3 The Selection Surface (Flyout + Touch Merge)](#83-the-selection-surface-flyout--touch-merge)
  - [8.4 Menus: Context Menu, Slash, Block Chooser, Overflow](#84-menus-context-menu-slash-block-chooser-overflow)
  - [8.5 Forms And Cards: Link, Glossary, Comment, Object Config, Annotation Read](#85-forms-and-cards-link-glossary-comment-object-config-annotation-read)
  - [8.6 Table Surfaces](#86-table-surfaces)
  - [8.7 The `@idco/ui` Primitive Changes](#87-the-idcoui-primitive-changes)
- [9. Migration And Rollout](#9-migration-and-rollout)
- [10. Edge Cases And Failure Modes](#10-edge-cases-and-failure-modes)
- [11. Implementation Backlog](#11-implementation-backlog)
- [12. Future Backlog](#12-future-backlog)
- [13. Definition Of Done](#13-definition-of-done)
- [14. Final Model](#14-final-model)

## 1. Goal

Give the owned-model editor a single, comprehensive, conflict-free interface for every floating surface — selection flyout, slash menu, context menu, link/glossary/comment forms, the table cell `…` popover, object config, find bar, the mobile touch selection/caret toolbars, and the menu dropdowns — so that:

- A call site declares **intent** (what content, at what anchor, who owns focus), and never touches React Aria mechanics (`isNonModal`, `shouldCloseOnInteractOutside`, `pressInsideRef`, `onMouseDownCapture`, autofocus RAFs, `closest("[data-engine-*]")` selectors, `createPortal` to body).
- Multiple overlays that are alive at the same time are **arbitrated and z-ordered by one owner**, so the mobile double-bar (touch toolbar + desktop flyout stacked on one selection, with opposite dismissal policies) cannot happen, and desktop coexistence (flyout near object config, a drilled-in form, a foreign app modal) is deterministic.
- The editor's **aggressive focus reclaim** stops fighting overlays that legitimately need focus (the link/glossary/comment forms), through one named seam rather than a patch per surface.

This is explicitly a long-term, no-deferral effort. The bar is "most correct, no later patches": the five mechanics in §7 are the parts that, if hand-waved, regenerate the exact bug classes that commits `4ee6d7d` and `2bbefc7` chased. They are specified here as first-class sections, not footnotes.

Non-goals (first release boundary):

- **Painted geometry overlays stay separate.** Selection rectangles, the gap cursor, drag-selection paint, table resize/insert handles, and the touch grips are pointer-driven paint with no focus, dismissal, or coexistence stakes. They remain in `view/overlays/` and are not owned by the authority. The one consequence is that `touch-selection.tsx` splits (§5.3, §8.3).
- **Tooltips are out.** Hover-transient, no dismissal/focus/coexistence stakes, different lifecycle. Folding `@idco/ui`'s `Tooltip` into the authority is scope creep with no payoff.
- **App-level modal dialogs are foreign, not owned.** `theme-dialog`, `confirm-dialog`, `command-palette`, and `drawer` (all `@idco/ui`, host/app surfaces) stay genuine RA modals. They *coordinate* with the authority (when one opens over the editor, the editor's overlays stand down — §7.6) but are not re-homed under it.
- **The side-panel dock (docs/027) is not a floating surface.** It is a docked region; the authority does not own it. Only the affordances that *open* it (the comment caret affordance, the glossary read popover) are in scope.

## 2. System Summary: Three Authorities In Conflict

The root cause is not "React Aria is wrong" and it is not a single bug. React Aria's `Popover` was designed assuming it is the single, focus-owning, self-dismissing overlay on the page. The owned editor breaks all three of those assumptions at once, and almost every overlay bug to date is one of these three *authorities* being settled ad hoc at a call site:

1. **Focus authority.** React Aria treats DOM focus as the source of truth: on open it grabs focus (`FocusScope autoFocus`), on close it restores focus to the trigger (`restoreFocus`), and it watches focus to decide dismissal. The editor treats the **model selection** as the source of truth and reclaims DOM focus *aggressively* to serve it — `focusEditor()` after every command, the `EditContext` host re-grabbing focus, `focusSelectionSoon`. So an overlay that legitimately needs focus (a link URL field) is in a tug-of-war with the editor, and an overlay that must *not* take focus (the slash menu over a live `/query`) has to defeat RA's focus trap entirely.

2. **Dismissal authority.** React Aria decides when to close from interaction heuristics: an outside pointer press, or focus leaving the popover (`shouldCloseOnBlur`). The editor wants open/closed to be a function of model state, owned centrally (the coordinator already does this for three surfaces). When both run, the editor's focus reclaim reads to RA as "focus left → dismiss," so the surface tears down mid-interaction.

3. **Coexistence / layering authority.** React Aria assumes it is the/a singleton overlay — modal (a focus-trapping, page-`aria-hidden`ing, pointer-capturing layer) or independent non-modal. The editor has **many** non-modal overlays alive simultaneously — the flyout, its drilled-in form, the cell `…` popover, the mobile touch toolbar, object config, a foreign app modal — and *nobody arbitrates them*. RA's own stacking is modal-oriented; for non-modal overlays there is effectively no arbitration. This is the authority that is wholly missing today, and it is why two bars stack on one selection.

The current code settles all three, separately, at each of the ~16 call sites in §3.1. The fix is one **overlay authority** that owns all three axes for every surface, so a call site declares intent and the authority resolves focus, dismissal, and coexistence centrally.

## 3. Current-State Findings

### 3.1 The Floating-Surface Census

A grep of `AnchoredPopover` / `PopoverTrigger` / raw `AriaPopover` / `createPortal` / `MenuTrigger` across `packages/editor/src` yields the full inventory. Sixteen floating things, settled sixteen ways:

**Anchored popovers (via `@idco/ui`):**

| Surface | File | Content-kind | Focus today |
| --- | --- | --- | --- |
| Selection flyout | `view/chrome/surfaces/selection-flyout.tsx` | actions (toolbar row) | transparent (coordinator-owned) |
| Flyout child forms (link / glossary-add / comment-add) | rendered via `PopoverTrigger` inside flyout `renderItem` | form | focus-taking, RAF-autofocus |
| Ribbon popover-actions (link / align / glossary / comment) | `view/chrome/surfaces/ribbon.tsx:483` | form / dropdown | focus-taking, capture-guard hack |
| Table cell `…` (merge / unmerge / fill / valign) | `view/nodes/table/table-interactions.tsx:353` | actions + swatches | transparent, `pressInsideRef` hack |
| Link popover (click a link) | `view/chrome/link-popover.tsx` | form | focus-taking, `autoFocus` |
| Annotation read popover (glossary word) | `view/chrome/annotation-popover.tsx` | card (read-only) | RA default |
| Object config | `view/render/object-block.tsx:219` | form / card | RA default |
| Find bar | `view/chrome/find-bar.tsx:163` | actions / form | survives doc clicks |
| Touch selection toolbar | `view/overlays/touch-selection.tsx:218` | actions | always-close on outside |
| Touch caret-Paste toolbar | `view/overlays/touch-selection.tsx:104` | actions | always-close on outside |
| TOC dropdown (stray raw `AriaPopover`) | `view/nodes/table-of-contents.tsx:266` | menu/select | RA default |

**Raw portals (hand-rolled, bypass `@idco/ui`):**

| Surface | File | Why raw |
| --- | --- | --- |
| Slash menu | `view/chrome/surfaces/slash-menu.tsx:200` | RA focus trap stole editor focus; uses `createPortal` + document-capture keyboard driver |
| Table range/hover paint | `view/nodes/table/table-interactions.tsx:321,344` | body-portaled geometry overlays (z-30/z-40) |
| Table row/col handles + resize | `view/nodes/table/table-controls.tsx:290` | pointer geometry affordances |

**Menus (RA `Menu`/`MenuTrigger`):**

| Surface | File |
| --- | --- |
| Context menu (+ submenu raw `AriaPopover`) | `view/chrome/surfaces/context-menu.tsx` |
| Block-type chooser | `view/chrome/surfaces/ribbon.tsx:411` |
| Overflow "More controls" | `view/chrome/surfaces/ribbon.tsx:665` |
| Table-controls menu | `view/nodes/table/table-controls.tsx` |

**Geometry layer (out of scope, painted):** `view/overlays/selection-overlay.tsx`, `gap-cursor.ts`, `navigation.ts`, and the grips in `touch-selection.tsx`.

**Tooltips / app modals (out of scope / foreign):** `@idco/ui` `Tooltip`, `theme-dialog`, `confirm-dialog`, `command-palette`, `drawer`.

The census is the proof that "replace everything popover" is a real, large surface area (eleven anchored popovers + one hand-rolled menu + four real menus) and that the settle-it-locally approach has produced sixteen independent implementations of the same three decisions.

### 3.2 What React Aria's Popover Is Actually Doing

Tracing `AnchoredPopover`/`PopoverTrigger` (`packages/ui/src/popover.tsx`) → RAC `Popover` → `usePopover`/`useOverlay`/`FocusScope`/`useOverlayPosition`, here is the exact behavior the editor fights, and the patch each one forced:

- **Modal mode (RA default).** RAC `Popover` without `isNonModal` renders an `<Underlay>` that captures pointer events, calls `ariaHideOutside()` to `aria-hidden` the rest of the page, and wraps content in a `FocusScope contain restoreFocus autoFocus` that *traps* focus inside. Nesting a modal popover inside the non-modal flyout stacked that underlay over the child's own input and swallowed its clicks, so the input could not be focused. **Patch forced:** `isNonModal` everywhere (`popover.tsx` doc comment, the `isNonModal` prop on `AnchoredPopover`). Step one of every surface was already "defeat RA's modal layer."
- **Non-modal dismissal, two triggers.** Even non-modal, `useOverlay` runs `shouldCloseOnInteractOutside` on **(a)** an outside `pointerdown` (`useInteractOutside`) **and (b)** focus leaving the popover (`shouldCloseOnBlur` / focus-within). Trigger (b) is the silent killer: the editor's focus reclaim *is* a blur-within whose `relatedTarget` is an editor block, indistinguishable by target from a genuine outside click. **Patches forced:** `shouldKeepFlyoutOpen` (`selection-flyout.tsx:72`), `keepCellPopoverOpen` + `pressInsideRef` (`table-interactions.tsx:85,144`), and the coordinator's `flyoutChildOpen()` mirror (`use-command-surfaces.ts:121`).
- **`FocusScope autoFocus` + `restoreFocus` run even non-modal.** On open RA tries to autofocus the first tabbable element, but the bare `Input`'s `autoFocus` does not reliably survive RA's settle, so the field must be focused explicitly *after* RA's handling. On close RA restores focus to the *trigger*, which the editor then has to bounce to the surface. **Patches forced:** `useAutoFocusWithin` with a `requestAnimationFrame` to beat RA (`use-reveal-focus.ts:23`, wired into comment + glossary add in `4ee6d7d`), and the ribbon's `requestAnimationFrame(() => focusEditor())` on close (`ribbon.tsx:485`). Two restore mechanisms fighting = "focus steal is aggressive."
- **Positioning via body portal.** `useOverlayPosition` computes viewport-anchored coordinates from `triggerRef.getBoundingClientRect()` and the overlay is portaled to `document.body`. The body portal is why containment cannot use DOM ancestry (forcing `closest("[data-engine-flyout]")`-style selectors), and why a synthetic `mousedown` inside a portaled field still bubbles the React *tree* into the toolbar's capture handler. **Patches forced:** all the `data-engine-*` selectors, the `data-engine-view-root` geometric guard (`table-interactions.tsx:213`), and the ribbon's `event.currentTarget.contains(event.target)` gate (`ribbon.tsx:586`). Because positioning is `fixed`/absolute against the viewport, a *transformed ancestor* of the portal target would break the math — relevant to §7.4.
- **RA's overlay stack is modal-oriented.** `@react-aria/overlays` keeps a global open-overlay list for Escape ordering and `ariaHideOutside`, but this is built around modal semantics. For independent non-modal overlays there is no arbitration — each is on its own. **Consequence:** the coexistence vacuum (§2 authority 3, §3.5).

The slash menu (`slash-menu.tsx`) is the tell: it abandons RA `Popover` entirely (`createPortal` to body + a document **capture**-phase keyboard handler at `:147`) precisely because RA's `FocusScope` trap is incompatible with a menu that must leave focus in the editor over a live `/query`. That is not a bug in the slash menu — it is the absence of a "focus-transparent menu" capability (§7.5).

### 3.3 Every Symptom, Mapped To Its Authority

| # | Symptom | Site | Authority | RA mechanic abused |
| --- | --- | --- | --- | --- |
| 1 | Flyout vanishes on Bold (focus restore read as outside) | `selection-flyout.tsx:72-79` `shouldKeepFlyoutOpen` (4 selectors) | dismissal | `shouldCloseOnInteractOutside` on blur-within |
| 2 | Cell fill/align dismisses on swatch press | `table-interactions.tsx:85-90` `keepCellPopoverOpen` + `:144` `pressInsideRef` (RAF frame-flag) | dismissal + focus | blur-within + focus-bounce indistinguishable from outside click |
| 3 | Slash menu must not blur editor | `slash-menu.tsx:206` `onMouseDown preventDefault` + raw portal | focus | `FocusScope` trap; RA abandoned entirely |
| 4 | Toolbar popover field unclickable | `ribbon.tsx:586-590` `onMouseDownCapture` + DOM-contains gate | focus + portal | body portal + React-tree event bubbling |
| 5 | Form field won't focus on open | `use-reveal-focus.ts:23-30` `useAutoFocusWithin` (RAF) | focus | `FocusScope autoFocus` doesn't survive settle |
| 6 | Toolbar close bounces focus to trigger, not editor | `ribbon.tsx:485-489` RAF `focusEditor` | focus | `FocusScope restoreFocus` → trigger |
| 7 | Ambient flyout tears its own child form out | `use-command-surfaces.ts:121-126,235-241` `flyoutChildOpen()` (mirrors #1 in a 2nd file) | coexistence + dismissal | non-modal stack vacuum |
| 8 | Popover over a table starts a phantom cell drag / hover toolbar paints over it | `table-interactions.tsx:200-218` `onSurface`/`data-engine-view-root` | coexistence + portal | body portal; geometric hit-test can't tell overlay from surface |
| 9 | Context-menu form-command can't nest; closes menu + reopens standalone | `context-menu.tsx` header rule "No nested form-submenus" | focus + coexistence | submenu `FocusScope` collapses parent |
| 10 | **Mobile: touch toolbar + flyout stack on one selection, opposite dismiss policies** | `touch-selection.tsx:226` (`() => true`) vs `selection-flyout.tsx:173` (keep-open); coordinator unaware of touch | **coexistence** | no authority arbitrates non-modal overlays |
| 11 | Desktop: flyout coexisting with cell menu / link popover / object config / dialogs, ad hoc | scattered | coexistence | same vacuum |

Eleven+ symptoms, three root authorities, every fix a local translation of one of them. Several are the *same* decision duplicated across files (#1 and #7 are the same "keep the surface alive across the editor's focus reclaim," written once in the flyout and once in the coordinator and kept consistent by hand).

### 3.4 The Coordinator Already Does Half The Job

`useCommandSurfaces` (`view/chrome/surfaces/use-command-surfaces.ts`) is the proof that the inversion works. It already owns "which surface is open" for the three flat surfaces (context / flyout / slash) as a single `SurfaceState` value, encodes precedence (right-click and slash beat the ambient flyout), debounces the flyout settle so a double/triple-click resolves to one appearance, and remembers a `suppressedSig` so a dismissed flyout does not pop back over a context-menu popover. It is, in miniature, the **arbitration authority** — but only for three surfaces, and only the *arbitrate* half (not the *compose*/co-slot half). It has never heard of the touch toolbar, the drilled-in child forms, the cell `…` popover, object config, the find bar, or a foreign app modal. The flyout *also* still passes `shouldCloseOnInteractOutside={shouldKeepFlyoutOpen}` to RA, so even the "good" surface runs both the coordinator-owns-it path and the RA-heuristic path simultaneously and has to keep them consistent (`flyoutChildOpen()` in the coordinator mirrors `data-engine-surface-child` in the flyout). The target generalizes this hook into the authority and makes RA's dismissal heuristic inert (§7.1, §7.2).

### 3.5 The Mobile Double-Bar: The Coexistence Gap In One Picture

On a touch device, selecting a range of text produces **two** floating toolbars keyed to the *same* selection:

- `TouchSelectionLayer` → `SelectionToolbar` (`touch-selection.tsx:202`) — a native-style Copy / Cut / Paste / B / I bar, `AnchoredPopover` non-modal with `shouldCloseOnInteractOutside={() => true}` (close on *any* outside).
- `SelectionFlyout` (`selection-flyout.tsx`) — the desktop formatting flyout, gated by the coordinator, non-modal with the keep-open predicate.

They anchor near the same selection, overlap, and carry **opposite** dismissal policies, because no owner knows both exist. This is the canonical evidence that the flyout's contract is *incomplete* — not buggy in isolation, but missing the authority above it that would say "on touch, this selection gets one surface, composed from both contributors." It is the motivating case for the merge (§5.2).

## 4. Target Model: Envelope + Projector = One Surface System

### 4.1 The Core Realization

The decisive insight from the design discussion: **the overlay authority and the command projector are two halves of one surface system, not two sibling SPIs.**

- The **projector** (`resolveCommandList(surface, ctx)`, docs/024) already answers "what content is *in* a surface." The flyout, slash, and context menu are all pure projections today.
- The **authority** (new, this doc) answers "what *envelope* the content lives in" — anchor, dismissal, focus ownership, z-order, coexistence.

Once they are seen as content + envelope of one thing, the mobile merge stops being special. "Merge copy/paste + format into one bar" is not new merge infrastructure and is not literally merging two `<div>`s (which would destroy each group's meaning). It is: copy/cut/paste become **contributors projected into the same `selection` surface target**, and the envelope renders the composed content device-adaptively. You **slot**, you do not splice. The projector you already have does the merge; the authority just gives the slots one envelope.

This reframes docs/024's "command-surface SPI" and this document's "overlay SPI" as the **content** and the **envelope** of a single surface system. Neither is complete without the other: docs/024 left the envelope to each host, which is exactly the gap that produced sixteen implementations.

### 4.2 Two Orthogonal Axes: Content-Kind × Focus-Mode

The census shows that "what kind of overlay is this" is actually **two independent questions**, and the previous single `form`/`actions` enum conflated them:

- **Content-kind** — `actions` (a toolbar/button row), `menu` (a selectable list with roving/typeahead/submenus), `form` (fields to fill and commit), `card` (read-only display, maybe with a route-out button). This determines the *layout* and *which React Aria behavioral primitive renders inside the envelope* (RA `Toolbar`, RA `Menu`, RA `Dialog`/form, or a plain focusable region).
- **Focus-mode** — `transparent` (the editor keeps DOM focus because the user is still editing text; the overlay is operated without taking focus) vs `taking` (the user has stopped editing and operates the overlay, which holds focus).

They are orthogonal, and the slash menu proves it: it is content-kind `menu` but focus-mode `transparent` — which is exactly why it cannot use RA `Menu`'s focus-trapping keyboard handling and hand-rolls a document-capture driver. The context menu is content-kind `menu` but focus-mode `taking`. Same content-kind, opposite focus-mode. A single enum could never express both, which is why the old code had to special-case the slash menu out of the entire popover family.

The full mapping across the census:

| Surface | Content-kind | Focus-mode |
| --- | --- | --- |
| Selection flyout (root) | actions | transparent |
| Slash menu | menu | transparent |
| Cell `…` (root) | actions | transparent |
| Touch selection / caret toolbar | actions | transparent |
| Context menu | menu | taking |
| Block-type chooser / overflow / table menu | menu | taking |
| Link / glossary-add / comment-add form | form | taking |
| Object config | form | taking |
| Find bar | actions | transparent (survives doc clicks) |
| Annotation read / glossary read | card | taking (a11y focus, no field) |

`card` clarifies a hole in the old enum: a read-only popover *takes* focus for accessibility but has no field to autofocus. So focus-mode `taking` means "this surface owns focus while open"; whether a *field* is autofocused is a content-kind `form` detail, not a focus-mode detail.

### 4.3 Anchor-Targets Are The Spine

The unit of arbitration is a small, named set of **anchor-targets**, each resolving to at most one envelope instance at a time:

- `selection` — a non-collapsed text selection (the flyout/touch toolbar target).
- `caret` — a collapsed caret (slash menu, touch caret-Paste, the future caret-context affordance).
- `cell` — a table cell or cell-range (the `…` popover).
- `block` — a block/object (object config, block context).
- `mark` — an inline mark instance (link click, glossary read).
- `point` — an arbitrary client point (right-click context menu).

A contributor declares `{ target, contentKind, focusMode, priority, anchorRef-or-resolver, ... }` and the authority groups contributors by target. Targeting-by-anchor is the right spine because coexistence is then naturally expressed as *which targets may be live together* (e.g. `selection` and `block` might coexist when a selection sits inside an active object; `selection` and `caret` never coexist because they are the same point in two mutually exclusive selection shapes). It also gives the anchor resolver (§7.4) a finite set of anchor geometries to position and deconflict, rather than every surface re-deriving its own rect from the DOM.

### 4.4 Compose Vs Arbitrate: The Two-Level Co-Slot Rule

"Same anchor → merge" is too strong and would produce nonsense (a Paste button and a filterable slash list do not belong in one bar even though both want `caret`). The correct rule is two-level (specified precisely in §7.3):

1. **Group by target.** All contributors wanting the same anchor-target form a group.
2. **Within a group, co-slot the compatible, arbitrate the rest.** Contributors with a *compatible* content-kind and focus-mode (e.g. two `actions` contributors, both `transparent`) are **co-slotted** into one envelope, preserving each contributor's identity as its own slot. Incompatible contributors (an `actions` row and a `menu`, or a `transparent` and a `taking` peer) **arbitrate by priority** — the higher wins the target, the loser is suppressed or stacked.

So "merge" is precisely "≥2 *compatible* contributors on one target," and the mobile double-bar resolves because copy/paste (`actions`/`transparent`) and format (`actions`/`transparent`) are compatible and co-slot, while across *different* targets (a `selection` flyout vs a `cell` menu) the authority arbitrates or z-stacks. Merge and arbitrate are not alternatives — they are the two outcomes of one rule, chosen by compatibility.

### 4.5 Drill-In Is A Bounded Mode Stack

A surface is not a single static view. The selection surface opens in `actions`/`transparent` mode (copy/paste/format row) and *drills in* to `form`/`taking` mode when the user picks "Add link." Focus authority follows the mode transition. The context-menu-reopens-standalone pattern (`context-menu.tsx`) is the same drill-in masquerading as two surfaces, and the cell `…` and object config show the pattern recurs. Decision (§5.1): drill-in is **generic**, owned by the authority, but **bounded** so it never becomes a router/wizard framework. A surface owns a **mode stack** — a root view plus zero or more pushed panels — with `push`/`pop`, a focus-mode per level, and "dismiss pops one level, not the whole surface." That is navigation-stack-sized, not router-sized, and it covers flyout→link-form, context-menu→reopen-standalone, and any future drill-in with one mechanism.

### 4.6 The Contract Shapes

Illustrative TypeScript (final names settled during implementation; these convey the shape so no design intent is lost):

```ts
// packages/editor/src/view/spi/anchor-target.ts
export type AnchorTargetKind =
  | "selection" | "caret" | "cell" | "block" | "mark" | "point";

// A live anchor: the authority's anchor resolver (§7.4) turns this into a viewport
// rect, re-derived on scroll/edit through the docs/025 offset model — never scavenged
// per surface via document.querySelector.
export type AnchorRef =
  | { kind: "selection" }                       // resolves to the model selection rect
  | { kind: "caret" }                           // resolves to the collapsed caret rect
  | { kind: "cell"; cellId: NodeId }
  | { kind: "block"; blockId: NodeId }
  | { kind: "mark"; nodeId: NodeId; markId: string }
  | { kind: "point"; x: number; y: number };

export type ContentKind = "actions" | "menu" | "form" | "card";
export type FocusMode = "transparent" | "taking";

// What a contributor declares. Content itself comes from the projector
// (resolveCommandList) for command-bearing surfaces, or a render fn for forms/cards.
export interface OverlayContributor {
  readonly id: string;
  readonly target: AnchorTargetKind;
  readonly contentKind: ContentKind;
  readonly focusMode: FocusMode;
  // Registration order is the tiebreak (docs: "SPI ordering = registration, not numbers").
  // priority is for cross-kind arbitration within a target, coarse-grained.
  readonly priority?: number;
  // Whether this contributor co-slots with compatible peers (default) or demands the
  // target alone even against a compatible peer (rare; e.g. a future exclusive mode).
  readonly exclusive?: boolean;
  // For command surfaces: which projector surface feeds this contributor's slot.
  readonly projects?: string; // e.g. "flyout", "slash", "contextMenu"
  // For forms/cards: the render fn (receives the live CommandContext + a close/pop).
  readonly render?: (ctx: OverlaySurfaceContext) => ReactNode;
}

// The handle a call site / drill-in gets.
export interface OverlaySurfaceContext extends CommandContext {
  readonly pop: () => void;            // pop one mode-stack level
  readonly push: (panel: OverlayPanel) => void; // drill in
  readonly dismiss: () => void;        // request full dismissal (authority decides)
  readonly focusEditor: () => void;    // restore editor focus (gated by §7.1)
}
```

```ts
// packages/editor/src/view/spi/overlay-authority.ts
// One manager instance per editor. Subsumes useCommandSurfaces. Holds the persistent
// envelope state (open targets, per-target mode stack) and reconciles it against the
// volatile projected content each render (§7.2).
export function useOverlayAuthority(
  store: EditorStore,
  capabilities: ToolbarCapabilities,
  panelHost?: PanelHost,
): OverlayAuthority;

export interface OverlayAuthority {
  readonly ctx: CommandContext;
  // The resolved, arbitrated set of envelopes to render this frame, already
  // co-slotted, mode-stacked, z-ordered, and positioned (collision-resolved).
  readonly envelopes: readonly ResolvedEnvelope[];
  requestContextMenu(x: number, y: number): boolean;
  open(anchor: AnchorRef, contributorId: string): boolean; // explicit open; false = nothing resolved
  openMark(anchor: AnchorRef): boolean;                    // matches a registered mark contributor by kind
  dismissAll(): void;
}
```

### 4.7 Usage Shapes

A call site declares **intent**; it never touches React Aria mechanics. There are four usage modes — **(A)** module-level registration (ambient or explicit surfaces), **(B)** explicit opens from a press/click, **(C)** drill-in from a command or node-view, and **(D)** one generic render at the editor root. These shapes are illustrative (final names settle in implementation) but fix the contract so the build does not re-derive it.

**A. Registration — the selection bar (co-slot, the composition path, §5.2).** Three contributors share `target` + `contentKind` + `focusMode`, so they co-slot into one bar, each as its own slot in registration order. `projects` names the docs/024 projector list that fills the slot. Nothing here is device-specific — the touch skin is a render-time detail of the `actions` renderer:

```ts
registerOverlay({ id: "selection.clipboard", target: "selection",
  contentKind: "actions", focusMode: "transparent", projects: "clipboard" });

registerOverlay({ id: "selection.format", target: "selection",
  contentKind: "actions", focusMode: "transparent", projects: "flyout" });

registerOverlay({ id: "selection.annotate", target: "selection",
  contentKind: "actions", focusMode: "transparent", projects: "annotate" });
```

**A′. Registration — ambient surfaces on a caret (arbitration, not merge).** Same `caret` target, but `menu` and `actions` are incompatible content-kinds, so the authority arbitrates by `priority`/`when` (rule 3, §7.3) instead of co-slotting. `when` is the ambient raise predicate:

```ts
registerOverlay({ id: "caret.slash", target: "caret",
  contentKind: "menu", focusMode: "transparent", projects: "slash",
  when: (ctx) => detectSlashTrigger(ctx.store) !== null });

registerOverlay({ id: "caret.clipboard", target: "caret",
  contentKind: "actions", focusMode: "transparent", projects: "clipboard",
  when: (ctx) => ctx.isTouch && ctx.caretHeld, priority: 1 });
```

**B. Explicit open — context menu, cell `…`, mark click.** A press/click calls `authority.open(...)`; it returns `false` when nothing resolves (so the native context menu still shows, docs/024 §9). No overlay wiring at the call site:

```ts
onContextMenu={(e) => {
  if (authority.open({ kind: "point", x: e.clientX, y: e.clientY }, "point.contextMenu"))
    e.preventDefault();
}}

// Hovered cell "…" button. The swatch-press focus bounce is EXPECTED under
// `transparent`, so there is no pressInsideRef / keepCellPopoverOpen.
<ChromeButton icon="Ellipsis" label="Cell actions"
  onPress={() => authority.open({ kind: "cell", cellId }, "cell.actions")} />

// Click on a mark → the authority matches the registered mark contributor by kind,
// replacing useLinkInteraction/useAnnotationInteraction.
function onClickMark(el: HTMLElement) {
  const hit = resolveMarkHit(el);                 // { nodeId, markId, kind }
  if (hit) authority.openMark({ kind: "mark", nodeId: hit.nodeId, markId: hit.markId });
}
```

Mark contributors are registered once and matched by kind:

```ts
registerOverlay({ id: "mark.link", target: "mark", contentKind: "form",
  focusMode: "taking", match: (m) => m.kind === "link",
  render: (s) => <LinkForm ctx={s} onDone={s.dismiss} /> });

registerOverlay({ id: "mark.glossary", target: "mark", contentKind: "card",
  focusMode: "taking", match: (m) => m.kind === "glossary",
  render: (s) => <GlossaryReadCard ctx={s} /> });
```

**C. Drill-in from a command — link/glossary/comment add (the mode stack, §4.5).** A command pushes a `form` panel onto the surface it was invoked from instead of opening a nested popover; focus-mode flips `transparent → taking` (the §7.1 seam suspends reclaim), and `pop` returns to the action row. The same command works from the flyout or the context menu, and this `push` is what replaces the context-menu "close-and-reopen-standalone" workaround:

```ts
{
  id: "annotate.link", group: "annotate",
  surfaces: { flyout: { icon: "Link" }, contextMenu: { label: "Add link" } },
  run: (ctx) => ctx.push({
    id: "link.form", contentKind: "form", focusMode: "taking",
    render: (s) => <LinkForm ctx={s} onDone={s.pop} />,
  }),
}
```

**C′. Drill-in declared by a node-view — object config (block target).** Object config rides the existing node SPI, so a block contributes its own overlay; `when` makes it ambient on the active object:

```ts
defineNodeView("media", {
  render: renderMedia,
  overlay: {
    target: "block", contentKind: "form", focusMode: "taking",
    when: (ctx, blockId) => ctx.store.activeObjectId === blockId,
    render: (s) => <MediaConfig ctx={s} />,
  },
});
```

**D. The one generic render — editor root (no per-surface branch).** The authority emits already-arbitrated, co-slotted, mode-stacked, positioned envelopes; the root renders them generically through the single transform-free portal layer:

```tsx
function OwnedModelEditor() {
  const authority = useOverlayAuthority(store, capabilities, panelHost);
  return (
    <EditorOverlayProvider value={authority}>      {/* ownership registry context */}
      <ReactView store={store} authority={authority} />
      <OverlayLayer authority={authority} />        {/* single transform-free portal layer */}
    </EditorOverlayProvider>
  );
}

function OverlayLayer({ authority }: { authority: OverlayAuthority }) {
  return authority.envelopes.map((env) => (
    <Envelope key={env.id} placement={env.placement} z={env.z} surfaceRef={env.ref}>
      {env.slots.map((slot) => <SlotView key={slot.id} slot={slot} ctx={env.ctx} />)}
    </Envelope>
  ));
}
```

`SlotView` is the only place content-kind maps to a React Aria primitive — `actions → RA Toolbar`, `menu → RA Menu/ListBox`, `form`/`card` `→ RA Dialog` region — pulling content from `slot.projects` (the projector) or `slot.render`. React Aria does all behavior *inside* the slot; the envelope owns focus/dismiss/position/coexistence *around* it. The throughline: a call site says "open a `form` at this `mark`," or "this command pushes a form," or registers "`actions`, `transparent`, projects `clipboard`, target `selection`" — and never sees `isNonModal`, `shouldCloseOnInteractOutside`, a portal, an autofocus RAF, or a `data-engine-*` selector again.

## 5. Architecture Decisions

### 5.1 Recommended: One Manager, Anchor-Target Spine, Orthogonal Axes

Adopt a single overlay authority (`useOverlayAuthority`) that subsumes the coordinator and owns all three authorities (focus, dismissal, coexistence) for every floating surface. The spine is **anchor-targets** (§4.3); contributors declare **content-kind × focus-mode** as orthogonal axes (§4.2); coexistence is the **two-level co-slot rule** (§4.4); drill-in is a **bounded mode stack** owned generically by the authority (§4.5).

Why this is the right tradeoff:

- **It deletes the duplication, not relocates it.** The dismissal heuristic, focus reclaim, and containment checks are written once in the authority instead of once per surface, and the cross-file duplication (#1/#7) collapses to one place.
- **It reuses the projector.** Content stays a projection (docs/024); the authority is purely the envelope. No content logic moves.
- **It keeps React Aria.** The authority composes `@idco/ui`'s RA primitives; RA still does focus mechanics, keyboard, ARIA, and positioning. The editor adds only the focus-ownership *policy* RA cannot know. This holds the non-negotiable UI philosophy.
- **Generic drill-in is justified by recurrence.** The pattern appears in the flyout, the context menu, and (latently) the cell/object surfaces — three+ sites. Bounding it to a mode stack prevents framework creep while covering all of them.

### 5.2 Composing A Surface From Multiple Contributors (Co-Slot)

Co-slot is a **standard SPI capability, not a mobile feature**: a surface (an anchor-target's envelope) is *composed from N contributors*, and the two-level rule (§4.4/§7.3) co-slots the compatible ones into one envelope. The mobile double-bar (§3.5) is the *motivating example* that exposed the gap, not the scope of the decision.

The `selection` target carries three contributors — `clipboard` (copy/cut/paste), `format` (the inline marks), and `annotate` (link/glossary/comment) — all `actions` + `transparent`, so they co-slot into one bar, each as its own slot in registration order (§4.7 mode A). This is equally true on **desktop**; it was simply invisible there because no second contributor ever competed for the `selection` target. The bug only surfaced on mobile because touch *added* the clipboard contributor (the native-style Copy/Cut/Paste bar) next to the existing format flyout, and nobody composed them.

The decision — call it **Decision C** against the §3.5 options — is that the `selection` target has **one** envelope, composed by co-slot, fed by the same projector. The rejected options were **(a)** suppress the flyout on touch (loses projected format/annotate there) and **(b)** suppress the touch bar (loses the clipboard affordance and the touch ergonomics). Decision C kills the coexistence class for the target instead of arbitrating it forever, and it generalizes: any future contributor to `selection` (or any other target) co-slots by the same rule.

It has two consequences, and only one of them is device-related:

- **Composition consequence (general, the real work).** Copy/cut/paste must become **projected commands** like format/annotate (§5.4 — explicitly accepted, "no half-baked"), so all three contributors share one content pipeline instead of the current imperative `TouchSelectionActions` props. This is not mobile-specific; it is what makes the `selection` target composable at all.
- **Rendering consequence (a content-kind skin, not part of the merge).** The `actions` content-kind chooses a skin at render time via `ctx.isTouch` — touch uses larger hit targets, native-feel ordering, and keyboard-avoidant placement; desktop uses the dense flyout. This is a property of the `actions` renderer available to *every* surface, not a special path for the selection bar. The surface stays focus-mode `transparent` until a drill-in form commits (or the virtual keyboard collapses — the known keyboard-flicker class), which is again a general `transparent`-mode guarantee, not a selection-specific rule.

### 5.3 Scope: Replace Every Floating Surface, With One Clean Cut

Every floating surface in §3.1 comes under the authority — **including menus** — with one structural cut: the authority owns the **envelope** (position, dismissal, focus, coexistence, anchor); the **content-kind plugs in the unchanged React Aria behavioral primitive** inside the envelope. Menus keep RA `Menu` (roving, typeahead, submenus, ARIA `menu` roles); forms keep RA `Dialog` semantics; we do not reimplement any of that. "Replace every popover" means every floating thing gets its envelope from the authority and stops owning its own dismissal/focus/portal — not that we rewrite menu behavior.

The clean cut also draws three boundaries (the §1 non-goals): geometry stays painted in `view/overlays/` (so `touch-selection.tsx` splits — grips stay, the toolbar becomes a `selection` contributor); tooltips stay out; app modals stay foreign but coordinate (§7.6).

### 5.4 Rejected And Deferred Options

- **Rejected: keep copy/cut/paste imperative (`TouchSelectionActions` props).** Co-slotting them with format under Decision C requires them to be projected commands like everything else. Keeping them imperative would mean the merged bar has two content pipelines (projected format + prop-driven clipboard), defeating the unification. Explicitly accepted as in-scope work; the half-baked alternative is rejected.
- **Rejected: put the overlay policy in `@idco/ui`.** The "editing surface owns focus / model selection is authoritative" semantics are editor-specific and depend on `EditContext`/`view-root`. The architecture boundary lint (`scripts/oxlint-js-plugins/architecture.js`, `.oxlintrc.json`) forbids `@idco/ui` learning about them. `@idco/ui` stays the RA-behavior + DaisyUI-styling layer; the authority is an editor-package policy layer above it.
- **Rejected: hand-roll overlays to escape RA.** Would trade these focus/dismissal bugs for worse a11y/positioning bugs and violate the UI philosophy. The one existing hand-roll (slash menu) is replaced by a *managed* focus-transparent menu (§7.5), not by more hand-rolling.
- **Rejected: per-popover positioning (status quo).** Cannot deconflict coexisting surfaces; chosen replacement is the central positioning solve (§7.4). This costs more than wrapping `AnchoredPopover` and is accepted under the "most correct" bar.
- **Deferred to future backlog (§12), not first release:** drag-to-reorder blocks (note.md item 1, an independent direct-manipulation affordance, not an overlay-authority concern), and folding tooltips/app-modals into the authority (intentional non-goals).

## 6. Implementation Strategy

Sequence so every step is independently reviewable, testable against the existing e2e specs, and self-justifying (each migration deletes a pile of ad-hoc guards):

1. **Build the authority core + anchor resolver behind the scenes** (§8.1, §8.2), with the focus-reclaim seam (§7.1) and the reconciliation rule (§7.2) in place, but no surface migrated yet. Prove it with unit tests of arbitration/co-slot/mode-stack and the positioning solve.
2. **Migrate the selection flyout first** — it is already ~80% the target model (coordinator-owned). This validates dismissal inversion, focus-transparent actions, and the mode stack (the link/glossary/comment drill-ins) end to end, and immediately deletes `shouldKeepFlyoutOpen` and the `flyoutChildOpen()` mirror.
3. **Merge the touch selection toolbar into the selection surface** (Decision C), splitting `touch-selection.tsx`. This is the headline coexistence fix and is only safe once step 2 owns the `selection` target.
4. **Migrate the cell `…` popover** — deletes `keepCellPopoverOpen` + `pressInsideRef` + the `data-engine-view-root` geometric guards.
5. **Migrate the standalone forms/cards** — link, annotation read, object config, find bar — onto the controlled-anchored primitive with `form`/`card` content-kind.
6. **Migrate the menus** — slash (the focus-transparent keyboard routing payoff, §7.5), context menu, block chooser, overflow — onto the envelope while keeping RA `Menu` inside; deletes the slash raw portal + the context-menu "reopen standalone" workaround (it becomes a drill-in).
7. **Retire the ribbon hacks** — the `onMouseDownCapture` containment gate and the `requestAnimationFrame(focusEditor)` close bounce — once focus policy lives on the envelope (§7.1).
8. **Wire foreign-modal coordination** (§7.6) and final cleanup of the `data-engine-*` selector soup that no surface needs anymore.

Each step is shippable; the editor never regresses to two pipelines.

### 6.1 Phase Map

The seven backlog items (§11) group into **three phases** by dependency. The cut is foundations → one proof surface → parallel fan-out:

| Phase | Tickets | Why grouped | Gate / what it proves |
| --- | --- | --- | --- |
| **P1 — Foundations** | R1-A (authority core), R1-B (focus-reclaim seam), R1-C (anchor resolver + portal + positioning) | The three infra pieces; no surface migrated yet. A is the spine, B is the core seam, C is the positioning/portal layer — they interlock but ship behind the scenes. | Unit tests for arbitration / co-slot / mode-stack / reconciliation / positioning pass; nothing user-visible changes. |
| **P2 — Selection surface proof** | R1-D (flyout + touch merge) | Deliberately alone. The flyout is already ~80% the target model, so it is the cheapest end-to-end validation of all three authorities at once (dismissal inversion, transparent actions, the drill-in mode stack, the co-slot merge). | Existing flyout e2e specs pass unchanged; **one** selection bar on touch; keyboard does not collapse during a drill-in. This is the go/no-go for the model. |
| **P3 — Fan-out migration** | R1-E (cell + table containment), R1-F (menus + transparent-keyboard routing), R1-G (forms/cards + ribbon-hack retire + foreign-modal) | Independent of each other (different surfaces); all depend only on P1 plus the patterns proven in P2. Parallelizable. | Per-surface specs pass; the hand-rolled paths (slash raw portal, context-menu reopen-standalone, `pressInsideRef`, ribbon capture-gate, `useAutoFocusWithin`) are deleted; consumer boundary audit clean. |

Dependency spine: **R1-A → (R1-B, R1-C) → R1-D → {R1-E, R1-F, R1-G}**. P1's three tickets may overlap during development but land/review as one foundation; P3's three can run truly in parallel once P2 proves the model. This is the §6 eight-step strategy collapsed onto the backlog: step 1 = P1, steps 2–3 = P2 (both inside R1-D), steps 4–8 = P3.

Judgment call: do **not** start any P3 ticket before P2 is green. P2 is the proof that the seam (§7.1), reconciliation (§7.2), and co-slot rule (§7.3) hold on a real surface; if it surfaces a contract flaw, fix it once in P1/P2 before three migrations bake in the wrong assumption.

## 7. The Five Load-Bearing Mechanics

These are the parts that decide whether the design *ends* the bug class or merely *relocates* it. They are specified concretely because the design is sound only if they are.

### 7.1 The Focus-Reclaim Seam (View → Core)

**The problem.** "The editor stops reclaiming focus while a focus-taking surface owns it" sounds clean, but the reclaim lives in **core** — the `EditContext` host re-grabbing focus, `focusSelectionSoon`, and `focusEditor` — while the policy ("is a `taking` surface up?") lives in the **view** authority. Core cannot import view policy: the architecture boundary forbids it and it is conceptually wrong. Without an explicit seam this is hand-waved, and a hand-waved version is exactly how commit `4ee6d7d` happened.

**The seam.** The core focus machinery exposes a minimal, view-agnostic control: `suspendReclaim()` / `resumeReclaim()` (or a `setReclaimSuspended(boolean)`), plus a read-only `isReclaimSuspended` it consults before every automatic refocus. The authority *drives* this seam: whenever a `taking` surface (or mode-stack level) is the focused owner, the authority calls `suspendReclaim()`; on dismissal/pop back to a `transparent` level it calls `resumeReclaim()` and then performs one deliberate `focusEditor()` to restore the caret. The core does not know *why* it is suspended — only that it must not auto-grab focus while suspended. This keeps the dependency direction correct (view → core via a neutral control surface), and it is the single point that replaces: the ribbon close-bounce RAF (`ribbon.tsx:485`), the `useAutoFocusWithin` RAF race (`use-reveal-focus.ts`), and the blur-dismiss guards (`shouldKeepFlyoutOpen`, `pressInsideRef`) — because once core does not reclaim during a `taking` surface, RA never sees the spurious blur-within that those guards exist to suppress.

**Interaction with RA.** With the seam in place, the authority also neutralizes RA's own focus moves: `FocusScope autoFocus` is allowed only for `form` content (and the authority does the explicit first-field focus deterministically *after* RA settles, replacing `useAutoFocusWithin`); RA `restoreFocus` is suppressed/redirected so close does not bounce focus to the trigger — the authority restores to the editor through the resumed reclaim instead.

**Failure mode if omitted.** If the reclaim is gated by a view-side hack (e.g. checking `document.activeElement`), it regresses the moment focus timing shifts (async commit, IME, mobile keyboard), reproducing "focus steal is aggressive." The seam must be a real core API.

### 7.2 Reconciling Persistent Envelope State With Volatile Projected Content

**The problem.** The projector is stateless — `resolveCommandList(surface, ctx)` is recomputed every render from the live context. But open/closed, the mode stack, and which drill-in panel is showing are **persistent** and **per-target**. So there is a join: persistent envelope state keyed by anchor-target, holding volatile projected content that can change or *vanish* underneath it. Today this join is exactly what `suppressedSig` and `flyoutChildOpen()` (`use-command-surfaces.ts`) hack around, un-generalized.

**The rule.** The authority holds envelope state (`open targets`, per-target mode stack, suppressed signatures) separately from content, and on every projection it reconciles:

- **Content still present:** re-render the envelope with fresh content; keep state.
- **Content changed but target still valid** (e.g. selection moved but is still a non-collapsed range): keep the envelope, re-anchor (§7.4), re-project; if a drill-in panel's preconditions still hold, keep it.
- **Content vanished while open** (the contributor no longer projects — selection collapsed, mark deleted, object deselected): the authority pops/dismisses per a single declared policy. The policy: a `transparent` root view dismisses immediately (it is ambient); a `taking` drill-in level *survives a transient empty projection* for as long as it owns focus, because the user is mid-interaction (this is the generalized `flyoutChildOpen()` — the form the author is typing in must not be torn out by a debounced "don't show" verdict). It dismisses only when the user commits/cancels or focus genuinely leaves.
- **Suppression:** a target dismissed by the user is suppressed for the *current* anchor signature (the generalized `suppressedSig`) until the anchor changes, so a sticky surface does not immediately re-raise over what replaced it.

**Why it must be first-class.** Without one stated policy, every surface re-invents `suppressedSig`/`flyoutChildOpen`. With it, the debounced-settle-vs-open-child race (the `b6c82bc` regression) is solved once, in the authority, for all surfaces and all drill-ins.

### 7.3 The Two-Level Co-Slot Rule, Precisely

Given the contributors that project for a frame:

1. **Group by `target`.** Partition contributors by `AnchorTargetKind`.
2. **Resolve cross-target coexistence.** A static compatibility matrix declares which targets may be simultaneously live (e.g. `selection`+`block` allowed when the selection is inside an active object; `selection`+`caret` impossible; `point` context-menu suppresses ambient `selection`/`caret` while open — the existing precedence, generalized). Disallowed pairs arbitrate by priority; the loser is suppressed for the frame.
3. **Within a surviving group, partition by compatibility.** Two contributors are **co-slot-compatible** iff they share a `contentKind` family that can share a container (`actions`+`actions`) **and** the same `focusMode`, and neither is `exclusive`. Compatible contributors co-slot into one envelope as ordered slots (registration order is the tiebreak, per the project's "ordering = registration, not numbers" rule). Incompatible contributors within the group arbitrate by `priority`; the winner takes the envelope, losers are suppressed or, if their content-kind permits stacking, z-stacked as separate envelopes on the same anchor with collision avoidance (§7.4).
4. **Mode stack overlay.** If the winning envelope has a non-empty mode stack (a drill-in is pushed), the top panel renders in place of / above the root per its content-kind, and focus-mode is taken from the top panel (driving §7.1).

This is the precise version of §4.4. The mobile merge is rule 3 producing one `actions`/`transparent` bar from copy/paste + format; the flyout-vs-cell-menu case is rule 2 (different targets, arbitrate/stack); the slash-vs-paste-on-caret case is rule 3 producing arbitration (incompatible `menu` vs `actions`).

### 7.4 Central Positioning Solve With Collision Avoidance

**The problem.** RA's `useOverlayPosition` positions each popover independently against the viewport and knows nothing about its neighbors. Two coexisting, non-mergeable surfaces near the same region (object config near a flyout; pre-merge the double-bar) overlap. "Most correct" rules out living with overlap.

**The solve.** The authority owns an **anchor resolver** that, each frame, takes the set of live envelopes with their `AnchorRef`s, resolves each anchor to a viewport rect through the docs/025 offset model (so it is correct across virtualized scroll and survives edits — re-anchored, not re-scavenged), then computes placements **together**: it lays out the envelopes, detects overlaps, and nudges/flips lower-priority envelopes to deconflict (the desktop flyout's "anchor at selection start so it does not cover the run" bias becomes one rule among several here). The resolved coordinates are then fed to the RA overlay (controlled position) rather than letting RA solve in isolation.

**Portal and transform constraint.** Overlays continue to portal so they escape editor clipping/overflow, but the portal target must be **transform-free** (RA positioning is `fixed`/absolute; a transformed ancestor of the portal target redefines the containing block and breaks the math). The authority owns a single overlay portal layer (one stacking context it controls for z-order) that is guaranteed transform-free; geometry overlays with transforms (`touch-selection.tsx:184`, `table-controls.tsx:153`) stay in their own painted layer and are not in this portal. This is the controlled, careful version of note.md item 2's "one portal root": its purpose is the z-order/stacking context and containment, and it is explicitly constrained to not reintroduce the transform/`fixed` positioning hazard that body-portaling avoids today.

**Containment becomes ownership, not ancestry.** With one portal layer plus an ownership registry (a React context tree of envelope `surfaceRef`s with parent→child links for drill-ins), "is this press inside me or a descendant overlay of mine" is one registry walk, replacing every `closest("[data-engine-*]")` selector and the `data-engine-view-root` geometric guard. Ownership (not DOM ancestry) is what makes containment reliable even though drilled-in children may render as DOM siblings in the flat portal layer.

**Cost, stated.** This is more than wrapping `AnchoredPopover`: positioning becomes a central per-frame solve. Accepted under the "most correct, no later patches" bar; the alternative (per-popover positioning) cannot deconflict and is rejected (§5.4).

### 7.5 Focus-Transparent Keyboard Routing

**The problem.** Making focus-transparent `menu` content first-class (so the slash menu rejoins the managed world) does not remove *why* slash hand-rolls a document **capture**-phase key handler (`slash-menu.tsx:147-171`): the menu never holds DOM focus, so RA `Menu`'s own keyboard handling never fires. Some component must translate arrows/enter/escape into menu navigation while focus stays in the editor.

**The capability.** The authority provides **focus-transparent keyboard routing** as a capability of `transparent` mode: a single capture-phase keyboard driver (owned by the authority, installed while any `transparent` surface with a navigable content-kind is open) that maps Arrow/Enter/Escape/Home/End to the active surface's selection/commit/dismiss, and exposes the current highlighted item to the content for `aria-activedescendant`-style rendering (the list is `aria-selected` without being focused — already how slash renders). This is reused by the slash menu, the flyout's roving toolbar (which today leans on RA `Toolbar` because it can hold focus transiently, but under the seam should be drivable transparently too), and any future transparent menu. It is the one place the "keyboard works without focus" trick lives, instead of being copy-pasted per surface.

**Why required.** Without it, every focus-transparent menu re-creates slash's document-capture handler, and the design's claim that slash "rejoins" the managed family is false. With it, slash becomes content-kind `menu` + focus-mode `transparent` + routed keyboard, and the raw `createPortal` + bespoke handler are deleted.

### 7.6 Smaller But Required: Foreign-Modal Coordination And The Controlled Primitive

- **Foreign-modal coordination.** When a host/app modal (`theme-dialog`, `confirm-dialog`, `command-palette`, `drawer`) opens over the editor, the editor's overlays must stand down (an open flyout/cell-popover/find-bar should not float above a modal that has `aria-hidden`-ed the editor). Rather than invent a global bus, **piggyback React Aria's existing modal overlay stack**: a modal calls `ariaHideOutside()`, which `aria-hidden`s the editor subtree; the authority detects that its root has become `aria-hidden` (or subscribes to RA's open-overlay stack) and dismisses/suspends its envelopes until the modal closes. This is the thin "something modal is up, stand down" relationship of §1's non-goal, implemented with the mechanism RA already ships.
- **Standardize on the controlled-anchored primitive.** The authority drives everything controlled (it owns `isOpen`, position, and dismissal). `@idco/ui`'s `AnchoredPopover` (controlled, `triggerRef`-anchored) is the right primitive; the trigger-coupled `PopoverTrigger` (`DialogTrigger` owning its own open state) cannot be externally driven cleanly and becomes an **editor anti-pattern** — its remaining editor uses (flyout child render, ribbon popover-actions, cell popover) migrate to the controlled form. `@idco/ui` keeps both for non-editor consumers; the editor standardizes on controlled. The authority hardwires the RA dismissal heuristic inert (`shouldCloseOnInteractOutside={() => false}`) on every envelope and converts raw interactions into dismissal *requests* itself (§7.1/§7.2), so RA never *decides* to close — it only *reports*, and the editor decides.

## 8. Detailed Implementation Plan

### 8.1 The Authority Core

Current problem: arbitration exists only for three flat surfaces (`useCommandSurfaces`) and only the arbitrate half; eight other surfaces self-manage.

Target behavior: one `useOverlayAuthority(store, capabilities, panelHost)` that holds envelope state (open targets + per-target mode stack + suppressed signatures), reconciles it against projected content each frame (§7.2), applies the two-level co-slot rule (§7.3), drives the focus seam (§7.1), and emits a positioned, z-ordered `ResolvedEnvelope[]` (§7.4).

Implementation tasks:

- [ ] Add `view/spi/anchor-target.ts` (`AnchorTargetKind`, `AnchorRef`, `ContentKind`, `FocusMode`, `OverlayContributor`, `OverlaySurfaceContext`).
- [ ] Add `view/spi/overlay-authority.ts` (`useOverlayAuthority`, `OverlayAuthority`, `ResolvedEnvelope`), generalizing `use-command-surfaces.ts` (keep its settle-debounce, precedence, and suppressed-signature logic; extend from 3 targets to all targets, add co-slot + mode stack).
- [ ] Implement the cross-target compatibility matrix and the within-group co-slot partition (§7.3).
- [ ] Implement the mode stack (`push`/`pop`, focus-mode per level) and wire it to the focus seam.
- [ ] Add the ownership registry context (envelope `surfaceRef`s + parent→child links) used by dismissal containment.

Tests: unit tests for arbitration (precedence, suppression), co-slot (compatible merge vs incompatible arbitrate), mode stack (push/pop/dismiss-pops-one), and reconciliation (content vanished while a `taking` level owns focus → survives; `transparent` root → dismisses).

### 8.2 The Anchor Resolver

Current problem: every surface re-derives its rect (`caretClientRect`, `getBoundingClientRect`, `elementFromPoint`) and positions independently; no collision avoidance.

Target behavior: a resolver that turns each `AnchorRef` into a viewport rect via the docs/025 offset model and computes all live envelope placements together with collision nudging (§7.4); a single transform-free portal layer for editor overlays.

Implementation tasks:

- [ ] Add the resolver in `view/overlays/` adjacent to the existing geometry (`geometry.ts`, `selection-overlay.tsx`) but as the *floating-surface* anchor source, reusing `caretClientRect`/`selectionRects`/`boundingRectOf`.
- [ ] Add the editor overlay portal layer (transform-free, single stacking context) and route all authority envelopes through it; keep painted geometry in its existing layers.
- [ ] Implement the joint placement + collision pass; feed controlled coordinates to the RA overlay.

Tests: positioning unit tests (start-bias for `selection`, flip near viewport edges, collision nudge for two coexisting envelopes), and a virtualized-scroll re-anchor test.

### 8.3 The Selection Surface (Flyout + Touch Merge)

Current problem: `selection-flyout.tsx` and `touch-selection.tsx`'s `SelectionToolbar` are two surfaces on one selection with opposite dismissal policies (§3.5); copy/cut/paste are imperative props.

Target behavior: one `selection`-target envelope, content-kind `actions`, focus-mode `transparent`, fed by co-slotted contributors (format/annotate from the projector + copy/cut/paste now projected), rendered device-adaptively (desktop dense skin / touch native skin), drilling into `form` for link/glossary/comment.

Implementation tasks:

- [ ] Promote copy/cut/paste to projected commands (a new `clipboard` command group; resolve via the projector for the `selection` and `caret` targets). Replace the imperative `TouchSelectionActions` plumbing in `touch-selection.tsx`/`react-view.tsx`.
- [ ] Split `touch-selection.tsx`: grips/rects stay (geometry); the toolbar becomes a `selection` (and the caret-Paste a `caret`) contributor with the touch skin.
- [ ] Migrate `selection-flyout.tsx` to a `selection` contributor; delete `shouldKeepFlyoutOpen` and the flyout's `shouldCloseOnInteractOutside` passthrough.
- [ ] Move the link/glossary/comment child forms to mode-stack `push` (drill-in) instead of nested `PopoverTrigger`; delete `data-engine-flyout-child`/`data-engine-surface-child` markers and the coordinator's `flyoutChildOpen()`.

Tests: `tests/e2e/engine-flyout-bold.spec.ts` (sticky flyout survives Bold) and `tests/e2e/engine-flyout-popover.spec.ts` (drill-in form focuses + mouse-selectable) must pass unchanged; add a mobile spec asserting **one** selection surface on touch (the double-bar is gone) and keyboard non-collapse during a drill-in.

### 8.4 Menus: Context Menu, Slash, Block Chooser, Overflow

Current problem: slash hand-rolls a portal + capture keyboard; context menu reopens form-commands as standalone popovers; all carry their own dismissal.

Target behavior: each is an envelope with content-kind `menu` inside which RA `Menu`/`ListBox` is unchanged. Slash is `transparent` (uses §7.5 routing); the rest are `taking`. The context-menu form-command becomes a drill-in (`push`), deleting the "reopen standalone" workaround.

Implementation tasks:

- [ ] Migrate `slash-menu.tsx` to a `caret` contributor, content-kind `menu`, focus-mode `transparent`; delete the `createPortal` + bespoke document-capture handler in favor of §7.5 routing. Keep the committed-text trigger detection in the authority.
- [ ] Migrate `context-menu.tsx` to a `point` contributor; convert its popover/dropdown form-commands to drill-ins; keep `flex-nowrap` single-column and bounded-height styling.
- [ ] Migrate the block-type chooser and overflow menu (`ribbon.tsx`) envelopes; keep RA `Menu` inside.

Tests: slash keyboard nav + insert-collapses-`/query` specs; context-menu cell-ops specs; assert the slash raw portal and the context-menu standalone-reopen code are deleted.

### 8.5 Forms And Cards: Link, Glossary, Comment, Object Config, Annotation Read

Current problem: standalone popovers each thread `autoFocus`/`shouldCloseOnInteractOutside`; annotation read is a `card` with no field but RA still autofocuses.

Target behavior: `form` content-kind (link/glossary/comment/object-config) with deterministic first-field focus from the authority (replacing `useAutoFocusWithin`); `card` content-kind (annotation/glossary read) takes focus for a11y with no field autofocus.

Implementation tasks:

- [ ] Migrate `link-popover.tsx`, `annotation-popover.tsx`, `object-block.tsx` config, `find-bar.tsx`, and the stray `table-of-contents.tsx` `AriaPopover` onto controlled-anchored envelopes with the right content-kind/focus-mode.
- [ ] Delete `useAutoFocusWithin`; the authority performs the explicit first-field focus for `form` after RA settle (§7.1).

Tests: link edit/apply/remove specs; annotation read open/route specs; object config open-on-active specs; find-bar survives doc clicks spec.

### 8.6 Table Surfaces

Current problem: the cell `…` popover carries `keepCellPopoverOpen`+`pressInsideRef`; range/hover paint is body-portaled with `data-engine-view-root` geometric guards to avoid phantom drags under popovers.

Target behavior: the cell `…` popover is a `cell` contributor (`actions`/`transparent`); the swatch-press focus bounce is *expected* under `transparent` (no dismiss), deleting `pressInsideRef`. Range/hover paint stays geometry but the "is this press on the surface vs a popover" check becomes the ownership registry walk, deleting the `data-engine-view-root` selector guards.

Implementation tasks:

- [ ] Migrate the cell `…` popover (`table-interactions.tsx`) to a `cell` envelope; delete `keepCellPopoverOpen`, `pressInsideRef`, and the `shouldCloseOnInteractOutside` passthrough.
- [ ] Replace the `onSurface`/`data-engine-view-root` guards with the authority's ownership containment.
- [ ] Keep the range/hover paint and `table-controls.tsx` handles in the geometry layer.

Tests: `tests/e2e/engine-table-cell-popover.spec.ts` (fill/align apply without dismiss; click-outside closes) passes unchanged; add a spec for a popover over a table not starting a phantom cell drag.

### 8.7 The `@idco/ui` Primitive Changes

Current problem: editor uses both `PopoverTrigger` (trigger-coupled) and `AnchoredPopover` (controlled), and `popover.tsx` carries editor-shaped doc comments and a `shouldCloseOnInteractOutside` passthrough used only to fight the editor.

Target behavior: the editor standardizes on `AnchoredPopover` (controlled); `PopoverTrigger` stays for non-editor consumers but is not used in the editor. No editor focus semantics enter `@idco/ui`.

Implementation tasks:

- [ ] Ensure `AnchoredPopover` exposes controlled position (to accept the central solve's coordinates) and an explicit "never self-dismiss" path (the authority sets `shouldCloseOnInteractOutside={() => false}`).
- [ ] Trim the editor-specific narrative from `popover.tsx` once the editor no longer relies on the passthrough; keep DaisyUI citation comments.
- [ ] Run the consumer boundary audit (`rg` scan from `content-api`) per CLAUDE.md after any `@idco/ui` change.

Tests: `tests/ui/` popover tests; cross-repo `pnpm check` against linked idco before any version bump.

## 9. Migration And Rollout

- Follow the §6 sequence; each step is a reviewable PR that deletes its predecessor's hacks. No feature flag is needed because each surface flips atomically from old to authority-owned and is gated by its existing e2e spec.
- The one behavior change a user can see is the mobile merge (one selection bar instead of two). Land it (step 3) only after the selection surface owns the target (step 2), and gate it with the new mobile spec.
- `@idco/ui` changes (§8.7) follow the cross-repo release ritual in CLAUDE.md: edit idco, `pnpm dev:link` in the consumer, prove `pnpm check`, bump every publishable `package.json` to the same `X.Y.Z`, tag `vX.Y.Z`, then `pnpm dev:unlink`. Do not hand-symlink or delete the consumer lockfile.
- Rollback: because each step is atomic per surface, reverting a single PR restores that surface's prior (hacked but working) behavior without touching the others.

## 10. Edge Cases And Failure Modes

- **Focus reclaim fires during a drill-in form (regression of `4ee6d7d`).** Expected: with the §7.1 seam suspended while a `taking` level is up, core never auto-grabs; the form keeps focus; typing starts immediately. Failure to suspend → the original focus-steal bug.
- **Selection collapses while a link form is open.** Expected (§7.2): the `taking` drill-in survives the transient empty projection because it owns focus; it dismisses on commit/cancel, then resumes reclaim and restores the caret.
- **Two `actions` contributors with conflicting focus-mode want the `selection` target.** Expected (§7.3): they do not co-slot; the higher priority wins, the other is suppressed (logged in dev so the conflict is visible, not silent).
- **A foreign app modal opens over an open flyout.** Expected (§7.6): the authority detects its root is `aria-hidden`/below a modal and dismisses/suspends envelopes; on modal close, ambient surfaces may re-raise per their triggers.
- **Virtualized scroll moves the anchor off-screen.** Expected (§7.4): the resolver re-anchors via the offset model; an anchor that scrolls out of view dismisses its `transparent` ambient surface (matching the caret leaving) but a `taking` form follows its anchor or pins.
- **Transform introduced on a scroll ancestor.** Expected: the dedicated transform-free portal layer is unaffected; a lint/dev-assert guards against putting a transform on the portal layer itself (the one thing that would break positioning).
- **Touch keyboard collapse during selection.** Expected (§5.2): the selection surface stays `transparent` on touch until a form drill-in commits; the EditContext host keeps focus, so the virtual keyboard does not dismiss.
- **Slash menu keyboard with no DOM focus.** Expected (§7.5): the transparent keyboard router drives navigation; Backspace deleting the `/` still dismisses via the committed-text trigger detection.
- **Right-click while a sticky flyout is open.** Expected: `point` context menu suppresses the ambient `selection` flyout for that signature (existing precedence, generalized), no fight.

## 11. Implementation Backlog

### R1-A. Authority Core + Anchor Targets — Phase 1

Scope:

- `packages/editor/src/view/spi/anchor-target.ts`
- `packages/editor/src/view/spi/overlay-authority.ts`
- `packages/editor/src/view/chrome/surfaces/use-command-surfaces.ts` (generalize)

Tasks:

- [ ] Define the contract shapes (§4.6).
- [ ] Implement envelope state, reconciliation (§7.2), co-slot rule (§7.3), mode stack (§4.5), ownership registry.
- [ ] Port the coordinator's settle-debounce/precedence/suppression.

Acceptance criteria:

- Arbitration, co-slot, mode-stack, and reconciliation behave per §7.2/§7.3 unit tests; the coordinator's existing behaviors are preserved.

Tests:

- New unit suites under `tests/editor/` for authority logic.

### R1-B. Focus-Reclaim Seam — Phase 1

Scope:

- `packages/editor/src/core/` focus machinery (`EditContext` host, `focusSelectionSoon`, `focusEditor`)
- `packages/editor/src/view/spi/overlay-authority.ts`

Tasks:

- [ ] Add `suspendReclaim`/`resumeReclaim` (+ `isReclaimSuspended`) to core, consulted before every auto-refocus.
- [ ] Drive the seam from the authority on `taking`/`transparent` transitions; perform one deliberate restore on resume.
- [ ] Neutralize RA `autoFocus`/`restoreFocus` per content-kind.

Acceptance criteria:

- No automatic editor refocus occurs while a `taking` surface is open; the flyout/link drill-in keeps focus without any per-site guard.

Tests:

- `tests/e2e/engine-flyout-bold.spec.ts`, `tests/e2e/engine-flyout-popover.spec.ts` pass with `shouldKeepFlyoutOpen`/`useAutoFocusWithin` deleted.

### R1-C. Anchor Resolver + Portal Layer + Central Positioning — Phase 1

Scope:

- `packages/editor/src/view/overlays/` (resolver), the editor overlay portal layer
- `packages/ui/src/popover.tsx` (controlled position)

Tasks:

- [ ] Resolve `AnchorRef` via the docs/025 offset model; joint placement + collision nudge.
- [ ] Add the transform-free portal layer + dev-assert against transforms on it.
- [ ] Feed controlled coordinates to RA.

Acceptance criteria:

- Two coexisting envelopes never overlap; placement is correct across virtualized scroll.

Tests:

- Positioning unit tests + a virtualized re-anchor test.

### R1-D. Selection Surface Merge — Phase 2

Scope:

- `packages/editor/src/view/chrome/surfaces/selection-flyout.tsx`
- `packages/editor/src/view/overlays/touch-selection.tsx` (split)
- clipboard command projection; `react-view.tsx` plumbing

Tasks:

- [ ] Project copy/cut/paste; co-slot with format/annotate into one `selection` envelope.
- [ ] Split touch geometry from the touch toolbar; device-adaptive skins.
- [ ] Convert child forms to drill-ins; delete `flyoutChildOpen()` and child markers.

Acceptance criteria:

- One selection surface on desktop and on touch; drill-ins focus correctly; no keyboard collapse on mobile.

Tests:

- Existing flyout specs pass; new mobile single-bar + keyboard-stability spec.

### R1-E. Cell Popover + Table Containment — Phase 3

Scope:

- `packages/editor/src/view/nodes/table/table-interactions.tsx`

Tasks:

- [x] Migrate cell `…` to a `cell` envelope; delete `keepCellPopoverOpen`/`pressInsideRef`.
- [x] Replace `data-engine-view-root` guards with ownership containment.

Acceptance criteria:

- Fill/align apply without dismiss; outside click closes; no phantom drag under popovers.

Tests:

- `tests/e2e/engine-table-cell-popover.spec.ts` passes; new phantom-drag spec.

### R1-F. Menus — Phase 3

Scope:

- `packages/editor/src/view/chrome/surfaces/slash-menu.tsx`, `context-menu.tsx`, `ribbon.tsx`

Tasks:

- [x] Transparent keyboard routing (§7.5); migrate slash; delete its raw portal + bespoke handler.
- [x] Migrate context menu form-commands to authority-opened forms (`openForm`); delete reopen-standalone. The menu *shell* stays a React Aria `MenuTrigger` (decision: a well-behaved RA menu is the package philosophy, carries none of the forbidden patterns, and force-wrapping it in an envelope adds risk without behavioral gain).
- [~] Block chooser + overflow: kept as clean RA `MenuTrigger` menus for the same reason — no forbidden patterns, RA owns menu behavior. Not wrapped in `menu` envelopes.

Acceptance criteria:

- Slash and context-menu behavior unchanged for the user; the hand-rolled paths are deleted.

Tests:

- Slash nav/insert specs; context-menu cell-ops specs.

### R1-G. Forms/Cards + Ribbon Hack Retirement + Foreign-Modal — Phase 3

Scope:

- `link-popover.tsx`, `annotation-popover.tsx`, `object-block.tsx`, `find-bar.tsx`, `table-of-contents.tsx`, `ribbon.tsx`, `packages/ui/src/popover.tsx`

Tasks:

- [x] Migrate forms/cards (link → `mark`/form, glossary read → `mark`/card, object-config → ambient `block`/form, find → `point`/sticky form); delete `useAutoFocusWithin`.
- [x] Delete the ribbon `onMouseDownCapture` gate and the close-bounce RAF (ribbon `popover`/`dropdown` actions now open through `openForm`).
- [x] Wire foreign-modal coordination via `ariaHideOutside` (the overlay layer dismisses all envelopes when its portal becomes `aria-hidden`, §7.6).
- [x] Standardize editor on `AnchoredPopover` — the editor now uses **no `PopoverTrigger`** (every trigger-coupled popover is gone). The `popover.tsx` editor-narrative trim was **intentionally NOT applied**: it is a doc-comment-only change to `@idco/ui`, and shipping it would force the full cross-repo release ritual (bump every package + tag + publish + dev:unlink) for a comment. Leaving `popover.tsx` untouched means **no `@idco/ui` change at all this phase, hence no release to run and nothing deferred** — the substantive §8.7 goal (no trigger-coupled popovers in the editor, no editor focus semantics relied on in `@idco/ui`) is met by the editor-side migration alone. The cosmetic narrative cleanup can ride any future `@idco/ui` release at zero marginal cost.

New engine capabilities this phase added (not in the original §4 model, discovered during implementation):

- **`sticky` focus-mode** (§4.2): owns focus like `taking` but is exempt from outside-press dismissal (find keeps its field focused yet survives a click into the document). Closes on Escape / explicit dismiss.
- **`volatile` contributor flag**: opts an ambient focus-owning surface out of the §7.2 survive rule, so object-config closes the instant its object deactivates instead of lingering.
- **§3b suppression**: a focus-`taking` surface on an off-text-flow target (a link/object form) suppresses the ambient transparent selection bar over the same span (the generalization of §3.3 #7), paired with a mark surface dismissing itself when the model selection leaves its mark.

Acceptance criteria:

- All forms/cards focus correctly with no per-site guards; the editor uses no trigger-coupled popovers; the consumer boundary audit is clean.

Tests:

- Per-surface specs above; `tests/ui/` popover tests; cross-repo `pnpm check`.

## 12. Future Backlog

- **Drag-to-reorder blocks** (note.md item 1): a direct-manipulation affordance (handle + drop indicator + move command), independent of the overlay authority; not required by this work.
- **Folding tooltips into the authority**: only if a future need (e.g. interactive tooltips) makes their lifecycle overlap the envelope; currently an intentional non-goal.
- **Re-homing app modals under the authority**: only if the editor ever needs to own a true modal inline; currently foreign-but-coordinating is sufficient.
- **A custom-overlay SPI for host extensions**: once the internal surfaces are migrated, expose `OverlayContributor` registration to hosts so product repos can add deployment-specific surfaces without hand-rolling — the same "register, don't hardcode" arc the command/node SPIs took.

## 13. Definition Of Done

- Every floating surface in §3.1 (excluding the intentional non-goals) renders through `useOverlayAuthority` **except the RA `Menu` surfaces** — the right-click context menu, the block-type chooser, and the overflow menu — which R1-F deliberately keeps as clean React Aria `MenuTrigger`s (a well-behaved RA menu carries none of the forbidden patterns; force-wrapping it in an envelope adds risk without behavioral gain). Those menus stay on the thin `use-command-surfaces.ts` state holder; everything else is authority-owned. No surface passes `isNonModal`/`shouldCloseOnInteractOutside`/`pressInsideRef`/`onMouseDownCapture`/autofocus RAFs/`createPortal`-to-body/`closest("[data-engine-*]")` from a call site. (The context menu retains a single `requestAnimationFrame(focusEditor)` to return focus to the editor after RA restores it to the menu trigger — intrinsic to RA `MenuTrigger`, not a 029 workaround.)
- The focus-reclaim seam (§7.1) exists in core and is the only place editor refocus is gated; `shouldKeepFlyoutOpen`, `keepCellPopoverOpen`, `pressInsideRef`, `flyoutChildOpen`, `useAutoFocusWithin`, the ribbon capture-gate, and the close-bounce RAF are all deleted.
- The mobile double-bar is gone: one device-adaptive `selection` surface, proven by a new e2e spec.
- The slash menu's raw portal + bespoke keyboard handler and the context-menu reopen-standalone workaround are deleted, replaced by transparent keyboard routing and a drill-in.
- Two coexisting envelopes never overlap (central positioning), and positioning is correct across virtualized scroll.
- `pnpm check` passes (format, lint incl. architecture boundary, dup gate, typecheck, test, build); existing flyout/table-cell e2e specs pass unchanged; new mobile + phantom-drag + collision specs pass.
- Any `@idco/ui` change ships via the cross-repo release ritual; the content-api consumer boundary audit is clean.

## 14. Final Model

The owned-model editor has one **overlay authority** that owns the **envelope** of every floating surface, while the **command projector** owns the **content** — two halves of one surface system. A contributor declares an **anchor-target**, a **content-kind**, and a **focus-mode**; the authority groups contributors by target, **co-slots** the compatible ones and **arbitrates** the rest, runs a bounded **drill-in mode stack**, and resolves **focus, dismissal, and coexistence** centrally. React Aria still does all behavior — focus mechanics, keyboard, ARIA, positioning, menus — inside the envelope; the editor adds only the focus-ownership policy RA cannot know, through a core **`suspendReclaim`/`resumeReclaim` seam** so the view never reaches into core illegitimately. RA's dismissal heuristic is inert (`() => false`): RA reports interactions, the editor decides. Positioning is a central per-frame solve in a transform-free portal layer, so coexisting surfaces never collide and containment is ownership, not DOM ancestry. The mobile double-bar collapses into one device-adaptive selection surface because copy/paste and format are co-slotted contributors, not two divs. The result replaces sixteen ad-hoc settlements of three conflicting authorities with one comprehensive, conflict-free interface — and deletes every guard, ref, selector, and RAF that existed only to translate React Aria's focus-authoritative assumptions onto a focus-non-authoritative surface, one call site at a time.
