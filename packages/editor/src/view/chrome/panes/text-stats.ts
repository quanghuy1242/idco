/**
 * Pure text statistics for the Insights pane (docs/027 §9.4).
 *
 * The Statistics pane is a *renderer, not a calculator* (docs/027 §2.2): it reads the
 * already-built `index.text` rollup (every top-level text block plus each object's
 * `plainText`) and shows counts back. These helpers are the small pure functions that
 * turn that text into the counts — kept framework-free and exported so they are unit
 * tested without rendering, and so "the pane stays correct as the author types"
 * reduces to "the index is live" (the pane just re-derives).
 *
 * The readability score is a Flesch Reading Ease *estimate*: sentence and syllable
 * counts are heuristic (a vowel-group syllable count is the standard cheap
 * approximation), which the doc explicitly allows ("a readability estimate, e.g. a
 * Flesch score"). It is a writing-aid signal, not a certified metric.
 */

/** The derived counts the Statistics pane renders. */
export type TextStats = {
  readonly words: number;
  readonly characters: number;
  /** Characters excluding whitespace. */
  readonly charactersNoSpaces: number;
  readonly sentences: number;
  /** Whole minutes at ~200 wpm, floored to a minimum of 1 when there is any text. */
  readonly readingMinutes: number;
  /** Flesch Reading Ease estimate (0–100+, higher = easier), or null below threshold. */
  readonly readability: number | null;
};

/** Words at ~200 wpm; the conventional silent-reading rate for prose. */
const WORDS_PER_MINUTE = 200;
/** Below this word count a readability score is noise, so it is withheld. */
const READABILITY_MIN_WORDS = 20;

/** Count whitespace-separated word tokens; Unicode-aware emptiness check. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/u).length;
}

/** Count sentence terminators (., !, ?, …, and CJK 。！？), at least 1 for any text. */
function countSentences(text: string): number {
  const matches = text.match(/[.!?…。！？]+/gu);
  const n = matches ? matches.length : 0;
  // Text with no terminator is still one sentence; never divide by zero downstream.
  return text.trim().length > 0 ? Math.max(1, n) : 0;
}

/**
 * Estimate syllables in a word by counting vowel groups, with the standard
 * trailing-silent-`e` correction, floored at 1. A heuristic — good enough for a
 * reading-ease signal, not a dictionary lookup.
 */
function estimateSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return 0;
  const groups = w.match(/[aeiouy]+/g);
  let count = groups ? groups.length : 0;
  if (w.endsWith("e") && count > 1) count -= 1;
  return Math.max(1, count);
}

/** Sum syllable estimates across the word tokens of a text. */
function countSyllables(text: string): number {
  const words = text.trim().length > 0 ? text.trim().split(/\s+/u) : [];
  let total = 0;
  for (const word of words) total += estimateSyllables(word);
  return total;
}

/**
 * Compute the stats for a body of text. The Statistics pane passes the joined
 * `index.text` for the whole-document figures and the selected run for the
 * selection-scoped figures (§9.4) — one function serves both.
 */
export function computeTextStats(text: string): TextStats {
  const words = countWords(text);
  const sentences = countSentences(text);
  const characters = text.length;
  const charactersNoSpaces = text.replace(/\s/gu, "").length;
  const readingMinutes =
    words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE));

  let readability: number | null = null;
  if (words >= READABILITY_MIN_WORDS && sentences > 0) {
    const syllables = countSyllables(text);
    const score =
      206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words);
    // Clamp to the conventional 0–100 display band (the formula can over/undershoot).
    readability = Math.round(Math.min(100, Math.max(0, score)));
  }

  return {
    characters,
    charactersNoSpaces,
    readability,
    readingMinutes,
    sentences,
    words,
  };
}

/** Join the index's text entries into one corpus for whole-document stats. */
export function joinIndexText(
  entries: readonly { readonly text: string }[],
): string {
  return entries.map((entry) => entry.text).join("\n");
}
