/**
 * Broken-reference detection (docs/027 §9.6) — the Review-side payoff of the docs/026
 * resolve lifecycle.
 *
 * A reference block (media, linked post, embed) whose `resolve` failed or whose ref
 * dangles renders its snapshot fallback (docs/026 §7.3) and carries an `invalid` /
 * `unresolved` object status. That stale state is an *editorial* problem the author
 * should see before publishing, so Review turns the engine's existing per-block
 * knowledge into a list. Pure: it reads the object statuses the store already holds —
 * no new resolve, no host call.
 */
import type { EditorStore, JsonObject, NodeId } from "../../../core";

export type BrokenRef = {
  readonly node: NodeId;
  readonly type: string;
  /** `invalid` (resolve failed / bad data) or `unresolved` (never resolved / dangling). */
  readonly status: "invalid" | "unresolved";
  /** A human label from the stale snapshot (last good title/alt) or the ref/type. */
  readonly label: string;
};

function labelFor(data: JsonObject, fallback: string): string {
  const snapshot = data.snapshot as JsonObject | undefined;
  const fromSnapshot = snapshot?.title ?? snapshot?.alt;
  if (typeof fromSnapshot === "string" && fromSnapshot.length > 0) {
    return fromSnapshot;
  }
  if (typeof data.ref === "string" && data.ref.length > 0) return data.ref;
  return fallback;
}

/**
 * Every reference block whose resolve failed or whose ref dangles (docs/027 §9.6).
 * The label prefers the last-good snapshot so a dangling ref is recognizable, not
 * blank — the same stale-but-useful copy the block itself paints (docs/026 §7.3).
 */
export function brokenReferences(store: EditorStore): BrokenRef[] {
  const out: BrokenRef[] = [];
  for (const id of store.order) {
    const node = store.getNode(id);
    if (node?.kind !== "object") continue;
    if (node.status !== "invalid" && node.status !== "unresolved") continue;
    out.push({
      label: labelFor(node.data as JsonObject, node.type),
      node: id,
      status: node.status,
      type: node.type,
    });
  }
  return out;
}
