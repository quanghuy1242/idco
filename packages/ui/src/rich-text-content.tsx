// DaisyUI 5: https://daisyui.com/components/alert/
// DaisyUI 5: https://daisyui.com/components/badge/
// DaisyUI 5: https://daisyui.com/components/card/
"use client";

import type { ReactNode } from "react";
import { Link as AriaLink } from "react-aria-components";
import { Alert, type AlertTone } from "./alert";
import { Badge } from "./badge";
import { CodeEditor, type CodeEditorLanguage } from "./code-editor";
import { Text } from "./typography";

export type RichTextHeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
export type RichTextListKind = "bullet" | "number";

type RichTextChildrenProps = {
  readonly children?: ReactNode;
};

export function RichTextArticle({ children }: RichTextChildrenProps) {
  return (
    <article className="flex flex-col gap-3 text-base leading-6 text-base-content [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>h1:not(:first-child)]:mt-3 [&>h2:not(:first-child)]:mt-3 [&>h3:not(:first-child)]:mt-2 [&>h4:not(:first-child)]:mt-2 [&>h5:not(:first-child)]:mt-2 [&>h6:not(:first-child)]:mt-2">
      {children}
    </article>
  );
}

export function RichTextParagraph({ children }: RichTextChildrenProps) {
  return (
    <p className="m-0 text-base leading-6 text-base-content">{children}</p>
  );
}

export function RichTextHeading({
  level,
  children,
}: RichTextChildrenProps & {
  readonly level: RichTextHeadingLevel;
}) {
  return (
    <Text variant={level} as={level}>
      {children}
    </Text>
  );
}

export function RichTextCallout({
  tone = "info",
  children,
}: RichTextChildrenProps & {
  readonly tone?: AlertTone;
}) {
  return <Alert tone={tone}>{children}</Alert>;
}

export function RichTextBlockquote({ children }: RichTextChildrenProps) {
  return (
    <blockquote className="m-0 border-l-4 border-base-300 py-1 pl-4 leading-6 italic text-base-content/80">
      {children}
    </blockquote>
  );
}

export function RichTextList({
  kind,
  start,
  children,
}: RichTextChildrenProps & {
  readonly kind: RichTextListKind;
  readonly start?: number;
}) {
  if (kind === "number") {
    return (
      <ol
        className="m-0 ml-5 list-decimal space-y-1 text-base leading-6 text-base-content"
        start={start}
      >
        {children}
      </ol>
    );
  }
  return (
    <ul className="m-0 ml-5 list-disc space-y-1 text-base leading-6 text-base-content">
      {children}
    </ul>
  );
}

export function RichTextListItem({ children }: RichTextChildrenProps) {
  return <li>{children}</li>;
}

export function RichTextInlineLink({
  href,
  children,
}: RichTextChildrenProps & {
  readonly href: string;
}) {
  return (
    <AriaLink href={href} className="link link-primary">
      {children}
    </AriaLink>
  );
}

export function RichTextInlineCode({ children }: RichTextChildrenProps) {
  return (
    <code className="rounded bg-base-200 px-1 py-0.5 font-mono text-[0.9em] text-base-content">
      {children}
    </code>
  );
}

export function RichTextStrong({ children }: RichTextChildrenProps) {
  return <strong className="font-bold">{children}</strong>;
}

export function RichTextEmphasis({ children }: RichTextChildrenProps) {
  return <em className="italic">{children}</em>;
}

export function RichTextUnderline({ children }: RichTextChildrenProps) {
  return <u className="underline">{children}</u>;
}

export function RichTextStrikethrough({ children }: RichTextChildrenProps) {
  return <s className="line-through">{children}</s>;
}

export function RichTextHighlight({ children }: RichTextChildrenProps) {
  return <mark className="rounded px-1">{children}</mark>;
}

export function RichTextMediaFigure({
  alt,
  caption,
  src,
}: {
  readonly alt?: string;
  readonly caption?: string;
  readonly src: string;
}) {
  return (
    <figure className="m-0 overflow-hidden rounded-box border border-base-300 bg-base-200">
      <img
        alt={alt ?? ""}
        className="max-h-96 w-full object-contain"
        src={src}
      />
      {caption ? (
        <figcaption className="border-t border-base-300 px-3 py-2 text-sm text-base-content/60">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

export function RichTextEmbed({
  title,
  url,
}: {
  readonly title?: string;
  readonly url: string;
}) {
  return (
    <figure className="m-0 overflow-hidden rounded-box border border-base-300 bg-base-200">
      <iframe
        className="aspect-video w-full"
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-popups allow-forms allow-presentation"
        src={url}
        title={title ?? "Embedded content"}
      />
    </figure>
  );
}

export function RichTextPostReference({
  href,
  label,
  postId,
}: {
  readonly href?: string;
  readonly label: string;
  readonly postId?: string;
}) {
  if (!href) {
    return (
      <span data-post-id={postId}>
        <Badge>{label}</Badge>
      </span>
    );
  }
  return (
    <AriaLink
      href={href}
      data-post-id={postId}
      className="card card-border bg-base-100 transition hover:border-primary"
    >
      <span className="card-body gap-1 p-4">
        <span className="text-xs font-semibold uppercase text-base-content/50">
          Read next
        </span>
        <span className="link link-primary">{label}</span>
      </span>
    </AriaLink>
  );
}

export function RichTextCodeBlock({
  language = "text",
  value,
}: {
  readonly language?: CodeEditorLanguage;
  readonly value: string;
}) {
  return (
    <CodeEditor
      label="Code content"
      value={value}
      language={language}
      readOnly
      maxHeight="lg"
      onChange={() => {}}
    />
  );
}
