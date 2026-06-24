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
  type CollectionItem,
  type EditorDocumentSnapshot,
  type JsonValue,
  type NodeId,
  type ObjectNodeStatus,
} from "../model";
import { createDefaultBlockRegistry, type BlockRegistry } from "../registry";

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
  /**
   * The fragment id the heading is reachable at — the element id the heading
   * renders (`text-block`/`RestingLeaf`) and the TOC links to as `#${anchor}`. A
   * pinned `attrs.anchorId` wins; otherwise the heading's NodeId, which is unique
   * by construction (clientId + monotonic clock, model.ts) and round-tripped
   * through save/load (compat reuses an `idco_node_*` id), so it is a stable,
   * document-unique anchor with *no* whole-document dedup pass needed. This is the
   * functional in-editor/at-rest anchor.
   */
  readonly anchor: string;
  /**
   * A human-readable, document-unique slug derived from the heading text — the
   * reader/published-URL form (docs/015). Deduped across the whole document right
   * here, because `buildDocumentIndex` is the one place that sees every heading
   * (the per-node view is scoped and cannot). The editor's working anchor stays
   * `anchor` (NodeId-based); `slug` is what a reader emits for pretty `#…` URLs.
   */
  readonly slug: string;
};

/** One plain-text index entry for a top-level text block or object. */
export type TextIndexEntry = {
  readonly id: NodeId;
  readonly type: string;
  readonly text: string;
};

/** One comment/glossary index entry, derived from a leaf's range marks. */
export type CommentIndexEntry = {
  /** The mark id (the occurrence's identity; used for orphan detection + removal). */
  readonly id: string;
  readonly node: NodeId;
  readonly kind: "comment" | "glossary";
  readonly text: string;
  /**
   * The reference the mark carries (docs/027 §4.1): a glossary mark's `attrs.term`
   * (the collection item id) or a comment mark's `attrs.thread` (the host thread id).
   * The join key a pane uses to count occurrences per term/thread and to detect an
   * orphaned reference (a mark whose `ref` names no live item, docs/027 §6.3/§7.6).
   * Absent on a legacy mark that carried no ref attr yet.
   */
  readonly ref?: string;
};

/** The pure derived index for a document (TOC + plain-text + comments + collections). */
export type DocumentIndex = {
  readonly toc: readonly TocEntry[];
  readonly text: readonly TextIndexEntry[];
  readonly comments: readonly CommentIndexEntry[];
  /**
   * Document-owned collections passed straight through from the snapshot (docs/027
   * §5.4). The index carries the raw items (plain JSON, worker-safe) and a pane joins
   * them with `comments` for occurrence counts — the glossary pane joins
   * `collections.glossary` against `comments` of `kind: "glossary"`. Keeping the join
   * pane-side keeps the worker index free of any per-collection function (§5.5).
   */
  readonly collections: Readonly<Record<string, readonly CollectionItem[]>>;
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
  // Slug uniqueness is a whole-document property (two "Setup" headings), so it is
  // resolved here, walking headings in document order, not in the per-node view.
  const usedSlugs = new Set<string>();
  for (const id of snapshot.body.order) {
    const node = snapshot.body.blocks[id];
    if (!node) continue;
    if (node.kind === "text") {
      const content = node.content.text;
      text.push({ id, text: content, type: node.type });
      // Skip empty headings (e.g. the empty head left behind by an offset-0
      // heading split, or a heading being typed): a heading with no text is not a
      // navigable contents entry, so it must not appear in the TOC.
      if (node.type === "heading" && content.trim().length > 0) {
        toc.push({
          // A pinned anchorId wins; otherwise the NodeId is the anchor (unique +
          // persisted), so the link works without minting a slug for it. The view
          // and the resting leaf render this same id (`headingAnchor`).
          anchor: headingAnchor(id, node.attrs),
          id,
          level: headingLevel(node.attrs?.tag),
          slug: allocateHeadingSlug(content, usedSlugs),
          text: content,
        });
      }
      for (const mark of node.marks) {
        if (mark.kind !== "comment" && mark.kind !== "glossary") continue;
        const from = resolveBoundaryOffset(node.content, mark.from);
        const to = resolveBoundaryOffset(node.content, mark.to);
        // The mark's reference id (docs/027 §4.1): a glossary mark points at a term,
        // a comment mark at a host thread. Carried so a pane can join occurrences to
        // their term/thread without re-walking the document.
        const refAttr =
          mark.kind === "glossary" ? mark.attrs?.term : mark.attrs?.thread;
        comments.push({
          id: mark.id,
          kind: mark.kind,
          node: id,
          ...(typeof refAttr === "string" ? { ref: refAttr } : {}),
          text: content.slice(from, to),
        });
      }
    } else if (node.kind === "object") {
      const plain = registry.get(node.type)?.plainText?.(node.data);
      if (plain) text.push({ id, text: plain, type: node.type });
    }
  }
  // Pass document-owned collections through unchanged (docs/027 §5.4): plain JSON, so
  // a pane reads definitions from here and joins them with the occurrence marks above.
  return { collections: snapshot.collections ?? {}, comments, text, toc };
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

/**
 * The fragment id a heading is anchored at (docs/016 §10 TOC contract): a pinned
 * `attrs.anchorId` when present, otherwise the heading's NodeId. The index, the
 * editing leaf (`text-block`), and the resting leaf (`RestingLeaf`) all call this
 * so the element a TOC entry links to (`#${anchor}`) is rendered with exactly that
 * id from every surface — they cannot drift. Accepts the loose attrs bag both the
 * snapshot node and the store node carry.
 */
export function headingAnchor(
  id: NodeId,
  attrs: Readonly<Record<string, unknown>> | undefined,
): string {
  const anchorId = attrs?.anchorId;
  return typeof anchorId === "string" && anchorId.length > 0 ? anchorId : id;
}

function headingLevel(tag: JsonValue | undefined): number {
  if (typeof tag !== "string") return 1;
  const match = /^h([1-6])$/i.exec(tag);
  return match ? Number(match[1]) : 1;
}

/**
 * Derive a URL-fragment slug from heading text: lowercased, with every run of
 * non-alphanumeric characters collapsed to a single hyphen and the ends trimmed.
 * Unicode-aware (`\p{L}`/`\p{N}`) so non-Latin headings keep their letters rather
 * than slugging to empty. An empty result (a heading of only punctuation/spaces)
 * falls back to `"section"` so a slug always exists.
 */
function slugifyHeading(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

/**
 * Allocate a document-unique slug, suffixing `-2`, `-3`, … on collision. `used`
 * accumulates across the single document-order walk in `buildDocumentIndex`, so
 * the first heading with a given text keeps the bare slug and later duplicates are
 * disambiguated deterministically by position.
 */
function allocateHeadingSlug(text: string, used: Set<string>): string {
  const base = slugifyHeading(text);
  let slug = base;
  let suffix = 2;
  while (used.has(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(slug);
  return slug;
}
