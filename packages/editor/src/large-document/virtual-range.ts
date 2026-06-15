export type VirtualRangeInput = {
  readonly itemCount: number;
  readonly scrollOffset: number;
  readonly viewportSize: number;
  readonly overscan?: number;
  readonly getItemSize: (index: number) => number;
};

export type VirtualRange = {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly beforeHeight: number;
  readonly afterHeight: number;
  readonly totalHeight: number;
};

export function calculateVirtualRange(input: VirtualRangeInput): VirtualRange {
  if (input.itemCount <= 0) {
    return {
      afterHeight: 0,
      beforeHeight: 0,
      endIndex: 0,
      startIndex: 0,
      totalHeight: 0,
    };
  }

  const offsets = cumulativeOffsets(input);
  const totalHeight = offsets[offsets.length - 1] ?? 0;
  const visibleStart = lowerBound(offsets, Math.max(0, input.scrollOffset)) - 1;
  const visibleEnd = lowerBound(
    offsets,
    Math.max(0, input.scrollOffset) + Math.max(0, input.viewportSize),
  );
  const overscan = Math.max(0, input.overscan ?? 1);
  const startIndex = Math.max(0, visibleStart - overscan);
  const endIndex = Math.min(input.itemCount, visibleEnd + overscan);
  return {
    afterHeight: totalHeight - (offsets[endIndex] ?? totalHeight),
    beforeHeight: offsets[startIndex] ?? 0,
    endIndex,
    startIndex,
    totalHeight,
  };
}

function cumulativeOffsets(input: VirtualRangeInput): number[] {
  const offsets = [0];
  for (let index = 0; index < input.itemCount; index += 1) {
    const next = offsets[index] + Math.max(1, input.getItemSize(index));
    offsets.push(next);
  }
  return offsets;
}

function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((values[mid] ?? 0) < target) low = mid + 1;
    else high = mid;
  }
  return low;
}
