"use client";

// DaisyUI 5: https://daisyui.com/components/menu/
// DaisyUI 5: https://daisyui.com/components/button/
// React Aria: https://react-spectrum.adobe.com/react-aria/Menu.html

import { useCallback, useMemo } from "react";
import {
  Button as RACButton,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuTrigger as AriaMenuTrigger,
  Popover,
  Separator,
  type Key,
} from "react-aria-components";
import { Ellipsis } from "lucide-react";

type FilterOption = {
  readonly value: string;
  readonly label: string;
};

type FilterGroupConfig = {
  readonly key: string;
  readonly label: string;
  readonly options: ReadonlyArray<FilterOption>;
  readonly value: string;
  readonly onChange: (value: string) => void;
};

type MobileFilterMenuProps = {
  readonly groups: ReadonlyArray<FilterGroupConfig>;
  readonly size?: "sm" | "md";
};

function getTriggerLabel(groups: ReadonlyArray<FilterGroupConfig>): string {
  const active = groups
    .filter((g) => g.value !== "all")
    .map((g) => g.options.find((o) => o.value === g.value)?.label ?? g.value);
  if (active.length === 0) return "";
  if (active.length >= 3) return `${active.length} applied`;
  return active.join(", ");
}

const sizeClass: Record<"sm" | "md", string> = {
  sm: "btn-sm",
  md: "",
};

type FlatItem = {
  id: string;
  label: string;
  selected: boolean;
};

export function MobileFilterMenu({
  groups,
  size = "md",
}: MobileFilterMenuProps) {
  const triggerLabel = getTriggerLabel(groups);
  const hasAnyFilter = triggerLabel !== "";

  const items = useMemo<FlatItem[]>(() => {
    return groups.flatMap((g) =>
      g.options
        .filter((o) => o.value !== "all")
        .map((o) => ({
          id: `${g.key}:${o.value}`,
          label: `${g.label}: ${o.label}`,
          selected: g.value === o.value,
        })),
    );
  }, [groups]);

  const handleAction = useCallback(
    (key: Key) => {
      const keyStr = String(key);
      if (keyStr === "__all__") {
        for (const g of groups) g.onChange("all");
        return;
      }
      const sepIdx = keyStr.indexOf(":");
      if (sepIdx === -1) return;
      const groupKey = keyStr.slice(0, sepIdx);
      const value = keyStr.slice(sepIdx + 1);
      const group = groups.find((g) => g.key === groupKey);
      if (group) group.onChange(value);
    },
    [groups],
  );

  return (
    <AriaMenuTrigger>
      <RACButton
        aria-label="Filters"
        className={`btn btn-ghost lg:hidden ${sizeClass[size]} flex items-center gap-1`}
      >
        {hasAnyFilter ? (
          <span className="text-sm">{triggerLabel}</span>
        ) : (
          <Ellipsis className="size-[1.2em]" aria-hidden="true" />
        )}
      </RACButton>
      <Popover
        placement="bottom end"
        offset={4}
        className="z-50 data-[entering]:animate-popover-in data-[exiting]:animate-popover-out"
      >
        <AriaMenu
          className="menu menu-sm dropdown-content bg-base-100 rounded-box shadow w-52"
          onAction={handleAction}
        >
          <AriaMenuItem id="__all__" className={menuItemClass}>
            <span className="flex items-center justify-between w-full">
              All
              {!hasAnyFilter ? (
                <span className="text-primary text-xs">&#10003;</span>
              ) : null}
            </span>
          </AriaMenuItem>
          <Separator className="my-1 border-t border-base-300" />
          {items.map((item) => (
            <AriaMenuItem key={item.id} id={item.id} className={menuItemClass}>
              <span className="flex items-center justify-between w-full">
                {item.label}
                {item.selected ? (
                  <span className="text-primary text-xs">&#10003;</span>
                ) : null}
              </span>
            </AriaMenuItem>
          ))}
        </AriaMenu>
      </Popover>
    </AriaMenuTrigger>
  );
}

function menuItemClass({ isFocused }: { isFocused: boolean }) {
  return `px-3 py-1.5 text-sm rounded cursor-pointer outline-none ${
    isFocused ? "bg-base-200" : ""
  }`;
}
