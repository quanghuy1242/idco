/**
 * Attribution helpers for Model-A suggested edits (docs/036 §7.4, docs/038 §18, R6-J J7).
 *
 * Single-proposal review makes attribution a session fact: every woven change currently applied into
 * the store belongs to that proposal's author. Text-run character ids still matter because they prove
 * the inserted/deleted run has identity lineage, but the display does not need a per-run color puzzle
 * until Model B allows interleaved authors in one span.
 *
 * @categoryDefault Suggested Edits
 */
import type { TextRunDiff } from "../diff";
import type { Proposal, ProposalAuthor } from "./types";

/** Display attribution for the active proposal review session. */
export type SuggestionAttribution = {
  readonly author: ProposalAuthor;
  readonly label: string;
  readonly hue: string;
};

/** The author chip for a proposal under single-proposal review. */
export function proposalAttribution(proposal: Proposal): SuggestionAttribution {
  return {
    author: proposal.author,
    hue: hueForAuthor(proposal.author.id),
    label: proposal.author.label,
  };
}

/**
 * Attribution for a changed text run in the active proposal.
 *
 * Returns `null` for unchanged runs and for text-alignment fallback runs that carry no character ids.
 * In Model A the non-null result is the proposal author: only one proposal is applied, so an inserted
 * run's `ids` prove proposal lineage rather than choosing among simultaneous authors.
 */
export function attributionForTextRun(
  proposal: Proposal,
  run: TextRunDiff,
): SuggestionAttribution | null {
  if (run.op === "keep" || !run.ids || run.ids.length === 0) return null;
  return proposalAttribution(proposal);
}

function hueForAuthor(authorId: string): string {
  let hash = 0;
  for (let i = 0; i < authorId.length; i += 1) {
    hash = (hash * 31 + authorId.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360} 78% 42%)`;
}
