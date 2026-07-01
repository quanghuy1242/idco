/**
 * Object-node diff through the `diffData` node-definition seam (docs/036 §5.6, D6, R6-E).
 *
 * Why this file exists
 * --------------------
 * The core stores an object node's `data` as opaque JSON and must not guess its
 * meaning — the same boundary that stops it baking or serializing an object
 * without the node's definition. So the default object diff is deliberately
 * shallow: compare `status`, then compare `data` by value, and report the block
 * `changed` with *no* field detail when they differ (§8, never a silent
 * "unchanged"). A node type that wants field-level granularity implements
 * `NodeDefinition.diffData` (the mirror of `plainText`/`anchors`); the host passes
 * it through `DiffOptions.getNodeDefinition` and this file calls it.
 *
 * `baked` is intentionally not compared: it is derived from `data`, so a
 * baked-only difference with equal `data` and `status` is a re-bake, not a content
 * change (§8).
 */
import type { ObjectNode } from "../model";
import { jsonEqual } from "./attrs";
import type { ObjectDiff, ObjectDiffDefinition } from "./types";

/** A resolved object diff plus whether the node changed at all (drives the block status). */
export type ObjectDiffResult = {
  readonly object: ObjectDiff;
  readonly changed: boolean;
};

/**
 * Diff two versions of one object node: status, then data via the `diffData` seam or a shallow value compare (§5.6).
 *
 * With a `definition.diffData` seam the result carries field-level
 * `ObjectFieldChange[]`; without it the node is `changed` at block granularity on
 * any `data` difference, with no `fields`. `baked` is not compared (a re-bake is
 * not a change).
 */
export function diffObject(
  base: ObjectNode,
  target: ObjectNode,
  definition?: ObjectDiffDefinition,
): ObjectDiffResult {
  const statusChanged = base.status !== target.status;
  const seam = definition?.diffData;
  if (seam) {
    const fields = seam(base.data, target.data);
    return {
      changed: statusChanged || fields.length > 0,
      object: fields.length > 0 ? { fields, statusChanged } : { statusChanged },
    };
  }
  const dataChanged = !jsonEqual(base.data, target.data);
  return { changed: statusChanged || dataChanged, object: { statusChanged } };
}
