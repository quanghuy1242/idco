import {
  collectRichTextTocEntries,
  normalizeTocSettings,
  type RichTextTocEntry,
  type RichTextTocSide,
  type RichTextTocStyle,
} from "@quanghuy1242/idco-lib";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";
import { normalizeDocument } from "../model/normalize";

export type TocRailState = {
  readonly entries: readonly RichTextTocEntry[];
  readonly title: string;
  readonly side: RichTextTocSide;
  readonly style: RichTextTocStyle;
};

/**
 * Publishes the document's first `placement: "aside"` table of contents to the
 * editor shell, which renders it as a sticky side rail *outside* the
 * contenteditable (so block plugins — drag, gap cursor, selection — are
 * untouched). Emits `null` when no aside TOC exists. Recomputes on every editor
 * update; entries and settings are read from the same normalized document the
 * TOC node itself reads, so the rail stays in lockstep with the content.
 */
export function TableOfContentsRailPlugin({
  onRailChange,
}: {
  readonly onRailChange: (state: TocRailState | null) => void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    function publish() {
      const document = normalizeDocument(editor.getEditorState().toJSON());
      const node = (document.root.children ?? []).find(
        (child) =>
          child.type === "table-of-contents" &&
          normalizeTocSettings(child).placement === "aside",
      );
      if (!node) {
        onRailChange(null);
        return;
      }
      const settings = normalizeTocSettings(node);
      onRailChange({
        entries: collectRichTextTocEntries(document, settings),
        side: settings.side,
        style: settings.style,
        title: settings.title,
      });
    }

    publish();
    return editor.registerUpdateListener(publish);
  }, [editor, onRailChange]);

  return null;
}
