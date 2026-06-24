/**
 * View-layer mark registry (note.md W4 / C2).
 *
 * Marks (bold/italic/underline/strikethrough/code/highlight/subscript/superscript
 * /link/comment/glossary) used to be a closed set hardcoded in several places: the
 * `wrapMark` switch + `MARK_NESTING_ORDER` in `mark-render`, the toolbar's
 * `FORMAT_BUTTONS`, and the context menu's `FORMAT_ITEMS`. This registry is the
 * single source: each mark registers how it renders, its deterministic nesting
 * rank for overlapping marks, and — for a user-togglable format — its toolbar icon
 * and label. `mark-render` consumes `render`/`nestingRank`; the toolbar and context
 * menu consume `listMarks().filter((m) => m.toolbar)` (W6).
 *
 * The persisted `TextMarkKind` union stays in core (`model.ts`) because the compat
 * boundary needs the literal kinds; only the render + toolbar wiring derives from
 * here. Scope: this is the VIEW half (rendering + chrome). The core bake annotation
 * index (`bake.ts`, which classifies `comment`/`glossary` marks for search) is a
 * core concern that cannot import this view registry, so it stays in core.
 */
import type { ReactNode } from "react";
import {
  registerIdentityMark,
  type ResolvedMark,
  type TextMarkKind,
} from "../../core";

/** Whether links navigate (reader) or are inert (the editor owns clicks). */
export type LinkMode = "inert" | "navigable";

/** Arguments a mark's `render` receives for one covered text segment. */
export type MarkRenderArgs = {
  readonly mark: ResolvedMark;
  readonly child: ReactNode;
  readonly key: string;
  readonly linkMode: LinkMode;
};

/** Toolbar affordance for a user-togglable format mark (consumed by W6). */
export type MarkToolbarMeta = {
  readonly icon: string;
  readonly label: string;
  /**
   * Human keyboard-shortcut hint shown in the toolbar tooltip + `aria-keyshortcuts`
   * (note.md §3). Display-only — the actual binding lives in the keymap; this is the
   * discoverability string (e.g. "Ctrl/Cmd+B"). Omit for a mark with no shortcut.
   */
  readonly shortcut?: string;
};

/** One mark's contract: how it renders, how it nests, and its optional toolbar. */
export type MarkDefinition = {
  readonly kind: TextMarkKind;
  /** Lower rank wraps outermost, so overlapping marks render deterministically. */
  readonly nestingRank: number;
  render(args: MarkRenderArgs): ReactNode;
  readonly toolbar?: MarkToolbarMeta;
  /**
   * Data-bearing: the mark's id/attrs (not just its kind) distinguish adjacent
   * segments, so two neighbouring runs stay separate elements when they reference
   * different things (a link/comment/glossary, or a host's own reference mark, docs/027
   * §16 P7). The one piece of core segmentation a custom kind must declare; absent =
   * a plain format mark (bold-like) whose runs merge by kind. `registerMark` propagates
   * this into the core identity registry, so a host makes one call.
   */
  readonly identity?: boolean;
};

const MARKS = new Map<TextMarkKind, MarkDefinition>();

/**
 * Register a mark's render + nesting + optional toolbar. Idempotent by kind. A new
 * kind is admitted by the open `TextMarkKind` union (docs/027 §16 P7); `identity: true`
 * is propagated to core so segmentation keeps the data-bearing runs apart.
 */
export function registerMark(definition: MarkDefinition): void {
  MARKS.set(definition.kind, definition);
  if (definition.identity) registerIdentityMark(definition.kind);
}

/** The definition for a mark kind, or undefined (unregistered). */
export function getMark(kind: TextMarkKind): MarkDefinition | undefined {
  return MARKS.get(kind);
}

/** Every registered mark, in registration order (the toolbar's display order). */
export function listMarks(): readonly MarkDefinition[] {
  return [...MARKS.values()];
}

/** A mark's nesting rank, or a max sentinel for an unregistered kind. */
export function markNestingRank(kind: TextMarkKind): number {
  return getMark(kind)?.nestingRank ?? Number.MAX_SAFE_INTEGER;
}
