/**
 * The Model-A suggested-edits vocabulary (docs/036 §7.2, §7.5; docs/038 §10, R6-J J1).
 *
 * A suggested edit is an **attributed op-log branch**, not markup baked into the document: a
 * `Proposal` carries the author, the revision it was made against, and the `Step[]` that express the
 * change in the model's own algebra. The proposed document is `applyProposal(current, proposal)` and
 * the woven diff is `diffSnapshots(current, proposed)` — so a proposal renders and resolves through
 * the diff engine that already ships, with no per-node "suggested" bit polluting the live model
 * (docs/036 D9/D12). The ops are identity-anchored (node ids, and character ids at text boundaries),
 * so applying a proposal to a document that moved since it was made is a merge by identity, not an
 * offset rebase (docs/036 D15) — see `apply-proposal.ts`.
 *
 * These are pure data shapes with no store, DOM, or React dependency, so a headless producer
 * (docs/037's agent) can mint a `Proposal` and a headless consumer can apply it.
 */
import type { EditorDocumentSnapshot, NodeId, Step } from "../model";

/**
 * @categoryDefault Suggested Edits
 */

/**
 * A proposal's lifecycle state (docs/036 §7.2): awaiting review, or resolved one way. Mirrors the
 * comment thread's `resolved` state one axis wider, since the review wrapper reuses the thread model.
 */
export type ProposalStatus = "pending" | "accepted" | "rejected";

/** Whether a proposal's author is an AI agent (docs/037) or another human reviewer. */
export type ProposalAuthorKind = "agent" | "human";

/**
 * Who authored a proposal (docs/036 §7.2) — an agent or a human, with a stable `id` and a
 * display `label`. Under single-proposal review (docs/038 §11, §18) the author is constant for the
 * session, so attribution is a session-level fact shown in the chip, not a per-run computation.
 */
export type ProposalAuthor = {
  readonly kind: ProposalAuthorKind;
  readonly id: string;
  readonly label: string;
};

/**
 * A suggested edit as an attributed op-log branch (docs/036 §7.2, Model A).
 *
 * The change is `ops` (the model's own `Step[]`), so it expresses text edits, mark changes, block
 * insert/remove/move, object edits, and settings/collection changes with no new vocabulary. The
 * proposed document is `applyProposal(current, this)`; accept applies the ops, reject drops them.
 * `baseVersion` is the document `revision` (docs/036 D15) the proposal was made against — a staleness
 * signal, not a rebase key, because the ops carry identity anchors and apply is a merge by identity.
 */
export type Proposal = {
  readonly id: string;
  readonly author: ProposalAuthor;
  readonly createdAt: string;
  /** The document `revision` this proposal was made against — a staleness label (docs/036 D15). */
  readonly baseVersion: number;
  /** The change, identity-anchored so it survives non-overlapping intervening edits (docs/036 §7.2). */
  readonly ops: readonly Step[];
  readonly status: ProposalStatus;
  /** An optional comment `Thread` id carrying the discussion about this change (docs/036 §7.6). */
  readonly threadId?: string;
};

/**
 * Why a proposal op could not apply (docs/036 §7.3, §8) — the ways an identity anchor fails to
 * resolve against the current document. A conflict is surfaced, never silently mis-applied, and the
 * rest of the proposal still applies (partial acceptance).
 *
 * - `target-deleted` — the op's target node (or an insert/move's parent) no longer exists.
 * - `text-anchor-lost` — a text op's anchored characters (the `removed` slice's ids) are gone or no
 *   longer contiguous in the live leaf, because an intervening edit changed exactly that text.
 * - `apply-failed` — the anchors resolved but the store still rejected the step (a residual staleness
 *   backstop, so `applyProposal` is total and never throws).
 */
export type ProposalConflictReason =
  | "target-deleted"
  | "text-anchor-lost"
  | "apply-failed";

/**
 * One op that could not be applied to the current document, with the reason and the target block it
 * named (docs/036 §7.3). `node` is the id the op targeted (a deleted block, the leaf it edits, or an
 * insert/move parent), or `null` for a document-level op (settings/collection) that has no block.
 */
export type ProposalConflict = {
  readonly op: Step;
  readonly reason: ProposalConflictReason;
  readonly node: NodeId | null;
};

/**
 * The result of applying a proposal (or one block's ops) to a document (docs/036 §7.3).
 *
 * `snapshot` is the proposed document (the applied ops folded in); `applied` and `conflicts`
 * partition the requested ops. `diffSnapshots(current, snapshot)` renders the woven diff (docs/038
 * §5, §10). `applyProposal` is total — an unresolvable op becomes a `conflict`, never a throw.
 */
export type ProposalApplication = {
  readonly snapshot: EditorDocumentSnapshot;
  readonly applied: readonly Step[];
  readonly conflicts: readonly ProposalConflict[];
};

/**
 * The result of optimistically applying a proposal into a live `EditorStore` (docs/038 §13–§16).
 *
 * `inverse` reverts the programmatic optimistic apply. It does not include reviewer edits made during
 * review mode; reject-all first asks the store to replay the review-local segment, then dispatches
 * this inverse.
 */
export type LiveProposalApplication = {
  readonly applied: readonly Step[];
  readonly conflicts: readonly ProposalConflict[];
  readonly inverse: readonly Step[];
  /** Revert steps for each block's optimistic op group, in dispatch-ready reverse order. */
  readonly inverseByBlock: ReadonlyMap<NodeId, readonly Step[]>;
  readonly focusProtection: {
    readonly relocated: boolean;
    readonly from: NodeId | null;
    readonly to: NodeId | null;
  };
};

/**
 * A proposal's ops grouped by the block they act on (docs/036 §7.5) — the substrate for per-block
 * accept/reject.
 *
 * `byBlock` maps a target `NodeId` to the ops that produce or edit that block (an `insert-node`
 * belongs to the block it creates, a `move-node` to the moved block, a `replace-text`/mark op to the
 * leaf it edits), so "accept this block" applies exactly that group. `document` holds the ops with no
 * block to anchor to — `set-settings` and `set-collection` — which route to the Changes pane, not the
 * woven surface (docs/038 §17).
 */
export type ProposalOpGroups = {
  readonly byBlock: ReadonlyMap<NodeId, readonly Step[]>;
  readonly document: readonly Step[];
};
