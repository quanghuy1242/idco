/**
 * Virtualization + scroll controller (docs/020 §4.3, R3).
 *
 * Owns the body-order window slice the viewport covers plus overscan (docs/011
 * §2.6), the scroll position, the measured height cache, and the per-frame scroll
 * coalescing. Lifted verbatim from `react-view.tsx`.
 */
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { calculateVirtualRange } from "../../core/virtual-range";
import type { EditorStore, NodeId } from "../../core";
import { feedImeBounds } from "../selection-overlay";
import { requestFrame } from "../raf";
import type { ViewRefs } from "./refs";

export type VirtualWindow = {
  readonly afterHeight: number;
  readonly beforeHeight: number;
  readonly endIndex: number;
  readonly ids: readonly NodeId[];
  readonly startIndex: number;
  readonly totalHeight: number;
};

export type VirtualWindowController = {
  readonly windowRange: VirtualWindow;
  readonly scrollTop: number;
  readonly setScrollTop: (value: number) => void;
  readonly onScroll: () => void;
};

export function useVirtualWindow(args: {
  readonly refs: ViewRefs;
  readonly store: EditorStore;
  readonly order: readonly NodeId[];
  readonly virtualize: boolean;
  readonly viewportHeight: number;
  readonly overscan: number;
}): VirtualWindowController {
  const { refs, store, order, virtualize, viewportHeight, overscan } = args;
  const {
    heightCacheRef,
    estimateRef,
    estimateLockedRef,
    pendingScrollRef,
    scrollFrameRef,
    rootRef,
    registryRef,
  } = refs;
  const [scrollTop, setScrollTop] = useState(0);
  const [measureVersion, setMeasureVersion] = useState(0);

  /*
   * The window is the body-order slice the viewport covers plus overscan
   * (docs/011 §2.6). Item sizes come from the measured height cache, falling
   * back to a running estimate for blocks not yet mounted, so a block scrolled
   * out and back keeps its size and the scroll geometry stays stable.
   */
  const windowRange = useMemo<VirtualWindow>(() => {
    if (!virtualize) {
      return {
        afterHeight: 0,
        beforeHeight: 0,
        endIndex: order.length,
        ids: order,
        startIndex: 0,
        totalHeight: 0,
      };
    }
    const range = calculateVirtualRange({
      getItemSize: (index) =>
        heightCacheRef.current.get(order[index]!) ?? estimateRef.current,
      itemCount: order.length,
      overscan,
      scrollOffset: scrollTop,
      viewportSize: viewportHeight,
    });
    return { ...range, ids: order.slice(range.startIndex, range.endIndex) };
    // measureVersion forces a recompute after the height cache changes.
  }, [
    virtualize,
    order,
    scrollTop,
    measureVersion,
    overscan,
    viewportHeight,
    heightCacheRef,
    estimateRef,
  ]);

  const onScroll = useCallback(() => {
    if (!virtualize || scrollFrameRef.current !== null) return;
    // Coalesce scroll onto one frame; recompute the window per painted frame,
    // never per scroll tick (docs/011 §10.3).
    scrollFrameRef.current = requestFrame(() => {
      scrollFrameRef.current = null;
      const element = rootRef.current;
      if (element) setScrollTop(element.scrollTop);
      // Re-feed IME bounds after scroll so the OS candidate window follows the
      // caret to its new viewport position (docs/010 §7.4, Phase 7 AC4).
      feedImeBounds(rootRef.current, store, registryRef.current);
    });
  }, [store, virtualize, scrollFrameRef, rootRef, registryRef]);

  useLayoutEffect(() => {
    if (!virtualize) return;
    const cache = heightCacheRef.current;
    let changed = false;
    let total = 0;
    let count = 0;
    for (const [id, element] of registryRef.current.blockRefs) {
      const height = element.offsetHeight;
      if (height <= 0) continue;
      total += height;
      count += 1;
      if (cache.get(id) !== height) {
        cache.set(id, height);
        changed = true;
      }
    }
    /*
     * Lock the unmeasured-block estimate to the first real measurement. The
     * offset model the window math builds (docs/011 §2.6) must stay stable
     * across frames; letting the estimate drift per frame would re-derive every
     * offset and walk the window away from a scroll-to-block target (AC3).
     */
    if (!estimateLockedRef.current && count > 0) {
      estimateRef.current = Math.max(1, Math.round(total / count));
      estimateLockedRef.current = true;
    }
    const pending = pendingScrollRef.current;
    if (pending) {
      const element = registryRef.current.blockRefs.get(pending.id);
      const scroller = rootRef.current;
      if (element && scroller) {
        const target = element.offsetTop;
        // Re-assert the target's real position across frames until it stops
        // moving (newly measured blocks can shift it), so a variable-height
        // document still lands within tolerance, not only the uniform story.
        if (
          Math.abs(scroller.scrollTop - target) <= 1 ||
          pending.attempts >= 6
        ) {
          pendingScrollRef.current = null;
        } else {
          pendingScrollRef.current = {
            attempts: pending.attempts + 1,
            id: pending.id,
          };
          scroller.scrollTop = target;
          setScrollTop(target);
        }
      }
    }
    if (changed) setMeasureVersion((value) => value + 1);
  }, [
    virtualize,
    windowRange.ids,
    measureVersion,
    heightCacheRef,
    registryRef,
    estimateLockedRef,
    estimateRef,
    pendingScrollRef,
    rootRef,
  ]);

  return { onScroll, scrollTop, setScrollTop, windowRange };
}
