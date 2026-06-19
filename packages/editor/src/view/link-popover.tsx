/**
 * Click-to-edit link popover (docs/010 Phase 8 AC9; legacy floating-link-editor
 * parity).
 *
 * In the editor the link mark renders as an inert `<a>` (mark-render.tsx) — the
 * engine owns clicks, the anchor never navigates. The legacy Lexical editor
 * answered a click on a link by floating a small editor over it (open / edit /
 * unlink); this restores that affordance on the owned-model surface.
 *
 * Flow: a click that lands on a `[data-engine-mark='link']` resolves the leaf and
 * the exact mark (by its `data-engine-mark-id`), selects the link's range on the
 * *model* (so the toolbar and the Apply/Remove commands operate on it), and opens
 * an anchored React Aria popover built from `@idco/ui`. Editing goes through the
 * same `set-link`/`clear-link` commands the toolbar uses, never the DOM.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { AnchoredPopover, Button, Input } from "@quanghuy1242/idco-ui";
import {
  pointAtOffset,
  resolveLeafMarks,
  safeHref,
  type EditorStore,
  type NodeId,
} from "../core";

type LinkTarget = {
  readonly node: NodeId;
  readonly markId: string;
  readonly href: string;
};

export type LinkInteraction = {
  readonly target: LinkTarget | null;
  readonly anchorRef: RefObject<HTMLElement | null>;
  /** Resolve and open the link under `element`; returns true when one was found. */
  openAt(element: HTMLElement): boolean;
  close(): void;
};

/** Track which link (if any) the user clicked and the element to anchor against. */
export function useLinkInteraction(store: EditorStore): LinkInteraction {
  const anchorRef = useRef<HTMLElement | null>(null);
  const [target, setTarget] = useState<LinkTarget | null>(null);

  const openAt = useCallback(
    (element: HTMLElement): boolean => {
      const anchor = element.closest(
        "[data-engine-mark='link']",
      ) as HTMLElement | null;
      if (!anchor) return false;
      const leafEl = anchor.closest(
        "[data-engine-text-id]",
      ) as HTMLElement | null;
      const nodeId = leafEl?.getAttribute(
        "data-engine-text-id",
      ) as NodeId | null;
      const markId = anchor.getAttribute("data-engine-mark-id");
      if (!nodeId || !markId) return false;
      const node = store.getNode(nodeId);
      if (!node || node.kind !== "text") return false;
      const mark = resolveLeafMarks(node).find(
        (candidate) => candidate.id === markId && candidate.kind === "link",
      );
      if (!mark) return false;
      const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
      // Select the whole link range on the model so the toolbar reflects it and
      // Apply/Remove (set-link/clear-link) have a range to operate on.
      store.dispatch({
        origin: "local",
        selectionAfter: {
          anchor: pointAtOffset(nodeId, node.content, mark.from),
          focus: pointAtOffset(nodeId, node.content, mark.to),
          type: "text",
        },
        steps: [],
      });
      anchorRef.current = anchor;
      setTarget({ href, markId, node: nodeId });
      return true;
    },
    [store],
  );

  const close = useCallback(() => setTarget(null), []);
  return { anchorRef, close, openAt, target };
}

export function LinkPopover(props: {
  readonly store: EditorStore;
  readonly interaction: LinkInteraction;
  readonly focusEditor: () => void;
}) {
  const { store, interaction, focusEditor } = props;
  const { target, anchorRef, close } = interaction;
  const [value, setValue] = useState("");

  // Seed the field from the link each time a new link opens.
  useEffect(() => {
    if (target) setValue(target.href);
  }, [target]);

  // The popover is rendered unconditionally and toggled via `isOpen` (not removed
  // when `target` clears), so React Aria can play the exit animation before
  // unmounting. The content reads `value` (not `target`), so it still renders
  // during the close transition after `target` becomes null. When closed, React
  // Aria renders nothing.
  const openHref = safeHref(value);

  const apply = () => {
    const href = value.trim();
    if (href.length > 0) store.command({ href, type: "set-link" });
    else store.command({ type: "clear-link" });
    close();
    focusEditor();
  };

  return (
    <AnchoredPopover
      ariaLabel="Edit link"
      isOpen={target !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      placement="bottom"
      triggerRef={anchorRef}
    >
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
          autoFocus
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
                close();
                focusEditor();
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
    </AnchoredPopover>
  );
}
