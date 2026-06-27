// DaisyUI 5: https://daisyui.com/components/button/
"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "./button";
import { Menu, MenuItem, MenuTrigger } from "./menu";

/** Visual style applied to an action button (defaults to "secondary"). */
type ActionVariant = "primary" | "secondary" | "danger" | "ghost";
/** Size scale of the action buttons. */
type ActionSize = "sm" | "md";

/**
 * An action bar that measures available width and overflows lower-priority buttons into a React Aria menu.
 *
 * @categoryDefault Navigation
 */

/** A single action in a {@link ResponsiveActions} bar. */
export type ResponsiveAction = {
  /** Stable identifier used as the React key and overflow-menu item key. */
  readonly id: string;
  readonly label: string;
  /** Visual style of the rendered button (defaults to "secondary"). */
  readonly variant?: ActionVariant;
  /** Registered icon name shown before the label. */
  readonly iconName?: string;
  /** Accessible name when the button shows only an icon. */
  readonly ariaLabel?: string;
  /** Hover/focus tooltip text for the direct (non-collapsed) button. */
  readonly tooltip?: string;
  readonly disabled?: boolean;
  /** When true the action is removed entirely from both the bar and the overflow menu. */
  readonly isHidden?: boolean;
  /** Invoked when the action is pressed, whether shown directly or from the overflow menu. */
  readonly onAction: () => void;
};

/** Props for {@link ResponsiveActions}. */
type ResponsiveActionsProps = {
  /** Actions in priority order; trailing actions collapse into the overflow menu first as width shrinks. */
  readonly actions: readonly ResponsiveAction[];
  /** Accessible name for the action group and its overflow menu (defaults to "Actions"). */
  readonly ariaLabel?: string;
  /** Size scale applied to every action button (defaults to "md"). */
  readonly size?: ActionSize;
};

const useSafeLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function elementWidth(element: HTMLElement) {
  const measuredWidth =
    element.offsetWidth || element.getBoundingClientRect().width;
  if (measuredWidth > 0) return measuredWidth;

  const text = element.textContent?.trim() ?? "";
  return text ? text.length * 9 + 40 : 44;
}

function nextCollapseCount(
  availableWidth: number,
  actionWidths: readonly number[],
  menuWidth: number,
  gap: number,
) {
  if (actionWidths.length <= 1) return 0;
  if (availableWidth <= 0) return actionWidths.length;

  const allActionsWidth =
    actionWidths.reduce((total, width) => total + width, 0) +
    Math.max(0, actionWidths.length - 1) * gap;
  if (allActionsWidth <= availableWidth) return 0;

  for (
    let collapseCount = 1;
    collapseCount <= actionWidths.length;
    collapseCount++
  ) {
    const directCount = actionWidths.length - collapseCount;
    const directWidth = actionWidths
      .slice(0, directCount)
      .reduce((total, width) => total + width, 0);
    const visibleCount = directCount + 1;
    const totalWidth =
      directWidth + menuWidth + Math.max(0, visibleCount - 1) * gap;
    if (totalWidth <= availableWidth || collapseCount === actionWidths.length) {
      return collapseCount;
    }
  }

  return actionWidths.length;
}

/** A width-aware action bar that shows buttons until they no longer fit, then folds the rest into an ellipsis menu. */
export function ResponsiveActions({
  actions,
  ariaLabel = "Actions",
  size = "md",
}: ResponsiveActionsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const visibleActions = useMemo(
    () => actions.filter((action) => !action.isHidden),
    [actions],
  );
  const actionSignature = visibleActions
    .map((action) => `${action.id}:${action.label}:${action.variant ?? ""}`)
    .join("|");
  const [collapseCount, setCollapseCount] = useState(0);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const measureList = measureRef.current;
    if (visibleActions.length <= 1) {
      setCollapseCount(0);
      return;
    }
    if (!container || !measureList) {
      setCollapseCount(visibleActions.length);
      return;
    }

    if (window.matchMedia?.("(max-width: 767px)").matches) {
      setCollapseCount(visibleActions.length);
      return;
    }

    const available = container.getBoundingClientRect().width;
    const actionItems = measureList.querySelectorAll<HTMLElement>(
      "[data-responsive-measure-action]",
    );
    const menuItem = measureList.querySelector<HTMLElement>(
      "[data-responsive-measure-menu]",
    );
    const gap =
      Number.parseFloat(
        window.getComputedStyle(measureList).columnGap ||
          window.getComputedStyle(measureList).gap ||
          "0",
      ) || 0;
    const actionWidths = Array.from(actionItems).map((item) =>
      elementWidth(item),
    );
    const menuWidth = menuItem ? elementWidth(menuItem) : 44;
    const next = nextCollapseCount(available, actionWidths, menuWidth, gap);

    setCollapseCount((current) => (current === next ? current : next));
  }, [visibleActions.length]);

  useSafeLayoutEffect(() => {
    if (visibleActions.length <= 1) {
      setCollapseCount(0);
      return;
    }

    const container = containerRef.current;
    if (!container) {
      setCollapseCount(visibleActions.length);
      return;
    }

    if (typeof ResizeObserver === "undefined") {
      measure();
      return;
    }

    const mediaQuery = window.matchMedia?.("(max-width: 767px)");
    let frame = 0;
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => measure());
    };
    const observer = new ResizeObserver(scheduleMeasure);
    const handleResize: EventListener = scheduleMeasure;
    observer.observe(container);
    if (container.parentElement) observer.observe(container.parentElement);
    if (measureRef.current) observer.observe(measureRef.current);
    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);
    mediaQuery?.addEventListener("change", handleResize);
    document.fonts?.ready.then(scheduleMeasure).catch(() => {});
    scheduleMeasure();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
      mediaQuery?.removeEventListener("change", handleResize);
    };
  }, [actionSignature, measure, visibleActions.length]);

  useSafeLayoutEffect(() => {
    if (visibleActions.length <= 1 || collapseCount >= visibleActions.length)
      return;

    const container = containerRef.current;
    const list = listRef.current;
    if (!container || !list) return;

    const available = container.getBoundingClientRect().width;
    if (list.scrollWidth > available + 1) {
      setCollapseCount((current) =>
        Math.min(visibleActions.length, current + 1),
      );
    }
  }, [collapseCount, visibleActions.length]);

  const directCount =
    visibleActions.length <= 1
      ? visibleActions.length
      : Math.max(0, visibleActions.length - collapseCount);
  const collapsedActions = visibleActions.slice(directCount);
  const actionById = new Map(
    collapsedActions.map((action) => [action.id, action]),
  );
  const isFullyCollapsed = collapsedActions.length === visibleActions.length;

  if (visibleActions.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="relative min-w-12 flex-1 overflow-hidden"
    >
      <div
        ref={measureRef}
        aria-hidden="true"
        className="invisible pointer-events-none absolute left-0 top-0 flex h-0 gap-2 overflow-hidden whitespace-nowrap"
      >
        {visibleActions.map((action) => (
          <span
            key={action.id}
            data-responsive-measure-action=""
            className="shrink-0 whitespace-nowrap"
          >
            <Button
              variant={action.variant ?? "secondary"}
              size={size}
              iconName={action.iconName}
              ariaLabel={action.ariaLabel}
              disabled
            >
              {action.label}
            </Button>
          </span>
        ))}
        <span
          data-responsive-measure-menu=""
          className="shrink-0 whitespace-nowrap"
        >
          <Button
            variant="ghost"
            size={size}
            iconName="Ellipsis"
            ariaLabel={ariaLabel}
            disabled
          />
        </span>
      </div>
      <div
        ref={listRef}
        className="flex min-w-0 items-center justify-end gap-2"
      >
        {visibleActions.map((action, index) => (
          <span
            key={action.id}
            data-responsive-action=""
            className="shrink-0 whitespace-nowrap"
            style={{ display: index < directCount ? undefined : "none" }}
          >
            <Button
              variant={action.variant ?? "secondary"}
              size={size}
              iconName={action.iconName}
              ariaLabel={action.ariaLabel}
              tooltip={action.tooltip}
              disabled={action.disabled}
              onClick={action.onAction}
            >
              {action.label}
            </Button>
          </span>
        ))}
        <span
          data-responsive-menu=""
          className={isFullyCollapsed ? "shrink-0" : undefined}
          style={{ display: collapsedActions.length > 0 ? undefined : "none" }}
        >
          <MenuTrigger>
            <Button
              variant="ghost"
              size={size}
              iconName="Ellipsis"
              ariaLabel={ariaLabel}
              tooltip="More actions"
            />
            <Menu
              aria-label={ariaLabel}
              onAction={(key) => {
                const action = actionById.get(String(key));
                if (!action || action.disabled) return;
                action.onAction();
              }}
            >
              {collapsedActions.map((action) => (
                <MenuItem
                  key={action.id}
                  id={action.id}
                  isDisabled={action.disabled}
                >
                  {action.label}
                </MenuItem>
              ))}
            </Menu>
          </MenuTrigger>
        </span>
      </div>
    </div>
  );
}
