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
import { useEffect, useRef, type RefObject } from "react";

/**
 * Autofocus the first field within `ref` once, on open. The selection-flyout's child
 * command popovers (Add a comment / Add to glossary) are **non-modal** (popover.tsx — a
 * modal popover rendered a body overlay that blocked the input, so it was made non-modal).
 * A non-modal React Aria popover neither traps nor auto-grabs focus, and the bare `Input`'s
 * `autoFocus` does not survive React Aria's focus settle there — so focus is set explicitly.
 * `requestAnimationFrame` defers to *after* React Aria's own on-open focus handling, so the
 * field is the one that ends up focused and typing starts immediately. Verified by
 * `tests/e2e/engine-flyout-popover.spec.ts`.
 */
export function useAutoFocusWithin(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      ref.current?.querySelector<HTMLElement>("input, textarea")?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [ref]);
}

export function useScrollToFocus(focusId: string | undefined) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!focusId || !ref.current) return;
    const row = ref.current.querySelector(`[data-focus-key="${focusId}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [focusId]);
  return ref;
}
