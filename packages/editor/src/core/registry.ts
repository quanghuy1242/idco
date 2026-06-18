/**
 * Object-block registry for the owned-model editor.
 *
 * Why this file exists
 * --------------------
 * Text and structural nodes are understood by the engine. Heavy/object blocks
 * are not: a table, media block, code block, embed, or custom reader widget has
 * internal data that belongs to that object's implementation. The core can
 * store the object, move it, select it atomically, and swap its data through an
 * invertible step, but it should not infer the meaning of arbitrary fields.
 *
 * The registry is the explicit contract for that boundary. Each object kind
 * says how to normalize incoming data, how to import/export the old rich-text
 * JSON representation, and whether its baked/export data is complete. Phase 3
 * only needs enough built-ins to preserve data and prove the boundary; real
 * object bake pipelines come later.
 */
import type {
  BakedSnapshot,
  JsonValue,
  ObjectNodeStatus,
  RichTextCompatNode,
} from "./model";

/** Explicit policy for object kinds the registry does not understand. */
export type UnknownObjectPolicy = "reject" | "drop";

export type ObjectNormalizationResult = {
  readonly data: JsonValue;
  readonly baked?: BakedSnapshot;
  readonly status?: ObjectNodeStatus;
};

/**
 * Object-block boundary contract.
 *
 * Atomic objects own their opaque data. The engine can store, move, select, and
 * invert object-level swaps, but it must not guess how to parse or complete a
 * custom object's internal payload.
 */
export type BlockDefinition = {
  readonly type: string;
  normalizeData(value: unknown): ObjectNormalizationResult;
  fromCompatNode?(node: RichTextCompatNode): ObjectNormalizationResult;
  toCompatNode?(
    value: ObjectNormalizationResult,
  ): Omit<RichTextCompatNode, "id" | "type">;
  isExportComplete?(value: ObjectNormalizationResult): boolean;
};

/** Registry of object-block definitions used by compat import/export. */
export class BlockRegistry {
  readonly #definitions = new Map<string, BlockDefinition>();

  constructor(definitions: readonly BlockDefinition[] = []) {
    definitions.forEach((definition) => this.register(definition));
  }

  register(definition: BlockDefinition): void {
    /*
     * Duplicate registrations are rejected instead of "last write wins" because
     * object parsing is part of the persistence contract. Two definitions for
     * the same type would make import/export nondeterministic.
     */
    if (this.#definitions.has(definition.type)) {
      throw new Error(`Duplicate block definition: ${definition.type}`);
    }
    this.#definitions.set(definition.type, definition);
  }

  get(type: string): BlockDefinition | undefined {
    return this.#definitions.get(type);
  }

  require(type: string): BlockDefinition {
    const definition = this.get(type);
    if (!definition) throw new Error(`Unknown object block: ${type}`);
    return definition;
  }

  normalizeSnapshotObject(
    type: string,
    value: unknown,
  ): ObjectNormalizationResult {
    return this.require(type).normalizeData(value);
  }

  normalizeCompatObject(node: RichTextCompatNode): ObjectNormalizationResult {
    const definition = this.require(node.type);
    return definition.fromCompatNode?.(node) ?? definition.normalizeData(node);
  }

  toCompatObject(
    type: string,
    value: ObjectNormalizationResult,
  ): Omit<RichTextCompatNode, "id" | "type"> {
    const definition = this.require(type);
    return definition.toCompatNode?.(value) ?? compatObjectFromValue(value);
  }
}

/** Built-ins plus caller-provided custom object definitions. */
export function createDefaultBlockRegistry(
  definitions: readonly BlockDefinition[] = [],
): BlockRegistry {
  return new BlockRegistry([...BUILT_IN_OBJECT_DEFINITIONS, ...definitions]);
}

/**
 * Minimal Phase 3 definitions for existing object nodes.
 *
 * They preserve data, baked snapshots, and status fields without implementing
 * real bake pipelines. Phase 6 can replace these with richer definitions.
 */
export const BUILT_IN_OBJECT_DEFINITIONS: readonly BlockDefinition[] = [
  simpleObjectDefinition("code-block", (node) => ({
    data: {
      code: stringValue(node.text) ?? stringValue(node.code) ?? "",
      language: stringValue(node.language) ?? "ts",
    },
    status: statusValue(node.status) ?? "ready",
  })),
  simpleObjectDefinition("media", (node) => ({
    data: {
      alt: stringValue(node.alt) ?? "",
      caption: stringValue(node.caption) ?? "",
      mediaId: stringValue(node.mediaId) ?? "",
      src: stringValue(node.src) ?? "",
    },
    status: statusValue(node.status) ?? "ready",
  })),
  simpleObjectDefinition("post-ref", (node) => ({
    data: {
      postId: stringValue(node.postId) ?? "",
      title: stringValue(node.title) ?? "",
      url: stringValue(node.url) ?? "",
    },
    status: statusValue(node.status) ?? "ready",
  })),
  simpleObjectDefinition("embed", (node) => ({
    data: {
      title: stringValue(node.title) ?? "",
      url: stringValue(node.url) ?? "",
    },
    status: statusValue(node.status) ?? "ready",
  })),
  simpleObjectDefinition("table-of-contents", (node) => ({
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
  })),
  simpleObjectDefinition("table", (node) => ({
    data: jsonObjectFromRecord(node),
    status: statusValue(node.status) ?? "ready",
  })),
  simpleObjectDefinition("editor-table", (node) => ({
    data: jsonObjectFromRecord(node),
    status: statusValue(node.status) ?? "ready",
  })),
];

function simpleObjectDefinition(
  type: string,
  fromCompatNode: (node: RichTextCompatNode) => ObjectNormalizationResult,
): BlockDefinition {
  /*
   * Built-in Phase 3 definitions intentionally do not bake or deeply understand
   * object internals. They preserve known fields as JSON-safe data and keep the
   * `baked`/`status` slots alive so future object phases can replace this thin
   * adapter without changing the store shape.
   */
  return {
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

function compatObjectFromValue(
  value: ObjectNormalizationResult,
): Omit<RichTextCompatNode, "id" | "type"> {
  const data = isJsonObject(value.data) ? value.data : { data: value.data };
  return {
    ...data,
    ...(value.baked ? { baked: value.baked } : {}),
    status: value.status,
  } as Omit<RichTextCompatNode, "id" | "type">;
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

function jsonObjectFromRecord(record: Record<string, unknown>): JsonValue {
  const entries = Object.entries(record).filter(
    ([key]) =>
      key !== "id" && key !== "type" && key !== "baked" && key !== "status",
  );
  return Object.fromEntries(
    entries.map(([key, value]) => [key, toJsonValue(value)]),
  ) as JsonValue;
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
