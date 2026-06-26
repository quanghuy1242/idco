/**
 * Snapshot → markdown export (docs/030 §7.2 D2, MIO-2).
 *
 * A *lossy one-way* projection to an open format (D2): it walks `body.order`/`body.blocks`,
 * emits the best representable markdown for every node, and *drops what markdown cannot
 * carry* (the `MARKDOWN_LOSSY_*` sets in `transformers.ts`) to bare text or a documented
 * placeholder — never silently mangling surrounding structure. It is NOT a round-trip
 * guarantee; the lossless in-app path is the native clipboard fragment (`native-clipboard`).
 *
 * Objects export from their *baked* fields only (D2 / docs/006 §5.8) — never a live or
 * recomputed value — so the export tier can always reproduce them; an object with a missing
 * bake emits a placeholder comment, never a guess. Inline marks export per maximal segment
 * (`segmentLeaf`): each constant-mark run is wrapped independently, which is always valid
 * markdown (`**a** **b**`) and avoids the open/close-stack hazards of overlapping ranges.
 *
 * Pure (snapshot → string), DOM-free, framework-free — markdown stays out of `core/**` but
 * needs no React, so it lives in the view layer as transport, not engine.
 */
import {
  bakeObjectData,
  createDefaultBlockRegistry,
  safeHref,
  segmentLeaf,
  type BlockRegistry,
  type EditorDocumentSnapshot,
  type EditorNode,
  type JsonValue,
  type NodeId,
  type ObjectNode,
  type StructuralNode,
  type TextLeafNode,
  type TextSegment,
} from "../../core";
import { isRecord } from "@quanghuy1242/idco-lib";
import {
  INLINE_CODE_MARKER,
  MARK_MARKERS,
  headingHashesForTag,
  normalizeCalloutTone,
} from "./transformers";

type Blocks = Readonly<Record<NodeId, EditorNode>>;

export type SnapshotToMarkdownOptions = {
  /**
   * Registry used to bake any object whose `baked` snapshot is missing (default built-ins).
   * Pass `store.registry` when the document carries custom object types so they bake too.
   */
  readonly registry?: BlockRegistry;
};

/** Serialize a whole snapshot to markdown (the public export entry). */
export function snapshotToMarkdown(
  snapshot: EditorDocumentSnapshot,
  options?: SnapshotToMarkdownOptions,
): string {
  // Bake any unbaked object on demand before serializing. The store baking is *lazy* — an
  // object loaded from import/compat (a divider from the seed corpus) has no `baked` until a
  // render/resolve fills it, and export reads baked fields only. Re-baking here is the pure,
  // deterministic bake (the same the reader's preview runs), so a divider exports as `---`
  // rather than the `<!-- divider (unbaked) -->` placeholder. The placeholder is then reserved
  // for a *genuine* bake failure (e.g. media with no source), which is the honest lossy case.
  const registry = options?.registry ?? createDefaultBlockRegistry();
  const blocks = bakeMissingObjects(snapshot.body.blocks, registry);
  const chunks = sequenceToMarkdown(snapshot.body.order, blocks, 0);
  // One blank line between top-level blocks; trim a trailing newline so the output is
  // stable for the round-trip test (re-parsing ignores trailing whitespace anyway).
  return (
    chunks.join("\n\n").replace(/\n+$/, "") + (chunks.length > 0 ? "\n" : "")
  );
}

/**
 * Return `blocks` with every unbaked object's `baked` filled in from the registry (copy-on-
 * write, so a fully-baked snapshot is returned unchanged). Pure: re-baking is a function of
 * (registry, type, data), so this reproduces the static representation the store would have
 * cached — it never invents a live/computed value (D2).
 */
function bakeMissingObjects(blocks: Blocks, registry: BlockRegistry): Blocks {
  let result: Record<NodeId, EditorNode> | null = null;
  for (const [id, node] of Object.entries(blocks) as [NodeId, EditorNode][]) {
    if (node.kind !== "object" || node.baked) continue;
    const baked = bakeObjectData(registry, node.type, node.data).baked;
    if (!baked) continue; // a genuine bake failure → the placeholder path handles it
    if (!result) result = { ...blocks };
    result[id] = { ...node, baked };
  }
  return result ?? blocks;
}

/**
 * Serialize a sibling id sequence, coalescing consecutive list items (flat `listitem`
 * leaves and structural `listitem` containers, the SN-1 heterogeneous run) into one list
 * block with continuous numbering. Returns one markdown chunk per render unit.
 */
function sequenceToMarkdown(
  ids: readonly NodeId[],
  blocks: Blocks,
  baseIndent: number,
): string[] {
  const chunks: string[] = [];
  let run: EditorNode[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    chunks.push(listRunToMarkdown(run, blocks, baseIndent));
    run = [];
  };
  for (const id of ids) {
    const node = blocks[id];
    if (!node) continue;
    if (isListItemNode(node)) {
      run.push(node);
      continue;
    }
    flushRun();
    const chunk = blockToMarkdown(node, blocks, baseIndent);
    if (chunk !== null) chunks.push(chunk);
  }
  flushRun();
  return chunks;
}

function isListItemNode(node: EditorNode): boolean {
  return (
    (node.kind === "text" && node.type === "listitem") ||
    (node.kind === "structural" && node.type === "listitem")
  );
}

/** A flat list item's flavour, for marker selection and run-splitting. */
function flavourOf(node: EditorNode): "bullet" | "number" | "checklist" {
  if (node.kind === "text" && typeof node.attrs?.checked === "boolean") {
    return "checklist";
  }
  const listType = node.kind === "text" ? node.attrs?.listType : undefined;
  return listType === "number" ? "number" : "bullet";
}

/**
 * Render a contiguous list run to markdown. A run may interleave flat `listitem` leaves
 * (carrying `attrs.indent` depth) and structural `listitem` containers (holding an inner
 * leaf + block children, the SN-1 / import shape). Ordered numbering is continuous across
 * the run per indent level; nested content indents two spaces per level.
 */
function listRunToMarkdown(
  items: readonly EditorNode[],
  blocks: Blocks,
  baseIndent: number,
): string {
  const lines: string[] = [];
  // Per-(indent depth) ordinal counters so ordered numbering is continuous within a level
  // and restarts when the level is re-entered.
  const counters = new Map<number, number>();
  for (const item of items) {
    if (item.kind === "structural" && item.type === "listitem") {
      lines.push(
        ...structuralListItemLines(item, blocks, baseIndent, counters),
      );
      continue;
    }
    if (item.kind === "text") {
      const depth = baseIndent + indentOf(item.attrs);
      lines.push(flatListItemLine(item, depth, counters));
    }
  }
  return lines.join("\n");
}

function indentOf(attrs: EditorNode["attrs"]): number {
  const indent = attrs?.indent;
  return typeof indent === "number" && indent > 0 ? indent : 0;
}

/** Marker + inline text for one flat `listitem` leaf at `depth`. */
function flatListItemLine(
  node: TextLeafNode,
  depth: number,
  counters: Map<number, number>,
): string {
  const pad = "  ".repeat(depth);
  const flavour = flavourOf(node);
  const inline = inlineToMarkdown(node);
  if (flavour === "checklist") {
    const checked = node.attrs?.checked === true;
    return `${pad}- [${checked ? "x" : " "}] ${inline}`;
  }
  if (flavour === "number") {
    const next = (counters.get(depth) ?? 0) + 1;
    counters.set(depth, next);
    return `${pad}${next}. ${inline}`;
  }
  // A bullet resets the deeper ordered counters so a following ordered sublist restarts.
  return `${pad}- ${inline}`;
}

/**
 * Lines for one structural `listitem` (SN-1 Option A): its inner text leaf is the item
 * line; its block children render nested, indented one level deeper. A child sublist's
 * items continue inline; a child code-block/paragraph indents under the item.
 */
function structuralListItemLines(
  node: StructuralNode,
  blocks: Blocks,
  depth: number,
  counters: Map<number, number>,
): string[] {
  const children = node.children
    .map((id) => blocks[id])
    .filter((c): c is EditorNode => Boolean(c));
  const inner = children.find(
    (c) => c.kind === "text" && c.type === "listitem",
  ) as TextLeafNode | undefined;
  const rest = children.filter((c) => c !== inner);
  const pad = "  ".repeat(depth);
  const innerText = inner ? inlineToMarkdown(inner) : "";
  // Reuse the flat-leaf marker logic for the item line by faking the inner leaf's flavour.
  const head = inner
    ? flatListItemLine(inner, depth, counters)
    : `${pad}- ${innerText}`;
  const lines = [head];
  for (const child of rest) {
    if (child.kind === "structural" && child.type === "list") {
      // A nested sublist: its items render one level deeper, continuing the run.
      const sub = listRunToMarkdown(
        child.children
          .map((id) => blocks[id])
          .filter((c): c is EditorNode => Boolean(c)),
        blocks,
        depth + 1,
      );
      if (sub.length > 0) lines.push(sub);
      continue;
    }
    // A non-list block child (code-block, paragraph, table): render and indent each line
    // two spaces under the item so markdown attaches it to the item.
    const chunk = blockToMarkdown(child, blocks, 0);
    if (chunk !== null) {
      lines.push(indentBlock(chunk, depth + 1));
    }
  }
  return lines;
}

function indentBlock(chunk: string, depth: number): string {
  const pad = "  ".repeat(depth);
  return chunk
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}

/** Serialize one non-list block to a markdown chunk, or null when it has no representation. */
function blockToMarkdown(
  node: EditorNode,
  blocks: Blocks,
  baseIndent: number,
): string | null {
  if (node.kind === "text") return textLeafToMarkdown(node);
  if (node.kind === "object") return objectToMarkdown(node);
  return structuralToMarkdown(node, blocks, baseIndent);
}

function textLeafToMarkdown(node: TextLeafNode): string {
  const inline = inlineToMarkdown(node);
  switch (node.type) {
    case "heading":
      return `${headingHashesForTag(node.attrs?.tag)} ${inline}`;
    case "quote":
      // A flat quote leaf: prefix every (soft-broken) line with `> `.
      return inline
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    default:
      return inline;
  }
}

function structuralToMarkdown(
  node: StructuralNode,
  blocks: Blocks,
  baseIndent: number,
): string | null {
  const children = node.children
    .map((id) => blocks[id])
    .filter((c): c is EditorNode => Boolean(c));
  switch (node.type) {
    case "callout": {
      const tone = normalizeCalloutTone(node.attrs?.tone);
      const inner = sequenceToMarkdown(node.children, blocks, baseIndent).join(
        "\n\n",
      );
      return `:::${tone}\n${inner}\n:::`;
    }
    case "quote": {
      const inner = sequenceToMarkdown(node.children, blocks, baseIndent).join(
        "\n\n",
      );
      return inner
        .split("\n")
        .map((line) => (line.length > 0 ? `> ${line}` : ">"))
        .join("\n");
    }
    case "list":
      return listRunToMarkdown(children, blocks, baseIndent);
    case "listitem":
      return structuralListItemLines(node, blocks, baseIndent, new Map()).join(
        "\n",
      );
    case "table":
      return tableToMarkdown(node, blocks);
    default:
      // An unknown structural container: emit its children so content is never lost.
      return sequenceToMarkdown(node.children, blocks, baseIndent).join("\n\n");
  }
}

/** GFM table from a structural table's rows/cells (merged cells drop to the lossy set). */
function tableToMarkdown(node: StructuralNode, blocks: Blocks): string {
  const rows = node.children
    .map((id) => blocks[id])
    .filter(
      (r): r is StructuralNode =>
        Boolean(r) && r!.kind === "structural" && r!.type === "tablerow",
    );
  if (rows.length === 0) return "";
  const grid = rows.map((row) => {
    const out: string[] = [];
    for (const id of row.children) {
      const cell = blocks[id];
      if (!cell || cell.kind !== "structural" || cell.type !== "tablecell") {
        continue;
      }
      out.push(cellText(cell, blocks));
      // A horizontally-merged cell (`colSpan > 1`) has no GFM analog, so the merge is dropped
      // to the lossy set (D2). Emit empty placeholder cells for the columns it spanned so the
      // *remaining* cells stay column-aligned rather than shifting left into the wrong column
      // ("never silently mangling surrounding structure"). `rowSpan` has no markdown analog
      // either and is left as documented loss.
      const colSpan = numberAttr(cell.attrs?.colSpan);
      for (let i = 1; i < colSpan; i += 1) out.push("");
    }
    return out;
  });
  const columns = Math.max(...grid.map((r) => r.length));
  const pad = (cells: string[]) => {
    const filled = [...cells];
    while (filled.length < columns) filled.push("");
    return `| ${filled.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;
  };
  const header = grid[0]!;
  const lines = [pad(header), `| ${Array(columns).fill("---").join(" | ")} |`];
  for (const row of grid.slice(1)) lines.push(pad(row));
  return lines.join("\n");
}

/** A table cell's plain inline text (cell holds a paragraph; merged cells are lossy). */
function cellText(cell: StructuralNode, blocks: Blocks): string {
  const parts: string[] = [];
  for (const id of cell.children) {
    const child = blocks[id];
    if (child?.kind === "text") parts.push(inlineToMarkdown(child));
  }
  return parts.join(" ").replace(/\n/g, " ");
}

/** Serialize an object from its baked fields only (D2). Missing bake → a placeholder. */
function objectToMarkdown(node: ObjectNode): string {
  const baked = node.baked;
  if (!baked) return `<!-- ${node.type} (unbaked) -->`;
  const payload = payloadRecord(baked.payload);
  switch (baked.kind) {
    case "divider":
      return "---";
    case "code": {
      const code = stringField(payload.code);
      const language = stringField(payload.language);
      return "```" + language + "\n" + code + "\n```";
    }
    case "media": {
      // Sanitize with no raw-URL fallback: an unsafe src must never reach exported markdown
      // (it clears to an empty target, not the dangerous URL). Caption has no markdown image
      // analog → lossy (carried by the native fragment).
      const src = safeHref(stringField(payload.src));
      const alt = stringField(payload.alt);
      return `![${alt}](${src})`;
    }
    case "embed": {
      const safe = safeHref(stringField(payload.url));
      const title = stringField(payload.title);
      return title.length > 0 ? `[${title}](${safe})` : `<${safe}>`;
    }
    case "post-ref": {
      const safe = safeHref(stringField(payload.url));
      const title = stringField(payload.title);
      return title.length > 0 ? `[${title}](${safe})` : `[post](${safe})`;
    }
    case "toc":
      // The directive form (no native markdown); import recognizes it back.
      return ":::toc\n:::";
    default:
      return `<!-- ${baked.kind} -->`;
  }
}

// --- inline -----------------------------------------------------------------

/**
 * Serialize a text leaf's inline content to markdown. Each `segmentLeaf` segment is a
 * maximal run with one constant mark set, so wrapping each independently is always valid
 * markdown and sidesteps overlapping-range bracket hazards. A `code` segment wraps in
 * backticks and drops any co-located format marks (markdown cannot nest inside code — the
 * documented lossy edge); a `link` wraps the (still-formatted) segment text in `[…](href)`.
 */
function inlineToMarkdown(node: TextLeafNode): string {
  const segments = segmentLeaf(node);
  return segments.map((seg) => segmentToMarkdown(seg)).join("");
}

function segmentToMarkdown(seg: TextSegment): string {
  const kinds = new Set(seg.marks.map((m) => m.kind));
  const link = seg.marks.find((m) => m.kind === "link");
  const href = link ? safeHref(stringAttr(link.attrs, "href")) : "";
  // Code is a hard wrapper: no other markers go inside it (lossy for co-marks).
  if (kinds.has("code")) {
    const code = `${INLINE_CODE_MARKER}${seg.text}${INLINE_CODE_MARKER}`;
    return wrapLink(code, href);
  }
  let text = escapeInline(seg.text);
  // Open/close the format markers in table order so nesting is deterministic.
  const active = MARK_MARKERS.filter((m) => kinds.has(m.kind));
  for (const m of active) text = `${m.marker}${text}${m.marker}`;
  return wrapLink(text, href);
}

function wrapLink(text: string, href: string): string {
  return href.length > 0 ? `[${text}](${href})` : text;
}

/**
 * Escape the markdown-significant inline characters so literal text round-trips instead of
 * being re-parsed as formatting. Deliberately conservative (backslash plus the wrapper
 * chars this exporter emits) — full CommonMark escaping is unnecessary for the representable
 * set and would hurt readability.
 */
function escapeInline(text: string): string {
  return (
    text
      .replace(/([\\`*_[\]])/g, "\\$1")
      // Escape *doubled* `==`/`~~` so literal text never re-imports as highlight/strikethrough
      // (a single `=`/`~` is not a marker, so it is left readable). Both chars are escaped so
      // the run cannot pair on re-parse.
      .replace(/==/g, "\\=\\=")
      .replace(/~~/g, "\\~\\~")
      // An intra-paragraph newline is a *hard* break: emit the two-trailing-space form so it
      // re-imports as a newline, not collapsed to a space (a bare `\n` re-parses as a soft
      // break = space, losing the line break — docs/030 §7.2 round-trip).
      .replace(/\n/g, "  \n")
  );
}

/** A `JsonValue` payload as a keyed record (or empty), via the shared record guard. */
function payloadRecord(value: JsonValue): { readonly [k: string]: JsonValue } {
  return isRecord(value) ? (value as { readonly [k: string]: JsonValue }) : {};
}

function stringField(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/** A positive integer attr (e.g. `colSpan`), defaulting to 1. */
function numberAttr(value: JsonValue | undefined): number {
  return typeof value === "number" && value > 1 ? Math.trunc(value) : 1;
}

function stringAttr(
  attrs: { readonly [k: string]: JsonValue } | undefined,
  key: string,
): string {
  const value = attrs?.[key];
  return typeof value === "string" ? value : "";
}
