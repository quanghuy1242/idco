import type { TextFormatType } from "lexical";

/**
 * Per-block authoring capabilities. The toolbar reads the capability of the
 * block at the current selection and disables controls that the block does not
 * support — e.g. quotes and callouts are plain text, paragraphs allow the full
 * inline format set and alignment.
 */
export type BlockKind =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "quote"
  | "bullet"
  | "number"
  | "check"
  | "callout";

export type BlockCapability = {
  /** Inline formats allowed inside this block. Empty = plain text only. */
  readonly inlineFormats: ReadonlySet<TextFormatType>;
  /** Whether the block can be aligned (left/center/right/justify). */
  readonly canAlign: boolean;
  /** Whether the block participates in Lexical indent/outdent commands. */
  readonly canIndent: boolean;
};

const ALL_INLINE: ReadonlySet<TextFormatType> = new Set<TextFormatType>([
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "code",
]);

const HEADING_INLINE: ReadonlySet<TextFormatType> = new Set<TextFormatType>([
  "bold",
  "italic",
  "code",
]);

const NONE: ReadonlySet<TextFormatType> = new Set<TextFormatType>();

const CAPABILITIES: Record<BlockKind, BlockCapability> = {
  paragraph: { canAlign: true, canIndent: true, inlineFormats: ALL_INLINE },
  h1: { canAlign: true, canIndent: true, inlineFormats: HEADING_INLINE },
  h2: { canAlign: true, canIndent: true, inlineFormats: HEADING_INLINE },
  h3: { canAlign: true, canIndent: true, inlineFormats: HEADING_INLINE },
  h4: { canAlign: true, canIndent: true, inlineFormats: HEADING_INLINE },
  h5: { canAlign: true, canIndent: true, inlineFormats: HEADING_INLINE },
  h6: { canAlign: true, canIndent: true, inlineFormats: HEADING_INLINE },
  bullet: { canAlign: false, canIndent: true, inlineFormats: ALL_INLINE },
  number: { canAlign: false, canIndent: true, inlineFormats: ALL_INLINE },
  check: { canAlign: false, canIndent: true, inlineFormats: ALL_INLINE },
  // Quote and callout are deliberately plain text: bold/italic/etc are disabled.
  quote: { canAlign: false, canIndent: false, inlineFormats: NONE },
  callout: { canAlign: false, canIndent: false, inlineFormats: NONE },
};

export function capabilityFor(kind: BlockKind): BlockCapability {
  return CAPABILITIES[kind] ?? CAPABILITIES.paragraph;
}
