/**
 * Central overlay positioning solve (docs/029 §7.4, R1-C) — the pure geometry half of the
 * anchor resolver. React Aria's `useOverlayPosition` places each popover independently and
 * knows nothing about its neighbors, so two coexisting surfaces near the same region
 * overlap (the mobile double-bar pre-merge; object config beside a flyout). This module
 * places *all live envelopes together*: it flips each box across the viewport edge, applies
 * the selection start-bias, and nudges lower-priority boxes off their higher-priority
 * neighbors. The resolved coordinates are then fed to the (controlled) React Aria overlay.
 *
 * It is intentionally DOM-free and deterministic: it takes anchor rects + content sizes +
 * the viewport and returns coordinates, so the flip/start-bias/collision behavior is
 * unit-asserted on plain rect inputs (jsdom has no layout engine, so the *math* must be
 * testable without real rects). The DOM half — turning an `AnchorRef` into the anchor rect
 * — lives in `../overlays/overlay-anchor.ts`.
 */

/** A rectangle in viewport (client) coordinates. */
export type RectLike = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

/** The viewport box the solve places within. */
export type Viewport = {
  readonly width: number;
  readonly height: number;
};

/** Which side of the anchor a surface prefers; flipped when it would clip the viewport. */
export type PlacementSide = "top" | "bottom";

/** One envelope's positioning inputs (docs/029 §7.4). */
export type EnvelopeLayoutInput = {
  /** Contributor/envelope id; echoed on the output so callers re-associate. */
  readonly id: string;
  /** The resolved anchor rect (from the DOM anchor resolver). */
  readonly anchor: RectLike;
  /** The measured (or estimated) content box size. */
  readonly size: { readonly width: number; readonly height: number };
  /**
   * Preferred side. `top` is the selection start-bias default (the bar floats above the
   * selection start so it does not cover the run, docs/024 §9); `bottom` for caret menus
   * and forms that hang below their anchor.
   */
  readonly prefer: PlacementSide;
  /**
   * Stacking weight. Higher stays put; lower is nudged off a collision (docs/029 §7.4).
   * Mirrors the envelope z so the visually-topmost surface keeps its ideal position.
   */
  readonly z: number;
  /** Gap between the anchor and the box, px. Default {@link DEFAULT_GAP}. */
  readonly gap?: number;
};

/** The resolved placement for one envelope. */
export type EnvelopePlacement = {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  /** The side actually used after flipping. */
  readonly placement: PlacementSide;
};

/** Distance kept from the viewport edges, px. */
export const VIEWPORT_MARGIN = 4;
/** Default gap between an anchor and its surface box, px. */
export const DEFAULT_GAP = 4;

function clamp(value: number, min: number, max: number): number {
  // When the box is wider/taller than the slot, min can exceed max; bias to min (top/left)
  // so the box's start edge stays visible rather than its end.
  return Math.max(min, Math.min(max, value));
}

function rectsOverlap(a: RectLike, b: RectLike): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

/**
 * Resolve one box's vertical side + clamped position against the viewport, ignoring
 * neighbors (the collision pass handles those). A `top` preference flips to `bottom` when
 * the box would clip the viewport top, and vice versa; if neither side fits, the preferred
 * side is kept and the box is clamped (so it is never placed entirely off-screen).
 */
function placeAgainstViewport(
  input: EnvelopeLayoutInput,
  viewport: Viewport,
): EnvelopePlacement {
  const gap = input.gap ?? DEFAULT_GAP;
  const { anchor, size } = input;

  const topPlacementTop = anchor.top - gap - size.height;
  const bottomPlacementTop = anchor.top + anchor.height + gap;
  const fitsTop = topPlacementTop >= VIEWPORT_MARGIN;
  const fitsBottom =
    bottomPlacementTop + size.height <= viewport.height - VIEWPORT_MARGIN;

  let side: PlacementSide = input.prefer;
  if (input.prefer === "top" && !fitsTop && fitsBottom) side = "bottom";
  else if (input.prefer === "bottom" && !fitsBottom && fitsTop) side = "top";

  const rawTop = side === "top" ? topPlacementTop : bottomPlacementTop;
  const top = clamp(
    rawTop,
    VIEWPORT_MARGIN,
    viewport.height - size.height - VIEWPORT_MARGIN,
  );
  // Horizontal start-bias: align the box's left to the anchor's left (so a selection bar
  // begins at the selection start), then clamp within the viewport.
  const left = clamp(
    anchor.left,
    VIEWPORT_MARGIN,
    viewport.width - size.width - VIEWPORT_MARGIN,
  );
  return { id: input.id, left, placement: side, top };
}

/**
 * Place every live envelope together (docs/029 §7.4). Two passes: (1) each box is flipped +
 * clamped against the viewport independently; (2) a collision pass walks boxes high-z
 * first, and any lower-z box overlapping an already-placed box is nudged below it (or above
 * it when there is no room below), then re-clamped. Deterministic and order-stable: inputs
 * are processed by descending z, ties by input order, so the same inputs always yield the
 * same layout.
 */
export function solveOverlayPlacements(
  inputs: readonly EnvelopeLayoutInput[],
  viewport: Viewport,
): readonly EnvelopePlacement[] {
  // First pass: viewport-relative placement per box.
  const placed = new Map<
    string,
    { input: EnvelopeLayoutInput; out: EnvelopePlacement }
  >();
  const order = [...inputs]
    .map((input, index) => ({ index, input }))
    .sort((a, b) => b.input.z - a.input.z || a.index - b.index);

  for (const { input } of order) {
    placed.set(input.id, { input, out: placeAgainstViewport(input, viewport) });
  }

  // Second pass: collision nudge. Higher-z boxes are fixed; a lower-z box that overlaps any
  // already-fixed box is moved clear. We re-fix boxes high-z first so each lower box only
  // ever yields to boxes that outrank it.
  const fixed: { rect: RectLike }[] = [];
  const result: EnvelopePlacement[] = [];
  for (const { input } of order) {
    const entry = placed.get(input.id)!;
    let { left, top } = entry.out;
    const { width, height } = input.size;
    for (let pass = 0; pass < fixed.length + 1; pass += 1) {
      const box: RectLike = { height, left, top, width };
      const hit = fixed.find((f) => rectsOverlap(box, f.rect));
      if (!hit) break;
      // Prefer nudging down (below the obstacle); if that runs off the bottom, nudge up.
      const below = hit.rect.top + hit.rect.height + DEFAULT_GAP;
      const above = hit.rect.top - DEFAULT_GAP - height;
      top =
        below + height <= viewport.height - VIEWPORT_MARGIN
          ? below
          : Math.max(VIEWPORT_MARGIN, above);
    }
    top = clamp(
      top,
      VIEWPORT_MARGIN,
      viewport.height - height - VIEWPORT_MARGIN,
    );
    const out: EnvelopePlacement = {
      id: input.id,
      left,
      placement: entry.out.placement,
      top,
    };
    fixed.push({ rect: { height, left, top, width } });
    result.push(out);
  }
  // Return in the caller's input order, not z order, so the caller's mapping is stable.
  const byId = new Map(result.map((r) => [r.id, r]));
  return inputs.map((input) => byId.get(input.id)!);
}
