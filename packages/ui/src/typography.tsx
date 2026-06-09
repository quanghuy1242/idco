// Pure Tailwind type scale — no DaisyUI component. Token values from globals.css via text-base-content.
import type { ElementType, ReactNode } from "react";

type TextVariant = "h1" | "h2" | "h3" | "body" | "caption";

type TextProps = {
  readonly variant?: TextVariant;
  readonly as?: ElementType;
  readonly mono?: boolean;
  readonly children?: ReactNode;
};

const textClasses: Record<TextVariant, string> = {
  h1: "text-2xl font-bold leading-tight text-base-content m-0",
  h2: "text-xl font-semibold leading-tight text-base-content m-0",
  h3: "text-lg font-semibold leading-tight text-base-content m-0",
  body: "text-base font-normal leading-relaxed text-base-content m-0",
  caption: "text-sm font-normal text-base-content/70 m-0",
};

const defaultElement: Record<TextVariant, ElementType> = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
  body: "p",
  caption: "p",
};

export function Text({ variant = "body", as, mono, children }: TextProps) {
  const Component = as ?? defaultElement[variant];
  const className = mono
    ? `${textClasses[variant]} font-mono break-all`
    : textClasses[variant];
  return <Component className={className}>{children}</Component>;
}

type HeadingProps = {
  readonly level?: "h1" | "h2" | "h3";
  readonly children?: ReactNode;
};

export function Heading({ level = "h2", children }: HeadingProps) {
  return <Text variant={level}>{children}</Text>;
}
