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
