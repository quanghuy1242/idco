/**
 * The built-in `media` (image) node view (docs/016 §9, docs/020 §7.2).
 *
 * Live editing opens in the block's anchored React Aria popover (the baked figure
 * stays mounted behind it, so the box does not shift, AC3): `@idco/ui` Source/Alt/
 * Caption fields plus an upload affordance. Upload transport is the host's
 * `uploadImage` binding (AC10, §10.5) — the node only receives a resolved `src`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, RichTextMediaFigure } from "@quanghuy1242/idco-ui";
import { type EditorStore, type NodeId, type ObjectNode } from "../../core";
import { type NodeView } from "../node-view";
import { asRecord, currentObjectRecord, stringField } from "../object-data";
import { useUpload } from "../upload-context";
import {
  mediaBakedStyle,
  mediaThumbStyle,
  objectConfigFieldStyle,
} from "../styles";

function MediaLiveSurface(props: {
  readonly node: ObjectNode;
  readonly store: EditorStore;
  readonly registerObjectEditor: (id: NodeId, mounted: boolean) => void;
}) {
  const { node, store, registerObjectEditor } = props;
  const id = node.id;
  const upload = useUpload();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const record = asRecord(node.data);
    return {
      alt: stringField(record, "alt"),
      caption: stringField(record, "caption"),
      src: stringField(record, "src"),
    };
  });

  useEffect(() => {
    registerObjectEditor(id, true);
    return () => registerObjectEditor(id, false);
  }, [id, registerObjectEditor]);

  const commit = useCallback(
    (next: Record<string, string>) => {
      const record = currentObjectRecord(store, id);
      store.command({
        data: { ...record, ...next },
        node: id,
        type: "set-object-data",
      });
    },
    [id, store],
  );

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file || !upload) return;
      const result = await upload(file);
      const next = {
        ...values,
        alt: result.alt ?? values.alt,
        src: result.src,
      };
      setValues(next);
      commit(next);
    },
    [commit, upload, values],
  );

  return (
    <div className="grid w-72 gap-2" data-engine-object-editor="media">
      {(["src", "alt", "caption"] as const).map((key) => (
        <label
          data-engine-config-field={key}
          key={key}
          style={objectConfigFieldStyle}
        >
          <span className="min-w-16 text-sm capitalize">{key}</span>
          <Input
            ariaLabel={
              key === "src" ? "Source" : key === "alt" ? "Alt" : "Caption"
            }
            onChange={(value) => {
              const next = { ...values, [key]: value };
              setValues(next);
              commit(next);
            }}
            size="sm"
            value={values[key] ?? ""}
          />
        </label>
      ))}
      <div className="flex items-center justify-end gap-2">
        {upload ? (
          <>
            <input
              accept="image/*"
              aria-hidden="true"
              hidden
              onChange={(event) => void onFile(event.target.files?.[0])}
              ref={fileRef}
              type="file"
            />
            <Button
              ariaLabel="Upload image"
              iconName="Upload"
              onClick={() => fileRef.current?.click()}
              size="sm"
              variant="secondary"
            >
              Upload
            </Button>
          </>
        ) : null}
        <Button
          ariaLabel="Done"
          onClick={() => store.deactivateObject(id)}
          size="sm"
          variant="primary"
        >
          Done
        </Button>
      </div>
    </div>
  );
}

export const mediaView: NodeView = {
  ariaLabel: "Image",
  ariaRole: "img",
  chromeMeta: { icon: "Image", label: "Image" },
  insert: {
    createData: () => ({ alt: "", caption: "", src: "" }),
    group: "Media",
    icon: "Image",
    keywords: ["img", "photo", "upload"],
    label: "Image",
  },
  renderLive: (args) => (
    <MediaLiveSurface
      node={args.node}
      registerObjectEditor={args.registerObjectEditor}
      store={args.store}
    />
  ),
  renderResting: ({ baked }) => {
    const payload = asRecord(baked.payload);
    const src = stringField(payload, "src");
    const caption = stringField(payload, "caption");
    // Render the real image (the same `RichTextMediaFigure` the reader uses, so
    // the editor's at-rest media matches the published page); fall back to a
    // labelled placeholder only when no source is set yet.
    return (
      <div data-engine-object-baked="media">
        {src ? (
          <RichTextMediaFigure
            alt={stringField(payload, "alt")}
            caption={caption}
            src={src}
          />
        ) : (
          <figure style={mediaBakedStyle}>
            <div style={mediaThumbStyle}>🖼 media</div>
          </figure>
        )}
      </div>
    );
  },
  type: "media",
};
