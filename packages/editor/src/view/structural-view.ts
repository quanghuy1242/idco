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
 * Scope: this is the **view half** only. A framework-free `StructuralDefinition`
 * (core) half is deliberately NOT built yet, because no current structural type
 * needs core behavior the closed `StructuralNodeType` union does not already
 * provide: scope membership is structural-by-kind (`childrenOf` in `commands.ts`
 * treats every `kind === "structural"` node as a scope — there is no per-type
 * `isScope`), compat import/export is the dialect boundary welded to the union
 * (`compat.ts`), and callout insertion is the `insert-callout` core command.
 * Per docs/020 §4.1, "a purely-visual structural node (callout) needs only the
 * view half"; the core half lands with the first structural type that needs core
 * behavior the union can't express — the faithful table (docs/020 §11), which
 * that document already defers. Adding an unread core registry now would be dead
 * code, so it is intentionally omitted, not deferred work for the current types.
 */
import type { ReactNode } from "react";
import type {
  EditorCommand,
  EditorNode,
  EditorStore,
  NodeId,
  StructuralNode,
} from "../core";

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

/** Insert-menu affordance for a structural node (docs/020 §7.1). */
export type StructuralNodeViewInsert = {
  readonly label: string;
  readonly group?: string;
  readonly keywords?: readonly string[];
  /** lucide icon name for the insert menu item (defaults to a generic block). */
  readonly icon?: string;
  /** The command the insert menu dispatches (e.g. `{ type: "insert-callout" }`). */
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
