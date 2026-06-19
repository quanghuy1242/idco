/**
 * Pure-compute bake and document indexing for the owned-model editor
 * (docs/010 §4.3, §7.5; docs/006 bake pipeline).
 *
 * Why this file exists
 * --------------------
 * Heavy objects are baked to a static snapshot at rest, and that snapshot is the
 * single representation the reader and export consume (docs/010 §5.9). Baking and
 * document indexing (TOC, plain-text search) are *pure compute*: they read the
 * model and return JSON, touching no DOM. That makes them the exact work docs/010
 * §7.5 moves off the editing hot path into a Web Worker.
 *
 * This module is the worker-safe core of that boundary:
 *
 * - `bakeObjectData` orchestrates one object's bake through the registry's
 *   `bake` hook, turning a missing/invalid bake into a *recoverable* `invalid`
 *   status rather than an exception or an unbakeable node (docs/010 Phase 6 AC4).
 * - `buildDocumentIndex` derives the TOC and a plain-text index from a snapshot.
 * - `runBakeWorkerJob` is the single message dispatcher the worker entry calls,
 *   so the same code runs on the main thread and inside the worker.
 *
 * It imports only `model` and `registry` (both framework- and DOM-free), so it
 * is safe to load in a Worker. Custom object definitions carry functions that do
 * not survive `postMessage`; the worker therefore bakes the built-in object set
 * with a default registry, while custom objects bake on the main thread through
 * the same `bakeObjectData` call.
 */
import {
  resolveBoundaryOffset,
  type BakedSnapshot,
  type EditorDocumentSnapshot,
  type JsonValue,
  type NodeId,
  type ObjectNodeStatus,
} from "./model";
import { createDefaultBlockRegistry, type BlockRegistry } from "./registry";

/** The outcome of baking one object's opaque data. */
export type BakeObjectResult = {
  /** The static snapshot, or `null` when the data cannot produce a valid bake. */
  readonly baked: BakedSnapshot | null;
  /** `ready` once baked, `invalid` when no valid bake exists (recoverable). */
  readonly status: ObjectNodeStatus;
  /** A human-readable reason when `status` is `invalid`. */
  readonly error?: string;
};

/** One table-of-contents entry derived from a heading leaf. */
export type TocEntry = {
  readonly id: NodeId;
  readonly level: number;
  readonly text: string;
};

/** One plain-text index entry for a top-level text block or object. */
export type TextIndexEntry = {
  readonly id: NodeId;
  readonly type: string;
  readonly text: string;
};

/** One comment/glossary index entry, derived from a leaf's range marks. */
export type CommentIndexEntry = {
  readonly id: string;
  readonly node: NodeId;
  readonly kind: "comment" | "glossary";
  readonly text: string;
};

/** The pure derived index for a document (TOC + plain-text + comments). */
export type DocumentIndex = {
  readonly toc: readonly TocEntry[];
  readonly text: readonly TextIndexEntry[];
  readonly comments: readonly CommentIndexEntry[];
};

/** Bake one object, never throwing: an unbakeable object reports `invalid`. */
export function bakeObjectData(
  registry: BlockRegistry,
  objectType: string,
  data: JsonValue,
): BakeObjectResult {
  const definition = registry.get(objectType);
  if (!definition) {
    return {
      baked: null,
      error: `Unknown object: ${objectType}`,
      status: "invalid",
    };
  }
  if (!definition.bake) {
    // No baker registered: the object is passed through as-is. It is not an
    // error, but it has no static snapshot, so it stays unresolved until a baker
    // exists rather than claiming a baked representation it does not have.
    return { baked: null, status: "unresolved" };
  }
  try {
    const baked = definition.bake(data);
    if (!baked) {
      return {
        baked: null,
        error: `No valid bake for ${objectType}`,
        status: "invalid",
      };
    }
    return { baked, status: "ready" };
  } catch (cause) {
    return {
      baked: null,
      error:
        cause instanceof Error
          ? cause.message
          : `Bake failed for ${objectType}`,
      status: "invalid",
    };
  }
}

/**
 * Derive the TOC, plain-text index, and comment index from a serialized document.
 *
 * Text leaves contribute their text (and headings the TOC); object blocks
 * contribute their SPI `plainText` so search reaches object internals rather than
 * silently skipping them (011 §2.7, docs/010 Phase 8 AC1). Comment/glossary range
 * marks contribute the comment index. The registry is injectable so the worker
 * (built-ins only) and a custom-object main-thread caller run the same code.
 */
export function buildDocumentIndex(
  snapshot: EditorDocumentSnapshot,
  registry: BlockRegistry = createDefaultBlockRegistry(),
): DocumentIndex {
  const toc: TocEntry[] = [];
  const text: TextIndexEntry[] = [];
  const comments: CommentIndexEntry[] = [];
  for (const id of snapshot.body.order) {
    const node = snapshot.body.blocks[id];
    if (!node) continue;
    if (node.kind === "text") {
      const content = node.content.text;
      text.push({ id, text: content, type: node.type });
      if (node.type === "heading") {
        toc.push({ id, level: headingLevel(node.attrs?.tag), text: content });
      }
      for (const mark of node.marks) {
        if (mark.kind !== "comment" && mark.kind !== "glossary") continue;
        const from = resolveBoundaryOffset(node.content, mark.from);
        const to = resolveBoundaryOffset(node.content, mark.to);
        comments.push({
          id: mark.id,
          kind: mark.kind,
          node: id,
          text: content.slice(from, to),
        });
      }
    } else if (node.kind === "object") {
      const plain = registry.get(node.type)?.plainText?.(node.data);
      if (plain) text.push({ id, text: plain, type: node.type });
    }
  }
  return { comments, text, toc };
}

/** A job the worker (or main thread) can run; both are pure compute. */
export type BakeWorkerJob =
  | {
      readonly kind: "bake-object";
      readonly id: string;
      readonly objectType: string;
      readonly data: JsonValue;
    }
  | {
      readonly kind: "build-index";
      readonly id: string;
      readonly snapshot: EditorDocumentSnapshot;
    };

/** The result envelope returned for a `BakeWorkerJob`, keyed by job `id`. */
export type BakeWorkerResult =
  | {
      readonly kind: "bake-object";
      readonly id: string;
      readonly result: BakeObjectResult;
    }
  | {
      readonly kind: "build-index";
      readonly id: string;
      readonly result: DocumentIndex;
    };

/**
 * Run one worker job. The worker entry and the loopback transport both call
 * this, so the off-thread path runs identical code to the main thread.
 *
 * A `registry` is injectable so callers with custom object definitions can run
 * the same dispatcher on the main thread; the worker passes none and bakes the
 * built-in object set only.
 */
export function runBakeWorkerJob(
  job: BakeWorkerJob,
  registry: BlockRegistry = createDefaultBlockRegistry(),
): BakeWorkerResult {
  if (job.kind === "bake-object") {
    return {
      id: job.id,
      kind: "bake-object",
      result: bakeObjectData(registry, job.objectType, job.data),
    };
  }
  return {
    id: job.id,
    kind: "build-index",
    result: buildDocumentIndex(job.snapshot, registry),
  };
}

function headingLevel(tag: JsonValue | undefined): number {
  if (typeof tag !== "string") return 1;
  const match = /^h([1-6])$/i.exec(tag);
  return match ? Number(match[1]) : 1;
}
