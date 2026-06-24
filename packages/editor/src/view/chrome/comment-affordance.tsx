/**
 * The comment caret affordance (docs/027 §16 P6, the run-through refinement).
 *
 * Why this exists instead of click-to-open: a comment mark spans a *large* range, so
 * clicking inside it is ordinary caret placement, not "open the thread" — making the
 * range a click target hijacked editing (the reported annoyance). Glossary marks are
 * word-sized and keep click-to-read (`annotation-popover.tsx`); comments instead get a
 * small, non-intrusive affordance: when a collapsed caret lands inside a commented
 * range, a "Comment" chip appears anchored at that comment's highlight, and clicking it
 * routes straight to the dock focused on the thread. The text stays freely clickable,
 * and because it is caret-driven it works on touch (a tap places the caret) without a
 * hover. Threads are long, so it routes to the dock rather than opening a popover.
 *
 * Collapsed-caret only: a non-collapsed selection shows the formatting flyout, so the
 * two never overlap. Reads the DOM at render for the anchor rect, the same way the
 * selection flyout does — re-evaluated on every selection/commit through `useStoreVersion`.
 */
import { Button } from "@quanghuy1242/idco-ui";
import {
  resolveBoundaryOffset,
  type EditorStore,
  type TextLeafNode,
} from "../../core";
import type { PanelHost } from "../spi";
import { useStoreVersion } from "./surfaces";

/** The comment thread + mark under a collapsed caret, or null. */
export function caretCommentHit(
  store: EditorStore,
): { readonly threadId: string; readonly markId: string } | null {
  const sel = store.selection;
  if (sel?.type !== "text") return null;
  // Collapsed caret only — a range shows the formatting flyout instead.
  if (
    sel.anchor.node !== sel.focus.node ||
    sel.anchor.offset !== sel.focus.offset
  ) {
    return null;
  }
  const leaf = store.getNode(sel.focus.node);
  if (leaf?.kind !== "text") return null;
  const caret = sel.focus.offset;
  for (const mark of (leaf as TextLeafNode).marks) {
    if (mark.kind !== "comment") continue;
    const from = resolveBoundaryOffset(leaf.content, mark.from);
    const to = resolveBoundaryOffset(leaf.content, mark.to);
    if (caret >= from && caret <= to) {
      const thread = mark.attrs?.thread;
      if (typeof thread === "string")
        return { markId: mark.id, threadId: thread };
    }
  }
  return null;
}

export function CommentAffordance(props: {
  readonly store: EditorStore;
  readonly panelHost: PanelHost;
}) {
  const { store, panelHost } = props;
  // Re-evaluate on every selection/commit (the flyout's subscription).
  useStoreVersion(store);
  const hit = caretCommentHit(store);
  // Anchor to the comment's own highlight span (stable while the caret stays in this
  // comment, unlike following the caret), placed just above its first line.
  const rect = hit
    ? document
        .querySelector(`[data-engine-mark-id="${hit.markId}"]`)
        ?.getBoundingClientRect()
    : undefined;
  if (!hit || !rect) return null;

  return (
    <div
      className="fixed z-40"
      data-engine-comment-affordance=""
      style={{ left: rect.left, top: Math.max(4, rect.top - 30) }}
    >
      <Button
        ariaLabel="Open comment"
        iconName="MessageSquare"
        // Route straight to the dock focused on this thread (docs/027 §16 P6): a
        // thread is long, so the Comments pane is the better reading surface.
        onClick={() => panelHost.open("comments", hit.threadId)}
        size="sm"
        tooltip="Open comment"
        variant="primary"
      >
        Comment
      </Button>
    </div>
  );
}
