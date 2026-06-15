// DaisyUI 5: https://daisyui.com/components/menu/
// React Aria: https://react-spectrum.adobe.com/react-aria/Menu.html
"use client";

import { type ReactNode, Children } from "react";
import {
  composeRenderProps,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuTrigger as AriaMenuTrigger,
  Popover,
  type MenuProps,
  type MenuItemProps,
  type PopoverProps,
} from "react-aria-components";

export function MenuTrigger({
  children,
  placement = "bottom end",
  shouldCloseOnInteractOutside,
  ...props
}: {
  children: ReactNode;
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  placement?:
    | "top"
    | "bottom"
    | "left"
    | "right"
    | "top start"
    | "top end"
    | "bottom start"
    | "bottom end"
    | "left top"
    | "left bottom"
    | "right top"
    | "right bottom";
  shouldCloseOnInteractOutside?: PopoverProps["shouldCloseOnInteractOutside"];
}) {
  const [trigger, menu] = Children.toArray(children) as [
    React.ReactElement,
    React.ReactElement,
  ];

  return (
    <AriaMenuTrigger {...props}>
      {trigger}
      <Popover
        className="z-50 data-[entering]:animate-popover-in data-[exiting]:animate-popover-out"
        placement={placement}
        offset={4}
        crossOffset={0}
        shouldCloseOnInteractOutside={shouldCloseOnInteractOutside}
      >
        {menu}
      </Popover>
    </AriaMenuTrigger>
  );
}

export function Menu<T extends object>(props: MenuProps<T>) {
  const { className, ...menuProps } = props;
  const panelClassName =
    "rounded-box border border-base-300 bg-base-100 p-2 shadow-lg";
  const baseClassName = className
    ? `menu ${panelClassName} z-1`
    : `menu ${panelClassName} w-52 z-1`;

  return (
    <AriaMenu
      {...menuProps}
      className={composeRenderProps(className, (resolvedClassName) =>
        [baseClassName, resolvedClassName].filter(Boolean).join(" "),
      )}
    />
  );
}

type MenuItemHref = {
  readonly href: string;
  readonly badge?: string;
  readonly label: string;
};

export function MenuItem(props: MenuItemProps & Partial<MenuItemHref>) {
  const { badge, children, className, label, ...itemProps } = props;
  const textValue =
    props.textValue ??
    label ??
    (typeof children === "string" ? children : undefined);
  const content = (
    <>
      {label ?? (children as ReactNode)}
      {badge ? <span className="badge badge-sm">{badge}</span> : null}
    </>
  );

  return (
    <AriaMenuItem
      {...itemProps}
      textValue={textValue}
      className={composeRenderProps(className, (resolvedClassName) =>
        [
          "flex cursor-pointer items-center gap-2 rounded-field px-3 py-2 text-sm outline-none hover:bg-base-200 focus:bg-base-200 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
          resolvedClassName,
        ]
          .filter(Boolean)
          .join(" "),
      )}
    >
      {content}
    </AriaMenuItem>
  );
}
