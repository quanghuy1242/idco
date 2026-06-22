/**
 * The built-in `embed` (iframe/video) node view (docs/016 §10, docs/020 §7.2).
 *
 * Editing uses the dispatcher's default config popover (`configFields`). The
 * resting render frames an embeddable URL with the shared `RichTextEmbed` so the
 * editor's at-rest embed matches the published page.
 */
import { RichTextEmbed } from "@quanghuy1242/idco-ui";
import { type NodeView } from "../spi";
import { asRecord, stringField } from "../object-data";
import { objectStatusStyle } from "../styles";

/**
 * Convert a media/embed URL into an iframe-embeddable form. YouTube watch/share
 * links cannot be framed directly, so they are rewritten to the `/embed/<id>`
 * player; any other `http(s)` URL is returned unchanged. Returns "" when nothing
 * is embeddable, so the caller falls back to a link placeholder.
 */
function toEmbeddableUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) return "";
  const youtube = url.match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/i,
  );
  return youtube ? `https://www.youtube.com/embed/${youtube[1]}` : url;
}

export const embedView: NodeView = {
  ariaLabel: "Embedded content",
  chromeMeta: { icon: "ExternalLink", label: "Embed" },
  configFields: [
    { key: "url", label: "URL" },
    { key: "title", label: "Title" },
  ],
  insert: {
    createData: () => ({ title: "", url: "" }),
    group: "Media",
    icon: "ExternalLink",
    keywords: ["video", "youtube", "embed", "iframe"],
    label: "Embed",
  },
  renderResting: ({ baked }) => {
    const payload = asRecord(baked.payload);
    const url = stringField(payload, "url");
    const embedUrl = toEmbeddableUrl(url);
    // Render the real embed (the same `RichTextEmbed` iframe the reader uses)
    // when the URL is embeddable; a freshly-inserted embed has no URL yet, so it
    // shows a labelled prompt until one is set from the gear.
    return (
      <div data-engine-object-baked="embed">
        {embedUrl ? (
          <RichTextEmbed title={stringField(payload, "title")} url={embedUrl} />
        ) : (
          <div style={objectStatusStyle}>
            🔗 {stringField(payload, "title") || url || "Add an embed URL ⚙"}
          </div>
        )}
      </div>
    );
  },
  type: "embed",
};
