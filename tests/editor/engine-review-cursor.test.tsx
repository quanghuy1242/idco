// @vitest-environment jsdom
/**
 * The review cursor (docs/038 §7, R6-J J4). Asserts the pure stops/detail derivation
 * (`reviewCursorEntries` — top-level changed blocks in order; `reviewEntryDetail` — a one-line
 * summary per change shape) and the `useReviewCursor` navigation (next/prev wrap + reveal, goTo, and
 * the load-bearing behavior: keeping the cursor on the SAME block across a re-diff when a change is
 * resolved, rather than snapping to index 0).
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  BlockDiff,
  NodeId,
  SnapshotDiff,
} from "../../packages/editor/src/core";
import {
  reviewCursorEntries,
  reviewEntryDetail,
  useReviewCursor,
} from "../../packages/editor/src";

/** A minimal SnapshotDiff carrying only the fields the cursor reads (`blocks[].id/.status/...`). */
function diffOf(blocks: Partial<BlockDiff>[]): SnapshotDiff {
  return {
    base: {} as SnapshotDiff["base"],
    blocks: blocks as BlockDiff[],
    collections: [],
    settingsChanged: false,
    stats: { added: 0, changed: 0, moved: 0, removed: 0 },
    target: {} as SnapshotDiff["target"],
  };
}
// Loosely-typed so a test can use short string ids ("a") without the `idco_node_` NodeId brand.
const block = (b: Record<string, unknown>): Partial<BlockDiff> =>
  b as Partial<BlockDiff>;
const nid = (s: string): NodeId => s as NodeId;
/** A changed text leaf whose runs drive the character-count summary. */
const textLeaf = (runs: { op: string; text: string }[]): BlockDiff =>
  ({
    status: "changed",
    text: { alignment: "id", markChanges: [], runs },
  }) as unknown as BlockDiff;

describe("reviewEntryDetail (docs/038 §6 → one line)", () => {
  it("names whole add / remove / move", () => {
    expect(reviewEntryDetail(block({ status: "added" }) as BlockDiff)).toBe(
      "Block added",
    );
    expect(reviewEntryDetail(block({ status: "removed" }) as BlockDiff)).toBe(
      "Block removed",
    );
    expect(
      reviewEntryDetail(block({ status: "moved" }) as BlockDiff),
    ).toContain("Moved");
  });

  it("counts inserted / deleted characters of a text edit", () => {
    expect(reviewEntryDetail(textLeaf([{ op: "insert", text: "abcd" }]))).toBe(
      "4 characters inserted",
    );
    expect(reviewEntryDetail(textLeaf([{ op: "delete", text: "x" }]))).toBe(
      "1 character deleted",
    );
    expect(
      reviewEntryDetail(
        textLeaf([
          { op: "insert", text: "abc" },
          { op: "delete", text: "de" },
        ]),
      ),
    ).toBe("3 characters in, 2 out");
  });

  it("reports a mark-only change and an attr change as formatting, de-duplicated", () => {
    const markOnly = {
      status: "changed",
      text: { alignment: "id", markChanges: [{ op: "removed" }], runs: [] },
    } as unknown as BlockDiff;
    expect(reviewEntryDetail(markOnly)).toBe("Formatting changed");
    const attrsAndMark = {
      attrs: { added: {}, changed: { align: {} }, removed: {} },
      status: "changed",
      text: { alignment: "id", markChanges: [{ op: "removed" }], runs: [] },
    } as unknown as BlockDiff;
    // Both say "Formatting changed" — de-duplicated to one.
    expect(reviewEntryDetail(attrsAndMark)).toBe("Formatting changed");
  });

  it("reports object fields and nested container changes", () => {
    expect(
      reviewEntryDetail({
        object: { fields: [{}, {}], statusChanged: false },
        status: "changed",
      } as unknown as BlockDiff),
    ).toBe("2 fields changed");
    expect(
      reviewEntryDetail({
        children: [
          { status: "unchanged" },
          { status: "changed" },
          { status: "changed" },
        ],
        status: "changed",
      } as unknown as BlockDiff),
    ).toBe("2 nested changes");
  });

  it("falls back to 'Changed' for an unnamed shape", () => {
    expect(reviewEntryDetail(block({ status: "changed" }) as BlockDiff)).toBe(
      "Changed",
    );
  });
});

describe("reviewCursorEntries", () => {
  it("lists changed top-level blocks in order, skipping unchanged; null → empty", () => {
    const entries = reviewCursorEntries(
      diffOf([
        block({ id: "a", status: "changed" }),
        block({ id: "b", status: "unchanged" }),
        block({ id: "c", status: "added" }),
      ]),
    );
    expect(entries.map((e) => e.id)).toEqual(["a", "c"]);
    expect(entries[1]!.detail).toBe("Block added");
    // A present change reveals itself.
    expect(entries[0]!.revealId).toBe("a");
    expect(reviewCursorEntries(null)).toEqual([]);
  });

  it("reveals a removed change via the surviving neighbor ABOVE the gap (ghost stays on screen)", () => {
    // Prefer the PRECEDING survivor so scrolling it to the top leaves the ghost visible below it
    // (Finding 1a); a leading removal with nothing above falls back to the FOLLOWING survivor.
    const entries = reviewCursorEntries(
      diffOf([
        block({ id: "lead", status: "removed" }), // leading removal → no block above
        block({ id: "keep1", status: "changed" }),
        block({ id: "mid", status: "removed" }),
        block({ id: "keep2", status: "unchanged" }),
        block({ id: "trail", status: "removed" }), // trailing removal
      ]),
    );
    const byId = new Map(entries.map((e) => [e.id as string, e.revealId]));
    expect(byId.get("lead")).toBe("keep1"); // nothing above → following survivor
    expect(byId.get("mid")).toBe("keep1"); // survivor above the gap
    expect(byId.get("trail")).toBe("keep2"); // survivor above the gap
  });

  it("falls back to the removed block's own id when the whole document was removed", () => {
    const entries = reviewCursorEntries(
      diffOf([
        block({ id: "x", status: "removed" }),
        block({ id: "y", status: "removed" }),
      ]),
    );
    expect(entries[0]!.revealId).toBe("x");
    expect(entries[1]!.revealId).toBe("y");
  });
});

describe("useReviewCursor navigation", () => {
  it("starts at 0, wraps next/prev, and reveals each landing", () => {
    const onReveal = vi.fn<(id: unknown) => void>();
    const diff = diffOf([
      block({ id: "a", status: "changed" }),
      block({ id: "b", status: "added" }),
      block({ id: "c", status: "moved" }),
    ]);
    const { result } = renderHook(() => useReviewCursor(diff, { onReveal }));
    expect(result.current.index).toBe(0);
    expect(result.current.current?.id).toBe("a");
    expect(result.current.count).toBe(3);

    act(() => result.current.next());
    expect(result.current.current?.id).toBe("b");
    expect(onReveal).toHaveBeenLastCalledWith("b");

    act(() => result.current.next()); // → c
    act(() => result.current.next()); // wraps → a
    expect(result.current.current?.id).toBe("a");

    act(() => result.current.prev()); // wraps back → c
    expect(result.current.current?.id).toBe("c");
    expect(onReveal).toHaveBeenLastCalledWith("c");

    act(() => result.current.goTo(nid("b")));
    expect(result.current.current?.id).toBe("b");
    act(() => result.current.goTo(nid("nope"))); // no-op for a non-changed id
    expect(result.current.current?.id).toBe("b");
  });

  it("keeps the cursor on the same block across a re-diff, advancing sanely when it resolves", () => {
    const onReveal = vi.fn<(id: unknown) => void>();
    const three = diffOf([
      block({ id: "a", status: "changed" }),
      block({ id: "b", status: "changed" }),
      block({ id: "c", status: "changed" }),
    ]);
    const { result, rerender } = renderHook(
      ({ d }) => useReviewCursor(d, { onReveal }),
      { initialProps: { d: three } },
    );
    act(() => result.current.next()); // → b (index 1)
    expect(result.current.current?.id).toBe("b");

    // "b" is resolved and drops out of the diff; the cursor should not snap to index 0 — it lands on
    // the block now occupying b's slot (c), the sane "advance to the next pending change" behavior.
    const afterResolveB = diffOf([
      block({ id: "a", status: "changed" }),
      block({ id: "c", status: "changed" }),
    ]);
    rerender({ d: afterResolveB });
    expect(result.current.current?.id).toBe("c");
    expect(result.current.count).toBe(2);
  });

  it("reports index -1 / current null when there are no changes", () => {
    const { result } = renderHook(() => useReviewCursor(diffOf([])));
    expect(result.current.index).toBe(-1);
    expect(result.current.current).toBeNull();
    expect(result.current.count).toBe(0);
    // next/prev are no-ops on an empty cursor.
    act(() => result.current.next());
    expect(result.current.index).toBe(-1);
  });
});
