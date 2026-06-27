/**
 * Side-panel (dock) registry — the Side Panel SPI (docs/027 §8.2).
 *
 * The dock is one tabbed region of editor chrome that holds *workspace* panes:
 * Outline, Comments, Glossary, Insights, and later an AI assistant. A feature
 * teaches the editor a pane by registering one `SidePanel`, exactly the way it
 * teaches a node (`registerNode`), a mark (`registerMark`), a command
 * (`registerCommand`), or a host data source (`registerDataSource`). The dock is
 * generic chrome: it lists the available panes as tabs and renders the active one,
 * holding zero knowledge of comments/glossary/outline (docs/027 §8.2).
 *
 * Why a separate registry from the command registry (docs/027 §8.6): a toolbar tab
 * is a ribbon of *commands*; a dock pane is a *workspace*. They relate only through
 * a command that calls `ctx.panelHost.open(paneId)`. Fusing "issue a command" with
 * "show a workspace" would re-entangle two concerns the rest of the architecture
 * keeps apart, so a pane is its own registration with its own gating.
 *
 * Shape mirrors the sibling SPI registries (`data-source-registry.ts`,
 * `command-registry.ts`): a module-level singleton, register-by-id, idempotent so an
 * HMR reload or a test re-import replaces rather than throws, and `listSidePanels`
 * returns registration order (docs/027 §8.5 — tab order is registration sequence,
 * never an explicit index). All imports are type-only, so nothing lands in the
 * runtime graph from this file alone.
 *
 * @categoryDefault Side Panel SPI
 */
import type { ReactNode } from "react";
import type { EditorStore, NodeId } from "../../core";
import type { CommandContext } from "./command-registry";

/** What the dock hands a pane when it renders it (docs/027 §8.2, §9). */
export type SidePanelRenderArgs = {
  /** The live store the pane reads/dispatches against. */
  readonly store: EditorStore;
  /** The live command context (selection facts, scope, capabilities, dock seam). */
  readonly ctx: CommandContext;
  /**
   * Scroll a node into view — the engine's `scrollToBlock`, which reaches a
   * windowed-out block a plain `#hash` cannot (docs/027 §9.2/§9.3 jump-to-anchor).
   */
  readonly reveal: (id: NodeId) => void;
  /** Close the dock (a pane's own "done"/dismiss affordance). */
  readonly close: () => void;
  /**
   * An item to reveal + highlight on open (docs/027 §16 P6): a glossary term id, a
   * comment thread id. Set when the pane was routed to from a clicked annotation;
   * undefined for a plain open. A pane scrolls the matching row into view and rings
   * it; a pane with no addressable rows ignores it.
   */
  readonly focusId?: string;
};

/**
 * One dock pane (docs/027 §8.2). `isAvailable` is the provenance gate: a Comments
 * pane returns false until a comment source is registered, a Glossary pane until the
 * glossary collection is, so a deployment that wires neither simply has neither tab
 * (docs/027 §7.7). Absent `isAvailable` means always available (Outline, Insights).
 */
export type SidePanel = {
  readonly id: string;
  /** The tab label and the dock header title for this pane. */
  readonly title: string;
  /** Registered lucide icon name (`nav-icons`); shown on the tab. */
  readonly iconName: string;
  /** Whether this pane exists for the current context; absent = always. */
  isAvailable?(ctx: CommandContext): boolean;
  /** The pane body (React Aria behavior + DaisyUI styling, per the package rule). */
  render(args: SidePanelRenderArgs): ReactNode;
};

const SIDE_PANELS = new Map<string, SidePanel>();

/**
 * Register a dock pane. Idempotent by `id` (a re-import or HMR reload replaces
 * rather than throwing), matching the other SPI registries so module-load and test
 * re-registration are safe.
 */
export function registerSidePanel(panel: SidePanel): void {
  SIDE_PANELS.set(panel.id, panel);
}

/** The pane for an id, or undefined when none is registered. */
export function getSidePanel(id: string): SidePanel | undefined {
  return SIDE_PANELS.get(id);
}

/** Every registered pane, in registration (insertion) order (docs/027 §8.5). */
export function listSidePanels(): readonly SidePanel[] {
  return [...SIDE_PANELS.values()];
}

/** Drop a registration (host teardown / test cleanup), like `unregisterDataSource`. */
export function unregisterSidePanel(id: string): void {
  SIDE_PANELS.delete(id);
}
