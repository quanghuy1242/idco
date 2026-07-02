/**
 * Identity-anchored proposal apply and op grouping (docs/036 §7.2, §7.3, §7.5; docs/038 §10, R6-J J1).
 *
 * What this does
 * --------------
 * `applyProposal(current, proposal)` produces the *proposed* document — `current` with the proposal's
 * ops folded in — plus the ops that could not apply. The woven diff a reviewer sees is then
 * `diffSnapshots(current, application.snapshot)` (docs/038 §5, §10); accept keeps the ops, reject
 * drops them. `applyProposalBlock` does the same for one block's op group, the substrate for per-block
 * accept (docs/036 §7.5).
 *
 * Why apply is identity-anchored, not an offset rebase (docs/036 D15)
 * ------------------------------------------------------------------
 * A proposal is made against a `baseVersion`; the reviewer may have edited the document since. The
 * ops are keyed by node id and, for text, by the `removed` slice's *character* ids — both stable
 * across edits — so applying them to a document that moved is a MERGE BY IDENTITY, not a replay of an
 * intervening op-log against offsets (there is no log to replay, and the history pool is byte-capped
 * anyway, docs/030 SLP-4). Concretely, per op:
 *   - the target node (or an insert/move parent) must still exist, else the op is a `target-deleted`
 *     conflict (the headline "deleted anchor → conflict" case);
 *   - a text removal is anchored by its `removed` slice's character ids WHEN IT CARRIES THEM (a
 *     producer built it via `sliceTextContent`): the offset re-resolves to where those ids sit now,
 *     so a shifted-but-present anchor still applies, exact whether or not the base moved. The
 *     canonical `TransactionBuilder`/dispatch path yields an ID-LESS `removed` (ids on the inverse
 *     only); an id-less removal trusts its exact offset on an UNMOVED base (`baseVersion ===
 *     revision`) and, on a MOVED base, re-locates by the removed text's UNIQUE occurrence — zero or
 *     ambiguous (multiple) occurrences conflict rather than guess;
 *   - a structural op's `(parent, index)` is RE-DERIVED from the node's current position, so a
 *     reorder elsewhere does not turn a remove/move into a false conflict.
 *
 * The identity invariant holds fully for id-BEARING ops (text and structural): a non-overlapping
 * intervening edit never disturbs them; only a genuine overlap conflicts. For id-LESS text removals
 * it holds ONLY when the removal text is unique in its leaf; an id-less removal of a REPEATED
 * substring conflicts once the document has moved *anywhere* (not only in its own leaf), because
 * `moved` is a document-level signal (`baseVersion !== revision`, `documentMoved`) with no per-leaf
 * resolution — the applier has neither the base snapshot nor character ids, so it cannot prove an
 * untouched leaf's offset is still valid and refuses rather than risk a coincidental mis-apply. So
 * id-less-on-moved-base has TWO irreducible residuals: a SILENT MIS-APPLY when the removal is
 * unique-but-relocated onto text an intervening edit reproduced, and a FALSE CONFLICT when the
 * removal is a repeated substring. Both dissolve once the op carries character ids — the durable
 * producer contract (docs/037 / R6-J J6) — which is why `applyProposal` prefers ids. This trade is
 * deliberate: a false conflict is visible and recoverable; a silent mis-apply corrupts invisibly, so
 * the applier leans to conflict. (See `resolveReplaceText`.)
 *
 * Why it reuses the store, not a re-implemented step reducer
 * ---------------------------------------------------------
 * Applying `Step[]` is exactly what `EditorStore.dispatch` does, through the single mutation
 * chokepoint that already derives inverses and maintains the incremental snapshot. Re-implementing
 * the eleven step kinds here would be a second reducer that could drift from the canonical one. So
 * `applyProposal` builds a THROWAWAY store from `current`, dispatches the resolvable ops
 * (`recordHistory:false`), and reads `toSnapshot()`. Each op is dispatched as its own transaction so
 * a later op on the same leaf re-resolves against the state the earlier ops already produced — the
 * evolving-offset case identity resolution is for. A try/catch around each dispatch converts any
 * residual staleness the store still rejects into an `apply-failed` conflict, so this function is
 * TOTAL: it never throws for any proposal against any document.
 *
 * Purity: no DOM, no React. The throwaway `EditorStore` is a plain runtime container (core), so a
 * headless caller (docs/037's agent, a worker) can apply a proposal with no renderer.
 */
import {
  characterIdsForSlice,
  createIdAllocator,
  type CharacterId,
  type EditorDocumentSnapshot,
  type NodeId,
  type ReplaceTextStep,
  type Step,
  type TextContent,
  type TextSlice,
} from "../model";
import type { BlockRegistry } from "../registry";
import { createEditorStore, type EditorStore } from "../store";
import type {
  LiveProposalApplication,
  Proposal,
  ProposalApplication,
  ProposalConflict,
  ProposalConflictReason,
  ProposalOpGroups,
} from "./types";

/**
 * @categoryDefault Suggested Edits
 */

/**
 * Options for applying a proposal.
 *
 * `registry` is the block registry the throwaway store uses to interpret custom object/structural
 * nodes while applying ops; pass the same registry the live document uses so a custom node's steps
 * apply faithfully. Omitted → the default registry, which is correct for a built-in-only document.
 */
export type ProposalApplyOptions = {
  readonly registry?: BlockRegistry;
};

/**
 * Apply a whole proposal to a document, identity-anchored (docs/036 §7.2, §7.3).
 *
 * Returns the proposed `snapshot` (the resolvable ops folded into `current`), the `applied` ops, and
 * the `conflicts` (ops whose identity anchor no longer resolves). `current` is never mutated. Total —
 * an unresolvable op is a conflict, never a throw. Diff the result against `current` to render the
 * woven review; the rest of the proposal still applies when some ops conflict (partial acceptance).
 */
export function applyProposal(
  current: EditorDocumentSnapshot,
  proposal: Proposal,
  options?: ProposalApplyOptions,
): ProposalApplication {
  return applyOps(
    current,
    proposal.ops,
    documentMoved(current, proposal),
    options,
  );
}

/**
 * Apply only one block's ops from a proposal (docs/036 §7.5) — the per-block accept substrate.
 *
 * Groups the proposal's ops by target block id ({@link groupProposalOps}) and applies exactly the
 * group for `blockId`, with the same identity-anchored resolution and conflict handling as
 * {@link applyProposal}. A `blockId` with no ops yields an unchanged snapshot.
 *
 * CAVEAT — cross-block op dependencies: the group is a per-block SUBSET, so an op that depends on an
 * op grouped under a *different* block will conflict when the block is accepted alone. This bites
 * only a producer that emits a parent container and its child as *separate* insert-node ops (the
 * child groups under its own id, the parent under the parent's): accepting just the child inserts it
 * into a parent that is not there → a `target-deleted` conflict. The canonical builder inserts a
 * subtree as ONE insert-node with `descendants`, so it does not hit this; it stays total either way
 * (a surfaced conflict, never a corruption). Dependency-aware grouping is a later refinement.
 */
export function applyProposalBlock(
  current: EditorDocumentSnapshot,
  proposal: Proposal,
  blockId: NodeId,
  options?: ProposalApplyOptions,
): ProposalApplication {
  const ops = groupProposalOps(proposal.ops).byBlock.get(blockId) ?? [];
  return applyOps(current, ops, documentMoved(current, proposal), options);
}

/**
 * Optimistically apply a proposal into a live store for woven review mode (docs/038 §13–§16).
 *
 * This is the stateful sibling of {@link applyProposal}: it resolves the same identity anchors, then
 * dispatches each resolvable op through the live store with `origin:"suggested"`,
 * `recordHistory:false`, and `interactive:false`. That keeps the proposal out of undo/persistence and
 * prevents programmatic apply from stealing focus. Before a removal lands, the store performs the
 * focused-block-protection handshake so an EditContext host is not silently unmounted under the caret.
 */
export function applyProposalToStore(
  store: EditorStore,
  proposal: Proposal,
): LiveProposalApplication {
  const focusProtection = store.protectSelectionFromRemoval(
    removedRoots(proposal.ops),
  );
  const moved = proposal.baseVersion !== (store.toSnapshot().revision ?? 0);
  return applyOpsToStore(store, proposal.ops, moved, focusProtection);
}

/** Revert a live optimistic proposal apply, after any review-local edits have been unwound. */
export function revertLiveProposalApplication(
  store: EditorStore,
  application: Pick<LiveProposalApplication, "inverse">,
): void {
  if (application.inverse.length === 0) return;
  store.dispatch(
    {
      origin: "suggested",
      steps: application.inverse,
    },
    { interactive: false, recordHistory: false },
  );
}

/** Revert one block's optimistic proposal ops using the grouped inverse captured during live apply. */
export function revertLiveProposalBlock(
  store: EditorStore,
  application: Pick<LiveProposalApplication, "inverseByBlock">,
  blockId: NodeId,
): void {
  const inverse = application.inverseByBlock.get(blockId) ?? [];
  if (inverse.length === 0) return;
  store.dispatch(
    {
      origin: "suggested",
      steps: inverse,
    },
    { interactive: false, recordHistory: false },
  );
}

/**
 * Whether the document moved since the proposal was made (docs/036 D15): its `baseVersion` no longer
 * equals the current `revision`. This is the staleness signal that gates how an *id-less* text op is
 * anchored (see `resolveReplaceText`): on an unmoved base the op's offset is exact and trusted; on a
 * moved base it cannot be, so the removed text is re-located unambiguously or the op conflicts.
 *
 * CONTRACT: the unmoved fast path is sound only while `current.revision` faithfully reflects every
 * commit since `baseVersion`. Because `toSnapshot()` omits `revision` when 0 (byte-identity), a
 * consumer that persists/round-trips a revision-0 document through a store that does NOT continue the
 * revision line could present `current.revision === 0 === baseVersion` after a real edit, re-opening
 * the coincidental-match hole for id-less ops. Not reachable in the normal single-store flow, where
 * the store bumps monotonically; id-BEARING ops are immune regardless.
 */
function documentMoved(
  current: EditorDocumentSnapshot,
  proposal: Proposal,
): boolean {
  return proposal.baseVersion !== (current.revision ?? 0);
}

/**
 * Group a proposal's ops by the block they act on (docs/036 §7.5) — pure, so it is unit-testable
 * without a store.
 *
 * Each op is keyed to the block it produces or edits (insert-node → the created block, move-node →
 * the moved block, a text/mark/attr op → the edited node); `set-settings`/`set-collection` have no
 * block and collect into `document` (they route to the Changes pane, docs/038 §17). This grouping is
 * why a proposal is stored as ops, not an opaque proposed snapshot: per-block accept is a subset of
 * the ops (docs/036 §7.5, D9).
 */
export function groupProposalOps(ops: readonly Step[]): ProposalOpGroups {
  const byBlock = new Map<NodeId, Step[]>();
  const document: Step[] = [];
  for (const op of ops) {
    const target = targetBlockOf(op);
    if (target === null) {
      document.push(op);
      continue;
    }
    const group = byBlock.get(target);
    if (group) group.push(op);
    else byBlock.set(target, [op]);
  }
  return { byBlock, document };
}

/**
 * The block id an op produces or edits, or `null` for a document-level op (docs/036 §7.5). This is
 * the accept-granularity key: an insert-node belongs to the block it creates, a move-node to the
 * moved block, a text/mark/attr/object op to the node it names.
 */
export function targetBlockOf(op: Step): NodeId | null {
  switch (op.type) {
    case "replace-text":
    case "add-mark":
    case "remove-mark":
    case "set-node-type":
    case "set-node-attr":
    case "set-object-data":
    case "move-node":
      return op.node;
    case "insert-node":
    case "remove-node":
      return op.node.id;
    case "set-settings":
    case "set-collection":
      return null;
  }
}

// --- internals -------------------------------------------------------------------------------------

/** The result of resolving one op's identity anchors against the current store state. */
type Resolution =
  | { readonly ok: true; readonly step: Step }
  | {
      readonly ok: false;
      readonly reason: ProposalConflictReason;
      readonly node: NodeId | null;
    };

function applyOps(
  current: EditorDocumentSnapshot,
  ops: readonly Step[],
  moved: boolean,
  options?: ProposalApplyOptions,
): ProposalApplication {
  // A throwaway store over `current`; a fresh random-client allocator (unused — we dispatch
  // pre-built steps that carry their own ids, never mint new ones — but the store requires one).
  const store = createEditorStore({
    allocator: createIdAllocator(),
    ...(options?.registry ? { registry: options.registry } : {}),
    snapshot: current,
  });
  const applied: Step[] = [];
  const conflicts: ProposalConflict[] = [];
  for (const op of ops) {
    try {
      const resolved = resolveOp(store, op, moved);
      if (!resolved.ok) {
        conflicts.push({ node: resolved.node, op, reason: resolved.reason });
        continue;
      }
      store.dispatch(
        { origin: "local", steps: [resolved.step] },
        { recordHistory: false },
      );
      applied.push(op);
    } catch {
      // Two throw sources, both routed to a conflict so `applyProposal` stays TOTAL for any input:
      //   - the store rejected a resolved step (a from-mismatch — an intervening edit changed the
      //     very attr/type/data the op meant to change — or a stale structural slot);
      //   - a malformed op deserialized from a host `SuggestionSource` throws inside `resolveOp`.
      conflicts.push({ node: targetBlockOf(op), op, reason: "apply-failed" });
    }
  }
  return { applied, conflicts, snapshot: store.toSnapshot() };
}

function applyOpsToStore(
  store: EditorStore,
  ops: readonly Step[],
  moved: boolean,
  focusProtection: LiveProposalApplication["focusProtection"],
): LiveProposalApplication {
  const applied: Step[] = [];
  const conflicts: ProposalConflict[] = [];
  const inverse: Step[] = [];
  const inverseByBlock = new Map<NodeId, Step[]>();
  for (const op of ops) {
    try {
      const resolved = resolveOp(store, op, moved);
      if (!resolved.ok) {
        conflicts.push({ node: resolved.node, op, reason: resolved.reason });
        continue;
      }
      const committed = store.dispatch(
        { origin: "suggested", steps: [resolved.step] },
        { interactive: false, recordHistory: false },
      );
      if (committed) {
        inverse.unshift(...committed.inverse);
        const blockId = targetBlockOf(op);
        if (blockId) {
          const group = inverseByBlock.get(blockId) ?? [];
          group.unshift(...committed.inverse);
          inverseByBlock.set(blockId, group);
        }
      }
      applied.push(op);
    } catch {
      conflicts.push({ node: targetBlockOf(op), op, reason: "apply-failed" });
    }
  }
  return { applied, conflicts, focusProtection, inverse, inverseByBlock };
}

function resolveOp(store: EditorStore, op: Step, moved: boolean): Resolution {
  switch (op.type) {
    case "replace-text":
      return resolveReplaceText(store, op, moved);
    case "add-mark":
    case "remove-mark":
    case "set-node-type":
    case "set-node-attr":
    case "set-object-data":
      // Node-anchored, position-free: existence is the whole check. A kind mismatch (a leaf became an
      // object) or a from-mismatch is left to the dispatch backstop → `apply-failed`.
      return store.getNode(op.node)
        ? { ok: true, step: op }
        : { node: op.node, ok: false, reason: "target-deleted" };
    case "insert-node": {
      if (!store.getNode(op.parent))
        return { node: op.parent, ok: false, reason: "target-deleted" };
      // Clamp a stale index so an intervening sibling removal inserts at the end rather than throwing
      // (`#insertNode` rejects an out-of-range index). Block-insert position under a heavily-mutated
      // base is best-effort by (parent, index); a precise "insert after node X" anchor is a later
      // refinement (docs/038 §5.2), but this never throws or drops the op.
      const count = childCountOf(store, op.parent);
      const index = clamp(op.index, count);
      return { ok: true, step: index === op.index ? op : { ...op, index } };
    }
    case "remove-node": {
      // Re-derive the node's current slot: a reorder since the proposal must not turn a remove into a
      // false conflict (`#removeNode` throws if `children[index] !== node`).
      const loc = locate(store, op.node.id);
      if (!loc)
        return { node: op.node.id, ok: false, reason: "target-deleted" };
      return {
        ok: true,
        step:
          loc.parent === op.parent && loc.index === op.index
            ? op
            : { ...op, index: loc.index, parent: loc.parent },
      };
    }
    case "move-node": {
      const from = locate(store, op.node);
      if (!from) return { node: op.node, ok: false, reason: "target-deleted" };
      if (!store.getNode(op.to.parent))
        return { node: op.to.parent, ok: false, reason: "target-deleted" };
      // Re-derive `from` from the node's live position (it may have moved since the proposal). `to` is
      // clamped to the target parent's current child count; a same-parent move to the very end can
      // still be one past the post-removal length and fall to the dispatch backstop — a rare, honest
      // conflict, never a corruption.
      const to = {
        index: clamp(op.to.index, childCountOf(store, op.to.parent)),
        parent: op.to.parent,
      };
      return { ok: true, step: { ...op, from, to } };
    }
    case "set-settings":
    case "set-collection":
      // Document-level: no block anchor to lose, always applicable at the model layer (routing to the
      // Changes pane is a view concern, docs/038 §17).
      return { ok: true, step: op };
  }
}

function removedRoots(ops: readonly Step[]): NodeId[] {
  const out: NodeId[] = [];
  for (const op of ops) {
    if (op.type === "remove-node") out.push(op.node.id);
    else if (op.type === "move-node") out.push(op.node);
  }
  return out;
}

function resolveReplaceText(
  store: EditorStore,
  op: ReplaceTextStep,
  moved: boolean,
): Resolution {
  const node = store.getNode(op.node);
  if (!node || node.kind !== "text")
    return { node: op.node, ok: false, reason: "target-deleted" };
  const length = node.content.text.length;
  if (op.removed.text.length === 0) {
    // Pure insertion: no removed characters to anchor on, so the node id is the only identity anchor.
    // Clamp the offset into the live leaf so a length change before `at` never throws. (An insert into
    // a leaf an intervening edit also changed lands at a clamped offset — best-effort; a per-boundary
    // character anchor is the follow-up, docs/038 §5.2.)
    const at = clamp(op.at, length);
    return { ok: true, step: at === op.at ? op : { ...op, at } };
  }
  // A non-empty removal is anchored one of three ways, by how much identity the op carries:
  //
  //   1. ID-BEARING (`removed.runs` non-empty) — a producer built it via `sliceTextContent`,
  //      capturing the base leaf's character ids. Re-resolve the offset from where those ids sit
  //      now, so the op survives a same-leaf shift; ids gone/non-contiguous → the anchored text was
  //      clobbered → conflict. This is the durable path and is exact whether or not the base moved.
  //
  //   2. ID-LESS on an UNMOVED base (`removed.runs` empty, `baseVersion === revision`) — the
  //      canonical `TransactionBuilder`/dispatch path yields an id-less `removed` (`{text,runs:[]}`;
  //      dispatch derives ids for the inverse only). With no commit since the proposal was made the
  //      offset is exact, so trust `at`, validated against the live text.
  //
  //   3. ID-LESS on a MOVED base — the offset can no longer be trusted, and an id-less op has no
  //      character anchor to follow. Re-locate `removed.text` by its UNIQUE occurrence: if it occurs
  //      exactly once, that is unambiguously the target (this correctly relocates a shifted anchor);
  //      zero or MULTIPLE occurrences are a lost/ambiguous anchor → conflict, never a guessed apply
  //      at a coincidental match. The one case this still cannot catch — a moved base where an
  //      intervening edit reproduced the same unique substring elsewhere — is why durable char-id
  //      anchoring (case 1) is the producer-side contract (docs/037 / R6-J J6); id-less apply is
  //      best-effort by construction.
  if (op.removed.runs.length > 0) {
    const at = resolveRemovedOffset(node.content, op.removed);
    if (at === -1)
      return { node: op.node, ok: false, reason: "text-anchor-lost" };
    return { ok: true, step: at === op.at ? op : { ...op, at } };
  }
  if (!moved) {
    const at = clamp(op.at, length);
    if (
      node.content.text.slice(at, at + op.removed.text.length) !==
      op.removed.text
    )
      return { node: op.node, ok: false, reason: "text-anchor-lost" };
    return { ok: true, step: at === op.at ? op : { ...op, at } };
  }
  const at = uniqueOccurrence(node.content.text, op.removed.text);
  if (at === -1)
    return { node: op.node, ok: false, reason: "text-anchor-lost" };
  return { ok: true, step: at === op.at ? op : { ...op, at } };
}

/**
 * Find where a `removed` slice's character ids currently sit in a live leaf, or -1 if they are gone
 * or no longer contiguous (docs/036 D15). Character ids are stable across edits, so this is the
 * durable offset the raw `at` may no longer be. The final text check guards the (should-not-happen)
 * id-collision case where ids match but the characters do not.
 */
function resolveRemovedOffset(
  content: TextContent,
  removed: TextSlice,
): number {
  const removedIds = characterIdsForSlice(removed);
  const first = removedIds[0];
  if (!first) return -1;
  const liveIds = characterIdsForSlice(content);
  const start = liveIds.findIndex((id) => sameCharId(id, first));
  if (start === -1) return -1;
  for (let i = 1; i < removedIds.length; i += 1) {
    const live = liveIds[start + i];
    if (!live || !sameCharId(live, removedIds[i]!)) return -1;
  }
  if (content.text.slice(start, start + removed.text.length) !== removed.text)
    return -1;
  return start;
}

/**
 * The single start offset of `needle` in `haystack` if it occurs EXACTLY ONCE, else -1 (for zero or
 * multiple occurrences). Counts overlapping occurrences (so `"aa"` in `"aaaa"` is not unique), which
 * is what makes an id-less removal on a moved base refuse to guess between coincidental matches.
 */
function uniqueOccurrence(haystack: string, needle: string): number {
  const first = haystack.indexOf(needle);
  if (first === -1) return -1;
  return haystack.indexOf(needle, first + 1) === -1 ? first : -1;
}

/** The current number of children of a scope, using the store's own body/structural accessors. */
function childCountOf(store: EditorStore, parentId: NodeId): number {
  if (parentId === store.bodyId) return store.order.length;
  const parent = store.getNode(parentId);
  return parent && parent.kind === "structural" ? parent.children.length : 0;
}

/** The node's current `(parent, index)` in the store, using the store's own parent ids, or null. */
function locate(
  store: EditorStore,
  id: NodeId,
): { readonly parent: NodeId; readonly index: number } | null {
  const top = store.order.indexOf(id);
  if (top !== -1) return { index: top, parent: store.bodyId };
  const stack: NodeId[] = [...store.order];
  while (stack.length > 0) {
    const cursor = stack.pop()!;
    const node = store.getNode(cursor);
    if (!node || node.kind !== "structural") continue;
    const index = node.children.indexOf(id);
    if (index !== -1) return { index, parent: cursor };
    stack.push(...node.children);
  }
  return null;
}

function sameCharId(a: CharacterId, b: CharacterId): boolean {
  return a.client === b.client && a.clock === b.clock;
}

/** Clamp an index into `[0, max]`. */
function clamp(index: number, max: number): number {
  return Math.min(Math.max(index, 0), max);
}
