/**
 * The shared markdown ↔ native-node correspondence (docs/030 §5.2 D2, MIO).
 *
 * Why this file exists
 * --------------------
 * Markdown import (`from-markdown.ts`) and export (`to-markdown.ts`) are two separate
 * mappers — import builds native `EditorNode`s from a token stream, export reads a snapshot
 * and emits text — but they must *agree* on which node type / mark kind maps to which
 * markdown construct, or a round-trip silently corrupts. D2's resolution is one declarative
 * correspondence both directions consult (held honest by a round-trip test), not a single
 * bidirectional function object: the two operations have genuinely different shapes, so a
 * shared spec + test is the right coupling, not a forced shared code path.
 *
 * This module is that spec: the inline-mark ↔ marker table, the heading/list markers, the
 * `:::` directive grammar for objects markdown has no native syntax for (callouts, TOC),
 * and the *documented lossy set* — the model constructs markdown cannot carry. Export is a
 * lossy one-way projection (D2): a construct in the lossy set is emitted as a documented
 * placeholder or as its bare text, never silently mangled; the lossless path for in-app
 * copy/paste is the native snapshot fragment (`native-clipboard.ts`), not markdown.
 *
 * Markdown stays out of `core/**` (this document's assumption): this lives in the view
 * layer even though it touches no DOM, because the markdown vocabulary is an
 * interop/transport concern, not part of the framework-free engine spine.
 */
import type { TextMarkKind } from "../../core";

/**
 * @categoryDefault Markdown I/O
 */

/**
 * Inline format marks that map to a symmetric markdown wrapper. Ordered so the export
 * serializer opens/closes them deterministically (outer→inner) and the order matches the
 * typing detector's `MARK_PAIRS` precedence so import and the live affordance agree. `code`
 * and `link` are NOT here — code uses a non-nesting backtick wrapper and link uses
 * `[text](href)` bracket syntax, both handled specially in each direction.
 */
export const MARK_MARKERS = [
  { kind: "bold", marker: "**" },
  { kind: "strikethrough", marker: "~~" },
  { kind: "highlight", marker: "==" },
  { kind: "italic", marker: "*" },
] as const satisfies ReadonlyArray<{
  readonly kind: TextMarkKind;
  readonly marker: string;
}>;

/** Inline code wrapper. Code spans cannot carry other inline marks (markdown limitation). */
export const INLINE_CODE_MARKER = "`";

/** The directive fence for objects/containers with no native markdown syntax (`:::tone`). */
export const DIRECTIVE_FENCE = ":::";

/** Callout tones the `:::tone` directive accepts; an unknown tone falls back to `info`. */
export const CALLOUT_TONES = ["info", "success", "warning", "error"] as const;

/** One of the callout tones the `:::tone` directive accepts (`info`, `success`, `warning`, `error`). */
export type CalloutTone = (typeof CALLOUT_TONES)[number];

/** Coerce an arbitrary value to a valid {@link CalloutTone}, defaulting to `info`. */
export function normalizeCalloutTone(value: unknown): CalloutTone {
  return typeof value === "string" &&
    (CALLOUT_TONES as readonly string[]).includes(value)
    ? (value as CalloutTone)
    : "info";
}

/**
 * The documented lossy set (D2): model constructs markdown cannot represent. Export drops
 * these to bare text (the mark) or a placeholder (the object), never corrupting structure;
 * the native clipboard fragment carries them losslessly for in-app paste. Import never
 * produces them (no markdown syntax maps to them). This array is the asserted contract the
 * export test pins so the lossy set cannot silently grow.
 */
export const MARKDOWN_LOSSY_MARK_KINDS: readonly TextMarkKind[] = [
  "underline",
  "subscript",
  "superscript",
  "comment",
  "glossary",
];

/** A heading tag (`h1`..`h6`) → its markdown hash prefix (`#`..`######`). */
export function headingHashesForTag(tag: unknown): string {
  const match = typeof tag === "string" ? /^h([1-6])$/i.exec(tag) : null;
  const level = match ? Number(match[1]) : 1;
  return "#".repeat(level);
}

/** A markdown heading level (1..6) → the editor heading `tag` (`h1`..`h6`). */
export function headingTagForLevel(level: number): string {
  const clamped = Math.min(6, Math.max(1, Math.trunc(level)));
  return `h${clamped}`;
}

/**
 * Heuristic for whether a `text/plain` payload is markdown, so paste can opt into parsing it
 * (docs/030 §7.1). Conservative: it must carry a structural marker (heading, list, fence,
 * blockquote, rule, or a `[text](url)` link) — plain prose never trips it, so a literal paste
 * stays literal. Lives here (parser-free) so the clipboard controller imports it without
 * pulling the lazy `markdown-it` parser into the initial bundle.
 */
export function looksLikeMarkdown(text: string): boolean {
  return (
    /^#{1,6}\s/m.test(text) ||
    /^\s*([-*+]|\d+\.)\s/m.test(text) ||
    /^\s*>\s/m.test(text) ||
    /```/.test(text) ||
    /^\s*([-*_]){3,}\s*$/m.test(text) ||
    /\[[^\]]+\]\([^)]+\)/.test(text)
  );
}

/** Parse a leading `:::tone` opener line into its tone, or null when not a callout opener. */
export function parseCalloutOpener(line: string): CalloutTone | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(DIRECTIVE_FENCE)) return null;
  const rest = trimmed.slice(DIRECTIVE_FENCE.length).trim();
  if (rest.length === 0) return null;
  if (rest === "toc") return null; // a TOC directive, not a callout
  return normalizeCalloutTone(rest);
}
