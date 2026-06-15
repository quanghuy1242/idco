import {
  allocateHeadingAnchorId,
  slugifyHeadingAnchor,
} from "@quanghuy1242/idco-lib";
import {
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from "lexical";
import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $isEditorHeadingNode,
  type EditorHeadingNode,
} from "../nodes/heading-node";
import { registerEditorUpdateListener } from "./editor-performance";

/**
 * Keeps heading anchors on by default. Anchors track the heading text: ids are
 * (re)derived from the current text so renaming a heading updates its anchor
 * (and therefore the TOC link), matching how Markdown/GitHub-style anchors
 * behave. Duplicate ids are repaired by suffixing later headings while
 * preserving the first unique occurrence. Writes use the `history-merge` tag so
 * the anchor sync folds into the user's edit instead of adding undo steps.
 */
export function HeadingAnchorPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    repairHeadingAnchors(editor);
    return registerEditorUpdateListener(
      editor,
      {
        budgetMs: 4,
        cost: "walks heading nodes and writes only changed anchor ids",
        frequency:
          "every editor update so serialized heading anchors stay current",
        label: "heading anchor repair",
        lane: "sync",
        priority: "critical",
      },
      () => {
        repairHeadingAnchors(editor);
      },
    );
  }, [editor]);

  return null;
}

type HeadingRepair = {
  readonly key: NodeKey;
  readonly anchorId: string;
};

function repairHeadingAnchors(editor: LexicalEditor) {
  const repairs: HeadingRepair[] = [];
  editor.getEditorState().read(() => {
    const used = new Set<string>();
    for (const heading of $headingNodes($getRoot())) {
      const current = heading.getAnchorId();
      const preferred = slugifyHeadingAnchor(
        heading.getTextContent() || "section",
      );
      const next = allocateHeadingAnchorId(preferred, used);
      if (next !== current) {
        repairs.push({ anchorId: next, key: heading.getKey() });
      }
    }
  });
  if (repairs.length === 0) return;
  editor.update(
    () => {
      for (const repair of repairs) {
        const node = $getNodeByKey(repair.key);
        if ($isEditorHeadingNode(node)) node.setAnchorId(repair.anchorId);
      }
    },
    { tag: "history-merge" },
  );
}

function $headingNodes(node: LexicalNode): EditorHeadingNode[] {
  const headings: EditorHeadingNode[] = [];
  if ($isEditorHeadingNode(node)) headings.push(node);
  if ($isElementNode(node)) {
    for (const child of node.getChildren()) {
      headings.push(...$headingNodes(child));
    }
  }
  return headings;
}
