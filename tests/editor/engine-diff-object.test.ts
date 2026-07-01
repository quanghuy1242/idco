/**
 * Object-node diff (docs/036 R6-E, §5.6, D6): shallow status+data by default,
 * field-level detail through the `diffData` seam, and baked-only as a non-change.
 */
import { describe, expect, it } from "vitest";
import {
  diffObject,
  diffSnapshots,
  makeObjectNode,
  type NodeId,
  type ObjectFieldChange,
} from "../../packages/editor/src/core";
import { alloc, object, snap } from "./diff-fixtures";

function obj(
  id: NodeId,
  data: Parameters<typeof makeObjectNode>[0]["data"],
  extra?: Partial<Parameters<typeof makeObjectNode>[0]>,
) {
  return makeObjectNode({
    data,
    id,
    status: "ready",
    type: "widget",
    ...extra,
  });
}

describe("diffObject — default shallow compare (R6-E)", () => {
  it("reports a status change with no field detail", () => {
    const id = "idco_node_o1" as NodeId;
    const result = diffObject(
      obj(id, { n: 1 }, { status: "ready" }),
      obj(id, { n: 1 }, { status: "dirty" }),
    );
    expect(result.changed).toBe(true);
    expect(result.object.statusChanged).toBe(true);
    expect(result.object.fields).toBeUndefined();
  });

  it("reports a data change as changed with no field detail (no seam)", () => {
    const id = "idco_node_o2" as NodeId;
    const result = diffObject(obj(id, { n: 1 }), obj(id, { n: 2 }));
    expect(result.changed).toBe(true);
    expect(result.object.statusChanged).toBe(false);
    expect(result.object.fields).toBeUndefined();
  });

  it("treats a baked-only difference (equal data and status) as unchanged", () => {
    const id = "idco_node_o3" as NodeId;
    const result = diffObject(
      obj(id, { n: 1 }, { baked: { kind: "w", payload: 1 } }),
      obj(id, { n: 1 }, { baked: { kind: "w", payload: 999 } }),
    );
    expect(result.changed).toBe(false);
    expect(result.object.statusChanged).toBe(false);
  });

  it("treats an identical object as unchanged", () => {
    const id = "idco_node_o4" as NodeId;
    expect(diffObject(obj(id, { n: 1 }), obj(id, { n: 1 })).changed).toBe(
      false,
    );
  });
});

describe("diffObject — the diffData seam (R6-E, D6)", () => {
  it("uses field-level detail from the definition", () => {
    const id = "idco_node_o5" as NodeId;
    const definition = {
      diffData(base: unknown, target: unknown): readonly ObjectFieldChange[] {
        const b = base as { rows: number };
        const t = target as { rows: number };
        return b.rows === t.rows
          ? []
          : [{ base: b.rows, path: "rows", target: t.rows }];
      },
      type: "widget",
    };
    const result = diffObject(
      obj(id, { rows: 2 }),
      obj(id, { rows: 5 }),
      definition,
    );
    expect(result.changed).toBe(true);
    expect(result.object.fields).toEqual([
      { base: 2, path: "rows", target: 5 },
    ]);
  });

  it("routes through diffSnapshots via getNodeDefinition", () => {
    const a = alloc("obj_snap");
    const id = a.createNodeId();
    const base = snap([object(a, "widget", { rows: 1 }, { id })]);
    const target = snap([object(a, "widget", { rows: 3 }, { id })]);
    const diff = diffSnapshots(base, target, {
      getNodeDefinition: (type) =>
        type === "widget"
          ? {
              diffData: (b, t) => [
                {
                  base: (b as { rows: number }).rows,
                  path: "rows",
                  target: (t as { rows: number }).rows,
                },
              ],
              type,
            }
          : undefined,
    });
    const block = diff.blocks[0]!;
    expect(block.status).toBe("changed");
    expect(block.object?.fields).toEqual([
      { base: 1, path: "rows", target: 3 },
    ]);
  });
});
