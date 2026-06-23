/**
 * The built-in `media` (image) node view (docs/016 §9, docs/020 §7.2).
 *
 * `media` is a **reference block** (docs/026 §4.1, §8.2): the image is a host
 * asset, so editing means picking one, not typing a URL. Its `configFields` are a
 * `resource` field bound to the `media` source (browse/pick + upload, projecting
 * `{ src, alt }` into the snapshot) plus a `caption` text field that is
 * author-local — a `resolve` refreshes `src`/`alt` from the asset but never the
 * caption (§7.2). Editing flows through the default config popover
 * (`ObjectConfigPanel`), so there is no bespoke live surface; the resting render is
 * unchanged — the shared `RichTextMediaFigure` the reader uses, painted from the
 * baked snapshot.
 */
import { RichTextMediaFigure } from "@quanghuy1242/idco-ui";
import { type NodeView } from "../spi";
import { asRecord, stringField } from "../object-data";
import { mediaBakedStyle, mediaThumbStyle } from "../styles";

export const mediaView: NodeView = {
  ariaLabel: "Image",
  ariaRole: "img",
  chromeMeta: { icon: "Image", label: "Image" },
  configFields: [
    {
      kind: "resource",
      key: "ref",
      label: "Image",
      source: "media",
      // The asset projects its URL + alt text into the snapshot; the media source
      // returns each asset as a `ResourceOption` (`image` = URL, `label` = alt).
      toData: (option) => ({ alt: option.label, src: option.image ?? "" }),
    },
    { key: "caption", label: "Caption" },
  ],
  // Object-scope command contribution (docs/024 §5.3/§7.4): right-clicking an image
  // resolves the object scope and shows its `object`-group commands in the one context
  // menu — where today an object falls back to the native menu. Image *settings* (the
  // picker, caption) stay the config form (the gear); this is a *command*. The object
  // id is the active/selected object from the resolved scope.
  contributeCommands: (ctx) => {
    const id =
      ctx.scope.activeObject ??
      (ctx.scope.innermostKind === "object" ? ctx.scope.innermost : null);
    if (!id) return [];
    return [
      {
        group: "object",
        icon: "Trash2",
        id: "media.remove",
        kind: "button",
        label: "Remove image",
        run: (c) => c.store.command({ node: id, type: "remove-block" }),
        surfaces: { contextMenu: "primary" },
      },
    ];
  },
  insert: {
    // Born unresolved with an empty snapshot/local until an asset is picked or
    // uploaded (docs/026 §7.5).
    createData: () => ({ local: {}, ref: "", snapshot: {} }),
    group: "Media",
    icon: "Image",
    keywords: ["img", "photo", "upload"],
    label: "Image",
  },
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
