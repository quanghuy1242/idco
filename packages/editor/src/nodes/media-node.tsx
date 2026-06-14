// DaisyUI 5: https://daisyui.com/components/card/
/* eslint-disable no-underscore-dangle -- Lexical node subclasses use __ fields by convention. */

import {
  FileDropzone,
  NavIcon,
  ResourceSelector,
  Text,
} from "@quanghuy1242/idco-ui";
import type { ElementFormatType, NodeKey } from "lexical";
import { useContext, useEffect, useState } from "react";
import { normalizeMediaNode } from "../model/normalize";
import { stringValue, type RichTextEditorNode } from "../model/schema";
import {
  BlockShell,
  FieldLabel,
  OrDivider,
  RichTextDecoratorBlockNode,
  RichTextEditorBindingsContext,
  useDecoratorNodeUpdater,
  type SerializedRichTextDecoratorNode,
} from "./base";
import { Button as AriaButton } from "react-aria-components";

export class MediaNode extends RichTextDecoratorBlockNode {
  static getType(): string {
    return "media";
  }

  static clone(node: MediaNode): MediaNode {
    return new MediaNode(node.__data, node.__format, node.__key);
  }

  static importJSON(serializedNode: SerializedRichTextDecoratorNode) {
    return new MediaNode(
      normalizeMediaNode(serializedNode),
      (serializedNode.format as ElementFormatType) || "",
    );
  }

  decorate() {
    return <MediaEditor nodeKey={this.__key} node={this.getData()} />;
  }
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
