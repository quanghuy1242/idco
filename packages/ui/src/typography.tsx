// Pure Tailwind type scale — no DaisyUI component. Token values from globals.css via text-base-content.

/**
 * Typographic primitives over the Tailwind type scale, keeping headings and body text consistent.
 *
 * @categoryDefault Typography
 */

import type { ElementType, ReactNode } from "react";

/** Type-scale slot: heading levels `h1`–`h6`, `body`, or `caption`. */
type TextVariant = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "body" | "caption";

/** Props for {@link Text}. */
type TextProps = {
  /** Type-scale slot; defaults to `body`. Selects both styling and the default element. */
  readonly variant?: TextVariant;
  /** Override the rendered element (defaults to the element matching `variant`). */
  readonly as?: ElementType;
  readonly id?: string;
  /** Render in monospace with break-all wrapping (for ids, tokens). */
  readonly mono?: boolean;
  readonly className?: string;
  readonly children?: ReactNode;
};

const textClasses: Record<TextVariant, string> = {
  h1: "text-2xl font-bold leading-tight text-base-content m-0",
  h2: "text-xl font-semibold leading-tight text-base-content m-0",
  h3: "text-lg font-semibold leading-tight text-base-content m-0",
  h4: "text-base font-semibold leading-tight text-base-content m-0",
  h5: "text-sm font-semibold leading-tight text-base-content m-0",
  h6: "text-xs font-semibold uppercase leading-tight text-base-content/70 m-0",
  body: "text-base font-normal leading-relaxed text-base-content m-0",
  caption: "text-sm font-normal text-base-content/70 m-0",
};

const defaultElement: Record<TextVariant, ElementType> = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  body: "p",
  caption: "p",
};

/** Text at a chosen type-scale slot, rendering the matching semantic element with optional monospace. */
export function Text({
  variant = "body",
  as,
  id,
  mono,
  className,
  children,
}: TextProps) {
  const Component = as ?? defaultElement[variant];
  const base = mono
    ? `${textClasses[variant]} font-mono break-all`
    : textClasses[variant];
  return (
    <Component id={id} className={className ? `${base} ${className}` : base}>
      {children}
    </Component>
  );
}

/** Props for {@link Heading}. */
type HeadingProps = {
  /** Heading level; defaults to `h2`. */
  readonly level?: "h1" | "h2" | "h3";
  readonly children?: ReactNode;
};

/** A section heading at level `h1`–`h3`, sharing the `Text` type scale. */
export function Heading({ level = "h2", children }: HeadingProps) {
  return <Text variant={level}>{children}</Text>;
}
