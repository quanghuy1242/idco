// DaisyUI 5: https://daisyui.com/components/tab/
"use client";

/**
 * Tabs: React Aria Tabs behavior (roving focus, selection) with DaisyUI 5 tab styling.
 *
 * @categoryDefault Navigation
 */

import type { ReactNode } from "react";
import Link from "next/link";
import {
  Tab as AriaTab,
  TabList as AriaTabList,
  TabPanel as AriaTabPanel,
  TabPanels as AriaTabPanels,
  Tabs as AriaTabs,
} from "react-aria-components";

/** Fields common to every tab item. */
type BaseTabItem = {
  /** Stable tab identity, matched against `selectedKey`. */
  readonly id: string;
  /** Visible tab label. */
  readonly label: string;
  /** Disable this tab. */
  readonly disabled?: boolean;
};

/** A tab that owns an inline content panel. */
export type PanelTabItem = BaseTabItem & {
  /** Panel body shown when this tab is selected. */
  readonly content?: ReactNode;
  readonly href?: never;
};

/** A tab that navigates to a route instead of revealing a panel. */
export type LinkTabItem = BaseTabItem & {
  /** Destination route. */
  readonly href: string;
  readonly content?: never;
};

/** A tab used purely as a controlled selector, with content rendered elsewhere by the caller. */
export type ControlTabItem = BaseTabItem & {
  readonly content?: never;
  readonly href?: never;
};

/** Any tab item: panel-backed, link, or controlled selector. */
export type TabItem = PanelTabItem | LinkTabItem | ControlTabItem;

/** Selection, sizing, and styling shared by every `Tabs` mode. */
type TabsBaseProps = {
  /** Accessible label for the tab list. */
  readonly ariaLabel: string;
  /** Selected tab id (controlled). */
  readonly selectedKey?: string;
  /** Initial selected tab id (uncontrolled). */
  readonly defaultSelectedKey?: string;
  /** Tab ids to disable; falls back to per-item `disabled`. */
  readonly disabledKeys?: readonly string[];
  /** Called with the newly selected tab id. */
  readonly onSelectionChange?: (key: string) => void;
  /** Tab size; defaults to `md`. */
  readonly size?: "sm" | "md";
  /** Selection-indicator style; defaults to `border`. */
  readonly variant?: "border" | "box" | "lift";
};

/** Props for `Tabs` rendering inline content panels. */
type PanelTabsProps = TabsBaseProps & {
  readonly items: readonly PanelTabItem[];
};

/** Props for `Tabs` acting as route navigation. */
type LinkTabsProps = TabsBaseProps & {
  readonly items: readonly LinkTabItem[];
};

/** Props for `Tabs` acting as a controlled selector. */
type ControlTabsProps = TabsBaseProps & {
  readonly items: readonly ControlTabItem[];
};

/** Props for {@link Tabs}; the item shape selects panel, link, or controlled mode. */
type TabsProps = PanelTabsProps | LinkTabsProps | ControlTabsProps;

const variantClass = {
  border: "tabs-border",
  box: "tabs-box",
  lift: "tabs-lift",
} as const;

function isPanelTabItem(item: TabItem): item is PanelTabItem {
  return "content" in item;
}

/**
 * A tab strip that renders inline panels, route links, or a controlled selector depending on item shape.
 *
 * @example
 * <Tabs ariaLabel="Settings" items={[{ id: "general", label: "General", content: <General /> }]} />
 */
export function Tabs({
  items,
  ariaLabel,
  selectedKey,
  defaultSelectedKey,
  disabledKeys,
  onSelectionChange,
  size = "md",
  variant = "border",
}: TabsProps) {
  const sizeClass = size === "sm" ? "tabs-sm" : "";
  const disabled = new Set(
    disabledKeys ??
      items.filter((item) => item.disabled).map((item) => item.id),
  );
  const panelItems = items.filter(isPanelTabItem);
  const hasPanels = panelItems.length > 0;

  return (
    <AriaTabs
      selectedKey={selectedKey}
      defaultSelectedKey={defaultSelectedKey}
      disabledKeys={disabled}
      onSelectionChange={(key) => onSelectionChange?.(String(key))}
    >
      <AriaTabList
        aria-label={ariaLabel}
        className={`tabs ${variantClass[variant]} ${sizeClass} overflow-x-auto`.trim()}
      >
        {items.map((item) => {
          const href = "href" in item ? item.href : undefined;
          return (
            <AriaTab
              key={item.id}
              id={item.id}
              href={href}
              // DaisyUI dims a plain `.tab`, which reads as *disabled* next to the
              // active one. Give an inactive-but-enabled tab explicit
              // `text-base-content` so only a genuinely `tab-disabled` tab greys out
              // (the active tab carries its own emphasis via `tab-active` + the
              // variant's border/box/lift indicator).
              className={({ isSelected, isDisabled }) =>
                `tab ${isSelected ? "tab-active" : ""} ${
                  isDisabled
                    ? "tab-disabled"
                    : isSelected
                      ? ""
                      : "text-base-content"
                }`.trim()
              }
              render={
                typeof href === "string"
                  ? (domProps) =>
                      "href" in domProps ? (
                        <Link {...domProps} href={href} />
                      ) : (
                        <div {...domProps} />
                      )
                  : undefined
              }
            >
              {item.label}
            </AriaTab>
          );
        })}
      </AriaTabList>
      {hasPanels ? (
        <AriaTabPanels>
          {panelItems.map((item) => (
            <AriaTabPanel
              key={item.id}
              id={item.id}
              className="pt-4 text-base-content"
            >
              {item.content}
            </AriaTabPanel>
          ))}
        </AriaTabPanels>
      ) : null}
    </AriaTabs>
  );
}
