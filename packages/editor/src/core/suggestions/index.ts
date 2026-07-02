/**
 * Public barrel for the Model-A suggested-edits core (docs/036 §7, docs/038, R6-J J1).
 *
 * A proposal is an attributed op-log branch; `applyProposal` folds it into a document by identity so
 * the woven diff is `diffSnapshots(current, applyProposal(current, proposal).snapshot)`. Framework-
 * free (no store lifecycle, DOM, or React on the surface), so the editor, the reader, a worker, or a
 * headless agent (docs/037) all share it.
 */
export {
  applyProposal,
  applyProposalBlock,
  applyProposalToStore,
  groupProposalOps,
  revertLiveProposalApplication,
  revertLiveProposalBlock,
  targetBlockOf,
  type ProposalApplyOptions,
} from "./apply-proposal";
export {
  attributionForTextRun,
  proposalAttribution,
  type SuggestionAttribution,
} from "./attribution";
export { anchorlessChanges } from "./changes-routing";
export type { AnchorlessChange, AnchorlessChangeKind } from "./changes-routing";
export type {
  Proposal,
  ProposalApplication,
  ProposalAuthor,
  ProposalAuthorKind,
  ProposalConflict,
  ProposalConflictReason,
  ProposalOpGroups,
  ProposalStatus,
  LiveProposalApplication,
} from "./types";
