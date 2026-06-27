// DaisyUI 5: https://daisyui.com/components/button/
"use client";

/**
 * Action buttons: React Aria press behavior with DaisyUI 5 button styling.
 *
 * @categoryDefault Forms
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { Button as AriaButton } from "react-aria-components";
import { NavIcon } from "./nav-icons";
import { Tooltip } from "./tooltip";

/** Visual intent of a button: filled primary, outlined secondary, error/danger, or borderless ghost. */
type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
/** Control height token; defaults to `md`. */
type ButtonSize = "sm" | "md";
/** Side whose corners/border are flattened so the button joins an adjacent control as a segmented group. */
type ButtonAttachedSide = "left" | "right";
/** Edge a button's tooltip opens toward. */
type TooltipPlacement = "top" | "bottom" | "left" | "right";

/** Props for {@link Button}. */
type ButtonProps = {
  /** Visual intent; defaults to `primary`. */
  readonly variant?: ButtonVariant;
  /** Control height; defaults to `md`. */
  readonly size?: ButtonSize;
  /** Native button type; `submit` triggers an enclosing `Form`. Defaults to `button`. */
  readonly type?: "button" | "submit" | "reset";
  /** Form field name submitted with the button's `value` when it is the activated submitter. */
  readonly name?: string;
  /** Form value submitted under `name` when this button submits. */
  readonly value?: string;
  readonly disabled?: boolean;
  /** Render as a round icon-only button. */
  readonly circle?: boolean;
  /** Render as a square icon-only button. */
  readonly square?: boolean;
  /** Flatten one side to join an adjacent control as a segmented group. */
  readonly attached?: ButtonAttachedSide;
  readonly children?: ReactNode;
  /** Accessible name; required when the button is icon-only. */
  readonly ariaLabel?: string;
  /** Keyboard-shortcut hint announced to AT (e.g. "Ctrl+B"); pairs with `tooltip`. */
  readonly ariaKeyShortcuts?: string;
  /** Press handler (React Aria `onPress`, covers pointer/keyboard/touch). */
  readonly onClick?: () => void;
  /** Registered icon name to render alongside the label; register in `nav-icons` first. */
  readonly iconName?: string;
  /** Whether the icon sits before or after the label. Defaults to `left`. */
  readonly iconPosition?: "left" | "right";
  /** Hide at the `lg` breakpoint and up. */
  readonly hideOnDesktop?: boolean;
  /** Hide below the `lg` breakpoint. */
  readonly hideOnMobile?: boolean;
  /** Hover/focus hint. Strongly recommended for icon-only buttons. */
  readonly tooltip?: string;
  /** Edge the tooltip opens toward; defaults to `top`. */
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

/**
 * A button with typed variant/size, optional leading or trailing icon, and an optional tooltip.
 *
 * @example
 * <Button variant="primary" iconName="plus" onClick={create}>New post</Button>
 */
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
  ariaKeyShortcuts,
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
      aria-keyshortcuts={ariaKeyShortcuts}
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

/** Props for {@link LinkButton}. */
type LinkButtonProps = {
  /** Destination passed to the framework `Link`. */
  readonly href: string;
  /** Visual intent; defaults to `primary`. */
  readonly variant?: ButtonVariant;
  /** Control height; defaults to `md`. */
  readonly size?: ButtonSize;
  readonly children?: ReactNode;
  /** Hide below the `lg` breakpoint. */
  readonly hideOnMobile?: boolean;
  /** Registered icon name to render before the label. */
  readonly iconName?: string;
  /** Accessible name; required when icon-only. */
  readonly ariaLabel?: string;
  /** Native hover hint. Recommended for icon-only link buttons. */
  readonly tooltip?: string;
};

/**
 * A navigation link styled as a button, for routing instead of firing an action.
 *
 * @example
 * <LinkButton href="/posts/new" iconName="plus">New post</LinkButton>
 */
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
