/**
 * Native snapshot-fragment clipboard (docs/030 §7.2 D2, MIO-2).
 *
 * Markdown export is *lossy* (D2): it drops merged cells, comment/glossary marks, and object
 * internals markdown cannot carry. So in-app editor→editor copy/paste must NOT ride markdown
 * — it rides a custom clipboard type, `application/x-idco-snapshot`, carrying the native
 * fragment verbatim (marks, object `data`, structural nesting intact). Paste reads this type
 * first and only falls back to markdown/HTML/plain when it is absent (the Google-Docs pattern:
 * own format plus a portable one). This is what removes the pressure that made bidirectional
 * markdown seem necessary — internal fidelity rides here, so export's lossiness never degrades
 * an in-app workflow.
 *
 * Copy emits the fragment only for a *block-level* selection (a node selection, or a text
 * selection spanning ≥2 top-level blocks); a partial single-block selection copies as
 * markdown/plain so an inline copy pastes inline, not as a whole block. The fragment is the
 * same `{ order, blocks }` shape markdown import produces, so both paste paths share
 * `compileInsertFragment`.
 */
import { isRecord } from "@quanghuy1242/idco-lib";
import type { EditorNode, EditorStore, NodeId } from "../../core";

/**
 * @categoryDefault Markdown I/O
 */

/** The custom clipboard MIME for the lossless native snapshot fragment (`application/x-idco-snapshot`). */
export const IDCO_SNAPSHOT_MIME = "application/x-idco-snapshot";

const FRAGMENT_VERSION = 1;

/** A serializable native fragment (the copy payload / the markdown-import output shape). */
export type SnapshotFragment = {
  readonly order: readonly NodeId[];
  readonly blocks: Readonly<Record<NodeId, EditorNode>>;
};

/** Serialize a fragment to the clipboard string (a versioned JSON envelope). */
export function serializeFragment(fragment: SnapshotFragment): string {
  return JSON.stringify({
    blocks: fragment.blocks,
    order: fragment.order,
    version: FRAGMENT_VERSION,
  });
}

/**
 * Parse a clipboard string back into a fragment, or null when it is not a valid idco
 * fragment. Validates enough that insertion cannot crash on a malformed payload (it is our
 * own MIME, but the clipboard is still untrusted input): every `order` id must resolve to a
 * block with a known `kind`, and every structural child id must resolve too.
 */
export function parseFragment(raw: string): SnapshotFragment | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== FRAGMENT_VERSION) return null;
  const order = parsed.order;
  const blocks = parsed.blocks;
  if (!Array.isArray(order) || !isRecord(blocks)) return null;
  if (!order.every((id) => typeof id === "string")) return null;
  const typedBlocks = blocks as Record<string, unknown>;
  // Every referenced node (top-level and structural descendant) must be a well-formed node.
  const seen = new Set<string>();
  const validateNode = (id: string): boolean => {
    if (seen.has(id)) return true;
    seen.add(id);
    const node = typedBlocks[id];
    if (!isEditorNode(node)) return false;
    if (node.kind === "structural") {
      return node.children.every(
        (childId) => typeof childId === "string" && validateNode(childId),
      );
    }
    return true;
  };
  if (!order.every((id) => validateNode(id as string))) return null;
  return {
    blocks: blocks as Record<NodeId, EditorNode>,
    order: order as NodeId[],
  };
}

/**
 * Gather the native fragment for the current selection, or null when a native copy is not
 * appropriate (a single partial text block, a gap selection). Whole top-level blocks the
 * selection touches are copied with their full descendant subtrees, so a structural callout
 * or a nested list round-trips losslessly.
 */
export function collectSelectionFragment(
  store: EditorStore,
): SnapshotFragment | null {
  const selection = store.selection;
  if (!selection) return null;
  if (selection.type === "node") {
    const node = store.getNode(selection.node);
    if (!node) return null;
    return fragmentForTops(store, [selection.node]);
  }
  if (selection.type !== "text") return null;
  const anchorTop = topLevelAncestor(store, selection.anchor.node);
  const focusTop = topLevelAncestor(store, selection.focus.node);
  if (!anchorTop || !focusTop) return null;
  const order = store.order;
  const a = order.indexOf(anchorTop);
  const b = order.indexOf(focusTop);
  if (a < 0 || b < 0) return null;
  // A native fragment is a *block* copy; a selection inside one block stays inline (markdown/
  // plain), so an inline copy pastes inline rather than replacing with a whole block.
  if (a === b) return null;
  const [from, to] = a <= b ? [a, b] : [b, a];
  return fragmentForTops(store, order.slice(from, to + 1));
}

/** Build a fragment from a set of top-level ids, pulling each subtree from the store. */
function fragmentForTops(
  store: EditorStore,
  tops: readonly NodeId[],
): SnapshotFragment | null {
  const blocks: Record<NodeId, EditorNode> = {};
  const visit = (id: NodeId): void => {
    const node = store.getNode(id);
    if (!node || blocks[id]) return;
    blocks[id] = node;
    if (node.kind === "structural") node.children.forEach(visit);
  };
  for (const id of tops) visit(id);
  if (tops.length === 0) return null;
  return { blocks, order: tops };
}

/** The top-level (direct ROOT child) ancestor of a node, or null when detached. */
function topLevelAncestor(store: EditorStore, id: NodeId): NodeId | null {
  let current: NodeId = id;
  for (let guard = 0; guard < 1000; guard += 1) {
    const entry = store.parentEntry(current);
    if (!entry) return null;
    if (entry.parent === store.bodyId) return current;
    current = entry.parent;
  }
  return null;
}

function isEditorNode(value: unknown): value is EditorNode {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.type !== "string") {
    return false;
  }
  const kind = value.kind;
  if (kind === "structural") return Array.isArray(value.children);
  return kind === "text" || kind === "object";
}
