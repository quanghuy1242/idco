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
 * Smart-quote substitution and bracket auto-pairing (docs/018 §2.1) live here
 * too: they are detected the same pure way and gated on the just-typed character
 * so a deletion that leaves the caret after `(` or `"` never retriggers them.
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

/** Replace one character (a straight quote) with its curly form at `at`. */
export type SubstituteShortcut = {
  readonly kind: "substitute";
  readonly at: number;
  readonly to: string;
};

/** Insert a closing partner after the opening char typed at `at` (auto-pairing). */
export type WrapPairShortcut = {
  readonly kind: "wrap-pair";
  readonly at: number;
  readonly open: string;
  readonly close: string;
};

export type MarkdownShortcut =
  | BlockShortcut
  | InlineCodeShortcut
  | SubstituteShortcut
  | WrapPairShortcut;

/** Opening bracket → its closing partner. Backticks are left to inline-code. */
const BRACKET_PAIRS: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "{": "}",
};

const CURLY = {
  doubleClose: "”", // ”
  doubleOpen: "“", // “
  singleClose: "’", // ’
  singleOpen: "‘", // ‘
} as const;

/** A straight quote opens when at the start or after whitespace/an opening char. */
function curlyQuoteFor(text: string, at: number, quote: '"' | "'"): string {
  const before = at > 0 ? text[at - 1] : "";
  const opening =
    before === "" ||
    /\s/.test(before) ||
    before === "(" ||
    before === "[" ||
    before === "{";
  if (quote === '"') return opening ? CURLY.doubleOpen : CURLY.doubleClose;
  return opening ? CURLY.singleOpen : CURLY.singleClose;
}

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
 *
 * `insertedText` is what the triggering input event inserted (the view passes
 * it). The typing affordances — inline code, smart quotes, auto-pairing — fire
 * only when it is a single typed character, so a deletion or a multi-char paste
 * that happens to leave the caret after `` ` `` / `(` / `"` never retriggers
 * them. It is omitted by headless callers (the detector tests), where the
 * text/caret pair is treated as authoritative.
 */
export function detectMarkdownShortcut(
  text: string,
  caret: number,
  currentType: TextLeafType,
  insertedText?: string,
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
  // The typing affordances need a single just-typed character. A multi-char
  // insert (paste) never auto-pairs; a deletion (no inserted text) never fires.
  const typed =
    insertedText === undefined
      ? caret >= 1
        ? text[caret - 1]
        : undefined
      : insertedText.length === 1
        ? insertedText
        : undefined;
  if (typed === undefined) return null;
  // Inline code: the char before the caret is a backtick closing a non-empty run
  // opened by an earlier backtick on the same line (no backticks between them).
  if (caret >= 2 && typed === "`" && text[caret - 1] === "`") {
    const close = caret - 1;
    const lineStart = text.lastIndexOf("\n", close - 1) + 1;
    const open = text.lastIndexOf("`", close - 1);
    if (open >= lineStart && close - open >= 2) {
      return { closeBacktick: close, kind: "inline-code", openBacktick: open };
    }
  }
  const at = caret - 1;
  // Smart quotes: replace the straight quote with its curly form by context.
  if (typed === '"' || typed === "'") {
    return { at, kind: "substitute", to: curlyQuoteFor(text, at, typed) };
  }
  // Bracket auto-pairing: insert the closing partner after the opening char.
  const close = BRACKET_PAIRS[typed];
  if (close !== undefined) {
    return { at, close, kind: "wrap-pair", open: typed };
  }
  return null;
}
