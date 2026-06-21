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
import type { ReactNode, RefObject } from "react";
import {
  registerGlobalNodeDefinition,
  type BakedSnapshot,
  type JsonValue,
  type NodeDefinition,
  type NodeId,
  type ObjectNode,
  type EditorStore,
} from "../core";
import {
  registerStructuralView,
  type StructuralNodeView,
} from "./structural-view";

/** Arguments to a node's resting (baked) render. `baked` is always non-null. */
export type NodeViewRestingArgs = {
  readonly node: ObjectNode;
  readonly baked: BakedSnapshot;
};

/**
 * Arguments to a node's custom chrome control (docs/020 §7.2). A node that needs
 * an inline chrome affordance other than the default settings gear — the code
 * block's language selector — implements `renderChromeControl`; the dispatcher
 * passes the same handles it uses for the default gear so the custom control can
 * open menus (`menuOpenRef`), refocus the in-place surface (`focusInPlace`), and
 * anchor a popover (`gearRef`).
 */
export type NodeViewChromeArgs = {
  readonly node: ObjectNode;
  readonly store: EditorStore;
  readonly menuOpenRef: { current: boolean };
  readonly gearRef: RefObject<HTMLSpanElement | null>;
  readonly focusInPlace: () => void;
};

/** One field in a node's default config popover (docs/006 chrome popover). */
export type NodeViewConfigField = {
  readonly key: string;
  readonly label: string;
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
  /** lucide icon name for the insert menu item (defaults to a generic block). */
  readonly icon?: string;
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
  /**
   * Per-type metadata the dispatcher reads generically so it keeps no node-type
   * knowledge (docs/016 §10, docs/020 §5.4). Before the split these lived in
   * central maps in `object-block.tsx`; now each node carries its own.
   */
  /** Accessible base name for the block (screen readers, docs/018 §2.3). */
  readonly ariaLabel?: string;
  /** ARIA role for the block; defaults to `"group"` when omitted. */
  readonly ariaRole?: string;
  /** Floating-chrome badge icon + label. */
  readonly chromeMeta?: { readonly icon: string; readonly label: string };
  /**
   * Whether the block exposes settings chrome; defaults to `true`. A `false`
   * value hides the settings gear (divider/table have no inline config).
   */
  readonly configurable?: boolean;
  /** Fields rendered by the default config popover when `renderLive` is absent. */
  readonly configFields?: readonly NodeViewConfigField[];
  /**
   * Custom inline chrome control (the code block's language selector). When
   * present it replaces the default settings gear; when absent the dispatcher
   * renders the gear (unless `configurable` is `false`).
   */
  renderChromeControl?(args: NodeViewChromeArgs): ReactNode;
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

/**
 * The halves of a node, for the one-call registration in docs/016 §7 / docs/020
 * §4.2. An object node provides `view` (+ optional `definition`); a structural
 * container provides `structuralView`. Exactly one of `view`/`structuralView` is
 * expected per call.
 */
export type RegisterNodeArgs = {
  readonly view?: NodeView;
  readonly definition?: NodeDefinition;
  readonly structuralView?: StructuralNodeView;
};

/**
 * Register a custom node end to end (docs/016 §7, docs/020 §4.2): its `NodeView`
 * into the view registry and, when given, its `NodeDefinition` into the global
 * core registry so compat import/export and the bake service see it; or a
 * structural container's `StructuralNodeView` into the structural registry. This
 * is the single public call a feature author makes to add a node without editing
 * engine internals.
 */
export function registerNode(args: RegisterNodeArgs): void {
  // A node is either an object (`view` + optional `definition`) or a structural
  // container (`structuralView`); never both (docs/016 §7, docs/020 §4.2).
  if (args.view && args.structuralView) {
    throw new Error(
      "registerNode: pass either `view` (object) or `structuralView` (structural), not both.",
    );
  }
  if (!args.view && !args.structuralView) {
    throw new Error(
      "registerNode: one of `view` or `structuralView` is required.",
    );
  }
  // The paired halves must agree on `type` so the two registries stay keyed
  // together (the persistence/render contract depends on it, docs/016 §7/§4.2).
  if (args.definition && args.view && args.definition.type !== args.view.type) {
    throw new Error(
      `registerNode: definition.type "${args.definition.type}" !== view.type "${args.view.type}".`,
    );
  }
  if (args.definition) registerGlobalNodeDefinition(args.definition);
  if (args.view) registerNodeView(args.view);
  if (args.structuralView) registerStructuralView(args.structuralView);
}
