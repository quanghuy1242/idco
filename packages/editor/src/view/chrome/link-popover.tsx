/**
 * Click-to-edit link popover (docs/010 Phase 8 AC9; legacy floating-link-editor parity),
 * migrated onto the overlay authority as a `mark`-target form (docs/029 R1-G).
 *
 * In the editor the link mark renders as an inert `<a>` (mark-render.tsx) — the engine owns
 * clicks, the anchor never navigates. A click on a `[data-engine-mark='link']` is *probed*
 * ({@link probeLinkMark}) into the mark's `{ nodeId, markId }` and its model range is selected
 * (so the toolbar + the `set-link`/`clear-link` commands have a range to act on), then the
 * authority opens the registered `mark.link` contributor over it (`openMark`). The form is a
 * focus-`taking` envelope: the authority owns its focus (the layer autofocuses the field),
 * positioning (anchored to the mark's rect), and dismissal (outside press / Escape) — so the
 * old `AnchoredPopover` with `isNonModal` + `autoFocus` and the `useLinkInteraction` hook are
 * gone. Selecting the range while the form is open does not raise the format flyout: a taking
 * off-text-flow surface suppresses the ambient selection bar (overlay-authority §3b).
 */
import { useEffect, useState } from "react";
import { Button, Input } from "@quanghuy1242/idco-ui";
import {
  pointAtOffset,
  resolveLeafMarks,
  safeHref,
  type EditorStore,
  type NodeId,
} from "../../core";
import {
  registerOverlay,
  type MarkProbe,
  type OverlaySurfaceContext,
} from "../spi";
import { useDismissWhenSelectionLeaves } from "./use-mark-surface-dismiss";

/**
 * Resolve a clicked element to the link mark under it and select that mark's range on the
 * model, returning the {@link MarkProbe} to open (or null when the click was not on a link).
 * The range selection is what makes `set-link`/`clear-link` operate on the whole link
 * (`compileLink` needs a non-collapsed range); it runs *before* `openMark` so the first
 * reconcile already sees the taking form + the selection and suppresses the format flyout.
 */
export function probeLinkMark(
  store: EditorStore,
  element: HTMLElement,
): MarkProbe | null {
  const anchor = element.closest<HTMLElement>("[data-engine-mark='link']");
  if (!anchor) return null;
  const leafEl = anchor.closest<HTMLElement>("[data-engine-text-id]");
  const nodeId = leafEl?.getAttribute("data-engine-text-id") as NodeId | null;
  const markId = anchor.getAttribute("data-engine-mark-id");
  if (!nodeId || !markId) return null;
  const node = store.getNode(nodeId);
  if (!node || node.kind !== "text") return null;
  const mark = resolveLeafMarks(node).find(
    (candidate) => candidate.id === markId && candidate.kind === "link",
  );
  if (!mark) return null;
  // Select the whole link range on the model so the toolbar reflects it and Apply/Remove
  // (set-link/clear-link) have a range to operate on (docs/010 Phase 8 AC9).
  store.dispatch({
    origin: "local",
    selectionAfter: {
      anchor: pointAtOffset(nodeId, node.content, mark.from),
      focus: pointAtOffset(nodeId, node.content, mark.to),
      type: "text",
    },
    steps: [],
  });
  return { kind: "link", markId, nodeId };
}

/** The href stored on a link mark (by node + mark id), or "" when it is gone. */
function hrefOfMark(
  store: EditorStore,
  nodeId: NodeId,
  markId: string,
): string {
  const node = store.getNode(nodeId);
  if (!node || node.kind !== "text") return "";
  const mark = resolveLeafMarks(node).find(
    (candidate) => candidate.id === markId && candidate.kind === "link",
  );
  return typeof mark?.attrs?.href === "string" ? mark.attrs.href : "";
}

/** The link edit form body — the `mark.link` contributor's render (docs/029 R1-G). */
function LinkForm(props: { readonly ctx: OverlaySurfaceContext }) {
  const { ctx } = props;
  const { store } = ctx;
  const anchor = ctx.anchor;
  const seed =
    anchor?.kind === "mark"
      ? hrefOfMark(store, anchor.nodeId, anchor.markId)
      : "";
  const [value, setValue] = useState(seed);
  // Re-seed when a different link opens (the surface identity changes per mark id).
  useEffect(() => {
    setValue(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor?.kind === "mark" ? anchor.markId : null]);
  // Close when the user selects elsewhere (the link's range was selected on open, so any change
  // means they navigated away); this lets the ambient flyout serve the new selection (docs/029
  // R1-G — the §3b flyout suppression only applies while this form is genuinely on its mark).
  useDismissWhenSelectionLeaves(store, ctx.dismiss);

  const openHref = safeHref(value);

  const apply = () => {
    const href = value.trim();
    if (href.length > 0) store.command({ href, type: "set-link" });
    else store.command({ type: "clear-link" });
    ctx.dismiss();
    ctx.focusEditor();
  };

  return (
    <form
      className="grid w-72 gap-2"
      data-engine-link-popover=""
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <span className="text-xs font-medium opacity-70">Link URL</span>
      <Input
        ariaLabel="Link URL"
        onChange={setValue}
        placeholder="https://example.com"
        size="sm"
        type="url"
        value={value}
      />
      <div className="flex items-center justify-between gap-2">
        {openHref ? (
          <Button
            ariaLabel="Open link"
            iconName="ExternalLink"
            onClick={() =>
              window.open(openHref, "_blank", "noopener,noreferrer")
            }
            size="sm"
            variant="ghost"
          >
            Open
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button
            ariaLabel="Remove link"
            onClick={() => {
              store.command({ type: "clear-link" });
              ctx.dismiss();
              ctx.focusEditor();
            }}
            size="sm"
            variant="ghost"
          >
            Remove
          </Button>
          <Button
            ariaLabel="Apply link"
            size="sm"
            type="submit"
            variant="primary"
          >
            Apply
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Register the click-to-edit link overlay (idempotent by id). */
export function registerLinkOverlay(): void {
  registerOverlay({
    contentKind: "form",
    focusMode: "taking",
    id: "mark.link",
    match: (probe) => probe.kind === "link",
    render: (ctx) => <LinkForm ctx={ctx} />,
    target: "mark",
  });
}
