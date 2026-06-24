/**
 * Comment model logic (docs/027 §7) — anchoring a host thread to the document, the
 * snapshot fallback, and the mutating helpers that keep the host store and the
 * document mark in step.
 *
 * The document's only knowledge of a thread is the comment mark that anchors it
 * (docs/027 §7.3): `attrs: { thread: id, snapshot }`. No body, author, timestamp, or
 * resolved flag is ever stored in the document — those live in the host, reached
 * through the registered `CommentSource`. The snapshot is the thin denormalized copy
 * (§7.3) that lets the editor and the static reader paint without a host call, and the
 * fallback when `load` is unreachable.
 */
import {
  collectSelectionText,
  compileAddRefMark,
  type EditorStore,
  type JsonObject,
  type NodeId,
  type TextLeafNode,
} from "../../../core";
import type { CommentSnapshot, CommentSource } from "../../spi";

/** One comment mark in the document, with its thread ref + persisted snapshot. */
export type CommentMarkEntry = {
  readonly markId: string;
  readonly node: NodeId;
  readonly threadId: string;
  readonly snapshot?: CommentSnapshot;
};

function readSnapshot(
  attrs: JsonObject | undefined,
): CommentSnapshot | undefined {
  const snapshot = attrs?.snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return undefined;
  }
  const record = snapshot as Record<string, unknown>;
  return {
    author: typeof record.author === "string" ? record.author : "",
    excerpt: typeof record.excerpt === "string" ? record.excerpt : "",
    resolved: record.resolved === true,
  };
}

/**
 * Walk the document for comment marks (docs/027 §7.3). The source of the editor's
 * offline view: when the host `load` is unreachable, the pane still paints each thread
 * from its mark's persisted snapshot, and jump-to-anchor resolves the node here.
 */
export function commentMarkEntries(store: EditorStore): CommentMarkEntry[] {
  const out: CommentMarkEntry[] = [];
  for (const id of store.order) {
    const node = store.getNode(id);
    if (node?.kind !== "text") continue;
    for (const mark of (node as TextLeafNode).marks) {
      if (mark.kind !== "comment") continue;
      const threadId = mark.attrs?.thread;
      if (typeof threadId !== "string") continue;
      out.push({
        markId: mark.id,
        node: id,
        snapshot: readSnapshot(mark.attrs),
        threadId,
      });
    }
  }
  return out;
}

/** The node a thread's comment mark anchors to, for jump-to-anchor (docs/027 §7.4). */
export function nodeForThread(
  store: EditorStore,
  threadId: string,
): NodeId | undefined {
  return commentMarkEntries(store).find((entry) => entry.threadId === threadId)
    ?.node;
}

/**
 * Open a comment on the current selection (docs/027 §7.1/§7.3): create the host thread,
 * then anchor it with a comment mark carrying the thread id plus a snapshot. Host-first
 * so the document never holds a dangling ref to a thread the host rejected. Returns the
 * new thread id, or null when there is no text range / the create failed.
 */
export async function addCommentOverSelection(
  store: EditorStore,
  source: CommentSource,
  body: string,
): Promise<string | null> {
  const sel = store.selection;
  if (sel?.type !== "text") return null;
  const excerpt = collectSelectionText(store, sel);
  if (excerpt.length === 0) return null;
  const thread = await source.create({ excerpt, node: sel.focus.node }, body);
  const tr = compileAddRefMark(store, "comment", {
    snapshot: {
      author: thread.author.name,
      excerpt: thread.excerpt,
      resolved: thread.resolved,
    },
    thread: thread.id,
  });
  if (!tr) return null;
  store.dispatch(tr);
  return thread.id;
}

/** Remove every comment mark that references a thread (after the host deletes it). */
export function unanchorThread(store: EditorStore, threadId: string): void {
  const entries = commentMarkEntries(store).filter(
    (entry) => entry.threadId === threadId,
  );
  if (entries.length === 0) return;
  const tr = store.transaction();
  for (const entry of entries) {
    const node = store.getNode(entry.node);
    if (node?.kind !== "text") continue;
    const mark = (node as TextLeafNode).marks.find(
      (m) => m.id === entry.markId,
    );
    if (mark) tr.removeMark(entry.node, mark);
  }
  store.dispatch(tr);
}
