/**
 * Pane routing for the anchorless remainder of a proposal (docs/036 §7.3, §8; docs/038 §17, R6-J J5).
 *
 * "Review a proposal" is always the woven overlay PLUS the Changes pane, never the overlay alone
 * (docs/038 §17): the woven surface carries every change that has a `[data-engine-block-id]` to weave
 * onto — a block edit, an added/removed block, a re-colored cell — and the pane carries the remainder
 * that has *no block to anchor to*. Three classes are anchorless by construction:
 *
 *   - **conflicts** — a proposal op that could not apply: its target node or character run was deleted
 *     by an intervening reviewer edit (`target-deleted`/`text-anchor-lost`), or a resolved step the
 *     store still rejected (`apply-failed` — including a document-level `set-settings`/`set-collection`
 *     from-mismatch, whose `node` is null). The block-anchored cases have no element to hang a marker on
 *     (the target is gone); the document-level case has no block by nature. All route here as "no longer
 *     applies," and the rest of the proposal still applies (partial acceptance, §7.3).
 *   - **settings** — a document-theme / settings change. No block owns the document settings.
 *   - **collections** — a glossary or bibliography entry change. Document-level, not block-anchored.
 *
 * This module is the pure router that turns a computed review — `applyProposal(current, proposal)`'s
 * `conflicts` plus `diffSnapshots(current, proposed)` — into the flat list the pane renders. It is
 * framework-free (reads only the diff and the conflict shapes, no store/DOM/React), so it is
 * unit-testable without a live editor and the pane stays a thin renderer over it. The block-anchored
 * changes are summarized separately by the woven layer's `reviewCursorEntries` (J4), which the pane
 * reuses; this file owns *only* the anchorless split.
 */
import type { AttrDiff, CollectionDiff, SnapshotDiff } from "../diff";
import type { NodeId } from "../model";
import type { ProposalConflict, ProposalConflictReason } from "./types";

/**
 * @categoryDefault Suggested Edits
 */

/**
 * Which anchorless bucket a change routes to (docs/038 §17) — the three classes with no
 * `[data-engine-block-id]` to weave onto, so they surface in the Changes pane instead of the overlay.
 */
export type AnchorlessChangeKind = "conflict" | "settings" | "collection";

/**
 * One pane-routed change (docs/038 §17): a conflicted op, a settings change, or a collection change,
 * with a one-line `summary` for its pane row and a stable `key` for the React list. A `conflict`
 * carries the reason its anchor failed and the (now-deleted) target node it named; a `collection`
 * carries its collection key. None is revealable in the document — that is why they route here.
 */
export type AnchorlessChange = {
  readonly kind: AnchorlessChangeKind;
  /** A one-line human summary for the pane row. */
  readonly summary: string;
  /** A stable list key (`conflict:i`, `settings`, `collection:<key>`). */
  readonly key: string;
  /** Set on a `conflict`: why the op's identity anchor failed to resolve (docs/036 §7.3). */
  readonly conflictReason?: ProposalConflictReason;
  /** Set on a `conflict`: the (usually deleted) block the op targeted, or null for a document op. */
  readonly node?: NodeId | null;
  /** Set on a `collection`: the collection key that changed ("glossary", "bibliography", …). */
  readonly collectionKey?: string;
};

/**
 * Split a computed proposal review into the anchorless changes the Changes pane owns (docs/038 §17).
 *
 * Pass the `conflicts` from `applyProposal(current, proposal)` and the `diff` from
 * `diffSnapshots(current, application.snapshot)`. Returns the flat pane list in a stable order —
 * conflicts first (the "no longer applies" bucket a reviewer must act on), then the settings change,
 * then one entry per changed collection. Block-anchored changes are intentionally NOT here: they weave
 * into the document and are summarized by `reviewCursorEntries` (J4). Total and pure; an empty result
 * means the whole proposal is anchor-resolvable and nothing needs the pane.
 */
export function anchorlessChanges(
  diff: SnapshotDiff,
  conflicts: readonly ProposalConflict[],
): readonly AnchorlessChange[] {
  const out: AnchorlessChange[] = [];

  // Conflicts first: these are the ops that could not apply, so the reviewer sees "part of this
  // proposal no longer fits" before the informational settings/collection rows. Keyed by index because
  // a conflict has no natural id (it is an op that failed, not a persisted entity).
  conflicts.forEach((conflict, i) => {
    out.push({
      conflictReason: conflict.reason,
      key: `conflict:${i}`,
      kind: "conflict",
      node: conflict.node,
      summary: conflictSummary(conflict.reason),
    });
  });

  if (diff.settingsChanged) {
    out.push({
      key: "settings",
      kind: "settings",
      summary: settingsSummary(diff.settingsDetail),
    });
  }

  for (const collection of diff.collections) {
    // diffSnapshots emits a CollectionDiff per union key; skip a no-op entry so the pane shows only
    // collections that actually changed.
    if (!collectionChanged(collection)) continue;
    out.push({
      collectionKey: collection.key,
      key: `collection:${collection.key}`,
      kind: "collection",
      summary: collectionSummary(collection),
    });
  }

  return out;
}

/** Whether a `CollectionDiff` carries any add/remove/change (a union-key entry can be all-empty). */
function collectionChanged(collection: CollectionDiff): boolean {
  return (
    collection.added.length > 0 ||
    collection.removed.length > 0 ||
    collection.changed.length > 0
  );
}

/** The reviewer-facing reason a conflicted op cannot be woven (docs/036 §7.3 conflict reasons). */
function conflictSummary(reason: ProposalConflictReason): string {
  switch (reason) {
    case "target-deleted":
      return "A change no longer applies — its target block was deleted.";
    case "text-anchor-lost":
      return "A text change no longer applies — the text it edited has changed.";
    case "apply-failed":
      return "A change no longer applies — the document moved under it.";
  }
}

/** "Document settings changed", with a field count when the detail is present. */
function settingsSummary(detail: AttrDiff | undefined): string {
  if (!detail) return "Document settings changed.";
  const count =
    Object.keys(detail.added).length +
    Object.keys(detail.removed).length +
    Object.keys(detail.changed).length;
  if (count === 0) return "Document settings changed.";
  return `Document settings changed (${count} ${count === 1 ? "field" : "fields"}).`;
}

/** "Glossary changed — 2 added, 1 removed, 1 changed" (only the non-zero parts). */
function collectionSummary(collection: CollectionDiff): string {
  const label =
    collection.key.charAt(0).toUpperCase() + collection.key.slice(1);
  const parts: string[] = [];
  if (collection.added.length > 0)
    parts.push(`${collection.added.length} added`);
  if (collection.removed.length > 0)
    parts.push(`${collection.removed.length} removed`);
  if (collection.changed.length > 0)
    parts.push(`${collection.changed.length} changed`);
  return `${label} changed — ${parts.join(", ")}.`;
}
