/**
 * The Suggestion Source SPI + the anchorless-change router (docs/036 §7.3, docs/038 §17, R6-J J5).
 *
 * Two pure, headless halves of J5, both testable without a live editor:
 *   1. `registerSuggestionSource` & friends — the host-owned proposal registry, the exact sibling
 *      shape of the comment-source registry (module singleton, register-by-id, idempotent,
 *      registration-order listing, `active` = first).
 *   2. `anchorlessChanges(diff, conflicts)` — the load-bearing §17 split: the changes with no
 *      `[data-engine-block-id]` to weave onto (conflicts, settings, collections) that the Changes pane
 *      must surface because the woven overlay cannot. Proven both against hand-built minimal diffs (the
 *      routing/summarizing logic in isolation) and end-to-end against the real engine (a proposal
 *      applied against a document where its text target was deleted → a real conflict + a real
 *      collection change route to the pane).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  anchorlessChanges,
  applyProposal,
  createEditorStore,
  createIdAllocator,
  diffSnapshots,
  getSuggestionSource,
  listSuggestionSources,
  activeSuggestionSource,
  registerSuggestionSource,
  unregisterSuggestionSource,
  type Proposal,
  type ProposalAuthor,
  type SuggestionSource,
} from "../../packages/editor/src";
import type {
  AttrDiff,
  CollectionDiff,
  NodeId,
  ProposalConflict,
  ProposalConflictReason,
  SnapshotDiff,
  Step,
} from "../../packages/editor/src/core";
import { alloc, leaf, snap } from "./diff-fixtures";

const AGENT: ProposalAuthor = {
  id: "agent-1",
  kind: "agent",
  label: "Assistant",
};

/** A no-op host source; only `id` matters for the registry tests. */
function fakeSource(id: string): SuggestionSource {
  return {
    accept: async () => {},
    create: async (proposal) => ({
      ...proposal,
      id: "created",
      status: "pending",
    }),
    id,
    load: async () => [],
    reject: async () => {},
    subscribe: () => () => {},
    update: async () => {},
  };
}

/** A minimal `SnapshotDiff` carrying only the fields the router reads. */
function diffWith(parts: {
  readonly settingsChanged?: boolean;
  readonly settingsDetail?: AttrDiff;
  readonly collections?: readonly CollectionDiff[];
}): SnapshotDiff {
  return {
    base: {} as SnapshotDiff["base"],
    blocks: [],
    collections: parts.collections ?? [],
    settingsChanged: parts.settingsChanged ?? false,
    stats: { added: 0, changed: 0, moved: 0, removed: 0 },
    target: {} as SnapshotDiff["target"],
    ...(parts.settingsDetail ? { settingsDetail: parts.settingsDetail } : {}),
  };
}

const conflictOf = (
  reason: ProposalConflictReason,
  node: NodeId | null = null,
): ProposalConflict => ({ node, op: {} as Step, reason });

describe("SuggestionSource registry (sibling of the comment source, R6-J J5)", () => {
  afterEach(() => {
    // listSuggestionSources returns a fresh array copy, so unregistering during iteration is safe.
    for (const source of listSuggestionSources())
      unregisterSuggestionSource(source.id);
  });

  it("registers, gets, lists in registration order, and reports the first as active", () => {
    expect(activeSuggestionSource()).toBeUndefined();
    registerSuggestionSource(fakeSource("host-a"));
    registerSuggestionSource(fakeSource("host-b"));
    expect(listSuggestionSources().map((s) => s.id)).toEqual([
      "host-a",
      "host-b",
    ]);
    expect(getSuggestionSource("host-b")?.id).toBe("host-b");
    // Active is the first registered, matching activeCommentSource.
    expect(activeSuggestionSource()?.id).toBe("host-a");
  });

  it("is idempotent by id (a re-register replaces, HMR/test-safe) and unregisters", () => {
    registerSuggestionSource(fakeSource("host-a"));
    const replacement = fakeSource("host-a");
    registerSuggestionSource(replacement);
    expect(listSuggestionSources()).toHaveLength(1);
    expect(getSuggestionSource("host-a")).toBe(replacement);
    unregisterSuggestionSource("host-a");
    expect(getSuggestionSource("host-a")).toBeUndefined();
    expect(activeSuggestionSource()).toBeUndefined();
  });
});

describe("anchorlessChanges — the §17 pane split (R6-J J5)", () => {
  it("returns nothing when the whole proposal is anchor-resolvable", () => {
    expect(anchorlessChanges(diffWith({}), [])).toEqual([]);
  });

  it("routes each conflict with its reason and target node", () => {
    const out = anchorlessChanges(diffWith({}), [
      conflictOf("target-deleted", "idco_node_a" as NodeId),
      conflictOf("text-anchor-lost"),
      conflictOf("apply-failed"),
    ]);
    expect(out.map((c) => c.kind)).toEqual([
      "conflict",
      "conflict",
      "conflict",
    ]);
    expect(out[0]!.conflictReason).toBe("target-deleted");
    expect(out[0]!.node).toBe("idco_node_a");
    expect(out[0]!.summary).toContain("target block was deleted");
    expect(out[1]!.summary).toContain("text it edited has changed");
    expect(out[2]!.summary).toContain("document moved under it");
  });

  it("routes a settings change with a field count", () => {
    const detail: AttrDiff = {
      added: {},
      changed: { theme: { base: "light", target: "dark" } },
      removed: {},
    };
    const out = anchorlessChanges(
      diffWith({ settingsChanged: true, settingsDetail: detail }),
      [],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("settings");
    expect(out[0]!.summary).toBe("Document settings changed (1 field).");
  });

  it("routes only collections that actually changed, summarizing the non-zero parts", () => {
    const out = anchorlessChanges(
      diffWith({
        collections: [
          {
            added: ["g1", "g2"],
            changed: [],
            key: "glossary",
            removed: ["g3"],
          },
          // A union-key entry with no change is filtered out, not shown as a no-op row.
          { added: [], changed: [], key: "bibliography", removed: [] },
        ],
      }),
      [],
    );
    expect(out.map((c) => c.collectionKey)).toEqual(["glossary"]);
    expect(out[0]!.summary).toBe("Glossary changed — 2 added, 1 removed.");
  });

  it("orders the buckets conflicts → settings → collections", () => {
    const out = anchorlessChanges(
      diffWith({
        collections: [
          { added: ["g1"], changed: [], key: "glossary", removed: [] },
        ],
        settingsChanged: true,
      }),
      [conflictOf("target-deleted")],
    );
    expect(out.map((c) => c.kind)).toEqual([
      "conflict",
      "settings",
      "collection",
    ]);
  });
});

describe("anchorlessChanges — end-to-end against the real engine (R6-J J5)", () => {
  it("surfaces a real deleted-target conflict and a real collection change from a proposal", () => {
    // A base with two paragraphs; author a proposal that edits A's text AND adds a glossary term, both
    // as REAL captured steps (so they carry genuine identity + a valid set-collection op).
    const a = alloc("j5-base");
    const A = leaf(a, "alpha");
    const B = leaf(a, "beta");
    const base = snap([A, B]);

    const authorStore = createEditorStore({
      allocator: createIdAllocator("idco_client_author"),
      snapshot: base,
    });
    const ops: Step[] = [];
    const off = authorStore.subscribeCommit((c) => ops.push(...c.steps));
    authorStore.dispatch(
      authorStore
        .transaction()
        .replaceText({ at: 5, inserted: "!", node: A.id, removed: "" }),
    );
    authorStore.dispatch(
      authorStore
        .transaction()
        .setCollection("glossary", [{ id: "g1", term: "Alpha" }]),
    );
    off();

    const proposal: Proposal = {
      author: AGENT,
      baseVersion: 0,
      createdAt: "2026-07-02T00:00:00Z",
      id: "p1",
      ops,
      status: "pending",
    };

    // The reviewer already deleted A: the text op can no longer anchor → a target-deleted conflict; the
    // glossary op still applies. This is exactly the pane's derivation.
    const current = snap([B]);
    const application = applyProposal(current, proposal);
    const diff = diffSnapshots(current, application.snapshot);
    const out = anchorlessChanges(diff, application.conflicts);

    const conflict = out.find((c) => c.kind === "conflict");
    const collection = out.find((c) => c.kind === "collection");
    expect(conflict?.conflictReason).toBe("target-deleted");
    expect(conflict?.node).toBe(A.id);
    expect(collection?.collectionKey).toBe("glossary");
    expect(collection?.summary).toContain("1 added");
    // No settings op in the proposal, so nothing settings-routed.
    expect(out.some((c) => c.kind === "settings")).toBe(false);
  });
});
