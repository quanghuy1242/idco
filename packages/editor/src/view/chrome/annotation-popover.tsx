/**
 * Click-to-read glossary popover (docs/027 §16 P6), migrated onto the overlay authority as a
 * `mark`-target *card* (docs/029 R1-G).
 *
 * Glossary marks are *word-sized*, so click-to-read is natural — a dictionary card over the
 * word — and it does not fight ordinary caret placement. Comment marks are *large ranges*, so
 * they use a caret-in-range affordance (`comment-affordance.tsx`) instead; this module handles
 * only the glossary (word) case. A click on the `<abbr>` is probed ({@link
 * probeAnnotationMark}) into the mark's `{ nodeId, markId }` and the authority opens the
 * registered `mark.glossary` contributor over it (`openMark`). The card is focus-`taking`
 * (a11y: focus moves to the readable popover) but content-kind `card`, so the overlay layer
 * does *not* autofocus a field (there is none) — exactly the §8.5 distinction. The authority
 * owns positioning (the mark's rect), focus, and dismissal, so the old `AnchoredPopover` with
 * `isNonModal` and the `useAnnotationInteraction` hook are gone.
 */
import { Button } from "@quanghuy1242/idco-ui";
import { resolveLeafMarks, type EditorStore, type NodeId } from "../../core";
import {
  registerOverlay,
  type MarkProbe,
  type OverlaySurfaceContext,
} from "../spi";
import { asGlossaryTerm, GLOSSARY_COLLECTION } from "./panes";
import { useDismissWhenSelectionLeaves } from "./use-mark-surface-dismiss";

/**
 * Resolve a clicked element to the glossary mark under it (docs/027 §16 P6), returning the
 * {@link MarkProbe} to open or null when the click was not on a glossary word. Pure DOM: the
 * `<abbr>` carries `data-engine-mark-id` (anchor rect) + `data-engine-glossary-term` and sits
 * under a `data-engine-text-id` leaf. Comment marks are intentionally not claimed here (they
 * route through the caret affordance), so a click on a comment-only span returns null.
 */
export function probeAnnotationMark(element: HTMLElement): MarkProbe | null {
  const glossaryEl = element.closest<HTMLElement>(
    "[data-engine-mark='glossary']",
  );
  if (!glossaryEl) return null;
  const markId = glossaryEl.getAttribute("data-engine-mark-id");
  const leafEl = glossaryEl.closest<HTMLElement>("[data-engine-text-id]");
  const nodeId = leafEl?.getAttribute("data-engine-text-id") as NodeId | null;
  if (!markId || !nodeId) return null;
  return { kind: "glossary", markId, nodeId };
}

/** The term id a glossary mark references (its `attrs.term`), or null when the mark is gone. */
function termIdOfMark(
  store: EditorStore,
  nodeId: NodeId,
  markId: string,
): string | null {
  const node = store.getNode(nodeId);
  if (!node || node.kind !== "text") return null;
  const mark = resolveLeafMarks(node).find(
    (candidate) => candidate.id === markId && candidate.kind === "glossary",
  );
  return typeof mark?.attrs?.term === "string" ? mark.attrs.term : null;
}

/** The glossary read card body — the `mark.glossary` contributor's render (docs/029 R1-G). */
export function GlossaryReadCard(props: {
  readonly ctx: OverlaySurfaceContext;
}) {
  const { ctx } = props;
  const { store } = ctx;
  const anchor = ctx.anchor;
  // Close when the user starts selecting/editing elsewhere (the read card is stale then),
  // letting the ambient flyout take over (docs/029 R1-G).
  useDismissWhenSelectionLeaves(store, ctx.dismiss);
  const refId =
    anchor?.kind === "mark"
      ? termIdOfMark(store, anchor.nodeId, anchor.markId)
      : null;
  const term = refId
    ? store
        .getCollection(GLOSSARY_COLLECTION)
        .map(asGlossaryTerm)
        .find((candidate) => candidate.id === refId)
    : undefined;
  return (
    <div className="grid w-72 gap-1" data-engine-annotation-popover="glossary">
      <span className="text-sm font-semibold">{term?.term ?? "Term"}</span>
      <p className="text-sm text-base-content/80">
        {term?.definition || "No definition yet."}
      </p>
      <div className="flex justify-end">
        <Button
          iconName="BookA"
          onClick={() => {
            if (refId) ctx.panelHost?.open("glossary", refId);
            ctx.dismiss();
          }}
          size="sm"
          variant="ghost"
        >
          Open in Glossary
        </Button>
      </div>
    </div>
  );
}

/** Register the click-to-read glossary overlay (idempotent by id). */
export function registerAnnotationOverlay(): void {
  registerOverlay({
    contentKind: "card",
    focusMode: "taking",
    id: "mark.glossary",
    match: (probe) => probe.kind === "glossary",
    render: (ctx) => <GlossaryReadCard ctx={ctx} />,
    target: "mark",
  });
}
