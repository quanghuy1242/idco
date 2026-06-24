/**
 * The built-in `embed` (iframe/video) node view (docs/016 §10, docs/020 §7.2).
 *
 * embed is the degenerate **resolve-only reference block** (docs/026 §4.4, §8.2):
 * there is no collection to browse, so the author pastes a URL as a free-text `ref`
 * and the embed source's `resolve` validates it against `allowedEmbedDomains`. An
 * off-allowlist or refused URL marks the node `invalid` (§7.3/§12), and this render
 * suppresses the iframe for an invalid node rather than framing an untrusted origin.
 * The title is an author-local field. Editing flows through the default config
 * popover; the resting render frames the URL with the shared `RichTextEmbed`.
 */
import { RichTextEmbed } from "@quanghuy1242/idco-reader";
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
    // The URL is the ref: a resolve-only source has no browse, so the resource
    // field renders a free-text input and the source validates the pasted URL.
    {
      kind: "resource",
      key: "ref",
      label: "URL",
      source: "embed",
      toData: () => ({}),
    },
    { key: "title", label: "Title" },
  ],
  insert: {
    createData: () => ({ local: {}, ref: "", snapshot: {} }),
    group: "Media",
    icon: "ExternalLink",
    keywords: ["video", "youtube", "embed", "iframe"],
    label: "Embed",
  },
  renderResting: ({ node, baked }) => {
    const payload = asRecord(baked.payload);
    const url = stringField(payload, "url");
    const title = stringField(payload, "title");
    const embedUrl = toEmbeddableUrl(url);
    // An `invalid` embed (off-allowlist or refused by resolve) never frames the
    // origin — it shows the placeholder, and the resting-state chrome (docs/026
    // §7.3) adds the "couldn't refresh" affordance.
    const blocked = node.status === "invalid";
    return (
      <div data-engine-object-baked="embed">
        {embedUrl && !blocked ? (
          <RichTextEmbed title={title} url={embedUrl} />
        ) : (
          <div style={objectStatusStyle}>
            🔗{" "}
            {blocked
              ? "Embed not allowed"
              : title || url || "Add an embed URL ⚙"}
          </div>
        )}
      </div>
    );
  },
  schemaGroup: "embed",
  type: "embed",
};
