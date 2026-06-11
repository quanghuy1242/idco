import { Fragment, createElement, type ReactNode } from "react";

export type RichTextNode = {
  readonly type?: string;
  readonly text?: string;
  readonly children?: readonly RichTextNode[];
  readonly tag?: string;
  readonly url?: string;
  readonly language?: string;
  readonly mediaId?: string;
  readonly src?: string;
  readonly alt?: string;
  readonly caption?: string;
  readonly postId?: string;
  readonly title?: string;
  readonly tone?: string;
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
  } | null;
  readonly resolvePost?: (node: RichTextNode) => {
    readonly href: string;
    readonly label: string;
  } | null;
  readonly allowedEmbedDomains?: readonly string[];
};

const defaultRenderers: Readonly<Record<string, RichTextNodeRenderer>> = {
  blockquote: (_node, children, key) =>
    createElement("blockquote", { key }, children),
  callout: (node, children, key) =>
    createElement(
      "aside",
      { "data-tone": stringValue(node.tone) ?? "info", key },
      children,
    ),
  code: renderCodeBlock,
  "code-block": renderCodeBlock,
  embed: (node, _children, key) => {
    const url = stringValue(node.url);
    if (!url) return null;
    return createElement("a", { href: url, key, rel: "noreferrer" }, url);
  },
  heading: (node, children, key) => {
    const tag = headingTag(node.tag);
    return createElement(tag, { key }, children);
  },
  linebreak: (_node, _children, key) => createElement("br", { key }),
  link: (node, children, key) => {
    const url = stringValue(node.url) ?? "#";
    return createElement("a", { href: url, key }, children || url);
  },
  list: (node, children, key) =>
    createElement(node.tag === "ol" ? "ol" : "ul", { key }, children),
  listitem: (_node, children, key) => createElement("li", { key }, children),
  media: (node, _children, key) => {
    const src = stringValue(node.src);
    if (!src) return null;
    return createElement("img", {
      alt: stringValue(node.alt) ?? "",
      key,
      src,
    });
  },
  paragraph: (_node, children, key) => createElement("p", { key }, children),
  "post-ref": (node, _children, key) =>
    createElement(
      "span",
      { "data-post-id": stringValue(node.postId), key },
      stringValue(node.title) ?? stringValue(node.postId) ?? "",
    ),
  quote: (_node, children, key) =>
    createElement("blockquote", { key }, children),
  root: (_node, children, key) => createElement(Fragment, { key }, children),
  text: (node, _children, key) =>
    createElement(Fragment, { key }, stringValue(node.text) ?? ""),
};

export function renderRichTextDocument(
  value: unknown,
  options: RichTextRenderOptions = {},
): ReactNode {
  const root = richTextRoot(value);
  if (!root) return null;
  return renderNode({ type: "root", children: root.children ?? [] }, "root", {
    ...options,
    renderers: { ...defaultRenderers, ...options.renderers },
  });
}

export function RichTextRenderer({
  value,
  ...options
}: RichTextRenderOptions & { readonly value: unknown }) {
  return createElement(Fragment, null, renderRichTextDocument(value, options));
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
        { ...node, alt: media.alt, src: media.src },
        null,
        key,
      );
    }
  }
  if (node.type === "post-ref" && options.resolvePost) {
    const post = options.resolvePost(node);
    if (post) {
      return createElement("a", { href: post.href, key }, post.label);
    }
  }
  if (node.type === "embed" && !embedAllowed(node, options)) {
    return children.length > 0 ? children : null;
  }
  const renderer = node.type ? options.renderers?.[node.type] : undefined;
  if (renderer) return renderer(node, children, key);
  if (children.length > 0) return createElement(Fragment, { key }, children);
  return createElement(Fragment, { key }, stringValue(node.text) ?? "");
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

function headingTag(value: unknown): "h1" | "h2" | "h3" | "h4" | "h5" | "h6" {
  return value === "h1" ||
    value === "h2" ||
    value === "h3" ||
    value === "h4" ||
    value === "h5" ||
    value === "h6"
    ? value
    : "h2";
}

function renderCodeBlock(
  node: RichTextNode,
  _children: ReactNode,
  key: string,
) {
  return createElement(
    "pre",
    { "data-language": stringValue(node.language) ?? "text", key },
    createElement("code", null, stringValue(node.text) ?? ""),
  );
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
