/**
 * Reveal a routed-to row in a dock pane (docs/027 §16 P6).
 *
 * When an annotation is clicked and "Open in Glossary/Comments" routes to the dock
 * with a `focusId`, the pane must scroll the matching row into view (and ring it; the
 * ring is a literal class on the row so Tailwind generates it). This hook owns only
 * the scroll: it returns a container ref, and on every `focusId` change finds the row
 * tagged `data-focus-key` and scrolls it into view. The highlight is left to the pane
 * (a conditional class), so nothing is applied imperatively that the build can't see.
 */
import { useEffect, useRef } from "react";

// `useAutoFocusWithin` was deleted in docs/029 R1-G: every form now renders inside the
// overlay authority's `form`/`taking` envelope, whose focus policy (overlay-layer.tsx,
// docs/029 §7.1) autofocuses the first field deterministically after layout — so no per-form
// autofocus hook is needed.

export function useScrollToFocus(focusId: string | undefined) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!focusId || !ref.current) return;
    const row = ref.current.querySelector(`[data-focus-key="${focusId}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [focusId]);
  return ref;
}
