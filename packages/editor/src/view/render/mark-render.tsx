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

/** Annotation marks (comment/glossary) render as an id-carrying span. */
function renderAnnotationMark({ mark, child, key }: MarkRenderArgs): ReactNode {
  return (
    <span key={key} data-engine-mark={mark.kind} data-engine-mark-id={mark.id}>
      {child}
    </span>
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
  { kind: "link", nestingRank: 0, render: renderLinkMark },
  { kind: "comment", nestingRank: 1, render: renderAnnotationMark },
  { kind: "glossary", nestingRank: 2, render: renderAnnotationMark },
];

let builtInMarksRegistered = false;

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
  const segments = segmentText(text, resolved);
  return segments.map((segment) => {
    let child: ReactNode = segment.text;
    // Innermost first: sort so the outermost (lowest-rank) mark wraps last.
    const ordered = [...segment.marks].sort(
      (a, b) => markNestingRank(b.kind) - markNestingRank(a.kind),
    );
    for (const mark of ordered) {
      child = wrapMark(mark, child, `${segment.from}:${mark.id}`, linkMode);
    }
    return (
      <span
        data-engine-segment={`${segment.from}-${segment.to}`}
        key={segment.from}
      >
        {child}
      </span>
    );
  });
}

/**
 * Whether a leaf renders any marks (drives the typing fast-path opt-out). Uses
 * the resolved marks so a leaf carrying only collapsed/empty ranges still takes
 * the fast path — it renders as a bare text node, matching `renderLeafMarks`.
 */
export function leafHasMarks(node: TextLeafNode): boolean {
  return resolveLeafMarks(node).length > 0;
}
