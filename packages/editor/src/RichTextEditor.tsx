// DaisyUI 5: https://daisyui.com/components/textarea/
"use client";

import {
  CodeEditor,
  RichTextTocLayout,
  RichTextTocRail,
  Stack,
  Text,
} from "@quanghuy1242/idco-ui";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { MarkNode } from "@lexical/mark";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import type { EditorState } from "lexical";
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeDocument } from "./model/normalize";
import {
  DEFAULT_ALLOWED_NODES,
  type RichTextEditorDocument,
} from "./model/schema";
import { lexicalEditorState } from "./model/serialize";
import { GlossaryNode } from "./nodes/glossary-node";
import { EditorTableNode } from "./nodes/table-node";
import { EditorHeadingNode } from "./nodes/heading-node";
import {
  RICH_TEXT_DECORATOR_NODES,
  RichTextEditorBindingsContext,
  RichTextNodePlugin,
  type RichTextEditorBindings,
} from "./nodes";
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
import {
  useDebouncedEditorStatePublisher,
  useDerivedStatePublisher,
} from "./plugins/editor-performance";
import {
  TableOfContentsRailPlugin,
  type TocRailState,
} from "./plugins/toc-rail-plugin";
import { TableControlsPlugin } from "./plugins/table-controls-plugin";
import { LexicalToolbar } from "./plugins/toolbar-plugin";

export type {
  RichTextEditorDocument,
  RichTextEditorNode,
  RichTextEditorMediaOption,
  RichTextEditorPostOption,
} from "./model/schema";

type RichTextEditorProps = {
  readonly value: unknown;
  readonly onChange: (value: RichTextEditorDocument) => void;
  readonly label: string;
  readonly name?: string;
  readonly error?: string;
  readonly allowedNodes?: readonly string[];
  readonly allowedEmbedDomains?: readonly string[];
  readonly mediaLibrary?: RichTextEditorBindings["mediaLibrary"];
  readonly postLibrary?: RichTextEditorBindings["postLibrary"];
  readonly onUploadMedia?: RichTextEditorBindings["onUploadMedia"];
  readonly onComment?: RichTextEditorBindings["onComment"];
  readonly comments?: RichTextEditorBindings["comments"];
  readonly onCommentUpdate?: RichTextEditorBindings["onCommentUpdate"];
  readonly onCommentDelete?: RichTextEditorBindings["onCommentDelete"];
};

export function RichTextEditor({
  value,
  onChange,
  label,
  name,
  error,
  allowedNodes = DEFAULT_ALLOWED_NODES,
  allowedEmbedDomains,
  mediaLibrary,
  postLibrary,
  onUploadMedia,
  onComment,
  comments,
  onCommentUpdate,
  onCommentDelete,
}: RichTextEditorProps) {
  // The value we last emitted via `onChange`. When the controlled `value` is
  // that same object (the common case — the change came from this editor), the
  // editor already holds it, so we skip the document round-trip and the sync
  // plugin's full re-serialize. Only a genuinely external value gets reapplied.
  const lastEmittedValue = useRef<RichTextEditorDocument | null>(null);
  const onChangeRef = useRef(onChange);
  const isEcho = value === lastEmittedValue.current;
  const document = useMemo(
    () =>
      isEcho && lastEmittedValue.current
        ? lastEmittedValue.current
        : normalizeDocument(value),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on `value`; isEcho is derived from it.
    [value],
  );
  const bindings = useMemo<RichTextEditorBindings>(
    () => ({
      allowedEmbedDomains,
      comments,
      mediaLibrary,
      onComment,
      onCommentDelete,
      onCommentUpdate,
      onUploadMedia,
      postLibrary,
    }),
    [
      allowedEmbedDomains,
      comments,
      mediaLibrary,
      onComment,
      onCommentDelete,
      onCommentUpdate,
      onUploadMedia,
      postLibrary,
    ],
  );
  const [menuOpen, setMenuOpen] = useState(false);
  // The first `placement: "aside"` TOC, published by TableOfContentsRailPlugin
  // from inside the composer and rendered as a sticky rail beside the frame.
  const [tocRail, setTocRail] = useState<TocRailState | null>(null);
  // The read-only JSON mirror re-tokenizes (Prism) and re-renders a line per
  // row of the whole document. Doing that on every keystroke makes rapid edits
  // (e.g. held backspace) janky, so it trails the live value by a beat — it is
  // informational, so a small lag is invisible.
  const [source, setSource] = useState(() => JSON.stringify(document, null, 2));

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const { schedule: scheduleEditorStatePublish } =
    useDebouncedEditorStatePublisher<RichTextEditorDocument>({
      budgetMs: 12,
      cost: "serializes Lexical state and normalizes the host document value",
      delayMs: 80,
      derive: (editorState) => normalizeDocument(editorState.toJSON()),
      label: "controlled rich-text document emission",
      publish: (next) => {
        lastEmittedValue.current = next;
        onChangeRef.current(next);
      },
    });

  const { schedule: scheduleSourcePublish } = useDerivedStatePublisher<
    RichTextEditorDocument,
    string
  >({
    budgetMs: 8,
    cost: "stringifies the current document for the read-only source preview",
    derive: (next) => JSON.stringify(next, null, 2),
    label: "read-only JSON source preview",
    lane: "debounced",
    publish: setSource,
    priority: "low",
    timeoutMs: 200,
  });

  useEffect(() => {
    scheduleSourcePublish(document);
  }, [document, scheduleSourcePublish]);

  function applyEditorState(editorState: EditorState) {
    scheduleEditorStatePublish(editorState);
  }

  return (
    <Stack gap="sm">
      <Text variant="h3">{label}</Text>
      <RichTextTocLayout
        side={tocRail?.side ?? "left"}
        rail={
          tocRail ? (
            <RichTextTocRail
              entries={tocRail.entries}
              style={tocRail.style}
              title={tocRail.title}
            />
          ) : undefined
        }
      >
        <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
          <RichTextEditorBindingsContext.Provider value={bindings}>
            <LexicalComposer
              initialConfig={{
                editorState: JSON.stringify(lexicalEditorState(document)),
                namespace: `idco-rich-text-${name ?? "field"}`,
                nodes: [
                  EditorHeadingNode,
                  {
                    replace: HeadingNode,
                    with: (node: HeadingNode) =>
                      new EditorHeadingNode(node.getTag()),
                    withKlass: EditorHeadingNode,
                  },
                  ListNode,
                  ListItemNode,
                  QuoteNode,
                  LinkNode,
                  AutoLinkNode,
                  MarkNode,
                  // Replace the stock TableNode with our EditorTableNode (which
                  // carries `layout` / `showRowNumbers`) for every table the
                  // editor creates, pastes, or imports. `withKlass` routes
                  // @lexical/table's transforms and mutation listeners to the
                  // subclass while the `"table"` type stays serialization-stable.
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
                    // `checklist` overrides the shared `ul` bullet styling so check
                    // lists don't render a disc behind their checkbox.
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
              <LexicalToolbar
                allowedNodes={allowedNodes}
                label={label}
                menuOpen={menuOpen}
                onMenuOpen={setMenuOpen}
              />
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
                      Type / for rich content blocks
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
              <HistoryPlugin />
              <OnChangePlugin onChange={applyEditorState} />
              <TableOfContentsRailPlugin onRailChange={setTocRail} />
            </LexicalComposer>
          </RichTextEditorBindingsContext.Provider>
        </div>
      </RichTextTocLayout>
      <CodeEditor
        label={`${label} JSON (read-only)`}
        name={name}
        value={source}
        error={error}
        readOnly
        maxHeight="md"
        onChange={() => {}}
      />
    </Stack>
  );
}
