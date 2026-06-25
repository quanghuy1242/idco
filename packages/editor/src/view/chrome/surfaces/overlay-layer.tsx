/**
 * The overlay render layer (docs/029 §4.7D / §7.4, R1-C) — the single generic renderer for
 * the overlay authority's resolved envelopes. It owns the **transform-free portal layer**
 * (one stacking context the authority controls), resolves each envelope's anchor to a
 * viewport rect (`resolveAnchorRect`), positions all envelopes together with collision
 * avoidance (`solveOverlayPlacements`), registers each surface element in the ownership
 * registry (so containment is ownership, not DOM ancestry), and applies the per-content-kind
 * focus policy that replaces the ad-hoc `useAutoFocusWithin` (docs/029 §7.1: a `form` takes
 * focus and autofocuses its first field; a `transparent` surface never grabs focus).
 *
 * There is no per-surface branch here — adding a surface is registering a contributor, never
 * editing this file (docs/029 §4.7D). React Aria behavior lives *inside* each slot/panel
 * (the contributor's `render` returns RA Menu / Dialog / Toolbar content); this layer owns
 * only position, stacking, ownership, and focus policy *around* it.
 *
 * Live since the Phase 2/3 migration (docs/029 §6.1): the editing view mounts this layer
 * (via `SelectionSurfaceHost`) and it renders every authority-owned surface. Projected slots
 * (`contributor.projects`) render through `OverlayContent`'s projection renderer (the merged
 * selection bar); `render`-bearing forms/cards/panels render their own body.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  POPOVER_SURFACE_CLASS,
  UNSAFE_PortalProvider,
} from "@quanghuy1242/idco-ui";
import type { EditorStore } from "../../../core";
import type { OffsetModel } from "../../../core/offset-model";
import { resolveAnchorRect, type ScrollerGeometry } from "../../overlays";
import {
  solveOverlayPlacements,
  useOverlayAuthority,
  type EnvelopePlacement,
  type OverlayAuthority,
  type OverlayAuthorityRef,
  type PanelHost,
  type ResolvedEnvelope,
  type ToolbarCapabilities,
} from "../../spi";
import { OverlayContent } from "./overlay-content";

/** The reserved ownership-registry id for the overlay-layer container itself (docs/029 §7.4):
 *  registering it makes `ownership.isWithin` recognize any press inside the editor's overlay
 *  world — including nested React Aria overlays routed here by `UNSAFE_PortalProvider` — so the
 *  authority does not mistake a press on a portaled dropdown option for an outside press. */
const OVERLAY_LAYER_OWNERSHIP_ID = "__overlay_layer__";

/** Warn in dev if the portal layer carries a transform — it breaks `fixed` positioning. */
function assertTransformFree(el: HTMLElement): void {
  if (
    typeof process !== "undefined" &&
    process.env?.NODE_ENV === "production"
  ) {
    return;
  }
  const view = el.ownerDocument.defaultView;
  const transform = view?.getComputedStyle(el).transform;
  // The portal layer must establish no transformed containing block, or `position: fixed`
  // resolves against it instead of the viewport and every overlay is mis-placed (docs/029
  // §7.4). jsdom returns "" for transform; only a real "matrix(...)" is a violation.
  if (transform && transform !== "none") {
    // eslint-disable-next-line no-console
    console.warn(
      "[overlay-layer] portal layer must be transform-free (docs/029 §7.4); found:",
      transform,
    );
  }
}

/** Create (once) the transform-free portal container appended to `document.body`. */
function usePortalContainer(): HTMLElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const div = document.createElement("div");
    div.setAttribute("data-engine-overlay-layer", "");
    // `display: contents` (docs/029 §7.4): the layer generates no box of its own, so it
    // establishes no containing block and no stacking context — each `position: fixed`
    // envelope box inside resolves directly against the viewport (a `position: fixed`
    // *wrapper* would otherwise become the boxes' containing block in some engines and
    // mis-place / mis-hit-test them). It is a pure grouping node (for the dev-assert + a
    // stable mount point); z-order is each box's own `z-index`, not the layer's.
    div.style.display = "contents";
    document.body.appendChild(div);
    assertTransformFree(div);
    setContainer(div);
    return () => {
      div.remove();
    };
  }, []);
  return container;
}

/** One positioned envelope box: ownership registration + focus policy + content. */
function EnvelopeBox(props: {
  readonly envelope: ResolvedEnvelope;
  readonly placement: EnvelopePlacement | undefined;
  readonly authority: OverlayAuthority;
  readonly onMeasure: (
    id: string,
    size: { width: number; height: number },
  ) => void;
  /** True once the surface has been dismissed: the box plays the exit animation, then unmounts. */
  readonly exiting: boolean;
  /** Called when the exit animation finishes (or its fallback timer fires), to unmount the box. */
  readonly onExited: (id: string) => void;
}): ReactNode {
  const { envelope, placement, authority, onMeasure, exiting, onExited } =
    props;
  const ref = useRef<HTMLDivElement | null>(null);
  // Drive the exit: when `exiting` flips true the box plays `animate-popover-out` in place
  // (frozen at its last placement), then the parent unmounts it on `onAnimationEnd`. A fallback
  // timer covers the case where no animation runs (prefers-reduced-motion → no `animationend`),
  // so a closing surface can never get stuck mounted.
  useEffect(() => {
    if (!exiting) return undefined;
    const t = setTimeout(() => onExited(envelope.id), 220);
    return () => clearTimeout(t);
  }, [exiting, envelope.id, onExited]);
  // Until the box has been measured once, the central solve only has a zero size, so the first
  // frame would paint it at the anchor and the second (measured) frame would snap it to its real
  // placement — a visible jump on every open (the symptom the selection-form open shows). Gate
  // visibility on the first measure so the box appears once, already placed (docs/029 §7.4); the
  // entrance animation then plays from the correct spot.
  const [measured, setMeasured] = useState(false);

  // Containment by ownership (docs/029 §7.4): register this surface's element so a press can
  // be tested as "inside me or a descendant overlay" without a `closest("[data-engine-*]")`.
  useEffect(() => {
    authority.ownership.register(envelope.id, ref.current, null);
    return () => authority.ownership.unregister(envelope.id);
  }, [authority, envelope.id]);

  // Measure for the central positioning solve (the layer re-solves with the real size), and flip
  // `measured` so the placed box becomes visible. setState in a layout effect re-renders before
  // paint, so the user never sees the pre-measure frame.
  useLayoutEffect(() => {
    // A closing box is frozen at its last size — don't re-measure it (it would perturb the live
    // collision solve as it animates out).
    if (exiting) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    onMeasure(envelope.id, { height: rect.height, width: rect.width });
    setMeasured(true);
  }, [envelope, onMeasure, exiting]);

  // Focus policy (docs/029 §7.1, replaces useAutoFocusWithin): a focus-owning `form`
  // (`taking` or `sticky`) autofocuses its first field deterministically *after* layout; a
  // `transparent`/`card` surface never grabs focus here (the editor keeps it). Runs once per
  // surface identity.
  useEffect(() => {
    if (
      exiting ||
      (envelope.focusMode !== "taking" && envelope.focusMode !== "sticky") ||
      envelope.contentKind !== "form"
    ) {
      return undefined;
    }
    const id = requestAnimationFrame(() => {
      ref.current
        ?.querySelector<HTMLElement>("input, textarea, select")
        ?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [envelope.id, envelope.focusMode, envelope.contentKind, exiting]);

  const ctx = authority.surfaceContext(envelope.target);
  // The box chrome (DaisyUI 5 popover surface) is owned by the layer; the content fills it.
  // Dense padding for the actions bar + menus (button/list rows); roomier for form/card.
  const pad =
    envelope.contentKind === "actions" || envelope.contentKind === "menu"
      ? "p-1"
      : "p-3";
  return (
    <div
      // The DaisyUI popover surface chrome is the one shared `@idco/ui` token
      // (`POPOVER_SURFACE_CLASS`), so authority-owned overlays match every other popover's box
      // and cannot drift from it. Padding varies by content-kind. A controlled box cannot use
      // RA's `data-[entering]/[exiting]` variants, so the animation classes are applied directly:
      // entrance once on first appear (gated by `measured`), exit while `exiting` (the parent's
      // presence layer keeps the box mounted, frozen at its last placement, until it ends).
      className={`${POPOVER_SURFACE_CLASS} ${pad} ${exiting ? "animate-popover-out" : measured ? "animate-popover-in" : ""}`}
      data-engine-overlay={envelope.target}
      onAnimationEnd={exiting ? () => onExited(envelope.id) : undefined}
      ref={ref}
      style={{
        left: placement?.left ?? 0,
        // A closing box must not eat pointer events as it fades (a click should reach what is
        // behind it).
        pointerEvents: exiting ? "none" : "auto",
        position: "fixed",
        top: placement?.top ?? 0,
        visibility: exiting || measured ? "visible" : "hidden",
        zIndex: envelope.z,
      }}
    >
      <OverlayContent authority={authority} ctx={ctx} envelope={envelope} />
    </div>
  );
}

/**
 * The overlay layer (docs/029 §4.7D). Resolves every live envelope's anchor, solves all
 * placements together (collision-avoided), and portals each into the transform-free layer.
 */
export function OverlayLayer(props: {
  readonly authority: OverlayAuthority;
  readonly store: EditorStore;
  /** The shared offset model, so an off-window anchor estimates instead of vanishing. */
  readonly offsetModel?: OffsetModel | null;
  /** The scroller geometry paired with `offsetModel` for the estimate (docs/025). */
  readonly scroller?: ScrollerGeometry | null;
}): ReactNode {
  const { authority, store, offsetModel, scroller } = props;
  const container = usePortalContainer();
  const [sizes, setSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});
  // Exit-animation presence state (see the presence block below). `exitingRef` holds the boxes
  // still animating out, each frozen at its last `{envelope, placement}`; `prevLiveRef` is the
  // previous render's live ids (for the during-render live→exiting diff); `renderBump` forces a
  // re-render when a finished exit box is dropped. The diff runs during render (not in an effect)
  // so a dismissed box keeps its React instance and animates out in place — an effect would
  // unmount it for one frame first, killing the animation.
  const exitingRef = useRef(
    new Map<
      string,
      { envelope: ResolvedEnvelope; placement: EnvelopePlacement }
    >(),
  );
  const [, setRenderBump] = useState(0);
  const cacheRef = useRef(
    new Map<
      string,
      { envelope: ResolvedEnvelope; placement: EnvelopePlacement }
    >(),
  );
  const prevLiveRef = useRef<readonly string[]>([]);

  // Foreign-modal coordination (docs/029 §7.6). A foreign app modal — the theme/confirm
  // dialog, command palette, drawer — opens with React Aria's `ariaHideOutside`, which sets
  // `aria-hidden` on every `document.body` child that is not the modal subtree, including this
  // overlay layer. The authority does not arbitrate foreign modals (they own the page), so when
  // the layer is hidden it dismisses all its envelopes rather than leaving a flyout floating
  // under an inert page; on modal close the attribute clears and ambient surfaces re-raise per
  // their own triggers (§10). One MutationObserver on the layer's own `aria-hidden` is the whole
  // mechanism — no coupling into RA's private overlay stack. `dismissAllRef` keeps the observer
  // subscribed once per container instead of re-subscribing on every authority re-render.
  const dismissAllRef = useRef(authority.dismissAll);
  dismissAllRef.current = authority.dismissAll;
  useEffect(() => {
    if (!container || typeof MutationObserver === "undefined") return undefined;
    const observer = new MutationObserver(() => {
      if (container.getAttribute("aria-hidden") === "true") {
        dismissAllRef.current();
      }
    });
    observer.observe(container, { attributeFilter: ["aria-hidden"] });
    return () => observer.disconnect();
  }, [container]);

  // Register the overlay-layer container in the ownership registry (docs/029 §7.4) so any press
  // inside the editor's overlay world counts as "within" — including the nested React Aria
  // overlays (a config form's Select / ComboBox listbox, a Menu) that the `UNSAFE_PortalProvider`
  // below routes INTO this container instead of `document.body`. Without this, clicking such a
  // portaled option read as an outside press and the authority's dismissal tore the surface down
  // (the "dropdown collapses on a real mouse click" bug). `ownership` is stable across authority
  // re-renders, so a ref keeps this registered once per container, with no churn.
  const ownershipRef = useRef(authority.ownership);
  ownershipRef.current = authority.ownership;
  useEffect(() => {
    if (!container) return undefined;
    const ownership = ownershipRef.current;
    ownership.register(OVERLAY_LAYER_OWNERSHIP_ID, container, null);
    return () => ownership.unregister(OVERLAY_LAYER_OWNERSHIP_ID);
  }, [container]);

  const onMeasure = useRef(
    (id: string, size: { width: number; height: number }) => {
      setSizes((prev) => {
        const current = prev[id];
        if (
          current &&
          current.width === size.width &&
          current.height === size.height
        ) {
          return prev;
        }
        return { ...prev, [id]: size };
      });
    },
  ).current;

  // Resolve anchors; drop envelopes whose anchor cannot be resolved this frame (docs/029
  // §7.4 — a vanished anchor is not positioned at the origin, it is simply not rendered).
  const resolved = authority.envelopes
    .map((envelope) => ({
      envelope,
      rect: resolveAnchorRect(store, envelope.anchor, {
        offsetModel,
        scroller,
      }),
    }))
    .filter(
      (
        entry,
      ): entry is {
        envelope: ResolvedEnvelope;
        rect: NonNullable<typeof entry.rect>;
      } => entry.rect !== null,
    );

  const viewport = {
    height: typeof window !== "undefined" ? window.innerHeight : 0,
    width: typeof window !== "undefined" ? window.innerWidth : 0,
  };
  const placements = solveOverlayPlacements(
    resolved.map(({ envelope, rect }) => ({
      anchor: rect,
      id: envelope.id,
      prefer: envelope.target === "selection" ? "top" : "bottom",
      size: sizes[envelope.id] ?? { height: 0, width: 0 },
      z: envelope.z,
    })),
    viewport,
  );
  const placementById = new Map(placements.map((p) => [p.id, p]));

  // Exit-animation presence (docs/029 §4.7D). The authority drops a dismissed surface from
  // `envelopes` at once, but unmounting its box immediately kills the close animation. So the
  // layer keeps a just-removed box mounted — SAME React key, so the same instance transitions
  // live→exiting in place (no unmount/remount flicker) — frozen at its last `{envelope,
  // placement}`, until `animate-popover-out` ends (`onExited`). The live→exiting diff runs
  // DURING render, not in an effect: an effect would compute `boxes` for the dismiss frame before
  // it fired, unmounting the box for a frame first (the exit never plays). `exitingRef`/
  // `prevLiveRef` are refs mutated here like a memo cache — idempotent under double-render.
  const liveById = new Map(resolved.map((entry) => [entry.envelope.id, entry]));
  for (const { envelope } of resolved) {
    const placement = placementById.get(envelope.id);
    if (placement) cacheRef.current.set(envelope.id, { envelope, placement });
  }
  // Promote ids that were live last render but are gone now to "exiting" (from their cached
  // frame); cancel the exit of any id that came back live.
  for (const id of prevLiveRef.current) {
    const cached = cacheRef.current.get(id);
    if (!liveById.has(id) && !exitingRef.current.has(id) && cached) {
      exitingRef.current.set(id, cached);
    }
  }
  for (const id of liveById.keys()) exitingRef.current.delete(id);
  prevLiveRef.current = [...liveById.keys()];
  const onExited = useCallback((id: string) => {
    exitingRef.current.delete(id);
    cacheRef.current.delete(id);
    setRenderBump((n) => n + 1);
  }, []);

  if (!container) return null;
  // One box per id: live surfaces (entering/steady) + still-exiting surfaces (from the cache).
  const boxes = [
    ...resolved.map((entry) => ({
      envelope: entry.envelope,
      exiting: false,
      placement: placementById.get(entry.envelope.id),
    })),
    ...[...exitingRef.current.entries()]
      .filter(([id]) => !liveById.has(id))
      .map(([, c]) => ({
        envelope: c.envelope,
        exiting: true,
        placement: c.placement,
      })),
  ];
  return createPortal(
    // Route nested React Aria overlays (a config form's Select/ComboBox listbox, a Menu) into
    // this transform-free layer instead of `document.body`, so the ownership registry sees them
    // and a click on a dropdown option is not mistaken for an outside press (docs/029 §7.4 / #2).
    <UNSAFE_PortalProvider getContainer={() => container}>
      {boxes.map((box) => (
        <EnvelopeBox
          authority={authority}
          envelope={box.envelope}
          exiting={box.exiting}
          key={box.envelope.id}
          onExited={onExited}
          onMeasure={onMeasure}
          placement={box.placement}
        />
      ))}
    </UNSAFE_PortalProvider>,
    container,
  );
}

// The selection surface's command context does not gate on per-deployment capabilities (its
// marks/clipboard/annotate commands ignore them), so the host mounts the authority with a
// neutral set; the ribbon/coordinator carry the real capabilities for tab gating (docs/023).
const SELECTION_SURFACE_CAPS: ToolbarCapabilities = {
  ai: false,
  insertTable: true,
  media: false,
  review: false,
};

/**
 * Leaf host that owns the overlay authority + layer (docs/029 R1-D). It is a *separate*
 * component on purpose: `useOverlayAuthority` re-renders on every selection/commit, and
 * keeping that state in a leaf (a sibling of the block list, like `SelectionAnnouncer`)
 * means a selection change never re-renders the virtualized blocks — the perf invariant the
 * editing view depends on (a parent re-render would re-render every mounted block). Mounted
 * once inside the editing view so the selection surface serves both the bare view and the
 * full editor, the home the touch toolbar used to have.
 */
export function SelectionSurfaceHost(props: {
  readonly store: EditorStore;
  readonly focusEditor: () => void;
  /**
   * A stable ref (created higher in the view tree) the host writes the live authority into,
   * so components outside this leaf — the table cell `…`, the right-click handler, a mark
   * click — can call `open`/`openMark` without subscribing to the envelope state (docs/029
   * §7.4). Omitted in the bare view, where the host owns the authority privately.
   */
  readonly authorityRef?: OverlayAuthorityRef;
  /**
   * The dock seam (docs/027 §8.2), threaded into the authority so a surface it renders (the
   * glossary read card's "Open in Glossary", a flyout command opening a pane) can reach the
   * dock. Omitted in the bare view (no dock).
   */
  readonly panelHost?: PanelHost;
  readonly offsetModel?: OffsetModel | null;
  readonly scroller?: ScrollerGeometry | null;
}): ReactNode {
  const authority = useOverlayAuthority(props.store, SELECTION_SURFACE_CAPS, {
    focusEditor: props.focusEditor,
    panelHost: props.panelHost,
  });
  // Publish the live authority into the shared ref each (isolated) re-render; consumers read
  // it imperatively in event handlers, so this never re-renders them.
  if (props.authorityRef) props.authorityRef.current = authority;
  return (
    <OverlayLayer
      authority={authority}
      offsetModel={props.offsetModel}
      scroller={props.scroller}
      store={props.store}
    />
  );
}
