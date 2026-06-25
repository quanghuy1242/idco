/**
 * Dismiss a click-opened `mark` surface when the user moves the selection off its mark
 * (docs/029 R1-G).
 *
 * A mark form/card (the link editor, the glossary read card) is a focus-`taking` surface, so
 * while it is open the §3b rule suppresses the ambient selection flyout (no format bar over the
 * mark you are editing). That is correct *only while the user is actually on that mark*. Clicking
 * a link selects its range and opens the form; if the user then makes a *new* selection in the
 * document, the form is stale and must close so the flyout can serve the new selection.
 *
 * The distinguishing signal is the model selection: a `taking` surface owns DOM focus, so
 * editing its own fields does not change the model selection (it survives focus loss, docs/011
 * §8.6); only a real editing gesture does. So the surface captures the selection signature at
 * open and dismisses the instant it changes. Captured once per mount (the `dismiss` callback is
 * read through a ref so a fresh `ctx` each render does not reset the capture).
 */
import { useEffect, useRef } from "react";
import type { EditorStore } from "../../core";

/** The current text-selection signature, or null when there is no text selection. */
function selectionSignature(store: EditorStore): string | null {
  const sel = store.selection;
  if (sel?.type !== "text") return null;
  return `${sel.anchor.node}:${sel.anchor.offset}-${sel.focus.node}:${sel.focus.offset}`;
}

/** Dismiss `dismiss()` when the model selection changes from what it was at mount. */
export function useDismissWhenSelectionLeaves(
  store: EditorStore,
  dismiss: () => void,
): void {
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useEffect(() => {
    const initial = selectionSignature(store);
    return store.subscribeSelection(() => {
      if (selectionSignature(store) !== initial) dismissRef.current();
    });
  }, [store]);
}
