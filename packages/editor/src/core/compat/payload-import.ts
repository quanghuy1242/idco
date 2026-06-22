/**
 * Payload-Lexical → owned-model import adapter (docs/010 Phase 8 AC7, docs/017 §3.4).
 *
 * The real corpus (`payloadcms.db`) speaks vanilla Payload/Lexical, a *third*
 * dialect the runtime `compat` layer does not read: it carries `upload`,
 * `youtube`, `horizontalrule`, `block` (Payload Blocks), `epub-internal-link`,
 * and Lexical tables. `compat.createEditorStoreFromCompat` throws on those. This
 * adapter is the bridge: it rewrites a Payload Lexical document into the
 * `RichTextCompatDocument` shape the engine already ingests, mapping the dialect
 * node types to owned-model node types and **dropping-with-report** anything it
 * cannot map — never throwing on real data (AC7).
 *
 * Mapping (docs/017 §3.4 matrix):
 * - `upload`            → `media` (src/alt/caption from the upload value)
 * - `youtube`           → `embed` (url derived from the video id)
 * - `horizontalrule`    → `divider`
 * - inline `link` / `epub-internal-link` → kept inline (compat recovers them as
 *   `link` range marks, pre-Phase-8 fix)
 * - `list` (container)  → flattened to its `listitem` children (blog parity;
 *   deep nesting is a books follow-on)
 * - `table` / Lexical table → opaque `table` object (round-trips, not edited)
 * - `block` (Payload Blocks), unknown types → dropped, counted in the report
 *
 * It is framework-free core: it manipulates plain JSON only.
 */
import type { DocumentSettings, RichTextCompatNode } from "../model";
import type { RichTextCompatDocument } from "../model";
import { globalNodeDefinitions } from "../registry";
import { globalStructuralDefinitions } from "../registry";

/** A Payload/Lexical node is loose JSON; we read only the fields we map. */
type PayloadNode = {
  readonly type?: string;
  readonly children?: readonly PayloadNode[];
  readonly [key: string]: unknown;
};

export type PayloadLexicalInput = {
  readonly root?: { readonly children?: readonly PayloadNode[] };
  readonly settings?: DocumentSettings;
};

/** What the import mapped and dropped, so a host can surface it (never silent). */
export type PayloadImportReport = {
  /** Count of each node type that was dropped because it has no mapping. */
  readonly dropped: Readonly<Record<string, number>>;
  /** Count of each dialect type that was mapped to an owned-model type. */
  readonly mapped: Readonly<Record<string, number>>;
};

export type PayloadImportResult = {
  readonly document: RichTextCompatDocument;
  readonly report: PayloadImportReport;
};

class ReportBuilder {
  readonly dropped: Record<string, number> = {};
  readonly mapped: Record<string, number> = {};
  drop(type: string): void {
    this.dropped[type] = (this.dropped[type] ?? 0) + 1;
  }
  map(type: string): void {
    this.mapped[type] = (this.mapped[type] ?? 0) + 1;
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Map an `upload` node to a `media` compat node, reading the upload value. */
function uploadToMedia(node: PayloadNode): RichTextCompatNode {
  const value = record(node.value);
  const src = str(value.url) || str(value.filename) || str(node.src);
  return {
    alt: str(value.alt) || str(node.alt),
    caption: str(value.caption) || str(node.caption),
    mediaId: str(value.id) || str(node.value),
    src,
    type: "media",
  };
}

/** Map a `youtube` node to an `embed` compat node, deriving a watch URL. */
function youtubeToEmbed(node: PayloadNode): RichTextCompatNode {
  const id =
    str(node.videoID) || str(node.id) || str(record(node.fields).videoID);
  const url = id ? `https://www.youtube.com/watch?v=${id}` : str(node.url);
  return { title: str(node.title), type: "embed", url };
}

/**
 * Map a Lexical/Payload table to the `table` compat shape. The table is a
 * structural container now (docs/022): its `tablerow`/`tablecell` children import
 * recursively through the structural registry (`core/table.ts`), with cell
 * paragraphs becoming the cell's block children — so a Payload table is edited, not
 * an opaque blob. Extra Lexical keys are ignored by the table definition.
 */
function toTableObject(node: PayloadNode): RichTextCompatNode {
  return {
    type: "table",
    ...(node as Record<string, unknown>),
  } as RichTextCompatNode;
}

/** Recursively map one Payload inline node, keeping inline links and text. */
function mapInline(node: PayloadNode): PayloadNode | null {
  if (node.type === "linebreak") return { text: "\n", type: "text" };
  if (node.type === "tab") return { text: "\t", type: "text" };
  if (
    node.type === "text" ||
    node.type === "link" ||
    node.type === "autolink" ||
    node.type === "epub-internal-link"
  ) {
    // `autolink` is Lexical's auto-detected link; normalize it to `link`.
    const mappedType = node.type === "autolink" ? "link" : node.type;
    const children = node.children?.map(mapInline).filter(isNode) ?? undefined;
    return { ...node, type: mappedType, ...(children ? { children } : {}) };
  }
  return null;
}

function isNode<T>(value: T | null): value is T {
  return value !== null;
}

/**
 * Try each registered node / structural definition's `fromPayload` hook (W8), so
 * a host's custom node maps its own Payload dialect type without editing this
 * importer. Only globally-registered (custom) definitions are consulted; the
 * built-in dialect types keep their explicit mappings in `mapBlock`. Order:
 * object definitions first, then structural, first non-null wins — so two hooks
 * answering the same dialect type resolve deterministically (object precedence).
 */
function mapViaRegistry(node: PayloadNode): RichTextCompatNode | null {
  for (const definition of [
    ...globalNodeDefinitions(),
    ...globalStructuralDefinitions(),
  ]) {
    const mapped = definition.fromPayload?.(node as Record<string, unknown>);
    if (mapped) return mapped;
  }
  return null;
}

function isInlineContainer(type: string | undefined): boolean {
  return (
    type === "paragraph" ||
    type === "heading" ||
    type === "quote" ||
    type === "listitem"
  );
}

/** Map one top-level (block) Payload node, recording the mapping or drop. */
function mapBlock(
  node: PayloadNode,
  report: ReportBuilder,
  out: RichTextCompatNode[],
): void {
  const type = node.type ?? "";
  if (isInlineContainer(type)) {
    const children = (node.children ?? []).map(mapInline).filter(isNode);
    out.push({ ...node, children } as RichTextCompatNode);
    return;
  }
  if (type === "list") {
    // Flatten the list to its items (blog parity; deep nesting is a follow-on).
    // Carry the list flavour (`listType: "bullet" | "number"`) onto each item so
    // an ordered list survives the flatten and renders as numbers, not bullets
    // (docs/018 §2.10 editor↔reader ordered-list drift). Lexical lists carry the
    // flavour on `listType` (or the `ol`/`ul` `tag`); a check list maps to bullet.
    report.map("list");
    const listType =
      node.listType === "number" || node.tag === "ol" ? "number" : "bullet";
    for (const item of node.children ?? []) {
      const inline: PayloadNode[] = [];
      const nested: PayloadNode[] = [];
      for (const child of item.children ?? []) {
        const mapped = mapInline(child);
        if (mapped) inline.push(mapped);
        else if (child.type === "list") nested.push(child);
        // A non-inline, non-list item child (e.g. a block) is dropped with a
        // report entry rather than vanishing (docs/010 §7 no-silent-skip).
        else report.drop(`listitem>${child.type ?? "unknown"}`);
      }
      out.push({
        ...item,
        children: inline,
        listType,
        type: "listitem",
      } as RichTextCompatNode);
      // Flatten a nested list into following top-level items so its content is
      // preserved (one level of indentation lost), never silently dropped.
      for (const sublist of nested) mapBlock(sublist, report, out);
    }
    return;
  }
  switch (type) {
    case "upload":
      report.map("upload");
      out.push(uploadToMedia(node));
      return;
    case "youtube":
      report.map("youtube");
      out.push(youtubeToEmbed(node));
      return;
    case "horizontalrule":
    case "horizontal-rule":
      report.map("horizontalrule");
      out.push({ type: "divider" });
      return;
    case "table":
    case "lexical-table":
      report.map("table");
      out.push(toTableObject(node));
      return;
    case "code":
    case "code-block":
      report.map("code-block");
      out.push({
        ...(node as Record<string, unknown>),
        type: "code-block",
      } as RichTextCompatNode);
      return;
    default: {
      // A registered custom node (object or structural) may map its own Payload
      // dialect type before we drop it (note.md W8), so a host adds a mapping
      // without editing this importer.
      const custom = mapViaRegistry(node);
      if (custom) {
        report.map(type || "unknown");
        out.push(custom);
        return;
      }
      // `block` (Payload Blocks) and any unmapped type: drop with a report entry,
      // never throw on real data (AC7).
      report.drop(type || "unknown");
      return;
    }
  }
}

/**
 * Import a Payload Lexical document to the engine's compat shape plus a report.
 * Pass the document to `createEditorStoreFromCompat` to build a store.
 */
export function importPayloadLexical(
  input: PayloadLexicalInput,
): PayloadImportResult {
  const report = new ReportBuilder();
  const out: RichTextCompatNode[] = [];
  for (const node of input.root?.children ?? []) {
    mapBlock(node, report, out);
  }
  return {
    document: {
      root: { children: out },
      ...(input.settings ? { settings: input.settings } : {}),
    },
    report: { dropped: report.dropped, mapped: report.mapped },
  };
}
