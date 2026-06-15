"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Phase 0 large-document support (docs/009 §6.1.1). Keep the single Lexical
 * root and the whole editing surface, but render a decorator block's React body
 * only while it is near the viewport. Offscreen decorators collapse to a cheap
 * measured placeholder, so a decorator-heavy document does not pay to mount
 * every code editor, callout, media frame, and embed at once.
 *
 * What this deliberately does NOT touch: the Lexical node tree, selection,
 * undo, and the persisted JSON are all unchanged — only the *rendered body* of
 * an offscreen decorator is swapped for a placeholder of the same height. That
 * is why this can ship before, and independently of, the section shell.
 */

/** Distance beyond the viewport (px) within which bodies stay mounted. */
const OVERSCAN_PX = 1200;
/** Height reserved for a body that has never been measured. */
const DEFAULT_ESTIMATED_HEIGHT_PX = 140;

/**
 * Whether decorator bodies in the current editor should virtualize. Off by
 * default so existing editors keep mounting every body; the large-document
 * surface opts in.
 */
export const DecoratorVirtualizationContext = createContext(false);

type VisibilityCallback = (entry: IntersectionObserverEntry) => void;

// One observer for every decorator body in the process. Per-node observers
// would defeat the purpose: thousands of observers is itself a cost.
let sharedObserver: IntersectionObserver | null = null;
const observerCallbacks = new WeakMap<Element, VisibilityCallback>();

// Measured heights survive demote/promote and remounts, so a body that scrolls
// back reserves its real height instead of the estimate. Keyed by persisted
// node id plus content signature when available, with a Lexical key fallback
// only for legacy nodes without ids.
const measuredHeights = new Map<string, number>();

// Live counts surfaced for the perf dashboard and Playwright assertions.
// `mounted` counts bodies whose React subtree is actually rendered; `total` is
// every decorator body in the document. Both modes report so before/after
// numbers are read the same way.
const stats = { mounted: 0, total: 0 };

declare global {
  interface Window {
    __IDCO_DECORATOR_VIRT__?: {
      readonly mountedBodies: number;
      readonly totalBodies: number;
    };
  }
}

function publishStats(): void {
  if (typeof window === "undefined") return;
  window["__IDCO_DECORATOR_VIRT__"] = {
    mountedBodies: stats.mounted,
    totalBodies: stats.total,
  };
}

function supportsObserver(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.IntersectionObserver === "function"
  );
}

function getObserver(): IntersectionObserver | null {
  if (!supportsObserver()) return null;
  if (sharedObserver) return sharedObserver;
  sharedObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        observerCallbacks.get(entry.target)?.(entry);
      }
    },
    // Keep a generous margin above and below the viewport so normal scrolling
    // never reveals a placeholder before its body has mounted.
    { rootMargin: `${OVERSCAN_PX}px 0px` },
  );
  return sharedObserver;
}

function observe(element: Element, callback: VisibilityCallback): () => void {
  const observer = getObserver();
  if (!observer) return () => {};
  observerCallbacks.set(element, callback);
  observer.observe(element);
  return () => {
    observer.unobserve(element);
    observerCallbacks.delete(element);
  };
}

/**
 * Wraps a decorator block's body. When virtualization is enabled (and the
 * browser supports `IntersectionObserver`), the body mounts only near the
 * viewport; otherwise it renders normally. Either way the body is tagged with
 * `data-decorator-body` and counted, so the two modes are measured identically.
 */
export function VirtualizedDecoratorBody({
  cacheKey,
  children,
}: {
  /** Stable persisted-id/signature key for the height cache. */
  readonly cacheKey: string;
  readonly children: ReactNode;
}) {
  const enabled = useContext(DecoratorVirtualizationContext);
  if (enabled && supportsObserver()) {
    return <VirtualizedBody cacheKey={cacheKey}>{children}</VirtualizedBody>;
  }
  return <StaticBody>{children}</StaticBody>;
}

/** Always-mounted body — the pre-Phase-0 behavior, plus stats/marker parity. */
function StaticBody({ children }: { readonly children: ReactNode }) {
  useEffect(() => {
    stats.mounted += 1;
    stats.total += 1;
    publishStats();
    return () => {
      stats.mounted -= 1;
      stats.total -= 1;
      publishStats();
    };
  }, []);
  return <div data-decorator-body="">{children}</div>;
}

function VirtualizedBody({
  cacheKey,
  children,
}: {
  readonly cacheKey: string;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Start collapsed so the initial mount of a large document renders only
  // placeholders; the observer promotes the bodies that are actually on screen.
  const [visible, setVisible] = useState(false);
  const reservedHeight =
    measuredHeights.get(cacheKey) ?? DEFAULT_ESTIMATED_HEIGHT_PX;

  useEffect(() => {
    stats.total += 1;
    publishStats();
    return () => {
      stats.total -= 1;
      publishStats();
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    stats.mounted += 1;
    publishStats();
    return () => {
      stats.mounted -= 1;
      publishStats();
    };
  }, [visible]);

  // Re-observe on every visible toggle: the observed element switches between
  // the placeholder and the body, and the old one leaves the DOM.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return observe(element, (entry) => {
      if (entry.isIntersecting) {
        setVisible(true);
        return;
      }
      // Remember the real height before collapsing so the placeholder reserves
      // the right space. Never collapse a body the user is editing.
      const measured = entry.boundingClientRect.height;
      if (measured > 0) measuredHeights.set(cacheKey, measured);
      if (element.contains(document.activeElement)) return;
      setVisible(false);
    });
  }, [cacheKey, visible]);

  if (visible) {
    return (
      <div ref={ref} data-decorator-body="">
        {children}
      </div>
    );
  }
  return (
    <div
      ref={ref}
      data-decorator-placeholder=""
      aria-hidden="true"
      className="rounded-box border border-dashed border-base-300 bg-base-200/40"
      style={{ height: reservedHeight }}
    />
  );
}
