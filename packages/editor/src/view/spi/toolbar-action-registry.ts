/**
 * View-layer toolbar-action registry (docs/023 §5.2) — the missing chrome SPI.
 *
 * The toolbar already projects three descriptor registries (marks, block types,
 * node inserts), but every *other* control — list, indent, link, undo/redo, the
 * table dimension picker, and any host-custom button — was literal JSX inside
 * `EditorToolbar` (docs/023 §3.2). A `ToolbarAction` is the descriptor for those:
 * a control that is not already a mark/block-type/insert, carrying its own
 * store-command wiring (`run`/`isActive`) or its own focused body (`render`).
 *
 * The action is pure *behavior + identity*. It declares the `slot` it lives in,
 * but it does not know about tabs, layout order across other item kinds, or
 * pixels — those belong to the layout layer (`toolbar-layout.ts`) and the renderer
 * (docs/023 §5.1). This split is the §6.1 decision: a descriptor never carries
 * cross-surface arrangement. (We keep `slot` on the action — a control that exists
 * *only* as a toolbar item has an obvious home — while marks/block-types, which
 * exist independent of the toolbar, are placed by the layout config instead.)
 *
 * Registration is idempotent by `id` (a re-import / HMR replaces rather than
 * throwing), matching `registerMark`/`registerBlockType`. Built-in actions are
 * registered through `registerBuiltInToolbarActions()` (`chrome/toolbar-builtins`),
 * wired into the view orchestrator (`react-view`) alongside the node/mark/block
 * registrars; see docs/023 §5.2/§9 for why that explicit call — not a bare
 * module-load side effect — is what keeps the package `sideEffects: false` safe.
 */
import type { ReactNode } from "react";
import type { EditorStore, TextMarkKind } from "../../core";

/** The four control shapes a toolbar action can take (docs/023 §5.2). */
export type ToolbarActionKind = "toggle" | "button" | "dropdown" | "popover";

/**
 * The surfaces a descriptor may project onto (docs/023 §5.7). First release uses
 * only `ribbon`; the field is on the SPI from day one so a later selection flyout
 * or a richer context menu projects the *same* descriptors filtered by surface,
 * rather than growing a parallel registry that would drift (docs/023 §3.11/§9).
 */
export type ToolbarSurface = "ribbon" | "flyout" | "contextMenu";

/**
 * Live selection facts derived once per toolbar render (docs/023 §5.3), so action
 * predicates are a pure function of model state, never an ad-hoc DOM read. Computed
 * from `store.query` under the toolbar's existing selection+commit subscription, so
 * they stay live with no new machinery. These must be *real* (not the legacy
 * hardcoded `hasSelectedText: false`) because selection-scoped actions — comment,
 * AI-on-selection — will depend on them.
 */
export type ToolbarSelectionFacts = {
  /** A non-collapsed text range exists. */
  readonly hasSelection: boolean;
  /** The selected run text, "" when collapsed or non-text. */
  readonly selectedText: string;
  /** The active text-leaf block type, or null off a text leaf. */
  readonly blockType: string | null;
  /** The marks active at the caret/over the selection. */
  readonly activeMarks: ReadonlySet<TextMarkKind>;
  /** The caret sits inside an object/structural scope (a cell, a callout). */
  readonly inObject: boolean;
};

/**
 * Per-deployment capability flags (docs/023 §5.6). Computed once from the editor's
 * props/bindings, NOT from document content, so the tab set is stable, not
 * shimmering (docs/023 §9 "capability shimmer"). First release: `insertTable` is
 * the only true non-Home capability; `media`/`review`/`ai` are false so their tabs
 * resolve empty and are dropped. Open index signature so a host can gate its own
 * tabs/actions on its own keys.
 */
export type ToolbarCapabilities = {
  readonly insertTable: boolean;
  readonly media: boolean;
  readonly review: boolean;
  readonly ai: boolean;
  readonly [key: string]: boolean;
};

/** What every action predicate and renderer receives (docs/023 §5.2/§5.3). */
export type ToolbarActionContext = {
  readonly store: EditorStore;
  readonly selection: ToolbarSelectionFacts;
  readonly capabilities: ToolbarCapabilities;
};

/** A `dropdown`/`popover` action's render context adds the dismiss handle. */
export type ToolbarActionRenderContext = ToolbarActionContext & {
  /** Close the popover/menu (the renderer wires it + returns focus to the editor). */
  readonly close: () => void;
};

/**
 * One toolbar control that is not a mark/block-type/insert (docs/023 §5.2). It
 * declares its identity, its home `slot`, how it looks, and either a `run`
 * (toggle/button) or a `render` (dropdown/popover focused body).
 */
export type ToolbarAction = {
  /** Stable id, unique across actions; the layout/hide key and the test handle. */
  readonly id: string;
  /** The slot this action lands in, e.g. "home.lists" (docs/023 §5.4). */
  readonly slot: string;
  /** Order within the slot; ties break by registration order. */
  readonly order?: number;
  readonly kind: ToolbarActionKind;
  readonly label: string;
  /** Registered lucide icon name (`nav-icons` registry). */
  readonly icon: string;
  /** Toggle highlight state; read through the store, never the DOM. */
  isActive?(ctx: ToolbarActionContext): boolean;
  /** Visible but greyed for the current selection/capability. */
  isDisabled?(ctx: ToolbarActionContext): boolean;
  /**
   * Whether the control exists at all for this context. `false` removes it from
   * the layout entirely (a host without a binding never sees it); contrast
   * `isDisabled`, which keeps it visible but greyed. The two are different author
   * meanings (provenance gates availability, docs/023 §4.9) and must not be merged.
   */
  isAvailable?(ctx: ToolbarActionContext): boolean;
  /** For `toggle`/`button`: the store mutation to run on press. */
  run?(ctx: ToolbarActionContext): void;
  /** For `dropdown`/`popover`: the focused body (React Aria + DaisyUI). */
  render?(ctx: ToolbarActionRenderContext): ReactNode;
  /** Lower collapses sooner under width pressure (docs/023 §6.4); default 0. */
  readonly responsivePriority?: number;
  /** Surfaces this action projects onto; defaults to `["ribbon"]` (docs/023 §5.7). */
  readonly surfaces?: readonly ToolbarSurface[];
};

const ACTIONS = new Map<string, ToolbarAction>();

/** Register a toolbar action. Idempotent by id (re-import / HMR replaces). */
export function registerToolbarAction(action: ToolbarAction): void {
  ACTIONS.set(action.id, action);
}

/** The action for an id, or undefined (unregistered). */
export function getToolbarAction(id: string): ToolbarAction | undefined {
  return ACTIONS.get(id);
}

/** Every registered action, in registration order. */
export function listToolbarActions(): readonly ToolbarAction[] {
  return [...ACTIONS.values()];
}

/** Remove a registered action (host teardown / test cleanup). */
export function unregisterToolbarAction(id: string): void {
  ACTIONS.delete(id);
}

/** Whether an action targets a surface (default `ribbon` when unset, §5.7). */
export function actionTargetsSurface(
  action: ToolbarAction,
  surface: ToolbarSurface,
): boolean {
  return (action.surfaces ?? ["ribbon"]).includes(surface);
}
