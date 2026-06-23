"use client";

// Behavior only — no DaisyUI styling. The measurement/collapse engine lifted from
// `responsive-actions.tsx` (hidden-measure layer + ResizeObserver + greedy width math
// + correction pass), generalized so a heterogeneous toolbar can drive it: items
// carry a `priority` (lowest collapses into the overflow first) and a `collapsible`
// flag (a control that cannot become a flat menu item — a dropdown trigger, an opaque
// host component — always reserves its inline width). The consumer renders three
// surfaces and hands their refs in: a `container` (the available width), a hidden
// `measure` layer of every item at its natural width, and the live `list` (for the
// scrollWidth correction pass). The hook returns which item ids to push into the
// overflow menu. ResponsiveActions stays as-is (its positional collapse is simpler);
// this is the priority-ordered, mixed-item sibling the editor toolbar needs.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type CollapseItem = {
  readonly id: string;
  /** Lower collapses into the overflow menu first; ties break by later position. */
  readonly priority: number;
  /** Only a collapsible item may move into the overflow menu; others reserve width. */
  readonly collapsible: boolean;
};

const useSafeLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const EMPTY_SET: ReadonlySet<string> = new Set();

/** Natural width of a measured element, with a text-length fallback (jsdom width=0). */
function elementWidth(element: HTMLElement): number {
  const measured = element.offsetWidth || element.getBoundingClientRect().width;
  if (measured > 0) return measured;
  const text = element.textContent?.trim() ?? "";
  return text ? text.length * 9 + 40 : 44;
}

function rowGap(list: HTMLElement): number {
  const style = window.getComputedStyle(list);
  return Number.parseFloat(style.columnGap || style.gap || "0") || 0;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * Pure collapse decision (the unit-testable heart, the `nextCollapseCount` analogue):
 * greedily move the lowest-priority *collapsible* items into the overflow until the
 * row's laid-out width fits. The menu's own width is only charged once at least one
 * item has collapsed. `availableWidth <= 0` (a hidden/zero-width container — a
 * background tab) collapses every collapsible item so the off-screen pass never paints
 * a too-wide row that flashes on reveal.
 */
export function computeCollapsedIds(
  availableWidth: number,
  items: readonly CollapseItem[],
  widthOf: (id: string) => number,
  menuWidth: number,
  gap: number,
): ReadonlySet<string> {
  const collapsed = new Set<string>();
  if (items.length === 0) return collapsed;
  if (availableWidth <= 0) {
    for (const item of items) if (item.collapsible) collapsed.add(item.id);
    return collapsed;
  }

  // Laid-out width of the row given the current collapsed set: every still-inline item,
  // plus the overflow menu once anything has collapsed, plus the inter-item gaps.
  const layoutWidth = (): number => {
    let total = 0;
    let units = 0;
    for (const item of items) {
      if (collapsed.has(item.id)) continue;
      total += widthOf(item.id);
      units++;
    }
    if (collapsed.size > 0) {
      total += menuWidth;
      units++;
    }
    if (units > 1) total += gap * (units - 1);
    return total;
  };

  if (layoutWidth() <= availableWidth) return collapsed;

  // Collapse order: lowest priority first (note.md §a — `responsivePriority` finally
  // drives the order instead of ResponsiveActions' purely positional collapse), and on
  // a priority tie the later item collapses first so a row drops its trailing controls.
  const order = items
    .map((item, index) => ({ index, item }))
    .filter((entry) => entry.item.collapsible)
    .sort((a, b) => a.item.priority - b.item.priority || b.index - a.index);

  for (const entry of order) {
    collapsed.add(entry.item.id);
    if (layoutWidth() <= availableWidth) break;
  }
  return collapsed;
}

/**
 * Drive responsive collapse for a heterogeneous control row. Returns the collapsed id
 * set plus the three refs the consumer must place: `containerRef` on the width-bounding
 * box, `measureRef` on a hidden layer whose children carry `data-collapse-id` (+ one
 * `data-collapse-menu` sentinel for the ellipsis), and `listRef` on the live row.
 *
 * `enabled: false` is the mobile / static path (note.md "Mobile is horizontal scroll"):
 * no measurement runs and the set stays empty, so the consumer can fall back to a
 * scrolling row. `signature` is the re-measure key — change it when the item set or
 * their labels change (widths move); `items` is read through a ref so its per-render
 * identity churn does not thrash the observers.
 */
export function useResponsiveCollapse(options: {
  readonly items: readonly CollapseItem[];
  readonly signature: string;
  readonly enabled?: boolean;
}): {
  readonly collapsedIds: ReadonlySet<string>;
  readonly containerRef: React.RefObject<HTMLDivElement | null>;
  readonly measureRef: React.RefObject<HTMLDivElement | null>;
  readonly listRef: React.RefObject<HTMLDivElement | null>;
} {
  const { items, signature, enabled = true } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Read items through a ref: the array is a fresh identity every render, so depending
  // on it directly would re-subscribe the observers on every render (note.md keys off a
  // string signature for exactly this reason).
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [collapsedIds, setCollapsedIds] =
    useState<ReadonlySet<string>>(EMPTY_SET);

  const measure = useCallback(() => {
    if (!enabled) {
      setCollapsedIds((current) => (current.size === 0 ? current : EMPTY_SET));
      return;
    }
    const container = containerRef.current;
    const measureList = measureRef.current;
    if (!container || !measureList) {
      setCollapsedIds((current) => (current.size === 0 ? current : EMPTY_SET));
      return;
    }
    const available = container.getBoundingClientRect().width;
    const gap = rowGap(measureList);
    const widths = new Map<string, number>();
    measureList
      .querySelectorAll<HTMLElement>("[data-collapse-id]")
      .forEach((element) => {
        const id = element.dataset.collapseId;
        if (id) widths.set(id, elementWidth(element));
      });
    const menuElement = measureList.querySelector<HTMLElement>(
      "[data-collapse-menu]",
    );
    const menuWidth = menuElement ? elementWidth(menuElement) : 44;
    const next = computeCollapsedIds(
      available,
      itemsRef.current,
      (id) => widths.get(id) ?? 0,
      menuWidth,
      gap,
    );
    setCollapsedIds((current) => (sameSet(current, next) ? current : next));
  }, [enabled]);

  useSafeLayoutEffect(() => {
    if (!enabled) {
      setCollapsedIds((current) => (current.size === 0 ? current : EMPTY_SET));
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    if (typeof ResizeObserver === "undefined") {
      measure();
      return;
    }

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => measure());
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    if (container.parentElement) observer.observe(container.parentElement);
    if (measureRef.current) observer.observe(measureRef.current);
    const handleResize: EventListener = schedule;
    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);
    // Webfont metrics: text width is wrong until the font lands, so re-measure once it does.
    document.fonts?.ready.then(schedule).catch(() => {});
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
    };
  }, [enabled, measure, signature]);

  // Correction pass (note.md / responsive-actions.tsx:181-195): the measure layer omits
  // the inter-slot separators, so it can under-count by a few px and leave the live row
  // a hair too wide. If the painted row still overflows, collapse one more — the next
  // lowest-priority collapsible item — to guard against that rounding.
  useSafeLayoutEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    const list = listRef.current;
    if (!container || !list) return;
    if (list.scrollWidth <= container.getBoundingClientRect().width + 1) return;
    setCollapsedIds((current) => {
      const nextItem = itemsRef.current
        .filter((item) => item.collapsible && !current.has(item.id))
        .sort((a, b) => a.priority - b.priority)[0];
      if (!nextItem) return current;
      const next = new Set(current);
      next.add(nextItem.id);
      return next;
    });
  }, [collapsedIds, enabled]);

  return { collapsedIds, containerRef, listRef, measureRef };
}
