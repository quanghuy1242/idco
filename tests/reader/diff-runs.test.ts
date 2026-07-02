/**
 * `partitionTextRuns` (docs/039 §6.2 Atom 1) — the shared text-run partition both surfaces render.
 * These prove the pure contract: the slices tile the union text, offsets track base/target
 * coordinates, character ids pass through on the identity path, and a `keep` run under a changed
 * mark is flagged.
 */
import { describe, expect, it } from "vitest";
import {
  partitionTextRuns,
  type ReaderTextLeafDiff,
} from "@quanghuy1242/idco-reader";

const leafDiff = (
  runs: ReaderTextLeafDiff["runs"],
  markChanges: ReaderTextLeafDiff["markChanges"] = [],
): ReaderTextLeafDiff => ({ alignment: "id", markChanges, runs });

describe("partitionTextRuns", () => {
  it("tags runs and tracks base/target offsets", () => {
    const slices = partitionTextRuns(
      leafDiff([
        { op: "keep", text: "The " },
        { ids: [{ client: "c", clock: 1 }], op: "insert", text: "very " },
        { op: "keep", text: "quick " },
        { op: "delete", text: "brown " },
        { op: "keep", text: "fox" },
      ]),
    );
    expect(slices.map((s) => s.op)).toEqual([
      "keep",
      "insert",
      "keep",
      "delete",
      "keep",
    ]);
    // Union text (target-then-deleted order) equals the slices concatenated.
    expect(slices.map((s) => s.text).join("")).toBe("The very quick brown fox");
    // The insert advances only target; the delete only base; a keep advances both.
    expect(slices[1]).toMatchObject({ baseOffset: 4, targetOffset: 4 });
    expect(slices[3]).toMatchObject({ baseOffset: 10, targetOffset: 15 });
    expect(slices[4]).toMatchObject({ baseOffset: 16, targetOffset: 15 });
  });

  it("passes character ids through on the identity path", () => {
    const slices = partitionTextRuns(
      leafDiff([{ ids: [{ client: "c", clock: 7 }], op: "insert", text: "x" }]),
    );
    expect(slices[0]?.ids).toEqual([{ client: "c", clock: 7 }]);
  });

  it("flags a keep run that overlaps a changed mark (target coordinates)", () => {
    const slices = partitionTextRuns(
      leafDiff(
        [
          { op: "keep", text: "bold" },
          { op: "keep", text: " plain" },
        ],
        [{ from: 0, kind: "bold", op: "added", to: 4 }],
      ),
    );
    // First keep (target 0..4) overlaps the added mark; the second (4..10) does not.
    expect(slices[0]?.markChanged).toBe(true);
    expect(slices[1]?.markChanged).toBe(false);
  });

  it("does not flag a keep run for a removed mark (no surviving run to underline)", () => {
    const slices = partitionTextRuns(
      leafDiff(
        [{ op: "keep", text: "text" }],
        [{ from: 0, kind: "bold", op: "removed", to: 4 }],
      ),
    );
    expect(slices[0]?.markChanged).toBe(false);
  });
});
