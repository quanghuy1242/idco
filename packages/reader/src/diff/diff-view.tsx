/**
 * `DiffView` — the dedicated diff surface (docs/036 §6.1, R6-F): it renders one
 * `ReaderSnapshotDiff` (the engine's `diffSnapshots` result) on the reader L1, unified or
 * side-by-side.
 *
 * Why it lives here and reuses the L1 (docs/036 D7). Both diff surfaces "render through the
 * reader L1 per-node functions, wrapping results in status styling; they do not reimplement
 * block/mark rendering." So every block is drawn by the reader's own `renderBlock`, inheriting
 * editor↔reader parity (docs/028): an `unchanged` block is byte-identical to the plain reader
 * render (the R6-F parity assertion), because it *is* the plain reader render with no wrapper.
 *
 * How the decoration is injected without a second renderer. A changed container or a changed
 * text leaf needs the reader's exact shell (a `<ul>`/`<aside>`/`<table>` with its tone, list
 * kind, colWidths…, or a `<p>`/`<h2>` with its align/indent/anchor) but with *decorated*
 * children. Rather than re-derive those shells here — which would drift the moment a shell
 * attr changes — we take the shell `renderBlock` already produced and `cloneElement` it,
 * replacing only its children with the decorated ones (the diff-aware child renders, or the
 * Tier-1 run spans for a changed leaf). So the shell is never re-implemented; only the
 * children are decorated. The one thing this can't do is regroup: a container holding *flat*
 * `listitem` leaves (not a structural `list` node) isn't re-grouped into a `<ul>` inside the
 * clone — the top-level body path groups flat runs (mirroring the reader's `groupListRuns`),
 * but a flat list nested directly in a callout renders its items ungrouped; the SN-1 model
 * emits structural `list` nodes, which recurse cleanly, so this is an accepted edge.
 *
 * Two decoration tiers (§6.3), applied by status:
 *   - Tier 1 (inside a changed text leaf): `renderRunSpans` walks `TextLeafDiff.runs` and tints
 *     each `keep`/`insert`/`delete` run, nesting the run's own marks through the reader's exact
 *     `renderMarkedSpans` so a marked run cannot drift from the reader.
 *   - Tier 2 (whole blocks): a `.rt-diff-*` change-bar wrapper on flow blocks. Scaffolding that
 *     must stay an `<li>`/`<tr>`/`<td>` (list items, table rows/cells) can't take an outer
 *     `<div>`, so it carries no bar — its changed descendants carry the decoration instead, and
 *     an added/removed leaf item tints its own content (`.rt-diff-ins`/`.rt-diff-del`).
 *
 * Pure and RSC-safe: no hooks, no state, no client imports — `mode` is a prop, so a host that
 * wants a unified/side-by-side toggle owns that state (the interactive chrome is a host or
 * `@idco/ui` concern, §6.1). It injects the typography + diff stylesheets itself, so it works
 * standalone (outside a `<Reader>`); the CSS is idempotent when a surrounding reader also
 * injects the typography.
 *
 * @categoryDefault Diff View
 */
import { cloneElement, Fragment, isValidElement, type ReactNode } from "react";
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
  ReaderObjectDiff,
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
};

/** Which column a block is being rendered for: unified reads target (base for a removed block). */
type DiffColumn = "unified" | "base" | "target";

/** The render context threaded through the recursion — the diff plus the reader options. */
type DiffContext = {
  readonly diff: ReaderSnapshotDiff;
  readonly options: ReaderOptions;
  readonly mode: DiffViewMode;
};

// --- node helpers ------------------------------------------------------------

function asText(node: ReaderBlockNode | undefined): ReaderTextNode | undefined {
  return node && node.kind === "text" ? node : undefined;
}

/**
 * A "flow" block gets a Tier-2 change-bar wrapper `<div>`; a non-flow block renders as an
 * `<li>`/`<tr>`/`<td>` that cannot legally take an outer `<div>`, so it carries its decoration
 * on its content/descendants instead. Objects and top-level containers are flow; list items and
 * table rows/cells are not.
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

/**
 * The flat-list flavour of a top-level `listitem` block, or null when it is not one. Mirrors the
 * reader's `groupListRuns`: a flat text `listitem` uses its own attrs; a structural `listitem`
 * (SN-1, a list item with nested block children at body order) adopts its inner text leaf's
 * flavour, so both coalesce into one `<ul>`/`<ol>` — a structural `list` node (type `"list"`) is
 * NOT a listitem and passes through ungrouped.
 */
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

// --- Tier 1: the changed-leaf run pass (§5.2, §6.3) --------------------------

/** Clamp resolved marks to a run's `[from, to)` slice and shift them into run-local offsets. */
function clampMarks(
  marks: readonly ReaderResolvedMark[],
  from: number,
  to: number,
): ReaderResolvedMark[] {
  const out: ReaderResolvedMark[] = [];
  for (const mark of marks) {
    if (mark.from >= to || mark.to <= from) continue; // no overlap with this run
    out.push({
      ...mark,
      from: Math.max(0, mark.from - from),
      to: Math.min(to - from, mark.to - from),
    });
  }
  return out;
}

/** Target-space ranges of marks whose presence/attrs changed (added or changed, not removed). */
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

/**
 * Render a changed text leaf's runs as tinted spans (§6.3 Tier 1). Each run's own text is
 * nested through the reader's `renderMarkedSpans` using the marks that cover it — target-space
 * marks for `keep`/`insert`, base-space for `delete` — so "Hello" → "Hi" reads as `H` plain,
 * `ello` struck, `i` green, with any bold/link on those runs still rendered. A `keep` run under
 * a changed mark (bold added over unchanged text) gets the dotted `.rt-diff-mark` overlay so a
 * mark-only change is visible. A `"text"`-alignment leaf (§5.2 fallback) appends a badge.
 */
function renderRunSpans(
  ctx: DiffContext,
  block: ReaderBlockDiff,
  text: ReaderTextLeafDiff,
): ReactNode[] {
  const baseLeaf = asText(ctx.diff.base.body.blocks[block.id]);
  const targetLeaf = asText(ctx.diff.target.body.blocks[block.id]);
  const baseMarks = baseLeaf ? resolveLeafMarks(baseLeaf) : [];
  const targetMarks = targetLeaf ? resolveLeafMarks(targetLeaf) : [];
  const changed = changedMarkRanges(text);
  const spans: ReactNode[] = [];
  let tOff = 0; // running offset in the target leaf's coordinate space
  let bOff = 0; // running offset in the base leaf's coordinate space
  text.runs.forEach((run, index) => {
    const len = run.text.length;
    const key = `run.${index}`;
    if (run.op === "delete") {
      const marks = clampMarks(baseMarks, bOff, bOff + len);
      spans.push(
        <span className="rt-diff-del" key={key}>
          {renderMarkedSpans(run.text, marks, ctx.diff.base)}
        </span>,
      );
      bOff += len;
      return;
    }
    const marks = clampMarks(targetMarks, tOff, tOff + len);
    const inner = renderMarkedSpans(run.text, marks, ctx.diff.target);
    if (run.op === "insert") {
      spans.push(
        <span className="rt-diff-ins" key={key}>
          {inner}
        </span>,
      );
      tOff += len;
      return;
    }
    // keep: plain, unless a mark changed over it (dotted overlay).
    const cls = overlapsAny(changed, tOff, tOff + len)
      ? "rt-diff-mark"
      : undefined;
    spans.push(
      <span className={cls} key={key}>
        {inner}
      </span>,
    );
    tOff += len;
    bOff += len;
  });
  if (text.alignment === "text") {
    spans.push(
      <span className="rt-diff-fallback" key="fallback" title="heuristic diff">
        text
      </span>,
    );
  }
  return spans;
}

/** The field-change summary under a changed object (§6.3 "changed object"). */
function renderFieldSummary(object: ReaderObjectDiff | undefined): ReactNode {
  if (!object?.fields || object.fields.length === 0) {
    return object?.statusChanged ? (
      <div className="rt-diff-note">status changed</div>
    ) : null;
  }
  return (
    <ul className="rt-diff-fields">
      {object.fields.map((f) => (
        <li key={f.path}>
          {f.path}: {JSON.stringify(f.base)} → {JSON.stringify(f.target)}
        </li>
      ))}
    </ul>
  );
}

// --- the recursive block renderer --------------------------------------------

/** Render a marked-span view of a whole leaf's text (for an added/removed list item's content). */
function leafContent(
  node: ReaderTextNode,
  snapshot: ReaderSnapshot,
): ReactNode {
  return renderMarkedSpans(node.content.text, resolveLeafMarks(node), snapshot);
}

/**
 * Prepend an inline marker INTO a rendered element's own children (not as a sibling) — the only
 * HTML-legal way to badge a non-flow item, since a `<span>` sibling of an `<li>`/`<tr>`/`<td>`
 * is invalid inside its `<ul>`/`<table>`/`<tr>`. An `<li>` or `<td>` accepts a leading inline
 * chip, so a moved list item / cell is signalled.
 *
 * Conscious trade-off: a `<tr>` admits ONLY `<td>`/`<th>`, so no inline chip is legal directly in
 * it — this returns the row untouched rather than emit invalid markup. A whole-row move therefore
 * carries no amber cue (only its new position signals it); validity wins over the cue for this
 * one rare shape. The future option (documented, deferred) is a chip inside the row's first cell.
 */
function withLeadingMarker(
  shell: ReactNode,
  marker: ReactNode,
  tag: string,
): ReactNode {
  if (tag === "tablerow" || !isValidElement(shell)) return shell;
  const props = shell.props as { readonly children?: ReactNode };
  return cloneElement(shell, {}, marker, props.children);
}

/**
 * The decorated inner content of a *changed* block — the reader shell with its children
 * replaced by diff-aware renders. A changed text leaf gets the Tier-1 run spans; a changed
 * structural container gets its children re-rendered through `renderDiffBlock` (so only the
 * changed descendants carry decoration, §5.5); a changed object gets its normal render plus a
 * field summary. Everything reuses `renderBlock`'s shell via `cloneElement`, so container
 * attrs (tone, list kind, colWidths…) are never re-derived here.
 */
function changedInner(
  ctx: DiffContext,
  block: ReaderBlockDiff,
  node: ReaderBlockNode,
  snapshot: ReaderSnapshot,
  column: DiffColumn,
): ReactNode {
  const shell = renderBlock(node, snapshot, ctx.options);
  if (node.kind === "text" && block.text) {
    const runs = renderRunSpans(ctx, block, block.text);
    return isValidElement(shell) ? cloneElement(shell, {}, ...runs) : shell;
  }
  if (node.kind === "structural" && block.children) {
    const kids = block.children.map((child, index) =>
      renderDiffBlock(ctx, child, column, `${block.id}.child.${index}`),
    );
    return isValidElement(shell) ? cloneElement(shell, {}, ...kids) : shell;
  }
  if (node.kind === "object") {
    return (
      <>
        {shell}
        {renderFieldSummary(block.object)}
      </>
    );
  }
  return shell;
}

/** The inline (no `<li>`) decorated content of a text `listitem` leaf inside a structural item. */
function renderInlineListLeaf(
  ctx: DiffContext,
  block: ReaderBlockDiff,
  column: DiffColumn,
): ReactNode {
  const { node, snapshot } = pick(ctx, block, column);
  const leaf = asText(node);
  if (!leaf) return null;
  if (block.status === "changed" && block.text) {
    return renderRunSpans(ctx, block, block.text);
  }
  if (block.status === "added") {
    return <span className="rt-diff-ins">{leafContent(leaf, snapshot)}</span>;
  }
  if (block.status === "removed") {
    return <span className="rt-diff-del">{leafContent(leaf, snapshot)}</span>;
  }
  return leafContent(leaf, snapshot);
}

/**
 * Render a structural `listitem` (SN-1: a list item with nested block children) as a real
 * `<li>`. This case cannot go through `renderBlock` — the reader has no `renderStructural` case
 * for `listitem` (it renders them only via its private `renderListItem`), so `renderBlock` would
 * emit a bare Fragment, producing invalid markup inside a `<ul>`. So we mirror `renderListItem`
 * here, diff-aware: the inner `listitem` leaf renders inline (its text, decorated, NOT a nested
 * `<li>`); the other children render as blocks. We read the item's children from the node (so an
 * unchanged item still renders), overlaying the per-child diff when one exists.
 */
function renderStructuralListItem(
  ctx: DiffContext,
  block: ReaderBlockDiff,
  column: DiffColumn,
  key: string,
): ReactNode {
  const { node, snapshot } = pick(ctx, block, column);
  if (!node || node.kind !== "structural") {
    return <Fragment key={key} />;
  }
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
            ? renderInlineListLeaf(ctx, childDiff, column)
            : leafContent(childNode, snapshot)}
        </Fragment>
      );
    }
    return childDiff ? (
      renderDiffBlock(ctx, childDiff, column, `${key}.c.${index}`)
    ) : (
      <Fragment key={`c.${index}`}>
        {renderBlock(childNode, snapshot, ctx.options)}
      </Fragment>
    );
  });
  // A moved structural item can't take an amber bar; it gets an inline chip inside the `<li>`.
  const content =
    block.status === "moved"
      ? [
          <span className="rt-diff-moved-badge" key="mv">
            moved
          </span>,
          ...body,
        ]
      : body;
  return typeof checked === "boolean" ? (
    <RichTextCheckListItem checked={checked} key={key}>
      {content}
    </RichTextCheckListItem>
  ) : (
    <RichTextListItem key={key}>{content}</RichTextListItem>
  );
}

/**
 * Render one `BlockDiff` for a column, recursing into changed containers. The single entry
 * every path (unified body, side-by-side cell, container child) funnels through, so status
 * decoration is applied in exactly one place.
 */
function renderDiffBlock(
  ctx: DiffContext,
  block: ReaderBlockDiff,
  column: DiffColumn,
  key: string,
): ReactNode {
  const { node, snapshot } = pick(ctx, block, column);
  if (!node) return null; // defensive: an id with no node on the picked side
  // A structural list item has no `renderBlock` shell (see `renderStructuralListItem`), so it is
  // routed to its own `<li>` renderer before the generic flow/non-flow logic.
  if (node.kind === "structural" && node.type === "listitem") {
    return renderStructuralListItem(ctx, block, column, key);
  }
  const flow = isFlowBlock(node);

  // A matched id whose kind flipped (a leaf became an object, §5.5): show removed-old over
  // added-new rather than only the new node, so the transition is legible.
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
        <div className="rt-diff rt-diff-removed" data-rt-diff="removed">
          <span className="rt-diff-badge">was</span>
          {renderBlock(baseNode, ctx.diff.base, ctx.options)}
        </div>
        <div className="rt-diff rt-diff-added" data-rt-diff="added">
          {renderBlock(targetNode, ctx.diff.target, ctx.options)}
        </div>
      </Fragment>
    );
  }

  if (block.status === "unchanged") {
    // Bare render, no wrapper — this is the parity guarantee (R6-F): identical to `<Reader>`.
    return (
      <Fragment key={key}>{renderBlock(node, snapshot, ctx.options)}</Fragment>
    );
  }

  if (block.status === "changed") {
    const inner = changedInner(ctx, block, node, snapshot, column);
    return flow ? (
      <div className="rt-diff rt-diff-changed" data-rt-diff="changed" key={key}>
        {inner}
      </div>
    ) : (
      <Fragment key={key}>{inner}</Fragment>
    );
  }

  if (block.status === "moved") {
    // A move shows the target-side node; if it also changed, its content carries the changed
    // decoration too (`alsoChanged`, §5.4). The unified note names where it came from.
    const inner = block.alsoChanged
      ? changedInner(ctx, block, node, snapshot, column)
      : renderBlock(node, snapshot, ctx.options);
    const note =
      ctx.mode === "unified" && block.baseIndex !== null ? (
        <div className="rt-diff-note">
          moved from position {block.baseIndex + 1}
        </div>
      ) : null;
    // Non-flow scaffolding (an `<li>`/`<td>`) cannot carry an amber bar, so it gets an inline
    // "moved" chip prepended INTO its content (legal there); a `<tr>` takes none (cells only).
    const movedBadge = (
      <span className="rt-diff-moved-badge" key="mv">
        moved
      </span>
    );
    return flow ? (
      <div className="rt-diff rt-diff-moved" data-rt-diff="moved" key={key}>
        {note}
        {inner}
      </div>
    ) : (
      <Fragment key={key}>
        {withLeadingMarker(inner, movedBadge, node.type)}
      </Fragment>
    );
  }

  // added / removed
  const isAdded = block.status === "added";
  const statusClass = isAdded ? "rt-diff-added" : "rt-diff-removed";
  const tintClass = isAdded ? "rt-diff-ins" : "rt-diff-del";
  if (flow) {
    return (
      <div
        className={`rt-diff ${statusClass}`}
        data-rt-diff={block.status}
        key={key}
      >
        {!isAdded ? <span className="rt-diff-badge">removed</span> : null}
        {renderBlock(node, snapshot, ctx.options)}
      </div>
    );
  }
  // Non-flow scaffolding (li/tr/td): a structural one (a whole added/removed row or a
  // structural list item) recurses so its structure shows and its flow descendants carry the
  // wash; a leaf list item tints its own content, since it can't wear a bar.
  if (node.kind === "structural" && block.children) {
    const shell = renderBlock(node, snapshot, ctx.options);
    const kids = block.children.map((child, index) =>
      renderDiffBlock(ctx, child, column, `${block.id}.child.${index}`),
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
    <span className={tintClass}>{leafContent(leaf, snapshot)}</span>
  ) : (
    renderBlock(node, snapshot, ctx.options)
  );
  return (
    <Fragment key={key}>
      {leaf && isValidElement(shell) ? cloneElement(shell, {}, tinted) : shell}
    </Fragment>
  );
}

// --- top-level body grouping (mirror of the reader's `groupListRuns`) --------

type BodyUnit =
  | {
      readonly kind: "list";
      readonly flavour: "bullet" | "number" | "checklist";
      readonly items: readonly ReaderBlockDiff[];
    }
  | { readonly kind: "single"; readonly block: ReaderBlockDiff };

/**
 * Group the top-level (body) diff into render units, coalescing consecutive flat `listitem`
 * BlockDiffs into one synthetic list run so a flat list renders as one real `<ul>`/`<ol>` — the
 * diff-side mirror of the reader's `groupListRuns` (a structural `list` node is a single block
 * and passes through as a `single`, unaffected).
 */
function groupBody(
  ctx: DiffContext,
  blocks: readonly ReaderBlockDiff[],
): readonly BodyUnit[] {
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

/** Render a synthetic flat-list run's items into the matching real list element. */
function renderListRun(
  ctx: DiffContext,
  unit: Extract<BodyUnit, { kind: "list" }>,
  column: DiffColumn,
  key: string,
): ReactNode {
  const items = unit.items.map((block, index) =>
    renderDiffBlock(ctx, block, column, `${key}.item.${index}`),
  );
  if (items.length === 0) return null;
  return unit.flavour === "checklist" ? (
    <RichTextCheckList key={key}>{items}</RichTextCheckList>
  ) : (
    <RichTextList
      key={key}
      kind={unit.flavour === "number" ? "number" : "bullet"}
    >
      {items}
    </RichTextList>
  );
}

/** The unified body: one column, blocks in merged order, flat list runs grouped. */
function renderUnifiedBody(ctx: DiffContext): ReactNode {
  return groupBody(ctx, ctx.diff.blocks).map((unit, index) => {
    const key = `unit.${index}`;
    return unit.kind === "list"
      ? renderListRun(ctx, unit, "unified", key)
      : renderDiffBlock(ctx, unit.block, "unified", key);
  });
}

// --- side-by-side (§6.1) -----------------------------------------------------

const presentInBase = (block: ReaderBlockDiff) => block.status !== "added";
const presentInTarget = (block: ReaderBlockDiff) => block.status !== "removed";

/**
 * The top-level blocks present on one side, in THAT side's own document order. Sorting the
 * filtered blocks by `baseIndex`/`targetIndex` (the body-scope index on each side) is what makes
 * the base column show base order and the target column target order — so a reorder reads as a
 * block low on the left and high on the right, each correct, instead of one merged order forced
 * onto both (§6.1).
 */
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

/** Render one column's blocks in its own order, grouping flat list runs like the body does. */
function renderColumn(ctx: DiffContext, column: "base" | "target"): ReactNode {
  return groupBody(ctx, columnBlocks(ctx, column)).map((unit, index) => {
    const key = `${column}.${index}`;
    return unit.kind === "list"
      ? renderListRun(ctx, unit, column, key)
      : renderDiffBlock(ctx, unit.block, column, key);
  });
}

/**
 * Side-by-side (§6.1): two independent columns — Base in base order, Target in target order — so
 * each faithfully represents its own document. A block present on only one side simply appears in
 * that column (no phantom placeholder to drift); a moved block keeps its amber treatment in each
 * column. Matched blocks line up naturally when nothing moved; a drawn cross-column connector is
 * the one deferred nicety (the per-column ordering is the correctness it would illustrate).
 */
function renderSideBySide(ctx: DiffContext): ReactNode {
  return (
    <>
      <div className="rt-diff-col">
        <div className="rt-diff-colhead">Base</div>
        {renderColumn(ctx, "base")}
      </div>
      <div className="rt-diff-col">
        <div className="rt-diff-colhead">Target</div>
        {renderColumn(ctx, "target")}
      </div>
    </>
  );
}

// --- the stats header + the component ----------------------------------------

/** The header summary ("+12 −3, 2 moved, 4 changed"), tokenized; "No changes" when all zero. */
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
 * Render a structured document diff on the reader L1 (docs/036 §6.1, R6-F).
 *
 * Pass the output of the engine's `diffSnapshots(base, target)` as `diff`; the surface renders
 * it unified (default) or side-by-side, with a stats header. Every block is drawn by the
 * reader's own `renderBlock`, so an `unchanged` block is identical to the plain `<Reader>`
 * render and only changed/added/removed/moved blocks carry `.rt-diff-*` decoration. Reader
 * render options (object/structural renderers, media/post resolvers) pass through.
 *
 * @example
 * <DiffView diff={diffSnapshots(baseSnapshot, targetSnapshot)} mode="unified" />
 */
export function DiffView({
  diff,
  mode = "unified",
  showStats = true,
  ...options
}: DiffViewProps): ReactNode {
  const ctx: DiffContext = { diff, mode, options };
  return (
    <div className="rt-diff-view" data-rt-diff-mode={mode}>
      {/* Self-inject the appearance so the surface works standalone; both strings are
          idempotent if a surrounding <Reader> already injected the typography. */}
      <style>{RICH_TEXT_TYPOGRAPHY_CSS}</style>
      <style>{RICH_TEXT_DIFF_CSS}</style>
      {showStats ? <DiffStatsHeader stats={diff.stats} /> : null}
      {mode === "side-by-side" ? (
        <div className="rt-diff-cols">{renderSideBySide(ctx)}</div>
      ) : (
        <RichTextArticle>{renderUnifiedBody(ctx)}</RichTextArticle>
      )}
    </div>
  );
}
