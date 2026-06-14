// DaisyUI 5: https://daisyui.com/components/card/
/* eslint-disable no-underscore-dangle -- Lexical node subclasses use __ fields by convention. */

import { NavIcon, ResourceSelector, Text } from "@quanghuy1242/idco-ui";
import type { ElementFormatType, NodeKey } from "lexical";
import { useContext } from "react";
import { normalizePostRefNode } from "../model/normalize";
import { stringValue, type RichTextEditorNode } from "../model/schema";
import {
  BlockShell,
  RichTextDecoratorBlockNode,
  RichTextEditorBindingsContext,
  useDecoratorNodeUpdater,
  type SerializedRichTextDecoratorNode,
} from "./base";

export class PostRefNode extends RichTextDecoratorBlockNode {
  static getType(): string {
    return "post-ref";
  }

  static clone(node: PostRefNode): PostRefNode {
    return new PostRefNode(node.__data, node.__format, node.__key);
  }

  static importJSON(serializedNode: SerializedRichTextDecoratorNode) {
    return new PostRefNode(
      normalizePostRefNode(serializedNode),
      (serializedNode.format as ElementFormatType) || "",
    );
  }

  decorate() {
    return <PostRefEditor nodeKey={this.__key} node={this.getData()} />;
  }
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
