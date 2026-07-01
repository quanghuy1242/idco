/**
 * `DiffView` — the dedicated diff surface (docs/036 §6.1/§6.3, R6-F): it renders one
 * `ReaderSnapshotDiff` (the engine's `diffSnapshots` result) on the reader L1 as a reviewable
 * diff — unified or side-by-side.
 *
 * The decoration follows the docs/036 §6.3 design system, whose whole point is that a human can
 * REVIEW the diff (the first cut rendered valid-but-illegible markup — scattered notes, chips in
 * prose, dimmed-not-struck deletions, misaligned columns). Five rules:
 *   1. Change vs context are distinct: a change is a bordered **change card** (color bar + a
 *      one-line status header + the content); unchanged content is bare and foldable.
 *   2. One label system: every change names itself with the same **status tag** in the card
 *      header — never a floating note here and an inline badge there.
 *   3. Track-changes for text, block-treatment for structure: `insert` = colored underline,
 *      `delete` = strikethrough (never a filled chip); whole-block add/remove/move = the card.
 *   4. Moves are two-ended: the destination names the origin (`Moved from ¶5`), and side-by-side
 *      shows the block at its base row (left) and target row (right) with a gap opposite each.
 *   5. Context, not the whole document: `context="focused"` folds long unchanged runs.
 *
 * Reuse (docs/036 D7): every block is drawn by the reader's own `renderBlock`; a changed
 * container/leaf is decorated by `cloneElement`-ing that shell and swapping only its children, so
 * shells (callout tone, list kind, colWidths, `<p>` align/indent) are never re-derived and an
 * `unchanged` block stays byte-identical to `<Reader>` (the §11 parity guarantee). Top-level
 * changes become cards; changes NESTED in a changed container decorate inline (no nested cards).
 *
 * Pure and RSC-safe: no hooks, no state, no client imports — `mode`/`context` are props (a host
 * owns any toggle/expand UI). It injects the typography + diff stylesheets itself.
 *
 * @categoryDefault Diff View
 */
import {
  cloneElement,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  RichTextArticle,
  RichTextCheckList,
  RichTextCheckListItem,
  RichTextList,
  RichTextListItem,
  RICH_TEXT_DIFF_CSS,
  RICH_TEXT_TYPOGRAPHY_CSS,
} from "../l1";
import {
  type ReaderBlockNode,
  type ReaderOptions,
  type ReaderResolvedMark,
  type ReaderSnapshot,
  type ReaderTextNode,
  renderBlock,
  renderMarkedSpans,
  resolveLeafMarks,
} from "../reader";
import type {
  DiffViewMode,
  ReaderBlockDiff,
  ReaderSnapshotDiff,
  ReaderTextLeafDiff,
} from "./types";

/** The props of the diff surface: one computed diff, a layout mode, plus reader render options. */
export type DiffViewProps = ReaderOptions & {
  /** The structured diff to render — the output of the engine's `diffSnapshots(base, target)`. */
  readonly diff: ReaderSnapshotDiff;
  /** `"unified"` (one column, the default) or `"side-by-side"` (base | target), §6.1. */
  readonly mode?: DiffViewMode;
  /** Show the `stats` header summary ("+12 −3, 2 moved"); defaults to `true`. */
  readonly showStats?: boolean;
  /**
   * Inject the `.rt-*` typography + diff stylesheets (default `true`). A host that renders many
   * diff surfaces at once — e.g. the editor's inline overlay banding one region per `DiffView`
   * (docs/036 §6.2.1) — sets this `false` on each band and injects the shared stylesheet once.
   */
  readonly embedStyles?: boolean;
  /**
   * `"all"` (default) renders every block; `"focused"` folds runs of unchanged blocks farther
   * than `contextRadius` from any change into a `⋯ N unchanged ⋯` separator (unified only, §6.3).
   */
  readonly context?: "all" | "focused";
  /** Unchanged blocks to keep as context around each change in `context="focused"` (default 2). */
  readonly contextRadius?: number;
};

/** Which column a block is rendered for: unified reads target (base for a removed block). */
type DiffColumn = "unified" | "base" | "target";

/** The render context threaded through the recursion. */
type DiffContext = {
  readonly diff: ReaderSnapshotDiff;
  readonly options: ReaderOptions;
  readonly mode: DiffViewMode;
  readonly context: "all" | "focused";
  readonly radius: number;
};

// --- the status tag (the one label component, §6.3 rule 2) -------------------

const STATUS_ICON: Readonly<Record<string, string>> = {
  added: "＋",
  removed: "－",
  changed: "✎",
  moved: "⇅",
};

/** The single status-tag component every change names itself with, in the card header. */
function StatusTag({
  status,
  label,
  detail,
}: {
  readonly status: "added" | "removed" | "changed" | "moved";
  readonly label: string;
  readonly detail?: ReactNode;
}): ReactNode {
  return (
    <div className={`rt-diff-tag rt-diff-tag-${status}`}>
      <span aria-hidden="true" className="rt-diff-tag-icon">
        {STATUS_ICON[status]}
      </span>
      <span className="rt-diff-tag-label">{label}</span>
      {detail ? <span className="rt-diff-tag-detail">{detail}</span> : null}
    </div>
  );
}

/** Wrap a change's content in the bordered change card with its status tag (a flow-level change). */
function card(
  status: "added" | "removed" | "changed" | "moved",
  tag: ReactNode,
  body: ReactNode,
  key: string,
  bodyClass?: string,
): ReactNode {
  return (
    <div
      className={`rt-diff-card rt-diff-card-${status}`}
      data-rt-diff={status}
      key={key}
    >
      {tag}
      <div
        className={
          bodyClass ? `rt-diff-card-body ${bodyClass}` : "rt-diff-card-body"
        }
      >
        {body}
      </div>
    </div>
  );
}

// --- node helpers ------------------------------------------------------------

function asText(node: ReaderBlockNode | undefined): ReaderTextNode | undefined {
  return node && node.kind === "text" ? node : undefined;
}

/**
 * A "flow" block can be wrapped directly in a change card; a non-flow one (`<li>`/`<tr>`/`<td>`)
 * cannot (a `<div>` parent there is invalid HTML). List items still earn a card — via the list-run
 * path, which nests the `<li>` in a one-item `<ol>`/`<ul>` inside the card body — so this gate only
 * governs the *direct-wrap* `renderDiffBlock` path (cells/rows, and the rare top-level `list` node).
 */
function isFlowBlock(node: ReaderBlockNode): boolean {
  if (node.kind === "text") return node.type !== "listitem";
  if (node.kind === "structural") {
    return (
      node.type !== "listitem" &&
      node.type !== "tablerow" &&
      node.type !== "tablecell"
    );
  }
  return true;
}

/** The flat-list flavour of a `listitem` leaf, from its own or its inner leaf's attrs. */
function leafFlavour(node: ReaderTextNode): "bullet" | "number" | "checklist" {
  if (typeof node.attrs?.checked === "boolean") return "checklist";
  return node.attrs?.listType === "number" ? "number" : "bullet";
}

/** The flat-list flavour of a top-level `listitem` block (text or SN-1 structural), or null. */
function flatListFlavour(
  ctx: DiffContext,
  block: ReaderBlockDiff,
): "bullet" | "number" | "checklist" | null {
  const snapshot = ctx.diff.target.body.blocks[block.id]
    ? ctx.diff.target
    : ctx.diff.base;
  const node = snapshot.body.blocks[block.id];
  if (!node) return null;
  if (node.kind === "text" && node.type === "listitem")
    return leafFlavour(node);
  if (node.kind === "structural" && node.type === "listitem") {
    const inner = node.children
      .map((id) => snapshot.body.blocks[id])
      .find((child) => child?.kind === "text" && child.type === "listitem");
    return inner && inner.kind === "text" ? leafFlavour(inner) : "bullet";
  }
  return null;
}

/** The node + snapshot to render for a block in a given column (base for a removed block). */
function pick(
  ctx: DiffContext,
  block: ReaderBlockDiff,
  column: DiffColumn,
): { node: ReaderBlockNode | undefined; snapshot: ReaderSnapshot } {
  const useBase =
    column === "base" || (column === "unified" && block.status === "removed");
  const snapshot = useBase ? ctx.diff.base : ctx.diff.target;
  return { node: snapshot.body.blocks[block.id], snapshot };
}

// --- Tier 1: the track-changes run pass (§5.2, §6.3 rule 3) ------------------

function clampMarks(
  marks: readonly ReaderResolvedMark[],
  from: number,
  to: number,
): ReaderResolvedMark[] {
  const out: ReaderResolvedMark[] = [];
  for (const mark of marks) {
    if (mark.from >= to || mark.to <= from) continue;
    out.push({
      ...mark,
      from: Math.max(0, mark.from - from),
      to: Math.min(to - from, mark.to - from),
    });
  }
  return out;
}

function changedMarkRanges(
  text: ReaderTextLeafDiff,
): readonly (readonly [number, number])[] {
  return text.markChanges
    .filter((mc) => mc.op !== "removed")
    .map((mc) => [mc.from, mc.to] as const);
}

function overlapsAny(
  ranges: readonly (readonly [number, number])[],
  from: number,
  to: number,
): boolean {
  return ranges.some(([a, b]) => a < to && b > from);
}

/** The whole marked text of a leaf (for a removed/added item, or the fallback whole-unit pass). */
function leafContent(
  node: ReaderTextNode,
  snapshot: ReaderSnapshot,
): ReactNode {
  return renderMarkedSpans(node.content.text, resolveLeafMarks(node), snapshot);
}

/**
 * The §5.2 text-alignment fallback (disjoint character ids): rather than interleave the
 * character-level LCS into unreadable noise, render the OLD text struck and the NEW text
 * inserted as WHOLE units (§6.3). Side-aware: base shows only old, target only new.
 */
function fallbackRuns(
  ctx: DiffContext,
  block: ReaderBlockDiff,
  side: DiffColumn,
): ReactNode[] {
  const baseLeaf = asText(ctx.diff.base.body.blocks[block.id]);
  const targetLeaf = asText(ctx.diff.target.body.blocks[block.id]);
  const spans: ReactNode[] = [];
  if (side !== "target" && baseLeaf && baseLeaf.content.text.length > 0) {
    spans.push(
      <span className="rt-diff-del" key="old">
        {leafContent(baseLeaf, ctx.diff.base)}
      </span>,
    );
  }
  if (side !== "base" && targetLeaf && targetLeaf.content.text.length > 0) {
    if (spans.length > 0) spans.push(<span key="sep"> </span>);
    spans.push(
      <span className="rt-diff-ins" key="new">
        {leafContent(targetLeaf, ctx.diff.target)}
      </span>,
    );
  }
  return spans;
}

/**
 * Render a changed leaf's runs as track-changes spans (§6.3). `insert` is a colored underline,
 * `delete` a strikethrough — never a filled chip. Side-aware: the base cell shows `keep`+`delete`
 * (old text), the target cell `keep`+`insert` (new), unified shows the union on one line. Each
 * run's own marks nest through the reader's `renderMarkedSpans`; a `keep` run under a changed
 * mark gets the dotted overlay.
 */
function renderRunSpans(
  ctx: DiffContext,
  block: ReaderBlockDiff,
  text: ReaderTextLeafDiff,
  side: DiffColumn,
): ReactNode[] {
  if (text.alignment === "text") return fallbackRuns(ctx, block, side);
  const baseLeaf = asText(ctx.diff.base.body.blocks[block.id]);
  const targetLeaf = asText(ctx.diff.target.body.blocks[block.id]);
  const baseMarks = baseLeaf ? resolveLeafMarks(baseLeaf) : [];
  const targetMarks = targetLeaf ? resolveLeafMarks(targetLeaf) : [];
  const changed = changedMarkRanges(text);
  const spans: ReactNode[] = [];
  let tOff = 0;
  let bOff = 0;
  text.runs.forEach((run, index) => {
    const len = run.text.length;
    const key = `run.${index}`;
    if (run.op === "delete") {
      if (side !== "target") {
        spans.push(
          <span className="rt-diff-del" key={key}>
            {renderMarkedSpans(
              run.text,
              clampMarks(baseMarks, bOff, bOff + len),
              ctx.diff.base,
            )}
          </span>,
        );
      }
      bOff += len;
      return;
    }
    if (run.op === "insert") {
      if (side !== "base") {
        spans.push(
          <span className="rt-diff-ins" key={key}>
            {renderMarkedSpans(
              run.text,
              clampMarks(targetMarks, tOff, tOff + len),
              ctx.diff.target,
            )}
          </span>,
        );
      }
      tOff += len;
      return;
    }
    // keep — shown on both sides, in that side's coordinate space.
    if (side === "base") {
      spans.push(
        <span key={key}>
          {renderMarkedSpans(
            run.text,
            clampMarks(baseMarks, bOff, bOff + len),
            ctx.diff.base,
          )}
        </span>,
      );
    } else {
      const cls = overlapsAny(changed, tOff, tOff + len)
        ? "rt-diff-mark"
        : undefined;
      spans.push(
        <span className={cls} key={key}>
          {renderMarkedSpans(
            run.text,
            clampMarks(targetMarks, tOff, tOff + len),
            ctx.diff.target,
          )}
        </span>,
      );
    }
    tOff += len;
    bOff += len;
  });
  return spans;
}

/** Format an attr/field value for a change summary: string as-is, else JSON, truncated; `—` for absent. */
function fmtVal(value: unknown): string {
  if (value === undefined) return "—";
  const raw = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return raw.length > 48 ? `${raw.slice(0, 48)}…` : raw;
}

/** A friendly label for a mark kind in the mark-change summary (§6.4). */
const MARK_LABEL: Readonly<Record<string, string>> = {
  bold: "Bold",
  code: "Code",
  comment: "Comment",
  glossary: "Glossary",
  highlight: "Highlight",
  italic: "Italic",
  link: "Link",
  strikethrough: "Strikethrough",
  subscript: "Subscript",
  superscript: "Superscript",
  underline: "Underline",
};

function markLabel(kind: string): string {
  return MARK_LABEL[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** The affected text of a mark change: base-side for a removed mark, target-side otherwise (§6.4). */
function markSnippet(
  ctx: DiffContext,
  block: ReaderBlockDiff,
  change: ReaderTextLeafDiff["markChanges"][number],
): string {
  const leaf =
    change.op === "removed"
      ? asText(ctx.diff.base.body.blocks[block.id])
      : asText(ctx.diff.target.body.blocks[block.id]);
  if (!leaf) return "";
  const s = leaf.content.text.slice(change.from, change.to);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

const markTagClass = (op: "added" | "removed" | "changed"): string =>
  op === "removed"
    ? "rt-diff-tag-removed"
    : op === "added"
      ? "rt-diff-tag-added"
      : "rt-diff-tag-changed";

/**
 * The change-detail summary of a changed block (docs/036 §6.4): its `attrs` diff (align, indent,
 * heading level, a table cell's fill), its `markChanges` including removals (unstyled bold, a
 * dropped link — invisible in the runs), and its object `fields` (from the `diffData` seam). Each
 * is a row so a change that touches no text run is still visible. Rendered as an inline
 * `display:block` `<span>` so it is valid inside a `<p>`, `<li>`, or `<td>` — a `<ul>` there is not.
 */
function renderChangeDetail(
  ctx: DiffContext,
  block: ReaderBlockDiff,
): ReactNode {
  const rows: ReactNode[] = [];
  const attrs = block.attrs;
  if (attrs) {
    for (const [key, value] of Object.entries(attrs.added)) {
      rows.push(
        <span className="rt-diff-detail-row" key={`aa.${key}`}>
          <span className="rt-diff-field-key">{key}</span> —{" → "}
          <span className="rt-diff-ins">{fmtVal(value)}</span>
        </span>,
      );
    }
    for (const [key, pair] of Object.entries(attrs.changed)) {
      rows.push(
        <span className="rt-diff-detail-row" key={`ac.${key}`}>
          <span className="rt-diff-field-key">{key}</span>{" "}
          <span className="rt-diff-del">{fmtVal(pair.base)}</span>
          {" → "}
          <span className="rt-diff-ins">{fmtVal(pair.target)}</span>
        </span>,
      );
    }
    for (const [key, value] of Object.entries(attrs.removed)) {
      rows.push(
        <span className="rt-diff-detail-row" key={`ar.${key}`}>
          <span className="rt-diff-field-key">{key}</span>{" "}
          <span className="rt-diff-del">{fmtVal(value)}</span>
          {" → —"}
        </span>,
      );
    }
  }
  const markChanges = block.text?.markChanges ?? [];
  markChanges.forEach((change, index) => {
    const snippet = markSnippet(ctx, block, change);
    const href =
      change.op !== "removed" &&
      change.attrs &&
      typeof change.attrs.href === "string"
        ? change.attrs.href
        : undefined;
    rows.push(
      <span className="rt-diff-detail-row" key={`m.${index}`}>
        <span className={`rt-diff-marktag ${markTagClass(change.op)}`}>
          {markLabel(change.kind)} {change.op}
        </span>
        {snippet ? (
          <>
            {" on “"}
            <span className="rt-diff-mark-snip">{snippet}</span>
            {"”"}
          </>
        ) : null}
        {href ? <> · {href}</> : null}
      </span>,
    );
  });
  for (const field of block.object?.fields ?? []) {
    rows.push(
      <span className="rt-diff-detail-row" key={`f.${field.path}`}>
        <span className="rt-diff-field-key">{field.path}</span>{" "}
        <span className="rt-diff-del">{fmtVal(field.base)}</span>
        {" → "}
        <span className="rt-diff-ins">{fmtVal(field.target)}</span>
      </span>,
    );
  }
  if (rows.length === 0) return null;
  return <span className="rt-diff-detail">{rows}</span>;
}

// --- decorated content (shared by cards + inline) ----------------------------

const sideOf = (column: DiffColumn): DiffColumn => column;

/**
 * The decorated content of a changed block — the reader shell with its children replaced by the
 * diff-aware renders. A changed text leaf gets the track-changes runs; a changed container gets
 * its children re-rendered NESTED (only changed descendants decorate, inline); a changed object
 * gets its render plus the field summary. Reuses `renderBlock`'s shell via `cloneElement`.
 */
function changedInner(
  ctx: DiffContext,
  block: ReaderBlockDiff,
  node: ReaderBlockNode,
  snapshot: ReaderSnapshot,
  column: DiffColumn,
): ReactNode {
  const shell = renderBlock(node, snapshot, ctx.options);
  // The §6.4 change-detail (attrs / removed marks / object fields) is appended INSIDE the shell as
  // an inline `display:block` span, so a change carrying no text-run edit — a removed link, a
  // re-colored cell, a code-block edit — is still visible where a run-only pass would show nothing.
  const detail = renderChangeDetail(ctx, block);
  if (node.kind === "text" && block.text) {
    const runs = renderRunSpans(ctx, block, block.text, sideOf(column));
    if (!isValidElement(shell)) return shell;
    // A heading's shell is a `<RichTextHeading>` element, so `cloneElement` keeps its `anchorId` prop
    // and the hover-anchor `<a>` survives the swap — but the block-level change detail inside the
    // heading's inline `<span>` then breaks the line and drops that `<a>` onto its own row (a visible
    // artifact), and a navigation anchor is meaningless in a diff. Clear `anchorId` for a decorated
    // heading (an unchanged heading still renders it, so the §11 byte-parity guarantee holds).
    const shellProps = node.type === "heading" ? { anchorId: undefined } : {};
    return cloneElement(
      shell as ReactElement<{ anchorId?: string }>,
      shellProps,
      ...runs,
      detail,
    );
  }
  if (node.kind === "structural" && block.children) {
    const kids = block.children.map((child, index) =>
      renderDiffBlock(ctx, child, column, `${block.id}.child.${index}`, true),
    );
    return isValidElement(shell)
      ? cloneElement(shell, {}, ...kids, detail)
      : shell;
  }
  if (node.kind === "object") {
    return (
      <>
        {shell}
        {detail}
      </>
    );
  }
  return shell;
}

/** The "Moved from/to ¶N" detail + direction arrow for a moved block in a given column. */
function moveDetail(block: ReaderBlockDiff, column: DiffColumn): ReactNode {
  const base = (block.baseIndex ?? 0) + 1;
  const target = (block.targetIndex ?? 0) + 1;
  // The arrow reflects the direction of travel: a block whose target position is earlier than
  // its base position moved UP (↑), later moved DOWN (↓) — the same on either side (the base
  // column names where the block goes, the destination names where the block came from).
  const arrow = target < base ? "↑" : "↓";
  return column === "base"
    ? `to ¶${target} ${arrow}`
    : `from ¶${base} ${arrow}`;
}

/**
 * Give a non-flow changed item (`<li>`/`<td>`, which cannot wear a card) a visible status cue: a
 * status-colored left bar via a merged class (docs/036 §6.3 "a tag/marker placed inside the item").
 * Without this, an attr/mark-only change on a list item (bullet→number) or a table cell (a re-color)
 * shows only the faint detail row and is easy to miss.
 */
function withItemStatus(element: ReactNode, status: string): ReactNode {
  if (!isValidElement(element)) return element;
  const props = element.props as { readonly className?: string };
  const cls = `rt-diff-item rt-diff-item-${status}`;
  return cloneElement(element as ReactElement<{ className?: string }>, {
    className: props.className ? `${props.className} ${cls}` : cls,
  });
}

/** Prepend an inline marker into a rendered element's own children (for a non-flow item). */
function withLeadingMarker(
  shell: ReactNode,
  marker: ReactNode,
  tag: string,
): ReactNode {
  if (tag === "tablerow" || !isValidElement(shell)) return shell;
  const props = shell.props as { readonly children?: ReactNode };
  return cloneElement(shell, {}, marker, props.children);
}

// --- the structural list item (mirror of the reader's private renderListItem) --

function renderStructuralListItem(
  ctx: DiffContext,
  block: ReaderBlockDiff,
  column: DiffColumn,
  key: string,
): ReactNode {
  const { node, snapshot } = pick(ctx, block, column);
  if (!node || node.kind !== "structural") return <Fragment key={key} />;
  const diffByChild = new Map(
    (block.children ?? []).map((child) => [child.id, child]),
  );
  let checked: boolean | undefined;
  const body = node.children.map((childId, index) => {
    const childNode = snapshot.body.blocks[childId];
    if (!childNode) return null;
    const childDiff = diffByChild.get(childId);
    if (childNode.kind === "text" && childNode.type === "listitem") {
      if (typeof childNode.attrs?.checked === "boolean") {
        checked = childNode.attrs.checked;
      }
      return (
        <Fragment key={`in.${index}`}>
          {childDiff
            ? renderInlineLeaf(ctx, childDiff, column)
            : leafContent(childNode, snapshot)}
        </Fragment>
      );
    }
    // A nested `list` (Option-A: the sublist holding the item you indented) renders diff-aware so a
    // change on a nested item shows — a plain `renderBlock` here would swallow it and also render
    // the wrong marker (the container `list` carries no `listType`; the flavour is on the items).
    if (childNode.kind === "structural" && childNode.type === "list") {
      return (
        <Fragment key={`c.${index}`}>
          {childDiff
            ? renderDiffSublist(ctx, childDiff, column, `${key}.sub.${index}`)
            : renderBlock(childNode, snapshot, ctx.options)}
        </Fragment>
      );
    }
    return childDiff ? (
      renderDiffBlock(ctx, childDiff, column, `${key}.c.${index}`, true)
    ) : (
      <Fragment key={`c.${index}`}>
        {renderBlock(childNode, snapshot, ctx.options)}
      </Fragment>
    );
  });
  // The structural list item's OWN change detail (its `listType`/other attrs, a mark on its inner
  // leaf) — appended inside the `<li>`, so a bullet→number change on a nested list is visible too.
  const detail =
    block.status !== "unchanged" ? renderChangeDetail(ctx, block) : null;
  const content = [
    ...(block.status === "moved"
      ? [
          <span className="rt-diff-moved-marker" key="mv">
            moved
          </span>,
        ]
      : []),
    ...body,
    ...(detail ? [<Fragment key="detail">{detail}</Fragment>] : []),
  ];
  return typeof checked === "boolean" ? (
    <RichTextCheckListItem checked={checked} key={key}>
      {content}
    </RichTextCheckListItem>
  ) : (
    <RichTextListItem key={key}>{content}</RichTextListItem>
  );
}

/** The inline (no `<li>`) decorated content of a text `listitem` leaf. */
function renderInlineLeaf(
  ctx: DiffContext,
  block: ReaderBlockDiff,
  column: DiffColumn,
): ReactNode {
  const { node, snapshot } = pick(ctx, block, column);
  const leaf = asText(node);
  if (!leaf) return null;
  // `changed` OR a `moved` leaf that also changed (`block.text` is present) both carry a run pass
  // (attach-runs-when-changed, §5.5) and a §6.4 detail. A moved leaf inside an Option-A nested
  // list (indent one item → its predecessor wraps into a structural item, docs/030 §7.3) is a
  // `moved`, and without this branch its attr change — the bullet→number the user just made —
  // rendered as plain text with no detail. So a moved+changed inner leaf shows its runs + detail
  // the same as a changed one; only the "moved" fact is dropped here (the item is not re-ordered
  // for the reader, just re-parented — the detail is the signal that matters).
  if ((block.status === "changed" || block.status === "moved") && block.text) {
    return (
      <>
        {renderRunSpans(ctx, block, block.text, sideOf(column))}
        {renderChangeDetail(ctx, block)}
      </>
    );
  }
  if (block.status === "added") {
    return <span className="rt-diff-ins">{leafContent(leaf, snapshot)}</span>;
  }
  if (block.status === "removed") {
    return <span className="rt-diff-del">{leafContent(leaf, snapshot)}</span>;
  }
  return leafContent(leaf, snapshot);
}

// --- the recursive block renderer --------------------------------------------

/**
 * Render one `BlockDiff` for a column. Top-level flow changes become change cards; a change
 * nested inside a changed container (`nested`) or a non-flow item decorates inline (no card).
 */
function renderDiffBlock(
  ctx: DiffContext,
  block: ReaderBlockDiff,
  column: DiffColumn,
  key: string,
  nested = false,
): ReactNode {
  const { node, snapshot } = pick(ctx, block, column);
  if (!node) return null;
  if (node.kind === "structural" && node.type === "listitem") {
    return renderStructuralListItem(ctx, block, column, key);
  }
  const flow = isFlowBlock(node);

  // Kind change (leaf → object, §5.5): removed-old over added-new, in unified.
  const baseNode = ctx.diff.base.body.blocks[block.id];
  const targetNode = ctx.diff.target.body.blocks[block.id];
  if (
    block.status === "changed" &&
    column === "unified" &&
    baseNode &&
    targetNode &&
    baseNode.kind !== targetNode.kind
  ) {
    return (
      <Fragment key={key}>
        {card(
          "removed",
          <StatusTag label="Removed" status="removed" />,
          renderBlock(baseNode, ctx.diff.base, ctx.options),
          `${key}.was`,
          "rt-diff-struck",
        )}
        {card(
          "added",
          <StatusTag label="Added" status="added" />,
          renderBlock(targetNode, ctx.diff.target, ctx.options),
          `${key}.now`,
        )}
      </Fragment>
    );
  }

  if (block.status === "unchanged") {
    return (
      <Fragment key={key}>{renderBlock(node, snapshot, ctx.options)}</Fragment>
    );
  }

  const isText = node.kind === "text";

  if (block.status === "changed") {
    const inner = changedInner(ctx, block, node, snapshot, column);
    if (!flow) {
      // A list item shows its edit through the inline track-changes (`changedInner` already put the
      // runs + §6.4 detail inside the `<li>`), so it needs no extra bar — the faint `.rt-diff-item`
      // inset one read as a leftover of the pre-card list treatment. A table cell keeps the bar: its
      // change (a re-color) may carry no visible run, so the cell needs the cue.
      return node.type === "listitem" ? (
        <Fragment key={key}>{inner}</Fragment>
      ) : (
        <Fragment key={key}>{withItemStatus(inner, "changed")}</Fragment>
      );
    }
    if (nested) return <Fragment key={key}>{inner}</Fragment>;
    const detail =
      isText && block.text?.alignment === "text" ? "rewritten" : undefined;
    return card(
      "changed",
      <StatusTag
        detail={detail}
        label={isText ? "Edited" : "Changed"}
        status="changed"
      />,
      inner,
      key,
    );
  }

  if (block.status === "moved") {
    const inner = block.alsoChanged
      ? changedInner(ctx, block, node, snapshot, column)
      : renderBlock(node, snapshot, ctx.options);
    if (!flow) {
      return (
        <Fragment key={key}>
          {withLeadingMarker(
            inner,
            <span className="rt-diff-moved-marker" key="mv">
              moved
            </span>,
            node.type,
          )}
        </Fragment>
      );
    }
    if (nested) return <Fragment key={key}>{inner}</Fragment>;
    return card(
      "moved",
      <StatusTag
        detail={moveDetail(block, column)}
        label="Moved"
        status="moved"
      />,
      inner,
      key,
    );
  }

  // added / removed
  const isAdded = block.status === "added";
  if (!flow) {
    if (node.kind === "structural" && block.children) {
      const shell = renderBlock(node, snapshot, ctx.options);
      const kids = block.children.map((child, index) =>
        renderDiffBlock(ctx, child, column, `${block.id}.child.${index}`, true),
      );
      return (
        <Fragment key={key}>
          {isValidElement(shell) ? cloneElement(shell, {}, ...kids) : shell}
        </Fragment>
      );
    }
    const leaf = asText(node);
    const shell = renderBlock(node, snapshot, ctx.options);
    const tinted = leaf ? (
      <span className={isAdded ? "rt-diff-ins" : "rt-diff-del"}>
        {leafContent(leaf, snapshot)}
      </span>
    ) : (
      shell
    );
    return (
      <Fragment key={key}>
        {leaf && isValidElement(shell)
          ? cloneElement(shell, {}, tinted)
          : shell}
      </Fragment>
    );
  }
  const body = renderBlock(node, snapshot, ctx.options);
  if (nested) {
    return (
      <div
        className={`rt-diff-inline rt-diff-inline-${block.status}`}
        data-rt-diff={block.status}
        key={key}
      >
        {body}
      </div>
    );
  }
  // A removed text block is struck; a removed object/container is dimmed (can't strike a table).
  const bodyClass = !isAdded
    ? isText
      ? "rt-diff-struck"
      : "rt-diff-dim"
    : undefined;
  return card(
    block.status,
    <StatusTag label={isAdded ? "Added" : "Removed"} status={block.status} />,
    body,
    key,
    bodyClass,
  );
}

// --- list items as change cards (docs/036 §6.3) ------------------------------

/**
 * Wrap list `<li>`s in a real `<ol>`/`<ul>`/checklist. Used for a shared run of unchanged items AND
 * for a single changed item's card body — a list item cannot itself wear a `<div class="card">`
 * (invalid list HTML), so a one-item list inside the card is how it earns the same panel every
 * other change gets. `ordinal` (a number list's start) keeps a card's number at its real position.
 */
function wrapList(
  flavour: "bullet" | "number" | "checklist",
  children: ReactNode,
  ordinal: number,
  key: string,
): ReactNode {
  if (flavour === "checklist") {
    return <RichTextCheckList key={key}>{children}</RichTextCheckList>;
  }
  return (
    <RichTextList
      key={key}
      kind={flavour === "number" ? "number" : "bullet"}
      // Emit `start` only past position 1 — a `start="1"` attr would diverge from the plain reader's
      // `<ol>` (no start), breaking the §11 byte-parity for an unchanged numbered run.
      start={flavour === "number" && ordinal > 1 ? ordinal : undefined}
    >
      {children}
    </RichTextList>
  );
}

/**
 * The decorated `<li>` for a list item in any status — the body cell shared by the card path and
 * the unchanged-run path. A structural `listitem` (Option-A nesting) renders through
 * {@link renderStructuralListItem} (its inner leaf + nested sublist); a text leaf gets its
 * track-changes runs (`changed` / moved-and-changed), a tint (`added`/`removed`), or its plain
 * shell. It carries NO status bar of its own — the enclosing card owns the status cue.
 */
function renderDecoratedLi(
  ctx: DiffContext,
  block: ReaderBlockDiff,
  column: DiffColumn,
  key: string,
): ReactNode {
  const { node, snapshot } = pick(ctx, block, column);
  if (!node) return <Fragment key={key} />;
  if (node.kind === "structural" && node.type === "listitem") {
    return renderStructuralListItem(ctx, block, column, key);
  }
  const shell = renderBlock(node, snapshot, ctx.options);
  const leaf = asText(node);
  if (!leaf || !isValidElement(shell)) {
    return <Fragment key={key}>{shell}</Fragment>;
  }
  if (
    block.status === "changed" ||
    (block.status === "moved" && block.alsoChanged)
  ) {
    // `changedInner` clones the `<li>` shell and swaps its children for the track-changes runs +
    // the §6.4 detail — the identical reuse the flow-block cards use for a changed leaf.
    return (
      <Fragment key={key}>
        {changedInner(ctx, block, node, snapshot, column)}
      </Fragment>
    );
  }
  if (block.status === "added") {
    return (
      <Fragment key={key}>
        {cloneElement(
          shell,
          {},
          <span className="rt-diff-ins">{leafContent(leaf, snapshot)}</span>,
          renderChangeDetail(ctx, block),
        )}
      </Fragment>
    );
  }
  if (block.status === "removed") {
    return (
      <Fragment key={key}>
        {cloneElement(
          shell,
          {},
          <span className="rt-diff-del">{leafContent(leaf, snapshot)}</span>,
        )}
      </Fragment>
    );
  }
  return <Fragment key={key}>{shell}</Fragment>;
}

/** A structural `listitem`'s inner text `listitem` leaf diff, if any (its own content change). */
function innerLeafDiff(block: ReaderBlockDiff): ReaderBlockDiff | undefined {
  return (block.children ?? []).find(
    (child) => child.node?.kind === "text" && child.node.type === "listitem",
  );
}

/**
 * The card status/label/detail for a changed list item. A leaf maps its own status. A structural
 * `listitem` the diff reports as `added`/`removed` only because Option-A nesting (docs/030 §7.3)
 * wrapped an EXISTING item into a fresh container is really an EDIT of that item — its surviving
 * inner leaf changed — so it reads as `Edited`, not a misleading `Added`.
 */
function itemCardMeta(
  ctx: DiffContext,
  block: ReaderBlockDiff,
  column: DiffColumn,
): {
  status: "added" | "removed" | "changed" | "moved";
  label: string;
  detail?: ReactNode;
} {
  let status = block.status as "added" | "removed" | "changed" | "moved";
  if (block.node?.kind === "structural" && block.node.type === "listitem") {
    const inner = innerLeafDiff(block);
    if (
      (status === "added" || status === "removed") &&
      inner &&
      inner.status !== "unchanged"
    ) {
      status = "changed";
    }
  }
  const label =
    status === "added"
      ? "Added"
      : status === "removed"
        ? "Removed"
        : status === "moved"
          ? "Moved"
          : "Edited";
  const detail = status === "moved" ? moveDetail(block, column) : undefined;
  return { detail, label, status };
}

/** One changed list item as a full change card: its `<li>` inside a one-item list in the body. */
function renderListItemCard(
  ctx: DiffContext,
  block: ReaderBlockDiff,
  column: DiffColumn,
  key: string,
  ordinal: number,
): ReactNode {
  const { node } = pick(ctx, block, column);
  if (!node) return null;
  const flavour = flatListFlavour(ctx, block) ?? "bullet";
  const li = renderDecoratedLi(ctx, block, column, `${key}.li`);
  const body = wrapList(flavour, li, ordinal, `${key}.list`);
  const { status, label, detail } = itemCardMeta(ctx, block, column);
  return card(
    status,
    <StatusTag detail={detail} label={label} status={status} />,
    body,
    key,
  );
}

/**
 * A nested `list` inside a structural list item, rendered diff-aware (docs/030 §7.3 Option A). The
 * container `list` node carries no `listType` — the flavour lives on each item leaf — so the marker
 * is read from the items, and every item renders decorated inline so a change on a nested item (the
 * bullet→number on the item you indented) shows, instead of being swallowed by a plain re-render.
 */
function renderDiffSublist(
  ctx: DiffContext,
  block: ReaderBlockDiff,
  column: DiffColumn,
  key: string,
): ReactNode {
  const { node, snapshot } = pick(ctx, block, column);
  if (!node || node.kind !== "structural" || node.type !== "list") {
    return renderDiffBlock(ctx, block, column, key, true);
  }
  const byId = new Map(
    (block.children ?? []).map((child) => [child.id, child]),
  );
  const inner = node.children
    .map((id) => snapshot.body.blocks[id])
    .find((child) => child?.kind === "text" && child.type === "listitem");
  const flavour =
    inner && inner.kind === "text" ? leafFlavour(inner) : "bullet";
  const items = node.children.map((childId, index) => {
    const childDiff = byId.get(childId);
    const childNode = snapshot.body.blocks[childId];
    if (!childNode) return null;
    return childDiff ? (
      renderDecoratedLi(ctx, childDiff, column, `${key}.i.${index}`)
    ) : (
      <Fragment key={`${key}.i.${index}`}>
        {renderBlock(childNode, snapshot, ctx.options)}
      </Fragment>
    );
  });
  return wrapList(flavour, items, 1, key);
}

// --- top-level body grouping (mirror of the reader's `groupListRuns`) --------

type BodyUnit =
  | {
      readonly kind: "list";
      readonly flavour: "bullet" | "number" | "checklist";
      readonly items: readonly ReaderBlockDiff[];
    }
  | { readonly kind: "single"; readonly block: ReaderBlockDiff }
  | { readonly kind: "fold"; readonly count: number };

function groupBody(
  ctx: DiffContext,
  blocks: readonly ReaderBlockDiff[],
): BodyUnit[] {
  const units: BodyUnit[] = [];
  let run: ReaderBlockDiff[] = [];
  let runFlavour: "bullet" | "number" | "checklist" | null = null;
  const flush = () => {
    if (run.length === 0 || !runFlavour) return;
    units.push({ flavour: runFlavour, items: run, kind: "list" });
    run = [];
    runFlavour = null;
  };
  for (const block of blocks) {
    const flavour = flatListFlavour(ctx, block);
    if (flavour) {
      if (run.length > 0 && flavour !== runFlavour) flush();
      runFlavour = flavour;
      run.push(block);
      continue;
    }
    flush();
    units.push({ block, kind: "single" });
  }
  flush();
  return units;
}

/** Whether a display unit contains any change (drives context folding). */
function unitChanged(unit: BodyUnit): boolean {
  if (unit.kind === "list")
    return unit.items.some((b) => b.status !== "unchanged");
  if (unit.kind === "single") return unit.block.status !== "unchanged";
  return false;
}

/** Fold runs of unchanged units farther than `radius` from a change into `fold` separators (§6.3). */
function foldContext(ctx: DiffContext, units: BodyUnit[]): BodyUnit[] {
  if (ctx.context !== "focused") return units;
  const keep = units.map(unitChanged);
  const near = keep.slice();
  units.forEach((_unit, i) => {
    if (!keep[i]) return;
    for (let d = -ctx.radius; d <= ctx.radius; d += 1) {
      if (i + d >= 0 && i + d < units.length) near[i + d] = true;
    }
  });
  const out: BodyUnit[] = [];
  let folded = 0;
  const flushFold = () => {
    if (folded > 0) out.push({ count: folded, kind: "fold" });
    folded = 0;
  };
  units.forEach((unit, i) => {
    if (near[i]) {
      flushFold();
      out.push(unit);
    } else {
      folded += unit.kind === "list" ? unit.items.length : 1;
    }
  });
  flushFold();
  return out;
}

/**
 * Render a flat-list run (docs/036 §6.3): each changed/added/removed/moved item becomes its own
 * change card — the same status-tag panel and article-edge left bar every flow-block change gets,
 * the parity the diff view promises — while consecutive unchanged items coalesce into one shared
 * real `<ol>`/`<ul>` so an untouched run still reads as a single list. A list item cannot wear a
 * card directly (an `<li>` under a `<div class="card">` is invalid), so the card body is a one-item
 * list; `ordinal` (the item's 1-based position in the run) keeps an ordered card's number honest.
 */
function renderListRun(
  ctx: DiffContext,
  unit: Extract<BodyUnit, { kind: "list" }>,
  column: DiffColumn,
  key: string,
): ReactNode {
  const out: ReactNode[] = [];
  let pending: ReactNode[] = [];
  let pendingStart = 1;
  const flush = (tag: string | number) => {
    if (pending.length === 0) return;
    out.push(
      wrapList(unit.flavour, pending, pendingStart, `${key}.run.${tag}`),
    );
    pending = [];
  };
  unit.items.forEach((block, index) => {
    const ordinal = index + 1;
    if (block.status === "unchanged") {
      if (pending.length === 0) pendingStart = ordinal;
      pending.push(renderDecoratedLi(ctx, block, column, `${key}.li.${index}`));
    } else {
      flush(index);
      out.push(
        renderListItemCard(ctx, block, column, `${key}.card.${index}`, ordinal),
      );
    }
  });
  flush("end");
  if (out.length === 0) return null;
  return <Fragment key={key}>{out}</Fragment>;
}

function renderUnit(ctx: DiffContext, unit: BodyUnit, key: string): ReactNode {
  if (unit.kind === "fold") {
    return (
      <div className="rt-diff-fold" key={key}>
        ⋯ {unit.count} unchanged {unit.count === 1 ? "block" : "blocks"} ⋯
      </div>
    );
  }
  return unit.kind === "list"
    ? renderListRun(ctx, unit, "unified", key)
    : renderDiffBlock(ctx, unit.block, "unified", key);
}

/** The unified body: one column, merged spine order, flat list runs grouped, context folded. */
function renderUnifiedBody(ctx: DiffContext): ReactNode {
  const units = foldContext(ctx, groupBody(ctx, ctx.diff.blocks));
  return units.map((unit, index) => renderUnit(ctx, unit, `unit.${index}`));
}

// --- side-by-side (§6.1): row-aligned matched pairs + two-ended moves --------

const presentInBase = (block: ReaderBlockDiff) => block.status !== "added";
const presentInTarget = (block: ReaderBlockDiff) => block.status !== "removed";

function columnBlocks(
  ctx: DiffContext,
  column: "base" | "target",
): readonly ReaderBlockDiff[] {
  const present = column === "base" ? presentInBase : presentInTarget;
  const indexOf = (block: ReaderBlockDiff) =>
    (column === "base" ? block.baseIndex : block.targetIndex) ?? 0;
  return ctx.diff.blocks
    .filter(present)
    .toSorted((a, b) => indexOf(a) - indexOf(b));
}

type Row = {
  readonly left: ReaderBlockDiff | null;
  readonly right: ReaderBlockDiff | null;
};

/**
 * Build the aligned side-by-side rows. The matched blocks (unchanged/changed — the LCS spine, in
 * the same relative order on both sides) are ANCHORS that share a row; between two anchors the
 * base-only items (removed, and a moved block at its base slot) fill the left and the target-only
 * items (added, and a moved block at its target slot) fill the right, paired positionally with a
 * gap opposite an unmatched one. So a moved block shows real at its base row (left) and its target
 * row (right), each labelled, with the eye tracing it via the amber tag — base order stays on the
 * left, target order on the right, and every anchor lines up.
 */
const isAnchor = (b: ReaderBlockDiff) =>
  b.status === "unchanged" || b.status === "changed";

function buildRows(ctx: DiffContext): Row[] {
  const anchorIds = new Set(ctx.diff.blocks.filter(isAnchor).map((b) => b.id));
  const left = columnBlocks(ctx, "base");
  const right = columnBlocks(ctx, "target");
  const rows: Row[] = [];
  let li = 0;
  let ri = 0;
  while (li < left.length || ri < right.length) {
    const lb: ReaderBlockDiff[] = [];
    while (li < left.length && !anchorIds.has(left[li]!.id)) {
      lb.push(left[li]!);
      li += 1;
    }
    const rb: ReaderBlockDiff[] = [];
    while (ri < right.length && !anchorIds.has(right[ri]!.id)) {
      rb.push(right[ri]!);
      ri += 1;
    }
    const n = Math.max(lb.length, rb.length);
    for (let k = 0; k < n; k += 1) {
      rows.push({ left: lb[k] ?? null, right: rb[k] ?? null });
    }
    if (li < left.length && ri < right.length) {
      rows.push({ left: left[li]!, right: right[ri]! });
      li += 1;
      ri += 1;
    }
  }
  return rows;
}

/**
 * A single side-by-side cell. A changed list item gets the same change card as in unified (its
 * `<li>` inside a one-item list — a lone `<li>` is invalid otherwise); an unchanged one is wrapped
 * bare. A non-list block renders straight through.
 */
function renderCell(
  ctx: DiffContext,
  block: ReaderBlockDiff,
  column: "base" | "target",
  key: string,
): ReactNode {
  const flavour = flatListFlavour(ctx, block);
  let content: ReactNode;
  if (flavour) {
    // No list-run context here, so an ordered item's number restarts at 1 (the same limitation the
    // per-cell wrap has always had); the card's status header is what carries the review signal.
    content =
      block.status === "unchanged"
        ? wrapList(
            flavour,
            renderDecoratedLi(ctx, block, column, `${key}.b`),
            1,
            `${key}.l`,
          )
        : renderListItemCard(ctx, block, column, `${key}.b`, 1);
  } else {
    content = renderDiffBlock(ctx, block, column, `${key}.b`);
  }
  return (
    <div className="rt-diff-cell" key={key}>
      {content}
    </div>
  );
}

function renderSideBySide(ctx: DiffContext): ReactNode {
  const cells: ReactNode[] = [
    <div className="rt-diff-colhead" key="head.base">
      Base
    </div>,
    <div className="rt-diff-colhead" key="head.target">
      Target
    </div>,
  ];
  buildRows(ctx).forEach((row, index) => {
    const key = `row.${index}`;
    cells.push(
      row.left ? (
        renderCell(ctx, row.left, "base", `${key}.l`)
      ) : (
        <div aria-hidden="true" className="rt-diff-gap" key={`${key}.l`} />
      ),
      row.right ? (
        renderCell(ctx, row.right, "target", `${key}.r`)
      ) : (
        <div aria-hidden="true" className="rt-diff-gap" key={`${key}.r`} />
      ),
    );
  });
  return cells;
}

// --- the stats header + the component ----------------------------------------

function DiffStatsHeader({
  stats,
}: {
  readonly stats: ReaderSnapshotDiff["stats"];
}): ReactNode {
  const parts: ReactNode[] = [];
  if (stats.added > 0) {
    parts.push(
      <span className="rt-diff-stat-added" key="a">
        +{stats.added}
      </span>,
    );
  }
  if (stats.removed > 0) {
    parts.push(
      <span className="rt-diff-stat-removed" key="r">
        −{stats.removed}
      </span>,
    );
  }
  if (stats.moved > 0) {
    parts.push(
      <span className="rt-diff-stat-moved" key="m">
        {stats.moved} moved
      </span>,
    );
  }
  if (stats.changed > 0) {
    parts.push(
      <span className="rt-diff-stat-changed" key="c">
        {stats.changed} changed
      </span>,
    );
  }
  return (
    <div className="rt-diff-stats" data-rt-diff-stats="">
      {parts.length > 0 ? (
        parts
      ) : (
        <span className="rt-diff-stat-clean">No changes</span>
      )}
    </div>
  );
}

/**
 * Render a structured document diff on the reader L1 (docs/036 §6.1/§6.3, R6-F).
 *
 * Pass the output of `diffSnapshots(base, target)` as `diff`; the surface renders it unified
 * (default) or side-by-side, following the §6.3 design system — change cards, one status-tag,
 * inline track-changes, two-ended moves, foldable context. Every block is drawn by the reader's
 * own `renderBlock`, so an `unchanged` block is identical to the plain `<Reader>` render.
 *
 * @example
 * <DiffView diff={diffSnapshots(base, target)} mode="unified" context="focused" />
 */
export function DiffView({
  diff,
  mode = "unified",
  showStats = true,
  context = "all",
  contextRadius = 2,
  embedStyles = true,
  ...options
}: DiffViewProps): ReactNode {
  const ctx: DiffContext = {
    context,
    diff,
    mode,
    options,
    radius: Math.max(0, contextRadius),
  };
  return (
    <div className="rt-diff-view" data-rt-diff-mode={mode}>
      {/* A host banding many `DiffView`s (the inline overlay, docs/036 §6.2.1) turns this off
          and injects the shared stylesheet once, so the DOM holds one copy, not one per band. */}
      {embedStyles ? (
        <>
          <style>{RICH_TEXT_TYPOGRAPHY_CSS}</style>
          <style>{RICH_TEXT_DIFF_CSS}</style>
        </>
      ) : null}
      {showStats ? <DiffStatsHeader stats={diff.stats} /> : null}
      {mode === "side-by-side" ? (
        <div className="rt-diff-cols">{renderSideBySide(ctx)}</div>
      ) : (
        <RichTextArticle>{renderUnifiedBody(ctx)}</RichTextArticle>
      )}
    </div>
  );
}
