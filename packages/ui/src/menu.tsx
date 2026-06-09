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
} from "react-aria-components";

export function MenuTrigger({
  children,
  placement = "bottom end",
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
      >
        {menu}
      </Popover>
    </AriaMenuTrigger>
  );
}

export function Menu<T extends object>(props: MenuProps<T>) {
  const { className, ...menuProps } = props;
  const baseClassName = className
    ? "menu popover-panel z-1"
    : "menu popover-panel w-52 z-1";

  return (
    <AriaMenu
      {...menuProps}
      render={((rp: Record<string, unknown>) => <ul {...rp} />) as never}
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
  const textValue =
    props.textValue ??
    props.label ??
    (typeof props.children === "string" ? props.children : undefined);
  const content = (
    <>
      {props.label ?? (props.children as ReactNode)}
      {props.badge ? (
        <span className="badge badge-sm">{props.badge}</span>
      ) : null}
    </>
  );

  return (
    <AriaMenuItem
      {...props}
      textValue={textValue}
      render={
        ((dp: Record<string, unknown>) =>
          "href" in dp ? (
            <li>
              <a {...dp}>{content}</a>
            </li>
          ) : (
            <li {...dp}>{content}</li>
          )) as never
      }
    />
  );
}
