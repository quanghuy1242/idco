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
import { isRecord } from "@quanghuy1242/idco-lib";
import type { EditorStore, JsonObject, NodeId } from "../../../core";

export type BrokenRef = {
  readonly node: NodeId;
  readonly type: string;
  /** `invalid` (resolve failed / bad data) or `unresolved` (no record picked / dangling). */
  readonly status: "invalid" | "unresolved";
  /** A human label from the stale snapshot (last good title/alt) or the ref/type. */
  readonly label: string;
  /** What the author can do about it, in one line. */
  readonly message: string;
};

function snapshotOf(data: JsonObject): JsonObject | undefined {
  const snapshot = data.snapshot;
  return isRecord(snapshot) ? (snapshot as JsonObject) : undefined;
}

/**
 * Whether the block has a usable persisted projection — an image src, a post
 * url/title. Such a block renders fine from its snapshot (docs/026 §7.3) even when
 * `unresolved`, so it is *not* a broken reference (it is a plain inline asset, not a
 * dangling pointer the author must fix). This is what keeps a pasted/inline image off
 * the broken list (docs/027 §9.6, the false-positive guard).
 */
function hasUsableSnapshot(data: JsonObject): boolean {
  const snapshot = snapshotOf(data);
  if (!snapshot) return false;
  return ["src", "url", "title"].some(
    (key) => typeof snapshot[key] === "string" && snapshot[key].length > 0,
  );
}

function labelFor(data: JsonObject, fallback: string): string {
  const snapshot = snapshotOf(data);
  const fromSnapshot = snapshot?.title ?? snapshot?.alt;
  if (typeof fromSnapshot === "string" && fromSnapshot.length > 0) {
    return fromSnapshot;
  }
  if (typeof data.ref === "string" && data.ref.length > 0) return data.ref;
  return fallback;
}

/**
 * Every reference block the author must act on (docs/027 §9.6): a failed resolve
 * (`invalid` — the linked record is gone or returned bad data) or a block that has no
 * record picked and no usable snapshot to fall back on (`unresolved` + empty). A block
 * that still renders from a good snapshot is deliberately excluded — it is not broken,
 * just not live-resolved (docs/026 §7.3), so it does not clutter the list with a
 * non-actionable entry.
 */
export function brokenReferences(store: EditorStore): BrokenRef[] {
  const out: BrokenRef[] = [];
  for (const id of store.order) {
    const node = store.getNode(id);
    if (node?.kind !== "object") continue;
    const data = node.data as JsonObject;
    if (node.status === "invalid") {
      out.push({
        label: labelFor(data, node.type),
        message: "Couldn’t resolve — the linked record may have been deleted.",
        node: id,
        status: "invalid",
        type: node.type,
      });
    } else if (node.status === "unresolved" && !hasUsableSnapshot(data)) {
      out.push({
        label: labelFor(data, node.type),
        message: "No record selected — pick one to complete this block.",
        node: id,
        status: "unresolved",
        type: node.type,
      });
    }
  }
  return out;
}
