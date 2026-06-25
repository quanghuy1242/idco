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
 * Phase 1 builds and tests this layer in isolation; it is mounted into the live editor in
 * Phase 2 when the selection surface migrates (docs/029 §6.1), so nothing user-visible
 * changes yet. Projected slots (`contributor.projects`) render via the projection renderer
 * the Phase 2 surface migration supplies; until then a projected slot with no `render`
 * contributes no DOM, while `render`-bearing forms/cards/panels render fully.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { EditorStore } from "../../../core";
import type { OffsetModel } from "../../../core/offset-model";
import { resolveAnchorRect, type ScrollerGeometry } from "../../overlays";
import {
  solveOverlayPlacements,
  type EnvelopePlacement,
  type OverlayAuthority,
  type OverlaySurfaceContext,
  type ResolvedEnvelope,
  type ResolvedSlot,
} from "../../spi";

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
    // Fixed, zero-size, no transform: a stable viewport-relative origin for the solved
    // coordinates. Children opt back into pointer events; the layer itself is inert.
    Object.assign(div.style, {
      height: "0",
      left: "0",
      pointerEvents: "none",
      position: "fixed",
      top: "0",
      width: "0",
    });
    document.body.appendChild(div);
    assertTransformFree(div);
    setContainer(div);
    return () => {
      div.remove();
    };
  }, []);
  return container;
}

/** Render the co-slotted root slots of an envelope (docs/029 §4.7D). */
function SlotsView(props: {
  readonly slots: readonly ResolvedSlot[];
  readonly ctx: OverlaySurfaceContext;
}): ReactNode {
  return (
    <>
      {props.slots.map((slot) => (
        <div data-engine-overlay-slot={slot.id} key={slot.id}>
          {/* Projected slots (`projects`, no `render`) are rendered by the Phase 2 surface
              migration's projection renderer; a `render`-bearing contributor renders now. */}
          {slot.contributor.render?.(props.ctx) ?? null}
        </div>
      ))}
    </>
  );
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
}): ReactNode {
  const { envelope, placement, authority, onMeasure } = props;
  const ref = useRef<HTMLDivElement | null>(null);

  // Containment by ownership (docs/029 §7.4): register this surface's element so a press can
  // be tested as "inside me or a descendant overlay" without a `closest("[data-engine-*]")`.
  useEffect(() => {
    authority.ownership.register(envelope.id, ref.current, null);
    return () => authority.ownership.unregister(envelope.id);
  }, [authority, envelope.id]);

  // Measure for the central positioning solve (the layer re-solves with the real size).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    onMeasure(envelope.id, { height: rect.height, width: rect.width });
  }, [envelope, onMeasure]);

  // Focus policy (docs/029 §7.1, replaces useAutoFocusWithin): a `form` takes focus and
  // autofocuses its first field deterministically *after* layout; a `transparent`/`card`
  // surface never grabs focus here (the editor keeps it). Runs once per surface identity.
  useEffect(() => {
    if (envelope.focusMode !== "taking" || envelope.contentKind !== "form") {
      return undefined;
    }
    const id = requestAnimationFrame(() => {
      ref.current
        ?.querySelector<HTMLElement>("input, textarea, select")
        ?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [envelope.id, envelope.focusMode, envelope.contentKind]);

  const ctx = authority.surfaceContext(envelope.target);
  return (
    <div
      data-engine-overlay={envelope.target}
      ref={ref}
      style={{
        left: placement?.left ?? 0,
        pointerEvents: "auto",
        position: "fixed",
        top: placement?.top ?? 0,
        zIndex: envelope.z,
      }}
    >
      {envelope.panel ? (
        envelope.panel.render(ctx)
      ) : (
        <SlotsView ctx={ctx} slots={envelope.slots} />
      )}
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

  if (!container) return null;
  return createPortal(
    resolved.map(({ envelope }) => (
      <EnvelopeBox
        authority={authority}
        envelope={envelope}
        key={envelope.id}
        onMeasure={onMeasure}
        placement={placementById.get(envelope.id)}
      />
    )),
    container,
  );
}
