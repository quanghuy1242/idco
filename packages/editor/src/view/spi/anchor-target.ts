/**
 * Overlay authority contracts (docs/029 §4.6/§4.7, R1-A) — the *envelope* half of the
 * surface system whose *content* half is the command projector (`command-surface.ts`,
 * docs/024). A floating surface is an **anchor-target's envelope** composed from one or
 * more **contributors**; this module declares what a contributor is and the registry it
 * registers into, mirroring `command-registry`/`mark-registry` ("register, don't
 * hardcode", docs/016 §10).
 *
 * Two orthogonal axes (docs/029 §4.2), which the old single `form`/`actions` enum
 * conflated:
 *
 * - **content-kind** (`actions`/`menu`/`form`/`card`) — the layout + which React Aria
 *   behavioral primitive renders *inside* the envelope. Only `actions` co-slot (a toolbar
 *   row can hold many contributors' buttons); `menu`/`form`/`card` are singletons.
 * - **focus-mode** (`transparent`/`taking`) — who owns DOM focus. `transparent`: the
 *   editor keeps focus because the user is still editing text (the flyout, the slash menu,
 *   the cell `…`); `taking`: the user operates the overlay, which holds focus (a form, a
 *   read card, the context menu). The slash menu proves the axes are independent — it is
 *   content-kind `menu` yet focus-mode `transparent`.
 *
 * The authority engine (`overlay-authority.ts`) consumes these to arbitrate, co-slot, run
 * the drill-in mode stack, and resolve focus/dismissal/coexistence; the anchor resolver
 * (`../overlays/overlay-anchor.ts`) turns an `AnchorRef` into a viewport rect. This module
 * is pure (no DOM, no React state) so the contracts and the registry are unit-assertable.
 */
import type { ReactNode } from "react";
import type { NodeId } from "../../core";
import type { CommandContext, CommandSurface } from "./command-registry";

/**
 * The anchor a surface attaches to (docs/029 §4.3). The *kind* is the arbitration spine:
 * contributors are grouped by it, and coexistence is expressed as which kinds may be live
 * together. The text-flow kinds (`selection`/`caret`/`point`) are mutually exclusive — one
 * text interaction at a time, the generalization of docs/024 §8's "one of context/flyout/
 * slash"; `cell`/`block`/`mark` coexist with the winner and with each other.
 */
export type AnchorTargetKind =
  | "selection" // a non-collapsed text selection (flyout / touch selection bar)
  | "caret" // a collapsed caret (slash menu / touch caret toolbar)
  | "cell" // a table cell or cell range (the `…` popover)
  | "block" // a block / object (object config, block context)
  | "mark" // an inline mark instance (link click, glossary read)
  | "point"; // an arbitrary client point (right-click context menu)

/**
 * A live anchor instance (docs/029 §4.6). The authority hands this to the anchor resolver,
 * which derives a viewport rect through the docs/025 offset model — re-derived on scroll/
 * edit, never scavenged per surface via ad-hoc `document.querySelector`. The `kind`
 * discriminates exactly the {@link AnchorTargetKind} union so a contributor's declared
 * `target` and its opened anchor cannot disagree.
 */
export type AnchorRef =
  | { readonly kind: "selection" }
  | { readonly kind: "caret" }
  | {
      readonly kind: "cell";
      readonly cellId: NodeId;
      /**
       * The trigger affordance's live screen point (the hovered `…` button's bottom-left), so
       * the cell action popover drops from the button the user pressed rather than the cell's
       * origin (docs/029 §7.4: the affordance, not the cell box, is the anchor). Absent for a
       * programmatic open, where the resolver falls back to the cell's model rect.
       */
      readonly at?: { readonly x: number; readonly y: number };
    }
  | { readonly kind: "block"; readonly blockId: NodeId }
  | { readonly kind: "mark"; readonly nodeId: NodeId; readonly markId: string }
  | { readonly kind: "point"; readonly x: number; readonly y: number };

/** The anchor-target kind an {@link AnchorRef} belongs to (its `kind` is the discriminator). */
export function anchorTargetKind(anchor: AnchorRef): AnchorTargetKind {
  return anchor.kind;
}

/** The layout + React Aria primitive a contributor's content renders as (docs/029 §4.2). */
export type ContentKind = "actions" | "menu" | "form" | "card";

/**
 * Who owns DOM focus while the surface is open, and how it dismisses (docs/029 §4.2).
 *
 * - `transparent` — the editor keeps focus (the user is still editing text): the flyout, the
 *   slash menu, the cell `…`, the touch caret-paste bar. Dismissal is *model-driven* (the
 *   selection collapses/changes → reconcile drops it), never an outside-press listener.
 * - `taking` — the overlay holds focus (a form, a read card, the context menu) and an outside
 *   press dismisses it (the authority's inverted dismissal). Survives a transient empty
 *   projection (a form mid-edit, §7.2).
 * - `sticky` — holds focus like `taking` (suspends the reclaim seam, autofocuses its first
 *   field, survives an empty projection) but is **exempt from outside-press dismissal**: it
 *   closes only on Escape or an explicit `dismiss`. The find bar needs exactly this — its
 *   field must stay focused, yet clicking a match in the document must not tear it down
 *   (docs/029 R1-G; the focus-mode gap that "survive doc clicks + keep focus" exposed).
 */
export type FocusMode = "transparent" | "taking" | "sticky";

/**
 * One pushed level of a surface's drill-in **mode stack** (docs/029 §4.5). A surface opens
 * at its root view and drills into panels (the flyout's action row → the "Add link" form);
 * each panel carries its own content-kind + focus-mode, so the envelope's effective
 * focus-mode is the top panel's. Bounded on purpose: a navigation stack (push/pop, dismiss
 * pops one level), never a router — the authority owns the stack generically so the flyout
 * drill-in and the context-menu "reopen as standalone" are one mechanism.
 */
export type OverlayPanel = {
  /** Stable id for the panel level (diagnostics + keys). */
  readonly id: string;
  readonly contentKind: ContentKind;
  readonly focusMode: FocusMode;
  /** The panel body (React Aria behavior + DaisyUI styling), given the surface context. */
  readonly render: (ctx: OverlaySurfaceContext) => ReactNode;
};

/**
 * What a surface body (a `form`/`card` contributor, or a drill-in panel) receives
 * (docs/029 §4.6). Extends the command context with the mode-stack + dismissal handles, so
 * a body declares intent ("pop back to the action row", "dismiss me") rather than reaching
 * into React Aria. `focusEditor` is the gated restore (it no-ops while the reclaim is
 * suspended, docs/029 §7.1).
 */
export type OverlaySurfaceContext = CommandContext & {
  /** The open surface's anchor, so a render knows which cell/block/mark it acts on. */
  readonly anchor: AnchorRef | null;
  /**
   * The payload an *ephemeral* surface was opened with (docs/029 R1-F/R1-G). The built-in
   * `ephemeral.form` contributor reads it as its render function, so the context menu's and
   * the ribbon's form-commands open an arbitrary command body through
   * `OverlayAuthority.openForm` instead of each hand-rolling a popover. Typed `unknown`; the
   * ephemeral contributor narrows it.
   */
  readonly payload?: unknown;
  /** Pop one mode-stack level (return from a drill-in to the level beneath it). */
  readonly pop: () => void;
  /** Drill in: push a panel onto this surface's mode stack. */
  readonly push: (panel: OverlayPanel) => void;
  /** Request full dismissal of this surface (the authority decides + records suppression). */
  readonly dismiss: () => void;
  /** Restore editor focus (gated by the focus-reclaim seam, docs/029 §7.1). */
  readonly focusEditor: () => void;
};

/** The minimal shape the `mark` matcher needs — the clicked mark's kind + id (docs/029 §4.7B). */
export type MarkProbe = {
  readonly kind: string;
  readonly markId: string;
  readonly nodeId: NodeId;
};

/**
 * A registered overlay contributor (docs/029 §4.6/§4.7). The call site declares *intent*
 * — target, the two axes, how it is triggered, and where its content comes from — and
 * never touches React Aria mechanics. Content is either projected (`projects` names a
 * command-surface list, docs/024) or rendered (`render`, for forms/cards/panels).
 *
 * Triggering: an *ambient* contributor declares `when` and the authority raises it from
 * model state (the flyout on a settled selection, slash on a `/` trigger); an *explicit*
 * contributor is opened by a press/click via `OverlayAuthority.open` (the context menu, the
 * cell `…`, a `mark` click matched by `match`). A contributor may be both (a `when` that is
 * sometimes true, also openable).
 */
export type OverlayContributor = {
  /** Stable id, unique across contributors; the registry key + co-slot/test handle. */
  readonly id: string;
  readonly target: AnchorTargetKind;
  readonly contentKind: ContentKind;
  readonly focusMode: FocusMode;
  /**
   * Cross-kind arbitration weight *within a target* (docs/029 §7.3 rule 3): when two
   * incompatible contributors (e.g. a `menu` and an `actions`) want the same target, the
   * higher `priority` wins it. Default 0. Co-slot ordering between *compatible* peers is
   * registration order, not priority ("ordering = registration, not numbers").
   */
  readonly priority?: number;
  /**
   * Demand the target alone even against a co-slot-compatible peer (docs/029 §4.6). Rare;
   * the default is to co-slot compatible peers. An exclusive contributor never co-slots.
   */
  readonly exclusive?: boolean;
  /**
   * Opt out of the §7.2 reconciliation-survive (docs/029). A focus-owning surface normally
   * *survives* a frame in which its projection transiently vanishes (a selection-anchored form
   * outliving a momentary selection collapse). A `volatile` contributor does NOT: it closes
   * the instant its `when` goes false. The object-config form sets this so deactivating its
   * object closes the config immediately, rather than lingering over a now-inactive block.
   * Only meaningful for an ambient (`when`-driven) focus-owning contributor.
   */
  readonly volatile?: boolean;
  /**
   * The command-surface list that fills this contributor's slot (docs/024
   * `resolveCommandList`), e.g. `"flyout"`/`"slash"`/`"contextMenu"`, or a host-defined
   * projector key. Mutually informative with `render`: a projected contributor renders its
   * command list; a `render` contributor renders a body. At least one must be present.
   */
  readonly projects?: CommandSurface | string;
  /**
   * The ambient raise predicate (docs/029 §4.7A′): when present and true for the live
   * context, the authority raises this contributor on its target without an explicit open.
   * Absent means explicit-only (opened via `OverlayAuthority.open`).
   */
  readonly when?: (ctx: CommandContext) => boolean;
  /**
   * The anchor an *ambient* contributor attaches to, computed from the live context
   * (docs/029 §4.7C′). Needed when the anchor is not the target's natural one — an object
   * config ambient on the active object resolves `{ kind: "block", blockId: activeObject }`.
   * Omit for `selection`/`caret` ambients, which use the target's natural anchor.
   */
  readonly ambientAnchor?: (ctx: CommandContext) => AnchorRef | null;
  /**
   * For `target: "mark"` contributors (docs/029 §4.7B): whether this contributor handles a
   * clicked mark. The authority calls it on `openMark` and opens the first matching
   * contributor (link → form, glossary → card).
   */
  readonly match?: (mark: MarkProbe) => boolean;
  /** For `form`/`card` contributors: the surface body. Omitted for purely projected ones. */
  readonly render?: (ctx: OverlaySurfaceContext) => ReactNode;
};

const CONTRIBUTORS = new Map<string, OverlayContributor>();

/**
 * Register an overlay contributor. Idempotent by id (a re-import / HMR replaces rather
 * than throwing), matching `registerCommand`/`registerMark`. Registration order is the
 * co-slot tiebreak, so registering later co-slots later.
 */
export function registerOverlay(contributor: OverlayContributor): void {
  CONTRIBUTORS.set(contributor.id, contributor);
}

/** The contributor for an id, or undefined (unregistered). */
export function getOverlayContributor(
  id: string,
): OverlayContributor | undefined {
  return CONTRIBUTORS.get(id);
}

/** Every registered contributor, in registration order (the co-slot tiebreak). */
export function listOverlayContributors(): readonly OverlayContributor[] {
  return [...CONTRIBUTORS.values()];
}

/** Registered contributors for one target, in registration order. */
export function listOverlayContributorsForTarget(
  target: AnchorTargetKind,
): readonly OverlayContributor[] {
  return [...CONTRIBUTORS.values()].filter((c) => c.target === target);
}

/** Remove a registered contributor (host teardown / test cleanup). */
export function unregisterOverlay(id: string): void {
  CONTRIBUTORS.delete(id);
}

/** Clear the whole registry (test isolation). */
export function clearOverlayContributors(): void {
  CONTRIBUTORS.clear();
}

/**
 * Whether two contributors **co-slot** into one envelope (docs/029 §7.3 rule 3). The
 * compatible case is two `actions` of the same focus-mode, neither exclusive: a toolbar row
 * can hold several contributors' buttons (clipboard | format | annotate). Every other pair
 * — different content-kind, different focus-mode, a `menu`/`form`/`card` (singletons), or an
 * exclusive contributor — arbitrates instead of merging. Symmetric and pure.
 */
export function canCoSlot(
  a: OverlayContributor,
  b: OverlayContributor,
): boolean {
  if (a.exclusive || b.exclusive) return false;
  if (a.target !== b.target) return false;
  if (a.focusMode !== b.focusMode) return false;
  if (a.contentKind !== b.contentKind) return false;
  return a.contentKind === "actions";
}
