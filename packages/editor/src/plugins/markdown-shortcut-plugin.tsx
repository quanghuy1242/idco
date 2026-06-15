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
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import type { LexicalEditor } from "lexical";
import { useEffect } from "react";

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
  useMarkdownCascadeGuard();
  return (
    <MarkdownShortcutPlugin
      transformers={[...RICH_TEXT_MARKDOWN_TRANSFORMERS]}
    />
  );
}

/**
 * Works around a `@lexical/markdown` 0.45.0 interaction that crashes the editor
 * after ~100 consecutive edits (e.g. holding Backspace).
 *
 * The markdown shortcut listener calls `editor.update()` on *every* text edit —
 * including deletions — to test whether the line now matches a shortcut. On a
 * non-match that update changes nothing, and a no-op update returns before
 * Lexical runs `$triggerEnqueuedUpdates`, which is the only place that resets
 * Lexical's `_cascadeCount`. So the counter climbs by one per keystroke and,
 * once it passes 99, Lexical throws "One or more update listeners are endlessly
 * enqueueing more updates" and the edit is aborted. It is independent of
 * document size; a large document just makes the slow tail more noticeable.
 *
 * Resetting the counter at the start of each input event is safe: a genuine
 * runaway loop happens within a single event's synchronous processing (where
 * this handler does not re-run), so it still trips Lexical's guard. We only
 * clear the benign cross-keystroke accumulation.
 */
function useMarkdownCascadeGuard() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const reset = () => resetCascadeCounter(editor);
    return editor.registerRootListener((root, prevRoot) => {
      prevRoot?.removeEventListener("keydown", reset, true);
      prevRoot?.removeEventListener("beforeinput", reset, true);
      root?.addEventListener("keydown", reset, true);
      root?.addEventListener("beforeinput", reset, true);
    });
  }, [editor]);
}

function resetCascadeCounter(editor: LexicalEditor): void {
  // `_cascadeCount` is a private Lexical field; bracket access keeps the cast
  // narrow and avoids the dangling-underscore lint. Pinned to lexical@0.45.0.
  const internal = editor as unknown as { _cascadeCount?: number };
  if (typeof internal["_cascadeCount"] === "number") {
    internal["_cascadeCount"] = 0;
  }
}
