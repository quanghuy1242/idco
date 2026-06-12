// DaisyUI 5: https://daisyui.com/components/card/
"use client";
/* eslint-disable no-underscore-dangle -- Lexical node subclasses use __ fields by convention. */

import { $createHeadingNode, type HeadingTagType } from "@lexical/rich-text";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $insertNodeToNearestRoot } from "@lexical/utils";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  DecoratorNode,
  createCommand,
  type LexicalCommand,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from "lexical";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button as AriaButton } from "react-aria-components";
import { AlertGlyph, alertToneClass, type AlertTone } from "./alert";
import { CodeEditor, type CodeEditorLanguage } from "./code-editor";
import { FileDropzone } from "./file-dropzone";
import { Menu, MenuItem, MenuTrigger } from "./menu";
import { NavIcon } from "./nav-icons";
import { ResourceSelector } from "./resource-selector";
import { Text } from "./typography";
import type {
  RichTextEditorMediaOption,
  RichTextEditorNode,
  RichTextEditorPostOption,
} from "./rich-text-editor";

export const INSERT_RICH_TEXT_NODE_COMMAND: LexicalCommand<RichTextEditorNode> =
  createCommand("INSERT_RICH_TEXT_NODE_COMMAND");

type RichTextEditorBindings = {
  readonly allowedEmbedDomains?: readonly string[];
  readonly mediaLibrary?: {
    readonly load: (
      query: string,
      signal?: AbortSignal,
    ) => Promise<readonly RichTextEditorMediaOption[]>;
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

export const RichTextEditorBindingsContext =
  createContext<RichTextEditorBindings>({});

type SerializedRichTextDecoratorNode = SerializedLexicalNode &
  RichTextEditorNode;

abstract class RichTextDecoratorNode extends DecoratorNode<ReactNode> {
  __data: RichTextEditorNode;

  constructor(data: RichTextEditorNode, key?: NodeKey) {
    super(key);
    this.__data = data;
  }

  createDOM(): HTMLElement {
    const element = document.createElement("div");
    element.className = "my-3";
    return element;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): false {
    return false;
  }

  getData(): RichTextEditorNode {
    return this.getLatest().__data;
  }

  setData(patch: Partial<RichTextEditorNode>): void {
    const writable = this.getWritable();
    writable.__data = { ...writable.__data, ...patch };
  }

  exportJSON(): SerializedRichTextDecoratorNode {
    return {
      ...this.__data,
      type: this.getType(),
      version: 1,
    };
  }
}

export class CalloutNode extends RichTextDecoratorNode {
  static getType(): string {
    return "callout";
  }

  static clone(node: CalloutNode): CalloutNode {
    return new CalloutNode(node.__data, node.__key);
  }

  static importJSON(serializedNode: SerializedRichTextDecoratorNode) {
    return new CalloutNode(normalizeCalloutNode(serializedNode));
  }

  decorate(): ReactNode {
    return <CalloutEditor nodeKey={this.__key} node={this.getData()} />;
  }
}

export class CodeBlockNode extends RichTextDecoratorNode {
  static getType(): string {
    return "code-block";
  }

  static clone(node: CodeBlockNode): CodeBlockNode {
    return new CodeBlockNode(node.__data, node.__key);
  }

  static importJSON(serializedNode: SerializedRichTextDecoratorNode) {
    return new CodeBlockNode(normalizeCodeBlockNode(serializedNode));
  }

  decorate(): ReactNode {
    return <CodeBlockEditor nodeKey={this.__key} node={this.getData()} />;
  }
}

export class EmbedNode extends RichTextDecoratorNode {
  static getType(): string {
    return "embed";
  }

  static clone(node: EmbedNode): EmbedNode {
    return new EmbedNode(node.__data, node.__key);
  }

  static importJSON(serializedNode: SerializedRichTextDecoratorNode) {
    return new EmbedNode(normalizeEmbedNode(serializedNode));
  }

  decorate(): ReactNode {
    return <EmbedEditor nodeKey={this.__key} node={this.getData()} />;
  }
}

export class MediaNode extends RichTextDecoratorNode {
  static getType(): string {
    return "media";
  }

  static clone(node: MediaNode): MediaNode {
    return new MediaNode(node.__data, node.__key);
  }

  static importJSON(serializedNode: SerializedRichTextDecoratorNode) {
    return new MediaNode(normalizeMediaNode(serializedNode));
  }

  decorate(): ReactNode {
    return <MediaEditor nodeKey={this.__key} node={this.getData()} />;
  }
}

export class PostRefNode extends RichTextDecoratorNode {
  static getType(): string {
    return "post-ref";
  }

  static clone(node: PostRefNode): PostRefNode {
    return new PostRefNode(node.__data, node.__key);
  }

  static importJSON(serializedNode: SerializedRichTextDecoratorNode) {
    return new PostRefNode(normalizePostRefNode(serializedNode));
  }

  decorate(): ReactNode {
    return <PostRefEditor nodeKey={this.__key} node={this.getData()} />;
  }
}

export function RichTextNodePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        INSERT_RICH_TEXT_NODE_COMMAND,
        (node) => {
          const lexicalNode = richTextNodeToLexicalNode(node);
          if (!lexicalNode) {
            return false;
          }
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            // Insert at the caret's block instead of always appending to the end.
            $insertNodeToNearestRoot(lexicalNode);
          } else {
            $getRoot().append(lexicalNode);
          }
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    [editor],
  );

  return null;
}

export function richTextNodeToLexicalNode(
  node: RichTextEditorNode,
): LexicalNode | null {
  if (node.type === "paragraph") {
    const paragraph = $createParagraphNode();
    paragraph.append(
      ...textFromChildren(node.children, stringValue(node.text)).map((text) =>
        $createTextNode(text),
      ),
    );
    return paragraph;
  }
  if (node.type === "heading") {
    const heading = $createHeadingNode(headingTag(node.tag));
    heading.append(
      ...textFromChildren(node.children, stringValue(node.text)).map((text) =>
        $createTextNode(text),
      ),
    );
    return heading;
  }
  if (node.type === "callout") {
    return new CalloutNode(normalizeCalloutNode(node));
  }
  if (node.type === "code-block") {
    return new CodeBlockNode(normalizeCodeBlockNode(node));
  }
  if (node.type === "embed") {
    return new EmbedNode(normalizeEmbedNode(node));
  }
  if (node.type === "media") {
    return new MediaNode(normalizeMediaNode(node));
  }
  if (node.type === "post-ref") {
    return new PostRefNode(normalizePostRefNode(node));
  }
  return null;
}

const calloutTones: readonly {
  readonly value: AlertTone;
  readonly label: string;
  readonly icon: string;
  readonly text: string;
}[] = [
  { icon: "Info", label: "Info", text: "text-info", value: "info" },
  { icon: "Check", label: "Success", text: "text-success", value: "success" },
  {
    icon: "TriangleAlert",
    label: "Warning",
    text: "text-warning",
    value: "warning",
  },
  { icon: "CircleAlert", label: "Error", text: "text-error", value: "error" },
];

const calloutBadgeIcon: Record<AlertTone, string> = {
  info: "Info",
  success: "Check",
  warning: "TriangleAlert",
  error: "CircleAlert",
};

function CalloutEditor({
  node,
  nodeKey,
}: {
  readonly node: RichTextEditorNode;
  readonly nodeKey: NodeKey;
}) {
  const updateNode = useDecoratorNodeUpdater(nodeKey);
  const tone = calloutToneValue(node.tone);
  const text = childText(node);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  return (
    <BlockShell
      actions={
        <MenuTrigger>
          <BlockChromeButton icon="Settings" label="Callout tone" />
          <Menu aria-label="Callout tone" className="w-40">
            {calloutTones.map((option) => (
              <MenuItem
                key={option.value}
                id={option.value}
                textValue={option.label}
                onAction={() => updateNode({ tone: option.value })}
              >
                <span className="flex items-center gap-2">
                  <span className={option.text}>
                    <NavIcon name={option.icon} />
                  </span>
                  {option.label}
                </span>
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
      }
      icon={calloutBadgeIcon[tone]}
      label="Callout"
      nodeKey={nodeKey}
      padded={false}
    >
      {/* Mirrors the shared <Alert> component so editor and rendered callouts match. */}
      <div className={`alert ${alertToneClass[tone]} items-start`}>
        <AlertGlyph tone={tone} />
        <textarea
          ref={textareaRef}
          aria-label="Callout text"
          className="block w-full min-w-0 resize-none overflow-hidden bg-transparent text-sm leading-6 outline-none placeholder:opacity-60"
          placeholder="Write a callout…"
          rows={1}
          value={text}
          onChange={(event) =>
            updateNode({
              children: [{ text: event.target.value, type: "text" }],
            })
          }
        />
      </div>
    </BlockShell>
  );
}

const codeLanguages = [
  { label: "TypeScript", value: "ts" },
  { label: "JavaScript", value: "js" },
  { label: "JSON", value: "json" },
  { label: "Python", value: "python" },
  { label: "TSX", value: "tsx" },
  { label: "Text", value: "text" },
] as const;

function CodeBlockEditor({
  node,
  nodeKey,
}: {
  readonly node: RichTextEditorNode;
  readonly nodeKey: NodeKey;
}) {
  const updateNode = useDecoratorNodeUpdater(nodeKey);
  const language = codeLanguageValue(node.language);
  const languageLabel =
    codeLanguages.find((option) => option.value === language)?.label ??
    language;

  return (
    <BlockShell
      icon="Code"
      label="Code"
      nodeKey={nodeKey}
      padded={false}
      persistentActions={
        <MenuTrigger>
          <AriaButton
            aria-label="Code language"
            className="flex items-center gap-1 rounded-full border border-base-300 bg-base-200 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-base-content/70 transition hover:text-base-content"
          >
            {languageLabel}
            <NavIcon name="ChevronDown" variant="timeline" />
          </AriaButton>
          <Menu aria-label="Code language" className="w-40">
            {codeLanguages.map((option) => (
              <MenuItem
                key={option.value}
                id={option.value}
                label={option.label}
                onAction={() => updateNode({ language: option.value })}
              />
            ))}
          </Menu>
        </MenuTrigger>
      }
    >
      <div className="p-2">
        <CodeEditor
          label="Code content"
          value={stringValue(node.text) ?? ""}
          language={language}
          maxHeight="lg"
          onChange={(value) => updateNode({ text: value })}
        />
      </div>
    </BlockShell>
  );
}

function EmbedEditor({
  node,
  nodeKey,
}: {
  readonly node: RichTextEditorNode;
  readonly nodeKey: NodeKey;
}) {
  const updateNode = useDecoratorNodeUpdater(nodeKey);
  const { allowedEmbedDomains } = useContext(RichTextEditorBindingsContext);
  const url = stringValue(node.url) ?? "";
  const allowed = embedAllowed(url, allowedEmbedDomains);
  const previewable = allowed && /^https?:\/\//i.test(url);

  return (
    <BlockShell icon="Globe" label="Embed" nodeKey={nodeKey} padded={false}>
      <div className="grid gap-2 p-3">
        {previewable ? (
          <div className="aspect-video overflow-hidden rounded-box border border-base-300 bg-base-200">
            <iframe
              title="Embedded preview"
              src={url}
              className="size-full"
              sandbox="allow-scripts allow-popups allow-forms allow-presentation"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center rounded-box border border-dashed border-base-300 text-xs text-base-content/50">
            {url ? "Preview unavailable for this URL" : "Add an embed URL"}
          </div>
        )}
        <FieldLabel>URL</FieldLabel>
        <input
          aria-label="Embed URL"
          className={`input input-bordered w-full ${allowed ? "" : "input-error"}`.trim()}
          value={url}
          onChange={(event) => updateNode({ url: event.target.value })}
        />
        {!allowed ? (
          <Text variant="caption">
            This embed URL is not in the allowed domains.
          </Text>
        ) : null}
      </div>
    </BlockShell>
  );
}

function MediaEditor({
  node,
  nodeKey,
}: {
  readonly node: RichTextEditorNode;
  readonly nodeKey: NodeKey;
}) {
  const updateNode = useDecoratorNodeUpdater(nodeKey);
  const { mediaLibrary, onUploadMedia } = useContext(
    RichTextEditorBindingsContext,
  );
  const mediaId = stringValue(node.mediaId) ?? "";
  const alt = stringValue(node.alt) ?? "";
  const caption = stringValue(node.caption) ?? "";
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const resolve = mediaLibrary?.resolve;

  useEffect(() => {
    if (!mediaId || previewUrl || !resolve) return;
    let active = true;
    void (async () => {
      try {
        const option = await resolve(mediaId);
        if (active && option?.previewUrl) setPreviewUrl(option.previewUrl);
      } catch {
        // Resolve failures leave the preview empty; the alt/caption stay editable.
      }
    })();
    return () => {
      active = false;
    };
  }, [mediaId, previewUrl, resolve]);

  async function upload(files: File[]) {
    if (!onUploadMedia) return;
    setUploading(true);
    try {
      const nodes = await onUploadMedia(files);
      const uploaded = nodes?.find((candidate) => candidate.type === "media");
      if (uploaded) {
        updateNode(normalizeMediaNode(uploaded));
        const url = stringValue(uploaded.previewUrl);
        if (url) setPreviewUrl(url);
      }
    } finally {
      setUploading(false);
    }
  }

  function clearMedia() {
    updateNode({ alt: "", caption: "", mediaId: "" });
    setPreviewUrl(null);
  }

  if (mediaId) {
    return (
      <BlockShell icon="Image" label="Media" nodeKey={nodeKey} padded={false}>
        <div className="grid gap-3 p-3">
          {previewUrl ? (
            <figure className="overflow-hidden rounded-box border border-base-300 bg-base-200">
              <img
                src={previewUrl}
                alt={alt}
                className="max-h-72 w-full object-contain"
              />
              {caption ? (
                <figcaption className="border-t border-base-300 px-3 py-2 text-xs text-base-content/60">
                  {caption}
                </figcaption>
              ) : null}
            </figure>
          ) : (
            <div className="flex h-28 items-center justify-center rounded-box border border-dashed border-base-300 text-xs text-base-content/50">
              {`Selected media: ${mediaId}`}
            </div>
          )}
          <div className="grid gap-2">
            <FieldLabel>Alt text</FieldLabel>
            <input
              aria-label="Media alt text"
              className="input input-bordered w-full"
              value={alt}
              onChange={(event) => updateNode({ alt: event.target.value })}
            />
            <FieldLabel>Caption</FieldLabel>
            <input
              aria-label="Media caption"
              className="input input-bordered w-full"
              value={caption}
              onChange={(event) => updateNode({ caption: event.target.value })}
            />
          </div>
          <div>
            <AriaButton
              type="button"
              onPress={clearMedia}
              className="btn btn-sm btn-ghost gap-1.5"
            >
              <NavIcon name="RefreshCw" />
              Replace image
            </AriaButton>
          </div>
        </div>
      </BlockShell>
    );
  }

  return (
    <BlockShell icon="Image" label="Media" nodeKey={nodeKey} padded={false}>
      <div className="grid gap-3 p-3">
        {mediaLibrary ? (
          <ResourceSelector
            kind="media"
            value=""
            placeholder="Browse library…"
            onChange={(id) => updateNode({ mediaId: String(id) })}
            onSelectOption={(option) => {
              updateNode({ alt: option.sublabel ?? alt, mediaId: option.id });
              if (option.image) setPreviewUrl(option.image);
            }}
            source={{
              load: async (query, signal) =>
                (await mediaLibrary.load(query, signal)).map((option) => ({
                  id: option.id,
                  image: option.previewUrl,
                  label: option.label,
                  sublabel: option.alt,
                })),
              mode: "async",
            }}
            label="Pick from media library"
            showLabel
            variant="menu"
          />
        ) : null}
        {mediaLibrary && onUploadMedia ? <OrDivider /> : null}
        {onUploadMedia ? (
          <FileDropzone
            label="Upload a new image"
            accept={["image/*"]}
            hint="PNG, JPEG, GIF, or WebP"
            onFiles={(files) => void upload(files)}
          />
        ) : null}
        {uploading ? <Text variant="caption">Uploading…</Text> : null}
        {!mediaLibrary && !onUploadMedia ? (
          <Text variant="caption">
            Media picking is not configured for this field.
          </Text>
        ) : null}
      </div>
    </BlockShell>
  );
}

function OrDivider() {
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-base-content/40">
      <span className="h-px flex-1 bg-base-300" />
      or
      <span className="h-px flex-1 bg-base-300" />
    </div>
  );
}

function PostRefEditor({
  node,
  nodeKey,
}: {
  readonly node: RichTextEditorNode;
  readonly nodeKey: NodeKey;
}) {
  const updateNode = useDecoratorNodeUpdater(nodeKey);
  const { postLibrary } = useContext(RichTextEditorBindingsContext);
  const postId = stringValue(node.postId) ?? "";
  const title = stringValue(node.title) ?? "";
  const href = stringValue(node.url) ?? "";

  return (
    <BlockShell
      icon="Link2"
      label="Post reference"
      nodeKey={nodeKey}
      padded={false}
    >
      <div className="grid gap-2 p-3">
        {postId ? (
          <div className="flex items-center gap-2 rounded-box border border-base-300 bg-base-200 px-3 py-2 text-sm">
            <NavIcon name="FileText" />
            <span className="min-w-0 flex-1 truncate text-base-content">
              {title || postId}
            </span>
            {href ? (
              <span className="hidden truncate text-xs text-base-content/50 sm:inline">
                {href}
              </span>
            ) : null}
            <NavIcon name="ExternalLink" />
          </div>
        ) : null}
        {postLibrary ? (
          <ResourceSelector
            kind="record"
            value={postId}
            onChange={(id) => updateNode({ postId: String(id) })}
            onSelectOption={(option) =>
              updateNode({
                postId: option.id,
                title: option.label,
                url: option.sublabel ?? "",
              })
            }
            source={{
              load: async (query, signal) =>
                (await postLibrary.load(query, signal)).map((option) => ({
                  id: option.id,
                  label: option.label,
                  sublabel: option.href,
                })),
              mode: "async",
            }}
            label="Referenced post"
            showLabel
            variant="menu"
          />
        ) : (
          <Text variant="caption">
            Post picking is not configured for this field.
          </Text>
        )}
      </div>
    </BlockShell>
  );
}

function BlockShell({
  actions,
  children,
  icon,
  label,
  nodeKey,
  padded = true,
  persistentActions,
}: {
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly icon: string;
  readonly label: string;
  readonly nodeKey: NodeKey;
  readonly padded?: boolean;
  /** Chrome shown at all times (not only on hover), e.g. the code-block language. */
  readonly persistentActions?: ReactNode;
}) {
  const remove = useRemoveNode(nodeKey);
  return (
    <div className="group/block relative rounded-box border border-base-300 bg-base-100">
      <span className="pointer-events-none absolute -top-2.5 left-3 z-10 flex items-center gap-1 rounded-full border border-base-300 bg-base-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-base-content/60 opacity-0 transition-opacity group-hover/block:opacity-100 group-focus-within/block:opacity-100">
        <NavIcon name={icon} variant="timeline" />
        {label}
      </span>
      <div className="absolute -top-2.5 right-2 z-10 flex items-center gap-1">
        {persistentActions}
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/block:opacity-100 group-focus-within/block:opacity-100">
          {actions}
          <AriaButton
            type="button"
            aria-label={`Remove ${label}`}
            onPress={remove}
            className="grid size-6 place-items-center rounded-full border border-base-300 bg-base-200 text-base-content/60 transition hover:text-error"
          >
            <NavIcon name="X" variant="timeline" />
          </AriaButton>
        </div>
      </div>
      <div className={padded ? "p-3" : ""}>{children}</div>
    </div>
  );
}

function BlockChromeButton({
  icon,
  label,
}: {
  readonly icon: string;
  readonly label: string;
}) {
  return (
    <AriaButton
      type="button"
      aria-label={label}
      className="grid size-6 place-items-center rounded-full border border-base-300 bg-base-200 text-base-content/60 transition hover:text-base-content"
    >
      <NavIcon name={icon} variant="timeline" />
    </AriaButton>
  );
}

function FieldLabel({ children }: { readonly children: ReactNode }) {
  return (
    <span className="text-xs font-medium text-base-content/70">{children}</span>
  );
}

function useDecoratorNodeUpdater(key: NodeKey) {
  const [editor] = useLexicalComposerContext();
  return useCallback(
    (patch: Partial<RichTextEditorNode>) => {
      editor.update(() => {
        const node = $getNodeByKey(key);
        if (node instanceof RichTextDecoratorNode) {
          node.setData(patch);
        }
      });
    },
    [editor, key],
  );
}

function useRemoveNode(key: NodeKey) {
  const [editor] = useLexicalComposerContext();
  return useCallback(() => {
    editor.update(() => {
      $getNodeByKey(key)?.remove();
    });
  }, [editor, key]);
}

function normalizeCalloutNode(node: RichTextEditorNode): RichTextEditorNode {
  return {
    children: [{ text: childText(node) || "Callout", type: "text" }],
    tone: calloutToneValue(node.tone),
    type: "callout",
  };
}

function normalizeCodeBlockNode(node: RichTextEditorNode): RichTextEditorNode {
  return {
    language: codeLanguageValue(node.language),
    text: stringValue(node.text) ?? "",
    type: "code-block",
  };
}

function normalizeEmbedNode(node: RichTextEditorNode): RichTextEditorNode {
  return {
    type: "embed",
    url: stringValue(node.url) ?? "",
  };
}

function normalizeMediaNode(node: RichTextEditorNode): RichTextEditorNode {
  return {
    alt: stringValue(node.alt) ?? "",
    caption: stringValue(node.caption) ?? "",
    mediaId: stringValue(node.mediaId) ?? "",
    type: "media",
  };
}

function normalizePostRefNode(node: RichTextEditorNode): RichTextEditorNode {
  return {
    postId: stringValue(node.postId) ?? "",
    title: stringValue(node.title) ?? "",
    type: "post-ref",
    url: stringValue(node.url) ?? "",
  };
}

function calloutToneValue(value: unknown): AlertTone {
  return value === "info" ||
    value === "success" ||
    value === "warning" ||
    value === "error"
    ? value
    : "info";
}

function codeLanguageValue(value: unknown): CodeEditorLanguage {
  return value === "json" ||
    value === "tsx" ||
    value === "js" ||
    value === "python" ||
    value === "text"
    ? value
    : "ts";
}

function textFromChildren(
  children: readonly RichTextEditorNode[] | undefined,
  fallback = "",
): string[] {
  const text = children
    ?.map((child) => stringValue(child.text))
    .filter((value): value is string => value !== undefined);
  return text && text.length > 0 ? text : [fallback];
}

function childText(node: RichTextEditorNode): string {
  return textFromChildren(node.children, stringValue(node.text)).join("");
}

function headingTag(value: unknown): HeadingTagType {
  return value === "h1" ||
    value === "h2" ||
    value === "h3" ||
    value === "h4" ||
    value === "h5" ||
    value === "h6"
    ? value
    : "h2";
}

function embedAllowed(
  url: string,
  allowedEmbedDomains: readonly string[] | undefined,
): boolean {
  if (!url || !allowedEmbedDomains?.length) {
    return true;
  }
  try {
    return allowedEmbedDomains.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
