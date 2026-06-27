/**
 * Runtime store and transaction dispatcher for the owned-model editor.
 *
 * Why this file exists
 * --------------------
 * `model.ts` defines immutable node objects and JSON snapshot shapes. This file
 * owns the live runtime container: one mutable `Map<NodeId, EditorNode>`, the
 * top-level body order, the reverse `parentOf` index, model selection, inverse
 * step history, and per-slice subscribers.
 *
 * The performance/architecture trade:
 *
 * - The Map is mutated in place so a keystroke never clones the whole document.
 * - A changed node is replaced by a frozen object, so subscribers can compare
 *   node identity and untouched siblings remain referentially stable.
 * - All mutation goes through `dispatch`; this is the only place that applies
 *   steps, captures inverses, remaps selection, updates `parentOf`, records
 *   history, and notifies subscribers.
 *
 * Runtime flow:
 *
 *   command code -> TransactionBuilder -> TransactionDraft
 *   TransactionDraft -> dispatch
 *   dispatch -> apply steps + derive inverse -> remap selection
 *   dispatch -> record history -> notify touched node/order/settings/selection
 *
 * There is intentionally no React, DOM, Lexical, or rendering code here.
 *
 * @categoryDefault Engine Core — Store
 */
import {
  freezeNode,
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  replaceTextContent,
  resolvePointOffset,
  selectionsEqual,
  sliceTextContent,
  type CollectionItem,
  type DocumentSettings,
  type EditorDocumentSnapshot,
  type EditorNode,
  type EditorSelection,
  type IdAllocator,
  type JsonValue,
  type NodeId,
  type ObjectNode,
  type ObjectNodeStatus,
  type ParentEntry,
  type StructuralNode,
  type TextLeafNode,
  type TextLeafType,
  type TextMark,
  type TextMarkKind,
  type TextPoint,
  type TextSlice,
} from "../model";
import { safeHref } from "../url-safety";
import {
  compileCommand,
  runQuery,
  type EditorCommand,
  type EditorQuery,
} from "../commands";
import {
  Mapping,
  type MapBias,
  type MapPos,
  type PointRedirect,
} from "../model";
import { createDefaultBlockRegistry, type BlockRegistry } from "../registry";
import { bakeObjectData } from "../bake";
import {
  cloneAttrsWithValue,
  type AddMarkStep,
  type CommittedTransaction,
  type InsertNodeStep,
  type MoveNodeStep,
  type RemoveMarkStep,
  type RemoveNodeStep,
  type ReplaceTextStep,
  type SetNodeAttrStep,
  type SetNodeTypeStep,
  type SetCollectionStep,
  type SetObjectDataStep,
  type SetSettingsStep,
  type Step,
  type StoreDirty,
  type TransactionDraft,
} from "../model";
import { marksCoveringCaret } from "./history";
import { HistoryPool, type HistoryConfig } from "./history-pool";
import { createInMemoryBodyStore, type BodyStore } from "./body-store";
import { MemoryArbiter, type MemoryArbiterOptions } from "../memory/pool";
import { isDevInvariantsEnabled } from "../dev-flags";
import {
  bakedSnapshot,
  canSkipActiveTextNotify,
  collectSubtree,
  compareNumberArrays,
  mapSelection,
  marksIntersectingRange,
  mergeMarksById,
  normalizeMarks,
  remapMarksForReplace,
  sign,
  withAttrs,
} from "./mapping-helpers";

/** The fixed NodeId of the document root that holds the top-level body order. */
export const ROOT_NODE_ID = "idco_node_root" as NodeId;

/**
 * A per-deployment schema profile (note.md item 6): the allowlist of schema *groups*
 * this deployment permits (a "blog profile" vs a "book profile"). The store holds it
 * as opaque transport and never interprets the group strings — group membership is a
 * view concern, resolved against the node registries by `isNodeTypeAllowed`
 * (view/spi/schema-profile.ts), which gates the insert palette and renders an
 * out-of-profile node as an inert, preserved quarantine placeholder rather than
 * deleting it (lossless; the server's Zod union stays the hard authority on write).
 * `undefined` (or `allowedGroups` omitted) permits every node — the backward-compatible
 * default, so an editor with no profile behaves exactly as before.
 *
 * @category Schema Profile
 */
export type SchemaProfile = {
  /**
   * Allowlisted schema-group ids. A node whose type maps to a group not in this list
   * is quarantined; an *ungrouped* node type (the prose floor — paragraph/heading/
   * quote/list, and any node that declares no group) is always permitted.
   */
  readonly allowedGroups?: readonly string[];
};

/** Construction options for an editor store: the id allocator, an optional starting snapshot/selection, the object registry, and the schema/memory/history/cold-store knobs. */
export type EditorStoreOptions = {
  readonly allocator: IdAllocator;
  readonly snapshot?: EditorDocumentSnapshot;
  readonly selection?: EditorSelection | null;
  /** Object-block registry; used to re-bake objects on edit. Defaults to built-ins. */
  readonly registry?: BlockRegistry;
  /** Per-deployment schema profile (note.md item 6); permits everything when omitted. */
  readonly schemaProfile?: SchemaProfile;
  /**
   * Overall soft memory budget (docs/030 §7.6 D6, SLP-4). Omitted/`Infinity` keeps
   * today's unbounded behavior — the arbiter is inert until a host sets a finite budget
   * calibrated to measured RSS. `highWater`/`lowWater` tune the eviction hysteresis.
   */
  readonly memoryBudget?: MemoryArbiterOptions;
  /**
   * Undo budget (docs/030 §7.6 Stage three): cap the inverse-step stacks by depth and/or
   * bytes, evicting the oldest. `overflow: "drop"` (default) forgets deep undo past the
   * cap; `"cold-store"` pages it out and faults it back. Omitted = unbounded undo.
   */
  readonly history?: HistoryConfig;
  /**
   * Injected cold store for purged node bodies (docs/030 §7.6 D6 Stage two, SLP-4). The
   * in-memory default serves tests and today's behavior; the view layer supplies an
   * IndexedDB implementation for durable, larger-than-heap paging. Held for the
   * skeleton/body pager (the "larger, later" follow-on); the seam is defined now so the
   * first cut does not paint it into a corner.
   */
  readonly bodyStore?: BodyStore;
};

/**
 * The active IME composition (preedit) range on one text leaf, in model offsets.
 * Runtime view state, not document content: it drives the engine-painted preedit
 * underline (docs/010 Phase 7 AC5) and is cleared on `compositionend`.
 */
export type CompositionRange = {
  readonly node: NodeId;
  readonly from: number;
  readonly to: number;
};

/**
 * The collapsed-caret pending format (docs/018 §2.0). Toggling bold/italic/link
 * with no selection is not a no-op: it records the desired format here, anchored
 * to the caret, and the next typed character inherits it. `marks` is the desired
 * active format-mark set at the caret (seeded from the marks covering it, so
 * toggling inside a bold run turns bold *off* for the next character); `link` is
 * a pending link applied to the next typed run. Runtime view state, never a
 * document step: it is dropped the moment the caret moves without typing.
 */
export type PendingFormat = {
  readonly node: NodeId;
  readonly offset: number;
  readonly marks: ReadonlySet<TextMarkKind>;
  readonly link?: { readonly href: string } | null;
};

/** Callback notified on every store change with the set of dirty slices that changed. */
export type EditorSubscriber = (dirty: StoreDirty) => void;

/** Callback notified once per committed transaction with the transaction that landed. */
export type EditorCommitSubscriber = (committed: CommittedTransaction) => void;

type MutableDispatchState = {
  readonly touched: Set<NodeId>;
  /**
   * For each applied `remove-node` step, the full set of node ids it removed
   * (the subtree, not just the top node). `mapSelection` runs after the steps
   * mutate the store, so a removed subtree is gone and cannot be walked; this is
   * how the remap learns a caret/selection landed deep inside a removed container
   * (e.g. a table cell whose row is deleted) and relocates it (docs/021 §8.2).
   * Keyed per step so a multi-remove transaction (a table column delete) relocates
   * each caret against the step that removed *its* ancestor.
   */
  readonly removedByStep: Map<Step, ReadonlySet<NodeId>>;
  settingsChanged: boolean;
  structureChanged: boolean;
  /** A `set-collection` step ran; drives the commit's collections-changed flag. */
  collectionsChanged: boolean;
};

/**
 * Side-effect-free transaction builder.
 *
 * Commands accumulate steps here and only mutate the store once `dispatch`
 * applies the transaction. New ids are allocated by commands/builders, not by
 * apply, so later steps in a composite command can reference them deterministically.
 */
export class TransactionBuilder {
  readonly #allocator: IdAllocator;
  readonly #steps: Step[] = [];
  readonly #mapping = new Mapping();
  #selectionAfter: EditorSelection | undefined;

  constructor(allocator: IdAllocator) {
    this.#allocator = allocator;
  }

  get steps(): readonly Step[] {
    return this.#steps;
  }

  get allocator(): IdAllocator {
    return this.#allocator;
  }

  replaceText(args: {
    readonly node: NodeId;
    readonly at: number;
    readonly removed: string;
    readonly inserted: string;
  }): this {
    return this.push({
      at: args.at,
      inserted: this.#allocator.createTextSlice(args.inserted),
      node: args.node,
      removed: { runs: [], text: args.removed },
      type: "replace-text",
    });
  }

  /**
   * Replace text with an already-formed inserted slice, preserving its
   * character ids. Split and merge move existing content between leaves and must
   * keep its ids (docs/011 §13.9), which `replaceText` cannot do because it
   * mints fresh ids for the inserted string.
   */
  spliceText(args: {
    readonly node: NodeId;
    readonly at: number;
    readonly removed: string;
    readonly inserted: TextSlice;
  }): this {
    return this.push({
      at: args.at,
      inserted: args.inserted,
      node: args.node,
      removed: { runs: [], text: args.removed },
      type: "replace-text",
    });
  }

  push(step: Step): this {
    this.#steps.push(step);
    this.#mapping.append(step);
    return this;
  }

  insertNode(parent: NodeId, index: number, node: EditorNode): this {
    return this.push({ index, node, parent, type: "insert-node" });
  }

  removeNode(parent: NodeId, index: number, node: EditorNode): this {
    return this.push({ index, node, parent, type: "remove-node" });
  }

  setObjectData(step: Omit<SetObjectDataStep, "type">): this {
    return this.push({ ...step, type: "set-object-data" });
  }

  /**
   * Replace a document-owned collection's whole item array (docs/027 §5.3). `from`
   * is captured by dispatch from live state for the inverse, so a caller passes only
   * the next array. Composing this with `addMark` in one builder is the type-first
   * glossary flow: one atomic transaction, one undo for both halves (§5.3).
   */
  setCollection(collection: string, items: readonly CollectionItem[]): this {
    return this.push({
      collection,
      from: [],
      to: items,
      type: "set-collection",
    });
  }

  addMark(node: NodeId, mark: TextMark): this {
    return this.push({ mark, node, type: "add-mark" });
  }

  removeMark(node: NodeId, mark: TextMark): this {
    return this.push({ mark, node, type: "remove-mark" });
  }

  setSelection(selection: EditorSelection): this {
    this.#selectionAfter = selection;
    return this;
  }

  /** Register an explicit position redirect for minted/absorbed ids (§16). */
  redirect(redirect: PointRedirect): this {
    this.#mapping.redirect(redirect);
    return this;
  }

  /** Map a pre-edit position through the steps pushed so far (§6.10). */
  mapPos(pos: MapPos, bias: MapBias = 1): MapPos | null {
    return this.#mapping.mapPos(pos, bias);
  }

  build(): TransactionDraft {
    return {
      origin: "local",
      selectionAfter: this.#selectionAfter,
      steps: [...this.#steps],
    };
  }
}

/**
 * Mutable owned-model store with immutable node objects.
 *
 * The Map is mutated in place for hot-path scale, but each changed node is
 * replaced by a frozen object. Subscribers can therefore use node object
 * identity without cloning the whole document on every keystroke.
 */
export class EditorStore {
  readonly #allocator: IdAllocator;
  readonly #registry: BlockRegistry;
  // Undo/redo history as a budgeted pool (docs/030 §7.6 Stage three): owns the done/undone
  // stacks, the typing-coalesce bookkeeping, and the depth/byte cap. Registered with the
  // memory arbiter below.
  readonly #history: HistoryPool;
  // The memory budget arbiter (docs/030 §7.6 D6, SLP-4): caps the summed bytes of its
  // registered pools (history here; the view registers the bake cache; the body pool lands
  // with paging) and rebalances under pressure. Inert until a finite `memoryBudget` is set.
  readonly #arbiter: MemoryArbiter;
  // The injected cold store for purged bodies (docs/030 §7.6 Stage two). Held for the
  // skeleton/body pager follow-on; the in-memory default keeps `core/**` framework-free.
  readonly #bodyStore: BodyStore;
  readonly #nodeSubscribers = new Map<NodeId, Set<EditorSubscriber>>();
  readonly #orderSubscribers = new Set<EditorSubscriber>();
  readonly #settingsSubscribers = new Set<EditorSubscriber>();
  readonly #selectionSubscribers = new Set<EditorSubscriber>();
  readonly #commitSubscribers = new Set<EditorCommitSubscriber>();
  readonly #nodes = new Map<NodeId, EditorNode>();
  readonly #parentOf = new Map<NodeId, ParentEntry>();
  #activeTextLeafId: NodeId | null = null;
  #activeTextLeafSnapshot: TextLeafNode | null = null;
  #activeLeafDomSynced = false;
  #activeObjectId: NodeId | null = null;
  // The id of a reference block inserted choose-first and awaiting its first pick
  // (docs/026 §7.1). If it is dismissed before a record is picked, deactivation
  // rolls the insert back so a cancelled insert leaves no orphan.
  #provisionalInsertId: NodeId | null = null;
  #composition: CompositionRange | null = null;
  readonly #activeObjectSubscribers = new Set<() => void>();
  // Focus-reclaim gate (docs/029 §7.1, R1-B). The editor aggressively reclaims DOM
  // focus to serve the model selection — `focusSelectionSoon` (the per-leaf EditContext
  // host re-grab, text-block.tsx), the focus-navigation `syncFocusToSelection`, and the
  // host `focus()` (`focusEditor`). A focus-*taking* overlay (a link/glossary/comment
  // form) must hold focus against that reclaim, or its field loses focus the instant the
  // editor re-grabs (the "focus steal" class, commits 4ee6d7d/2bbefc7). The overlay
  // authority suspends the reclaim while a taking surface owns focus and resumes it on
  // dismissal; the view auto-refocus paths consult `isReclaimSuspended()` before grabbing
  // focus. This is the view→core seam (docs/029 §7.1): core never learns *why* it is
  // suspended — only that it must not auto-grab — so the dependency points the right way
  // (view drives a neutral core flag; core does not import view policy). A counter, not a
  // boolean, so a drill-in pushed over another taking level each balances its own
  // suspend/resume and an inner resume does not prematurely re-enable the reclaim.
  #reclaimSuspendCount = 0;
  #order: NodeId[] = [];
  #selection: EditorSelection | null;
  #settings: DocumentSettings = {};
  // The per-deployment schema profile (note.md item 6). Held opaquely: the store never
  // reads the group strings — the view layer resolves type→group and gates on it.
  #schemaProfile: SchemaProfile | undefined;
  // Document-owned collections (docs/027 §5.1): keyed item arrays (glossary terms,
  // later citations). Mutated only through the `set-collection` step, so every edit is
  // undoable in the same history stack as text and serializes with the document.
  #collections: Record<string, readonly CollectionItem[]> = {};
  #pendingFormat: PendingFormat | null = null;
  #markCounter = 0;
  // The incrementally-maintained persisted block map (docs/030 §7.4 D4, SLP-1). Kept in
  // lockstep with `#nodes` (minus ROOT) so `toSnapshot()` is O(changed) instead of
  // rebuilding the whole map each save. `#snapshotBlocksPublished` drives copy-on-write:
  // once `toSnapshot()` has returned this object, the next mutation clones it so a snapshot
  // a caller is still holding is never mutated underneath it.
  #snapshotBlocks: Record<NodeId, EditorNode> = {};
  #snapshotBlocksPublished = false;

  constructor(options: EditorStoreOptions) {
    /*
     * Snapshots persist only real document nodes. The synthetic root is runtime
     * infrastructure: it gives body order the same parent-index machinery as
     * nested structural nodes without being serialized as a user block.
     */
    this.#allocator = options.allocator;
    this.#registry = options.registry ?? createDefaultBlockRegistry();
    this.#selection = options.selection ?? null;
    this.#schemaProfile = options.schemaProfile;
    this.#history = new HistoryPool(options.history);
    this.#bodyStore = options.bodyStore ?? createInMemoryBodyStore();
    this.#arbiter = new MemoryArbiter(options.memoryBudget);
    // History is the one always-present elastic pool the core owns; the view registers the
    // bake cache (and, later, the resident-body pool) via `memoryArbiter`.
    this.#arbiter.register(this.#history);
    const root = makeStructuralNode({
      children: options.snapshot?.body.order ?? [],
      id: ROOT_NODE_ID,
      type: "body",
    });
    this.#nodes.set(ROOT_NODE_ID, root);
    if (options.snapshot) {
      this.#settings = options.snapshot.settings;
      // Single-pass ingest (docs/030 §7.5 D5, SLP-2). Two costs the old load paid before
      // first paint are dev-only tripwires gated off in production: `freezeNode`
      // self-gates (model.ts), and `assertParentInvariant` is skipped below. The third
      // pass — the separate `#rebuildParentIndex` tree walk — is *folded into this ingest*:
      // every child's parent entry is exactly its parent's `children` index, and this loop
      // already visits every structural parent, so we set parent entries here instead of
      // re-walking the tree. ROOT's children (the body order) are indexed just after.
      // Difference from the old root-down `#rebuildParentIndex`: that walked only nodes
      // reachable from ROOT, so a malformed snapshot with an orphan structural subtree got
      // no entries for it; this loop indexes every structural node's children regardless of
      // reachability. `assertParentInvariant` (dev) still catches the orphan; in production a
      // snapshot's structural validity is a host invariant, and an unreachable node never
      // enters `#order`-driven traversal, so the extra entries are inert.
      for (const node of Object.values(options.snapshot.body.blocks)) {
        const frozen = freezeNode(node);
        this.#nodes.set(node.id, frozen);
        this.#snapshotBlocks[node.id] = frozen;
        if (node.kind === "structural") {
          node.children.forEach((childId, index) =>
            this.#parentOf.set(childId, { index, parent: node.id }),
          );
        }
      }
      this.#order = [...options.snapshot.body.order];
      this.#order.forEach((childId, index) =>
        this.#parentOf.set(childId, { index, parent: ROOT_NODE_ID }),
      );
      // Ingest document-owned collections (docs/027 §5.4); plain JSON, so it rides
      // the existing snapshot transport with no special handling.
      if (options.snapshot.collections) {
        this.#collections = { ...options.snapshot.collections };
      }
    }
    // Validate the folded parent index only in dev/test; in production the build above is
    // authoritative and the walk is pure overhead (docs/030 §7.5).
    if (isDevInvariantsEnabled()) this.assertParentInvariant();
  }

  get allocator(): IdAllocator {
    return this.#allocator;
  }

  /** Object-block registry; the bake source for object edits. */
  get registry(): BlockRegistry {
    return this.#registry;
  }

  /**
   * The memory budget arbiter (docs/030 §7.6 D6, SLP-4). The view registers its bake cache
   * (and, later, the resident-body pool) here so they share one soft ceiling with history.
   */
  get memoryArbiter(): MemoryArbiter {
    return this.#arbiter;
  }

  /**
   * The injected cold store for purged bodies (docs/030 §7.6 Stage two). Exposed for the
   * skeleton/body pager follow-on; unused by the resident-everything path today.
   */
  get bodyStore(): BodyStore {
    return this.#bodyStore;
  }

  get selection(): EditorSelection | null {
    return this.#selection;
  }

  get activeTextLeafId(): NodeId | null {
    return this.#activeTextLeafId;
  }

  /** The single heavy object in live-edit mode, or null when all rest baked. */
  get activeObjectId(): NodeId | null {
    return this.#activeObjectId;
  }

  get settings(): DocumentSettings {
    return this.#settings;
  }

  /**
   * The per-deployment schema profile (note.md item 6), or undefined when the
   * deployment permits every node. Read by the view's palette gate and quarantine
   * render through `isNodeTypeAllowed`; the store itself never interprets it.
   */
  get schemaProfile(): SchemaProfile | undefined {
    return this.#schemaProfile;
  }

  /** Every document-owned collection, keyed by id (docs/027 §5.1). */
  get collections(): Readonly<Record<string, readonly CollectionItem[]>> {
    return this.#collections;
  }

  /** One collection's items by id, or an empty array when none exists. */
  getCollection(id: string): readonly CollectionItem[] {
    return this.#collections[id] ?? [];
  }

  get order(): readonly NodeId[] {
    return this.#order;
  }

  /** The body root node id (top-level container). */
  get bodyId(): NodeId {
    return ROOT_NODE_ID;
  }

  getNode(id: NodeId): EditorNode | undefined {
    return this.#nodes.get(id);
  }

  requireNode(id: NodeId): EditorNode {
    const node = this.getNode(id);
    if (!node) throw new Error(`Unknown node: ${id}`);
    return node;
  }

  getViewNode(id: NodeId): EditorNode | undefined {
    /*
     * React reads through this method, not `getNode`, so the active text leaf can
     * keep returning the same frozen snapshot while the store's live node changes
     * on each keystroke. That is the hot-path split from docs/011: the model is
     * current immediately, but React does not reconcile the active paragraph just
     * to show the character the input controller already patched into the DOM.
     */
    if (id === this.#activeTextLeafId && this.#activeTextLeafSnapshot) {
      return this.#activeTextLeafSnapshot;
    }
    return this.getNode(id);
  }

  requireViewNode(id: NodeId): EditorNode {
    const node = this.getViewNode(id);
    if (!node) throw new Error(`Unknown node: ${id}`);
    return node;
  }

  requireTextNode(id: NodeId): TextLeafNode {
    const node = this.requireNode(id);
    if (node.kind !== "text") throw new Error(`Node is not a text leaf: ${id}`);
    return node;
  }

  transaction(): TransactionBuilder {
    return new TransactionBuilder(this.#allocator);
  }

  activateTextLeaf(id: NodeId): void {
    if (this.#activeTextLeafId && this.#activeTextLeafId !== id) {
      this.deactivateTextLeaf();
    }
    const node = this.requireTextNode(id);
    this.#activeTextLeafId = id;
    this.#activeTextLeafSnapshot = node;
  }

  /**
   * The input controller calls this after it has patched the active leaf's DOM
   * text itself (the `textupdate` fast path), authorizing the next commit to
   * skip re-rendering that leaf. Any commit not preceded by this re-renders the
   * leaf, so command-driven text edits stay visible.
   */
  markActiveLeafDomSynced(): void {
    this.#activeLeafDomSynced = true;
  }

  deactivateTextLeaf(id?: NodeId): void {
    if (id && this.#activeTextLeafId !== id) return;
    const active = this.#activeTextLeafId;
    const snapshot = this.#activeTextLeafSnapshot;
    this.#activeTextLeafId = null;
    this.#activeTextLeafSnapshot = null;
    /*
     * Deactivation is the moment React should catch up to the live model if the
     * active leaf skipped text-edit notifications. Without this notify, a block
     * could keep showing the pinned pre-edit snapshot after the controller unbinds.
     */
    if (active && snapshot && this.getNode(active) !== snapshot) {
      this.#notify({
        nodes: new Set([active]),
        selection: false,
        settings: false,
        structure: false,
      });
    }
  }

  /**
   * Enter live-edit on one heavy object (docs/010 §5.3, §6.4). The slot is
   * capped at one: activating B while A is live deactivates A first, so the
   * document never holds two live objects. Activation also suspends the text
   * caret — the active text leaf unbinds and the model selection collapses to a
   * node selection over the object — so an in-flight composition is ended on the
   * leaf, not stranded (Phase 6 AC5). Activation is runtime view state, not a
   * document step, so it never enters history.
   */
  activateObject(id: NodeId): void {
    const node = this.requireNode(id);
    if (node.kind !== "object") throw new Error(`Node is not an object: ${id}`);
    if (this.#activeObjectId === id) return;
    // Object activation is a hard undo boundary (docs/011 §7.5).
    this.breakUndoCoalescing();
    if (this.#activeObjectId) this.deactivateObject();
    // Suspend the text caret: unbind the active leaf and select the object as one
    // atomic unit (block-atomic selection, docs/010 §6.5).
    if (this.#activeTextLeafId) this.deactivateTextLeaf();
    this.#activeObjectId = id;
    if (this.#selection?.type !== "node" || this.#selection.node !== id) {
      this.dispatch({
        origin: "local",
        selectionAfter: { node: id, type: "node" },
        steps: [],
      });
    }
    this.#notifyActiveObject();
  }

  /**
   * Insert a reference block choose-first (docs/026 §7.1): the caller has already
   * inserted the node (a recorded transaction, so undo removes it); this opens its
   * picker immediately and marks it provisional so a dismissal before the first
   * pick rolls the insert back. Tracking lives here because deactivation is the one
   * choke point where "the object was left without picking" is observable.
   */
  beginProvisionalInsert(id: NodeId): void {
    this.#provisionalInsertId = id;
    this.activateObject(id);
  }

  /** Leave live-edit; the object re-bakes to its resting snapshot (AC2/AC5). */
  deactivateObject(id?: NodeId): void {
    if (id && this.#activeObjectId !== id) return;
    if (!this.#activeObjectId) return;
    const closing = this.#activeObjectId;
    this.#activeObjectId = null;
    // Choose-first rollback (docs/026 §7.1): a provisional reference block dismissed
    // before a record is picked (its `ref` still empty) is removed via undo — the
    // insert is the top history entry (activation and the on-mount resolve are
    // non-historic), so its inverse cleanly removes the node and a cancelled insert
    // leaves no orphan. A block that did pick keeps its committed insert entry.
    if (closing === this.#provisionalInsertId) {
      this.#provisionalInsertId = null;
      const node = this.getNode(closing);
      if (
        node?.kind === "object" &&
        this.#isEmptyReference(node) &&
        this.canUndo
      ) {
        this.undo();
      }
    }
    this.#notifyActiveObject();
  }

  /**
   * Suspend the editor's automatic focus reclaim (docs/029 §7.1, R1-B). The overlay
   * authority calls this when a focus-taking surface opens, so the surface's field keeps
   * DOM focus instead of losing it to `focusSelectionSoon`/`syncFocusToSelection`/the host
   * `focus()`. Balanced by `resumeReclaim`; nesting-safe via a counter so a drill-in over a
   * drill-in suspends twice and resumes twice. Core does not act on focus itself — it only
   * holds the flag the view paths read, keeping the view→core dependency one-directional.
   */
  suspendReclaim(): void {
    this.#reclaimSuspendCount += 1;
  }

  /**
   * Resume the automatic focus reclaim (docs/029 §7.1). Clamped at zero so an unbalanced
   * resume cannot drive the counter negative and leave the reclaim permanently extra-on;
   * the worst an unbalanced resume can do is no-op.
   */
  resumeReclaim(): void {
    if (this.#reclaimSuspendCount > 0) this.#reclaimSuspendCount -= 1;
  }

  /**
   * Whether the automatic focus reclaim is currently suspended (docs/029 §7.1). The view
   * auto-refocus paths (`focusSelectionSoon`, `syncFocusToSelection`, `focusEditor`)
   * consult this and skip the grab when it is true, so a focus-taking overlay is not
   * fought for focus. False whenever no taking surface is open (the default), so the
   * editor's normal focus-follows-caret behavior is unchanged.
   */
  isReclaimSuspended(): boolean {
    return this.#reclaimSuspendCount > 0;
  }

  /** True when an object's data is a reference projection with no picked ref yet. */
  #isEmptyReference(node: ObjectNode): boolean {
    const data = node.data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return false;
    }
    const ref = (data as { readonly ref?: JsonValue }).ref;
    return ref === "";
  }

  /**
   * Apply a resolve-driven update to a reference object — a fresh snapshot and/or
   * a status transition — WITHOUT recording undo history (docs/026 §7.2/§14.6).
   * Revalidation and the unresolved/invalid lifecycle are derived state, not user
   * edits: undo must not step through a background refresh, and a virtualization
   * remount must not push a transaction. The new `data` is baked here (so the
   * resting snapshot stays in sync), but `status` is taken from the caller, not
   * from the bake — this is the one place the engine overrides the bake-derived
   * status with the resolve lifecycle (§7.5), so an empty reference reads
   * `unresolved` and a failed refresh reads `invalid` even though the post-ref
   * baker always succeeds. No-ops when data, bake, and status are all unchanged,
   * so the resolve controller can call it on every mount idempotently.
   */
  resolveObject(node: NodeId, data: JsonValue, status: ObjectNodeStatus): void {
    const current = this.getNode(node);
    if (!current || current.kind !== "object") return;
    // Fast idempotent guard (note.md §7 P3). The resolve controller calls this on
    // *every* virtualization remount (use-resolve.ts), and the hot remount paths —
    // an unpicked reference (`ref === ""`) and a browse-only source — pass back the
    // node's own data object *by reference* (`currentObjectRecord` returns
    // `node.data` itself). When the data is reference-identical and the status is
    // unchanged, the bake is a pure function of (registry, type, data), so it
    // cannot change `baked` either: nothing can transition, so skip the re-bake and
    // the structural compare entirely. This is what makes the per-remount call
    // genuinely free; without it, scrolling a doc full of reference blocks re-baked
    // and ran four `JSON.stringify`s over each node on every remount. The full
    // compare below still runs for a real resolve (a fresh snapshot is a new object,
    // not reference-equal), which is off the scroll hot path.
    if (Object.is(current.data, data) && current.status === status) return;
    const baked = bakeObjectData(this.registry, current.type, data);
    const bakedTo: JsonValue | undefined = baked.baked ?? undefined;
    const bakedFrom: JsonValue | undefined = current.baked ?? undefined;
    if (
      JSON.stringify(current.data) === JSON.stringify(data) &&
      JSON.stringify(bakedFrom) === JSON.stringify(bakedTo) &&
      current.status === status
    ) {
      return;
    }
    const tr = this.transaction();
    tr.setObjectData({
      bakedFrom,
      bakedTo,
      from: current.data,
      node,
      statusFrom: current.status,
      statusTo: status,
      to: data,
    });
    this.dispatch(tr, { recordHistory: false });
  }

  /** The active IME preedit range, or null when no composition is in flight. */
  get composition(): CompositionRange | null {
    return this.#composition;
  }

  /**
   * Set the active composition (preedit) range so the engine paints its own
   * underline (docs/010 §7.4, Phase 7 AC5) — a fully owned view gets no
   * browser-drawn preedit. Notifies selection subscribers so the overlay
   * repaints on the frame lane; it carries no document mutation.
   */
  setComposition(range: CompositionRange | null): void {
    const prev = this.#composition;
    if (
      prev === range ||
      (prev &&
        range &&
        prev.node === range.node &&
        prev.from === range.from &&
        prev.to === range.to)
    ) {
      return;
    }
    this.#composition = range;
    this.#selectionSubscribers.forEach((subscriber) =>
      subscriber({
        nodes: new Set(),
        selection: true,
        settings: false,
        structure: false,
      }),
    );
  }

  /** Clear the active composition preedit range (on `compositionend`). */
  clearComposition(): void {
    this.setComposition(null);
  }

  /** A fresh, store-scoped mark id (docs/011 §4.4). */
  nextMarkId(): string {
    this.#markCounter += 1;
    return `${this.#allocator.clientId}_mark_${this.#markCounter}`;
  }

  /** The collapsed-caret pending format, or null (docs/018 §2.0). */
  get pendingFormat(): PendingFormat | null {
    return this.#pendingFormat;
  }

  /**
   * Toggle one format mark in the pending set at the collapsed caret. The set is
   * seeded from the marks already covering the caret the first time it is touched
   * at this position, so toggling a mark the caret sits inside turns it *off* for
   * the next character. Notifies selection subscribers so the toolbar reflects it.
   */
  togglePendingMark(kind: TextMarkKind): void {
    const selection = this.#selection;
    if (selection?.type !== "text") return;
    const node = this.getNode(selection.focus.node);
    if (!node || node.kind !== "text") return;
    const offset = selection.focus.offset;
    const marks = new Set(
      this.#pendingFormat &&
        this.#pendingFormat.node === node.id &&
        this.#pendingFormat.offset === offset
        ? this.#pendingFormat.marks
        : marksCoveringCaret(node, offset),
    );
    if (marks.has(kind)) marks.delete(kind);
    else marks.add(kind);
    this.#pendingFormat = {
      link: this.#pendingFormat?.link ?? null,
      marks,
      node: node.id,
      offset,
    };
    this.#notifySelectionOnly();
  }

  /** Set (or clear, with `null`/unsafe href) a pending link at the caret. */
  setPendingLink(href: string | null): void {
    const selection = this.#selection;
    if (selection?.type !== "text") return;
    const node = this.getNode(selection.focus.node);
    if (!node || node.kind !== "text") return;
    const offset = selection.focus.offset;
    const cleaned = href === null ? "" : safeHref(href);
    const base =
      this.#pendingFormat &&
      this.#pendingFormat.node === node.id &&
      this.#pendingFormat.offset === offset
        ? this.#pendingFormat
        : { link: null, marks: new Set<TextMarkKind>(), node: node.id, offset };
    this.#pendingFormat = {
      ...base,
      link: cleaned.length > 0 ? { href: cleaned } : null,
    };
    this.#notifySelectionOnly();
  }

  /** Drop the pending format (caret moved without typing, or it was consumed). */
  clearPendingFormat(): void {
    if (!this.#pendingFormat) return;
    this.#pendingFormat = null;
    this.#notifySelectionOnly();
  }

  /**
   * Open a fresh undo group on the next edit (docs/011 §7.5 hard boundary). The
   * view calls this on paste; the store calls it on undo/redo and object
   * activation, so a typing run never coalesces across those.
   */
  breakUndoCoalescing(): void {
    this.#history.breakCoalescing();
  }

  #isCollapsedTextCaret(): boolean {
    const selection = this.#selection;
    return (
      selection?.type === "text" &&
      selection.anchor.node === selection.focus.node &&
      selection.anchor.offset === selection.focus.offset
    );
  }

  #notifySelectionOnly(): void {
    this.#selectionSubscribers.forEach((subscriber) =>
      subscriber({
        nodes: new Set(),
        selection: true,
        settings: false,
        structure: false,
      }),
    );
  }

  /** Subscribe to live-object slot changes (the view's resting↔live switch). */
  subscribeActiveObject(subscriber: () => void): () => void {
    this.#activeObjectSubscribers.add(subscriber);
    return () => this.#activeObjectSubscribers.delete(subscriber);
  }

  #notifyActiveObject(): void {
    // The slot is view/runtime state, not a node mutation: the object's data is
    // unchanged, only its resting↔live rendering. A dedicated subscription drives
    // that switch without a no-op node re-render (the node identity is the same).
    this.#activeObjectSubscribers.forEach((subscriber) => subscriber());
  }

  /**
   * The single document mutation chokepoint.
   *
   * Dispatch derives inverse steps from live pre-state, applies steps
   * atomically, remaps selection, records history, and notifies only touched
   * subscribers.
   */
  dispatch(
    transaction: TransactionBuilder | TransactionDraft,
    options?: { readonly recordHistory?: boolean },
  ): CommittedTransaction | null {
    const draft =
      transaction instanceof TransactionBuilder
        ? transaction.build()
        : transaction;
    if (draft.steps.length === 0 && !draft.selectionAfter) return null;
    // A content-free transaction (every click and arrow key dispatches one with
    // empty `steps`) is non-historic: recording it would make undo step back
    // through caret moves before reaching the last edit, and a caret move must
    // not clear the redo stack (docs/010 §10.5). Only real edits touch history.
    //
    // A caller may also force `recordHistory: false` for a step-bearing
    // transaction that is derived state, not a user edit — the reference-block
    // resolve lifecycle (docs/026 §7.2/§14.6): a background snapshot refresh or an
    // unresolved/invalid status change must not enter undo and must not clear redo,
    // exactly like a caret move.
    const recordHistory = options?.recordHistory ?? draft.steps.length > 0;
    const committed = this.#commit(draft, { recordHistory });
    if (recordHistory) this.#history.clearRedo();
    return committed;
  }

  /**
   * Compile a high-level command to a transaction and dispatch it (docs/011
   * §6.12). The only public mutation entry besides raw `dispatch`; the host and
   * the view speak commands, never steps. Returns null when the command is a
   * no-op for the current state.
   */
  command(command: EditorCommand): CommittedTransaction | null {
    // A format toggle over a collapsed caret is not a no-op: it records a
    // pending format the next typed character inherits (docs/018 §2.0), the way
    // a native editor lets you press Bold then type. Over a real selection the
    // command compiles and dispatches as usual.
    if (this.#isCollapsedTextCaret()) {
      if (command.type === "toggle-mark") {
        this.togglePendingMark(command.mark);
        return null;
      }
      if (command.type === "set-link") {
        this.setPendingLink(command.href);
        return null;
      }
      if (command.type === "clear-link") {
        this.setPendingLink(null);
        return null;
      }
    }
    const tr = compileCommand(this, command);
    return tr ? this.dispatch(tr) : null;
  }

  /** Answer a read-only query for toolbar active/enabled state (queries never mutate). */
  query(query: EditorQuery): boolean | TextLeafType | string | null {
    return runQuery(this, query);
  }

  /** Whether there is an applied transaction to undo (toolbar enablement). */
  get canUndo(): boolean {
    return this.#history.canUndo;
  }

  /** Whether there is an undone transaction to redo (toolbar enablement). */
  get canRedo(): boolean {
    return this.#history.canRedo;
  }

  /** Apply the latest inverse transaction and restore its stored selection. */
  undo(): CommittedTransaction | null {
    // takeUndo pops the done stack (faulting one cold-stored entry back first under
    // `overflow: "cold-store"`) and re-breaks coalescing; it returns null when nothing is
    // reachable — undo stops cleanly at the cap under `overflow: "drop"` (docs/030 §7.6).
    const entry = this.#history.takeUndo();
    if (!entry) return null;
    // Undo/redo drop a pending format so the next edit starts a fresh group (docs/011 §7.5).
    this.#pendingFormat = null;
    const committed = this.#commit(
      {
        origin: "local",
        selectionAfter: entry.selectionBefore ?? undefined,
        steps: entry.inverse,
      },
      { recordHistory: false },
    );
    this.#history.pushUndone(entry);
    return committed;
  }

  /** Re-apply the latest undone transaction and restore its selection. */
  redo(): CommittedTransaction | null {
    const entry = this.#history.takeRedo();
    if (!entry) return null;
    this.#pendingFormat = null;
    const committed = this.#commit(
      {
        origin: "local",
        selectionAfter: entry.selectionAfter ?? undefined,
        steps: entry.steps,
      },
      { recordHistory: false },
    );
    this.#history.pushDone(entry);
    return committed;
  }

  subscribeNode(id: NodeId, subscriber: EditorSubscriber): () => void {
    const set = this.#nodeSubscribers.get(id) ?? new Set<EditorSubscriber>();
    set.add(subscriber);
    this.#nodeSubscribers.set(id, set);
    return () => set.delete(subscriber);
  }

  subscribeOrder(subscriber: EditorSubscriber): () => void {
    this.#orderSubscribers.add(subscriber);
    return () => this.#orderSubscribers.delete(subscriber);
  }

  /**
   * Diagnostics/tests only (docs/018 §2.9): the count of live per-node
   * subscribers across all nodes. Under virtualization this must stay bounded by
   * the mounted window — an unmounted block that fails to release its
   * `subscribeNode` registration shows up here as unbounded growth over a long
   * scroll. Empty per-node sets linger in the map (cheap); only live sizes count.
   */
  debugNodeSubscriberCount(): number {
    let total = 0;
    for (const set of this.#nodeSubscribers.values()) total += set.size;
    return total;
  }

  subscribeSettings(subscriber: EditorSubscriber): () => void {
    this.#settingsSubscribers.add(subscriber);
    return () => this.#settingsSubscribers.delete(subscriber);
  }

  subscribeSelection(subscriber: EditorSubscriber): () => void {
    this.#selectionSubscribers.add(subscriber);
    return () => this.#selectionSubscribers.delete(subscriber);
  }

  /** Observe every committed transaction (the §12.2 handle's change feed). */
  subscribeCommit(subscriber: EditorCommitSubscriber): () => void {
    this.#commitSubscribers.add(subscriber);
    return () => this.#commitSubscribers.delete(subscriber);
  }

  toSnapshot(): EditorDocumentSnapshot {
    // Incremental save (docs/030 §7.4 D4, SLP-1): `#snapshotBlocks` is maintained in
    // lockstep with `#nodes` on every commit (`#reconcileSnapshotBlocks`), so this no
    // longer rebuilds the whole block map (the old `Object.fromEntries` was O(all nodes)
    // on every 1 s autosave). Mark it published: the next mutation copies-on-write before
    // touching it, so the object returned here is never mutated underneath a caller that is
    // still holding it (e.g. a parity assertion that captured a "before" snapshot).
    this.#snapshotBlocksPublished = true;
    // In dev/test, verify the maintained map against a full rebuild and fall back to the
    // rebuild on any divergence (a surfaced dev-only error, never a corrupt save — docs/030
    // §9). Gated out of production, where the maintained map is authoritative.
    const blocks = isDevInvariantsEnabled()
      ? this.#parityCheckedSnapshotBlocks()
      : this.#snapshotBlocks;
    // Include `collections` only when something is stored, so a document with no
    // collections serializes byte-identically to before this slot existed (docs/027
    // §5.4) — existing snapshots and equality assertions stay unchanged.
    const collections =
      Object.keys(this.#collections).length > 0
        ? { collections: this.#collections }
        : {};
    return {
      body: {
        blocks,
        order: [...this.#order],
      },
      ...collections,
      settings: this.#settings,
      version: 1,
    };
  }

  /** The full O(n) block rebuild — the pre-incremental form, kept as the parity oracle. */
  #fullSnapshotBlocks(): Record<NodeId, EditorNode> {
    return Object.fromEntries(
      [...this.#nodes.entries()].filter(([id]) => id !== ROOT_NODE_ID),
    ) as Record<NodeId, EditorNode>;
  }

  /**
   * Return the maintained block map, but in dev/test compare it to a full rebuild first; on
   * any divergence surface a dev-only error and fall back to the rebuild so a touched-set
   * bug can never produce a corrupt save (docs/030 §7.4 / §9). The fallback also repairs the
   * maintained map so the next save is consistent again.
   */
  #parityCheckedSnapshotBlocks(): Record<NodeId, EditorNode> {
    const full = this.#fullSnapshotBlocks();
    if (!this.#snapshotBlocksMatches(full)) {
      // eslint-disable-next-line no-console
      console.error(
        "EditorStore: incremental snapshot diverged from full rebuild; falling back",
      );
      this.#snapshotBlocks = full;
      this.#snapshotBlocksPublished = true;
    }
    return this.#snapshotBlocks;
  }

  /** Whether the maintained map has exactly the same keys mapped to the same node objects. */
  #snapshotBlocksMatches(full: Record<NodeId, EditorNode>): boolean {
    const fullKeys = Object.keys(full);
    const ownKeys = Object.keys(this.#snapshotBlocks);
    if (fullKeys.length !== ownKeys.length) return false;
    for (const key of fullKeys) {
      // Identity, not deep-equality: every commit replaces a changed node with a new frozen
      // object, so the maintained map must hold the *same reference* `#nodes` holds.
      if (this.#snapshotBlocks[key as NodeId] !== full[key as NodeId]) {
        return false;
      }
    }
    return true;
  }

  /**
   * Assert the maintained `#snapshotBlocks` is byte-for-byte the full rebuild (docs/030
   * §7.4 parity AC). A diagnostics/test entry point, mirroring `assertParentInvariant`:
   * throws on any divergence so a touched-set bug fails loudly under test.
   */
  assertIncrementalSnapshotParity(): void {
    if (!this.#snapshotBlocksMatches(this.#fullSnapshotBlocks())) {
      throw new Error("Incremental snapshot diverged from full rebuild");
    }
  }

  /**
   * Reconcile the maintained block map after a commit (docs/030 §7.4, SLP-1). The complete
   * set of changed keys is the `touched` set *plus* the descendants of every insert/remove
   * step: `touched` records the top node and its parent for a structural step but not the
   * subtree, so a subtree insert/remove would otherwise miss its descendants. `removedByStep`
   * already carries each removed subtree in full; insert descendants ride the step. For each
   * changed key, mirror `#nodes` — set when present, delete when gone. Copy-on-write once if
   * the map was already published, so a returned snapshot is never mutated in place.
   */
  #reconcileSnapshotBlocks(
    committed: CommittedTransaction,
    steps: readonly Step[],
    removedByStep: ReadonlyMap<Step, ReadonlySet<NodeId>>,
  ): void {
    const changed = new Set<NodeId>(committed.touched);
    for (const step of steps) {
      if (step.type === "insert-node") {
        for (const descendant of step.descendants ?? []) {
          changed.add(descendant.id);
        }
      }
    }
    for (const ids of removedByStep.values()) {
      for (const id of ids) changed.add(id);
    }
    changed.delete(ROOT_NODE_ID);
    if (changed.size === 0) return;
    if (this.#snapshotBlocksPublished) {
      // The previous map was handed to a caller; clone before mutating so that snapshot
      // stays frozen-in-time. This O(n) copy happens at most once per save cycle (on the
      // first edit after a `toSnapshot()`); individual node objects are shared by reference.
      this.#snapshotBlocks = { ...this.#snapshotBlocks };
      this.#snapshotBlocksPublished = false;
    }
    for (const id of changed) {
      const node = this.#nodes.get(id);
      if (node) this.#snapshotBlocks[id] = node;
      else delete this.#snapshotBlocks[id];
    }
  }

  parentEntry(id: NodeId): ParentEntry | undefined {
    return this.#parentOf.get(id);
  }

  /**
   * Whether a text selection runs forward (anchor at or before focus in
   * document order). Used pre-edit to pick the §8.8 collapse bias so a delete
   * does not invert the selection. Defaults to forward for non-text or when a
   * point can no longer be compared.
   */
  #selectionIsForward(selection: EditorSelection | null): boolean {
    if (selection?.type !== "text") return true;
    try {
      return this.comparePoints(selection.anchor, selection.focus) <= 0;
    } catch {
      return true;
    }
  }

  /** Compare two text points in document order without reading the DOM. */
  comparePoints(a: TextPoint, b: TextPoint): -1 | 0 | 1 {
    const aNode = this.requireTextNode(a.node);
    const bNode = this.requireTextNode(b.node);
    const aOffset = resolvePointOffset(aNode.content, a);
    const bOffset = resolvePointOffset(bNode.content, b);
    if (a.node === b.node) return sign(aOffset - bOffset);
    return compareNumberArrays(this.#pathOf(a.node), this.#pathOf(b.node));
  }

  /** Assert the reverse parent index matches every structural `children` array. */
  assertParentInvariant(): void {
    const seen = new Set<NodeId>();
    const visit = (parent: NodeId, children: readonly NodeId[]) => {
      children.forEach((childId, index) => {
        const entry = this.#parentOf.get(childId);
        if (!entry || entry.parent !== parent || entry.index !== index) {
          throw new Error(`parentOf invariant failed for ${childId}`);
        }
        seen.add(childId);
        const child = this.requireNode(childId);
        if (child.kind === "structural") visit(child.id, child.children);
      });
    };
    visit(ROOT_NODE_ID, this.#order);
    for (const id of this.#nodes.keys()) {
      if (id !== ROOT_NODE_ID && !seen.has(id)) {
        throw new Error(`Node is detached from root: ${id}`);
      }
    }
  }

  #commit(
    draft: TransactionDraft,
    options: { readonly recordHistory: boolean },
  ): CommittedTransaction {
    const inverses: Step[] = [];
    const state: MutableDispatchState = {
      collectionsChanged: false,
      removedByStep: new Map<Step, ReadonlySet<NodeId>>(),
      settingsChanged: false,
      structureChanged: false,
      touched: new Set<NodeId>(),
    };
    const selectionBefore = this.#selection;
    // Capture the selection's direction while the store is still pre-edit, so a
    // collapsing delete keeps anchor and focus in order (§8.8). comparePoints
    // can throw once a node is removed, so it must run before `apply`.
    const selectionForward = this.#selectionIsForward(selectionBefore);
    try {
      for (const step of draft.steps) {
        inverses.push(this.#applyAndInvert(step, state));
      }
    } catch (error) {
      // Roll back any partial application with the inverses already captured.
      // This preserves the "dispatch is atomic" contract without snapshots.
      for (const inverse of inverses.toReversed()) {
        this.#applyAndInvert(inverse, {
          collectionsChanged: false,
          removedByStep: new Map<Step, ReadonlySet<NodeId>>(),
          settingsChanged: false,
          structureChanged: false,
          touched: new Set<NodeId>(),
        });
      }
      throw error;
    }
    const mappedSelection =
      draft.selectionAfter ??
      mapSelection(
        this,
        selectionBefore,
        draft.steps,
        selectionForward,
        state.removedByStep,
      );
    this.#selection = mappedSelection;
    // Field compare, not `JSON.stringify` !== `JSON.stringify`: the old form
    // serialized both selections on every keystroke and every drag-extend frame.
    // `selectionsEqual` allocates nothing and exits on the first differing field.
    const selectionChanged = !selectionsEqual(selectionBefore, mappedSelection);
    const committed: CommittedTransaction = {
      inverse: inverses.toReversed(),
      origin: draft.origin,
      selectionAfter: mappedSelection,
      selectionBefore,
      settingsChanged: state.settingsChanged,
      steps: draft.steps,
      structureChanged: state.structureChanged,
      touched: new Set(state.touched),
    };
    if (options.recordHistory) this.#history.record(committed);
    // Keep the persisted block map in lockstep with `#nodes` (docs/030 §7.4, SLP-1). Runs
    // for every commit — including a `recordHistory:false` resolve/SWR data change — so the
    // snapshot reflects genuine data changes while leaving untouched keys alone.
    this.#reconcileSnapshotBlocks(committed, draft.steps, state.removedByStep);
    this.#reconcilePendingFormat(draft.steps.length > 0, selectionChanged);
    const dirtyNodes = new Set(committed.touched);
    // Skipping the active leaf's re-render is only safe when its DOM was already
    // patched out of band — that is exactly the input controller's `textupdate`
    // path (it calls `markActiveLeafDomSynced` before dispatch). A command-driven
    // text edit (Shift+Enter's soft break, paste) does NOT patch the DOM, so it
    // must re-render or the change stays invisible and the EditContext desyncs.
    const domSynced = this.#activeLeafDomSynced;
    this.#activeLeafDomSynced = false;
    if (this.#activeTextLeafId && dirtyNodes.has(this.#activeTextLeafId)) {
      const activeNode = this.getNode(this.#activeTextLeafId);
      if (!activeNode || activeNode.kind !== "text") {
        // The active leaf was removed/replaced by this transaction; drop it so
        // we never pin a snapshot of a gone node (it reactivates on next focus).
        this.#activeTextLeafId = null;
        this.#activeTextLeafSnapshot = null;
      } else if (
        domSynced &&
        canSkipActiveTextNotify(draft.steps, this.#activeTextLeafId)
      ) {
        dirtyNodes.delete(this.#activeTextLeafId);
      } else {
        this.#activeTextLeafSnapshot = activeNode;
      }
    }
    this.#notify({
      nodes: dirtyNodes,
      selection: selectionChanged,
      settings: committed.settingsChanged,
      structure: committed.structureChanged,
    });
    // The reverse parent index only changes on structural steps (the handlers
    // that rebuild it are the same ones that set `structureChanged`). Verifying
    // it after a pure text edit would walk the whole document for nothing, which
    // 010 §10.1 AC9 / 011 §10.4 forbid on the keystroke hot path. Guard the O(N)
    // check so it runs only when a structural mutation could have broken it.
    if (committed.structureChanged && isDevInvariantsEnabled()) {
      this.assertParentInvariant();
    }
    // A commit-level notification carries the whole transaction, so the public
    // handle (docs/011 §12.2) can fire change/dirty/selection events for every
    // edit, including typing the view dispatches directly.
    this.#commitSubscribers.forEach((subscriber) => subscriber(committed));
    // Rebalance the memory budget after the edit settled (docs/030 §7.6, SLP-4). A no-op
    // unless a finite `memoryBudget` is set; under one, a long edit session grows history
    // and the arbiter sheds the deepest undo (or whichever pool is heaviest) back to the
    // low-water mark.
    this.#arbiter.rebalance();
    return committed;
  }

  /**
   * Keep the collapsed-caret pending format durable across edits (docs/018 §2.0).
   * Deterministic, not a heuristic, so it does not drop unpredictably:
   *  - an edit (`hadSteps`) that leaves a collapsed text caret — typing, an
   *    Enter/split, a delete/merge, an IME composition replacing its preedit —
   *    re-anchors pending to the new caret, so the format follows the caret,
   *    including across an Enter into a brand-new block;
   *  - a stepless caret move that changes the selection (arrow, click, find) is
   *    navigation and clears pending;
   *  - a selection that is no longer a collapsed caret (a range, an object)
   *    clears pending;
   *  - a stepless no-op (a focus re-sync to the same caret) leaves it untouched.
   */
  #reconcilePendingFormat(hadSteps: boolean, selectionChanged: boolean): void {
    const pending = this.#pendingFormat;
    if (!pending) return;
    const sel = this.#selection;
    if (
      sel?.type !== "text" ||
      sel.anchor.node !== sel.focus.node ||
      sel.anchor.offset !== sel.focus.offset
    ) {
      this.#pendingFormat = null;
      return;
    }
    if (hadSteps) {
      this.#pendingFormat = {
        ...pending,
        node: sel.focus.node,
        offset: sel.focus.offset,
      };
    } else if (selectionChanged) {
      this.#pendingFormat = null;
    }
  }

  #applyAndInvert(step: Step, state: MutableDispatchState): Step {
    /*
     * The switch is deliberately centralized. A new step kind is not complete
     * until this dispatcher can apply it, derive its inverse, and mark the
     * correct dirty slices.
     */
    switch (step.type) {
      case "replace-text":
        return this.#replaceText(step, state);
      case "add-mark":
        return this.#addMark(step, state);
      case "remove-mark":
        return this.#removeMark(step, state);
      case "set-node-type":
        return this.#setNodeType(step, state);
      case "set-node-attr":
        return this.#setNodeAttr(step, state);
      case "insert-node":
        return this.#insertNode(step, state);
      case "remove-node":
        return this.#removeNode(step, state);
      case "move-node":
        return this.#moveNode(step, state);
      case "set-object-data":
        return this.#setObjectData(step, state);
      case "set-settings":
        return this.#setSettings(step, state);
      case "set-collection":
        return this.#setCollection(step, state);
    }
  }

  #replaceText(step: ReplaceTextStep, state: MutableDispatchState): Step {
    const node = this.requireTextNode(step.node);
    const removedLength = step.removed.text.length;
    const removed = sliceTextContent(
      node.content,
      step.at,
      step.at + removedLength,
    );
    if (removed.text !== step.removed.text) {
      throw new Error("ReplaceText removed text does not match live content");
    }
    const nextContent = replaceTextContent(
      node.content,
      step.at,
      removedLength,
      step.inserted,
    );
    const survivingMarks = remapMarksForReplace(
      node.content,
      nextContent,
      node.marks,
      step.at,
      removedLength,
      step.inserted.text.length,
    );
    /*
     * Re-expanding a clamped mark or restoring a dropped one is not derivable
     * from the surviving marks alone (the remap only clamps), so undo replays
     * the originals the inverse carried in `removedMarks` (docs/011 §4.5).
     */
    const nextMarks = step.removedMarks?.length
      ? mergeMarksById(survivingMarks, step.removedMarks)
      : survivingMarks;
    this.#nodes.set(
      node.id,
      makeTextNode({
        attrs: node.attrs,
        content: nextContent,
        id: node.id,
        marks: nextMarks,
        type: node.type,
      }),
    );
    state.touched.add(node.id);
    /*
     * Only a deletion can destroy marks, so the inverse carries the pre-edit
     * marks that intersect the removed span. Their character-id anchors resolve
     * against the slice the inverse re-inserts, so the restore is exact.
     */
    const destroyedMarks =
      removedLength > 0
        ? marksIntersectingRange(
            node.content,
            node.marks,
            step.at,
            step.at + removedLength,
          )
        : [];
    return {
      at: step.at,
      inserted: removed,
      node: node.id,
      removed: step.inserted,
      type: "replace-text",
      ...(destroyedMarks.length > 0 ? { removedMarks: destroyedMarks } : {}),
    };
  }

  #addMark(step: AddMarkStep, state: MutableDispatchState): Step {
    const node = this.requireTextNode(step.node);
    this.#nodes.set(
      node.id,
      makeTextNode({
        attrs: node.attrs,
        content: node.content,
        id: node.id,
        marks: normalizeMarks([...node.marks, step.mark]),
        type: node.type,
      }),
    );
    state.touched.add(node.id);
    return { mark: step.mark, node: node.id, type: "remove-mark" };
  }

  #removeMark(step: RemoveMarkStep, state: MutableDispatchState): Step {
    const node = this.requireTextNode(step.node);
    const marks = node.marks.filter((mark) => mark.id !== step.mark.id);
    if (marks.length === node.marks.length) {
      throw new Error(`Unknown mark: ${step.mark.id}`);
    }
    this.#nodes.set(
      node.id,
      makeTextNode({
        attrs: node.attrs,
        content: node.content,
        id: node.id,
        marks,
        type: node.type,
      }),
    );
    state.touched.add(node.id);
    return { mark: step.mark, node: node.id, type: "add-mark" };
  }

  #setNodeType(step: SetNodeTypeStep, state: MutableDispatchState): Step {
    const node = this.requireTextNode(step.node);
    if (node.type !== step.from) throw new Error("SetNodeType from mismatch");
    this.#nodes.set(
      node.id,
      makeTextNode({
        attrs: node.attrs,
        content: node.content,
        id: node.id,
        marks: node.marks,
        type: step.to,
      }),
    );
    state.touched.add(node.id);
    // A block flipping to/from `listitem` changes list-run grouping, so the view
    // must recompute neighbour ordinals/boundaries even though the body order is
    // unchanged (docs/018 §2.10). Re-publish the order so the view's list pass
    // re-runs (see `#republishOrderForListLayout`).
    if (step.from === "listitem" || step.to === "listitem") {
      this.#republishOrderForListLayout(state);
    }
    return {
      from: step.to,
      node: node.id,
      to: step.from,
      type: "set-node-type",
    };
  }

  #setNodeAttr(step: SetNodeAttrStep, state: MutableDispatchState): Step {
    const node = this.requireNode(step.node);
    const current = node.attrs?.[step.key];
    if (JSON.stringify(current) !== JSON.stringify(step.from)) {
      throw new Error("SetNodeAttr from mismatch");
    }
    const attrs = cloneAttrsWithValue(node.attrs, step.key, step.to);
    this.#nodes.set(node.id, withAttrs(node, attrs));
    state.touched.add(node.id);
    // `listType`/`indent` change list-run flavour or depth, so the view's ordinal
    // and first/last-in-run pass must re-run for the neighbours too (docs/018
    // §2.10). The body order is unchanged; re-publish it to trigger that pass.
    if (step.key === "listType" || step.key === "indent") {
      this.#republishOrderForListLayout(state);
    }
    return {
      from: step.to,
      key: step.key,
      node: node.id,
      to: step.from,
      type: "set-node-attr",
    };
  }

  /**
   * Re-publish the body order as a fresh array with the same contents and flag the
   * commit structural (docs/018 §2.10). A list-layout-affecting attr/type change
   * does not move any block, so `subscribeOrder` would otherwise never fire and the
   * view could not renumber a run when an item's flavour/type changed in place.
   * Giving `store.order` a new reference makes the order-subscribed view (which
   * owns the render-time ordinal pass) recompute, while text edits — which touch
   * neither order nor these attrs — stay off this path.
   */
  #republishOrderForListLayout(state: MutableDispatchState): void {
    this.#order = [...this.#order];
    state.structureChanged = true;
  }

  #insertNode(step: InsertNodeStep, state: MutableDispatchState): Step {
    /*
     * The command/builder must allocate ids before dispatch. Apply only inserts
     * the already-formed node/subtree, then rebuilds the parent index so
     * comparePoints and selection remap keep using truthful document order.
     */
    if (this.#nodes.has(step.node.id))
      throw new Error(`Node exists: ${step.node.id}`);
    const parent = this.#requireStructuralNode(step.parent);
    if (step.index < 0 || step.index > parent.children.length) {
      throw new Error("InsertNode index out of range");
    }
    const subtree = [step.node, ...(step.descendants ?? [])].map(freezeNode);
    for (const node of subtree) this.#nodes.set(node.id, node);
    const children = [
      ...parent.children.slice(0, step.index),
      step.node.id,
      ...parent.children.slice(step.index),
    ];
    this.#nodes.set(parent.id, makeStructuralNode({ ...parent, children }));
    this.#syncOrderFromRoot();
    this.#rebuildParentIndex();
    state.touched.add(parent.id);
    state.touched.add(step.node.id);
    state.structureChanged = true;
    return {
      descendants: step.descendants,
      index: step.index,
      node: step.node,
      parent: step.parent,
      type: "remove-node",
    };
  }

  #removeNode(step: RemoveNodeStep, state: MutableDispatchState): Step {
    /*
     * Remove captures the entire subtree as inverse data. History therefore
     * scales with what changed, not with the whole document, while undo can put
     * every removed descendant back without needing a snapshot.
     */
    const parent = this.#requireStructuralNode(step.parent);
    if (parent.children[step.index] !== step.node.id) {
      throw new Error("RemoveNode index does not point to node");
    }
    const removed = collectSubtree(this.#nodes, step.node.id);
    // Record the full removed subtree so selection remap (which runs after the
    // store mutates, when the subtree is gone) can detect a caret/selection that
    // sat deep inside it and relocate it (docs/021 §8.2; mapping-helpers).
    state.removedByStep.set(step, new Set(removed.map((node) => node.id)));
    const children = parent.children.filter((id) => id !== step.node.id);
    this.#nodes.set(parent.id, makeStructuralNode({ ...parent, children }));
    for (const node of removed) this.#nodes.delete(node.id);
    // If the active text leaf is in the removed subtree (a merge removes the
    // leaf the caret was in), clear it now so the commit tail does not pin a
    // snapshot of a node that no longer exists. The caret's new block reactivates
    // when it next receives focus.
    if (
      this.#activeTextLeafId &&
      removed.some((node) => node.id === this.#activeTextLeafId)
    ) {
      this.#activeTextLeafId = null;
      this.#activeTextLeafSnapshot = null;
    }
    this.#syncOrderFromRoot();
    this.#rebuildParentIndex();
    state.touched.add(parent.id);
    state.touched.add(step.node.id);
    state.structureChanged = true;
    return {
      descendants: removed.slice(1),
      index: step.index,
      node: removed[0]!,
      parent: step.parent,
      type: "insert-node",
    };
  }

  #moveNode(step: MoveNodeStep, state: MutableDispatchState): Step {
    const fromParent = this.#requireStructuralNode(step.from.parent);
    const toParent = this.#requireStructuralNode(step.to.parent);
    if (fromParent.children[step.from.index] !== step.node) {
      throw new Error("MoveNode from index does not point to node");
    }
    const without = fromParent.children.filter((id) => id !== step.node);
    const targetChildren =
      step.from.parent === step.to.parent ? without : toParent.children;
    if (step.to.index < 0 || step.to.index > targetChildren.length) {
      throw new Error("MoveNode target index out of range");
    }
    const nextTargetChildren = [
      ...targetChildren.slice(0, step.to.index),
      step.node,
      ...targetChildren.slice(step.to.index),
    ];
    this.#nodes.set(
      fromParent.id,
      makeStructuralNode({
        ...fromParent,
        children: fromParent.id === toParent.id ? nextTargetChildren : without,
      }),
    );
    if (fromParent.id !== toParent.id) {
      this.#nodes.set(
        toParent.id,
        makeStructuralNode({ ...toParent, children: nextTargetChildren }),
      );
    }
    this.#syncOrderFromRoot();
    this.#rebuildParentIndex();
    state.touched.add(fromParent.id);
    state.touched.add(toParent.id);
    state.touched.add(step.node);
    state.structureChanged = true;
    return {
      from: {
        index: step.to.index,
        parent: step.to.parent,
      },
      node: step.node,
      to: step.from,
      type: "move-node",
    };
  }

  #setObjectData(step: SetObjectDataStep, state: MutableDispatchState): Step {
    const node = this.requireNode(step.node);
    if (node.kind !== "object")
      throw new Error("SetObjectData target is not object");
    if (JSON.stringify(node.data) !== JSON.stringify(step.from)) {
      throw new Error("SetObjectData from mismatch");
    }
    this.#nodes.set(
      node.id,
      makeObjectNode({
        attrs: node.attrs,
        baked: bakedSnapshot(step.bakedTo),
        data: step.to,
        id: node.id,
        status: step.statusTo,
        type: node.type,
      }),
    );
    state.touched.add(node.id);
    return {
      bakedFrom: step.bakedTo,
      bakedTo: step.bakedFrom,
      from: step.to,
      node: node.id,
      statusFrom: step.statusTo,
      statusTo: step.statusFrom,
      to: step.from,
      type: "set-object-data",
    };
  }

  #setSettings(step: SetSettingsStep, state: MutableDispatchState): Step {
    if (JSON.stringify(this.#settings) !== JSON.stringify(step.from)) {
      throw new Error("SetSettings from mismatch");
    }
    this.#settings = step.to;
    state.settingsChanged = true;
    return { from: step.to, to: step.from, type: "set-settings" };
  }

  /**
   * Apply a `set-collection` step (docs/027 §5.3). The inverse's `to` is the *live*
   * pre-edit array, captured here rather than trusting the step's `from` (the
   * side-effect-free builder cannot know live state), so undo restores exactly what
   * was there. Collections are not position-sensitive, so last-write-wins is correct
   * and no `from` validation is needed (unlike `set-settings`). An empty `to` drops
   * the key so the collection round-trips out of the snapshot when emptied.
   */
  #setCollection(step: SetCollectionStep, state: MutableDispatchState): Step {
    const current = this.#collections[step.collection] ?? [];
    const next = { ...this.#collections };
    if (step.to.length === 0) {
      delete next[step.collection];
    } else {
      next[step.collection] = step.to;
    }
    this.#collections = next;
    state.collectionsChanged = true;
    return {
      collection: step.collection,
      from: step.to,
      to: current,
      type: "set-collection",
    };
  }

  #notify(dirty: StoreDirty): void {
    for (const node of dirty.nodes) {
      this.#nodeSubscribers
        .get(node)
        ?.forEach((subscriber) => subscriber(dirty));
    }
    if (dirty.structure) {
      this.#orderSubscribers.forEach((subscriber) => subscriber(dirty));
    }
    if (dirty.settings) {
      this.#settingsSubscribers.forEach((subscriber) => subscriber(dirty));
    }
    if (dirty.selection) {
      this.#selectionSubscribers.forEach((subscriber) => subscriber(dirty));
    }
  }

  #requireStructuralNode(id: NodeId): StructuralNode {
    const node = this.requireNode(id);
    if (node.kind !== "structural")
      throw new Error(`Node is not structural: ${id}`);
    return node;
  }

  #syncOrderFromRoot(): void {
    this.#order = [...this.#requireStructuralNode(ROOT_NODE_ID).children];
  }

  #rebuildParentIndex(): void {
    this.#parentOf.clear();
    const visit = (parent: NodeId, children: readonly NodeId[]) => {
      children.forEach((childId, index) => {
        this.#parentOf.set(childId, { index, parent });
        const child = this.requireNode(childId);
        if (child.kind === "structural") visit(child.id, child.children);
      });
    };
    visit(ROOT_NODE_ID, this.#order);
  }

  #pathOf(id: NodeId): readonly number[] {
    const path: number[] = [];
    let current = id;
    while (current !== ROOT_NODE_ID) {
      const entry = this.#parentOf.get(current);
      if (!entry) throw new Error(`No parent entry for ${current}`);
      path.push(entry.index);
      current = entry.parent;
    }
    return path.toReversed();
  }
}

/** Build an editor store from a snapshot and id allocator — the entry point for loading or starting a document. */
export function createEditorStore(options: EditorStoreOptions): EditorStore {
  return new EditorStore(options);
}
