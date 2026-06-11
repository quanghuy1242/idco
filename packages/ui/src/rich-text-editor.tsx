// DaisyUI 5: https://daisyui.com/components/textarea/
"use client";

import { ListItemNode, ListNode } from "@lexical/list";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  type EditorState,
} from "lexical";
import { useMemo, useState } from "react";
import { Button } from "./button";
import { CodeEditor } from "./code-editor";
import { FileDropzone } from "./file-dropzone";
import { Inline } from "./inline";
import { Panel, Stack, Toolbar } from "./layout";
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

type RichTextEditorProps = {
  readonly value: unknown;
  readonly onChange: (value: RichTextEditorDocument) => void;
  readonly label: string;
  readonly name?: string;
  readonly error?: string;
  readonly allowedNodes?: readonly string[];
  readonly onUploadMedia?: (files: File[]) => void;
};

const defaultAllowedNodes = [
  "paragraph",
  "heading",
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
  onUploadMedia,
}: RichTextEditorProps) {
  const document = useMemo(() => normalizeDocument(value), [value]);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const source = JSON.stringify(document, null, 2);

  function applyEditorState(editorState: EditorState) {
    onChange(normalizeDocument(editorState.toJSON()));
  }

  function replaceWithPlainText(text: string) {
    onChange({
      root: {
        children: [
          {
            children: [{ text, type: "text" }],
            type: "paragraph",
          },
        ],
      },
    });
  }

  function append(node: RichTextEditorNode) {
    onChange({
      root: { children: [...document.root.children, node] },
    });
  }

  return (
    <Stack gap="sm">
      <Text variant="h3">{label}</Text>
      <Panel padding="sm">
        <LexicalComposer
          initialConfig={{
            editorState: JSON.stringify(lexicalEditorState(document)),
            namespace: `idco-rich-text-${name ?? "field"}`,
            nodes: [HeadingNode, ListNode, ListItemNode, QuoteNode],
            onError(cause) {
              throw cause;
            },
            theme: {
              paragraph: "mb-2",
              text: { bold: "font-bold", italic: "italic" },
            },
          }}
        >
          <Toolbar>
            <LexicalToolbar
              allowedNodes={allowedNodes}
              menuOpen={menuOpen}
              onMenuOpen={setMenuOpen}
              onPlainText={replaceWithPlainText}
            />
          </Toolbar>
          {menuOpen ? (
            <StarterNodeMenu
              allowedNodes={allowedNodes}
              onInsert={(node) => {
                append(node);
                setMenuOpen(false);
              }}
            />
          ) : null}
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                aria-label={label}
                className="textarea textarea-bordered min-h-40 w-full bg-base-100 text-base-content"
                onKeyDown={(event) => {
                  if (event.key === "/") {
                    setMenuOpen(true);
                  }
                }}
              />
            }
            placeholder={
              <Text variant="caption">Type / for rich content blocks</Text>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <OnChangePlugin onChange={applyEditorState} />
        </LexicalComposer>
      </Panel>
      {onUploadMedia && canUse("media", allowedNodes) ? (
        <FileDropzone
          label="Upload inline media"
          accept={["image/*"]}
          onFiles={onUploadMedia}
        />
      ) : null}
      <CodeEditor
        label={`${label} JSON`}
        name={name}
        value={source}
        error={sourceError ?? error}
        onChange={(next) => {
          try {
            const parsed = JSON.parse(next) as unknown;
            const normalized = normalizeDocument(parsed);
            setSourceError(null);
            onChange(normalized);
          } catch {
            setSourceError("Invalid rich text JSON");
          }
        }}
      />
    </Stack>
  );
}

function LexicalToolbar({
  allowedNodes,
  menuOpen,
  onMenuOpen,
  onPlainText,
}: {
  readonly allowedNodes: readonly string[];
  readonly menuOpen: boolean;
  readonly onMenuOpen: (open: boolean) => void;
  readonly onPlainText: (text: string) => void;
}) {
  const [editor] = useLexicalComposerContext();

  return (
    <Inline gap="xs" wrap>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
      >
        Bold
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
      >
        Italic
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => {
          editor.getEditorState().read(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              onPlainText(selection.getTextContent());
            }
          });
        }}
      >
        From Selection
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => onMenuOpen(!menuOpen)}
      >
        Slash Menu
      </Button>
      {!canUse("text", allowedNodes) ? (
        <Text variant="caption">Text nodes disabled by allowlist</Text>
      ) : null}
    </Inline>
  );
}

function StarterNodeMenu({
  allowedNodes,
  onInsert,
}: {
  readonly allowedNodes: readonly string[];
  readonly onInsert: (node: RichTextEditorNode) => void;
}) {
  return (
    <Panel tone="muted" padding="sm">
      <Stack gap="xs">
        <Text variant="body">Slash menu</Text>
        <Inline gap="xs" wrap>
          {starterNodes
            .filter((item) => canUse(item.node.type, allowedNodes))
            .map((item) => (
              <Button
                key={item.label}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => onInsert(item.node)}
              >
                {item.label}
              </Button>
            ))}
        </Inline>
      </Stack>
    </Panel>
  );
}

const starterNodes: readonly {
  readonly label: string;
  readonly node: RichTextEditorNode;
}[] = [
  { label: "Paragraph", node: paragraphNode("") },
  {
    label: "Heading",
    node: {
      children: [{ text: "Heading", type: "text" }],
      tag: "h2",
      type: "heading",
    },
  },
  {
    label: "Callout",
    node: {
      children: [{ text: "Callout", type: "text" }],
      tone: "info",
      type: "callout",
    },
  },
  {
    label: "Code",
    node: {
      language: "ts",
      text: "const value = true;",
      type: "code-block",
    },
  },
  { label: "Embed", node: { type: "embed", url: "https://example.com" } },
  {
    label: "Media",
    node: { alt: "", caption: "", mediaId: "", type: "media" },
  },
  {
    label: "Post Ref",
    node: { postId: "", title: "Referenced post", type: "post-ref" },
  },
];

function normalizeDocument(value: unknown): RichTextEditorDocument {
  if (isRecord(value) && isRecord(value.root)) {
    const children = Array.isArray(value.root.children)
      ? value.root.children.filter(isNode)
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
  if (node.type === "text") {
    return [
      {
        detail: 0,
        format: 0,
        mode: "normal",
        style: "",
        text: typeof node.text === "string" ? node.text : "",
        type: "text",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
