/**
 * The mirror-assignability guard (docs/039 §5.2, §14, P1). The reader mirrors the engine's diff
 * types as structural supertypes so `diffSnapshots`' output flows into `<DiffView>` and every shared
 * reader atom with no cast. That relation is the seam the whole consolidation rests on: if a future
 * engine field breaks it, every shared reader function breaks at its call site. This file makes the
 * relation a compile-time assertion — the identity function below type-checks ONLY while the engine
 * `SnapshotDiff` is assignable to the reader `ReaderSnapshotDiff`, so a drift fails `pnpm typecheck`.
 * Fix a red here by WIDENING the mirror, never by casting at the boundary.
 */
import { describe, expect, it } from "vitest";
import type { SnapshotDiff } from "../../packages/editor/src/core";
import type { ReaderSnapshotDiff } from "@quanghuy1242/idco-reader";

// The load-bearing check: no cast. This compiles only while the engine diff is a subtype of the
// reader mirror. `diffSnapshots(base, target): SnapshotDiff` is what a host passes into `<DiffView>`.
const mirrorGuard = (diff: SnapshotDiff): ReaderSnapshotDiff => diff;

describe("diff mirror assignability", () => {
  it("engine SnapshotDiff assigns to the reader mirror with no cast", () => {
    // The guarantee is at compile time (the function body `=> diff`); this asserts it exists.
    expect(typeof mirrorGuard).toBe("function");
  });
});
