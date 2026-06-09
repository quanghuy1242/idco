// DaisyUI 5: https://daisyui.com/components/button/
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Button as AriaButton } from "react-aria-components";
import { NavIcon } from "./nav-icons";
import { Tooltip } from "./tooltip";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md";
type ButtonAttachedSide = "left" | "right";
type TooltipPlacement = "top" | "bottom" | "left" | "right";

type ButtonProps = {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly type?: "button" | "submit" | "reset";
  readonly name?: string;
  readonly value?: string;
  readonly disabled?: boolean;
  readonly circle?: boolean;
  readonly square?: boolean;
  readonly attached?: ButtonAttachedSide;
  readonly children?: ReactNode;
  readonly ariaLabel?: string;
  readonly onClick?: () => void;
  readonly iconName?: string;
  readonly iconPosition?: "left" | "right";
  readonly hideOnDesktop?: boolean;
  readonly hideOnMobile?: boolean;
  /** Hover/focus hint. Strongly recommended for icon-only buttons. */
  readonly tooltip?: string;
  readonly tooltipPlacement?: TooltipPlacement;
};

function buttonClass(
  variant: ButtonVariant,
  size: ButtonSize,
  circle?: boolean,
  square?: boolean,
  attached?: ButtonAttachedSide,
  hideOnDesktop?: boolean,
  hideOnMobile?: boolean,
): string {
  const variantClass = {
    primary: "btn-primary",
    secondary: "btn-outline",
    danger: "btn-error",
    ghost: "btn-ghost",
  }[variant];
  const sizeClass = {
    sm: "btn-sm",
    md: "",
  }[size];
  const shapeClass = circle ? "btn-circle" : square ? "btn-square" : "";
  const attachedClass =
    attached === "left"
      ? "rounded-l-none -ml-px"
      : attached === "right"
        ? "rounded-r-none -mr-px"
        : "";
  const hideClass = [
    hideOnDesktop ? "lg:hidden" : "",
    hideOnMobile ? "hidden lg:inline-flex" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return ["btn", sizeClass, variantClass, shapeClass, attachedClass, hideClass]
    .filter(Boolean)
    .join(" ");
}

export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  name,
  value,
  disabled,
  circle,
  square,
  attached,
  children,
  ariaLabel,
  onClick,
  iconName,
  iconPosition = "left",
  hideOnDesktop,
  hideOnMobile,
  tooltip,
  tooltipPlacement = "top",
}: ButtonProps) {
  const icon = iconName ? <NavIcon name={iconName} variant="dock" /> : null;

  const button = (
    <AriaButton
      type={type}
      name={name}
      value={value}
      isDisabled={disabled}
      onPress={onClick}
      aria-label={ariaLabel}
      className={buttonClass(
        variant,
        size,
        circle,
        square,
        attached,
        hideOnDesktop,
        hideOnMobile,
      )}
    >
      {iconPosition === "left" && icon}
      {children}
      {iconPosition === "right" && icon}
    </AriaButton>
  );

  if (tooltip) {
    return (
      <Tooltip content={tooltip} placement={tooltipPlacement}>
        {button}
      </Tooltip>
    );
  }
  return button;
}

type LinkButtonProps = {
  readonly href: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly children?: ReactNode;
  readonly hideOnMobile?: boolean;
  readonly iconName?: string;
  readonly ariaLabel?: string;
  /** Native hover hint. Recommended for icon-only link buttons. */
  readonly tooltip?: string;
};

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  children,
  hideOnMobile,
  iconName,
  ariaLabel,
  tooltip,
}: LinkButtonProps) {
  const icon = iconName ? <NavIcon name={iconName} variant="dock" /> : null;

  return (
    <Link
      href={href}
      className={buttonClass(
        variant,
        size,
        false,
        false,
        undefined,
        false,
        hideOnMobile,
      )}
      aria-label={ariaLabel}
      title={tooltip}
    >
      {icon}
      {children}
    </Link>
  );
}
