/**
 * Virtualization + scroll controller (docs/020 §4.3, R3).
 *
 * Owns the body-order window slice the viewport covers plus overscan (docs/011
 * §2.6), the scroll position, the measured height cache, and the per-frame scroll
 * coalescing. Lifted verbatim from `react-view.tsx`.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BlockEstimator,
  metricsForNode,
  reconcileOffsetModel,
  TreapOffsetModel,
} from "../../core/offset-model";
import { rangeFromModel } from "../../core/virtual-range";
import type { EditorStore, NodeId } from "../../core";
import { feedImeBounds } from "../overlays";
import { requestFrame } from "../raf";
import { anchorScrollAdjustment, isFlingVelocity } from "./anchor";
import type { ViewRefs } from "./refs";

const EMPTY_ORDER: readonly NodeId[] = [];

// A scroll faster than this is a fling (docs/025 §5.5). ~2px/ms is ~120px per
// 60fps frame — a deliberate flick, not a line-by-line read.
const FLING_PX_PER_MS = 2;
// Leave fling mode this long after the last scroll sample, so a brief pause
// mid-flick does not flip back to full hydration before the spin settles.
const FLING_IDLE_MS = 120;

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
  // True while the user is flinging (docs/025 §5.5). The render layer gates
  // decorator hydration on `!fling`, showing seed-sized placeholders during the
  // spin so a fast flywheel scroll does no per-frame hydration or measurement.
  readonly fling: boolean;
};

export function useVirtualWindow(args: {
  readonly refs: ViewRefs;
  readonly store: EditorStore;
  readonly order: readonly NodeId[];
  readonly virtualize: boolean;
  readonly viewportHeight: number;
  readonly fillHeight: boolean;
  readonly overscan: number;
  /**
   * The scroller's top padding (content inset). The scroller's padding-top shifts
   * the content origin down by this much, so a block at model-y `prefix(i)` sits at
   * scroll-position `surfaceInset + prefix(i)`. The window + anchor math subtract it
   * from `scrollTop` so the scroll geometry stays exact rather than drifting by the
   * inset (note.md §5.9 follow-up).
   */
  readonly surfaceInset: number;
}): VirtualWindowController {
  const {
    refs,
    store,
    order,
    virtualize,
    viewportHeight,
    fillHeight,
    overscan,
    surfaceInset,
  } = args;
  const {
    heightCacheRef,
    estimateRef,
    offsetModelRef: modelRef,
    pendingScrollRef,
    scrollFrameRef,
    rootRef,
    registryRef,
  } = refs;
  const [scrollTop, setScrollTop] = useState(0);
  const [measureVersion, setMeasureVersion] = useState(0);
  const [fling, setFling] = useState(false);
  // The scroller's own measured height, used only when `fillHeight` stretches the
  // surface to its flex container (R3, note.md §5.9). The windowing math needs a
  // concrete pixel viewport; a CSS `height: 100%` scroller has no fixed number, so
  // we measure the container and window against that. Until the first measurement
  // we fall back to `viewportHeight`, so the very first frame still windows a
  // sensible slice instead of nothing.
  const [measuredViewport, setMeasuredViewport] = useState(0);
  const effectiveViewportHeight =
    fillHeight && measuredViewport > 0 ? measuredViewport : viewportHeight;
  // Bumped to force a bulk re-seed of unmounted blocks when a document-wide
  // reflow changes their geometry — a width change or a web-font load (docs/025
  // §5.3). Measured blocks keep their cached real height across the rebuild.
  const [reseedVersion, setReseedVersion] = useState(0);

  // Current store, read by the (stable) ResizeObserver callback below so it sees
  // the live document without recreating the observer each render.
  const storeRef = useRef(store);
  storeRef.current = store;
  // The single ResizeObserver that measures mounted blocks off the scroll path
  // (docs/025 §5.5), the set of elements it currently watches, and the rAF that
  // coalesces its measurement bumps to one per frame.
  const observerRef = useRef<ResizeObserver | null>(null);
  const observedRef = useRef<Set<Element>>(new Set());
  const measureBumpFrameRef = useRef<number | null>(null);
  // Velocity sampling + the timer that exits fling mode after the spin settles.
  const lastScrollSampleRef = useRef<{ top: number; time: number } | null>(
    null,
  );
  const flingExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flingRef = useRef(false);

  // The per-type content-aware estimator (docs/025 §5.3), persistent across
  // renders. It produces the seed each block carries until it is measured and
  // calibrates from real measurements; it lives entirely outside the geometry
  // tree (the §6.2 separation).
  const estimatorRef = useRef<BlockEstimator | null>(null);
  if (!estimatorRef.current) estimatorRef.current = new BlockEstimator();
  // True once fonts settle: until then text measurements reflect the fallback
  // font and must not feed calibration (docs/025 §5.3).
  const fontsReadyRef = useRef(false);
  // The reseedVersion the live model was last built at, so the memo rebuilds
  // exactly once per reseed bump.
  const lastReseedRef = useRef(0);

  // The persistent offset model (docs/025 §5.2) lives in the shared refs bag
  // (`modelRef`, aliased above) so focus navigation can query its prefix too.
  // Unlike the flat reference impl, the treap is NOT rebuilt per measurement — it
  // is mutated in place by setHeight (measure effect) and by reconcileModel on
  // order change, so a measurement is O(log n), not an O(n) rebuild.
  // `modelOrderRef` records which order the model currently reflects so the memo
  // below knows when to reconcile.
  const modelOrderRef = useRef<readonly NodeId[]>(EMPTY_ORDER);

  /*
   * Keep the persistent model in sync with `order` (docs/025 §5.1, §9.1). This
   * runs on order change only — never on scrollTop and never on measureVersion,
   * because the geometry depends on structure and heights, not scroll position,
   * and heights are applied in place by the measure effect rather than by a
   * rebuild here. A scroll therefore does zero model work; a measurement does
   * O(log n); a structural edit does an O(n) prefix/suffix diff plus O(log n)
   * splices (or one rebuild past the edit-storm threshold).
   */
  const offsetModel = useMemo(() => {
    if (!virtualize) {
      modelRef.current = null;
      modelOrderRef.current = EMPTY_ORDER;
      return null;
    }
    /*
     * The seed ladder (docs/025 §5.3): a measured height if we have one, else the
     * estimator's content-aware seed for the block, else the coarse global
     * fallback. A moved block keeps its measured height because the cache is
     * keyed by id, so reconcile and rebuild both preserve it.
     */
    const seedFor = (id: NodeId): number => {
      const cached = heightCacheRef.current.get(id);
      if (cached !== undefined) return cached;
      const node = store.getNode(id);
      if (node) return estimatorRef.current!.seed(metricsForNode(node));
      return estimateRef.current;
    };
    const prev = modelOrderRef.current;
    if (!modelRef.current || lastReseedRef.current !== reseedVersion) {
      // First build, or a bulk re-seed after a document-wide reflow (docs/025
      // §5.3): rebuild from fresh seeds; measured blocks keep their cache value.
      modelRef.current = new TreapOffsetModel(order.map(seedFor));
      lastReseedRef.current = reseedVersion;
    } else if (prev !== order) {
      const reused = reconcileOffsetModel(
        modelRef.current,
        prev,
        order,
        seedFor,
      );
      if (!reused) modelRef.current = new TreapOffsetModel(order.map(seedFor));
    }
    modelOrderRef.current = order;
    return modelRef.current;
  }, [virtualize, order, reseedVersion, store, heightCacheRef, estimateRef]);

  /*
   * Measure the scroller's own height when `fillHeight` stretches it to its flex
   * container (R3, note.md §5.9). A fixed `viewportHeight` needs no observer; a
   * `height: 100%` scroller does, because the windowing slice is computed against
   * the visible viewport size and there is no fixed number to read. The container's
   * content-box block size IS the viewport (the virtualized path runs with
   * `padding: 0`). Coalesced through state with a sub-pixel tolerance so a
   * fractional-DPI jitter does not re-window every frame.
   */
  useEffect(() => {
    if (!virtualize || !fillHeight) return;
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const box = entry.contentBoxSize?.[0];
        const height = box
          ? box.blockSize
          : entry.target.getBoundingClientRect().height;
        if (height > 0) {
          setMeasuredViewport((prev) =>
            Math.abs(prev - height) > 0.5 ? height : prev,
          );
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [virtualize, fillHeight, rootRef]);

  /*
   * A web-font load is a document-wide reflow (docs/025 §5.3): text metrics
   * change everywhere, so re-seed unmounted blocks once fonts settle and unlock
   * estimator calibration. Until then text measurements reflect the fallback
   * font and would poison every text estimate.
   */
  useEffect(() => {
    if (!virtualize) return;
    const fonts = (
      document as Document & {
        fonts?: { ready: Promise<unknown>; status: string };
      }
    ).fonts;
    if (!fonts || fonts.status === "loaded") {
      fontsReadyRef.current = true;
      return;
    }
    let cancelled = false;
    void (async () => {
      await fonts.ready;
      if (cancelled) return;
      fontsReadyRef.current = true;
      setReseedVersion((value) => value + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [virtualize, fontsReadyRef]);

  /*
   * The window is the body-order slice the viewport covers plus overscan
   * (docs/011 §2.6). This is the per-frame query path: it queries the prebuilt
   * model and never rebuilds it, so scrolling a measured document does O(log n)
   * work on the treap instead of an O(n) prefix walk per frame (docs/025 §9.1).
   */
  const windowRange = useMemo<VirtualWindow>(() => {
    if (!virtualize || !offsetModel) {
      return {
        afterHeight: 0,
        beforeHeight: 0,
        endIndex: order.length,
        ids: order,
        startIndex: 0,
        totalHeight: 0,
      };
    }
    const range = rangeFromModel(offsetModel, {
      overscan,
      // The scroller's top padding shifts the content origin down, so the model-y
      // visible at the viewport top is `scrollTop - surfaceInset` (clamped at 0).
      scrollOffset: Math.max(0, scrollTop - surfaceInset),
      viewportSize: effectiveViewportHeight,
    });
    return { ...range, ids: order.slice(range.startIndex, range.endIndex) };
    // measureVersion is a dep because the measure effect mutates the model in
    // place (setHeight); the model identity does not change, so this is the
    // signal to re-query the window with the new geometry (docs/025 §9.1).
  }, [
    virtualize,
    offsetModel,
    order,
    scrollTop,
    overscan,
    effectiveViewportHeight,
    surfaceInset,
    measureVersion,
  ]);

  /*
   * Measure mounted blocks off the synchronous scroll path (docs/025 §5.5). The
   * ResizeObserver fires after layout, outside the scroll frame, so a fling does
   * not force a per-block reflow each frame. Heights are read FRACTIONALLY from
   * borderBoxSize — integer offsetHeight would accumulate ~0.5px of error per
   * block into hundreds of px of drift at large counts (docs/025 §5.5). Only the
   * cache + estimator are touched here; the model mirror and anchoring stay in
   * the layout effect, which brackets the model mutation to keep anchoring
   * correct. A single coalesced measureVersion bump drives that re-query.
   */
  const onResize = useCallback(
    (entries: readonly ResizeObserverEntry[]) => {
      const cache = heightCacheRef.current;
      const estimator = estimatorRef.current!;
      let changed = false;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const id = el.getAttribute("data-engine-block-id") as NodeId | null;
        if (!id) continue;
        const box = entry.borderBoxSize?.[0];
        const height = box ? box.blockSize : el.getBoundingClientRect().height;
        if (!(height > 0)) continue;
        // Sub-pixel tolerance: fractional borderBoxSize jitters by tiny amounts
        // (fractional DPI, zoom, font swaps); a strict !== would re-render the
        // whole window every frame at rest and over-feed the estimator EMA.
        const prev = cache.get(id);
        if (prev === undefined || Math.abs(prev - height) > 0.5) {
          cache.set(id, height);
          changed = true;
          // Calibrate from real, post-fonts.ready measurements only (docs/025
          // §5.3) — never a seed, never a fallback-font height.
          if (fontsReadyRef.current) {
            const node = storeRef.current.getNode(id);
            if (node) estimator.observe(metricsForNode(node), height);
          }
        }
      }
      if (changed && measureBumpFrameRef.current === null) {
        measureBumpFrameRef.current = requestFrame(() => {
          measureBumpFrameRef.current = null;
          setMeasureVersion((value) => value + 1);
        });
      }
    },
    [
      heightCacheRef,
      estimatorRef,
      fontsReadyRef,
      storeRef,
      measureBumpFrameRef,
    ],
  );

  /*
   * Keep the observer watching exactly the mounted blocks (docs/025 §5.5).
   * observe()'s initial callback delivers each block's first size for free, so
   * there is no separate measure pass. Runs on window change, not on scroll.
   */
  useLayoutEffect(() => {
    if (!virtualize) {
      observerRef.current?.disconnect();
      observedRef.current.clear();
      return;
    }
    if (!observerRef.current) {
      observerRef.current = new ResizeObserver(onResize);
    }
    const ro = observerRef.current;
    const live = registryRef.current.blockRefs;
    const observed = observedRef.current;
    const liveSet = new Set<Element>();
    for (const el of live.values()) {
      liveSet.add(el);
      if (!observed.has(el)) {
        ro.observe(el);
        observed.add(el);
      }
    }
    for (const el of Array.from(observed)) {
      if (!liveSet.has(el)) {
        ro.unobserve(el);
        observed.delete(el);
      }
    }
  }, [
    virtualize,
    onResize,
    windowRange.ids,
    registryRef,
    observerRef,
    observedRef,
  ]);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      observedRef.current.clear();
    },
    [observerRef, observedRef],
  );

  const onScroll = useCallback(() => {
    if (!virtualize || scrollFrameRef.current !== null) return;
    // Coalesce scroll onto one frame; recompute the window per painted frame,
    // never per scroll tick (docs/011 §10.3).
    scrollFrameRef.current = requestFrame(() => {
      scrollFrameRef.current = null;
      const element = rootRef.current;
      if (element) {
        const top = element.scrollTop;
        /*
         * Velocity gate (docs/025 §5.5): sample scroll speed across painted
         * frames; above the threshold we are flinging. A trailing timer clears
         * fling once the spin settles so hydration resumes. flingRef is the
         * non-reactive copy anchoring reads; `fling` state drives the view.
         */
        const now = performance.now();
        const last = lastScrollSampleRef.current;
        if (last) {
          const flinging = isFlingVelocity(
            top - last.top,
            now - last.time,
            FLING_PX_PER_MS,
          );
          if (flinging && !flingRef.current) {
            flingRef.current = true;
            setFling(true);
          }
        }
        lastScrollSampleRef.current = { time: now, top };
        // Deliberately a raw timer, not an engine-scheduler task (note.md §7 P4).
        // This is a state-machine deadline ("scrolling went quiet → exit fling"),
        // not coalescible derived work: each scroll sample *resets* the deadline
        // (clear + re-arm) so the timer fires only once the last sample is
        // FLING_IDLE_MS old. The scheduler's coalescing slot models "run the latest
        // payload once," not "slide a deadline forward on every event," so routing
        // it through a lane would buy no budget sharing and lose the reset
        // semantics. Left raw; cancelled with the rest on unmount below.
        if (flingExitTimerRef.current !== null) {
          clearTimeout(flingExitTimerRef.current);
        }
        flingExitTimerRef.current = setTimeout(() => {
          flingRef.current = false;
          setFling(false);
        }, FLING_IDLE_MS);
        setScrollTop(top);
      }
      // Re-feed IME bounds after scroll so the OS candidate window follows the
      // caret to its new viewport position (docs/010 §7.4, Phase 7 AC4).
      feedImeBounds(rootRef.current, store, registryRef.current);
    });
  }, [store, virtualize, scrollFrameRef, rootRef, registryRef]);

  useLayoutEffect(() => {
    if (!virtualize) return;
    const cache = heightCacheRef.current;
    const estimator = estimatorRef.current!;
    const scroller = rootRef.current;

    // Track the content width so the estimator's text/image analytics stay
    // width-correct; a real change is a document-wide reflow that re-seeds
    // unmounted blocks (docs/025 §5.3). The clientWidth read here piggybacks on
    // the layout this effect already forces.
    const widthNow = scroller?.clientWidth;
    if (widthNow && Math.abs(widthNow - estimator.getContentWidth()) > 1) {
      estimator.setContentWidth(widthNow);
      setReseedVersion((value) => value + 1);
    }

    /*
     * Capture the anchor BEFORE applying corrections (docs/025 §5.4): the
     * topmost visible block's index and its top edge under the current geometry.
     * Anchoring then keeps that block fixed on screen when a correction above it
     * shifts its top edge.
     */
    const baseScrollTop = scroller ? scroller.scrollTop : scrollTop;
    // Subtract the scroller's top padding so the anchor index matches the block
    // actually at the visible top (the padding shifts the content origin down).
    const anchorIndex = offsetModel
      ? offsetModel.findIndex(Math.max(0, baseScrollTop - surfaceInset))
      : 0;
    const prevAnchorPrefix = offsetModel ? offsetModel.prefix(anchorIndex) : 0;

    // Measurement now happens in the ResizeObserver (onResize) off the scroll
    // path; this effect only mirrors the cache into the model and anchors. Keep
    // the coarse global fallback (read by other controllers) tracking the
    // estimator's running mean instead of being locked (docs/025 §5.3).
    estimateRef.current = Math.max(1, Math.round(estimator.globalMean()));

    /*
     * Mirror the measured heights into the persistent model in place (docs/025
     * §7.4). The window ids are `order.slice(startIndex, endIndex)`, so block i's
     * index is exactly its order position — no id→index map needed, keeping ids
     * out of the geometry tree (the §6.2 separation). setHeight is idempotent.
     * If the mirror moved the geometry, bump once more so the window re-queries
     * the now-current model — a two-pass that converges in a frame and matches
     * the pre-RO behavior. Convergence is bounded: a pass only copies already-
     * cached heights into the model (idempotent — re-applying the same height is
     * a no-op), so `total` stops moving after the first mirror and the second
     * pass produces `geometryChanged === false`. Measurement (the RO) and this
     * mirror are separate, so there is no measure→mirror→measure feedback loop.
     */
    let geometryChanged = false;
    if (offsetModel) {
      const beforeTotal = offsetModel.total();
      for (let i = windowRange.startIndex; i < windowRange.endIndex; i += 1) {
        const id = order[i];
        if (!id) continue;
        const measured = cache.get(id);
        if (measured !== undefined) offsetModel.setHeight(i, measured);
      }
      geometryChanged = offsetModel.total() !== beforeTotal;
    }

    const pending = pendingScrollRef.current;
    if (pending) {
      // Explicit scroll-to-block: the s = 0 special case of anchoring (docs/025
      // §5.4). Re-assert the target's real position across frames until it stops
      // moving; content-aware seeds (§5.3) usually make this converge in one or
      // two frames instead of six.
      const element = registryRef.current.blockRefs.get(pending.id);
      if (element && scroller) {
        const target = element.offsetTop;
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
    } else if (offsetModel && scroller) {
      // General anchoring: if a correction above the anchor moved its top edge,
      // shift scrollTop by the same delta so the visible content does not jump.
      // Suppressed during a fling so we never touch scrollTop mid-inertia.
      const adjusted = anchorScrollAdjustment({
        fling: flingRef.current,
        newPrefix: offsetModel.prefix(anchorIndex),
        prevPrefix: prevAnchorPrefix,
        scrollTop: baseScrollTop,
      });
      if (adjusted !== null) {
        scroller.scrollTop = adjusted;
        setScrollTop(adjusted);
      }
    }

    if (geometryChanged) setMeasureVersion((value) => value + 1);
  }, [
    virtualize,
    offsetModel,
    order,
    scrollTop,
    windowRange.ids,
    windowRange.startIndex,
    windowRange.endIndex,
    measureVersion,
    surfaceInset,
    heightCacheRef,
    estimatorRef,
    registryRef,
    estimateRef,
    pendingScrollRef,
    rootRef,
    flingRef,
  ]);

  return { fling, onScroll, scrollTop, setScrollTop, windowRange };
}
