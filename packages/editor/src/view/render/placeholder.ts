/**
 * Empty-document placeholder context (R2, note.md §5.8).
 *
 * A borderless full-page editor that is visually empty gives the author no signal
 * it is editable, so — like Notion/Docs/the GitHub composer — the engine paints a
 * muted hint in the first block while the document is empty. The hint must respect
 * the painted-overlay caret architecture: it is painted *inside* the leaf as an
 * `aria-hidden`, `pointer-events:none`, non-selectable layer that does not enter
 * the text flow, so it never competes with the engine's caret/selection overlay or
 * with text measurement (`offsetFromClientPoint`/`caretClientRect` read the host's
 * real text nodes, not this layer).
 *
 * The view (not the leaf) decides *which* block is the placeholder slot, because
 * "the document is empty" is a structural fact (one block in body order) the leaf
 * cannot see alone. The view publishes `{ text, targetId }` here; the leaf paints
 * the hint only when it is the target AND its own live text is empty. That split
 * keeps the hint reactive on both axes: the view re-renders on a structural change
 * (a split clears `targetId`), the leaf re-renders on a text change (the first
 * keystroke clears the hint, a delete-back-to-empty restores it).
 */
import { createContext, useContext } from "react";
import type { NodeId } from "../../core";

/** The active placeholder hint and the single block allowed to paint it, or null. */
export type PlaceholderContextValue = {
  /** The muted hint text to paint in the empty block. */
  readonly text: string;
  /** The block that may paint the hint (the empty document's only block), or null. */
  readonly targetId: NodeId | null;
} | null;

const PlaceholderContext = createContext<PlaceholderContextValue>(null);

/** Provider the view wraps the block list with to publish the placeholder slot. */
export const PlaceholderProvider = PlaceholderContext.Provider;

/** Read the active placeholder hint + target block from a text leaf. */
export function usePlaceholder(): PlaceholderContextValue {
  return useContext(PlaceholderContext);
}
