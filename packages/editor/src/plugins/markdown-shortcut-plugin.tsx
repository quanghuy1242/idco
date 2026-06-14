import {
  CHECK_LIST,
  HEADING,
  HIGHLIGHT,
  INLINE_CODE,
  LINK,
  ORDERED_LIST,
  QUOTE,
  TEXT_FORMAT_TRANSFORMERS,
  UNORDERED_LIST,
  type Transformer,
} from "@lexical/markdown";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";

/**
 * Markdown input shortcuts limited to the nodes this editor registers. The
 * default `TRANSFORMERS` include fenced-code (CODE), which maps to
 * `@lexical/code`'s `CodeNode` — not registered here (code is a custom block) —
 * so we compose an explicit, safe transformer list instead.
 */
export const RICH_TEXT_MARKDOWN_TRANSFORMERS: readonly Transformer[] = [
  HEADING,
  QUOTE,
  UNORDERED_LIST,
  ORDERED_LIST,
  CHECK_LIST,
  ...TEXT_FORMAT_TRANSFORMERS,
  INLINE_CODE,
  HIGHLIGHT,
  LINK,
];

export function RichTextMarkdownShortcutPlugin() {
  return (
    <MarkdownShortcutPlugin
      transformers={[...RICH_TEXT_MARKDOWN_TRANSFORMERS]}
    />
  );
}
