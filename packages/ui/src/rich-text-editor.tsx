// DaisyUI 5: https://daisyui.com/components/textarea/
"use client";

import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
  HeadingNode,
  QuoteNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  BLUR_COMMAND,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  FOCUS_COMMAND,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  type EditorState,
  type TextFormatType,
} from "lexical";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  Button as AriaButton,
  Toolbar as AriaToolbar,
} from "react-aria-components";
import { CodeEditor } from "./code-editor";
import { Stack } from "./layout";
import { Menu, MenuItem, MenuTrigger } from "./menu";
import { NavIcon } from "./nav-icons";
import { Tooltip } from "./tooltip";
import {
  CalloutNode,
  CodeBlockNode,
  EmbedNode,
  INSERT_RICH_TEXT_NODE_COMMAND,
  MediaNode,
  PostRefNode,
  RichTextEditorBindingsContext,
  RichTextNodePlugin,
} from "./rich-text-nodes";
import { Text } from "./typography";

export type RichTextEditorNode = {
  readonly type: string;
  readonly text?: string;
  readonly children?: readonly RichTextEditorNode[];
  readonly tag?: string;
  readonly language?: string;
  readonly mediaId?: string;
  readonly alt?: string;
  readonly caption?: string;
  readonly postId?: string;
  readonly title?: string;
  readonly url?: string;
  readonly tone?: string;
  readonly [key: string]: unknown;
};

export type RichTextEditorDocument = {
  readonly root: {
    readonly children: readonly RichTextEditorNode[];
  };
};

export type RichTextEditorMediaOption = {
  readonly id: string;
  readonly label: string;
  readonly alt?: string;
  readonly caption?: string;
  /** URL used to render a live image preview in the editor. */
  readonly previewUrl?: string;
};

export type RichTextEditorPostOption = {
  readonly id: string;
  readonly label: string;
  readonly href?: string;
};

type RichTextEditorProps = {
  readonly value: unknown;
  readonly onChange: (value: RichTextEditorDocument) => void;
  readonly label: string;
  readonly name?: string;
  readonly error?: string;
  readonly allowedNodes?: readonly string[];
  readonly allowedEmbedDomains?: readonly string[];
  readonly mediaLibrary?: {
    readonly load: (
      query: string,
      signal?: AbortSignal,
    ) => Promise<readonly RichTextEditorMediaOption[]>;
    /** Resolve an already-stored mediaId back to a preview, rehydrating the live image on load. */
    readonly resolve?: (
      mediaId: string,
      signal?: AbortSignal,
    ) => Promise<RichTextEditorMediaOption | null>;
  };
  readonly postLibrary?: {
    readonly load: (
      query: string,
      signal?: AbortSignal,
    ) => Promise<readonly RichTextEditorPostOption[]>;
  };
  readonly onUploadMedia?: (
    files: File[],
  ) =>
    | void
    | readonly RichTextEditorNode[]
    | Promise<readonly RichTextEditorNode[] | void>;
};

const defaultAllowedNodes = [
  "paragraph",
  "heading",
  "quote",
  "list",
  "listitem",
  "text",
  "linebreak",
  "callout",
  "code-block",
  "media",
  "post-ref",
  "embed",
] as const;

export function RichTextEditor({
  value,
  onChange,
  label,
  name,
  error,
  allowedNodes = defaultAllowedNodes,
  allowedEmbedDomains,
  mediaLibrary,
  postLibrary,
  onUploadMedia,
}: RichTextEditorProps) {
  const document = useMemo(() => normalizeDocument(value), [value]);
  const bindings = useMemo(
    () => ({
      allowedEmbedDomains,
      mediaLibrary,
      onUploadMedia,
      postLibrary,
    }),
    [allowedEmbedDomains, mediaLibrary, onUploadMedia, postLibrary],
  );
  const lastEmittedStateJson = useRef<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const source = JSON.stringify(document, null, 2);

  function applyEditorState(editorState: EditorState) {
    const next = normalizeDocument(editorState.toJSON());
    lastEmittedStateJson.current = JSON.stringify(lexicalEditorState(next));
    onChange(next);
  }

  return (
    <Stack gap="sm">
      <Text variant="h3">{label}</Text>
      <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
        <RichTextEditorBindingsContext.Provider value={bindings}>
          <LexicalComposer
            initialConfig={{
              editorState: JSON.stringify(lexicalEditorState(document)),
              namespace: `idco-rich-text-${name ?? "field"}`,
              nodes: [
                HeadingNode,
                ListNode,
                ListItemNode,
                QuoteNode,
                CalloutNode,
                CodeBlockNode,
                EmbedNode,
                MediaNode,
                PostRefNode,
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
                list: {
                  listitem: "mb-1",
                  ol: "my-2 ml-6 list-decimal",
                  ul: "my-2 ml-6 list-disc",
                },
                paragraph: "mb-2",
                quote:
                  "my-2 border-l-4 border-base-300 pl-3 italic text-base-content/80",
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
                    className="min-h-40 w-full bg-base-100 px-3 py-3 text-sm leading-6 text-base-content outline-none focus:outline-2 focus:-outline-offset-2 focus:outline-primary"
                    onKeyDown={(event) => {
                      if (event.key === "/") {
                        setMenuOpen(true);
                      }
                    }}
                  />
                }
                placeholder={
                  <span className="pointer-events-none absolute left-3 top-3 text-sm text-base-content/50">
                    Type / for rich content blocks
                  </span>
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
            </div>
            <RichTextNodePlugin />
            <ListPlugin />
            <EditorDocumentSyncPlugin
              document={document}
              lastEmittedStateJson={lastEmittedStateJson}
            />
            <HistoryPlugin />
            <OnChangePlugin onChange={applyEditorState} />
          </LexicalComposer>
        </RichTextEditorBindingsContext.Provider>
      </div>
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

type BlockKind = "paragraph" | HeadingTagType | "quote" | "bullet" | "number";

const blockStyleOptions: readonly {
  readonly id: "paragraph" | HeadingTagType | "quote";
  readonly label: string;
  readonly icon: string;
  readonly preview: string;
  readonly node?: "heading" | "quote";
}[] = [
  { icon: "Pilcrow", id: "paragraph", label: "Paragraph", preview: "text-sm" },
  {
    icon: "Heading1",
    id: "h1",
    label: "Heading 1",
    node: "heading",
    preview: "text-2xl font-bold",
  },
  {
    icon: "Heading2",
    id: "h2",
    label: "Heading 2",
    node: "heading",
    preview: "text-xl font-bold",
  },
  {
    icon: "Heading3",
    id: "h3",
    label: "Heading 3",
    node: "heading",
    preview: "text-lg font-semibold",
  },
  {
    icon: "Heading4",
    id: "h4",
    label: "Heading 4",
    node: "heading",
    preview: "text-base font-semibold",
  },
  {
    icon: "Quote",
    id: "quote",
    label: "Quote",
    node: "quote",
    preview: "text-sm italic text-base-content/70",
  },
];

const inlineFormats: readonly {
  readonly format: TextFormatType;
  readonly icon: string;
  readonly label: string;
}[] = [
  { format: "bold", icon: "Bold", label: "Bold" },
  { format: "italic", icon: "Italic", label: "Italic" },
  { format: "underline", icon: "Underline", label: "Underline" },
  { format: "strikethrough", icon: "Strikethrough", label: "Strikethrough" },
  { format: "code", icon: "Code", label: "Inline code" },
];

function LexicalToolbar({
  allowedNodes,
  label,
  menuOpen,
  onMenuOpen,
}: {
  readonly allowedNodes: readonly string[];
  readonly label: string;
  readonly menuOpen: boolean;
  readonly onMenuOpen: (open: boolean) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const bindings = useContext(RichTextEditorBindingsContext);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [blockKind, setBlockKind] = useState<BlockKind>("paragraph");
  const [activeFormats, setActiveFormats] = useState<ReadonlySet<string>>(
    new Set(),
  );
  // Formatting targets the editable text; it does not apply while a block widget
  // (callout/code/media) holds focus, so the controls disable themselves there.
  const [canFormat, setCanFormat] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const refreshToolbar = useCallback(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    setActiveFormats(
      new Set(
        inlineFormats
          .filter(({ format }) => selection.hasFormat(format))
          .map(({ format }) => format),
      ),
    );
    const anchor = selection.anchor.getNode();
    const element =
      anchor.getKey() === "root"
        ? anchor
        : (anchor.getTopLevelElement() ?? anchor);
    if ($isListNode(element)) {
      setBlockKind(element.getListType() === "number" ? "number" : "bullet");
    } else if ($isHeadingNode(element)) {
      setBlockKind(element.getTag());
    } else if ($isQuoteNode(element)) {
      setBlockKind("quote");
    } else {
      setBlockKind("paragraph");
    }
  }, []);

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(({ editorState }) =>
          editorState.read(refreshToolbar),
        ),
        editor.registerCommand(
          FOCUS_COMMAND,
          () => {
            setCanFormat(true);
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          BLUR_COMMAND,
          (event) => {
            // Keep controls enabled when focus moves to the toolbar itself
            // (clicking a format button), but disable them for block widgets.
            const next = event.relatedTarget;
            if (
              !(next instanceof Node) ||
              !toolbarRef.current?.contains(next)
            ) {
              setCanFormat(false);
            }
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          CAN_UNDO_COMMAND,
          (payload) => {
            setCanUndo(payload);
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          CAN_REDO_COMMAND,
          (payload) => {
            setCanRedo(payload);
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
      ),
    [editor, refreshToolbar],
  );

  // Return focus to the editor after a toolbar action so the caret/selection survives.
  const focusEditor = () => editor.focus();
  // Menus steal focus to the trigger on close; refocus the editor on the next frame to win.
  const focusEditorAfterMenu = () =>
    requestAnimationFrame(() => editor.focus());

  const applyFormat = (format: TextFormatType) => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    focusEditor();
  };

  const applyHistory = (command: typeof UNDO_COMMAND | typeof REDO_COMMAND) => {
    editor.dispatchCommand(command, undefined);
    focusEditor();
  };

  const applyBlockStyle = (id: "paragraph" | HeadingTagType | "quote") => {
    // Exiting a list needs the list command; $setBlocksType alone leaves orphan list wrappers.
    if (blockKind === "bullet" || blockKind === "number") {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    }
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      if (id === "paragraph") {
        $setBlocksType(selection, () => $createParagraphNode());
      } else if (id === "quote") {
        $setBlocksType(selection, () => $createQuoteNode());
      } else {
        $setBlocksType(selection, () => $createHeadingNode(id));
      }
    });
    setStyleOpen(false);
    focusEditorAfterMenu();
  };

  const toggleList = (kind: "bullet" | "number") => {
    if (blockKind === kind) {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    } else {
      editor.dispatchCommand(
        kind === "bullet"
          ? INSERT_UNORDERED_LIST_COMMAND
          : INSERT_ORDERED_LIST_COMMAND,
        undefined,
      );
    }
    focusEditor();
  };

  const insertNode = (node: RichTextEditorNode) => {
    editor.dispatchCommand(INSERT_RICH_TEXT_NODE_COMMAND, node);
    onMenuOpen(false);
    focusEditorAfterMenu();
  };

  const textAllowed = canUse("text", allowedNodes);
  const styleChoices = blockStyleOptions.filter(
    (option) =>
      option.id === "paragraph" ||
      (option.node === "heading" && canUse("heading", allowedNodes)) ||
      (option.node === "quote" && canUse("quote", allowedNodes)),
  );
  const currentStyle =
    styleChoices.find((option) => option.id === blockKind) ?? styleChoices[0];
  const menuItems = starterNodes.filter(
    (item) =>
      canUse(item.node.type, allowedNodes) &&
      canInsertStarterNode(item, bindings),
  );

  return (
    <AriaToolbar
      ref={toolbarRef}
      aria-label={`${label} formatting`}
      className="flex flex-wrap items-center gap-1 border-b border-base-300 bg-base-200 px-2 py-2"
    >
      <div className="flex items-center gap-1">
        <ToolbarButton
          icon="Undo2"
          label="Undo"
          isDisabled={!canUndo}
          onPress={() => applyHistory(UNDO_COMMAND)}
        />
        <ToolbarButton
          icon="Redo2"
          label="Redo"
          isDisabled={!canRedo}
          onPress={() => applyHistory(REDO_COMMAND)}
        />
      </div>

      <ToolbarDivider />

      {styleChoices.length > 1 ? (
        <MenuTrigger
          isOpen={styleOpen}
          onOpenChange={setStyleOpen}
          placement="bottom start"
        >
          <AriaButton
            aria-label="Text style"
            isDisabled={!canFormat}
            className="btn btn-sm btn-ghost w-40 justify-start gap-2"
          >
            <NavIcon name={currentStyle.icon} />
            <span className="flex-1 truncate text-left">
              {currentStyle.label}
            </span>
            <NavIcon name="ChevronDown" />
          </AriaButton>
          <Menu aria-label="Text style" className="w-56">
            {styleChoices.map((option) => (
              <MenuItem
                key={option.id}
                id={option.id}
                textValue={option.label}
                onAction={() => applyBlockStyle(option.id)}
              >
                <span className="flex items-center gap-3">
                  <NavIcon name={option.icon} />
                  <span className={`leading-tight ${option.preview}`}>
                    {option.label}
                  </span>
                </span>
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
      ) : null}

      {textAllowed ? (
        <>
          <ToolbarDivider />
          <div className="flex items-center gap-1">
            {inlineFormats.map(({ format, icon, label: formatLabel }) => (
              <ToolbarButton
                key={format}
                icon={icon}
                label={formatLabel}
                isActive={activeFormats.has(format)}
                isDisabled={!canFormat}
                onPress={() => applyFormat(format)}
              />
            ))}
          </div>
        </>
      ) : null}

      {canUse("list", allowedNodes) ? (
        <>
          <ToolbarDivider />
          <div className="flex items-center gap-1">
            <ToolbarButton
              icon="List"
              label="Bullet list"
              isActive={blockKind === "bullet"}
              isDisabled={!canFormat}
              onPress={() => toggleList("bullet")}
            />
            <ToolbarButton
              icon="ListOrdered"
              label="Numbered list"
              isActive={blockKind === "number"}
              isDisabled={!canFormat}
              onPress={() => toggleList("number")}
            />
          </div>
        </>
      ) : null}

      {menuItems.length > 0 ? (
        <>
          <ToolbarDivider />
          <MenuTrigger
            isOpen={menuOpen}
            onOpenChange={onMenuOpen}
            placement="bottom start"
          >
            <AriaButton
              aria-label="Insert block"
              className={`btn btn-sm gap-1.5 ${menuOpen ? "btn-primary" : "btn-ghost"}`}
            >
              <NavIcon name="Plus" />
              <span>Insert</span>
            </AriaButton>
            <Menu aria-label={`${label} insert block`} className="w-56">
              {menuItems.map((item) => (
                <MenuItem
                  key={item.id}
                  id={item.id}
                  textValue={item.label}
                  onAction={() => insertNode(item.node)}
                >
                  <span className="flex items-center gap-2.5">
                    <NavIcon name={item.icon} />
                    {item.label}
                  </span>
                </MenuItem>
              ))}
            </Menu>
          </MenuTrigger>
        </>
      ) : null}

      {!textAllowed ? (
        <Text variant="caption">Text nodes disabled by allowlist</Text>
      ) : null}
    </AriaToolbar>
  );
}

function ToolbarDivider() {
  return <span className="mx-0.5 h-5 w-px bg-base-300" aria-hidden="true" />;
}

function EditorDocumentSyncPlugin({
  document,
  lastEmittedStateJson,
}: {
  readonly document: RichTextEditorDocument;
  readonly lastEmittedStateJson: RefObject<string | null>;
}) {
  const [editor] = useLexicalComposerContext();
  const editorStateJson = JSON.stringify(lexicalEditorState(document));
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (lastEmittedStateJson.current === editorStateJson) {
      return;
    }
    const currentStateJson = JSON.stringify(editor.getEditorState().toJSON());
    if (currentStateJson !== editorStateJson) {
      editor.setEditorState(editor.parseEditorState(editorStateJson));
    }
  }, [editor, editorStateJson]);

  return null;
}

function ToolbarButton({
  icon,
  isActive,
  isDisabled,
  label,
  onPress,
}: {
  readonly icon: string;
  readonly isActive?: boolean;
  readonly isDisabled?: boolean;
  readonly label: string;
  readonly onPress?: () => void;
}) {
  return (
    <Tooltip content={label}>
      <AriaButton
        type="button"
        aria-label={label}
        isDisabled={isDisabled}
        onPress={onPress}
        className={`btn btn-sm btn-square ${isActive ? "btn-primary" : "btn-ghost"}`}
      >
        <NavIcon name={icon} />
      </AriaButton>
    </Tooltip>
  );
}

const starterNodes: readonly {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly node: RichTextEditorNode;
}[] = [
  {
    icon: "Pilcrow",
    id: "paragraph",
    label: "Paragraph",
    node: paragraphNode(""),
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

function normalizeDocument(value: unknown): RichTextEditorDocument {
  if (isRecord(value) && isRecord(value.root)) {
    const children = Array.isArray(value.root.children)
      ? value.root.children.flatMap(normalizeNode)
      : [];
    return { root: { children } };
  }
  if (typeof value === "string" && value.trim()) {
    try {
      return normalizeDocument(JSON.parse(value) as unknown);
    } catch {
      return { root: { children: [paragraphNode(value)] } };
    }
  }
  return { root: { children: [] } };
}

function normalizeNode(value: unknown): RichTextEditorNode[] {
  if (!isNode(value)) {
    return [];
  }
  if (value.type === "paragraph") {
    return [
      {
        children: normalizeChildren(value.children),
        type: "paragraph",
      },
    ];
  }
  if (value.type === "heading") {
    return [
      {
        children: normalizeChildren(value.children),
        tag: headingTag(value.tag),
        type: "heading",
      },
    ];
  }
  if (value.type === "quote") {
    return [
      {
        children: normalizeChildren(value.children),
        type: "quote",
      },
    ];
  }
  if (value.type === "list") {
    const listType = listTypeValue(value.listType, value.tag);
    return [
      {
        children: normalizeChildren(value.children),
        listType,
        start: numberValue(value.start) ?? 1,
        tag: listType === "number" ? "ol" : "ul",
        type: "list",
      },
    ];
  }
  if (value.type === "listitem") {
    return [
      {
        children: normalizeChildren(value.children),
        type: "listitem",
        value: numberValue(value.value) ?? 1,
        ...(typeof value.checked === "boolean"
          ? { checked: value.checked }
          : {}),
      },
    ];
  }
  if (value.type === "text") {
    return [
      {
        detail: numberValue(value.detail) ?? 0,
        format: numberValue(value.format) ?? 0,
        mode: stringValue(value.mode) ?? "normal",
        style: stringValue(value.style) ?? "",
        text: stringValue(value.text) ?? "",
        type: "text",
      },
    ];
  }
  if (value.type === "linebreak") {
    return [{ type: "linebreak" }];
  }
  if (value.type === "callout") {
    return [
      {
        children: normalizeChildren(value.children, stringValue(value.text)),
        tone: stringValue(value.tone) ?? "info",
        type: "callout",
      },
    ];
  }
  if (value.type === "code-block" || value.type === "code") {
    return [
      {
        language: stringValue(value.language) ?? "ts",
        text: stringValue(value.text) ?? "",
        type: "code-block",
      },
    ];
  }
  if (value.type === "embed") {
    return [{ type: "embed", url: stringValue(value.url) ?? "" }];
  }
  if (value.type === "media") {
    return [
      {
        alt: stringValue(value.alt) ?? "",
        caption: stringValue(value.caption) ?? "",
        mediaId: stringValue(value.mediaId) ?? "",
        type: "media",
      },
    ];
  }
  if (value.type === "post-ref") {
    return [
      {
        postId: stringValue(value.postId) ?? "",
        title: stringValue(value.title) ?? "",
        type: "post-ref",
        url: stringValue(value.url) ?? "",
      },
    ];
  }
  return value.children ? [...normalizeChildren(value.children)] : [];
}

function normalizeChildren(
  children: readonly RichTextEditorNode[] | undefined,
  fallbackText?: string,
): readonly RichTextEditorNode[] {
  const normalized = Array.isArray(children)
    ? children.flatMap(normalizeNode)
    : [];
  if (normalized.length > 0) {
    return normalized;
  }
  return fallbackText !== undefined
    ? [{ text: fallbackText, type: "text" }]
    : [];
}

function lexicalEditorState(document: RichTextEditorDocument) {
  const children = document.root.children.flatMap(lexicalNode);
  return {
    root: {
      children: children.length > 0 ? children : [emptyLexicalParagraph()],
      direction: null,
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  };
}

function emptyLexicalParagraph() {
  return {
    children: [],
    direction: null,
    format: "",
    indent: 0,
    textFormat: 0,
    textStyle: "",
    type: "paragraph",
    version: 1,
  };
}

function lexicalNode(node: RichTextEditorNode): unknown[] {
  if (node.type === "paragraph") {
    return [
      {
        children: (node.children ?? []).flatMap(lexicalNode),
        direction: null,
        format: "",
        indent: 0,
        textFormat: 0,
        textStyle: "",
        type: "paragraph",
        version: 1,
      },
    ];
  }
  if (node.type === "heading") {
    return [
      {
        children: (node.children ?? []).flatMap(lexicalNode),
        direction: null,
        format: "",
        indent: 0,
        tag: headingTag(node.tag),
        type: "heading",
        version: 1,
      },
    ];
  }
  if (node.type === "quote") {
    return [
      {
        children: (node.children ?? []).flatMap(lexicalNode),
        direction: null,
        format: "",
        indent: 0,
        type: "quote",
        version: 1,
      },
    ];
  }
  if (node.type === "list") {
    const listType = listTypeValue(node.listType, node.tag);
    return [
      {
        children: (node.children ?? []).flatMap(lexicalNode),
        direction: null,
        format: "",
        indent: 0,
        listType,
        start: numberValue(node.start) ?? 1,
        tag: listType === "number" ? "ol" : "ul",
        type: "list",
        version: 1,
      },
    ];
  }
  if (node.type === "listitem") {
    return [
      {
        children: (node.children ?? []).flatMap(lexicalNode),
        direction: null,
        format: "",
        indent: 0,
        type: "listitem",
        value: numberValue(node.value) ?? 1,
        version: 1,
        ...(typeof node.checked === "boolean" ? { checked: node.checked } : {}),
      },
    ];
  }
  if (node.type === "text") {
    return [
      {
        detail: numberValue(node.detail) ?? 0,
        format: numberValue(node.format) ?? 0,
        mode: stringValue(node.mode) ?? "normal",
        style: stringValue(node.style) ?? "",
        text: typeof node.text === "string" ? node.text : "",
        type: "text",
        version: 1,
      },
    ];
  }
  if (node.type === "linebreak") {
    return [{ type: "linebreak", version: 1 }];
  }
  if (
    node.type === "callout" ||
    node.type === "code-block" ||
    node.type === "embed" ||
    node.type === "media" ||
    node.type === "post-ref"
  ) {
    return [
      {
        ...node,
        type: node.type,
        version: 1,
      },
    ];
  }
  return [];
}

function paragraphNode(text: string): RichTextEditorNode {
  return {
    children: [{ text, type: "text" }],
    type: "paragraph",
  };
}

function canUse(type: string, allowed: readonly string[]): boolean {
  return allowed.includes(type);
}

function canInsertStarterNode(
  item: (typeof starterNodes)[number],
  bindings: {
    readonly mediaLibrary?: unknown;
    readonly onUploadMedia?: unknown;
    readonly postLibrary?: unknown;
  },
): boolean {
  if (item.node.type === "media") {
    return Boolean(bindings.mediaLibrary || bindings.onUploadMedia);
  }
  if (item.node.type === "post-ref") {
    return Boolean(bindings.postLibrary);
  }
  return true;
}

function isNode(value: unknown): value is RichTextEditorNode {
  return isRecord(value) && typeof value.type === "string";
}

function headingTag(value: unknown): "h1" | "h2" | "h3" | "h4" | "h5" | "h6" {
  return value === "h1" ||
    value === "h2" ||
    value === "h3" ||
    value === "h4" ||
    value === "h5" ||
    value === "h6"
    ? value
    : "h2";
}

function listTypeValue(
  listType: unknown,
  tag: unknown,
): "bullet" | "number" | "check" {
  if (listType === "number" || tag === "ol") return "number";
  if (listType === "check") return "check";
  return "bullet";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
