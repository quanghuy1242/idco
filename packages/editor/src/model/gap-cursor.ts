export type GapSide = "before" | "after";

export type GapTarget = {
  readonly anchorKey: string;
  readonly side: GapSide;
};

export type RectLike = {
  readonly bottom: number;
  readonly left: number;
  readonly right?: number;
  readonly top: number;
  readonly width?: number;
};

export type GapCursorRect = {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
};

export type BlockGapCandidate = {
  readonly afterIndex: number | null;
  readonly beforeIndex: number | null;
  readonly bottom: number;
  readonly top: number;
};

export function gapCursorRect({
  anchorRect,
  gapBottom,
  gapTop,
  height = 2,
  minWidth = 24,
  rightInset = 0,
  rootRect,
  side,
  textInset,
}: {
  readonly anchorRect: RectLike;
  readonly gapBottom?: number;
  readonly gapTop?: number;
  readonly height?: number;
  readonly minWidth?: number;
  readonly rightInset?: number;
  readonly rootRect: RectLike;
  readonly side: GapSide;
  readonly textInset: number;
}): GapCursorRect {
  const boundary = side === "before" ? anchorRect.top : anchorRect.bottom;
  const topEdge = gapTop ?? boundary;
  const bottomEdge = gapBottom ?? boundary;
  const hasVisibleGap = bottomEdge - topEdge >= height;
  const top = hasVisibleGap
    ? topEdge + (bottomEdge - topEdge - height) / 2
    : boundary - height / 2;
  const rootRight =
    rootRect.right ?? rootRect.left + (rootRect.width ?? minWidth);

  return {
    height,
    left: rootRect.left + textInset,
    top,
    width: Math.max(
      minWidth,
      rootRight - rootRect.left - textInset - rightInset,
    ),
  };
}

export function blockGapCandidates({
  blockRects,
  rootBottom,
  rootTop,
}: {
  readonly blockRects: readonly RectLike[];
  readonly rootBottom: number;
  readonly rootTop: number;
}): BlockGapCandidate[] {
  if (blockRects.length === 0) return [];
  const candidates: BlockGapCandidate[] = [];
  const first = blockRects[0]!;
  candidates.push({
    afterIndex: 0,
    beforeIndex: null,
    bottom: first.top,
    top: rootTop,
  });
  blockRects.forEach((block, index) => {
    const next = blockRects[index + 1];
    if (next) {
      candidates.push({
        afterIndex: index + 1,
        beforeIndex: index,
        bottom: next.top,
        top: block.bottom,
      });
    } else {
      candidates.push({
        afterIndex: null,
        beforeIndex: index,
        bottom: rootBottom,
        top: block.bottom,
      });
    }
  });
  return candidates.filter((candidate) => candidate.bottom >= candidate.top);
}

export function blockGapAtY(
  candidates: readonly BlockGapCandidate[],
  y: number,
  tolerance = 2,
): BlockGapCandidate | null {
  return (
    candidates.find(
      (candidate) =>
        y >= candidate.top - tolerance && y <= candidate.bottom + tolerance,
    ) ?? null
  );
}
