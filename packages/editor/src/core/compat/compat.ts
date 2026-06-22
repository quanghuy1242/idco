/**
 * Compatibility adapter for the old rich-text wire format.
 *
 * Why this file exists
 * --------------------
 * Existing IDCO documents, tests, the legacy Lexical editor, and the current
 * read renderer still speak the `RichTextEditorDocument`-style JSON shape:
 *
 *   { root: { children: [...] } }
 *
 * In that format, inline formatting is represented by many adjacent `text`
 * nodes with Lexical-compatible `format` bitmasks, and heavy/object blocks keep
 * their fields directly on the JSON node (`mediaId`, `language`, `baked`,
 * `status`, and so on).
 *
 * The owned-model engine deliberately does not use that shape internally. Its
 * runtime model is a normalized node graph: one text leaf contains one string
 * plus range marks anchored to character ids; structural nodes contain child
 * ids; object nodes keep opaque data behind a registry contract.
 *
 * This file is the only bridge between those two worlds:
 *
 *   old rich-text JSON -> `EditorDocumentSnapshot` -> `EditorStore`
 *   `EditorStore` -> `EditorDocumentSnapshot` -> old rich-text JSON
 *
 * How to read this file
 * ---------------------
 * - The public import functions (`editorSnapshotFromCompat`,
 *   `createEditorStoreFromCompat`) are load-time boundary code.
 * - The public export functions (`compatFromSnapshot`,
 *   `compatFromEditorStore`) are save/rollback/interop boundary code.
 * - `compatInlineChildren` is the inline-format projection: runtime range
 *   marks become legacy split `text` nodes.
 * - `marksFromInlineChildren` is the inverse projection: split legacy `text`
 *   nodes become runtime range marks anchored against the imported
 *   `TextContent`.
 *
 * What must not happen here
 * -------------------------
 * Do not treat compatibility nodes as the runtime model. Do not import legacy
 * model types from `../legacy/**`; that path brings Lexical-shaped semantics
 * back into the canonical engine. If a new object block appears, register a
 * `BlockDefinition` instead of adding arbitrary passthrough fields.
 */
import {
  boundaryAtOffset,
  createIdAllocator,
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  resolveBoundaryOffset,
  type DocumentSettings,
  type EditorDocumentSnapshot,
  type EditorNode,
  type IdAllocator,
  type JsonObject,
  type NodeId,
  type RichTextCompatDocument,
  type RichTextCompatNode,
  type TextContent,
  type TextLeafNode,
  type TextLeafType,
  type TextMark,
} from "../model";
import {
  createDefaultBlockRegistry,
  type BlockRegistry,
  type UnknownObjectPolicy,
} from "../registry";
import {
  getStructuralDefinition,
  isStructuralDefinitionType,
} from "../registry";
import {
  canonicalFlatType,
  importFlatBlock,
  type FlatBlockImportContext,
} from "../registry/flat-blocks";
import { createEditorStore, type EditorStore } from "../store";
import { safeHref } from "../url-safety";

/**
 * Lexical-compatible text-format bitmask.
 *
 * The owned model stores inline formatting as range marks anchored to character
 * ids. This bitmask exists only at the compatibility edge so the legacy editor,
 * content renderer, and existing persisted JSON keep receiving their current
 * split-text-node shape.
 */
export const TEXT_FORMAT = {
  bold: 1,
  italic: 2,
  strikethrough: 4,
  underline: 8,
  code: 16,
  subscript: 32,
  superscript: 64,
  highlight: 128,
} as const;

export type RuntimeFormatMarkKind = keyof typeof TEXT_FORMAT;

/**
 * Options for crossing the owned-model <-> rich-text JSON boundary.
 *
 * `registry` is mandatory in spirit for custom object blocks: unknown objects
 * must be rejected or intentionally dropped, never silently passed through as
 * arbitrary data. `allocator` is injectable so tests and import pipelines can
 * make node and character ids deterministic.
 */
export type CompatOptions = {
  readonly allocator?: IdAllocator;
  readonly registry?: BlockRegistry;
  readonly unknownObjectPolicy?: UnknownObjectPolicy;
};

type BuildState = {
  readonly allocator: IdAllocator;
  readonly registry: BlockRegistry;
  readonly blocks: Map<NodeId, EditorNode>;
  readonly unknownObjectPolicy: UnknownObjectPolicy;
};

/**
 * Build a mutable headless store from the compatibility document shape.
 *
 * This is the only sanctioned way for legacy `root.children` JSON to enter the
 * canonical engine. The returned store contains normalized owned-model nodes,
 * not `RichTextEditorNode` objects.
 */
export function createEditorStoreFromCompat(
  document: RichTextCompatDocument,
  options: CompatOptions = {},
): EditorStore {
  return createEditorStore({
    allocator: options.allocator ?? createIdAllocator(),
    snapshot: editorSnapshotFromCompat(document, options),
  });
}

/**
 * Convert existing rich-text JSON into the owned-model persistence snapshot.
 *
 * The snapshot is JSON-serializable, but it is still not the hot-path runtime
 * representation. `EditorStore` owns the mutable Map, parent index, history,
 * subscribers, and selection.
 */
export function editorSnapshotFromCompat(
  document: RichTextCompatDocument,
  options: CompatOptions = {},
): EditorDocumentSnapshot {
  /*
   * Import flow:
   *
   * 1. Walk the old `root.children` tree.
   * 2. Allocate or preserve an owned-model `NodeId` for each runtime node.
   * 3. Collapse inline child text into one `TextContent` per text leaf.
   * 4. Convert split-node formatting into range marks anchored to that
   *    `TextContent`'s character ids.
   * 5. Store every node by id in `blocks`; the returned `order` is only the
   *    top-level body order used by the future virtualizer.
   */
  const state: BuildState = {
    allocator: options.allocator ?? createIdAllocator(),
    blocks: new Map<NodeId, EditorNode>(),
    registry: options.registry ?? createDefaultBlockRegistry(),
    unknownObjectPolicy: options.unknownObjectPolicy ?? "reject",
  };
  const order = (document.root.children ?? []).flatMap((node) =>
    importCompatNode(node, state),
  );
  return {
    body: {
      blocks: Object.fromEntries(state.blocks) as Record<NodeId, EditorNode>,
      order,
    },
    settings: document.settings ?? {},
    version: 1,
  };
}

/** Project the current mutable store into rollback-compatible rich-text JSON. */
export function compatFromEditorStore(
  store: EditorStore,
  registry: BlockRegistry = createDefaultBlockRegistry(),
): RichTextCompatDocument {
  return compatFromSnapshot(store.toSnapshot(), registry);
}

/**
 * Project an owned-model snapshot into the old `root.children` JSON shape.
 *
 * This intentionally emits split `text` nodes with `format` bitmasks for inline
 * formatting. Those split nodes are not allowed to leak back into the runtime
 * model as the source of truth.
 */
export function compatFromSnapshot(
  snapshot: EditorDocumentSnapshot,
  registry: BlockRegistry = createDefaultBlockRegistry(),
): RichTextCompatDocument {
  /*
   * Export flow:
   *
   * The runtime graph is normalized, so export starts from `body.order` and
   * recursively resolves child ids only for structural nodes. Text leaves are
   * expanded into split inline children; objects delegate to the registry so
   * their opaque data decides its own rich-text JSON representation.
   */
  const children = snapshot.body.order.flatMap((id) =>
    exportCompatNode(snapshot.body.blocks[id], snapshot, registry),
  );
  return {
    root: { children },
    settings: snapshot.settings,
  };
}

/**
 * Wrap a callout's inline text children in a single paragraph leaf and register
 * it, returning its id. The legacy inline-content callout had no inner block, so
 * its text becomes one paragraph child of the structural callout — the same shape
 * a freshly inserted callout carries.
 */
function importInlineAsParagraph(
  node: RichTextCompatNode,
  state: BuildState,
): NodeId[] {
  const content = state.allocator.createTextSlice(
    textFromInlineChildren(node.children),
  );
  const paragraphId = state.allocator.createNodeId();
  state.blocks.set(
    paragraphId,
    makeTextNode({
      attrs: pickAttrs(node, ["indent"]),
      content,
      id: paragraphId,
      marks: marksFromInlineChildren(node.children, content, paragraphId),
      type: "paragraph",
    }),
  );
  return [paragraphId];
}

/** Bind the compat import helpers into the `FlatBlockImportContext` flat-blocks
 *  needs, so the intrinsic flat-block logic lives in one module without owning the
 *  import walk (the same ctx-of-helpers pattern `StructuralDefinition` uses). */
function flatBlockContext(state: BuildState): FlatBlockImportContext {
  return {
    allocator: state.allocator,
    importChildren: (children) =>
      (children ?? []).flatMap((child) => importCompatNode(child, state)),
    inlineMarks: (children, content, leafId) =>
      marksFromInlineChildren(children, content, leafId),
    inlineText: (children) => textFromInlineChildren(children),
    isBlockChild: (node) => isBlockChild(node, state.registry),
    nodeId: (node) => nodeId(node, state.allocator),
    pickAttrs,
    register: (compatId, built) => state.blocks.set(compatId, built),
  };
}

function importCompatNode(
  node: RichTextCompatNode,
  state: BuildState,
): readonly NodeId[] {
  /*
   * Intrinsic flat blocks (paragraph/heading/quote/listitem and the `list`
   * flatten) import through the single patterned entry in `flat-blocks` — they are
   * core text-leaf primitives, deliberately not registry types (note.md W3). A
   * non-flat node returns null here and falls through to the structural/object
   * registries below.
   */
  const flatBlock = importFlatBlock(node, flatBlockContext(state));
  if (flatBlock) return flatBlock;
  const id = nodeId(node, state.allocator);
  /*
   * Registry-driven structural import (note §7). A structural type with a
   * registered `StructuralDefinition` (callout, the table family) imports through
   * its own `fromCompatNode`, so core keeps no per-type branch — the structural
   * twin of the object registry path below.
   */
  const structuralDefinition = getStructuralDefinition(node.type);
  if (structuralDefinition) {
    const result = structuralDefinition.fromCompatNode(node, {
      allocator: state.allocator,
      hasBlockChildren: (children) =>
        hasBlockChildren(children, state.registry),
      importChildren: (children) =>
        (children ?? []).flatMap((child) => importCompatNode(child, state)),
      importInlineAsParagraph: (inlineNode) =>
        importInlineAsParagraph(inlineNode, state),
      pickAttrs,
    });
    state.blocks.set(
      id,
      makeStructuralNode({
        attrs: result.attrs,
        children: result.children,
        id,
        // Use the resolved definition's CANONICAL type, not the source node's:
        // a legacy alias (`editor-table`) resolves to its canonical core (`table`)
        // so the owned model only ever holds canonical types (docs/021 §8.1).
        type: structuralDefinition.type,
      }),
    );
    return [id];
  }
  /*
   * Object nodes:
   *
   * The engine treats object internals as opaque. The registry is the only
   * place allowed to know how a `code-block`, `media`, custom widget, or future
   * heavy object parses its JSON fields and baked snapshot.
   */
  if (isObjectNodeType(node.type, state.registry)) {
    const value = state.registry.normalizeCompatObject(node);
    // Import keeps the source's baked field as-is (no bake here) so the compat
    // round-trip stays deep-equal except ids (docs/010 §14). An object that
    // arrives without a baked snapshot is baked *for display* in the view
    // (object-block `BakedObjectView`), never written back to the model.
    state.blocks.set(
      id,
      makeObjectNode({
        baked: value.baked,
        data: value.data,
        id,
        status: value.status,
        type: node.type,
      }),
    );
    return [id];
  }
  /*
   * Unknown policy:
   *
   * Reject is the default because a silent passthrough creates runtime data
   * without an invertibility/export contract. Drop exists for deliberate
   * migrations or sanitized imports where losing unsupported objects is the
   * chosen behavior.
   */
  if (state.unknownObjectPolicy === "drop") return [];
  throw new Error(`Unknown compatibility node type: ${node.type}`);
}

function exportCompatNode(
  node: EditorNode | undefined,
  snapshot: EditorDocumentSnapshot,
  registry: BlockRegistry,
): readonly RichTextCompatNode[] {
  if (!node) return [];
  if (node.kind === "text") {
    return [exportTextNode(node)];
  }
  if (node.kind === "structural") {
    // A registered type whose persisted child shape diverges from its runtime
    // shape projects through its `toCompatNode` (the table cell's paragraph →
    // inline text, docs/021 §6.1 / docs/022 §4.3); everything else exports
    // generically (attrs + recursed children).
    const definition = getStructuralDefinition(node.type);
    if (definition?.toCompatNode) {
      const result = definition.toCompatNode(node, {
        exportChildren: (ids) =>
          ids.flatMap((id) =>
            exportCompatNode(snapshot.body.blocks[id], snapshot, registry),
          ),
        getNode: (id) => snapshot.body.blocks[id],
        inlineChildren: (child) =>
          child.kind === "text" ? compatInlineChildren(child) : [],
      });
      return [
        {
          ...result.attrs,
          children: result.children,
          id: node.id,
          type: node.type,
        },
      ];
    }
    return [
      {
        ...node.attrs,
        children:
          node.type === "listitem"
            ? exportListItemChildren(node.children, snapshot, registry)
            : node.children.flatMap((id) =>
                exportCompatNode(snapshot.body.blocks[id], snapshot, registry),
              ),
        id: node.id,
        type: node.type,
      },
    ];
  }
  const compat = registry.toCompatObject(node.type, {
    baked: node.baked,
    data: node.data,
    status: node.status,
  });
  return [{ ...compat, id: node.id, type: node.type }];
}

function exportTextNode(node: TextLeafNode): RichTextCompatNode {
  return {
    ...node.attrs,
    children: compatInlineChildren(node),
    id: node.id,
    type: node.type,
  };
}

function exportListItemChildren(
  children: readonly NodeId[],
  snapshot: EditorDocumentSnapshot,
  registry: BlockRegistry,
): readonly RichTextCompatNode[] {
  /*
   * Structural list items are an internal shape used only when a list item has a
   * nested block child. The direct text leaf must become inline text children in
   * compatibility JSON, otherwise export would produce `listitem > listitem`
   * instead of the legacy `listitem > text + nested list` shape.
   */
  return children.flatMap((id) => {
    const child = snapshot.body.blocks[id];
    return child?.kind === "text" && child.type === "listitem"
      ? compatInlineChildren(child)
      : exportCompatNode(child, snapshot, registry);
  });
}

/**
 * Expand one runtime text leaf into legacy inline children.
 *
 * The runtime stores one string and range marks. The compatibility shape needs
 * adjacent text chunks split wherever the active format bitmask changes, plus
 * explicit `linebreak` nodes for soft breaks.
 */
export function compatInlineChildren(
  node: TextLeafNode,
): readonly RichTextCompatNode[] {
  /*
   * Formatting projection:
   *
   * Runtime marks can overlap. The legacy shape cannot express "range mark"
   * directly, so we collect every mark boundary and linebreak as a breakpoint,
   * then emit one text node for each segment with a stable bitmask for exactly
   * that segment. Adjacent identical segments are merged to avoid noisy output.
   */
  // Link marks project back to legacy `link` element nodes wrapping their inline
  // children (the inverse of the import fix), so a link round-trips with its href.
  const links = node.marks
    .filter((mark) => mark.kind === "link")
    .map((mark) => ({
      from: resolveBoundaryOffset(node.content, mark.from),
      href: typeof mark.attrs?.href === "string" ? mark.attrs.href : "",
      to: resolveBoundaryOffset(node.content, mark.to),
    }))
    .sort((a, b) => a.from - b.from);

  const breakpoints = new Set([0, node.content.text.length]);
  for (const mark of node.marks) {
    if (!isFormatMark(mark.kind)) continue;
    breakpoints.add(resolveBoundaryOffset(node.content, mark.from));
    breakpoints.add(resolveBoundaryOffset(node.content, mark.to));
  }
  for (const link of links) {
    breakpoints.add(link.from);
    breakpoints.add(link.to);
  }
  for (let index = 0; index < node.content.text.length; index += 1) {
    if (node.content.text[index] === "\n") {
      breakpoints.add(index);
      breakpoints.add(index + 1);
    }
  }
  const sorted = [...breakpoints].sort((a, b) => a - b);

  // First pass: one inline node per segment, tagged with its start offset.
  const segments: { from: number; node: RichTextCompatNode }[] = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const from = sorted[index]!;
    const to = sorted[index + 1]!;
    if (from === to) continue;
    const text = node.content.text.slice(from, to);
    segments.push({
      from,
      node:
        text === "\n"
          ? { type: "linebreak" }
          : { format: formatAtRange(node, from, to), text, type: "text" },
    });
  }

  // Second pass: merge adjacent same-format text and group link-covered runs into
  // `link` element nodes.
  const children: RichTextCompatNode[] = [];
  let i = 0;
  while (i < segments.length) {
    const segment = segments[i]!;
    const link = links.find(
      (l) => segment.from >= l.from && segment.from < l.to,
    );
    if (!link) {
      pushInline(children, segment.node);
      i += 1;
      continue;
    }
    const linkChildren: RichTextCompatNode[] = [];
    while (
      i < segments.length &&
      segments[i]!.from >= link.from &&
      segments[i]!.from < link.to
    ) {
      pushInline(linkChildren, segments[i]!.node);
      i += 1;
    }
    children.push({ children: linkChildren, type: "link", url: link.href });
  }
  return children;
}

/** Append an inline node, merging it into the previous same-format text run. */
function pushInline(out: RichTextCompatNode[], node: RichTextCompatNode): void {
  const previous = out.at(-1);
  if (
    node.type === "text" &&
    previous &&
    previous.type === "text" &&
    previous.format === node.format &&
    typeof previous.text === "string" &&
    typeof node.text === "string"
  ) {
    out[out.length - 1] = { ...previous, text: previous.text + node.text };
    return;
  }
  out.push(node);
}

/**
 * Recover runtime range marks from legacy split text nodes.
 *
 * Boundaries are anchored against the same `TextContent` instance used by the
 * imported leaf. That is the important bit: marks survive later edits by
 * character identity, with offsets acting only as the resolved working
 * coordinate.
 */
function marksFromInlineChildren(
  children: readonly RichTextCompatNode[] | undefined,
  content: TextContent,
  node: NodeId,
): readonly TextMark[] {
  /*
   * Mark recovery:
   *
   * The offset counter walks the legacy inline children in the same flattened
   * order used to create `content`. Each bit in a legacy text node becomes a
   * runtime mark from the current offset to the end of that child. Inline
   * element children (`link`, `epub-internal-link`) are not flattened to bare
   * text: their inner format marks are recovered recursively, and a `link` mark
   * is created over the element's span so the href survives import (011 §2.3;
   * the pre-Phase-8 recovery fix, docs/017 §3.3). The boundaries are anchored
   * through `boundaryAtOffset`, which stores the resolved offset and the durable
   * character-id anchor.
   */
  return collectInlineMarks(children, content, node, 0).marks;
}

function collectInlineMarks(
  children: readonly RichTextCompatNode[] | undefined,
  content: TextContent,
  node: NodeId,
  baseOffset: number,
): { readonly marks: readonly TextMark[]; readonly end: number } {
  let offset = baseOffset;
  const marks: TextMark[] = [];
  for (const child of children ?? []) {
    if (child.type === "text") {
      const value = typeof child.text === "string" ? child.text : "";
      for (const kind of formatKinds(child.format)) {
        marks.push(
          rangeMark(node, kind, content, offset, offset + value.length),
        );
      }
      offset += value.length;
      continue;
    }
    if (child.type === "linebreak") {
      offset += 1;
      continue;
    }
    // Inline element with children: recover its inner marks first, then mark the
    // whole span as a link when the element is one.
    const start = offset;
    const inner = collectInlineMarks(child.children, content, node, offset);
    marks.push(...inner.marks);
    offset = inner.end;
    if (isInlineLinkType(child.type) && offset > start) {
      const href = inlineLinkHref(child);
      marks.push({
        ...rangeMark(node, "link", content, start, offset),
        ...(href ? { attrs: { href } } : {}),
      });
    }
  }
  return { end: offset, marks };
}

function rangeMark(
  node: NodeId,
  kind: TextMark["kind"],
  content: TextContent,
  from: number,
  to: number,
): TextMark {
  return {
    from: boundaryAtOffset(content, from, "before"),
    id: `${node}:${kind}:${from}:${to}`,
    kind,
    to: boundaryAtOffset(content, to, "after"),
  };
}

function isInlineLinkType(type: string): boolean {
  return type === "link" || type === "epub-internal-link";
}

function inlineLinkHref(node: RichTextCompatNode): string {
  // Sanitize on import so the model never stores a dangerous href (a
  // `javascript:` link from old data becomes inert, docs/010 §10.5).
  const direct = typeof node.url === "string" ? node.url : undefined;
  if (direct) return safeHref(direct);
  const href = (node as { href?: unknown }).href;
  if (typeof href === "string") return safeHref(href);
  const fields = (node as { fields?: unknown }).fields;
  if (fields && typeof fields === "object") {
    const url = (fields as { url?: unknown }).url;
    if (typeof url === "string") return safeHref(url);
  }
  return "";
}

function textFromInlineChildren(
  children: readonly RichTextCompatNode[] | undefined,
): string {
  return (children ?? [])
    .map((child) => {
      if (child.type === "text")
        return typeof child.text === "string" ? child.text : "";
      if (child.type === "linebreak") return "\n";
      return textFromInlineChildren(child.children);
    })
    .join("");
}

function hasBlockChildren(
  children: readonly RichTextCompatNode[] | undefined,
  registry: BlockRegistry,
): boolean {
  return (children ?? []).some((child) => isBlockChild(child, registry));
}

function isBlockChild(
  node: RichTextCompatNode,
  registry: BlockRegistry,
): boolean {
  // Decode any legacy alias to canonical once (`editor-quote` → `quote`,
  // `editor-list` → `list`), so this lists only canonical flat/list names — no
  // `|| editor-*` duplication of the declarative `aliases` tables.
  const flat = canonicalFlatType(node.type);
  return (
    flat === "paragraph" ||
    flat === "heading" ||
    flat === "quote" ||
    flat === "list" ||
    // Structural alias resolution (`editor-table` → `table`) lives in the registry.
    isStructuralDefinitionType(node.type) ||
    // A registered object node — built-in OR a host's custom node — is a block
    // child; the single registry check (W7) replaces the old hardcoded built-in
    // object-type list, so a custom object now round-trips like a built-in.
    isObjectNodeType(node.type, registry)
  );
}

function formatAtRange(node: TextLeafNode, from: number, to: number): number {
  return node.marks.reduce((format, mark) => {
    if (!isFormatMark(mark.kind)) return format;
    const markFrom = resolveBoundaryOffset(node.content, mark.from);
    const markTo = resolveBoundaryOffset(node.content, mark.to);
    return markFrom <= from && markTo >= to
      ? format | TEXT_FORMAT[mark.kind]
      : format;
  }, 0);
}

function formatKinds(format: unknown): RuntimeFormatMarkKind[] {
  if (typeof format !== "number") return [];
  return Object.entries(TEXT_FORMAT)
    .filter(([, bit]) => (format & bit) !== 0)
    .map(([kind]) => kind as RuntimeFormatMarkKind);
}

function isFormatMark(kind: string): kind is RuntimeFormatMarkKind {
  return kind in TEXT_FORMAT;
}

function nodeId(node: RichTextCompatNode, allocator: IdAllocator): NodeId {
  return typeof node.id === "string" && node.id.startsWith("idco_node_")
    ? (node.id as NodeId)
    : allocator.createNodeId();
}

function isObjectNodeType(type: string, registry: BlockRegistry): boolean {
  return registry.get(type) !== undefined;
}

function pickAttrs(
  node: RichTextCompatNode,
  keys: readonly string[],
): JsonObject | undefined {
  const entries = keys.flatMap((key) => {
    const value = toJsonAttr(node[key]);
    return value === undefined ? [] : [[key, value] as const];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function toJsonAttr(value: unknown) {
  return value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : undefined;
}

/** Convenience helper for tests and command code that need a format range mark. */
export function createTextMark(args: {
  readonly id: string;
  readonly kind: RuntimeFormatMarkKind;
  readonly node: TextLeafNode;
  readonly from: number;
  readonly to: number;
}): TextMark {
  return {
    from: boundaryAtOffset(args.node.content, args.from, "before"),
    id: args.id,
    kind: args.kind,
    to: boundaryAtOffset(args.node.content, args.to, "after"),
  };
}

/**
 * Normalize legacy/editor element aliases to the runtime text-leaf type names,
 * decoding through the single `canonicalFlatType` resolver (so `editor-paragraph`
 * → `paragraph` etc. is not re-listed here). Returns null for a non-text-leaf type.
 */
export function textNodeTypeFromCompat(type: string): TextLeafType | null {
  const canonical = canonicalFlatType(type);
  return canonical === "paragraph" ||
    canonical === "heading" ||
    canonical === "quote" ||
    canonical === "listitem"
    ? canonical
    : null;
}

/** Keep document settings as document-level data, never body-stream nodes. */
export function settingsFromCompat(
  document: RichTextCompatDocument,
): DocumentSettings {
  return document.settings ?? {};
}
