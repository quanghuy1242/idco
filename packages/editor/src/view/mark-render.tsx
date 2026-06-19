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
import type { ReactNode } from "react";
import type { ResolvedMark, TextLeafNode, TextMarkKind } from "../core";
import { resolveLeafMarks, safeHref, segmentText } from "../core";

/** Stable nesting order so overlapping marks render to a deterministic tree. */
const MARK_NESTING_ORDER: readonly TextMarkKind[] = [
  "link",
  "comment",
  "glossary",
  "highlight",
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "subscript",
  "superscript",
  "code",
];

function markRank(kind: TextMarkKind): number {
  const index = MARK_NESTING_ORDER.indexOf(kind);
  return index === -1 ? MARK_NESTING_ORDER.length : index;
}

function markHref(mark: ResolvedMark): string {
  const href = mark.attrs?.href;
  return typeof href === "string" ? href : "";
}

/**
 * Wrap `child` in the semantic element for one mark kind. Links carry their href
 * and are inert inside the editor (the engine owns clicks; navigation is the
 * reader's job), so the anchor cannot steal focus or follow on mousedown.
 */
/** Whether links navigate (reader) or are inert (the editor owns clicks). */
export type LinkMode = "inert" | "navigable";

function wrapMark(
  mark: ResolvedMark,
  child: ReactNode,
  key: string,
  linkMode: LinkMode,
): ReactNode {
  const common = { "data-engine-mark": mark.kind, key };
  switch (mark.kind) {
    case "bold":
      return <strong {...common}>{child}</strong>;
    case "italic":
      return <em {...common}>{child}</em>;
    case "underline":
      return <u {...common}>{child}</u>;
    case "strikethrough":
      return <s {...common}>{child}</s>;
    case "code":
      return <code {...common}>{child}</code>;
    case "highlight":
      return <mark {...common}>{child}</mark>;
    case "subscript":
      return <sub {...common}>{child}</sub>;
    case "superscript":
      return <sup {...common}>{child}</sup>;
    case "link":
      // In the editor the link is inert: no `href` (so a click never navigates
      // away from the editing surface) and mousedown is suppressed so it cannot
      // steal focus from the EditContext host. The reader renders a real link.
      return (
        <a
          {...common}
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
    case "comment":
    case "glossary":
      return (
        <span {...common} data-engine-mark-id={mark.id}>
          {child}
        </span>
      );
  }
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
      (a, b) => markRank(b.kind) - markRank(a.kind),
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
