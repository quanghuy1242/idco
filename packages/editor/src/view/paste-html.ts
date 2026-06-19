/**
 * Rich HTML paste → model, through one sanitization boundary (docs/010 Phase 8
 * AC8, §10.5 sanitization).
 *
 * Pasted HTML is untrusted. `sanitizeHtmlToCompat` is the single boundary: it
 * parses the HTML, walks an allowlist of block and inline elements, and emits
 * `RichTextCompatNode`s the engine already ingests — never touching script,
 * style, event-handler attributes, or `javascript:`/`data:` URLs. Nothing
 * author- or paste-derived reaches the model except through this function, so
 * the model never trusts the clipboard DOM.
 *
 * Inline formatting is collapsed onto the compat `format` bitmask (the shape
 * `compat.ts` reads), and links become `link` nodes with a sanitized href, so
 * the existing compat importer reconstructs the range marks. Block structure maps
 * to paragraph/heading/quote/listitem; everything else degrades to a paragraph or
 * is dropped, never executed.
 */
import { TEXT_FORMAT, safeHref, type RichTextCompatNode } from "../core";

type Format = number;

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "LI",
  "PRE",
]);

/** Add the format bit for an inline formatting element, if any. */
function formatForTag(tag: string): Format {
  switch (tag) {
    case "B":
    case "STRONG":
      return TEXT_FORMAT.bold;
    case "I":
    case "EM":
      return TEXT_FORMAT.italic;
    case "U":
      return TEXT_FORMAT.underline;
    case "S":
    case "STRIKE":
    case "DEL":
      return TEXT_FORMAT.strikethrough;
    case "CODE":
      return TEXT_FORMAT.code;
    case "MARK":
      return TEXT_FORMAT.highlight;
    case "SUB":
      return TEXT_FORMAT.subscript;
    case "SUP":
      return TEXT_FORMAT.superscript;
    default:
      return 0;
  }
}

/** Collect the inline children of a block element as compat text/link nodes. */
function collectInline(
  node: Node,
  format: Format,
  out: RichTextCompatNode[],
): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === child.TEXT_NODE) {
      const text = child.textContent ?? "";
      if (text.length > 0) out.push({ format, text, type: "text" });
      continue;
    }
    if (child.nodeType !== child.ELEMENT_NODE) continue;
    const element = child as Element;
    const tag = element.tagName;
    if (tag === "BR") {
      out.push({ format, text: "\n", type: "text" });
      continue;
    }
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") continue;
    if (tag === "A") {
      const href = safeHref(element.getAttribute("href"));
      const children: RichTextCompatNode[] = [];
      collectInline(element, format, children);
      if (href) out.push({ children, type: "link", url: href });
      else out.push(...children);
      continue;
    }
    collectInline(element, format | formatForTag(tag), out);
  }
}

function headingTag(tag: string): string {
  return /^H[1-6]$/.test(tag) ? tag.toLowerCase() : "h2";
}

/** Map a block element to its compat block node(s). */
function blockNodeFor(element: Element): RichTextCompatNode | null {
  const tag = element.tagName;
  const children: RichTextCompatNode[] = [];
  collectInline(element, 0, children);
  if (children.length === 0) return null;
  if (/^H[1-6]$/.test(tag)) {
    return { children, tag: headingTag(tag), type: "heading" };
  }
  if (tag === "BLOCKQUOTE") return { children, type: "quote" };
  if (tag === "LI") return { children, type: "listitem" };
  if (tag === "PRE") {
    // A code block pastes as a code-block object carrying its text.
    return { text: element.textContent ?? "", type: "code-block" };
  }
  return { children, type: "paragraph" };
}

/** Walk the sanitized DOM, emitting one compat block per block element. */
function walkBlocks(root: Node, out: RichTextCompatNode[]): void {
  for (let child = root.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === child.TEXT_NODE) {
      const text = (child.textContent ?? "").trim();
      if (text.length > 0) {
        out.push({
          children: [{ format: 0, text, type: "text" }],
          type: "paragraph",
        });
      }
      continue;
    }
    if (child.nodeType !== child.ELEMENT_NODE) continue;
    const element = child as Element;
    const tag = element.tagName;
    if (
      tag === "SCRIPT" ||
      tag === "STYLE" ||
      tag === "NOSCRIPT" ||
      tag === "HEAD"
    ) {
      continue;
    }
    if (tag === "UL" || tag === "OL") {
      walkBlocks(element, out); // emit each <li>
      continue;
    }
    if (BLOCK_TAGS.has(tag)) {
      const node = blockNodeFor(element);
      if (node) out.push(node);
      continue;
    }
    // A wrapper (BODY, SECTION, ARTICLE, SPAN at top level, …): recurse so its
    // block descendants are still imported, never executed.
    walkBlocks(element, out);
  }
}

/**
 * Parse and sanitize pasted HTML into compat block nodes. Returns an empty array
 * when there is no usable content. This is the only path paste-HTML takes into
 * the model (the single sanitization boundary, §10.5).
 */
export function sanitizeHtmlToCompat(html: string): RichTextCompatNode[] {
  if (typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: RichTextCompatNode[] = [];
  walkBlocks(doc.body, out);
  return out;
}
