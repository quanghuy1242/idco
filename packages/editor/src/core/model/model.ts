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
import { isDevInvariantsEnabled } from "../dev-flags";

/**
 * @categoryDefault Engine Core — Model
 */

/** A JSON primitive: a string, number, boolean, or null. */
export type JsonPrimitive = string | number | boolean | null;

/** Any JSON-serializable value: a primitive, an array of values, or an object. */
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** A JSON object: a readonly string-keyed map of JSON values. */
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

/** A text leaf's content: the UTF-16 string paired with the run-encoded character ids that anchor it. */
export type TextSlice = {
  readonly text: string;
  readonly runs: readonly CharacterRun[];
};

/** A text leaf's content, an alias of `TextSlice`. */
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

/** A caret position in a text leaf: the node, its durable anchor, the working UTF-16 offset, and the caret affinity. */
export type TextPoint = {
  readonly node: NodeId;
  readonly anchor: TextAnchor;
  readonly offset: number;
  readonly assoc?: -1 | 1;
};

/** A range selection inside text, from `anchor` to `focus`. */
export type TextSelection = {
  readonly type: "text";
  readonly anchor: TextPoint;
  readonly focus: TextPoint;
};

/** An atomic selection of one whole node (an object or structural block). */
export type NodeSelection = {
  readonly type: "node";
  readonly node: NodeId;
};

/** A collapsed caret between two children of a scope, rather than inside any one of them. */
export type GapSelection = {
  readonly type: "gap";
  /**
   * The container the gap is in (the body, a callout, a cell, …): a caret
   * between this scope's children rather than inside any one of them (docs/019
   * §4.3). Replaces the former `{ node, side }` shape so an empty scope and the
   * doc/scope edges are expressible, and so a gap is the same coordinate as an
   * insertion target (`InsertionPoint.at`, docs/019 §4.1/§5.1).
   */
  readonly scope: NodeId;
  /** The slot between `children[index - 1]` and `children[index]` of `scope`. */
  readonly index: number;
};

/** The editor's selection: a text range, a node selection, or a gap caret. */
export type EditorSelection = TextSelection | NodeSelection | GapSelection;

/**
 * Structural equality for two text points.
 *
 * Compares only the fields that make a point distinct — node, character/edge
 * anchor, offset, and association side — without serializing. Lives in `model`
 * (next to the selection types, no store dependency) so `dispatch` can compare
 * selections without a `JSON.stringify` round-trip on the keystroke/drag path.
 */
export function pointsEqual(a: TextPoint, b: TextPoint): boolean {
  if (a.node !== b.node || a.offset !== b.offset || a.assoc !== b.assoc) {
    return false;
  }
  const aa = a.anchor;
  const ba = b.anchor;
  if (aa.kind !== ba.kind) return false;
  return aa.kind === "char"
    ? aa.id === (ba as Extract<TextAnchor, { kind: "char" }>).id
    : aa.edge === (ba as Extract<TextAnchor, { kind: "edge" }>).edge;
}

/**
 * Whether two selections are equal. Used by `dispatch` to set the `selection`
 * dirty flag (docs/011 §8.x) — it replaces a `JSON.stringify` !== `JSON.stringify`
 * compare that allocated two strings on every keystroke and every drag-extend
 * frame. This version allocates nothing and short-circuits on the first
 * differing field (the common "caret moved one character" case exits on
 * `offset`).
 */
export function selectionsEqual(
  a: EditorSelection | null,
  b: EditorSelection | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.type !== b.type) return false;
  if (a.type === "text") {
    const other = b as TextSelection;
    return (
      pointsEqual(a.anchor, other.anchor) && pointsEqual(a.focus, other.focus)
    );
  }
  if (a.type === "node") {
    return a.node === (b as NodeSelection).node;
  }
  const other = b as GapSelection;
  return a.scope === other.scope && a.index === other.index;
}

/**
 * Inline mark kinds. The built-in literals keep autocomplete and exhaustiveness for
 * the engine's own marks; the `(string & {})` arm opens the set to registry-driven
 * kinds (a host's `registerMark`, docs/027 §16 P7) without dropping the literals —
 * the same openness `StructuralNodeType` has for nodes. A registered kind is a real
 * mark without being named here; whether its id/attrs distinguish segments is decided
 * by the identity registry (`registerIdentityMark`, marks.ts), not by this union.
 */
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
  | "glossary"
  | (string & {});

export type MarkBoundary = {
  readonly anchor: TextAnchor;
  readonly offset: number;
  readonly stickiness: "before" | "after";
};

/** One mark over a half-open character range of a text leaf: its kind, boundaries, and optional attrs. */
export type TextMark = {
  readonly id: string;
  readonly kind: TextMarkKind;
  readonly from: MarkBoundary;
  readonly to: MarkBoundary;
  readonly attrs?: JsonObject;
};

/** The persisted block-type set for a text leaf: paragraph, heading, list item, or quote. */
export type TextLeafType = "paragraph" | "heading" | "listitem" | "quote";

/**
 * The structural container kinds. The built-in literals keep autocomplete and
 * exhaustiveness for the engine's own types; the `(string & {})` arm opens the
 * set to registry-driven types (a `StructuralDefinition`, the table's
 * `table`/`tablerow`/`tablecell`) without dropping the literals (docs/021 §8.1).
 * Scope membership stays by `kind === "structural"`, not by this union, so a
 * registered type is a scope without being named here.
 */
export type StructuralNodeType =
  | "body"
  | "list"
  | "listitem"
  | "quote"
  | "callout"
  | (string & {});

/** An object node's lifecycle status: baked and `ready`, `dirty`, `invalid`, or `unresolved`. */
export type ObjectNodeStatus = "ready" | "dirty" | "invalid" | "unresolved";

/** An object's static baked snapshot: a discriminating `kind` and its JSON payload. */
export type BakedSnapshot = {
  readonly kind: string;
  readonly payload: JsonValue;
};

/** Fields common to every editor node: its id, type, and optional attrs bag. */
export type BaseEditorNode = {
  readonly id: NodeId;
  readonly type: string;
  readonly attrs?: JsonObject;
};

/** A structural container node that owns an ordered list of child node ids. */
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

/** A heavy/object node holding opaque `data`, its baked snapshot, and a lifecycle status. */
export type ObjectNode = BaseEditorNode & {
  readonly kind: "object";
  readonly data: JsonValue;
  readonly baked?: BakedSnapshot;
  readonly status: ObjectNodeStatus;
};

/** Any node in the model: a structural container, a text leaf, or an object. */
export type EditorNode = StructuralNode | TextLeafNode | ObjectNode;

/** A node's place in the tree: its parent id and index among that parent's children. */
export type ParentEntry = {
  readonly parent: NodeId;
  readonly index: number;
};

/** Document-level settings, an opaque JSON bag carried on the snapshot. */
export type DocumentSettings = JsonObject;

export type EditorSnapshotNode = EditorNode;

/**
 * One item in a document-owned collection (docs/027 §5.1). The model core stores
 * opaque items and leaves the shape to the registered collection (a `GlossaryTerm`, a
 * future `Citation`), exactly as the node registry stores opaque object `data`. The
 * only field the core relies on is `id`: it is what a reference mark's attr points at
 * (`attrs: { term: id }`, docs/027 §4.1).
 */
export type CollectionItem = JsonObject & { readonly id: string };

/** JSON-serializable owned-model persistence shape, not the mutable store. */
export type EditorDocumentSnapshot = {
  readonly version: 1;
  readonly body: {
    readonly order: readonly NodeId[];
    readonly blocks: Readonly<Record<NodeId, EditorSnapshotNode>>;
  };
  readonly settings: DocumentSettings;
  /**
   * Document-owned reference data (docs/027 §5.1): a keyed bag of opaque item
   * arrays — `collections.glossary` holds `GlossaryTerm[]`, a future
   * `collections.bibliography` holds `Citation[]`. One generic slot, many tenants;
   * the model core knows none of the shapes. Optional and omitted when empty so a
   * document with no collections serializes byte-identically to before (§5.4).
   */
  readonly collections?: Readonly<Record<string, readonly CollectionItem[]>>;
};

/**
 * One node of the legacy rich-text compat JSON shape — the import-only boundary format the compat layer reads, never a persistence target.
 *
 * @category Compat (import-only)
 */
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

/**
 * The legacy rich-text compat document shape (a `root` of compat nodes) — the import-only boundary format, never a persistence target.
 *
 * @category Compat (import-only)
 */
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

/** Create an id allocator for a client: it mints node ids and run-encoded text slices with monotonic clocks. */
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

/** Build a text point at a UTF-16 offset, choosing the durable character/edge anchor and caret affinity. */
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

/** Build a mark boundary at a UTF-16 offset, anchoring it for the given before/after stickiness of a half-open range. */
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

/** Construct a frozen text leaf node (paragraph by default) from content, marks, and attrs. */
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

/** Construct a frozen structural container node from its type, children, and attrs. */
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

/** Construct a frozen object node from its type, opaque data, optional baked snapshot, and status (`dirty` by default). */
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

/**
 * A fresh, editable single-paragraph document (note.md §5.6, D3).
 *
 * `createEditorStore` does not seed a block, and an empty `body.order: []` has no
 * caret target — the surface accepts no keyboard input because there is nowhere to
 * place a caret. A consumer opening a brand-new document (no stored snapshot) uses
 * this instead of hand-building the seed paragraph through `makeTextNode` /
 * `createIdAllocator`. The seed id is minted from a fresh allocator with a random
 * client id, a separate id space from the store's own allocator, so
 * `createEditorStore({ allocator: createIdAllocator(), snapshot: emptyDocument() })`
 * never collides.
 */
export function emptyDocument(): EditorDocumentSnapshot {
  const allocator = createIdAllocator();
  const paragraph = makeTextNode({
    content: allocator.createTextSlice(""),
    id: allocator.createNodeId(),
    type: "paragraph",
  });
  return {
    body: {
      blocks: { [paragraph.id]: paragraph },
      order: [paragraph.id],
    },
    settings: {},
    version: 1,
  };
}

export function freezeNode<T extends EditorNode>(node: T): T {
  /*
   * Store mutation happens by replacing node objects in a mutable Map. Freezing
   * makes accidental mutation of a retained node fail loudly and keeps object
   * identity meaningful for per-node subscribers.
   *
   * The freeze is a *dev-only immutability tripwire* (docs/030 §7.5 D5, SLP-2): it
   * is an O(n) deep walk over attrs/runs/marks/baked paid on every node
   * construction *and* across the whole document on load. Identity (a fresh object
   * per change) — not frozenness — is what per-node subscribers rely on, so in
   * production the freeze buys nothing and only stalls open. Gate it off there so
   * the load and edit hot paths skip the walk entirely; dev/test keep it firing.
   */
  if (!isDevInvariantsEnabled()) return node;
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
