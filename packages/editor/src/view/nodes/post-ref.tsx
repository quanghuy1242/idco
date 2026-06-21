/**
 * The built-in `post-ref` (linked post) node view (docs/016 §10, docs/020 §7.2).
 *
 * Editing uses the dispatcher's default config popover (`configFields`). The
 * resting render is the shared `RichTextPostReference` card the reader uses.
 */
import { RichTextPostReference } from "@quanghuy1242/idco-ui";
import { type NodeView } from "../node-view";
import { asRecord, stringField } from "../object-data";

export const postRefView: NodeView = {
  ariaLabel: "Linked post",
  chromeMeta: { icon: "FileText", label: "Linked post" },
  configFields: [
    { key: "postId", label: "Post id" },
    { key: "title", label: "Title" },
    { key: "url", label: "URL" },
  ],
  insert: {
    createData: () => ({ postId: "", title: "", url: "" }),
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
  type: "post-ref",
};
