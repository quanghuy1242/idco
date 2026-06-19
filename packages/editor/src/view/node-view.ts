/**
 * The React half of the node SPI (docs/016 §6.2).
 *
 * A `NodeDefinition` (core, framework-free, worker-safe) owns an object's data,
 * bake, and adapters. A `NodeView` owns its React surface: the resting render of
 * its baked snapshot, the optional live-edit surface, and the optional
 * insert/format affordance. The two halves are paired by `type`; `registerNode`
 * registers both at once.
 *
 * The registry is a module-level singleton, mirroring the core
 * `BUILT_IN_OBJECT_DEFINITIONS` + global-registration pattern. The built-in views
 * register themselves when `object-block.tsx` loads; a custom node calls
 * `registerNode` once and renders without any edit to the view internals — that
 * is the whole point of the SPI (docs/016 §10).
 */
import type { ReactNode } from "react";
import {
  registerGlobalNodeDefinition,
  type BakedSnapshot,
  type JsonValue,
  type NodeDefinition,
  type NodeId,
  type ObjectNode,
  type EditorStore,
} from "../core";

/** Arguments to a node's resting (baked) render. `baked` is always non-null. */
export type NodeViewRestingArgs = {
  readonly node: ObjectNode;
  readonly baked: BakedSnapshot;
};

/** Arguments to a node's live-edit surface (mounted when it is the active object). */
export type NodeViewLiveArgs = {
  readonly node: ObjectNode;
  readonly store: EditorStore;
  readonly registerObjectEditor: (id: NodeId, mounted: boolean) => void;
  /** Resting baked height captured at activation; opens at this height (AC3). */
  readonly initialHeight: number;
};

/** Insert/format affordance metadata for the Phase 8 slash/insert menu. */
export type NodeViewInsert = {
  readonly label: string;
  readonly group?: string;
  readonly keywords?: readonly string[];
  createData(): JsonValue;
};

/**
 * The React half of one node type's contract (docs/016 §6.2).
 *
 * `renderResting` is required for a visible node. `renderLive` is optional —
 * when a definition omits it, the engine mounts the default config panel. The
 * `insert` slot is named for Phase 8 and unused today.
 *
 * TODO(virtualization seam, 011 §2.6 / docs/018 §2.11): an object that is
 * internally large (a 10,000-row grid, a 5,000-line code block) windows its own
 * internals, so its mounted DOM is only the viewport slice and a measured
 * `offsetHeight` is wrong for the engine's block-window math. When the first such
 * node is built (faithful table grid, §2.6), add the optional slots that let a
 * node *implement its half of the windowing contract*: declare a full/estimated
 * height (used instead of `offsetHeight` when self-windowing) and opt into nested
 * scroll when taller than the viewport. This fills an optional SPI slot; it does
 * not reshape the contract. Until a node needs it, the default (measure
 * `offsetHeight`) is correct.
 */
export type NodeView = {
  readonly type: string;
  renderResting(args: NodeViewRestingArgs): ReactNode;
  renderLive?(args: NodeViewLiveArgs): ReactNode;
  /**
   * How `renderLive` mounts (docs/010 §6.4): `"in-place"` replaces the baked
   * view at the captured height (code-block, no layout shift), `"popover"`
   * (default) keeps the baked view and floats the live surface in a React Aria
   * popover anchored to the block (image config, etc.).
   */
  readonly liveMode?: "in-place" | "popover";
  readonly insert?: NodeViewInsert;
};

const NODE_VIEWS = new Map<string, NodeView>();

/**
 * Register a node's React half. Idempotent by type (a re-import or HMR reload
 * replaces rather than throwing), so module-load registration of built-ins is
 * safe across test re-imports.
 */
export function registerNodeView(view: NodeView): void {
  NODE_VIEWS.set(view.type, view);
}

/** The view for a node type, or undefined → the generic baked placeholder. */
export function getNodeView(type: string): NodeView | undefined {
  return NODE_VIEWS.get(type);
}

/** Every registered node that offers an insert affordance (docs/016 §6.2, AC9). */
export function listInsertableNodes(): readonly (NodeView & {
  insert: NonNullable<NodeView["insert"]>;
})[] {
  const out: (NodeView & { insert: NonNullable<NodeView["insert"]> })[] = [];
  for (const view of NODE_VIEWS.values()) {
    if (view.insert) out.push(view as never);
  }
  return out;
}

/** Both halves of a node, for the one-call registration in docs/016 §7. */
export type RegisterNodeArgs = {
  readonly view: NodeView;
  readonly definition?: NodeDefinition;
};

/**
 * Register a custom node end to end (docs/016 §7): its `NodeView` into the view
 * registry and, when given, its `NodeDefinition` into the global core registry so
 * compat import/export and the bake service see it. This is the single public
 * call a feature author makes to add a node without editing engine internals.
 */
export function registerNode(args: RegisterNodeArgs): void {
  if (args.definition) registerGlobalNodeDefinition(args.definition);
  registerNodeView(args.view);
}
