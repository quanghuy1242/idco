// DaisyUI 5: https://daisyui.com/components/textarea/
"use client";

import { useMemo, useState } from "react";
import { Button } from "./button";
import { CodeEditor } from "./code-editor";
import { FileDropzone } from "./file-dropzone";
import { Textarea } from "./form";
import { Inline } from "./inline";
import { Stack, Toolbar } from "./layout";
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
  const source = JSON.stringify(document, null, 2);

  function updateText(text: string) {
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
      <Toolbar>
        <Text variant="h3">{label}</Text>
        <Inline gap="xs" wrap>
          {canUse("paragraph", allowedNodes) ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => append(paragraphNode(""))}
            >
              Paragraph
            </Button>
          ) : null}
          {canUse("heading", allowedNodes) ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                append({
                  children: [{ text: "Heading", type: "text" }],
                  tag: "h2",
                  type: "heading",
                })
              }
            >
              Heading
            </Button>
          ) : null}
          {canUse("callout", allowedNodes) ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                append({
                  children: [{ text: "Callout", type: "text" }],
                  tone: "info",
                  type: "callout",
                })
              }
            >
              Callout
            </Button>
          ) : null}
          {canUse("code-block", allowedNodes) ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                append({
                  language: "ts",
                  text: "const value = true;",
                  type: "code-block",
                })
              }
            >
              Code
            </Button>
          ) : null}
          {canUse("embed", allowedNodes) ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                append({ type: "embed", url: "https://example.com" })
              }
            >
              Embed
            </Button>
          ) : null}
          {canUse("media", allowedNodes) ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                append({
                  alt: "",
                  caption: "",
                  mediaId: "",
                  type: "media",
                })
              }
            >
              Media
            </Button>
          ) : null}
          {canUse("post-ref", allowedNodes) ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                append({
                  postId: "",
                  title: "Referenced post",
                  type: "post-ref",
                })
              }
            >
              Post Ref
            </Button>
          ) : null}
        </Inline>
      </Toolbar>
      <Textarea
        label={`${label} plain text`}
        name={name ? `${name}-plain` : "rich-text-plain"}
        value={plainText(document)}
        rows={8}
        onChange={updateText}
      />
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

function paragraphNode(text: string): RichTextEditorNode {
  return {
    children: [{ text, type: "text" }],
    type: "paragraph",
  };
}

function plainText(document: RichTextEditorDocument): string {
  return document.root.children.map(textFromNode).join("\n\n");
}

function textFromNode(node: RichTextEditorNode): string {
  const ownText = typeof node.text === "string" ? node.text : "";
  const childText = (node.children ?? []).map(textFromNode).join("");
  return `${ownText}${childText}`;
}

function canUse(type: string, allowed: readonly string[]): boolean {
  return allowed.includes(type);
}

function isNode(value: unknown): value is RichTextEditorNode {
  return isRecord(value) && typeof value.type === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
