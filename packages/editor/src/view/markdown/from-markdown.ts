/**
 * Markdown → native nodes import (docs/030 §7.1 D1, MIO-1).
 *
 * Parses markdown to a `markdown-it` token stream (CommonMark + GFM tables/strikethrough,
 * plus `markdown-it-mark` for `==highlight==`) and maps the tokens to native `EditorNode`s —
 * NOT through compat, NOT through HTML (D1: compat is being deleted; the HTML hop double-
 * parses and re-introduces compat). Marks are built natively the way the command layer
 * builds them (`boundaryAtOffset` over the leaf content), so a pasted bold run is identical
 * to a typed one. Objects (code fence, hr, TOC) are built through the registry's
 * `normalizeData` + `bakeObjectData`, so a pasted code block is the same shape as an inserted
 * one. Structural containers (callout via `:::tone`, a block-bearing list item) build the
 * same shapes `importListItemChildren` / the structural definitions produce.
 *
 * Output is a *snapshot fragment* (`{ order, blocks }`) rather than a flat node list:
 * structural nodes reference descendants by id, and those descendants live in `blocks` but
 * not in `order`. `compileInsertFragment` (core) inserts each top-level subtree
 * descendant-aware. `markdown-it` is a view-layer dependency (markdown stays out of
 * `core/**`); the clipboard lazy-loads *this module* on first paste so the parser is not in
 * the initial bundle.
 *
 * Scope/lossy notes (D2 / §9): a markdown table is dropped on paste with a logged note (the
 * structural-table subtree build is deferred; export still emits GFM); raw HTML never reaches
 * the model (`html: false`); an unsafe link href is cleared by `safeHref`. The lossless
 * in-app path is the native clipboard fragment.
 */
import MarkdownIt from "markdown-it";
import markdownItMark from "markdown-it-mark";
import type Token from "markdown-it/lib/token.mjs";
import {
  bakeObjectData,
  boundaryAtOffset,
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  safeHref,
  type BlockRegistry,
  type EditorNode,
  type IdAllocator,
  type JsonObject,
  type JsonValue,
  type NodeId,
  type TextContent,
  type TextLeafType,
  type TextMark,
  type TextMarkKind,
} from "../../core";
import {
  headingTagForLevel,
  looksLikeMarkdown,
  normalizeCalloutTone,
} from "./transformers";

// Re-export so callers that already depend on the (lazy) parser module keep importing the
// heuristic from here; the canonical definition is parser-free in `transformers.ts`.
export { looksLikeMarkdown };

/** A native snapshot fragment: top-level `order` plus every node (descendants included). */
export type MarkdownFragment = {
  readonly order: readonly NodeId[];
  readonly blocks: Readonly<Record<NodeId, EditorNode>>;
  /** Diagnostics for dropped/lossy constructs (e.g. a dropped table). */
  readonly dropped: readonly string[];
};

/** Build context threaded through the walk: id/mark minting, the registry, the block sink. */
type BuildContext = {
  readonly allocator: IdAllocator;
  readonly registry: BlockRegistry;
  readonly blocks: Record<NodeId, EditorNode>;
  markId(): string;
  /** Register a node into the fragment and return it (so callers keep the typed reference). */
  register<T extends EditorNode>(node: T): T;
  readonly dropped: string[];
};

/** A mark range collected during inline parsing, before it is anchored to the leaf. */
type PendingMark = {
  readonly kind: TextMarkKind;
  readonly from: number;
  to: number;
  readonly attrs?: JsonObject;
};

let cachedMd: MarkdownIt | null = null;

/**
 * The `:::tone` / `:::toc` directive block rule (D2 grammar). markdown-it has no directive
 * syntax, so this minimal container rule emits `idco_directive_open`/`_close` around the
 * inner block tokens (parsed recursively), with `info` carrying the tone or `toc`. Kept here,
 * not as a dependency, so the directive grammar lives next to the correspondence.
 */
function directivePlugin(md: MarkdownIt): void {
  md.block.ruler.before(
    "fence",
    "idco_directive",
    (state, startLine, endLine, silent) => {
      const start = state.bMarks[startLine]! + state.tShift[startLine]!;
      const max = state.eMarks[startLine]!;
      if (start + 3 > max) return false;
      if (state.src.slice(start, start + 3) !== ":::") return false;
      const params = state.src.slice(start + 3, max).trim();
      if (params.length === 0) return false;
      if (silent) return true;
      let nextLine = startLine;
      let haveEnd = false;
      while (++nextLine < endLine) {
        const lineStart = state.bMarks[nextLine]! + state.tShift[nextLine]!;
        const lineMax = state.eMarks[nextLine]!;
        if (state.src.slice(lineStart, lineMax).trim() === ":::") {
          haveEnd = true;
          break;
        }
      }
      const open = state.push("idco_directive_open", "div", 1);
      open.info = params;
      open.map = [startLine, nextLine];
      const stateWithParent = state as unknown as { parentType: string };
      const oldParent = stateWithParent.parentType;
      const oldLineMax = state.lineMax;
      stateWithParent.parentType = "idco_directive";
      state.lineMax = nextLine;
      state.md.block.tokenize(state, startLine + 1, nextLine);
      stateWithParent.parentType = oldParent;
      state.lineMax = oldLineMax;
      state.push("idco_directive_close", "div", -1);
      state.line = haveEnd ? nextLine + 1 : nextLine;
      return true;
    },
  );
}

function getMarkdownIt(): MarkdownIt {
  if (cachedMd) return cachedMd;
  // The "default" preset enables GFM tables + strikethrough; `html:false` keeps raw HTML out
  // of the model (escaped to text, never parsed — §9). linkify off so only explicit
  // links/autolinks become link marks, matching the typing detector.
  const md = new MarkdownIt("default", { html: false, linkify: false });
  md.use(markdownItMark);
  md.use(directivePlugin);
  cachedMd = md;
  return md;
}

/**
 * Parse markdown into a native fragment. `allocator`/`registry` come from the store so ids
 * are store-unique and objects bake through the same registry as inserts.
 */
export function markdownToNodes(
  src: string,
  allocator: IdAllocator,
  registry: BlockRegistry,
): MarkdownFragment {
  const md = getMarkdownIt();
  const tokens = md.parse(src, {});
  const blocks: Record<NodeId, EditorNode> = {};
  let markCounter = 0;
  const ctx: BuildContext = {
    allocator,
    blocks,
    dropped: [],
    markId: () => `${allocator.clientId}_mdmark_${(markCounter += 1)}`,
    register(node) {
      blocks[node.id] = node;
      return node;
    },
    registry,
  };
  const top = parseBlocks(tokens, 0, tokens.length, ctx, 0);
  return { blocks, dropped: ctx.dropped, order: top.map((n) => n.id) };
}

/**
 * Walk a block-token slice `[start, end)` into the nodes at that level (top-level for the
 * document, or the direct children of a container). Every produced node — and every
 * descendant — is registered in `ctx.blocks`; the returned array is only the level order.
 */
function parseBlocks(
  tokens: readonly Token[],
  start: number,
  end: number,
  ctx: BuildContext,
  depth: number,
): EditorNode[] {
  const out: EditorNode[] = [];
  let i = start;
  while (i < end) {
    const token = tokens[i]!;
    switch (token.type) {
      case "heading_open": {
        const level = Number(token.tag.replace(/^h/, "")) || 1;
        out.push(
          buildLeaf(ctx, "heading", tokens[i + 1], {
            tag: headingTagForLevel(level),
          }),
        );
        i = closeOf(tokens, i, "heading_open", "heading_close") + 1;
        continue;
      }
      case "paragraph_open": {
        out.push(buildLeaf(ctx, "paragraph", tokens[i + 1], {}));
        i = closeOf(tokens, i, "paragraph_open", "paragraph_close") + 1;
        continue;
      }
      case "blockquote_open": {
        const close = closeOf(tokens, i, "blockquote_open", "blockquote_close");
        // Flat quote model: inner paragraphs become `quote` leaves; non-paragraph children
        // are appended as their own blocks after.
        for (const node of parseBlocks(tokens, i + 1, close, ctx, depth)) {
          if (node.kind === "text" && node.type === "paragraph") {
            out.push(ctx.register({ ...node, type: "quote" }));
          } else {
            out.push(node);
          }
        }
        i = close + 1;
        continue;
      }
      case "bullet_list_open":
      case "ordered_list_open": {
        const listType =
          token.type === "ordered_list_open" ? "number" : "bullet";
        const close = closeOf(
          tokens,
          i,
          token.type,
          token.type === "ordered_list_open"
            ? "ordered_list_close"
            : "bullet_list_close",
        );
        out.push(...parseList(tokens, i + 1, close, ctx, depth, listType));
        i = close + 1;
        continue;
      }
      case "fence":
      case "code_block": {
        out.push(
          buildObjectNode(ctx, "code-block", {
            code: token.content.replace(/\n$/, ""),
            language: token.info.trim().split(/\s+/)[0] || "",
          }),
        );
        i += 1;
        continue;
      }
      case "hr": {
        out.push(buildObjectNode(ctx, "divider", {}));
        i += 1;
        continue;
      }
      case "idco_directive_open": {
        const close = closeOf(
          tokens,
          i,
          "idco_directive_open",
          "idco_directive_close",
        );
        const info = token.info.trim();
        if (info === "toc") {
          out.push(buildObjectNode(ctx, "table-of-contents", {}));
        } else {
          const inner = parseBlocks(tokens, i + 1, close, ctx, depth);
          out.push(buildCallout(ctx, normalizeCalloutTone(info), inner));
        }
        i = close + 1;
        continue;
      }
      case "table_open": {
        // The structural-table subtree build is deferred (§7.1): drop with a note rather
        // than mangle into cell text. Export still emits GFM tables.
        ctx.dropped.push("table");
        i = closeOf(tokens, i, "table_open", "table_close") + 1;
        continue;
      }
      default:
        i += 1;
    }
  }
  return out;
}

/** Walk a list's items into level-order nodes (flat leaves + structural block-bearing items). */
function parseList(
  tokens: readonly Token[],
  start: number,
  end: number,
  ctx: BuildContext,
  depth: number,
  listType: "bullet" | "number",
): EditorNode[] {
  const out: EditorNode[] = [];
  let i = start;
  while (i < end) {
    if (tokens[i]!.type !== "list_item_open") {
      i += 1;
      continue;
    }
    const close = closeOf(tokens, i, "list_item_open", "list_item_close");
    out.push(...parseListItem(tokens, i + 1, close, ctx, depth, listType));
    i = close + 1;
  }
  return out;
}

/**
 * One list item → level-order nodes (Option A): its first paragraph is the item's inline
 * text (a `listitem` leaf with `listType`/`checked`/`indent`); nested lists recurse flat at
 * `indent: depth+1`; any *other* block child (a code block, a second paragraph) promotes the
 * item to a structural `listitem` holding the inner leaf + those block children — the
 * `importListItemChildren` shape. Descendants are registered, not returned in level order.
 */
function parseListItem(
  tokens: readonly Token[],
  start: number,
  end: number,
  ctx: BuildContext,
  depth: number,
  listType: "bullet" | "number",
): EditorNode[] {
  const blocks = parseBlocks(tokens, start, end, ctx, depth + 1);
  const firstParaIndex = blocks.findIndex(
    (n) => n.kind === "text" && n.type === "paragraph",
  );
  const firstPara =
    firstParaIndex >= 0
      ? (blocks[firstParaIndex] as Extract<EditorNode, { kind: "text" }>)
      : null;
  const others = blocks.filter((_, idx) => idx !== firstParaIndex);
  const task = firstPara ? detectTaskPrefix(firstPara.content.text) : null;
  const innerAttrs: JsonObject = {
    listType,
    ...(depth > 0 ? { indent: depth } : {}),
    ...(task ? { checked: task.checked } : {}),
  };
  const innerLeaf = ctx.register(
    makeTextNode({
      attrs: innerAttrs,
      content: firstPara
        ? task
          ? ctx.allocator.createTextSlice(
              firstPara.content.text.slice(task.offset),
            )
          : firstPara.content
        : ctx.allocator.createTextSlice(""),
      id: firstPara ? firstPara.id : ctx.allocator.createNodeId(),
      // A stripped `[ ] ` prefix carries no marks in practice; marks (if any) survive by
      // character-id anchor, so they need no re-anchoring here.
      marks: firstPara && !task ? firstPara.marks : [],
      type: "listitem",
    }),
  );
  const nestedListItems: EditorNode[] = [];
  const blockChildren: EditorNode[] = [];
  for (const node of others) {
    if (node.kind === "text" && node.type === "listitem") {
      nestedListItems.push(node);
    } else {
      blockChildren.push(node);
    }
  }
  if (blockChildren.length === 0) return [innerLeaf, ...nestedListItems];
  const container = ctx.register(
    makeStructuralNode({
      children: [innerLeaf.id, ...blockChildren.map((n) => n.id)],
      id: ctx.allocator.createNodeId(),
      type: "listitem",
    }),
  );
  // The container is the level-order sibling; its inner leaf + block children are registered
  // descendants (not in level order). Flat nested-list items stay siblings (Option A).
  return [container, ...nestedListItems];
}

function detectTaskPrefix(
  text: string,
): { readonly checked: boolean; readonly offset: number } | null {
  if (text.startsWith("[ ] ")) return { checked: false, offset: 4 };
  if (text.startsWith("[x] ") || text.startsWith("[X] ")) {
    return { checked: true, offset: 4 };
  }
  return null;
}

/** Build a structural callout from its already-parsed (registered) inner blocks. */
function buildCallout(
  ctx: BuildContext,
  tone: string,
  inner: readonly EditorNode[],
): EditorNode {
  const children =
    inner.length > 0
      ? inner
      : [
          ctx.register(
            makeTextNode({
              content: ctx.allocator.createTextSlice(""),
              id: ctx.allocator.createNodeId(),
              type: "paragraph",
            }),
          ),
        ];
  return ctx.register(
    makeStructuralNode({
      attrs: { tone },
      children: children.map((n) => n.id),
      id: ctx.allocator.createNodeId(),
      type: "callout",
    }),
  );
}

/** Build a text leaf from an inline token, anchoring native marks via `boundaryAtOffset`. */
function buildLeaf(
  ctx: BuildContext,
  type: TextLeafType,
  inline: Token | undefined,
  attrs: JsonObject,
): EditorNode {
  const { text, pending } = inline
    ? parseInline(inline.children ?? [])
    : { pending: [] as PendingMark[], text: "" };
  const content = ctx.allocator.createTextSlice(text);
  return ctx.register(
    makeTextNode({
      ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
      content,
      id: ctx.allocator.createNodeId(),
      marks: anchorMarks(ctx, content, pending),
      type,
    }),
  );
}

/** Anchor pending offset ranges to a leaf's content, dropping empty/inverted ranges. */
function anchorMarks(
  ctx: BuildContext,
  content: TextContent,
  pending: readonly PendingMark[],
): readonly TextMark[] {
  const marks: TextMark[] = [];
  for (const mark of pending) {
    if (mark.to <= mark.from) continue;
    marks.push({
      ...(mark.attrs ? { attrs: mark.attrs } : {}),
      from: boundaryAtOffset(content, mark.from, "before"),
      id: ctx.markId(),
      kind: mark.kind,
      to: boundaryAtOffset(content, mark.to, "after"),
    });
  }
  return marks;
}

const INLINE_MARK_BY_OPEN: Readonly<Record<string, TextMarkKind>> = {
  em_open: "italic",
  mark_open: "highlight",
  s_open: "strikethrough",
  strong_open: "bold",
};

/** Walk an inline token's children into a flat string plus offset-anchored pending marks. */
function parseInline(children: readonly Token[]): {
  readonly text: string;
  readonly pending: PendingMark[];
} {
  let text = "";
  const pending: PendingMark[] = [];
  const open: PendingMark[] = [];
  for (const token of children) {
    if (token.type === "text") {
      text += token.content;
      continue;
    }
    if (token.type === "code_inline") {
      const from = text.length;
      text += token.content;
      pending.push({ from, kind: "code", to: text.length });
      continue;
    }
    if (token.type === "softbreak") {
      text += " ";
      continue;
    }
    if (token.type === "hardbreak") {
      text += "\n";
      continue;
    }
    const markKind = INLINE_MARK_BY_OPEN[token.type];
    if (markKind) {
      open.push({ from: text.length, kind: markKind, to: text.length });
      continue;
    }
    if (token.type === "link_open") {
      const href = safeHref(attrValue(token, "href"));
      open.push({
        ...(href ? { attrs: { href } } : {}),
        from: text.length,
        kind: "link",
        to: text.length,
      });
      continue;
    }
    if (token.type === "link_close") {
      closePending(open, pending, "link", text.length);
      continue;
    }
    if (token.type.endsWith("_close")) {
      closePending(
        open,
        pending,
        INLINE_MARK_BY_OPEN[token.type.replace("_close", "_open")],
        text.length,
      );
      continue;
    }
    // An inline image has no native inline node — keep its alt text, drop the markup.
    if (token.type === "image") text += token.content;
  }
  return { pending, text };
}

function closePending(
  open: PendingMark[],
  pending: PendingMark[],
  kind: TextMarkKind | undefined,
  to: number,
): void {
  if (!kind) return;
  for (let i = open.length - 1; i >= 0; i -= 1) {
    if (open[i]!.kind === kind) {
      const mark = open.splice(i, 1)[0]!;
      mark.to = to;
      pending.push(mark);
      return;
    }
  }
}

function attrValue(token: Token, name: string): string {
  const attrs = token.attrs;
  if (!attrs) return "";
  for (const [key, value] of attrs) if (key === name) return value;
  return "";
}

/** Build an object node through the registry (normalize + bake), as inserts do. */
function buildObjectNode(
  ctx: BuildContext,
  type: string,
  rawData: JsonValue,
): EditorNode {
  const definition = ctx.registry.get(type);
  const normalized = definition?.normalizeData(rawData) ?? { data: rawData };
  const baked = bakeObjectData(ctx.registry, type, normalized.data);
  return ctx.register(
    makeObjectNode({
      ...(baked.baked ? { baked: baked.baked } : {}),
      data: normalized.data,
      id: ctx.allocator.createNodeId(),
      status: baked.status,
      type,
    }),
  );
}

/** Find the matching close index for a balanced open at `openIndex`. */
function closeOf(
  tokens: readonly Token[],
  openIndex: number,
  openType: string,
  closeType: string,
): number {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i += 1) {
    const type = tokens[i]!.type;
    if (type === openType) depth += 1;
    else if (type === closeType) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return tokens.length - 1;
}
