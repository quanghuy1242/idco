/**
 * Intrinsic flat-block primitives (note.md W3 / C1 decision, 2026-06-22).
 *
 * `paragraph`, `heading`, `quote`, and `listitem` are the editor's built-in
 * *text-leaf* block types, and `list` is a compat-only container that flattens to
 * flat `listitem` leaves (docs/018 §2.10). They are deliberately NOT registered
 * through the structural/object SPIs and are NOT open to third-party block types —
 * they are core primitives, and we do not intend to let a host add a flat-block
 * type. The C1 audit first read their hardcoded compat branches as "half-migrated
 * rot"; the real reason they cannot ride the `StructuralDefinition` SPI is that
 * that SPI is always-structural and 1:1, while these are (a) primarily text leaves,
 * (b) dual — a block-bearing `quote`/`listitem` becomes structural — and (c)
 * one-to-many on import — a `<list>` flattens into many leaves. See note.md W3.
 *
 * Primitive does not mean wired-at-random, though. Rather than leave that knowledge
 * as inline `if (type === ...)` arms scattered through `compat.ts`, this module is
 * its single, patterned home: a declarative table of the text-leaf specs (their
 * kept attr keys + dialect aliases) plus the flatten/dual dialect logic, all
 * reached through one `importFlatBlock` entry that compat calls with a
 * `FlatBlockImportContext` — the same ctx-of-helpers shape `StructuralDefinition`
 * already uses (`structural-registry.ts`). Adjusting an intrinsic block is a table
 * edit here, in one place, never a new branch threaded into the compat walk.
 */
import {
  makeStructuralNode,
  makeTextNode,
  type EditorNode,
  type IdAllocator,
  type JsonObject,
  type NodeId,
  type RichTextCompatNode,
  type TextContent,
  type TextLeafType,
  type TextMark,
} from "./model";

/**
 * The compat-import helpers a flat block borrows from `compat.ts`, so this module
 * owns *which* attrs/children each intrinsic block keeps without owning the import
 * walk or the inline-text/mark machinery (which live at the compat boundary).
 * Mirrors `StructuralCompatContext`.
 */
export type FlatBlockImportContext = {
  readonly allocator: IdAllocator;
  /** Stable id for a compat node (its own id, or a fresh one). */
  nodeId(node: RichTextCompatNode): NodeId;
  /** Record a built node in the document blocks map. */
  register(id: NodeId, node: EditorNode): void;
  /** Flattened inline text of a node's children. */
  inlineText(children: readonly RichTextCompatNode[] | undefined): string;
  /** Rebuilt mark ranges for a leaf's inline children. */
  inlineMarks(
    children: readonly RichTextCompatNode[] | undefined,
    content: TextContent,
    leafId: NodeId,
  ): readonly TextMark[];
  /** JSON-primitive attrs picked off a compat node (the compat `pickAttrs`). */
  pickAttrs(
    node: RichTextCompatNode,
    keys: readonly string[],
  ): JsonObject | undefined;
  /** Whether a compat child is a block vs inline text (registry-aware, W7). */
  isBlockChild(node: RichTextCompatNode): boolean;
  /** Import a run of children recursively into owned-model ids. */
  importChildren(
    children: readonly RichTextCompatNode[] | undefined,
  ): readonly NodeId[];
};

/** One intrinsic text-leaf block's compat spec. */
type FlatTextLeafSpec = {
  readonly type: TextLeafType;
  /** Legacy/editor type aliases that normalize to `type`. */
  readonly aliases: readonly string[];
  /** Attr keys kept when imported as a flat text leaf. */
  readonly leafAttrKeys: readonly string[];
  /**
   * Attr keys kept when a block-bearing instance becomes structural (quote,
   * listitem). Omitted → this block is always a leaf (paragraph, heading).
   */
  readonly structuralAttrKeys?: readonly string[];
};

/**
 * The intrinsic text-leaf blocks. This table is the single source for "which
 * attrs each flat block keeps and which dialect aliases normalize to it" — the
 * four near-identical import arms in `compat.ts` collapse to these rows.
 */
const FLAT_TEXT_LEAF_BLOCKS: readonly FlatTextLeafSpec[] = [
  {
    aliases: ["editor-paragraph"],
    leafAttrKeys: ["format", "indent"],
    type: "paragraph",
  },
  {
    aliases: ["editor-heading"],
    leafAttrKeys: ["anchorId", "format", "indent", "tag"],
    type: "heading",
  },
  {
    aliases: ["editor-quote"],
    leafAttrKeys: ["format", "indent"],
    structuralAttrKeys: ["format"],
    type: "quote",
  },
  {
    aliases: ["editor-listitem"],
    leafAttrKeys: ["checked", "indent", "listType", "value"],
    structuralAttrKeys: ["checked", "value"],
    type: "listitem",
  },
];

/** The flat-leaf spec for a compat type (canonical or alias), or null. */
function flatTextLeafSpec(type: string | undefined): FlatTextLeafSpec | null {
  if (type === undefined) return null;
  for (const spec of FLAT_TEXT_LEAF_BLOCKS) {
    if (spec.type === type || spec.aliases.includes(type)) return spec;
  }
  return null;
}

/** Whether a compat node is a legacy `list` container (flattened on import). */
function isCompatList(node: RichTextCompatNode): boolean {
  return node.type === "list" || node.type === "editor-list";
}

/** A legacy `list`'s flavour from its `listType`/`tag` (default bullet). */
function compatListType(node: RichTextCompatNode): "bullet" | "number" {
  if (node.listType === "number" || node.tag === "ol") return "number";
  return "bullet";
}

/** Build one flat text leaf for `spec`, register it, and return its id. */
function buildTextLeaf(
  node: RichTextCompatNode,
  id: NodeId,
  spec: FlatTextLeafSpec,
  ctx: FlatBlockImportContext,
): NodeId {
  const content = ctx.allocator.createTextSlice(ctx.inlineText(node.children));
  ctx.register(
    id,
    makeTextNode({
      attrs: ctx.pickAttrs(node, spec.leafAttrKeys),
      content,
      id,
      marks: ctx.inlineMarks(node.children, content, id),
      type: spec.type,
    }),
  );
  return id;
}

/**
 * The children of a block-bearing `listitem` (a list item that holds nested
 * blocks). Legacy items can carry inline text followed by a nested list; the
 * owned model keeps the item structural only for that mixed case, with one
 * generated text leaf for the direct inline content and normal child ids for the
 * nested blocks (docs/011 normalized-tree contract).
 */
function importListItemChildren(
  children: readonly RichTextCompatNode[] | undefined,
  ctx: FlatBlockImportContext,
): readonly NodeId[] {
  const inlineChildren: RichTextCompatNode[] = [];
  const ids: NodeId[] = [];
  for (const child of children ?? []) {
    if (ctx.isBlockChild(child)) ids.push(...ctx.importChildren([child]));
    else inlineChildren.push(child);
  }
  const inlineText = ctx.inlineText(inlineChildren);
  if (inlineText.length > 0) {
    const textId = ctx.allocator.createNodeId();
    const content = ctx.allocator.createTextSlice(inlineText);
    ctx.register(
      textId,
      makeTextNode({
        content,
        id: textId,
        marks: ctx.inlineMarks(inlineChildren, content, textId),
        type: "listitem",
      }),
    );
    ids.unshift(textId);
  }
  return ids;
}

/**
 * Flatten a legacy `list` into top-level `listitem` text leaves (docs/018 §2.10).
 * Each item carries the list's flavour and a `depth` indent; a nested list inside
 * an item flattens into the following items at `depth + 1`, so visual nesting
 * survives without a structural `list` node (one level per depth).
 */
function flattenCompatList(
  node: RichTextCompatNode,
  ctx: FlatBlockImportContext,
  depth: number,
): NodeId[] {
  const listType = compatListType(node);
  const ids: NodeId[] = [];
  for (const child of node.children ?? []) {
    if (isCompatList(child)) {
      ids.push(...flattenCompatList(child, ctx, depth + 1));
    } else if (child.type === "listitem" || child.type === "editor-listitem") {
      ids.push(...flattenCompatListItem(child, ctx, depth, listType));
    } else {
      // A stray non-item, non-list child: import it normally rather than drop it.
      ids.push(...ctx.importChildren([child]));
    }
  }
  return ids;
}

/** One flattened list item: its inline text leaf, then any nested lists after it. */
function flattenCompatListItem(
  item: RichTextCompatNode,
  ctx: FlatBlockImportContext,
  depth: number,
  listType: "bullet" | "number",
): NodeId[] {
  const inlineChildren = (item.children ?? []).filter(
    (child) => !isCompatList(child),
  );
  const nestedLists = (item.children ?? []).filter(isCompatList);
  const id = ctx.nodeId(item);
  const content = ctx.allocator.createTextSlice(ctx.inlineText(inlineChildren));
  ctx.register(
    id,
    makeTextNode({
      attrs: {
        ...ctx.pickAttrs(item, ["checked", "value"]),
        listType,
        ...(depth > 0 ? { indent: depth } : {}),
      },
      content,
      id,
      marks: ctx.inlineMarks(inlineChildren, content, id),
      type: "listitem",
    }),
  );
  const ids: NodeId[] = [id];
  for (const sublist of nestedLists) {
    ids.push(...flattenCompatList(sublist, ctx, depth + 1));
  }
  return ids;
}

/**
 * Import an intrinsic flat block, or return `null` when `node` is not one (so the
 * compat walk falls through to the structural registry / object path). Handles the
 * text leaves (table-driven), the block-bearing structural duals (quote/listitem),
 * and the `list` flatten. The single entry point compat calls for every node.
 */
export function importFlatBlock(
  node: RichTextCompatNode,
  ctx: FlatBlockImportContext,
): readonly NodeId[] | null {
  const spec = flatTextLeafSpec(node.type);
  if (spec) {
    const id = ctx.nodeId(node);
    const structuralKeys = spec.structuralAttrKeys;
    if (
      structuralKeys &&
      (node.children ?? []).some((child) => ctx.isBlockChild(child))
    ) {
      // A block-bearing quote/listitem keeps the structural shape; the listitem
      // case folds direct inline text into one leaf child (legacy mixed item).
      const children =
        spec.type === "listitem"
          ? importListItemChildren(node.children, ctx)
          : ctx.importChildren(node.children);
      ctx.register(
        id,
        makeStructuralNode({
          attrs: ctx.pickAttrs(node, structuralKeys),
          children,
          id,
          type: spec.type,
        }),
      );
      return [id];
    }
    return [buildTextLeaf(node, id, spec, ctx)];
  }
  if (isCompatList(node)) return flattenCompatList(node, ctx, 0);
  return null;
}
