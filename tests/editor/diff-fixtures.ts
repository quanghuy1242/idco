/**
 * Shared builders for the diff-engine tests (docs/036 R6-A…E).
 *
 * These construct owned-model snapshots by hand with real allocators, so a test
 * controls character-id lineage precisely: reuse one allocator (and
 * `replaceTextContent`) to simulate a same-document edit that preserves ids (the
 * identity path), or use two allocators to force disjoint lineage (the text
 * fallback). Kept out of the test files so all six diff suites share one vocabulary.
 */
import {
  boundaryAtOffset,
  createIdAllocator,
  type CollectionItem,
  type DocumentSettings,
  type EditorDocumentSnapshot,
  type EditorNode,
  type IdAllocator,
  type JsonObject,
  type JsonValue,
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  type NodeId,
  type ObjectNodeStatus,
  type StructuralNodeType,
  type TextLeafNode,
  type TextLeafType,
  type TextMark,
  type TextMarkKind,
} from "../../packages/editor/src/core";

export function alloc(seed: string): IdAllocator {
  return createIdAllocator(`idco_client_${seed}` as `idco_client_${string}`);
}

export function leaf(
  a: IdAllocator,
  text: string,
  options?: {
    readonly id?: NodeId;
    readonly type?: TextLeafType;
    readonly attrs?: JsonObject;
    readonly marks?: readonly TextMark[];
  },
): TextLeafNode {
  return makeTextNode({
    attrs: options?.attrs,
    content: a.createTextSlice(text),
    id: options?.id ?? a.createNodeId(),
    marks: options?.marks,
    type: options?.type ?? "paragraph",
  });
}

export function container(
  a: IdAllocator,
  type: StructuralNodeType,
  children: readonly EditorNode[],
  options?: { readonly id?: NodeId; readonly attrs?: JsonObject },
): EditorNode {
  return makeStructuralNode({
    attrs: options?.attrs,
    children: children.map((child) => child.id),
    id: options?.id ?? a.createNodeId(),
    type,
  });
}

export function object(
  a: IdAllocator,
  type: string,
  data: JsonValue,
  options?: {
    readonly id?: NodeId;
    readonly status?: ObjectNodeStatus;
    readonly baked?: { readonly kind: string; readonly payload: JsonValue };
  },
): EditorNode {
  return makeObjectNode({
    baked: options?.baked,
    data,
    id: options?.id ?? a.createNodeId(),
    status: options?.status ?? "ready",
    type,
  });
}

export function mark(
  node: TextLeafNode,
  id: string,
  kind: TextMarkKind,
  from: number,
  to: number,
  attrs?: JsonObject,
): TextMark {
  return {
    from: boundaryAtOffset(node.content, from, "before"),
    id,
    kind,
    to: boundaryAtOffset(node.content, to, "after"),
    ...(attrs ? { attrs } : {}),
  };
}

/**
 * Assemble a snapshot from an explicit top-level order plus every node (nested
 * children included) so containers resolve their `children` ids.
 */
export function snap(
  order: readonly EditorNode[],
  extra?: {
    readonly nested?: readonly EditorNode[];
    readonly settings?: DocumentSettings;
    readonly collections?: Readonly<Record<string, readonly CollectionItem[]>>;
  },
): EditorDocumentSnapshot {
  const all = [...order, ...(extra?.nested ?? [])];
  return {
    body: {
      blocks: Object.fromEntries(all.map((n) => [n.id, n])) as Record<
        NodeId,
        EditorNode
      >,
      order: order.map((n) => n.id),
    },
    settings: extra?.settings ?? {},
    version: 1,
    ...(extra?.collections ? { collections: extra.collections } : {}),
  };
}
