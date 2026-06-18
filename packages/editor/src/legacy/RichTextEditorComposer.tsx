// DaisyUI 5: https://daisyui.com/components/textarea/
"use client";

import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { MarkNode } from "@lexical/mark";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  ParagraphNode,
  type EditorState,
  type LexicalNode,
} from "lexical";
import { useEffect, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { lexicalEditorState } from "./model/serialize";
import type { RichTextEditorDocument } from "./model/schema";
import { DecoratorVirtualizationContext } from "./nodes/decorator-virtualization";
import { GlossaryNode } from "./nodes/glossary-node";
import { EditorHeadingNode } from "./nodes/heading-node";
import {
  EditorListItemNode,
  EditorListNode,
  EditorParagraphNode,
  EditorQuoteNode,
} from "./nodes/identified-block-nodes";
import {
  RICH_TEXT_DECORATOR_NODES,
  RichTextEditorBindingsContext,
  RichTextNodePlugin,
  type RichTextEditorBindings,
} from "./nodes";
import { EditorTableNode } from "./nodes/table-node";
import { BlockControlsPlugin } from "./plugins/block-controls-plugin";
import { BlockNavigationPlugin } from "./plugins/block-navigation-plugin";
import { CommentEditorPlugin } from "./plugins/comment-plugin";
import { ContextMenuPlugin } from "./plugins/context-menu-plugin";
import { EditorDocumentSyncPlugin } from "./plugins/document-sync-plugin";
import { DraggableBlockPlugin } from "./plugins/draggable-block-plugin";
import { GapCursorPlugin } from "./plugins/gap-cursor-plugin";
import { HeadingAnchorPlugin } from "./plugins/heading-anchor-plugin";
import { IndentKeyboardPlugin } from "./plugins/indent-keyboard-plugin";
import { RichTextLinkPlugin } from "./plugins/link-plugin";
import { RichTextMarkdownShortcutPlugin } from "./plugins/markdown-shortcut-plugin";
import { SelectionFlyoutPlugin } from "./plugins/selection-flyout-plugin";
import { SlashMenuPlugin } from "./plugins/slash-menu-plugin";
import { RichTextTablePlugin } from "./plugins/table-plugin";
import { TableControlsPlugin } from "./plugins/table-controls-plugin";
import {
  TableOfContentsRailPlugin,
  type TocRailState,
} from "./plugins/toc-rail-plugin";
import { LexicalToolbar } from "./plugins/toolbar-plugin";

export type RichTextEditorComposerProps = {
  readonly allowedNodes: readonly string[];
  readonly bindings: RichTextEditorBindings;
  readonly initialSelection?: RichTextEditorInitialSelection;
  readonly decoratorVirtualization?: boolean;
  readonly document: RichTextEditorDocument;
  readonly isEcho: boolean;
  readonly label: string;
  readonly name?: string;
  readonly onChange: (editorState: EditorState) => void;
  readonly onInitialSelectionApplied?: () => void;
  readonly onTocRailChange?: (state: TocRailState | null) => void;
  readonly placeholder?: string;
  readonly showDocumentTocRail?: boolean;
  readonly showToolbar?: boolean;
};

export type RichTextEditorInitialSelection = {
  readonly path: string;
  readonly startOffset: number;
  readonly endOffset: number;
};

export function RichTextEditorComposer({
  allowedNodes,
  bindings,
  decoratorVirtualization = false,
  document,
  initialSelection,
  isEcho,
  label,
  name,
  onChange,
  onInitialSelectionApplied,
  onTocRailChange,
  placeholder = "Type / for rich content blocks",
  showDocumentTocRail = true,
  showToolbar = true,
}: RichTextEditorComposerProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <RichTextEditorBindingsContext.Provider value={bindings}>
      <DecoratorVirtualizationContext.Provider value={decoratorVirtualization}>
        <LexicalComposer
          initialConfig={{
            editorState: JSON.stringify(lexicalEditorState(document)),
            namespace: `idco-rich-text-${name ?? "field"}`,
            nodes: [
              EditorParagraphNode,
              {
                replace: ParagraphNode,
                with: () => new EditorParagraphNode(),
                withKlass: EditorParagraphNode,
              },
              EditorHeadingNode,
              {
                replace: HeadingNode,
                with: (node: HeadingNode) =>
                  new EditorHeadingNode(node.getTag()),
                withKlass: EditorHeadingNode,
              },
              EditorListNode,
              {
                replace: ListNode,
                with: (node: ListNode) =>
                  new EditorListNode(node.getListType(), node.getStart()),
                withKlass: EditorListNode,
              },
              EditorListItemNode,
              {
                replace: ListItemNode,
                with: (node: ListItemNode) =>
                  new EditorListItemNode(node.getValue(), node.getChecked()),
                withKlass: EditorListItemNode,
              },
              EditorQuoteNode,
              {
                replace: QuoteNode,
                with: () => new EditorQuoteNode(),
                withKlass: EditorQuoteNode,
              },
              LinkNode,
              AutoLinkNode,
              MarkNode,
              EditorTableNode,
              {
                replace: TableNode,
                with: () => new EditorTableNode(),
                withKlass: EditorTableNode,
              },
              TableRowNode,
              TableCellNode,
              GlossaryNode,
              ...RICH_TEXT_DECORATOR_NODES,
            ],
            onError(cause) {
              throw cause;
            },
            theme: {
              heading: {
                h1: "mb-2 text-2xl font-bold text-base-content",
                h2: "mb-2 text-xl font-bold text-base-content",
                h3: "mb-2 text-lg font-semibold text-base-content",
                h4: "mb-2 text-base font-semibold text-base-content",
              },
              link: "text-primary underline underline-offset-2 cursor-pointer",
              list: {
                checklist: "rt-checklist",
                listitem: "mb-1",
                listitemChecked: "rt-checklist-item rt-checklist-checked",
                listitemUnchecked: "rt-checklist-item",
                nested: { listitem: "list-none" },
                ol: "my-2 ml-6 list-decimal",
                ul: "my-2 ml-6 list-disc",
              },
              mark: "rounded bg-warning/30 px-0.5",
              markOverlap: "bg-warning/50",
              paragraph: "mb-2",
              quote:
                "my-2 border-l-4 border-base-300 pl-3 italic text-base-content/80",
              table: "rt-table text-sm",
              tableCell: "px-5 py-2.5 align-top",
              tableCellHeader: "bg-base-200 font-semibold",
              tableRow: "",
              tableScrollableWrapper: "rt-table-wrap",
              text: {
                bold: "font-bold",
                code: "rounded bg-base-200 px-1 font-mono text-[0.9em]",
                italic: "italic",
                strikethrough: "line-through",
                underline: "underline",
              },
            },
          }}
        >
          {showToolbar ? (
            <LexicalToolbar
              allowedNodes={allowedNodes}
              label={label}
              menuOpen={menuOpen}
              onMenuOpen={setMenuOpen}
            />
          ) : null}
          <div className="relative">
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  aria-label={label}
                  className="min-h-40 w-full bg-base-100 py-3 pl-12 pr-3 text-sm leading-6 text-base-content outline-none focus:outline-2 focus:-outline-offset-2 focus:outline-primary"
                />
              }
              placeholder={
                <span className="pointer-events-none absolute left-12 top-3 text-sm text-base-content/50">
                  {placeholder}
                </span>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            <GapCursorPlugin />
            <BlockControlsPlugin />
            <DraggableBlockPlugin />
            <TableControlsPlugin />
            <CommentEditorPlugin />
          </div>
          <RichTextNodePlugin />
          <HeadingAnchorPlugin />
          <BlockNavigationPlugin />
          <ListPlugin />
          <CheckListPlugin />
          <RichTextLinkPlugin />
          <RichTextTablePlugin />
          <RichTextMarkdownShortcutPlugin />
          <IndentKeyboardPlugin />
          <SlashMenuPlugin allowedNodes={allowedNodes} />
          <SelectionFlyoutPlugin allowedNodes={allowedNodes} />
          <ContextMenuPlugin allowedNodes={allowedNodes} />
          <EditorDocumentSyncPlugin document={document} isEcho={isEcho} />
          <InitialEditorFocusPlugin
            selection={initialSelection}
            onApplied={onInitialSelectionApplied}
          />
          <HistoryPlugin />
          <OnChangePlugin onChange={onChange} />
          {showDocumentTocRail ? (
            <TableOfContentsRailPlugin
              onRailChange={onTocRailChange ?? (() => {})}
            />
          ) : null}
        </LexicalComposer>
      </DecoratorVirtualizationContext.Provider>
    </RichTextEditorBindingsContext.Provider>
  );
}

function InitialEditorFocusPlugin({
  onApplied,
  selection,
}: {
  readonly onApplied?: () => void;
  readonly selection?: RichTextEditorInitialSelection;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!selection) return;
    editor.focus(() => {
      editor.update(() => {
        const node = nodeAtPath($getRoot(), selection.path);
        if ($isTextNode(node)) {
          const length = node.getTextContentSize();
          node.select(
            clampOffset(selection.startOffset, length),
            clampOffset(selection.endOffset, length),
          );
          return;
        }
        if ($isElementNode(node)) node.selectStart();
      });
      onApplied?.();
    });
  }, [editor, onApplied, selection]);
  return null;
}

function nodeAtPath(root: LexicalNode, path: string): LexicalNode | null {
  const indexes = path
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isInteger(part) && part >= 0);
  let current: LexicalNode | null = root;
  for (const index of indexes) {
    current = $isElementNode(current) ? current.getChildAtIndex(index) : null;
    if (!current) return null;
  }
  return current;
}

function clampOffset(offset: number, length: number): number {
  return Math.max(0, Math.min(length, offset));
}
