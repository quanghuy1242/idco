/**
 * Render a text leaf's mark segments to semantic DOM (docs/010 Phase 8 AC3).
 *
 * Marks render as real semantic elements (`<strong>`, `<em>`, `<a>`, …) rather
 * than styled `<span>`s, for two reasons:
 *
 * - **Theming.** DaisyUI typography (the `prose` class on the surface) styles the
 *   semantic elements directly, so document theming is the framework's job, not a
 *   pile of inline styles (docs/010 §7.1). The functional, load-
 *   bearing CSS (caret/selection suppression, `pre-wrap`, `user-select`) stays in
 *   `styles.ts`; only the *decorative* mark styling moves to typography.
 * - **Geometry-neutral.** The view's offset↔DOM geometry (`geometry.ts`) walks
 *   *text nodes*, so it does not care whether a run sits in a `<span>` or an
 *   `<em>`. Using semantic elements costs the geometry nothing while buying real
 *   accessibility (a screen reader announces emphasis, a link is a link).
 *
 * The invariant the geometry depends on: the concatenation of the rendered text
 * nodes, in document order, equals the leaf's full text. `segmentText` (core)
 * guarantees the segments tile the text with no gaps or overlaps, and each
 * segment renders its raw substring (including `\n`, which `pre-wrap` lays out),
 * so a model offset stays a plain index into the visible text.
 */
import { createElement, type ReactNode } from "react";
import { partitionTextRuns } from "@quanghuy1242/idco-reader";
import type { ResolvedMark, TextLeafNode, TextMarkKind } from "../../core";
import { resolveLeafMarks, safeHref, segmentText } from "../../core";
import {
  getMark,
  markNestingRank,
  registerMark,
  type LinkMode,
  type MarkDefinition,
  type MarkRenderArgs,
} from "../spi";

function markHref(mark: ResolvedMark): string {
  const href = mark.attrs?.href;
  return typeof href === "string" ? href : "";
}

/** A simple format mark that wraps its child in one semantic element. */
function elementMark(
  kind: TextMarkKind,
  tag: string,
  nestingRank: number,
  toolbar?: MarkDefinition["toolbar"],
): MarkDefinition {
  return {
    kind,
    nestingRank,
    render: ({ child, key }) =>
      createElement(tag, { "data-engine-mark": kind, key }, child),
    ...(toolbar ? { toolbar } : {}),
  };
}

/**
 * The link mark: carries its href but is inert inside the editor (the engine owns
 * clicks; navigation is the reader's job), so the anchor cannot steal focus or
 * follow on mousedown. The reader passes `linkMode: "navigable"` for a real link.
 */
function renderLinkMark({
  mark,
  child,
  key,
  linkMode,
}: MarkRenderArgs): ReactNode {
  return (
    <a
      key={key}
      data-engine-mark="link"
      data-engine-mark-href={markHref(mark)}
      data-engine-mark-id={mark.id}
      href={
        linkMode === "navigable"
          ? safeHref(markHref(mark)) || undefined
          : undefined
      }
      onMouseDown={
        linkMode === "inert" ? (event) => event.preventDefault() : undefined
      }
    >
      {child}
    </a>
  );
}

/**
 * The comment mark (docs/027 §7.5): no longer the inert span of §3.3 — a live, visible
 * highlight over the anchored range, carrying the thread id (`attrs.thread`) so the
 * Comments pane can find and jump to it. The thin snapshot the mark also stores
 * (`attrs.snapshot`, §7.3) lets the reader paint a margin note with no host call. Full
 * resolved-state dimming from live thread state flowing into the render is the one
 * remaining view slice (§7.5); the pane already reflects resolved/unresolved.
 */
function renderAnnotationMark({ mark, child, key }: MarkRenderArgs): ReactNode {
  const thread = mark.attrs?.thread;
  return (
    <span
      key={key}
      className="bg-warning/20 [box-decoration-break:clone]"
      data-engine-comment-thread={
        typeof thread === "string" ? thread : undefined
      }
      data-engine-mark={mark.kind}
      data-engine-mark-id={mark.id}
    >
      {child}
    </span>
  );
}

/**
 * The glossary mark (docs/027 §6.1): a *reference* to a term in the document's
 * glossary collection (`attrs: { term: id }`), not a copy of the definition. It
 * renders as a real `<abbr>` with a dotted underline so the occurrence is visible and
 * navigable in the editor (no longer the inert span of docs/027 §3.3); the term id
 * rides on `data-engine-glossary-term` so the Glossary pane can find and jump to every
 * occurrence. The definition itself lives once in the collection — the reader resolves
 * it into `<abbr title>` from the document snapshot (docs/027 §6.6, with the docs/015
 * reader tier), so there is no second copy to drift.
 */
function renderGlossaryMark({ mark, child, key }: MarkRenderArgs): ReactNode {
  const term = mark.attrs?.term;
  return (
    <abbr
      key={key}
      // One dotted underline only: the `[data-engine-mark='glossary']` border-bottom
      // (styles.ts) is the single source. The abbr's own text-decoration underline is
      // suppressed (`no-underline`) so the term is not doubly-underlined (border + UA).
      className="cursor-help no-underline"
      data-engine-glossary-term={typeof term === "string" ? term : undefined}
      data-engine-mark="glossary"
      data-engine-mark-id={mark.id}
    >
      {child}
    </abbr>
  );
}

// Built-in marks (note.md W4). Registration order is the toolbar's display order
// for the togglable formats; `nestingRank` (lower = outermost) is independent and
// preserves the previous `MARK_NESTING_ORDER`. Adding a mark is now one
// registration here (or a host's `registerMark`), not edits across the render
// switch, the toolbar, and the context menu.
const BUILT_IN_MARKS: readonly MarkDefinition[] = [
  elementMark("bold", "strong", 4, {
    icon: "Bold",
    label: "Bold",
    shortcut: "Ctrl/Cmd+B",
  }),
  elementMark("italic", "em", 5, {
    icon: "Italic",
    label: "Italic",
    shortcut: "Ctrl/Cmd+I",
  }),
  elementMark("underline", "u", 6, {
    icon: "Underline",
    label: "Underline",
    shortcut: "Ctrl/Cmd+U",
  }),
  elementMark("strikethrough", "s", 7, {
    icon: "Strikethrough",
    label: "Strikethrough",
  }),
  elementMark("code", "code", 10, { icon: "Code", label: "Code" }),
  elementMark("highlight", "mark", 3, {
    icon: "Highlighter",
    label: "Highlight",
  }),
  elementMark("subscript", "sub", 8),
  elementMark("superscript", "sup", 9),
  // The three data-bearing built-ins declare `identity` (their id/attrs distinguish
  // segments); core seeds the same set, so this is consistency + the propagation path
  // a host kind rides (docs/027 §16 P7).
  { identity: true, kind: "link", nestingRank: 0, render: renderLinkMark },
  {
    identity: true,
    kind: "comment",
    nestingRank: 1,
    render: renderAnnotationMark,
  },
  {
    identity: true,
    kind: "glossary",
    nestingRank: 2,
    render: renderGlossaryMark,
  },
];

let builtInMarksRegistered = false;

/**
 * @categoryDefault Resting Render
 */

/**
 * Register the built-in marks once (idempotent). Called at module load below, and
 * exported so the view orchestrator can call it explicitly (next to
 * `registerBuiltInNodeViews`). Unlike node views — which register only through the
 * orchestrator — marks self-register here too, because the standalone resting
 * reader (`resting-document`, which imports this module directly without the editor
 * orchestrator) must render marks. The guard means a second call cannot clobber a
 * host's `registerMark` override of a built-in.
 */
export function registerBuiltInMarks(): void {
  if (builtInMarksRegistered) return;
  builtInMarksRegistered = true;
  for (const definition of BUILT_IN_MARKS) registerMark(definition);
}

registerBuiltInMarks();

/**
 * Wrap one segment's child in a mark's element via the registry, with a neutral
 * span fallback for an unregistered kind (so the segment text is never dropped).
 */
function wrapMark(
  mark: ResolvedMark,
  child: ReactNode,
  key: string,
  linkMode: LinkMode,
): ReactNode {
  const definition = getMark(mark.kind);
  if (definition) return definition.render({ child, key, linkMode, mark });
  return (
    <span key={key} data-engine-mark={mark.kind}>
      {child}
    </span>
  );
}

/**
 * Render a leaf's text with its marks as nested semantic elements.
 *
 * An unformatted leaf renders its text as a *bare* text node (no wrapper), which
 * is what the typing fast path's `textContent` patch and React's reconciliation
 * both expect (text-block.tsx). Only a leaf with marks renders the segment spans;
 * those leaves opt out of the fast path and re-render from the model instead, so
 * the bare-vs-span DOM never disagrees with React's virtual DOM (AC3).
 */
export function renderLeafMarks(
  node: TextLeafNode,
  linkMode: LinkMode = "inert",
): ReactNode {
  const resolved = resolveLeafMarks(node);
  const text = node.content.text;
  if (resolved.length === 0) {
    return text.length > 0 ? text : "​";
  }
  return renderMarkSegments(text, resolved, linkMode, 0);
}

/**
 * Render one run of `text` (starting at model offset `base`) with `resolved` marks as nested segment
 * spans — the shared body of {@link renderLeafMarks} and the review run decorator. `base` offsets the
 * `data-engine-segment` keys so a per-slice render keeps stable, non-colliding keys.
 */
function renderMarkSegments(
  text: string,
  resolved: readonly ResolvedMark[],
  linkMode: LinkMode,
  base: number,
): ReactNode {
  const segments = segmentText(text, resolved);
  return segments.map((segment) => {
    let child: ReactNode = segment.text;
    // Innermost first: sort so the outermost (lowest-rank) mark wraps last.
    const ordered = [...segment.marks].sort(
      (a, b) => markNestingRank(b.kind) - markNestingRank(a.kind),
    );
    for (const mark of ordered) {
      child = wrapMark(
        mark,
        child,
        `${base + segment.from}:${mark.id}`,
        linkMode,
      );
    }
    return (
      <span
        data-engine-segment={`${base + segment.from}-${base + segment.to}`}
        key={base + segment.from}
      >
        {child}
      </span>
    );
  });
}

/** Clamp resolved marks to a `[from, to)` slice of the leaf and re-base them to slice-local offsets. */
function clampResolvedMarks(
  resolved: readonly ResolvedMark[],
  from: number,
  to: number,
): ResolvedMark[] {
  const out: ResolvedMark[] = [];
  for (const mark of resolved) {
    if (mark.from >= to || mark.to <= from) continue;
    out.push({
      ...mark,
      from: Math.max(0, mark.from - from),
      to: Math.min(to - from, mark.to - from),
    });
  }
  return out;
}

/**
 * Render a text leaf as live track-changes during review (docs/039 R-T1, §6.2, P4c) — the editable
 * half of the woven text diff. Drives off the SHARED `partitionTextRuns` (so "which chars are
 * inserted / deleted / kept" matches the reader diff view exactly), then builds the EDITOR-specific
 * spans:
 *
 * - a `keep` / `insert` run IS in the live store text, so it renders as real (editable) content with
 *   its marks — an `insert` wrapped in `data-engine-review-op="insert"` (wash + underline), a `keep`
 *   under a changed mark tagged `data-engine-review-op="mark"` (dotted underline);
 * - a `delete` run is NOT in the store, so it renders as an inert `data-engine-ghost-run` span carrying
 *   the base text struck through — display only.
 *
 * The load-bearing invariant (docs/039 R-T1): `geometry.ts`'s text-node walk SKIPS a `ghost-run` span,
 * so "concat of counted text nodes == store text" still holds and every caret/click past a deletion
 * lands on the right store offset. The leaf must be off the flat-text fast path when this runs (the
 * `text-block.tsx` gate), because it renders element spans, not a bare text node.
 */
export function renderReviewLeafMarks(
  node: TextLeafNode,
  textDiff: Parameters<typeof partitionTextRuns>[0],
  linkMode: LinkMode = "inert",
): ReactNode {
  const resolved = resolveLeafMarks(node);
  const out: ReactNode[] = [];
  partitionTextRuns(textDiff).forEach((slice, index) => {
    if (slice.op === "delete") {
      out.push(
        <span
          aria-hidden="true"
          contentEditable={false}
          data-engine-ghost-run=""
          key={`d.${index}`}
        >
          {slice.text}
        </span>,
      );
      return;
    }
    // keep / insert: live text, rendered with the slice's own marks (target-space).
    const from = slice.targetOffset;
    const to = from + slice.text.length;
    const inner = renderMarkSegments(
      slice.text,
      clampResolvedMarks(resolved, from, to),
      linkMode,
      from,
    );
    const op =
      slice.op === "insert" ? "insert" : slice.markChanged ? "mark" : null;
    out.push(
      op ? (
        <span data-engine-review-op={op} key={`${slice.op}.${index}`}>
          {inner}
        </span>
      ) : (
        <span key={`k.${index}`}>{inner}</span>
      ),
    );
  });
  return out;
}

/**
 * Whether a leaf renders any marks (drives the typing fast-path opt-out). Uses
 * the resolved marks so a leaf carrying only collapsed/empty ranges still takes
 * the fast path — it renders as a bare text node, matching `renderLeafMarks`.
 */
export function leafHasMarks(node: TextLeafNode): boolean {
  return resolveLeafMarks(node).length > 0;
}
