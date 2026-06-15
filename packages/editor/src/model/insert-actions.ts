import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";
import { INSERT_TABLE_COMMAND } from "@lexical/table";
import type { LexicalEditor } from "lexical";
import { canUse, type RichTextEditorNode } from "./schema";
import {
  INSERT_RICH_TEXT_NODE_COMMAND,
  type RichTextEditorBindings,
} from "../nodes";

export type EditorInsertAction = {
  readonly icon: string;
  readonly id: string;
  readonly keywords: readonly string[];
  readonly label: string;
  readonly run: (editor: LexicalEditor) => void;
};

export const starterNodes: readonly {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly node: RichTextEditorNode;
}[] = [
  {
    icon: "Pilcrow",
    id: "paragraph",
    label: "Paragraph",
    node: { children: [{ text: "", type: "text" }], type: "paragraph" },
  },
  {
    icon: "Heading2",
    id: "heading",
    label: "Heading",
    node: {
      children: [{ text: "Heading", type: "text" }],
      tag: "h2",
      type: "heading",
    },
  },
  {
    icon: "ScrollText",
    id: "table-of-contents",
    label: "Table of contents",
    node: {
      maxLevel: 4,
      minLevel: 1,
      numbering: "decimal",
      style: "plain",
      title: "Table of contents",
      type: "table-of-contents",
    },
  },
  {
    icon: "Info",
    id: "callout",
    label: "Callout",
    node: {
      children: [{ text: "Callout", type: "text" }],
      tone: "info",
      type: "callout",
    },
  },
  {
    icon: "Code",
    id: "code-block",
    label: "Code",
    node: {
      language: "ts",
      text: "const value = true;",
      type: "code-block",
    },
  },
  {
    icon: "Globe",
    id: "embed",
    label: "Embed",
    node: { type: "embed", url: "https://example.com" },
  },
  {
    icon: "Image",
    id: "media",
    label: "Media",
    node: { alt: "", caption: "", mediaId: "", type: "media" },
  },
  {
    icon: "Link2",
    id: "post-ref",
    label: "Post Ref",
    node: { postId: "", title: "Referenced post", type: "post-ref" },
  },
];

export function canInsertStarterNode(
  item: (typeof starterNodes)[number],
  bindings: Pick<
    RichTextEditorBindings,
    "mediaLibrary" | "onUploadMedia" | "postLibrary"
  >,
): boolean {
  if (item.node.type === "media") {
    return Boolean(bindings.mediaLibrary || bindings.onUploadMedia);
  }
  if (item.node.type === "post-ref") {
    return Boolean(bindings.postLibrary);
  }
  return true;
}

export function editorInsertActions({
  allowedNodes,
  bindings,
}: {
  readonly allowedNodes: readonly string[];
  readonly bindings: Pick<
    RichTextEditorBindings,
    "mediaLibrary" | "onUploadMedia" | "postLibrary"
  >;
}): readonly EditorInsertAction[] {
  const nodeActions = starterNodes
    .filter(
      (item) =>
        canUse(item.node.type, allowedNodes) &&
        canInsertStarterNode(item, bindings),
    )
    .map(
      (item): EditorInsertAction => ({
        icon: item.icon,
        id: item.id,
        keywords: [item.id],
        label: item.label,
        run: (editor) =>
          editor.dispatchCommand(
            INSERT_RICH_TEXT_NODE_COMMAND,
            item.node as RichTextEditorNode,
          ),
      }),
    );

  const extraActions: EditorInsertAction[] = [];
  if (canUse("list", allowedNodes)) {
    extraActions.push(
      {
        icon: "List",
        id: "bullet-list",
        keywords: ["ul", "bullet"],
        label: "Bullet list",
        run: (editor) =>
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
      },
      {
        icon: "ListOrdered",
        id: "numbered-list",
        keywords: ["ol", "number"],
        label: "Numbered list",
        run: (editor) =>
          editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
      },
      {
        icon: "ListChecks",
        id: "check-list",
        keywords: ["todo", "task"],
        label: "Check list",
        run: (editor) =>
          editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined),
      },
    );
  }
  if (canUse("table", allowedNodes)) {
    extraActions.push({
      icon: "Table",
      id: "table",
      keywords: ["grid", "rows"],
      label: "Table",
      run: (editor) =>
        editor.dispatchCommand(INSERT_TABLE_COMMAND, {
          columns: "3",
          includeHeaders: true,
          rows: "3",
        }),
    });
  }

  return [...nodeActions, ...extraActions];
}
