/**
 * Markdown / auto-format input shortcuts (docs/010 Phase 8 AC8; docs/030 §4.1).
 *
 * Pure detection: given a leaf's text and the caret offset right after an input,
 * decide whether a markdown affordance fired. The view runs this after each text
 * update and translates the result into commands (block prefixes compile to
 * `set-block-type` after deleting the prefix; inline marks to `add-mark`), built
 * on the Phase 5.5 command layer. Keeping detection pure makes it testable
 * without the DOM and reusable wherever input lands.
 *
 * Smart-quote substitution and bracket auto-pairing (docs/018 §2.1) live here
 * too: they are detected the same pure way and gated on the just-typed character
 * so a deletion that leaves the caret after `(` or `"` never retriggers them.
 *
 * docs/030 §4.1 widened the surface: h4–h6 headings, task/checklist prefixes, a
 * line→object form (`---`/`***`/`___` → divider, ` ``` ` → code block), the
 * paired-marker inline marks (`**`/`*`/`~~`/`==`), inline links `[text](url)`,
 * and bare-URL autolink. The paired-marker marks generalize the one mechanism
 * inline-code already had — "scan back from the just-typed closing marker to a
 * matching opener on the same line" — into a small marker table rather than a
 * branch per mark (note.md §4.1). Inline-code keeps its own shortcut shape for
 * API stability; its compiler now delegates to the generalized mark-pair path.
 */
import type { TextLeafType, TextMarkKind } from "./model";

/** A block-prefix shortcut: strip `[0, removeTo)` and retype the block. */
export type BlockShortcut = {
  readonly kind: "block";
  readonly removeTo: number;
  readonly blockType: TextLeafType;
  readonly tag?: string;
  /** List flavour for a `listitem` prefix (`- `/`* ` → bullet, `1. ` → number). */
  readonly listType?: string;
  /**
   * Task-list state for a `[ ] `/`[x] ` prefix. Present (even `false`) marks the
   * item as a checklist item; absent leaves it a plain bullet. A non-checklist
   * prefix carries `undefined` so converting a checklist back to a bullet clears
   * the flag (docs/030 §4.3c).
   */
  readonly checked?: boolean;
};

/**
 * A line→object shortcut: replace the whole marker-only leaf with an object node
 * (`---`/`***`/`___` → `divider`, ` ``` ` → `code-block`). Unlike `block`, this
 * does not retype a text leaf — it swaps the leaf for an object, a shape the old
 * detector could not model (docs/030 §4.1).
 */
export type BlockObjectShortcut = {
  readonly kind: "block-object";
  readonly objectType: string;
  /** Strip `[0, removeTo)` (the marker) — always the whole leaf here. */
  readonly removeTo: number;
};

/** An inline-code shortcut: wrap `[from, to)` as code and remove both backticks. */
export type InlineCodeShortcut = {
  readonly kind: "inline-code";
  readonly openBacktick: number;
  readonly closeBacktick: number;
};

/**
 * A paired-marker inline shortcut (docs/030 §4.1): the user typed the last char
 * of a closing marker (`**`/`*`/`~~`/`==`) completing a `MARKER…MARKER` run on
 * the line. The compiler removes both markers and wraps the inner run in
 * `markKind`. The generalization of inline-code to any marker length and mark.
 */
export type MarkPairShortcut = {
  readonly kind: "mark-pair";
  readonly markKind: TextMarkKind;
  /** Offset of the opening marker's first char. */
  readonly openFrom: number;
  /** Offset of the closing marker's first char (`caret - markerLength`). */
  readonly closeFrom: number;
  readonly markerLength: number;
};

/** An inline-link shortcut: `[text](url)` → `text` carrying a `link` mark. */
export type InlineLinkShortcut = {
  readonly kind: "inline-link";
  /** Offset of the opening `[`. */
  readonly from: number;
  /** Offset just past the closing `)` (the caret). */
  readonly to: number;
  readonly text: string;
  readonly url: string;
};

/** An autolink shortcut: a bare URL `[from, to)` gains a `link` mark in place. */
export type AutolinkShortcut = {
  readonly kind: "autolink";
  readonly from: number;
  readonly to: number;
  readonly url: string;
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
  | BlockObjectShortcut
  | InlineCodeShortcut
  | MarkPairShortcut
  | InlineLinkShortcut
  | AutolinkShortcut
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
  readonly listType?: string;
  readonly checked?: boolean;
}[] = [
  { blockType: "heading", prefix: "# ", tag: "h1" },
  { blockType: "heading", prefix: "## ", tag: "h2" },
  { blockType: "heading", prefix: "### ", tag: "h3" },
  { blockType: "heading", prefix: "#### ", tag: "h4" },
  { blockType: "heading", prefix: "##### ", tag: "h5" },
  { blockType: "heading", prefix: "###### ", tag: "h6" },
  // Task-list prefixes. They are bracket-based, not `- [ ] `, because `- `
  // converts to a bullet the instant it is typed (the caret would never reach the
  // brackets). A `[` at the very start of a block is reserved from auto-pairing
  // (see below) so `[ ] ` / `[x] ` can be typed straight through on a paragraph
  // or an existing bullet (docs/030 §4.3c).
  { blockType: "listitem", checked: false, listType: "bullet", prefix: "[ ] " },
  { blockType: "listitem", checked: false, listType: "bullet", prefix: "[] " },
  { blockType: "listitem", checked: true, listType: "bullet", prefix: "[x] " },
  { blockType: "listitem", checked: true, listType: "bullet", prefix: "[X] " },
  { blockType: "listitem", listType: "bullet", prefix: "- " },
  { blockType: "listitem", listType: "bullet", prefix: "* " },
  { blockType: "listitem", listType: "number", prefix: "1. " },
  { blockType: "quote", prefix: "> " },
];

/**
 * Paired inline markers (docs/030 §4.1). Ordered longest-first so `**` is tried
 * before `*` — that, plus the "no marker char inside the run" guard, is what
 * disambiguates bold from italic. Inline-code (`` ` ``) is intentionally absent:
 * it keeps its own shortcut shape for API stability and is detected separately.
 */
const MARK_PAIRS: readonly { marker: string; markKind: TextMarkKind }[] = [
  { marker: "**", markKind: "bold" },
  { marker: "~~", markKind: "strikethrough" },
  { marker: "==", markKind: "highlight" },
  { marker: "*", markKind: "italic" },
];

/** Whole-line horizontal-rule markers (each on its own otherwise-empty line). */
const HR_MARKERS = ["---", "***", "___"];
const CODE_FENCE = "```";

/**
 * Trim trailing characters a bare URL should not swallow (GFM autolink rule), so
 * `https://x.test.` links `https://x.test` and the `.` stays prose. A run of
 * `.,;:!?` is dropped; a trailing `)` is dropped only when it is unbalanced, so a
 * URL whose own path carries a `(…)` group (`…/Foo_(bar)`) keeps its closing
 * paren while a sentence-final `)` does not.
 */
function trimAutolinkUrl(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1]!;
    if (".,;:!?".includes(ch)) {
      end -= 1;
      continue;
    }
    if (ch === ")") {
      const slice = url.slice(0, end);
      const opens = slice.split("(").length - 1;
      const closes = slice.split(")").length - 1;
      if (closes > opens) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
}

/**
 * Find a completed paired-marker run ending at `caret` on the current line, or
 * null. Scans back from the just-typed closing marker to the nearest matching
 * opener — the one mechanism inline-code already used, generalized.
 */
function detectMarkPair(
  text: string,
  caret: number,
  lineStart: number,
): MarkPairShortcut | null {
  const line = text.slice(lineStart, caret);
  for (const { marker, markKind } of MARK_PAIRS) {
    if (!line.endsWith(marker)) continue;
    const length = marker.length;
    const inner = line.slice(0, line.length - length);
    const openIndex = inner.lastIndexOf(marker);
    if (openIndex < 0) continue;
    const content = inner.slice(openIndex + length);
    // Non-empty, no flanking whitespace (CommonMark flanking rule, simplified),
    // and no marker char inside the run (keeps the run unambiguous and is what
    // splits `**bold**` from `*italic*`).
    if (content.length === 0) continue;
    if (/^\s|\s$/.test(content)) continue;
    if (content.includes(marker[0]!)) continue;
    const openFrom = lineStart + openIndex;
    // A single-char marker must be a lone run: a `*` itself preceded by `*` is
    // part of a `**` and must not fire italic.
    if (length === 1 && text[openFrom - 1] === marker) continue;
    return {
      closeFrom: caret - length,
      kind: "mark-pair",
      markKind,
      markerLength: length,
      openFrom,
    };
  }
  return null;
}

/**
 * Detect a markdown shortcut at `caret` in `text`. Block prefixes fire only when
 * the caret sits just after the prefix at the start of an as-yet-unconverted
 * block; inline marks fire when a closing marker just completed a `MARKER…MARKER`
 * run.
 *
 * `insertedText` is what the triggering input event inserted (the view passes
 * it). The typing affordances — inline marks, links, autolink, smart quotes,
 * auto-pairing — fire only when it is a single typed character, so a deletion or
 * a multi-char paste that happens to leave the caret after a marker never
 * retriggers them. It is omitted by headless callers (the detector tests), where
 * the text/caret pair is treated as authoritative.
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
        ...(entry.listType ? { listType: entry.listType } : {}),
        ...(entry.checked !== undefined ? { checked: entry.checked } : {}),
      };
    }
  }
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
  // Line→object: a paragraph whose entire text is a rule/fence marker converts to
  // an object when the marker's final char is typed. Whole-leaf only, so a marker
  // mid-prose never fires (docs/030 §4.1).
  if (currentType === "paragraph" && caret === text.length) {
    if (typed === "`" && text === CODE_FENCE) {
      return {
        kind: "block-object",
        objectType: "code-block",
        removeTo: caret,
      };
    }
    if (
      (typed === "-" || typed === "*" || typed === "_") &&
      HR_MARKERS.includes(text)
    ) {
      return { kind: "block-object", objectType: "divider", removeTo: caret };
    }
  }
  const at = caret - 1;
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  // Inline code: the char before the caret is a backtick closing a non-empty run
  // opened by an earlier backtick on the same line (no backticks between them).
  if (caret >= 2 && typed === "`" && text[caret - 1] === "`") {
    const close = caret - 1;
    const open = text.lastIndexOf("`", close - 1);
    if (open >= lineStart && close - open >= 2) {
      return { closeBacktick: close, kind: "inline-code", openBacktick: open };
    }
  }
  // Paired inline marks (`**`/`*`/`~~`/`==`) on their closing char.
  if (typed === "*" || typed === "~" || typed === "=") {
    const pair = detectMarkPair(text, caret, lineStart);
    if (pair) return pair;
  }
  // Inline link `[text](url)` on the closing `)`.
  if (typed === ")") {
    const line = text.slice(lineStart, caret);
    const match = /\[([^\]\n]+)\]\(([^()\s\n]+)\)$/.exec(line);
    if (match) {
      return {
        from: lineStart + match.index,
        kind: "inline-link",
        text: match[1]!,
        to: caret,
        url: match[2]!,
      };
    }
  }
  // Autolink: a bare http(s) URL immediately followed by the just-typed space.
  // The greedy `[^\s]+` over-captures sentence punctuation (`see https://x.test.`
  // / `(https://x.test)`), so the raw match is trimmed back the GFM way before the
  // mark is placed — the trailing punctuation stays plain text after the link.
  if (typed === " " && caret >= 2) {
    const before = text.slice(lineStart, caret - 1);
    const match = /(?:^|\s)(https?:\/\/[^\s]+)$/.exec(before);
    if (match) {
      const raw = match[1]!;
      const url = trimAutolinkUrl(raw);
      // `https://` alone (everything after the scheme trimmed away) is not a link.
      if (url.length > "https://".length) {
        const from = caret - 1 - raw.length;
        return { from, kind: "autolink", to: from + url.length, url };
      }
    }
  }
  // Smart quotes: replace the straight quote with its curly form by context.
  if (typed === '"' || typed === "'") {
    return { at, kind: "substitute", to: curlyQuoteFor(text, at, typed) };
  }
  // Bracket auto-pairing: insert the closing partner after the opening char. A
  // `[` at the very start of a block is reserved as a task-list marker (see the
  // `[ ] ` prefixes), so it is not auto-paired there — that lets the checklist
  // prefix be typed straight through without a stray `]` fighting it.
  const close = BRACKET_PAIRS[typed];
  if (close !== undefined && !(typed === "[" && at === 0)) {
    return { at, close, kind: "wrap-pair", open: typed };
  }
  return null;
}
