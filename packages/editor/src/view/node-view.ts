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
 */
export type NodeView = {
  readonly type: string;
  renderResting(args: NodeViewRestingArgs): ReactNode;
  renderLive?(args: NodeViewLiveArgs): ReactNode;
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
