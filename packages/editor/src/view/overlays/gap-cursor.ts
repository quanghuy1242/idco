/**
 * Gap-cursor geometry (docs/019 §4.9, §5.8).
 *
 * Pure rect math for the painted, ProseMirror-style insertion marker that sits
 * between/around block-level children of a scope — the position a normal text
 * caret cannot represent. Ported off the legacy Lexical plugin
 * (`legacy/model/gap-cursor.ts`) into the owned model's `{scope, index}`
 * coordinate: the marker is drawn from the rects of `children[index-1]` and
 * `children[index]`, inset to the scope's content box, with the doc/scope edges
 * pinned to the scope's top/bottom. Framework-free and unit-tested like
 * `layout.ts`; the overlay supplies measured client rects and subtracts its own
 * origin.
 */

export type RectLike = {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
};

export type GapMarker = {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
};

const DEFAULT_HEIGHT = 2;
const DEFAULT_MIN_WIDTH = 24;

/**
 * The horizontal insertion marker for a gap, in the same client coordinates the
 * inputs are given (the overlay subtracts its root origin afterward). The marker
 * spans the scope's content width and is centered vertically in the gap between
 * the surrounding children; at a scope edge it pins to the scope's top/bottom.
 */
export function gapMarkerRect(args: {
  /** Bottom edge of `children[index-1]`, or null when the gap opens the scope. */
  readonly prevBottom: number | null;
  /** Top edge of `children[index]`, or null when the gap closes the scope. */
  readonly nextTop: number | null;
  readonly scopeTop: number;
  readonly scopeBottom: number;
  readonly scopeLeft: number;
  readonly scopeRight: number;
  readonly leftInset?: number;
  readonly rightInset?: number;
  readonly height?: number;
  readonly minWidth?: number;
}): GapMarker {
  const height = args.height ?? DEFAULT_HEIGHT;
  const minWidth = args.minWidth ?? DEFAULT_MIN_WIDTH;
  const leftInset = args.leftInset ?? 0;
  const rightInset = args.rightInset ?? 0;
  const gapTop = args.prevBottom ?? args.scopeTop;
  const gapBottom = args.nextTop ?? args.scopeBottom;
  const span = gapBottom - gapTop;
  const top =
    span >= height
      ? gapTop + (span - height) / 2
      : (gapTop + gapBottom) / 2 - height / 2;
  const left = args.scopeLeft + leftInset;
  const width = Math.max(
    minWidth,
    args.scopeRight - args.scopeLeft - leftInset - rightInset,
  );
  return { height, left, top, width };
}

/**
 * Correct a gap's flanking edges AND scope bottom for review GHOSTS in the flow (docs/039 R-GI).
 *
 * The gap cursor's coordinate is a STORE index, so `gapOverlayRect` flanks the marker with the rects
 * of `children[index-1]` / `children[index]` — the store siblings — and pins an edge gap to the
 * scope's own box. But during review a REMOVED block renders as an inert `GhostBlock` mounted in the
 * flow, a block `childrenOf` never lists AND (on the virtualized path) whose height is not in the
 * scope's virtual total — so the ghost's neighbours overflow the scope box. Two failures follow, both
 * observed as "gap cursor completely off in review", corrected here from the ACTUAL mounted geometry:
 *
 *   - INTERIOR gap: the raw store-gap `[prevBottom, nextTop]` SPANS the ghost, so `gapMarkerRect`
 *     centers the marker in the ghost's middle — half a ghost-height from where the user clicked. The
 *     bottom edge stays `nextTop`; the top edge rises to the bottom of the lowest occupant inside the
 *     store-gap (the ghost closest to `next`), landing the marker in the thin real gap above `next`.
 *   - EDGE gap (no `next`): the scope box can be SHORTER than its content (the ghost's uncounted
 *     height pushes the last block past the box bottom), so a trailing marker pinned to the raw box
 *     bottom sits ABOVE the last block, mid-document. `scopeBottom` is clamped up to the true content
 *     bottom (the lowest block in the scope), so an end marker always sits at/below the last block;
 *     and if a removed LAST block trails `prev`, the bottom edge drops to its top so the end marker
 *     sits above the removed block, not below it.
 *
 * `occupants` are every mounted block rect in the scope's flow (store children AND ghosts). Outside
 * review there are no ghosts, the box already encloses the content, and nothing falls inside a
 * store-gap — so this returns the inputs unchanged, a pure no-op on the normal editing path.
 * Framework-free like the rest of this file; the overlay supplies the measured client rects.
 */
export function gapVisualAnchors(args: {
  readonly prevBottom: number | null;
  readonly nextTop: number | null;
  readonly scopeTop: number;
  readonly scopeBottom: number;
  readonly scopeLeft: number;
  readonly scopeRight: number;
  readonly occupants: readonly RectLike[];
}): { prevBottom: number | null; nextTop: number | null; scopeBottom: number } {
  const {
    prevBottom,
    nextTop,
    scopeTop,
    scopeBottom,
    scopeLeft,
    scopeRight,
    occupants,
  } = args;
  const EPS = 0.5;
  // A block from another column/scope must not be mistaken for content of THIS scope: require
  // horizontal overlap with the scope's content box (for a body gap the box is the whole surface, so
  // every block overlaps; for a nested scope only the container's own blocks qualify) and a top at or
  // below the scope top (so a block ABOVE a nested scope is excluded from its content extent).
  const inScope = (r: RectLike) =>
    r.right > scopeLeft + EPS &&
    r.left < scopeRight - EPS &&
    r.top >= scopeTop - EPS;
  // The scope's TRUE content bottom: the lowest block within it, or the box bottom when the box
  // already encloses everything (the non-virtualized / no-ghost case, where this stays `scopeBottom`).
  let contentBottom = scopeBottom;
  for (const r of occupants) {
    if (inScope(r) && r.bottom > contentBottom) contentBottom = r.bottom;
  }
  // Interior gap: raise the top edge past any ghost between prev and next.
  if (prevBottom !== null && nextTop !== null) {
    let bottom = prevBottom;
    for (const r of occupants) {
      if (r.right <= scopeLeft + EPS || r.left >= scopeRight - EPS) continue;
      // An occupant STRICTLY inside the store-gap: it starts at/below `prev` and ends at/above
      // `next`. `prev`/`next` themselves fail this (prev starts above, next ends below), so only a
      // ghost occupying the gap qualifies; keep the lowest one (closest to `next`).
      if (
        r.top >= prevBottom - EPS &&
        r.bottom <= nextTop + EPS &&
        r.bottom > bottom
      ) {
        bottom = r.bottom;
      }
    }
    return { nextTop, prevBottom: bottom, scopeBottom: contentBottom };
  }
  // Trailing gap: lower the bottom edge to the top of the highest ghost below `prev` (a removed last
  // block); otherwise the marker pins to the clamped content bottom below.
  if (prevBottom !== null && nextTop === null) {
    let top: number | null = null;
    for (const r of occupants) {
      if (r.right <= scopeLeft + EPS || r.left >= scopeRight - EPS) continue;
      if (r.top >= prevBottom - EPS && r.bottom <= contentBottom + EPS) {
        top = top === null ? r.top : Math.min(top, r.top);
      }
    }
    return { nextTop: top, prevBottom, scopeBottom: contentBottom };
  }
  // Leading gap (no prev): pinned to the scope top, nothing to correct but the clamped bottom.
  return { nextTop, prevBottom, scopeBottom: contentBottom };
}

export type GapCandidate = {
  /** The `{scope, index}` slot this candidate represents. */
  readonly index: number;
  readonly top: number;
  readonly bottom: number;
  /** Whether the slot is adjacent to a non-text atom (so a gap is the honest
   * position; a text caret cannot rest there — docs/019 §5.8). */
  readonly atomic: boolean;
};

/**
 * The inter-block gap regions of a scope, one per slot `0..rects.length`, for
 * click hit-testing (docs/019 §4.9 produce-by-click). Each region runs from the
 * bottom of the previous child to the top of the next, clamped to the scope box.
 */
export function gapCandidates(args: {
  readonly rects: readonly RectLike[];
  readonly atomicFlags: readonly boolean[];
  readonly scopeTop: number;
  readonly scopeBottom: number;
}): GapCandidate[] {
  const { rects, atomicFlags, scopeTop, scopeBottom } = args;
  const candidates: GapCandidate[] = [];
  if (rects.length === 0) {
    candidates.push({
      atomic: false,
      bottom: scopeBottom,
      index: 0,
      top: scopeTop,
    });
    return candidates;
  }
  for (let index = 0; index <= rects.length; index += 1) {
    const prev = index > 0 ? rects[index - 1]! : null;
    const next = index < rects.length ? rects[index]! : null;
    const top = prev ? prev.bottom : scopeTop;
    const bottom = next ? next.top : scopeBottom;
    const atomic =
      (index > 0 && atomicFlags[index - 1] === true) ||
      (index < rects.length && atomicFlags[index] === true);
    if (bottom >= top) candidates.push({ atomic, bottom, index, top });
  }
  return candidates;
}

/** The gap candidate whose vertical band contains `y`, or null. */
export function gapAtY(
  candidates: readonly GapCandidate[],
  y: number,
  tolerance = 2,
): GapCandidate | null {
  return (
    candidates.find(
      (candidate) =>
        y >= candidate.top - tolerance && y <= candidate.bottom + tolerance,
    ) ?? null
  );
}
