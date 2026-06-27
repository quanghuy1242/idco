"use client";

// DaisyUI 5: https://daisyui.com/components/breadcrumbs/
// React Aria: https://react-spectrum.adobe.com/react-aria/Menu.html

/**
 * A breadcrumb trail that measures available width and folds leading segments into a React Aria overflow menu.
 *
 * @categoryDefault Navigation
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MenuTrigger, Menu, MenuItem } from "./menu";
import { Button } from "./button";

/** Props for {@link ResponsiveBreadcrumb}. */
type ResponsiveBreadcrumbProps = {
  /** Ordered breadcrumb labels from root to current; earlier ones collapse first when space is tight. */
  readonly items: readonly string[];
  /** Optional node rendered before the trail, such as a home icon or root link. */
  readonly leadingItem?: ReactNode;
};

/** A width-aware breadcrumb that collapses overflowing leading segments into an ellipsis overflow menu. */
export function ResponsiveBreadcrumb({
  items,
  leadingItem,
}: ResponsiveBreadcrumbProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [collapseCount, setCollapseCount] = useState(0);
  const measuring = useRef(false);

  const measure = useCallback(() => {
    if (measuring.current) return;
    measuring.current = true;

    const list = listRef.current;
    const container = containerRef.current;
    if (!list || !container) {
      measuring.current = false;
      return;
    }

    const itemLis = list.querySelectorAll<HTMLElement>(
      "[data-breadcrumb-item]",
    );
    if (itemLis.length === 0) {
      setCollapseCount(0);
      measuring.current = false;
      return;
    }
    const collapsedMenu = list.querySelector<HTMLElement>(
      "[data-breadcrumb-menu]",
    );

    itemLis.forEach((li) => {
      li.style.display = "";
    });
    if (collapsedMenu) collapsedMenu.style.display = "none";
    void list.offsetHeight;

    const available = container.clientWidth;
    const full = list.scrollWidth;

    if (full > available) {
      let hidden = 0;
      const maxHidden = Math.max(0, itemLis.length - 1);
      if (collapsedMenu) collapsedMenu.style.display = "";
      for (let i = 0; i < maxHidden; i++) {
        itemLis[i].style.display = "none";
        hidden++;
        void list.offsetHeight;
        if (list.scrollWidth <= available) break;
      }
      setCollapseCount(hidden);
    } else {
      setCollapseCount(0);
    }

    measuring.current = false;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    requestAnimationFrame(() => measure());

    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    if (typeof requestAnimationFrame !== "function") {
      measure();
      return;
    }
    const frame = requestAnimationFrame(() => measure());
    return () => cancelAnimationFrame(frame);
  }, [items, leadingItem, measure]);

  const collapsedItems = items.slice(0, collapseCount);
  const hasCollapsed = collapsedItems.length > 0;
  const separator = (
    <span className="opacity-40 mx-1 select-none" aria-hidden="true">
      /
    </span>
  );

  return (
    <nav
      ref={containerRef}
      aria-label="Breadcrumb"
      className="flex-1 min-w-0 overflow-hidden"
    >
      <div className="flex items-center text-sm text-base-content/60">
        <ol ref={listRef} className="flex items-center gap-1 min-w-0">
          {leadingItem ? (
            <li className="flex items-center shrink-0">{leadingItem}</li>
          ) : null}
          {hasCollapsed ? (
            <li data-breadcrumb-menu className="flex items-center shrink-0">
              {leadingItem ? separator : null}
              <MenuTrigger placement="bottom start">
                <Button
                  variant="ghost"
                  size="sm"
                  ariaLabel="Show more breadcrumbs"
                  iconName="Ellipsis"
                />
                <Menu aria-label="Collapsed breadcrumbs">
                  {collapsedItems.map((item) => (
                    <MenuItem key={item} id={item}>
                      {item}
                    </MenuItem>
                  ))}
                </Menu>
              </MenuTrigger>
            </li>
          ) : null}
          {items.map((item, i) => (
            <li
              key={item}
              data-breadcrumb-item
              className="flex items-center shrink-0"
              style={{ display: i < collapseCount ? "none" : undefined }}
            >
              {i >= collapseCount &&
              (leadingItem || hasCollapsed || i > collapseCount)
                ? separator
                : null}
              <span className="whitespace-nowrap">{item}</span>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
