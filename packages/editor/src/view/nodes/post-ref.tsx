/**
 * The built-in `post-ref` (linked post) node view (docs/016 §10, docs/020 §7.2).
 *
 * `post-ref` is the canonical **reference block** (docs/026 §4.1): its content is
 * not author-typed but a projection of a host `posts` record. Editing means
 * picking a different post, so its single `configFields` entry is a `resource`
 * field bound to the `posts` source; `toData` projects the chosen option into the
 * `{ title, url, postId }` snapshot the resting card renders. The three free-text
 * fields it carried before (docs/026 §3.2) are gone — this is the rebuild that
 * proves the data-provider SPI by construction (docs/026 §8.2). The resting render
 * is unchanged: it still paints the shared `RichTextPostReference` card from the
 * baked snapshot, which the reader uses too.
 */
import { RichTextPostReference } from "@quanghuy1242/idco-ui";
import { type NodeView } from "../spi";
import { asRecord, stringField } from "../object-data";

export const postRefView: NodeView = {
  ariaLabel: "Linked post",
  chromeMeta: { icon: "FileText", label: "Linked post" },
  configFields: [
    {
      kind: "resource",
      key: "ref",
      label: "Post",
      source: "posts",
      toData: (option) => ({
        postId: option.id,
        title: option.label,
        url: option.sublabel ?? "",
      }),
    },
  ],
  insert: {
    // Born with no ref and an empty snapshot — an `unresolved` reference until a
    // post is picked (docs/026 §7.5). Phase 1 is placeholder-first; choose-first
    // insertion is Phase 5.
    createData: () => ({ ref: "", snapshot: {} }),
    group: "Blocks",
    icon: "FileText",
    keywords: ["post", "reference", "link", "related"],
    label: "Linked post",
  },
  renderResting: ({ baked }) => {
    const payload = asRecord(baked.payload);
    const title = stringField(payload, "title");
    const postId = stringField(payload, "postId");
    const url = stringField(payload, "url");
    // Render the real post-reference card (the same `RichTextPostReference` the
    // reader uses); a card with no target yet still reads as a linked-post block.
    return (
      <div data-engine-object-baked="post-ref">
        <RichTextPostReference
          href={url || undefined}
          label={title || postId || "Linked post ⚙"}
          postId={postId || undefined}
        />
      </div>
    );
  },
  schemaGroup: "post",
  type: "post-ref",
};
