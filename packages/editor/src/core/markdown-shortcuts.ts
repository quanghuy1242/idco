/**
 * Markdown / auto-format input shortcuts (docs/010 Phase 8 AC8).
 *
 * Pure detection: given a leaf's text and the caret offset right after an input,
 * decide whether a markdown affordance fired. The view runs this after each text
 * update and translates the result into commands (block prefixes compile to
 * `set-block-type` after deleting the prefix; inline code to `toggle-mark`),
 * built on the Phase 5.5 command layer. Keeping detection pure makes it testable
 * without the DOM and reusable wherever input lands.
 *
 * Smart-quote substitution and bracket auto-pairing are named in AC8 but are a
 * typing-loop refinement (they mutate as you type, across the IME path); they are
 * the docs/010 Phase 9 follow-on, not implemented here.
 */
import type { TextLeafType } from "./model";

/** A block-prefix shortcut: strip `[0, removeTo)` and retype the block. */
export type BlockShortcut = {
  readonly kind: "block";
  readonly removeTo: number;
  readonly blockType: TextLeafType;
  readonly tag?: string;
};

/** An inline-code shortcut: wrap `[from, to)` as code and remove both backticks. */
export type InlineCodeShortcut = {
  readonly kind: "inline-code";
  readonly openBacktick: number;
  readonly closeBacktick: number;
};

export type MarkdownShortcut = BlockShortcut | InlineCodeShortcut;

const BLOCK_PREFIXES: readonly {
  readonly prefix: string;
  readonly blockType: TextLeafType;
  readonly tag?: string;
}[] = [
  { blockType: "heading", prefix: "# ", tag: "h1" },
  { blockType: "heading", prefix: "## ", tag: "h2" },
  { blockType: "heading", prefix: "### ", tag: "h3" },
  { blockType: "listitem", prefix: "- " },
  { blockType: "listitem", prefix: "* " },
  { blockType: "listitem", prefix: "1. " },
  { blockType: "quote", prefix: "> " },
];

/**
 * Detect a markdown shortcut at `caret` in `text`. Block prefixes fire only when
 * the caret sits just after the prefix at the start of an as-yet-unconverted
 * block; inline code fires when a closing backtick just completed a `` `x` `` run.
 */
export function detectMarkdownShortcut(
  text: string,
  caret: number,
  currentType: TextLeafType,
): MarkdownShortcut | null {
  // Block prefix: caret right after "PREFIX" at offset 0, and not already that
  // type with no extra prefix text (so it does not re-fire mid-edit).
  for (const entry of BLOCK_PREFIXES) {
    if (caret === entry.prefix.length && text.startsWith(entry.prefix)) {
      // A list/quote/paragraph already of the target type still converts so the
      // visible prefix is stripped; a no-op is filtered by the command compiler.
      return {
        blockType: entry.blockType,
        kind: "block",
        removeTo: entry.prefix.length,
        ...(entry.tag ? { tag: entry.tag } : {}),
      };
    }
  }
  void currentType;
  // Inline code: the char before the caret is a backtick closing a non-empty run
  // opened by an earlier backtick on the same line (no backticks between them).
  if (caret >= 2 && text[caret - 1] === "`") {
    const close = caret - 1;
    const lineStart = text.lastIndexOf("\n", close - 1) + 1;
    const open = text.lastIndexOf("`", close - 1);
    if (open >= lineStart && close - open >= 2) {
      return { closeBacktick: close, kind: "inline-code", openBacktick: open };
    }
  }
  return null;
}
