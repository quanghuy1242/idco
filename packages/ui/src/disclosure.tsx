// DaisyUI 5: https://daisyui.com/components/collapse/
"use client";

/**
 * A collapsible section pairing React Aria disclosure behavior with DaisyUI collapse styling, plus a group to coordinate several.
 *
 * @categoryDefault Navigation
 */

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

/** Indicator glyph shown in the disclosure trigger: a rotating chevron or a plus/minus toggle. */
export type DisclosureIcon = "chevron" | "plus";
/** How the disclosure sizes itself: natural content width or constrained to its container. */
export type DisclosureWidth = "auto" | "contained";

/** Props for {@link Disclosure}. */
type DisclosureProps = {
  /** Heading content rendered in the always-visible trigger row. */
  readonly title: ReactNode;
  readonly children: ReactNode;
  /** Stable key used when nested inside a {@link DisclosureGroup}. */
  readonly id?: Key;
  /** Initial expanded state when used uncontrolled. */
  readonly defaultExpanded?: boolean;
  /** Controlled expanded state; pair with `onExpandedChange`. */
  readonly expanded?: boolean;
  /** Called with the next expanded state whenever the user toggles the section. */
  readonly onExpandedChange?: (isExpanded: boolean) => void;
  /** Indicator glyph to display (defaults to "chevron"). */
  readonly icon?: DisclosureIcon;
  readonly disabled?: boolean;
  /** Width behavior of the collapse surface (defaults to "auto"). */
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

/** A single expandable section with a heading trigger and a collapsible panel, controlled or uncontrolled. */
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

/** Props for {@link DisclosureGroup}. */
type DisclosureGroupProps = {
  readonly children: ReactNode;
  /** When true, multiple sections may be expanded at once; otherwise expanding one collapses the others. */
  readonly allowsMultiple?: boolean;
  /** Keys of the sections that start expanded, matched against each {@link Disclosure}'s `id`. */
  readonly defaultExpandedKeys?: Iterable<Key>;
};

/** A container that coordinates several {@link Disclosure} sections, optionally allowing only one open at a time. */
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
