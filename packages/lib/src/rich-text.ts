/**
 * Rich-text document contracts plus heading, anchor, and table-of-contents helpers.
 *
 * @module
 * @categoryDefault Rich Text
 */

/** One node in a rich-text document tree: an optional type, text, children, and the open bag of node-specific attributes. */
export type RichTextDocumentNode = {
  readonly type?: string;
  readonly text?: string;
  readonly children?: readonly RichTextDocumentNode[];
  readonly tag?: string;
  readonly anchorId?: string;
  readonly minLevel?: unknown;
  readonly maxLevel?: unknown;
  readonly numbering?: unknown;
  readonly style?: unknown;
  readonly title?: unknown;
  readonly [key: string]: unknown;
};

/** A whole rich-text document: a single root whose children are the top-level nodes. */
export type RichTextDocument = {
  readonly root: {
    readonly children?: readonly RichTextDocumentNode[];
  };
};

/** A heading depth, one through six. */
export type RichTextHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
/** A heading HTML tag name, `h1` through `h6`. */
export type RichTextHeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
/** Whether table-of-contents entries carry a numeric prefix (`decimal`) or none. */
export type RichTextTocNumbering = "none" | "decimal";
/** The visual treatment of a rendered table of contents. */
export type RichTextTocStyle = "panel" | "plain" | "compact";
/** `inline` renders the TOC as a block in the flow; `aside` pins it to a sticky side rail. */
export type RichTextTocPlacement = "inline" | "aside";
/** Which side a `placement: "aside"` rail docks to. */
export type RichTextTocSide = "left" | "right";

/** Fully resolved table-of-contents settings: title, the heading level range to include, numbering, style, and placement. */
export type RichTextTocSettings = {
  readonly title: string;
  readonly minLevel: RichTextHeadingLevel;
  readonly maxLevel: RichTextHeadingLevel;
  readonly numbering: RichTextTocNumbering;
  readonly style: RichTextTocStyle;
  readonly placement: RichTextTocPlacement;
  readonly side: RichTextTocSide;
};

/** Loosely typed, possibly partial table-of-contents settings as read from stored node data, before normalization fills in defaults. */
export type RichTextTocSettingsInput = {
  readonly title?: unknown;
  readonly minLevel?: unknown;
  readonly maxLevel?: unknown;
  readonly numbering?: unknown;
  readonly style?: unknown;
  readonly placement?: unknown;
  readonly side?: unknown;
};

/** One resolved table-of-contents entry: a heading's anchor id, href, text, tag/level, outline depth, and ordinal numbering. */
export type RichTextTocEntry = {
  readonly id: string;
  readonly href: string;
  readonly text: string;
  readonly tag: RichTextHeadingTag;
  readonly level: RichTextHeadingLevel;
  readonly depth: number;
  readonly number?: string;
  readonly ordinal: readonly number[];
};

const HEADING_TAGS: readonly RichTextHeadingTag[] = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
];

const DEFAULT_TOC_SETTINGS: RichTextTocSettings = {
  maxLevel: 4,
  minLevel: 1,
  numbering: "decimal",
  placement: "inline",
  side: "left",
  style: "plain",
  title: "Table of contents",
};

/** Map a heading tag (`h1`–`h6`) to its numeric level, defaulting to 2 for anything unrecognized. */
export function headingLevelFromTag(value: unknown): RichTextHeadingLevel {
  return value === "h1"
    ? 1
    : value === "h2"
      ? 2
      : value === "h3"
        ? 3
        : value === "h4"
          ? 4
          : value === "h5"
            ? 5
            : value === "h6"
              ? 6
              : 2;
}

/** Map a numeric heading level (1–6) to its tag name (`h1`–`h6`). */
export function headingTagFromLevel(
  level: RichTextHeadingLevel,
): RichTextHeadingTag {
  return HEADING_TAGS[level - 1] ?? "h2";
}

/** Flatten a node (or list of nodes) to its concatenated plain text, recursing through children. */
export function richTextNodeText(
  node: RichTextDocumentNode | readonly RichTextDocumentNode[] | undefined,
): string {
  if (!node) return "";
  if (Array.isArray(node)) {
    return (node as readonly RichTextDocumentNode[])
      .map(richTextNodeText)
      .join("");
  }
  const current = node as RichTextDocumentNode;
  if (typeof current.text === "string") return current.text;
  if (typeof current.term === "string") return current.term;
  return richTextNodeText(current.children);
}

/** Slugify a string into a URL-safe heading anchor, falling back to a default when nothing usable remains. */
export function slugifyHeadingAnchor(value: string, fallback = "section") {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug || fallback;
}

/** Slugify a preferred anchor and de-duplicate it against an in-use set by appending a numeric suffix, recording the chosen id. */
export function allocateHeadingAnchorId(preferred: string, used: Set<string>) {
  const base = slugifyHeadingAnchor(preferred);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

/** Return a copy of the document with every heading assigned a unique, stable anchor id. */
export function ensureRichTextHeadingAnchors<T extends RichTextDocument>(
  document: T,
): T {
  const used = new Set<string>();
  return {
    ...document,
    root: {
      ...document.root,
      children: repairHeadingAnchors(document.root.children ?? [], used),
    },
  };
}

/** Coerce loosely typed, possibly partial TOC settings into a fully resolved {@link RichTextTocSettings}, filling defaults and ordering the level range. */
export function normalizeTocSettings(
  node: RichTextTocSettingsInput | undefined,
): RichTextTocSettings {
  let minLevel = levelValue(node?.minLevel) ?? DEFAULT_TOC_SETTINGS.minLevel;
  let maxLevel = levelValue(node?.maxLevel) ?? DEFAULT_TOC_SETTINGS.maxLevel;
  if (minLevel > maxLevel) {
    [minLevel, maxLevel] = [maxLevel, minLevel];
  }
  const numbering =
    node?.numbering === "decimal" || node?.numbering === "none"
      ? node.numbering
      : DEFAULT_TOC_SETTINGS.numbering;
  const style =
    node?.style === "plain" ||
    node?.style === "compact" ||
    node?.style === "panel"
      ? node.style
      : DEFAULT_TOC_SETTINGS.style;
  const title =
    typeof node?.title === "string" && node.title.trim()
      ? node.title.trim()
      : DEFAULT_TOC_SETTINGS.title;
  const placement =
    node?.placement === "aside" || node?.placement === "inline"
      ? node.placement
      : DEFAULT_TOC_SETTINGS.placement;
  const side =
    node?.side === "left" || node?.side === "right"
      ? node.side
      : DEFAULT_TOC_SETTINGS.side;
  return { maxLevel, minLevel, numbering, placement, side, style, title };
}

/** Build the ordered, nested table-of-contents entries for a document, deriving anchors, outline depth, and numbering from its headings within the configured level range. */
export function collectRichTextTocEntries(
  document: RichTextDocument,
  settingsInput?: RichTextTocSettingsInput,
): RichTextTocEntry[] {
  const documentWithAnchors = ensureRichTextHeadingAnchors(document);
  const settings = normalizeTocSettings(settingsInput);
  // Build the outline as a tree from the headings that survive the level filter,
  // nesting each under the nearest preceding heading of a shallower level — so
  // depth reflects relative structure, not absolute level. Given h1 → h3 → h2,
  // the h3 and the h2 are both children of the h1 (same depth); the h3 is not
  // forced a level deeper than the h2 just because its tag is deeper. `stack`
  // holds the levels of the open ancestors; `counters[d]` the running ordinal at
  // depth d. Depth only ever grows by one (we push a single level), so the
  // ordinal is always fully populated — no fabricated or missing segments.
  const stack: number[] = [];
  const counters: number[] = [];
  const entries: RichTextTocEntry[] = [];

  visitNodes(documentWithAnchors.root.children ?? [], (node) => {
    if (!isHeadingNode(node)) return;
    const level = headingLevelFromTag(node.tag);
    if (level < settings.minLevel || level > settings.maxLevel) return;
    while (stack.length > 0 && (stack[stack.length - 1] ?? 0) >= level) {
      stack.pop();
    }
    const depth = stack.length;
    stack.push(level);
    counters.length = depth + 1;
    counters[depth] = (counters[depth] ?? 0) + 1;
    const ordinal = counters.slice(0, depth + 1);
    const id = slugifyHeadingAnchor(node.anchorId ?? richTextNodeText(node));
    const text = richTextNodeText(node).trim() || "Untitled section";
    entries.push({
      depth,
      href: `#${id}`,
      id,
      level,
      number: settings.numbering === "decimal" ? ordinal.join(".") : undefined,
      ordinal,
      tag: headingTagFromLevel(level),
      text,
    });
  });

  return entries;
}

function repairHeadingAnchors(
  nodes: readonly RichTextDocumentNode[],
  used: Set<string>,
): RichTextDocumentNode[] {
  return nodes.map((node) => {
    const children = node.children
      ? repairHeadingAnchors(node.children, used)
      : undefined;
    if (!isHeadingNode(node)) {
      return children ? { ...node, children } : node;
    }
    const text = richTextNodeText(children ?? node.children).trim();
    const preferred =
      typeof node.anchorId === "string" && node.anchorId.trim()
        ? node.anchorId
        : text || "section";
    return {
      ...node,
      ...(children ? { children } : {}),
      anchorId: allocateHeadingAnchorId(preferred, used),
    };
  });
}

function visitNodes(
  nodes: readonly RichTextDocumentNode[],
  visit: (node: RichTextDocumentNode) => void,
): void {
  for (const node of nodes) {
    visit(node);
    if (node.children) visitNodes(node.children, visit);
  }
}

function isHeadingNode(node: RichTextDocumentNode): boolean {
  return node.type === "heading" || node.type === "editor-heading";
}

function levelValue(value: unknown): RichTextHeadingLevel | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 6
    ? (value as RichTextHeadingLevel)
    : undefined;
}
