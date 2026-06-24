/**
 * The structural-container half of the node SPI (docs/020 §4.2) — the symmetric
 * twin of the object `NodeView` (`node-view.ts`).
 *
 * A structural node owns block *children* the engine renders recursively (a
 * callout box, a list, the future table), so its contract is shaped around
 * wrapping rendered children rather than painting a baked snapshot. Before this
 * SPI, structural rendering was hardcoded `node.type === "callout"/"list"`
 * branches in `react-view.tsx` (live) and `resting-document.tsx` (resting); now
 * each structural type registers a `StructuralNodeView` and the dispatcher keeps
 * no node-type knowledge (docs/016 §10).
 *
 * Scope: this is the **view half**. Its core twin — `StructuralDefinition`
 * (`core/registry/structural-registry.ts`) — owns a structural type's insert subtree and
 * compat round-trip, so a registered type now inserts (generic `insert-structural`
 * command) and survives save/load with no per-type core branch (note §7). Both
 * halves register through the same `registerNode({ structuralView,
 * structuralDefinition })` front. Scope membership is structural-by-kind
 * (`childrenOf` treats every `kind === "structural"` node as a scope — there is no
 * per-type `isScope`). `StructuralNodeType` (`model.ts`) is the registry-driven
 * open set (docs/021 §8.1), so a registered type need not be a built-in literal.
 * `quote`/`list`/`listitem` keep hardcoded compat branches until migrated.
 */
import type { ReactNode, RefObject } from "react";
import type {
  EditorCommand,
  EditorNode,
  EditorStore,
  NodeId,
  StructuralNode,
} from "../../core";
import type { Command, CommandContext } from "./command-registry";

/** Arguments to a structural node's live (editing) container render. */
export type StructuralContainerArgs = {
  readonly node: StructuralNode;
  readonly store: EditorStore;
  /** Bind the measured container element to the engine's block registry. */
  readonly registerBlock: (id: NodeId, element: HTMLElement | null) => void;
  /** The already-rendered block children (EngineBlock recursed with list meta). */
  readonly children: ReactNode;
};

/**
 * Arguments to a structural node's resting (publish) container render. The
 * resting recursion engine lives in `resting-document.tsx`; it injects the two
 * child-rendering strategies a container may need so a view composes its children
 * without importing the engine (which would cycle):
 * - `renderSequence` wraps consecutive flat `listitem` leaves into real
 *   `<ul>`/`<ol>` runs (docs/018 §2.10) — the strategy a callout/quote uses.
 * - `renderListItems` renders each child as a resting `<li>` — the strategy a
 *   `list` container uses (its own `<ul>`/`<ol>` already wraps them).
 */
export type StructuralRestingArgs = {
  readonly node: StructuralNode;
  readonly children: readonly EditorNode[];
  readonly renderSequence: (nodes: readonly EditorNode[]) => ReactNode;
  readonly renderListItems: (nodes: readonly EditorNode[]) => ReactNode;
};

/**
 * Arguments to a structural node's view-level overlay render (docs/020 §4.2,
 * note.md W1). An overlay is a single floating surface that serves every instance
 * of its type at once — a portal with its own global pointer listeners — rather
 * than a per-block element. The table's hover controls and cell-selection layer
 * are the first consumer (docs/022 §6/§7): one overlay scans the surface for every
 * table, so it is mounted once, not per node. `rootRef` is the element the overlay
 * anchors and measures within (the scroller content when virtualized, the surface
 * root otherwise), so geometry stays correct under virtualization.
 */
export type StructuralOverlayArgs = {
  readonly store: EditorStore;
  readonly rootRef: RefObject<HTMLElement | null>;
};

/** Insert-menu affordance for a structural node (docs/020 §7.1). */
export type StructuralNodeViewInsert = {
  readonly label: string;
  readonly group?: string;
  readonly keywords?: readonly string[];
  /** lucide icon name for the insert menu item (defaults to a generic block). */
  readonly icon?: string;
  /**
   * The command the insert menu dispatches — the generic
   * `{ type: "insert-structural", structuralType }` for a registered structural
   * core (note §7).
   */
  createCommand(): EditorCommand;
};

/**
 * The React half of one structural type's contract (docs/020 §4.2). Both the
 * live `renderContainer` and the resting `renderResting` live in the same node
 * file so they cannot drift (docs/020 §3.7 Finding E). `renderResting` is
 * required: a registered structural view is one with non-default rendering, and
 * the resting projection must match the editor surface.
 */
export type StructuralNodeView = {
  readonly type: string;
  renderContainer(args: StructuralContainerArgs): ReactNode;
  renderResting(args: StructuralRestingArgs): ReactNode;
  readonly insert?: StructuralNodeViewInsert;
  /**
   * The schema group this container belongs to for the per-deployment schema profile
   * (note.md item 6) — the structural twin of `NodeView.schemaGroup`. The whole table
   * family (`table`/`table-row`/`table-cell`) shares one group so a profile toggles the
   * family coherently; a quarantined container renders an inert placeholder without
   * recursing into its children, so no orphan rows/cells leak through (block-dispatch).
   * Omit it for a container that is always permitted (lists, quote — the prose floor).
   */
  readonly schemaGroup?: string;
  /**
   * The caret/gap ink to use when the caret sits inside this node, or undefined
   * to defer to an ancestor / the theme default (docs/022 §7). The engine paints
   * its own caret, so CSS `caret-color` cannot reach it; a container that paints
   * a surface (a cell's `backgroundColor`) returns the auto-contrast ink here so
   * the caret stays legible on it. Generic: the overlay walks ancestors and asks
   * each registered view, keeping no per-type knowledge of its own.
   */
  caretInk?(node: StructuralNode): string | undefined;
  /**
   * A view-level overlay mounted once for this type, regardless of how many
   * instances exist (docs/020 §4.2, note.md W1). The engine's view orchestrator
   * enumerates every registered overlay and mounts it inside the surface, so a
   * feature's floating chrome (the table's hover controls) no longer has to be
   * hardcoded into `react-view`. Omit it for a node with no overlay.
   */
  renderOverlay?(args: StructuralOverlayArgs): ReactNode;
  /**
   * Claim the Tab / Shift-Tab key when the caret sits inside this container
   * (note.md VP6/VF3). Return `true` if this container handled the key, `false`
   * to let the editor fall back to the default indent/outdent. The generic text
   * surface enumerates every registered handler (`listTabHandlers`) and lets each
   * self-check whether the caret is in its own container — so the surface keeps no
   * per-type knowledge, the same way `caretInk`/`renderOverlay` do. The table is
   * the first consumer (Tab walks cells, docs/022 §5); before this slot the table
   * check was hardcoded into `text-block`. `forward` is true for Tab, false for
   * Shift-Tab. Omit it for a container with no Tab behavior.
   */
  handleTab?(args: StructuralTabArgs): boolean;
  /**
   * Contribute scope-specific commands when the caret/selection sits inside this
   * container (docs/024 §5.3/§7.4). The command surfaces enumerate the enclosing
   * `scopePath` (`resolveCommandList`) and call this on each container, so a table
   * cell contributes merge/fill/align and a table contributes insert/delete
   * row+column + header toggles — folding the old bespoke table overlay menus
   * (`table-interactions`/`table-controls`) into the one model, the same inversion
   * `renderOverlay`/`handleTab`/`caretInk` use. Return plain `Command` descriptors
   * tagged with the surfaces + group they belong to; a contributor must never call
   * `resolveCommandList` itself (docs/024 §9). Omit for a container with no commands.
   */
  contributeCommands?(ctx: CommandContext): readonly Command[];
};

/** Arguments to a structural node's Tab-key handler (note.md VP6). */
export type StructuralTabArgs = {
  readonly store: EditorStore;
  readonly forward: boolean;
};

const STRUCTURAL_VIEWS = new Map<string, StructuralNodeView>();

/**
 * Register a structural node's React half. Idempotent by type (a re-import or
 * HMR reload replaces rather than throwing), mirroring `registerNodeView`.
 */
export function registerStructuralView(view: StructuralNodeView): void {
  STRUCTURAL_VIEWS.set(view.type, view);
}

/**
 * The structural view for a type, or undefined → the default stacking container
 * (the live `DefaultStructuralContainer` / the resting generic `<div>`). Quote,
 * structural list-item, and the body root use the default; only callout and list
 * have non-default rendering, so they are the only registered structural views.
 */
export function getStructuralView(
  type: string,
): StructuralNodeView | undefined {
  return STRUCTURAL_VIEWS.get(type);
}

/** Every registered structural node that offers an insert affordance. */
export function listInsertableStructuralNodes(): readonly (StructuralNodeView & {
  insert: NonNullable<StructuralNodeView["insert"]>;
})[] {
  const out: (StructuralNodeView & {
    insert: NonNullable<StructuralNodeView["insert"]>;
  })[] = [];
  for (const view of STRUCTURAL_VIEWS.values()) {
    if (view.insert) out.push(view as never);
  }
  return out;
}

/** Every registered structural node that mounts a view-level overlay (W1). */
export function listOverlayStructuralViews(): readonly (StructuralNodeView & {
  renderOverlay: NonNullable<StructuralNodeView["renderOverlay"]>;
})[] {
  const out: (StructuralNodeView & {
    renderOverlay: NonNullable<StructuralNodeView["renderOverlay"]>;
  })[] = [];
  for (const view of STRUCTURAL_VIEWS.values()) {
    if (view.renderOverlay) out.push(view as never);
  }
  return out;
}

/**
 * Every registered structural node that claims the Tab key (note.md VP6). The
 * text surface tries each in registration order, first `true` wins; if none
 * claims it, the editor indents/outdents. Each handler self-checks whether the
 * caret is in its container, so this stays orchestrator-internal and per-type
 * knowledge never leaks into the generic surface.
 */
export function listTabHandlers(): readonly (StructuralNodeView & {
  handleTab: NonNullable<StructuralNodeView["handleTab"]>;
})[] {
  const out: (StructuralNodeView & {
    handleTab: NonNullable<StructuralNodeView["handleTab"]>;
  })[] = [];
  for (const view of STRUCTURAL_VIEWS.values()) {
    if (view.handleTab) out.push(view as never);
  }
  return out;
}
