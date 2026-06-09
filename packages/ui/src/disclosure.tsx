// DaisyUI 5: https://daisyui.com/components/collapse/
"use client";

import type { ReactNode } from "react";
import {
  Button as AriaButton,
  Disclosure as AriaDisclosure,
  DisclosureGroup as AriaDisclosureGroup,
  DisclosurePanel as AriaDisclosurePanel,
  Heading,
  type Key,
} from "react-aria-components";
import { NavIcon } from "./nav-icons";

export type DisclosureIcon = "chevron" | "plus";
export type DisclosureWidth = "auto" | "contained";

type DisclosureProps = {
  readonly title: ReactNode;
  readonly children: ReactNode;
  readonly id?: Key;
  readonly defaultExpanded?: boolean;
  readonly expanded?: boolean;
  readonly onExpandedChange?: (isExpanded: boolean) => void;
  readonly icon?: DisclosureIcon;
  readonly disabled?: boolean;
  readonly width?: DisclosureWidth;
};

const disclosureWidthClass: Record<DisclosureWidth, string> = {
  auto: "",
  contained: "w-full min-w-0 max-w-full",
};

function iconName(icon: DisclosureIcon, isExpanded: boolean): string {
  if (icon === "plus") return isExpanded ? "Minus" : "Plus";
  return isExpanded ? "ChevronDown" : "ChevronRight";
}

// RAC `Disclosure` owns the expanded state; DaisyUI `collapse-open`/`collapse-close`
// force the visual state to match (we don't rely on DaisyUI's peer-checkbox toggle).
export function Disclosure({
  title,
  children,
  id,
  defaultExpanded,
  expanded,
  onExpandedChange,
  icon = "chevron",
  disabled,
  width = "auto",
}: DisclosureProps) {
  return (
    <AriaDisclosure
      id={id}
      defaultExpanded={defaultExpanded}
      isExpanded={expanded}
      onExpandedChange={onExpandedChange}
      isDisabled={disabled}
    >
      {({ isExpanded }) => (
        <div
          className={`collapse border border-base-300 bg-base-100 ${disclosureWidthClass[width]} ${
            isExpanded ? "collapse-open" : "collapse-close"
          }`}
        >
          <Heading className="m-0">
            <AriaButton
              slot="trigger"
              className="collapse-title flex w-full cursor-pointer items-center justify-between gap-3 text-left font-medium text-base-content outline-none focus-visible:text-primary"
            >
              <span>{title}</span>
              <span
                className="shrink-0 text-base-content/60"
                aria-hidden="true"
              >
                <NavIcon name={iconName(icon, isExpanded)} />
              </span>
            </AriaButton>
          </Heading>
          <AriaDisclosurePanel
            className={`collapse-content text-base-content/80 ${width === "contained" ? "min-w-0 overflow-hidden" : ""}`}
          >
            <div
              className={
                width === "contained" ? "min-w-0 overflow-hidden pt-1" : "pt-1"
              }
            >
              {children}
            </div>
          </AriaDisclosurePanel>
        </div>
      )}
    </AriaDisclosure>
  );
}

type DisclosureGroupProps = {
  readonly children: ReactNode;
  readonly allowsMultiple?: boolean;
  readonly defaultExpandedKeys?: Iterable<Key>;
};

export function DisclosureGroup({
  children,
  allowsMultiple,
  defaultExpandedKeys,
}: DisclosureGroupProps) {
  return (
    <AriaDisclosureGroup
      allowsMultipleExpanded={allowsMultiple}
      defaultExpandedKeys={defaultExpandedKeys}
      className="flex flex-col gap-2"
    >
      {children}
    </AriaDisclosureGroup>
  );
}
