"use client";

import {
  RichTextArticle,
  RichTextBlockquote,
  RichTextCallout,
  RichTextCodeBlock,
  RichTextEmphasis,
  RichTextEmbed,
  RichTextHeading,
  RichTextHighlight,
  RichTextInlineCode,
  RichTextInlineLink,
  RichTextList,
  RichTextListItem,
  RichTextMediaFigure,
  RichTextParagraph,
  RichTextPostReference,
  RichTextStrikethrough,
  RichTextCheckList,
  RichTextCheckListItem,
  RichTextGlossary,
  RichTextMark,
  RichTextStrong,
  RichTextTable,
  RichTextTableCell,
  RichTextTableOfContents,
  RichTextTableRow,
  RichTextTocLayout,
  RichTextTocRail,
  RichTextUnderline,
  type AlertTone,
  type CodeEditorLanguage,
  type RichTextAlign,
  type RichTextHeadingLevel,
  type RichTextListKind,
} from "@quanghuy1242/idco-ui";
import {
  collectRichTextTocEntries,
  ensureRichTextHeadingAnchors,
  normalizeTocSettings,
  richTextNodeText,
} from "@quanghuy1242/idco-lib";
import { Fragment, type ReactNode } from "react";

export type RichTextNode = {
  readonly type?: string;
  readonly text?: string;
  readonly children?: readonly RichTextNode[];
  readonly tag?: string;
  readonly anchorId?: string;
  readonly url?: string;
  readonly language?: string;
  readonly mediaId?: string;
  readonly src?: string;
  readonly alt?: string;
  readonly caption?: string;
  readonly detail?: number;
  readonly format?: number | string;
  readonly listType?: string;
  readonly mode?: string;
  readonly postId?: string;
  readonly previewUrl?: string;
  readonly start?: number;
  readonly style?: string;
  readonly title?: string;
  readonly tone?: string;
  readonly value?: number;
  readonly minLevel?: number;
  readonly maxLevel?: number;
  readonly numbering?: string;
  readonly [key: string]: unknown;
};

export type RichTextDocument = {
  readonly root: {
    readonly children?: readonly RichTextNode[];
  };
};

export type RichTextNodeRenderer = (
  node: RichTextNode,
  children: ReactNode,
  key: string,
) => ReactNode;

export type RichTextRenderOptions = {
  readonly renderers?: Readonly<Record<string, RichTextNodeRenderer>>;
  readonly resolveMedia?: (node: RichTextNode) => {
    readonly src: string;
    readonly alt?: string;
    readonly caption?: string;
  } | null;
  readonly resolvePost?: (node: RichTextNode) => {
    readonly href: string;
    readonly label: string;
  } | null;
  readonly allowedEmbedDomains?: readonly string[];
};

const textFormat = {
  bold: 1,
  italic: 2,
  strikethrough: 4,
  underline: 8,
  code: 16,
  subscript: 32,
  superscript: 64,
  highlight: 128,
} as const;

const defaultRenderers: Readonly<Record<string, RichTextNodeRenderer>> = {
  blockquote: (_node, children, key) => (
    <RichTextBlockquote key={key}>{children}</RichTextBlockquote>
  ),
  callout: (node, children, key) => (
    <RichTextCallout key={key} tone={calloutTone(node.tone)}>
      {children}
    </RichTextCallout>
  ),
  code: renderCodeBlock,
  "code-block": renderCodeBlock,
  embed: (node, _children, key) => {
    const url = stringValue(node.url);
    if (!url) return null;
    if (isPreviewableEmbed(url)) {
      return (
        <RichTextEmbed key={key} title={stringValue(node.title)} url={url} />
      );
    }
    return (
      <RichTextInlineLink key={key} href={url}>
        {stringValue(node.title) ?? url}
      </RichTextInlineLink>
    );
  },
  heading: (node, children, key) => (
    <RichTextHeading
      key={key}
      anchorId={stringValue(node.anchorId)}
      anchorLabel={richTextNodeText(node)}
      level={headingLevel(node.tag)}
      align={elementAlign(node.format)}
    >
      {children}
    </RichTextHeading>
  ),
  linebreak: (_node, _children, key) => <br key={key} />,
  link: (node, children, key) => {
    const url = stringValue(node.url) ?? "#";
    return (
      <RichTextInlineLink key={key} href={url}>
        {children || url}
      </RichTextInlineLink>
    );
  },
  glossary: (node, _children, key) => (
    <RichTextGlossary
      key={key}
      term={stringValue(node.term) ?? ""}
      definition={stringValue(node.definition) ?? ""}
    />
  ),
  list: (node, children, key) => {
    if (node.listType === "check") {
      return <RichTextCheckList key={key}>{children}</RichTextCheckList>;
    }
    return (
      <RichTextList
        key={key}
        kind={listKind(node.listType, node.tag)}
        start={numberValue(node.start)}
      >
        {children}
      </RichTextList>
    );
  },
  listitem: (node, children, key) =>
    typeof node.checked === "boolean" ? (
      <RichTextCheckListItem key={key} checked={node.checked}>
        {children}
      </RichTextCheckListItem>
    ) : (
      <RichTextListItem key={key}>{children}</RichTextListItem>
    ),
  mark: (_node, children, key) => (
    <RichTextMark key={key}>{children}</RichTextMark>
  ),
  media: (node, _children, key) => {
    const src = stringValue(node.src);
    if (!src) return null;
    return (
      <RichTextMediaFigure
        key={key}
        alt={stringValue(node.alt)}
        caption={stringValue(node.caption)}
        src={src}
      />
    );
  },
  paragraph: (node, children, key) => (
    <RichTextParagraph key={key} align={elementAlign(node.format)}>
      {children}
    </RichTextParagraph>
  ),
  "post-ref": (node, _children, key) => renderPostRef(node, key),
  quote: (_node, children, key) => (
    <RichTextBlockquote key={key}>{children}</RichTextBlockquote>
  ),
  root: (_node, children, key) => (
    <RichTextArticle key={key}>{children}</RichTextArticle>
  ),
  table: renderTable,
  // New tables serialize as "editor-table" (carrying layout / row numbers);
  // legacy documents use "table". Both render identically.
  "editor-table": renderTable,
  tablecell: (node, children, key) => (
    <RichTextTableCell
      key={key}
      header={(numberValue(node.headerState) ?? 0) > 0}
    >
      {children}
    </RichTextTableCell>
  ),
  tablerow: (_node, children, key) => (
    <RichTextTableRow key={key}>{children}</RichTextTableRow>
  ),
  text: (node, _children, key) => (
    <Fragment key={key}>{renderTextNode(node)}</Fragment>
  ),
};

export function renderRichTextDocument(
  value: unknown,
  options: RichTextRenderOptions = {},
): ReactNode {
  const root = richTextRoot(value);
  if (!root) return null;
  const document = ensureRichTextHeadingAnchors({
    root: { children: root.children ?? [] },
  });
  const content = renderNode(
    { type: "root", children: document.root.children ?? [] },
    "root",
    {
      ...options,
      renderers: {
        ...defaultRenderers,
        "table-of-contents": (node, _children, key) =>
          renderTableOfContents(node, key, document),
        ...options.renderers,
      },
    },
  );
  // Mirror the editor shell: a `placement: "aside"` TOC is rendered as a sticky
  // side rail beside the article (its in-flow node is hidden at lg+ by
  // renderTableOfContents and shown inline below lg). Editor and renderer share
  // RichTextTocLayout/RichTextTocRail so the two surfaces stay identical.
  const asideNode = (document.root.children ?? []).find(
    (child) =>
      child.type === "table-of-contents" &&
      normalizeTocSettings(child).placement === "aside",
  );
  if (!asideNode) return content;
  const settings = normalizeTocSettings(asideNode);
  return (
    <RichTextTocLayout
      side={settings.side}
      rail={
        <RichTextTocRail
          entries={collectRichTextTocEntries(document, settings)}
          style={settings.style}
          title={settings.title}
        />
      }
    >
      {content}
    </RichTextTocLayout>
  );
}

export function RichTextRenderer({
  value,
  ...options
}: RichTextRenderOptions & { readonly value: unknown }) {
  return <>{renderRichTextDocument(value, options)}</>;
}

function renderNode(
  node: RichTextNode,
  key: string,
  options: RichTextRenderOptions,
): ReactNode {
  const children = (node.children ?? []).map((child, index) =>
    renderNode(child, `${key}.${index}`, options),
  );
  if (node.type === "media" && options.resolveMedia) {
    const media = options.resolveMedia(node);
    if (media) {
      return defaultRenderers.media(
        {
          ...node,
          alt: media.alt ?? node.alt,
          caption: media.caption ?? node.caption,
          src: media.src,
        },
        null,
        key,
      );
    }
  }
  if (node.type === "post-ref" && options.resolvePost) {
    const post = options.resolvePost(node);
    if (post) {
      return renderPostRef({ ...node, title: post.label, url: post.href }, key);
    }
  }
  if (node.type === "embed" && !embedAllowed(node, options)) {
    return children.length > 0 ? children : null;
  }
  const renderer = node.type ? options.renderers?.[node.type] : undefined;
  if (renderer) return renderer(node, children, key);
  if (children.length > 0) return <Fragment key={key}>{children}</Fragment>;
  return <Fragment key={key}>{renderTextNode(node)}</Fragment>;
}

function renderPostRef(node: RichTextNode, key: string): ReactNode {
  const label = stringValue(node.title) ?? stringValue(node.postId) ?? "";
  return (
    <RichTextPostReference
      key={key}
      href={stringValue(node.url)}
      label={label}
      postId={stringValue(node.postId)}
    />
  );
}

function renderTextNode(node: RichTextNode): ReactNode {
  let value: ReactNode = stringValue(node.text) ?? "";
  const format = numberValue(node.format) ?? 0;

  if (format & textFormat.code) {
    value = <RichTextInlineCode>{value}</RichTextInlineCode>;
  }
  if (format & textFormat.bold) {
    value = <RichTextStrong>{value}</RichTextStrong>;
  }
  if (format & textFormat.italic) {
    value = <RichTextEmphasis>{value}</RichTextEmphasis>;
  }
  if (format & textFormat.underline) {
    value = <RichTextUnderline>{value}</RichTextUnderline>;
  }
  if (format & textFormat.strikethrough) {
    value = <RichTextStrikethrough>{value}</RichTextStrikethrough>;
  }
  if (format & textFormat.highlight) {
    value = <RichTextHighlight>{value}</RichTextHighlight>;
  }
  if (format & textFormat.subscript) {
    value = <sub>{value}</sub>;
  }
  if (format & textFormat.superscript) {
    value = <sup>{value}</sup>;
  }

  return value;
}

function richTextRoot(
  value: unknown,
): { readonly children?: readonly RichTextNode[] } | null {
  if (!isRecord(value)) return null;
  const root = value.root;
  if (!isRecord(root)) return null;
  const children = Array.isArray(root.children) ? root.children : [];
  return { children: children.filter(isRichTextNode) };
}

function isRichTextNode(value: unknown): value is RichTextNode {
  return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function numberArray(value: unknown): number[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "number")
    ? (value as number[])
    : undefined;
}

function headingLevel(value: unknown): RichTextHeadingLevel {
  return value === "h1" ||
    value === "h2" ||
    value === "h3" ||
    value === "h4" ||
    value === "h5" ||
    value === "h6"
    ? value
    : "h2";
}

function elementAlign(value: unknown): RichTextAlign | undefined {
  return value === "center" || value === "right" || value === "justify"
    ? value
    : undefined;
}

function calloutTone(value: unknown): AlertTone {
  return value === "success" ||
    value === "warning" ||
    value === "error" ||
    value === "info"
    ? value
    : "info";
}

function listKind(listType: unknown, tag: unknown): RichTextListKind {
  if (listType === "number" || tag === "ol") return "number";
  return "bullet";
}

function isPreviewableEmbed(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function renderTable(node: RichTextNode, children: ReactNode, key: string) {
  return (
    <RichTextTable
      key={key}
      colWidths={numberArray(node.colWidths)}
      layout={stringValue(node.layout)}
      numbered={node.showRowNumbers === true}
    >
      {children}
    </RichTextTable>
  );
}

function renderTableOfContents(
  node: RichTextNode,
  key: string,
  document: RichTextDocument,
) {
  const settings = normalizeTocSettings(node);
  const entries = collectRichTextTocEntries(document, settings);
  const toc = (
    <RichTextTableOfContents
      entries={entries}
      style={settings.style}
      title={settings.title}
    />
  );
  // When pinned aside, the sticky rail renders the TOC at lg+; keep an inline
  // copy for narrow viewports where there is no room for a rail.
  if (settings.placement === "aside") {
    return (
      <div key={key} className="lg:hidden">
        {toc}
      </div>
    );
  }
  return <Fragment key={key}>{toc}</Fragment>;
}

function renderCodeBlock(
  node: RichTextNode,
  _children: ReactNode,
  key: string,
) {
  return (
    <RichTextCodeBlock
      key={key}
      value={stringValue(node.text) ?? ""}
      language={codeEditorLanguage(node.language)}
    />
  );
}

function codeEditorLanguage(value: unknown): CodeEditorLanguage {
  if (
    value === "json" ||
    value === "ts" ||
    value === "tsx" ||
    value === "js" ||
    value === "python" ||
    value === "text"
  ) {
    return value;
  }
  if (value === "typescript") return "ts";
  if (value === "javascript") return "js";
  if (value === "py") return "python";
  return "text";
}

function embedAllowed(
  node: RichTextNode,
  options: RichTextRenderOptions,
): boolean {
  const url = stringValue(node.url);
  if (!url || !options.allowedEmbedDomains?.length) return Boolean(url);
  try {
    return options.allowedEmbedDomains.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
