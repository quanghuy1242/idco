import {
  normalizeTocSettings,
  type RichTextTocEntry,
  type RichTextTocSide,
  type RichTextTocSettings,
  type RichTextTocStyle,
} from "@quanghuy1242/idco-lib";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $isElementNode, type LexicalNode } from "lexical";
import { useEffect, useRef } from "react";
import type { RichTextEditorNode } from "../model/schema";
import { RichTextDecoratorBlockNode } from "../nodes/base";
import { registerEditorUpdateListener } from "./editor-performance";
import {
  $hasTocRelevantUpdate,
  $snapshotEditorTocHeadings,
  createChunkedEditorTocEntriesTask,
} from "./toc-entries";

export type TocRailState = {
  readonly entries: readonly RichTextTocEntry[];
  readonly title: string;
  readonly side: RichTextTocSide;
  readonly style: RichTextTocStyle;
};

type TocRailSource = {
  readonly headings: ReturnType<typeof $snapshotEditorTocHeadings>;
  readonly rail: RichTextTocSettings | null;
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
  const lastSignatureRef = useRef("");

  useEffect(() => {
    const chunkedTocTask = createChunkedEditorTocEntriesTask({
      label: "side table-of-contents chunked entries",
    });
    let sourceVersion = 0;

    function publishRailState(next: TocRailState | null) {
      const signature = tocRailSignature(next);
      if (signature === lastSignatureRef.current) return;
      lastSignatureRef.current = signature;
      onRailChange(next);
    }

    function scheduleSource(source: TocRailSource | null) {
      if (!source) return;
      sourceVersion += 1;
      const version = sourceVersion;
      if (!source.rail) {
        publishRailState(null);
        return;
      }
      const rail = source.rail;
      chunkedTocTask.schedule({
        headings: source.headings,
        publish: (entries) =>
          version === sourceVersion
            ? publishRailState({
                entries,
                side: rail.side,
                style: rail.style,
                title: rail.title,
              })
            : undefined,
        settings: rail,
      });
    }

    scheduleSource(editor.getEditorState().read($snapshotTocRailSource));
    const unregister = registerEditorUpdateListener(
      editor,
      {
        budgetMs: 3,
        cost: "checks TOC-relevant dirty nodes and snapshots rail settings plus heading metadata",
        debounceMs: 80,
        frequency:
          "after editor updates settle while side TOC support is mounted",
        label: "side table-of-contents invalidation",
        lane: "debounced",
        priority: "low",
      },
      (payload) => {
        const source = payload.editorState.read(() =>
          $hasTocRelevantUpdate(payload) ? $snapshotTocRailSource() : null,
        );
        scheduleSource(source);
      },
    );
    return () => {
      unregister();
      chunkedTocTask.cancel();
    };
  }, [editor, onRailChange]);

  return null;
}

function $snapshotTocRailSource(): TocRailSource {
  return {
    headings: $snapshotEditorTocHeadings(),
    rail: $firstAsideTocRail(),
  };
}

function $firstAsideTocRail(): RichTextTocSettings | null {
  let rail: RichTextTocSettings | null = null;
  $visitNodes($getRoot(), (node) => {
    if (rail || !(node instanceof RichTextDecoratorBlockNode)) return;
    if (node.getType() !== "table-of-contents") return;
    const settings = normalizeTocSettings(node.getData() as RichTextEditorNode);
    if (settings.placement !== "aside") return;
    rail = settings;
  });
  return rail;
}

function $visitNodes(node: LexicalNode, visit: (node: LexicalNode) => void) {
  visit(node);
  if (!$isElementNode(node)) return;
  for (const child of node.getChildren()) {
    $visitNodes(child, visit);
  }
}

function tocRailSignature(state: TocRailState | null): string {
  if (!state) return "";
  return JSON.stringify({
    entries: state.entries.map((entry) => [
      entry.id,
      entry.href,
      entry.text,
      entry.tag,
      entry.level,
      entry.depth,
      entry.number,
    ]),
    side: state.side,
    style: state.style,
    title: state.title,
  });
}
