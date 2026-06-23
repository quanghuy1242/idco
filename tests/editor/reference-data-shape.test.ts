/**
 * docs/026 §4.3 / §14.7 / RB-3 — the `{ ref, snapshot, local }` data helpers.
 *
 * Proves the projected-vs-author-local split that keeps a `resolve` from
 * clobbering an author-typed field (docs/026 §7.2): `setReference` (the pick
 * commit) replaces the snapshot wholesale, `patchSnapshot` (the resolve) merges
 * projected keys, and both preserve `ref` and `local`.
 */
import { describe, expect, it } from "vitest";
import {
  localRecord,
  patchSnapshot,
  refField,
  setReference,
  snapshotRecord,
} from "../../packages/editor/src/view/object-data";

describe("reference-block data helpers (docs/026 §4.3)", () => {
  it("reads ref, snapshot, and local from data", () => {
    const data = {
      local: { caption: "C" },
      ref: "p1",
      snapshot: { title: "Hi" },
    };
    expect(refField(data)).toBe("p1");
    expect(snapshotRecord(data)).toEqual({ title: "Hi" });
    expect(localRecord(data)).toEqual({ caption: "C" });
  });

  it("defaults to empty for missing or non-object data", () => {
    expect(refField({})).toBe("");
    expect(snapshotRecord({})).toEqual({});
    expect(localRecord(null)).toEqual({});
    expect(refField(undefined)).toBe("");
  });

  it("setReference replaces the snapshot and preserves ref + local (the pick)", () => {
    const data = {
      local: { caption: "Keep" },
      ref: "old",
      snapshot: { title: "Old", url: "/old" },
    };
    const next = setReference(data, "new", { title: "New", url: "/new" });
    expect(next.ref).toBe("new");
    // A different record: the snapshot is replaced, not merged.
    expect(next.snapshot).toEqual({ title: "New", url: "/new" });
    expect(next.local).toEqual({ caption: "Keep" });
  });

  it("patchSnapshot merges projected keys, preserving ref + local (the resolve)", () => {
    const data = {
      local: { caption: "Keep" },
      ref: "p1",
      snapshot: { title: "Old", url: "/x" },
    };
    const next = patchSnapshot(data, { title: "Fresh" });
    expect(next.ref).toBe("p1");
    // The same record refreshed: title updates, url survives, caption untouched.
    expect(next.snapshot).toEqual({ title: "Fresh", url: "/x" });
    expect(next.local).toEqual({ caption: "Keep" });
  });
});
