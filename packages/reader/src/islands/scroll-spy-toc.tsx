"use client";

/**
 * The scroll-spy TOC island (docs/015 §6, §7.4). Enhances the static table of contents
 * (L1 `RichTextTableOfContents`, plain anchors) by highlighting the entry for the heading
 * currently in view. It *wraps* the static markup (the children slot) and decorates it via
 * the DOM — it does not re-render a different tree (docs/015 §13 "island hydration
 * mismatch"). Hydrates on `idle`: the highlight is a nicety, not content, so it waits for
 * a free main thread. With no JS the TOC still links and navigates.
 *
 * @categoryDefault Islands
 */
import { useEffect, useRef, type ReactNode } from "react";
import { isRecord } from "@quanghuy1242/idco-lib";
import { registerReaderIsland } from "./registry";

export type ScrollSpyData = {
  readonly anchorIds: readonly string[];
};

function isScrollSpyData(value: unknown): value is ScrollSpyData {
  return isRecord(value) && Array.isArray(value.anchorIds);
}

const ACTIVE_CLASS = "menu-active";

function ScrollSpyInteractive({
  data,
  children,
}: {
  readonly data: unknown;
  readonly children: ReactNode;
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isScrollSpyData(data)) return;
    const root = ref.current;
    if (!root || typeof IntersectionObserver !== "function") return;

    const headings = data.anchorIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;

    const setActive = (id: string | null) => {
      for (const link of root.querySelectorAll<HTMLElement>(
        "[data-rt-toc-link]",
      )) {
        link.classList.toggle(
          ACTIVE_CLASS,
          id !== null && link.getAttribute("data-rt-toc-link") === id,
        );
      }
    };

    // Track which headings are intersecting; the active entry is the topmost visible
    // one, so the highlight follows reading position rather than flicking on every cross.
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        const topmost = data.anchorIds.find((id) => visible.has(id)) ?? null;
        setActive(topmost);
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    for (const heading of headings) observer.observe(heading);
    return () => observer.disconnect();
  }, [data]);

  return (
    <div data-rt-toc-spy="" ref={ref}>
      {children}
    </div>
  );
}

/**
 * The scroll-spy TOC island: highlights the table-of-contents entry for the heading currently in view.
 *
 * @category Islands
 */
export const scrollSpyTocIsland = {
  Interactive: ScrollSpyInteractive,
  hydrate: "idle" as const,
  kind: "table-of-contents",
};

registerReaderIsland(scrollSpyTocIsland);
