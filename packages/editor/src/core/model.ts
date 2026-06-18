/**
 * Core data vocabulary for the owned-model editor.
 *
 * Why this file exists
 * --------------------
 * The new engine needs a document model that is not the DOM, not Lexical
 * editor state, and not the old rich-text JSON wire format. This file defines
 * that model's stable vocabulary: node ids, character ids, text anchors,
 * selections, mark ranges, structural nodes, object nodes, snapshots, and the
 * small helpers that keep those shapes internally consistent.
 *
 * The important architectural split is:
 *
 * - `EditorDocumentSnapshot` is JSON-serializable persistence/interchange.
 * - `EditorStore` in `store.ts` is the hot-path runtime container.
 * - `RichTextCompatDocument` is only the old boundary shape handled by
 *   `compat.ts`.
 *
 * Text identity model
 * -------------------
 * Prose leaves are one string plus run-encoded character ids. Browser input
 * still works in UTF-16 offsets, so offsets remain the working coordinate. The
 * character ids are the durable coordinate for marks and stored points. That is
 * what lets a mark or selection survive insertion before it without being
 * re-derived from formatting output.
 */
export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type JsonObject = { readonly [key: string]: JsonValue };

/**
 * Globally unique, opaque node identity for the owned model.
 *
 * These ids are intentionally not document-local indexes. Persisted selections,
 * marks, parent indexes, and future collaboration adapters all rely on the id
 * remaining stable across reorder and serialization.
 */
export type NodeId = `idco_node_${string}`;

export type ClientId = `idco_client_${string}`;

/** Character identity used by prose leaves as the durable anchor substrate. */
export type CharacterId = {
  readonly client: ClientId;
  readonly clock: number;
};

/**
 * Run-encoded character ids for a text leaf.
 *
 * Offsets stay UTF-16 because browser input reports UTF-16. Character ids are
 * the durable identity layer for marks and stored points.
 */
export type CharacterRun = {
  readonly client: ClientId;
  readonly startClock: number;
  readonly length: number;
};

export type TextSlice = {
  readonly text: string;
  readonly runs: readonly CharacterRun[];
};

export type TextContent = TextSlice;

/**
 * A durable text anchor.
 *
 * Runtime commands work with offsets for browser parity, but stored marks and
 * selections keep an anchor so they can be resolved again after edits.
 */
export type TextAnchor =
  | { readonly kind: "char"; readonly id: CharacterId }
  | { readonly kind: "edge"; readonly edge: "start" | "end" };

export type TextPoint = {
  readonly node: NodeId;
  readonly anchor: TextAnchor;
  readonly offset: number;
  readonly assoc?: -1 | 1;
};

export type TextSelection = {
  readonly type: "text";
  readonly anchor: TextPoint;
  readonly focus: TextPoint;
};

export type NodeSelection = {
  readonly type: "node";
  readonly node: NodeId;
};

export type GapSelection = {
  readonly type: "gap";
  readonly node: NodeId;
  readonly side: "before" | "after";
};

export type EditorSelection = TextSelection | NodeSelection | GapSelection;

export type TextMarkKind =
  | "bold"
  | "italic"
  | "strikethrough"
  | "underline"
  | "code"
  | "subscript"
  | "superscript"
  | "highlight"
  | "link"
  | "comment"
  | "glossary";

export type MarkBoundary = {
  readonly anchor: TextAnchor;
  readonly offset: number;
  readonly stickiness: "before" | "after";
};

export type TextMark = {
  readonly id: string;
  readonly kind: TextMarkKind;
  readonly from: MarkBoundary;
  readonly to: MarkBoundary;
  readonly attrs?: JsonObject;
};

export type TextLeafType =
  | "paragraph"
  | "heading"
  | "listitem"
  | "quote"
  | "callout";

export type StructuralNodeType =
  | "body"
  | "list"
  | "listitem"
  | "quote"
  | "callout";

export type ObjectNodeStatus = "ready" | "dirty" | "invalid" | "unresolved";

export type BakedSnapshot = {
  readonly kind: string;
  readonly payload: JsonValue;
};

export type BaseEditorNode = {
  readonly id: NodeId;
  readonly type: string;
  readonly attrs?: JsonObject;
};

export type StructuralNode = BaseEditorNode & {
  readonly kind: "structural";
  readonly type: StructuralNodeType;
  readonly children: readonly NodeId[];
};

/**
 * Text leaf: one model node, one string, many possible marks.
 *
 * A paragraph with bold and italic spans is not stored as split child nodes.
 * Split nodes are generated only by `compat.ts` when the legacy JSON format
 * needs them.
 */
export type TextLeafNode = BaseEditorNode & {
  readonly kind: "text";
  readonly type: TextLeafType;
  readonly content: TextContent;
  readonly marks: readonly TextMark[];
};

export type ObjectNode = BaseEditorNode & {
  readonly kind: "object";
  readonly data: JsonValue;
  readonly baked?: BakedSnapshot;
  readonly status: ObjectNodeStatus;
};

export type EditorNode = StructuralNode | TextLeafNode | ObjectNode;

export type ParentEntry = {
  readonly parent: NodeId;
  readonly index: number;
};

export type DocumentSettings = JsonObject;

export type EditorSnapshotNode = EditorNode;

/** JSON-serializable owned-model persistence shape, not the mutable store. */
export type EditorDocumentSnapshot = {
  readonly version: 1;
  readonly body: {
    readonly order: readonly NodeId[];
    readonly blocks: Readonly<Record<NodeId, EditorSnapshotNode>>;
  };
  readonly settings: DocumentSettings;
};

export type RichTextCompatNode = {
  readonly id?: string;
  readonly type: string;
  readonly text?: string;
  readonly children?: readonly RichTextCompatNode[];
  readonly tag?: string;
  readonly anchorId?: string;
  readonly language?: string;
  readonly mediaId?: string;
  readonly alt?: string;
  readonly caption?: string;
  readonly postId?: string;
  readonly title?: string;
  readonly url?: string;
  readonly tone?: string;
  readonly format?: number | string;
  readonly listType?: string;
  readonly start?: number;
  readonly value?: number;
  readonly checked?: boolean;
  readonly minLevel?: number;
  readonly maxLevel?: number;
  readonly numbering?: string;
  readonly style?: string;
  readonly placement?: string;
  readonly side?: string;
  readonly baked?: BakedSnapshot;
  readonly status?: ObjectNodeStatus;
  readonly [key: string]: unknown;
};

export type RichTextCompatDocument = {
  readonly root: {
    readonly children: readonly RichTextCompatNode[];
  };
  readonly settings?: DocumentSettings;
};

/** Allocates ids for nodes and the character runs inside inserted text. */
export type IdAllocator = {
  readonly clientId: ClientId;
  createNodeId(): NodeId;
  createTextSlice(text: string): TextSlice;
};

export function createIdAllocator(
  clientId: ClientId = randomClientId(),
): IdAllocator {
  let nodeClock = 0;
  let charClock = 0;
  return {
    clientId,
    createNodeId() {
      nodeClock += 1;
      return `idco_node_${clientId.slice("idco_client_".length)}_${nodeClock}`;
    },
    createTextSlice(text: string) {
      const length = text.length;
      if (length === 0) return { text, runs: [] };
      const startClock = charClock + 1;
      charClock += length;
      return { text, runs: [{ client: clientId, length, startClock }] };
    },
  };
}

/** Rebuild a run-encoded slice from explicit character ids. */
export function createTextSliceFromIds(
  text: string,
  ids: readonly CharacterId[],
): TextSlice {
  if (text.length !== ids.length) {
    throw new Error("Text slice id count must match UTF-16 length");
  }
  return { text, runs: compressCharacterIds(ids) };
}

export function characterIdsForSlice(slice: TextSlice): readonly CharacterId[] {
  return slice.runs.flatMap((run) =>
    Array.from({ length: run.length }, (_value, index) => ({
      client: run.client,
      clock: run.startClock + index,
    })),
  );
}

/** Return a text slice preserving the original character ids. */
export function sliceTextContent(
  content: TextContent,
  from: number,
  to: number,
): TextSlice {
  assertTextRange(content, from, to);
  const ids = characterIdsForSlice(content).slice(from, to);
  return createTextSliceFromIds(content.text.slice(from, to), ids);
}

/** Replace text while preserving surviving character ids around the edit. */
export function replaceTextContent(
  content: TextContent,
  at: number,
  removedLength: number,
  inserted: TextSlice,
): TextContent {
  assertTextRange(content, at, at + removedLength);
  const ids = characterIdsForSlice(content);
  const nextIds = [
    ...ids.slice(0, at),
    ...characterIdsForSlice(inserted),
    ...ids.slice(at + removedLength),
  ];
  const text =
    content.text.slice(0, at) +
    inserted.text +
    content.text.slice(at + removedLength);
  return createTextSliceFromIds(text, nextIds);
}

export function pointAtOffset(
  node: NodeId,
  content: TextContent,
  offset: number,
  assoc: -1 | 1 = offset >= content.text.length ? 1 : -1,
): TextPoint {
  /*
   * Points carry both the browser-facing offset and the durable anchor. The
   * anchor chosen here is deliberately local to the existing text content:
   * - offset at end anchors to the previous character with forward affinity;
   * - offset inside text anchors to the character at that offset;
   * - empty text falls back to an edge anchor.
   */
  if (offset < 0 || offset > content.text.length) {
    throw new Error(`Point offset ${offset} is outside text length`);
  }
  const ids = characterIdsForSlice(content);
  if (ids.length === 0) {
    return {
      anchor: { edge: "start", kind: "edge" },
      assoc,
      node,
      offset: 0,
    };
  }
  if (offset >= ids.length) {
    return {
      anchor: { id: ids[ids.length - 1]!, kind: "char" },
      assoc: 1,
      node,
      offset,
    };
  }
  return {
    anchor: { id: ids[offset]!, kind: "char" },
    assoc,
    node,
    offset,
  };
}

export function boundaryAtOffset(
  content: TextContent,
  offset: number,
  stickiness: "before" | "after",
): MarkBoundary {
  /*
   * Marks use half-open ranges [from, to). A trailing boundary such as `to: 4`
   * should stick after the previous character, not before the next one, or an
   * exported mark would grow by one character when resolved later.
   */
  const point =
    stickiness === "after" && offset > 0
      ? pointAtOffset("idco_node_boundary" as NodeId, content, offset - 1, 1)
      : pointAtOffset("idco_node_boundary" as NodeId, content, offset, -1);
  return { anchor: point.anchor, offset, stickiness };
}

export function resolvePointOffset(
  content: TextContent,
  point: Pick<TextPoint, "anchor" | "assoc" | "offset">,
): number {
  return resolveAnchorOffset(content, point.anchor, point.assoc, point.offset);
}

export function resolveBoundaryOffset(
  content: TextContent,
  boundary: MarkBoundary,
): number {
  return resolveAnchorOffset(
    content,
    boundary.anchor,
    boundary.stickiness === "after" ? 1 : -1,
    boundary.offset,
  );
}

export function makeTextNode(args: {
  readonly id: NodeId;
  readonly type?: TextLeafType;
  readonly content: TextContent;
  readonly attrs?: JsonObject;
  readonly marks?: readonly TextMark[];
}): TextLeafNode {
  return freezeNode({
    attrs: args.attrs,
    content: args.content,
    id: args.id,
    kind: "text",
    marks: args.marks ?? [],
    type: args.type ?? "paragraph",
  });
}

export function makeStructuralNode(args: {
  readonly id: NodeId;
  readonly type: StructuralNodeType;
  readonly children?: readonly NodeId[];
  readonly attrs?: JsonObject;
}): StructuralNode {
  return freezeNode({
    attrs: args.attrs,
    children: args.children ?? [],
    id: args.id,
    kind: "structural",
    type: args.type,
  });
}

export function makeObjectNode(args: {
  readonly id: NodeId;
  readonly type: string;
  readonly data: JsonValue;
  readonly baked?: BakedSnapshot;
  readonly status?: ObjectNodeStatus;
  readonly attrs?: JsonObject;
}): ObjectNode {
  return freezeNode({
    attrs: args.attrs,
    baked: args.baked,
    data: args.data,
    id: args.id,
    kind: "object",
    status: args.status ?? "dirty",
    type: args.type,
  });
}

export function freezeNode<T extends EditorNode>(node: T): T {
  /*
   * Store mutation happens by replacing node objects in a mutable Map. Freezing
   * makes accidental mutation of a retained node fail loudly and keeps object
   * identity meaningful for per-node subscribers.
   */
  if (node.attrs) Object.freeze(node.attrs);
  if (node.kind === "structural") Object.freeze(node.children);
  if (node.kind === "text") {
    Object.freeze(node.content.runs);
    Object.freeze(node.content);
    Object.freeze(node.marks);
  }
  if (node.kind === "object" && node.baked) Object.freeze(node.baked);
  return Object.freeze(node);
}

function resolveAnchorOffset(
  content: TextContent,
  anchor: TextAnchor,
  assoc: -1 | 1 | undefined,
  fallback: number,
): number {
  if (anchor.kind === "edge") {
    return anchor.edge === "start" ? 0 : content.text.length;
  }
  const index = findCharacterOffset(content, anchor.id);
  if (index === -1) {
    return Math.max(0, Math.min(content.text.length, fallback));
  }
  return assoc === 1 ? index + 1 : index;
}

function findCharacterOffset(content: TextContent, id: CharacterId): number {
  let offset = 0;
  for (const run of content.runs) {
    if (
      run.client === id.client &&
      id.clock >= run.startClock &&
      id.clock < run.startClock + run.length
    ) {
      return offset + id.clock - run.startClock;
    }
    offset += run.length;
  }
  return -1;
}

function compressCharacterIds(
  ids: readonly CharacterId[],
): readonly CharacterRun[] {
  const runs: CharacterRun[] = [];
  for (const id of ids) {
    const previous = runs.at(-1);
    if (
      previous &&
      previous.client === id.client &&
      previous.startClock + previous.length === id.clock
    ) {
      runs[runs.length - 1] = { ...previous, length: previous.length + 1 };
      continue;
    }
    runs.push({ client: id.client, length: 1, startClock: id.clock });
  }
  return runs;
}

function assertTextRange(content: TextContent, from: number, to: number): void {
  if (from < 0 || to < from || to > content.text.length) {
    throw new Error(`Text range [${from}, ${to}) is outside text length`);
  }
}

function randomClientId(): ClientId {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && "randomUUID" in cryptoApi) {
    return `idco_client_${cryptoApi.randomUUID().replace(/-/g, "")}`;
  }
  return `idco_client_${Math.random().toString(36).slice(2)}`;
}
