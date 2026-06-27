"use client";

/**
 * The island hydration boundary (docs/015 §6.3). A client component that renders the
 * server-produced static markup (`children`) verbatim until its `hydrate` policy fires,
 * then swaps in the interactive enhancement. The swap is **post-mount**: on first paint the
 * boundary renders the same `children` the server did (so React's hydration sees identical
 * markup — no mismatch), and only *after* the policy fires does it render `enhanced`. That
 * is what makes it safe for an enhancement to render a *different* tree than the static
 * markup (the live-code and checklist islands do exactly that, building their own DOM from
 * the node data; the scroll-spy island instead wraps the same `children`). And "the static
 * render is always complete on its own" still holds — with JavaScript off, before the
 * policy fires, or if the island never activates, the reader shows the full static content
 * (docs/015 §6.1).
 *
 * Policies: `visible` activates when the boundary scrolls into view (IntersectionObserver,
 * pairing with `content-visibility`); `idle` activates after first paint when the main
 * thread is free (`requestIdleCallback`, with a timeout fallback); `interaction` activates
 * on first pointer/focus intent.
 *
 * @categoryDefault Islands
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ReaderIslandHydrate } from "./registry";

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/** Renders static markup until its hydrate policy fires, then swaps in the interactive enhancement. */
export function IslandBoundary({
  hydrate = "visible",
  children,
  enhanced,
}: {
  readonly hydrate?: ReaderIslandHydrate;
  /** The static L1 markup, shown until activation. */
  readonly children: ReactNode;
  /** The interactive enhancement, mounted on activation (wraps the same `children`). */
  readonly enhanced: ReactNode;
}) {
  const [active, setActive] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (active) return;
    const node = ref.current;
    if (!node) return;

    if (hydrate === "idle") {
      const w = window as IdleWindow;
      if (typeof w.requestIdleCallback === "function") {
        const handle = w.requestIdleCallback(() => setActive(true), {
          timeout: 2000,
        });
        return () => w.cancelIdleCallback?.(handle);
      }
      const timer = window.setTimeout(() => setActive(true), 200);
      return () => window.clearTimeout(timer);
    }

    if (hydrate === "interaction") {
      const activate = () => setActive(true);
      // `once` so the first intent activates and the listeners detach themselves.
      node.addEventListener("pointerenter", activate, { once: true });
      node.addEventListener("focusin", activate, { once: true });
      return () => {
        node.removeEventListener("pointerenter", activate);
        node.removeEventListener("focusin", activate);
      };
    }

    // visible (default): activate when the boundary enters the viewport. No
    // IntersectionObserver (old browser / SSR mismatch) → activate immediately so
    // the enhancement is never silently lost.
    if (typeof IntersectionObserver !== "function") {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setActive(true);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, hydrate]);

  return (
    <div
      data-rt-island=""
      data-rt-island-active={active ? "" : undefined}
      ref={ref}
    >
      {active ? enhanced : children}
    </div>
  );
}
