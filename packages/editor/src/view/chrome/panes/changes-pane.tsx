/**
 * The Changes dock pane (docs/036 §7.3, docs/038 §17, R6-J J5).
 *
 * "Review a proposal" is always the woven overlay PLUS this pane (docs/038 §17): the woven surface
 * (J2–J4) carries every change with a block to weave onto; this pane carries the proposal list, its
 * scope, and — its load-bearing, unique job — the **anchorless remainder** (conflicts, settings,
 * collections) that has no `[data-engine-block-id]` and therefore no woven home. It is host-backed
 * through the registered `SuggestionSource` (§7.3): `load` hydrates the proposals, `subscribe` catches
 * an async agent's later proposal, and `accept`/`reject` record the outcome in the host. A failed load
 * degrades to an inline error, mirroring the Comments pane's snapshot fallback discipline.
 *
 * Read-only preview, not review mode (docs/038 §12): the pane computes each proposal's review from the
 * LIVE snapshot without applying anything to the store — `applyProposal(current, proposal)` yields the
 * proposed snapshot + conflicts, `diffSnapshots(current, proposed)` yields the woven diff, and the
 * block list reuses J4's `reviewCursorEntries`. Whole accept/reject emit host intents; the optimistic
 * apply / moving-baseline / save-gate that make in-store resolution correct are J6, so the pane stays
 * policy-free here (docs/038 §5.6, §14–§16).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, NavIcon } from "@quanghuy1242/idco-ui";
import {
  anchorlessChanges,
  applyProposal,
  diffSnapshots,
  nodeDiffResolver,
  type AnchorlessChange,
  type EditorDocumentSnapshot,
  type EditorStore,
  type NodeId,
  type Proposal,
} from "../../../core";
import {
  reviewCursorEntries,
  type ReviewCursorEntry,
} from "../../review-cursor";
import { activeSuggestionSource, type SuggestionSource } from "../../spi";
import { useReviewSnapshot } from "../../store-hooks";
import { useScrollToFocus } from "./use-reveal-focus";

/** Load proposals from the host source with SWR + a manual refresh + live `subscribe` (§7.3). */
function useProposals(source: SuggestionSource): {
  readonly proposals: readonly Proposal[];
  readonly error: boolean;
  readonly refresh: () => void;
} {
  const [proposals, setProposals] = useState<readonly Proposal[]>([]);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await source.load(controller.signal);
        if (!cancelled) {
          setProposals(loaded);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [source, tick]);
  // An async agent (docs/037) can produce a proposal AFTER load; the host signals via subscribe and we
  // re-load. `subscribe` returns its own unsubscribe, so it is the effect cleanup.
  useEffect(() => source.subscribe(refresh), [source, refresh]);
  return { error, proposals, refresh };
}

/** The `Badge` tones this pane uses (its full `BadgeTone` union is not exported from `@idco/ui`). */
type ReviewTone = "success" | "error" | "warning" | "info";

/** Badge tone for a proposal lifecycle status. */
function statusTone(status: Proposal["status"]): ReviewTone {
  if (status === "accepted") return "success";
  if (status === "rejected") return "error";
  return "info";
}

/** Badge tone for a per-block change status (the woven color vocabulary, docs/038 §9). */
function blockTone(status: ReviewCursorEntry["status"]): ReviewTone {
  switch (status) {
    case "added":
      return "success";
    case "removed":
      return "error";
    case "moved":
      return "warning";
    default:
      return "info";
  }
}

/** The lucide icon (nav-icons) for each anchorless bucket. */
function anchorlessIcon(kind: AnchorlessChange["kind"]): string {
  if (kind === "conflict") return "TriangleAlert";
  if (kind === "settings") return "Settings";
  return "BookA";
}

/** The computed review of one proposal against the live document (read-only preview, docs/038 §12). */
type ProposalReview = {
  readonly blockChanges: readonly ReviewCursorEntry[];
  readonly anchorless: readonly AnchorlessChange[];
  readonly stats: string;
};

/** The "+A −R ~C ⇄M" scope line, only the non-zero parts. */
function statsLine(stats: {
  added: number;
  removed: number;
  changed: number;
  moved: number;
}): string {
  const parts: string[] = [];
  if (stats.added > 0) parts.push(`+${stats.added}`);
  if (stats.removed > 0) parts.push(`−${stats.removed}`);
  if (stats.changed > 0) parts.push(`~${stats.changed}`);
  if (stats.moved > 0) parts.push(`⇄${stats.moved}`);
  return parts.length > 0 ? parts.join(" ") : "No block changes";
}

function ProposalCard(props: {
  readonly proposal: Proposal;
  readonly current: EditorDocumentSnapshot;
  readonly store: EditorStore;
  readonly source: SuggestionSource;
  readonly reveal: (id: NodeId) => void;
  readonly refresh: () => void;
  readonly focused: boolean;
}) {
  const { proposal, current, store, source, reveal, refresh, focused } = props;
  // Derive the whole review — apply the ops by identity, diff the result, split block-anchored vs
  // anchorless — and pass the store's registry so a custom object's `diffData` gives field-level detail
  // and its steps apply faithfully in the throwaway apply store. Keyed on the document REVISION (docs/036
  // D15), not the `current` object, so the expensive apply+diff runs only on a real content change: a
  // caret-only move is a stepless commit that mints a fresh `useReviewSnapshot` object but leaves
  // `revision` untouched (editor-store.ts:1351), and must not re-diff every proposal on navigation.
  const revision = current.revision ?? 0;
  const review: ProposalReview = useMemo(() => {
    const application = applyProposal(current, proposal, {
      registry: store.registry,
    });
    const diff = diffSnapshots(current, application.snapshot, {
      getNodeDefinition: nodeDiffResolver(store.registry),
    });
    return {
      anchorless: anchorlessChanges(diff, application.conflicts),
      blockChanges: reviewCursorEntries(diff),
      stats: statsLine(diff.stats),
    };
    // `current`/`store` are read but not in deps: `revision` is the content-change signal (a byte-
    // identical `current` shares it), and `store` is stable for the pane's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal, revision, store]);

  // baseVersion is the revision the proposal was made against (docs/036 D15); if the live document
  // moved past it, some ops may have re-resolved or conflicted — label it so the reviewer knows.
  const stale = proposal.baseVersion !== (current.revision ?? 0);
  const pending = proposal.status === "pending";

  return (
    <div
      className={`grid gap-2 rounded-box border border-base-200 p-2 ${
        focused ? "ring-2 ring-primary" : ""
      }`}
      data-engine-changes-proposal={proposal.id}
      data-focus-key={proposal.id}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <NavIcon name={proposal.author.kind === "agent" ? "Bot" : "UserCog"} />
        <span className="font-medium">{proposal.author.label}</span>
        <span className="opacity-50">{proposal.createdAt}</span>
        <span className="ml-auto" />
        <Badge size="sm" tone={statusTone(proposal.status)}>
          {proposal.status}
        </Badge>
        {stale ? (
          <Badge size="sm" tone="warning">
            older version
          </Badge>
        ) : null}
      </div>

      <div className="text-xs font-medium text-base-content/60">
        {review.stats}
      </div>

      {review.blockChanges.length > 0 ? (
        <ul className="grid gap-1">
          {review.blockChanges.map((entry) => (
            <li key={entry.id}>
              <button
                className="flex w-full items-center gap-2 rounded-box border border-base-200 px-2 py-1 text-left text-sm outline-none hover:border-primary"
                onClick={() => reveal(entry.revealId)}
                title="Jump to this change"
                type="button"
              >
                <Badge size="sm" tone={blockTone(entry.status)}>
                  {entry.status}
                </Badge>
                <span className="truncate">{entry.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {review.anchorless.length > 0 ? (
        <section className="grid gap-1 rounded-box bg-base-200/50 p-2">
          {/* The load-bearing §17 job: these changes have no block to weave onto, so they are reviewed
              here rather than in the document — a reviewer would otherwise never see them. */}
          <h4 className="text-[0.7rem] font-semibold uppercase tracking-wide text-base-content/50">
            Reviewed here (no place in the document)
          </h4>
          {review.anchorless.map((change) => (
            <div
              className="flex items-start gap-2 text-sm"
              data-engine-changes-anchorless={change.kind}
              key={change.key}
            >
              <NavIcon name={anchorlessIcon(change.kind)} />
              <span className="text-base-content/80">{change.summary}</span>
            </div>
          ))}
        </section>
      ) : null}

      {pending ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            iconName="X"
            onClick={() => {
              void (async () => {
                await source.reject(proposal.id);
                refresh();
              })();
            }}
            size="sm"
            variant="ghost"
          >
            Reject
          </Button>
          <Button
            iconName="Check"
            onClick={() => {
              void (async () => {
                await source.accept(proposal.id);
                refresh();
              })();
            }}
            size="sm"
            variant="primary"
          >
            Accept
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ChangesPaneBody(props: {
  readonly store: EditorStore;
  readonly source: SuggestionSource;
  readonly reveal: (id: NodeId) => void;
  readonly focusId?: string;
}) {
  const { store, source, reveal, focusId } = props;
  const { proposals, error, refresh } = useProposals(source);
  const listRef = useScrollToFocus(focusId);
  // The live snapshot to diff proposals against, via the shipped commit-only `useReviewSnapshot`: it
  // subscribes to `subscribeCommit` (NOT selection), computes `toSnapshot()` lazily during render, and
  // caches a stable reference between commits — so the pane never snapshots on the keystroke path, and a
  // pure re-render reuses the same `current`. (A stepless caret-move commit still mints a fresh object;
  // `ProposalCard` keys its diff on `current.revision` so that navigation does not re-diff, docs/030
  // SLP-1 keeps the snapshot itself incremental.)
  const current = useReviewSnapshot(store);

  if (error) {
    return (
      <div className="grid gap-2 p-3" data-engine-changes="">
        <p className="rounded-box bg-warning/10 p-2 text-xs text-base-content/70">
          Couldn’t reach the suggestion host — no proposed changes to show.
        </p>
      </div>
    );
  }

  const pending = proposals.filter((p) => p.status === "pending");
  const resolved = proposals.filter((p) => p.status !== "pending");

  const card = (proposal: Proposal) => (
    <ProposalCard
      current={current}
      focused={proposal.id === focusId}
      key={proposal.id}
      proposal={proposal}
      refresh={refresh}
      reveal={reveal}
      source={source}
      store={store}
    />
  );

  return (
    <div className="grid gap-3 p-3" data-engine-changes="" ref={listRef}>
      <section className="grid gap-2">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-base-content/50">
          Proposed
          {pending.length > 0 ? (
            <Badge size="sm" tone="info">
              {pending.length}
            </Badge>
          ) : null}
        </h3>
        {pending.length === 0 ? (
          <p className="text-xs text-base-content/50">No proposed changes.</p>
        ) : (
          pending.map(card)
        )}
      </section>
      {resolved.length > 0 ? (
        <section className="grid gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/50">
            Resolved
          </h3>
          {resolved.map(card)}
        </section>
      ) : null}
    </div>
  );
}

/**
 * The Changes dock pane body (docs/038 §17). Gated by the dock to a registered `SuggestionSource`; the
 * null guard is belt-and-braces. Lists the document's proposals, each with its scope, its jump-to
 * block changes, and the anchorless remainder that only this pane can surface.
 */
export function ChangesPane(props: {
  readonly store: EditorStore;
  readonly reveal: (id: NodeId) => void;
  readonly focusId?: string;
}) {
  const { store, reveal, focusId } = props;
  const source = activeSuggestionSource();
  if (!source) {
    return (
      <p className="p-6 text-center text-sm text-base-content/60">
        No suggestion source is connected.
      </p>
    );
  }
  return (
    <ChangesPaneBody
      focusId={focusId}
      reveal={reveal}
      source={source}
      store={store}
    />
  );
}
