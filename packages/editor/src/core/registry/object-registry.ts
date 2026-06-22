/**
 * Object-block SPI for the owned-model editor — the framework-free half.
 *
 * Why this file exists
 * --------------------
 * Text and structural nodes are understood by the engine. Heavy/object blocks
 * are not: a table, media block, code block, embed, or custom reader widget has
 * internal data that belongs to that object's implementation. The core can
 * store the object, move it, select it atomically, and swap its data through an
 * invertible step, but it should not infer the meaning of arbitrary fields.
 *
 * The `NodeDefinition` contract is the explicit boundary for that: each object
 * kind says how to normalize incoming data, how to import/export the old
 * rich-text JSON representation, and whether its baked/export data is complete.
 *
 * Scope split (note.md CP1): this file owns the object SPI — the
 * `NodeDefinition` contract, the global custom-node registration, and the
 * `BUILT_IN_OBJECT_DEFINITIONS`. The generic runtime registry that holds and
 * resolves definitions (`BlockRegistry` + `createDefaultBlockRegistry`) lives in
 * its sibling `block-registry.ts`; it consumes this file's definitions. The SPI
 * and the runtime were one file (`core/registry.ts`) under a generic name, which
 * buried the SPI; splitting them makes `object-registry.ts` the mirror of
 * `structural-registry.ts`. `compatObjectFromValue` is exported only so the
 * runtime registry's `toCompatObject` fallback can share the one default shape.
 */
import type {
  BakedSnapshot,
  JsonValue,
  ObjectNodeStatus,
  RichTextCompatNode,
} from "../model";

/** Explicit policy for object kinds the registry does not understand. */
export type UnknownObjectPolicy = "reject" | "drop";

export type ObjectNormalizationResult = {
  readonly data: JsonValue;
  readonly baked?: BakedSnapshot;
  readonly status?: ObjectNodeStatus;
};

/** An indexable anchor inside an object's opaque data (docs/016 §6.1). */
export type NodeAnchor = {
  readonly id: string;
  readonly label: string;
};

/**
 * The framework-free half of the node SPI (docs/016 §6.1).
 *
 * Atomic objects own their opaque data. The engine can store, move, select, and
 * invert object-level swaps, but it must not guess how to parse or complete a
 * custom object's internal payload. A `NodeDefinition` is the explicit, DOM-free,
 * worker-safe contract for one object type: its data, its bake, its document-
 * service adapters, and its fine-grained invert. The React half — resting/live
 * render and insert/format affordance — is the `NodeView` paired by `type` in
 * the view layer (docs/016 §6.2). `registerNode` (view) registers both halves.
 *
 * The slots below `bake` are the named-but-optional lifecycle slots (docs/016
 * §6.3): they exist so Phase 8 fills them without reshaping this contract. When a
 * definition omits one, document services fall back to the baked snapshot or the
 * wholesale `SetObjectData` swap — never a silent skip (011 §2.7/§6.5).
 */
export type NodeDefinition = {
  readonly type: string;
  normalizeData(value: unknown): ObjectNormalizationResult;
  fromCompatNode?(node: RichTextCompatNode): ObjectNormalizationResult;
  toCompatNode?(
    value: ObjectNormalizationResult,
  ): Omit<RichTextCompatNode, "id" | "type">;
  isExportComplete?(value: ObjectNormalizationResult): boolean;
  /**
   * Map a Payload/Lexical dialect node to this node's compat shape (note.md W8).
   * The Payload importer (`payload-import`) tries each registered definition's
   * `fromPayload` for a dialect type it has no built-in mapping for, before
   * dropping it — so a host adds a Payload mapping for its custom node without
   * editing the importer. Return `null` for a node this definition does not
   * handle; otherwise return a compat node whose `type` is this definition's
   * `type`, so the normal compat import then resolves it.
   */
  fromPayload?(node: Record<string, unknown>): RichTextCompatNode | null;
  /**
   * Produce the object's static baked snapshot from its opaque data, or `null`
   * when the data cannot bake (e.g. media with no source). Pure compute and
   * DOM-free so the bake can run in the Web Worker (docs/010 §7.5); the engine
   * turns a `null` into a recoverable `invalid` status (Phase 6 AC4) rather than
   * emitting an unbakeable node.
   */
  bake?(data: JsonValue): BakedSnapshot | null;
  /**
   * Object-level plain text for search/index/export (docs/016 §6.1, 011 §2.7).
   * Optional; omitting it makes services treat the object as atomic, never
   * pretending its internals were searched.
   */
  plainText?(data: JsonValue): string;
  /** Indexable internal anchors the object owns (docs/016 §6.1, 011 §2.7). */
  anchors?(data: JsonValue): readonly NodeAnchor[];
  /**
   * Fine-grained invertible object edit (docs/016 §6.1, 011 §6.5). When omitted
   * the engine inverts object edits with the wholesale `SetObjectData` swap.
   */
  applyEdit?(data: JsonValue, patch: JsonValue): JsonValue;
  invertPatch?(patch: JsonValue, dataBefore: JsonValue): JsonValue;
};

/**
 * @deprecated Renamed to {@link NodeDefinition} (docs/016). Kept as an alias so
 * existing callers keep compiling; remove once they migrate.
 */
export type BlockDefinition = NodeDefinition;

/**
 * Globally registered custom node definitions (docs/016 §7). The view's
 * `registerNode` records a custom object's framework-free half here so that every
 * `createDefaultBlockRegistry()` — compat import/export, the bake service — knows
 * it without threading a registry through each call site. Keyed by type, so a
 * re-register (HMR, a re-imported test module) replaces rather than duplicates.
 */
const GLOBAL_NODE_DEFINITIONS = new Map<string, NodeDefinition>();

/** Register a custom node's definition globally (docs/016 §7). Idempotent by type. */
export function registerGlobalNodeDefinition(definition: NodeDefinition): void {
  GLOBAL_NODE_DEFINITIONS.set(definition.type, definition);
}

/** Remove a globally-registered node definition by type (the register twin). */
export function unregisterGlobalNodeDefinition(type: string): void {
  GLOBAL_NODE_DEFINITIONS.delete(type);
}

/** The custom node definitions registered so far (docs/016 §7). */
export function globalNodeDefinitions(): readonly NodeDefinition[] {
  return [...GLOBAL_NODE_DEFINITIONS.values()];
}

/**
 * Minimal Phase 3 definitions for existing object nodes.
 *
 * They preserve data, baked snapshots, and status fields without implementing
 * real bake pipelines. Phase 6 can replace these with richer definitions.
 */
export const BUILT_IN_OBJECT_DEFINITIONS: readonly NodeDefinition[] = [
  codeBlockDefinition(),
  simpleObjectDefinition(
    "media",
    (node) => ({
      data: {
        alt: stringValue(node.alt) ?? "",
        caption: stringValue(node.caption) ?? "",
        mediaId: stringValue(node.mediaId) ?? "",
        src: stringValue(node.src) ?? "",
      },
      status: statusValue(node.status) ?? "ready",
    }),
    (data) => {
      // Media with neither a source URL nor a media id has nothing to render, so
      // it cannot bake. The engine surfaces that as a recoverable `invalid`.
      const record = isJsonObject(data) ? data : {};
      const src = stringValue(record.src) ?? "";
      const mediaId = stringValue(record.mediaId) ?? "";
      if (src.length === 0 && mediaId.length === 0) return null;
      return {
        kind: "media",
        payload: {
          alt: stringValue(record.alt) ?? "",
          caption: stringValue(record.caption) ?? "",
          mediaId,
          src,
        },
      };
    },
    // Caption + alt are the searchable internals of a media node (011 §2.7).
    (data) => {
      const record = isJsonObject(data) ? data : {};
      return [stringValue(record.caption) ?? "", stringValue(record.alt) ?? ""]
        .filter(Boolean)
        .join(" ");
    },
  ),
  simpleObjectDefinition(
    "post-ref",
    (node) => ({
      data: {
        postId: stringValue(node.postId) ?? "",
        title: stringValue(node.title) ?? "",
        url: stringValue(node.url) ?? "",
      },
      status: statusValue(node.status) ?? "ready",
    }),
    // Always bakes — even with no target yet — so a freshly-inserted post-ref
    // renders its (empty-state) block and can then be configured from the gear
    // (docs/018 §2.11 follow-up: insert-then-configure). A truly empty reference
    // renders nothing in the published blog via the content-renderer's own path.
    (data) => {
      const record = isJsonObject(data) ? data : {};
      return {
        kind: "post-ref",
        payload: {
          postId: stringValue(record.postId) ?? "",
          title: stringValue(record.title) ?? "",
          url: stringValue(record.url) ?? "",
        },
      };
    },
    (data) => stringValue((isJsonObject(data) ? data : {}).title) ?? "",
  ),
  simpleObjectDefinition(
    "embed",
    (node) => ({
      data: {
        title: stringValue(node.title) ?? "",
        url: stringValue(node.url) ?? "",
      },
      status: statusValue(node.status) ?? "ready",
    }),
    // Always bakes so a freshly-inserted embed renders an empty-state prompt and
    // is then configured from the gear (insert-then-configure, docs/018 §2.11).
    (data) => {
      const record = isJsonObject(data) ? data : {};
      return {
        kind: "embed",
        payload: {
          title: stringValue(record.title) ?? "",
          url: stringValue(record.url) ?? "",
        },
      };
    },
    (data) => stringValue((isJsonObject(data) ? data : {}).title) ?? "",
  ),
  simpleObjectDefinition(
    "table-of-contents",
    (node) => ({
      data: {
        maxLevel: numberValue(node.maxLevel) ?? 4,
        minLevel: numberValue(node.minLevel) ?? 2,
        numbering: stringValue(node.numbering) ?? "none",
        placement: stringValue(node.placement) ?? "inline",
        side: stringValue(node.side) ?? "right",
        style: stringValue(node.style) ?? "default",
        title: stringValue(node.title) ?? "On this page",
      },
      status: statusValue(node.status) ?? "ready",
    }),
    // The TOC bakes its settings; the actual entries are derived per-document by
    // `buildDocumentIndex` (bake.ts), since they depend on the surrounding headings.
    (data) => ({ kind: "toc", payload: isJsonObject(data) ? data : {} }),
  ),
  dividerDefinition(),
];

/**
 * `divider` (horizontal rule) — the simplest object node, and the worked example
 * proving the node SPI end to end (docs/016 §8). It carries no data, always
 * bakes, and contributes no search text. The corpus stores it as `horizontalrule`
 * (docs/017 §3.4); that dialect alias is the Phase 8 import adapter's job, not
 * this definition's.
 */
function dividerDefinition(): NodeDefinition {
  return {
    bake: () => ({ kind: "divider", payload: {} }),
    fromCompatNode: () => ({ data: {}, status: "ready" }),
    normalizeData: () => ({ data: {}, status: "ready" }),
    plainText: () => "",
    toCompatNode: () => ({}),
    type: "divider",
  };
}

function codeBlockDefinition(): NodeDefinition {
  /*
   * `code-block` is the one Phase 3 object whose internal DSA matters now. Compat
   * JSON still uses a plain `text` field, but the owned model stores a
   * piece-table-shaped body under `data.code` so later code editing does not need
   * a persistence migration from string to piece table.
   */
  return {
    bake(data) {
      // A code block always bakes: the static snapshot is the resolved source
      // text plus its language and line count, the publish/reader representation.
      const record = isJsonObject(data) ? data : {};
      const code = pieceTableText(record.code);
      return {
        kind: "code",
        payload: {
          code,
          language: stringValue(record.language) ?? "ts",
          lineCount: code.length === 0 ? 0 : code.split("\n").length,
        },
      };
    },
    fromCompatNode(node) {
      return {
        baked: bakedValue(node.baked),
        data: {
          code: pieceTableFromText(
            stringValue(node.text) ?? stringValue(node.code) ?? "",
          ),
          language: stringValue(node.language) ?? "ts",
        },
        status: statusValue(node.status) ?? "ready",
      };
    },
    // The code source is the searchable internal content of a code block (011
    // §2.7, docs/016 §6.1) so find-in-page reaches inside code, not just prose.
    plainText(data) {
      return pieceTableText((isJsonObject(data) ? data : {}).code);
    },
    normalizeData(value) {
      const normalized: ObjectNormalizationResult = isObjectNormalizationResult(
        value,
      )
        ? value
        : {
            data: toJsonValue(value),
            status: "dirty" as ObjectNodeStatus,
          };
      const data = isJsonObject(normalized.data) ? normalized.data : {};
      const code =
        pieceTableValue(data.code) ??
        pieceTableFromText(
          stringValue(data.code) ?? stringValue(data.text) ?? "",
        );
      return {
        baked: normalized.baked,
        data: {
          ...data,
          code,
          language: stringValue(data.language) ?? "ts",
        },
        status: normalized.status ?? "dirty",
      };
    },
    toCompatNode(value) {
      const data = isJsonObject(value.data) ? value.data : {};
      return {
        ...(value.baked ? { baked: value.baked } : {}),
        language: stringValue(data.language) ?? "ts",
        status: value.status,
        text: pieceTableText(data.code),
      };
    },
    type: "code-block",
  };
}

function simpleObjectDefinition(
  type: string,
  fromCompatNode: (node: RichTextCompatNode) => ObjectNormalizationResult,
  bake?: (data: JsonValue) => BakedSnapshot | null,
  plainText?: (data: JsonValue) => string,
): NodeDefinition {
  /*
   * Built-in object definitions preserve known fields as JSON-safe data and keep
   * the `baked`/`status` slots alive. The optional `bake` produces the object's
   * static snapshot from that data (Phase 6); when omitted the object has no
   * baker and stays unresolved (docs/010 §7.5 / Phase 6 AC4). The optional
   * `plainText` is the search/index adapter (011 §2.7, docs/016 §6.1).
   */
  return {
    ...(bake ? { bake } : {}),
    ...(plainText ? { plainText } : {}),
    fromCompatNode(node) {
      const value = fromCompatNode(node);
      return {
        ...value,
        baked: bakedValue(node.baked) ?? value.baked,
        status: statusValue(node.status) ?? value.status ?? "dirty",
      };
    },
    normalizeData(value) {
      if (isObjectNormalizationResult(value)) return value;
      return {
        data: toJsonValue(value),
        status: "dirty",
      };
    },
    toCompatNode(value) {
      return compatObjectFromValue(value);
    },
    type,
  };
}

/**
 * The default compat shape for an object whose definition has no `toCompatNode`.
 * Exported for the runtime registry's `toCompatObject` fallback (block-registry)
 * so both paths emit one shape; otherwise file-private to the object SPI.
 */
export function compatObjectFromValue(
  value: ObjectNormalizationResult,
): Omit<RichTextCompatNode, "id" | "type"> {
  const data = isJsonObject(value.data) ? value.data : { data: value.data };
  return {
    ...data,
    ...(value.baked ? { baked: value.baked } : {}),
    status: value.status,
  } as Omit<RichTextCompatNode, "id" | "type">;
}

type PieceTableBuffer = "original" | "append";

type PieceTablePiece = {
  readonly buffer: PieceTableBuffer;
  readonly from: number;
  readonly length: number;
};

type PieceTable = {
  readonly kind: "piece-table";
  readonly original: string;
  readonly append: string;
  readonly pieces: readonly PieceTablePiece[];
};

function pieceTableFromText(text: string): PieceTable {
  return {
    append: "",
    kind: "piece-table",
    original: text,
    pieces:
      text.length === 0
        ? []
        : [{ buffer: "original", from: 0, length: text.length }],
  };
}

function pieceTableValue(value: unknown): PieceTable | undefined {
  if (!isRecord(value) || value.kind !== "piece-table") return undefined;
  if (typeof value.original !== "string" || typeof value.append !== "string") {
    return undefined;
  }
  if (
    !Array.isArray(value.pieces) ||
    !value.pieces.every(
      (piece) =>
        isRecord(piece) &&
        (piece.buffer === "original" || piece.buffer === "append") &&
        typeof piece.from === "number" &&
        Number.isInteger(piece.from) &&
        piece.from >= 0 &&
        typeof piece.length === "number" &&
        Number.isInteger(piece.length) &&
        piece.length >= 0,
    )
  ) {
    return undefined;
  }
  return {
    append: value.append,
    kind: "piece-table",
    original: value.original,
    pieces: value.pieces.map((piece) => ({
      buffer: piece.buffer,
      from: piece.from,
      length: piece.length,
    })),
  };
}

function pieceTableText(value: unknown): string {
  const table = pieceTableValue(value);
  if (!table) return "";
  return table.pieces
    .map((piece) => {
      const source =
        piece.buffer === "original" ? table.original : table.append;
      return source.slice(piece.from, piece.from + piece.length);
    })
    .join("");
}

function isObjectNormalizationResult(
  value: unknown,
): value is ObjectNormalizationResult {
  return (
    isRecord(value) &&
    "data" in value &&
    (!("status" in value) || statusValue(value.status) !== undefined)
  );
}

function bakedValue(value: unknown): BakedSnapshot | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") return undefined;
  return { kind: value.kind, payload: toJsonValue(value.payload) };
}

function statusValue(value: unknown): ObjectNodeStatus | undefined {
  return value === "ready" ||
    value === "dirty" ||
    value === "invalid" ||
    value === "unresolved"
    ? value
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]),
    ) as JsonValue;
  }
  return null;
}

function isJsonObject(
  value: JsonValue,
): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
