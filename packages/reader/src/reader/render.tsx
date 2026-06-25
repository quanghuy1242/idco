/**
 * The reader's render dispatch (docs/028 §4.1) — the ONE snapshot-native, RSC-safe,
 * kind-keyed walk that turns a native `EditorDocumentSnapshot` into L1 primitives. It
 * replaces the deleted compat-walk fork (docs/028 §2/§3.1), which keyed off the
 * Lexical-shaped projection through a hand-maintained map and so silently dropped
 * dividers, image captions, and table-cell attributes. This walk reads the native model
 * directly — a divider is an object whose baked kind is `divider`, a cell carries its
 * `colSpan`/`backgroundColor` in `attrs` — so nothing is dropped by construction.
 *
 * It is the single source the editor's at-rest render also uses: the editor's
 * `RestingDocument` delegates here (docs/028 §4.4), so the editor preview and the
 * published page render block N identically and cannot drift. Pure and RSC-safe: it reads
 * the snapshot + the resolution kernel (`./model`), never the DOM, never a hook, never
 * `@idco/ui`, so the server `<Reader>` runs it with zero client JavaScript. Interactivity
 * (code highlighting beyond the baked HTML, TOC scroll-spy) is the opt-in island seam.
 *
 * Objects render from their **baked** snapshot (`node.baked.payload`); the caller hands a
 * baked snapshot (the editor bakes before delegating; persisted snapshots are baked). An
 * object with no bake renders a visible, non-silent placeholder — never a dropped block.
 */
import { Fragment, type ReactNode } from "react";
import {
  isRecord,
  normalizeTocSettings,
  type RichTextTocSettingsInput,
} from "@quanghuy1242/idco-lib";
import {
  RichTextBlockquote,
  RichTextCallout,
  RichTextCodeBlock,
  RichTextEmbed,
  RichTextEmphasis,
  RichTextGlossary,
  RichTextHeading,
  RichTextHighlight,
  RichTextInlineCode,
  RichTextInlineLink,
  RichTextList,
  RichTextListItem,
  RichTextMark,
  RichTextMediaFigure,
  RichTextParagraph,
  RichTextPostReference,
  RichTextStrikethrough,
  RichTextStrong,
  RichTextTable,
  RichTextTableCell,
  RichTextTableOfContents,
  RichTextTableRow,
  RichTextUnderline,
  type RichTextAlign,
  type RichTextCalloutTone,
  type RichTextHeadingLevel,
  type RichTextTableOfContentsEntry,
  type RichTextTableOfContentsStyle,
} from "../l1";
import {
  readerHeadingAnchor,
  readerHeadingLevel,
  resolveLeafMarks,
  safeHref,
  segmentText,
  type ReaderResolvedMark,
} from "./model";
import type {
  ReaderBlockNode,
  ReaderObjectNode,
  ReaderOptions,
  ReaderSnapshot,
  ReaderStructuralNode,
  ReaderTextNode,
} from "./types";

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// --- text leaves + marks -----------------------------------------------------

/**
 * Inline-mark nesting rank (mirror of the editor's `markNestingRank`, mark-render.tsx):
 * lower = outermost. The reader sorts a segment's marks by this so a `bold`+`link` run
 * nests `<a><strong>…` exactly as the editor's resting render does.
 */
const MARK_RANK: Readonly<Record<string, number>> = {
  link: 0,
  comment: 1,
  glossary: 2,
  highlight: 3,
  bold: 4,
  italic: 5,
  underline: 6,
  strikethrough: 7,
  subscript: 8,
  superscript: 9,
  code: 10,
};

function markRank(kind: string): number {
  return MARK_RANK[kind] ?? 50;
}

/** The text-align value carried on a block's `attrs.format` (note.md item 1). */
function blockAlign(attrs: Readonly<Record<string, unknown>> | undefined) {
  const format = attrs?.format;
  return format === "center" || format === "right" || format === "justify"
    ? (format as RichTextAlign)
    : undefined;
}

/** The heading tag from a leaf's `attrs.tag`, defaulting to `h2`. */
function headingTag(
  attrs: Readonly<Record<string, unknown>> | undefined,
): RichTextHeadingLevel {
  const tag = attrs?.tag;
  return tag === "h1" ||
    tag === "h2" ||
    tag === "h3" ||
    tag === "h4" ||
    tag === "h5" ||
    tag === "h6"
    ? tag
    : "h2";
}

/** Resolve a glossary term id to its definition from the document's own collection. */
function glossaryDefinition(snapshot: ReaderSnapshot, termId: unknown): string {
  if (typeof termId !== "string") return "";
  const terms = snapshot.collections?.glossary ?? [];
  const match = terms.find((item) => item.id === termId);
  return match ? str(match.definition) : "";
}

/** Wrap one segment's child in a mark's L1 element (the reader's navigable variants). */
function wrapMark(
  mark: ReaderResolvedMark,
  child: ReactNode,
  key: string,
  snapshot: ReaderSnapshot,
): ReactNode {
  switch (mark.kind) {
    case "bold":
      return <RichTextStrong key={key}>{child}</RichTextStrong>;
    case "italic":
      return <RichTextEmphasis key={key}>{child}</RichTextEmphasis>;
    case "underline":
      return <RichTextUnderline key={key}>{child}</RichTextUnderline>;
    case "strikethrough":
      return <RichTextStrikethrough key={key}>{child}</RichTextStrikethrough>;
    case "code":
      return <RichTextInlineCode key={key}>{child}</RichTextInlineCode>;
    case "highlight":
      return <RichTextHighlight key={key}>{child}</RichTextHighlight>;
    case "comment":
      // A comment annotation reads as a highlight in the published page (docs/015 §12).
      return <RichTextMark key={key}>{child}</RichTextMark>;
    case "subscript":
      return <sub key={key}>{child}</sub>;
    case "superscript":
      return <sup key={key}>{child}</sup>;
    case "link": {
      const href = safeHref(mark.attrs?.href);
      // A sanitized-away (javascript:/data:) href renders inert, never a live link.
      return href ? (
        <RichTextInlineLink href={href} key={key}>
          {child}
        </RichTextInlineLink>
      ) : (
        <span key={key}>{child}</span>
      );
    }
    case "glossary": {
      // Wrap the run's content (the `child`, which may already carry bold/italic) in the abbr;
      // the resolved definition is only the hover title. Substituting a `term` string here used
      // to drop a formatted glossary run, because its `child` is a React element, not a string.
      const definition = glossaryDefinition(snapshot, mark.attrs?.term);
      return (
        <RichTextGlossary definition={definition} key={key}>
          {child}
        </RichTextGlossary>
      );
    }
    default:
      return <span key={key}>{child}</span>;
  }
}

/** Render a leaf's text with its marks as nested L1 elements (mirror of `renderLeafMarks`). */
function renderLeafMarks(
  node: ReaderTextNode,
  snapshot: ReaderSnapshot,
): ReactNode {
  const resolved = resolveLeafMarks(node);
  const text = node.content.text;
  // Empty/unmarked leaf: a bare text node (or a zero-width space so an empty block keeps
  // its line box), matching the editor's resting leaf.
  if (resolved.length === 0) return text.length > 0 ? text : "​";
  const segments = segmentText(text, resolved);
  return segments.map((segment) => {
    let child: ReactNode = segment.text;
    // Innermost first: sort so the outermost (lowest-rank) mark wraps last.
    const ordered = [...segment.marks].sort(
      (a, b) => markRank(b.kind) - markRank(a.kind),
    );
    for (const mark of ordered) {
      child = wrapMark(mark, child, `${segment.from}:${mark.id}`, snapshot);
    }
    return <Fragment key={segment.from}>{child}</Fragment>;
  });
}

/** The block indent level from `attrs.indent` (set by indent/outdent + Tab), or undefined. */
function blockIndent(
  attrs: Readonly<Record<string, unknown>> | undefined,
): number | undefined {
  return typeof attrs?.indent === "number" && attrs.indent > 0
    ? attrs.indent
    : undefined;
}

/** Render a text leaf as its semantic L1 block. */
function renderTextLeaf(
  node: ReaderTextNode,
  snapshot: ReaderSnapshot,
): ReactNode {
  const children = renderLeafMarks(node, snapshot);
  const align = blockAlign(node.attrs);
  // The block indent rides on `attrs.indent` as a left margin, the same step the editing
  // surface uses, so a persisted indent (or a Tab) shows identically at rest (docs/018 §2.8).
  const indent = blockIndent(node.attrs);
  switch (node.type) {
    case "heading":
      return (
        <RichTextHeading
          align={align}
          anchorId={readerHeadingAnchor(node.id, node.attrs)}
          anchorLabel={node.content.text}
          indent={indent}
          level={headingTag(node.attrs)}
        >
          {children}
        </RichTextHeading>
      );
    case "quote":
      return (
        <RichTextBlockquote indent={indent}>{children}</RichTextBlockquote>
      );
    case "listitem":
      return <RichTextListItem indent={indent}>{children}</RichTextListItem>;
    default:
      return (
        <RichTextParagraph align={align} indent={indent}>
          {children}
        </RichTextParagraph>
      );
  }
}

// --- objects -----------------------------------------------------------------

/** Rewrite a YouTube watch/share URL to its embeddable form (mirror of embed.tsx). */
function toEmbeddableUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) return "";
  const youtube = url.match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/i,
  );
  return youtube ? `https://www.youtube.com/embed/${youtube[1]}` : url;
}

function embedAllowed(url: string, options: ReaderOptions): boolean {
  if (!url) return false;
  if (!options.allowedEmbedDomains?.length) return true;
  try {
    return options.allowedEmbedDomains.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** A visible, non-silent fallback — never a dropped block (docs/028 §8). */
function objectFallback(label: string): ReactNode {
  return (
    <div className="text-sm text-base-content/50" data-rt-object-fallback="">
      {label}
    </div>
  );
}

/** The object types the reader renders natively through L1 — the single source for them. */
const READER_BUILTIN_OBJECT_TYPES = new Set<string>([
  "divider",
  "media",
  "embed",
  "post-ref",
  "code",
  "code-block",
  "table-of-contents",
]);

function renderObject(
  node: ReaderObjectNode,
  snapshot: ReaderSnapshot,
  options: ReaderOptions,
): ReactNode {
  const baked = node.baked;
  // A custom type the reader has no built-in for defers to a host renderer (docs/028 §4.4).
  // The check is gated on "not a built-in" so a built-in always renders through L1 below —
  // it stays the single source even when the editor preview hands its whole node-view
  // registry in as `objectRenderers` (the built-ins there are intentionally shadowed).
  if (!READER_BUILTIN_OBJECT_TYPES.has(node.type)) {
    const custom = options.objectRenderers?.[node.type];
    if (custom) return custom(node);
    return objectFallback(
      baked
        ? `${node.type} (baked: ${baked.kind})`
        : `${node.type}: not baked yet`,
    );
  }
  // The dispatch renders the baked snapshot; the caller bakes (editor) or persists baked.
  if (!baked) {
    return objectFallback(
      node.status === "invalid"
        ? `⚠ ${node.type}: cannot bake (check its data)`
        : `${node.type}: not baked yet`,
    );
  }
  const payload = asRecord(baked.payload);
  switch (node.type) {
    case "divider":
      return <hr className="rt-hr" data-rt-block-type="divider" />;
    case "media": {
      const override = options.resolveMedia?.(node);
      const src = override?.src ?? str(payload.src);
      if (!src) return objectFallback("🖼 media");
      return (
        <RichTextMediaFigure
          alt={override?.alt ?? str(payload.alt)}
          caption={override?.caption ?? str(payload.caption)}
          src={src}
        />
      );
    }
    case "embed": {
      const url = str(payload.url);
      const title = str(payload.title);
      const embedUrl = toEmbeddableUrl(url);
      const blocked =
        node.status === "invalid" || !embedAllowed(embedUrl, options);
      if (!embedUrl || blocked) {
        return embedUrl && !blocked ? null : (
          <div
            className="text-sm text-base-content/60"
            data-rt-embed-blocked=""
          >
            {blocked && url ? "Embed not allowed" : title || url || "Embed"}
          </div>
        );
      }
      return <RichTextEmbed title={title} url={embedUrl} />;
    }
    case "post-ref": {
      const override = options.resolvePost?.(node);
      const title = override?.label ?? str(payload.title);
      const postId = str(payload.postId);
      const url = override?.href ?? str(payload.url);
      return (
        <RichTextPostReference
          href={url || undefined}
          label={title || postId || "Linked post"}
          postId={postId || undefined}
        />
      );
    }
    case "code":
    case "code-block":
      return (
        <RichTextCodeBlock
          bakedHtml={str(payload.html) || undefined}
          language={str(payload.language) || undefined}
          value={str(payload.code)}
        />
      );
    case "table-of-contents": {
      // An `aside` TOC's in-flow copy is hidden at lg+ (the sticky rail `<Reader>` renders
      // takes over there); an `inline` TOC renders in the flow at every width. With
      // `forceInlineToc` (the rail-less editor preview, docs/028 §4.4) it always renders
      // inline so it is never hidden waiting for a rail that does not exist.
      const placement = normalizeTocSettings(
        payload as RichTextTocSettingsInput,
      ).placement;
      return renderTableOfContents(
        payload,
        snapshot,
        placement === "aside" && !options.forceInlineToc ? "aside" : "inline",
      );
    }
    default:
      return objectFallback(`${node.type} (baked: ${baked.kind})`);
  }
}

// --- table of contents -------------------------------------------------------

type Heading = {
  readonly id: string;
  readonly anchor: string;
  readonly level: number;
  readonly text: string;
};

/** Walk the snapshot (recursing into structural children) collecting heading leaves. */
export function collectHeadings(snapshot: ReaderSnapshot): readonly Heading[] {
  const out: Heading[] = [];
  const visit = (id: string) => {
    const node = snapshot.body.blocks[id];
    if (!node) return;
    if (node.kind === "text" && node.type === "heading") {
      out.push({
        anchor: readerHeadingAnchor(node.id, node.attrs),
        id: node.id,
        level: readerHeadingLevel(node.attrs),
        text: node.content.text.trim(),
      });
      return;
    }
    if (node.kind === "structural") node.children.forEach(visit);
  };
  snapshot.body.order.forEach(visit);
  return out;
}

/**
 * Project the collected headings into a nested, optionally-numbered TOC, filtered to the
 * configured level window (mirror of the editor's `projectTocEntries`). Depth comes from a
 * running level stack; the decimal number from per-depth counters that reset on pop.
 */
function projectToc(
  headings: readonly Heading[],
  settings: ReturnType<typeof normalizeTocSettings>,
): RichTextTableOfContentsEntry[] {
  const stack: number[] = [];
  const counters: number[] = [];
  const entries: RichTextTableOfContentsEntry[] = [];
  for (const heading of headings) {
    if (
      heading.level < settings.minLevel ||
      heading.level > settings.maxLevel
    ) {
      continue;
    }
    while (
      stack.length > 0 &&
      (stack[stack.length - 1] ?? 0) >= heading.level
    ) {
      stack.pop();
    }
    const depth = stack.length;
    stack.push(heading.level);
    counters.length = depth + 1;
    counters[depth] = (counters[depth] ?? 0) + 1;
    entries.push({
      depth,
      href: `#${heading.anchor}`,
      id: heading.id,
      level: heading.level,
      number:
        settings.numbering === "decimal"
          ? counters.slice(0, depth + 1).join(".")
          : undefined,
      text: heading.text || "Untitled section",
    });
  }
  return entries;
}

/**
 * Render a TOC from the snapshot index (docs/028 §4.6) — a full static list, no
 * `useDocumentIndex` hook, so it is RSC-safe with no loss. `variant: "aside"` renders the
 * inline copy `<Reader>` keeps for narrow viewports (the rail is rendered by `<Reader>`).
 */
export function renderTableOfContents(
  settingsPayload: Readonly<Record<string, unknown>>,
  snapshot: ReaderSnapshot,
  variant: "inline" | "aside",
): ReactNode {
  const settings = normalizeTocSettings(
    settingsPayload as RichTextTocSettingsInput,
  );
  const entries = projectToc(collectHeadings(snapshot), settings);
  const toc = (
    <RichTextTableOfContents
      entries={entries}
      style={settings.style as RichTextTableOfContentsStyle}
      title={settings.title}
    />
  );
  return variant === "aside" ? <div className="lg:hidden">{toc}</div> : toc;
}

// --- structural containers ---------------------------------------------------

/** The flat-list flavour of a node, or null when it is not a list-item leaf. */
function listFlavour(node: ReaderBlockNode): "bullet" | "number" | null {
  if (node.kind !== "text" || node.type !== "listitem") return null;
  return node.attrs?.listType === "number" ? "number" : "bullet";
}

/**
 * Group a sibling sequence into render units, coalescing consecutive same-flavour
 * `listitem` leaves into one synthetic list run (docs/018 §2.10) so a flat list renders as
 * one real `<ul>`/`<ol>`. Shared by the body (for content-visibility wrapping in
 * `<Reader>`) and by every structural container, so nesting groups identically.
 */
export type ReaderRenderUnit =
  | {
      readonly kind: "list";
      readonly flavour: "bullet" | "number";
      readonly items: readonly ReaderBlockNode[];
    }
  | { readonly kind: "single"; readonly node: ReaderBlockNode };

export function groupListRuns(
  nodes: readonly ReaderBlockNode[],
): readonly ReaderRenderUnit[] {
  const units: ReaderRenderUnit[] = [];
  let run: ReaderBlockNode[] = [];
  let runFlavour: "bullet" | "number" | null = null;
  const flush = () => {
    if (run.length === 0 || !runFlavour) return;
    units.push({ flavour: runFlavour, items: run, kind: "list" });
    run = [];
    runFlavour = null;
  };
  for (const node of nodes) {
    const flavour = listFlavour(node);
    if (flavour) {
      if (run.length > 0 && flavour !== runFlavour) flush();
      runFlavour = flavour;
      run.push(node);
      continue;
    }
    flush();
    units.push({ kind: "single", node });
  }
  flush();
  return units;
}

/** Project the snapshot's headings into TOC entries for a settings payload (for `<Reader>`). */
export function tocEntries(
  snapshot: ReaderSnapshot,
  settingsPayload: Readonly<Record<string, unknown>>,
): RichTextTableOfContentsEntry[] {
  return projectToc(
    collectHeadings(snapshot),
    normalizeTocSettings(settingsPayload as RichTextTocSettingsInput),
  );
}

/** Render one render unit (a synthetic list run, or a single block). */
export function renderUnit(
  unit: ReaderRenderUnit,
  snapshot: ReaderSnapshot,
  options: ReaderOptions,
  key: string,
): ReactNode {
  if (unit.kind === "list") {
    return (
      <RichTextList key={key} kind={unit.flavour}>
        {unit.items.map((item) => (
          <Fragment key={item.id}>
            {renderTextLeaf(item as ReaderTextNode, snapshot)}
          </Fragment>
        ))}
      </RichTextList>
    );
  }
  return (
    <Fragment key={key}>{renderBlock(unit.node, snapshot, options)}</Fragment>
  );
}

/** Render a sibling sequence, grouping flat list runs into real lists. */
function renderSequence(
  children: readonly ReaderBlockNode[],
  snapshot: ReaderSnapshot,
  options: ReaderOptions,
): ReactNode {
  return groupListRuns(children).map((unit, index) =>
    renderUnit(unit, snapshot, options, `seq.${index}`),
  );
}

/** Resolve a structural node's children to real block nodes (dropping any dangling ids). */
function childrenOf(
  node: ReaderStructuralNode,
  snapshot: ReaderSnapshot,
): readonly ReaderBlockNode[] {
  return node.children
    .map((id) => snapshot.body.blocks[id])
    .filter((child): child is ReaderBlockNode => Boolean(child));
}

/** Render one structural list item as an `<li>` plus any nested lists it holds. */
function renderListItem(
  node: ReaderBlockNode,
  snapshot: ReaderSnapshot,
  options: ReaderOptions,
  key: string,
): ReactNode {
  if (node.kind === "text" && node.type === "listitem") {
    return (
      <RichTextListItem indent={blockIndent(node.attrs)} key={key}>
        {renderLeafMarks(node, snapshot)}
      </RichTextListItem>
    );
  }
  if (node.kind === "structural" && node.type === "listitem") {
    const kids = childrenOf(node, snapshot);
    return (
      <RichTextListItem key={key}>
        {kids.map((child) =>
          child.kind === "text" && child.type === "listitem" ? (
            <Fragment key={child.id}>
              {renderLeafMarks(child, snapshot)}
            </Fragment>
          ) : (
            renderBlock(child, snapshot, options)
          ),
        )}
      </RichTextListItem>
    );
  }
  return renderBlock(node, snapshot, options);
}

const CALLOUT_TONES = new Set(["info", "success", "warning", "error"]);

function calloutTone(value: unknown): RichTextCalloutTone {
  return typeof value === "string" && CALLOUT_TONES.has(value)
    ? (value as RichTextCalloutTone)
    : "info";
}

function numAttr(value: unknown): number | undefined {
  return typeof value === "number" && value > 1 ? value : undefined;
}

function renderStructural(
  node: ReaderStructuralNode,
  snapshot: ReaderSnapshot,
  options: ReaderOptions,
): ReactNode {
  const children = childrenOf(node, snapshot);
  switch (node.type) {
    case "callout":
      return (
        <RichTextCallout tone={calloutTone(node.attrs?.tone)}>
          {renderSequence(children, snapshot, options)}
        </RichTextCallout>
      );
    case "list":
      return (
        <RichTextList
          kind={node.attrs?.listType === "number" ? "number" : "bullet"}
        >
          {children.map((child) =>
            renderListItem(child, snapshot, options, child.id),
          )}
        </RichTextList>
      );
    case "quote":
      return (
        <RichTextBlockquote>
          {renderSequence(children, snapshot, options)}
        </RichTextBlockquote>
      );
    case "table": {
      const colWidths = Array.isArray(node.attrs?.colWidths)
        ? (node.attrs.colWidths.filter(
            (n): n is number => typeof n === "number",
          ) as number[])
        : undefined;
      return (
        <RichTextTable
          colWidths={colWidths}
          layout={
            typeof node.attrs?.layout === "string"
              ? node.attrs.layout
              : undefined
          }
          numbered={node.attrs?.showRowNumbers === true}
        >
          {children.map((row) => (
            <Fragment key={row.id}>
              {renderBlock(row, snapshot, options)}
            </Fragment>
          ))}
        </RichTextTable>
      );
    }
    case "tablerow":
      return (
        <RichTextTableRow>
          {children.map((cell) => (
            <Fragment key={cell.id}>
              {renderBlock(cell, snapshot, options)}
            </Fragment>
          ))}
        </RichTextTableRow>
      );
    case "tablecell": {
      const headerState = node.attrs?.headerState;
      return (
        <RichTextTableCell
          backgroundColor={
            typeof node.attrs?.backgroundColor === "string"
              ? node.attrs.backgroundColor
              : undefined
          }
          colSpan={numAttr(node.attrs?.colSpan)}
          header={typeof headerState === "number" && headerState > 0}
          rowSpan={numAttr(node.attrs?.rowSpan)}
          verticalAlign={
            typeof node.attrs?.verticalAlign === "string"
              ? node.attrs.verticalAlign
              : undefined
          }
        >
          {renderSequence(children, snapshot, options)}
        </RichTextTableCell>
      );
    }
    default: {
      const custom = options.structuralRenderers?.[node.type];
      const inner = renderSequence(children, snapshot, options);
      // A registered host structural renderer, else the default stacking container so no
      // child is ever hidden (docs/018 §2.11).
      return custom ? custom(node, inner) : <>{inner}</>;
    }
  }
}

// --- block dispatch + island seam --------------------------------------------

/** The island kind + data for a node, or null when the node has no island (docs/015 §6). */
function islandFor(
  node: ReaderBlockNode,
  snapshot: ReaderSnapshot,
): { readonly kind: string; readonly data: unknown } | null {
  if (node.kind !== "object") return null;
  if (node.type === "code" || node.type === "code-block") {
    const payload = asRecord(node.baked?.payload);
    return {
      data: { language: str(payload.language), value: str(payload.code) },
      kind: "code-block",
    };
  }
  if (node.type === "table-of-contents") {
    // The scroll-spy island observes the heading elements by the same anchor ids the
    // headings render (`readerHeadingAnchor` → the `<h*> id`), so it enhances over real
    // targets — the static list still works with no JS (docs/015 §6).
    const settings = normalizeTocSettings(
      asRecord(node.baked?.payload) as RichTextTocSettingsInput,
    );
    const anchorIds = collectHeadings(snapshot)
      .filter(
        (h) => h.level >= settings.minLevel && h.level <= settings.maxLevel,
      )
      .map((h) => h.anchor);
    return { data: { anchorIds }, kind: "table-of-contents" };
  }
  return null;
}

/**
 * Wrap an island-eligible node's static output in the island seam (docs/015 §6). When no
 * `renderIsland` is supplied (the static reader) the static output passes through and no
 * client code is referenced.
 */
function withIsland(
  node: ReaderBlockNode,
  output: ReactNode,
  snapshot: ReaderSnapshot,
  options: ReaderOptions,
): ReactNode {
  if (!options.renderIsland) return output;
  const island = islandFor(node, snapshot);
  if (!island) return output;
  return options.renderIsland({
    children: output,
    data: island.data,
    kind: island.kind,
  });
}

/** Dispatch one block by kind/type to its L1 render. */
export function renderBlock(
  node: ReaderBlockNode,
  snapshot: ReaderSnapshot,
  options: ReaderOptions,
): ReactNode {
  if (node.kind === "text") return renderTextLeaf(node, snapshot);
  if (node.kind === "object") {
    return withIsland(
      node,
      renderObject(node, snapshot, options),
      snapshot,
      options,
    );
  }
  return renderStructural(node, snapshot, options);
}

/**
 * Render a whole document snapshot as resting L1 (docs/028 §4.1). The body is grouped into
 * render units (flat list runs → real lists) then rendered in order. This is the function
 * the editor's `RestingDocument` delegates to and the server `<Reader>` calls per top-level
 * unit (for content-visibility), so the editor preview and the published page are the same
 * render.
 */
export function renderRestingDocument(
  snapshot: ReaderSnapshot,
  options: ReaderOptions = {},
): ReactNode {
  return renderSequence(bodyNodes(snapshot), snapshot, options);
}

/** The top-level body blocks of a snapshot, in order (dropping any dangling ids). */
export function bodyNodes(
  snapshot: ReaderSnapshot,
): readonly ReaderBlockNode[] {
  return snapshot.body.order
    .map((id) => snapshot.body.blocks[id])
    .filter((node): node is ReaderBlockNode => Boolean(node));
}
