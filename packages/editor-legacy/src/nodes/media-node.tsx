// DaisyUI 5: https://daisyui.com/components/card/

import {
  FileDropzone,
  Input,
  NavIcon,
  ResourceSelector,
  Text,
} from "@quanghuy1242/idco-ui";
import { useContext, useEffect, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { normalizeMediaNode } from "../model/normalize";
import { stringValue } from "../model/schema";
import {
  BlockShell,
  FieldLabel,
  OrDivider,
  RichTextEditorBindingsContext,
} from "./base";
import {
  defineDecoratorBlock,
  type DecoratorBlockProps,
} from "./decorator-block";

export const MediaNode = defineDecoratorBlock({
  Editor: MediaEditor,
  normalize: normalizeMediaNode,
  type: "media",
});

function MediaEditor({ node, nodeKey, update }: DecoratorBlockProps) {
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
        update(normalizeMediaNode(uploaded));
        const url = stringValue(uploaded.previewUrl);
        if (url) setPreviewUrl(url);
      }
    } finally {
      setUploading(false);
    }
  }

  function clearMedia() {
    update({ alt: "", caption: "", mediaId: "" });
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
            <Input
              ariaLabel="Media alt text"
              value={alt}
              onChange={(value) => update({ alt: value })}
            />
            <FieldLabel>Caption</FieldLabel>
            <Input
              ariaLabel="Media caption"
              value={caption}
              onChange={(value) => update({ caption: value })}
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
            onChange={(id) => update({ mediaId: String(id) })}
            onSelectOption={(option) => {
              update({ alt: option.sublabel ?? alt, mediaId: option.id });
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
