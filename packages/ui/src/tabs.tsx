// DaisyUI 5: https://daisyui.com/components/tab/
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  Tab as AriaTab,
  TabList as AriaTabList,
  TabPanel as AriaTabPanel,
  TabPanels as AriaTabPanels,
  Tabs as AriaTabs,
} from "react-aria-components";

type BaseTabItem = {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
};

export type PanelTabItem = BaseTabItem & {
  readonly content?: ReactNode;
  readonly href?: never;
};

export type LinkTabItem = BaseTabItem & {
  readonly href: string;
  readonly content?: never;
};

export type ControlTabItem = BaseTabItem & {
  readonly content?: never;
  readonly href?: never;
};

export type TabItem = PanelTabItem | LinkTabItem | ControlTabItem;

type TabsBaseProps = {
  readonly ariaLabel: string;
  readonly selectedKey?: string;
  readonly defaultSelectedKey?: string;
  readonly disabledKeys?: readonly string[];
  readonly onSelectionChange?: (key: string) => void;
  readonly size?: "sm" | "md";
  readonly variant?: "border" | "box" | "lift";
};

type PanelTabsProps = TabsBaseProps & {
  readonly items: readonly PanelTabItem[];
};

type LinkTabsProps = TabsBaseProps & {
  readonly items: readonly LinkTabItem[];
};

type ControlTabsProps = TabsBaseProps & {
  readonly items: readonly ControlTabItem[];
};

type TabsProps = PanelTabsProps | LinkTabsProps | ControlTabsProps;

const variantClass = {
  border: "tabs-border",
  box: "tabs-box",
  lift: "tabs-lift",
} as const;

function isPanelTabItem(item: TabItem): item is PanelTabItem {
  return "content" in item;
}

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
              className={({ isSelected, isDisabled }) =>
                `tab ${isSelected ? "tab-active" : ""} ${isDisabled ? "tab-disabled" : ""}`.trim()
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
