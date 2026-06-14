// DaisyUI 5: https://daisyui.com/components/card/
/* eslint-disable no-underscore-dangle -- Lexical node subclasses use __ fields by convention. */

import { Text } from "@quanghuy1242/idco-ui";
import type { ElementFormatType, NodeKey } from "lexical";
import { useContext } from "react";
import { normalizeEmbedNode } from "../model/normalize";
import { stringValue, type RichTextEditorNode } from "../model/schema";
import {
  BlockShell,
  embedAllowed,
  FieldLabel,
  RichTextDecoratorBlockNode,
  RichTextEditorBindingsContext,
  useDecoratorNodeUpdater,
  type SerializedRichTextDecoratorNode,
} from "./base";

export class EmbedNode extends RichTextDecoratorBlockNode {
  static getType(): string {
    return "embed";
  }

  static clone(node: EmbedNode): EmbedNode {
    return new EmbedNode(node.__data, node.__format, node.__key);
  }

  static importJSON(serializedNode: SerializedRichTextDecoratorNode) {
    return new EmbedNode(
      normalizeEmbedNode(serializedNode),
      (serializedNode.format as ElementFormatType) || "",
    );
  }

  decorate() {
    return <EmbedEditor nodeKey={this.__key} node={this.getData()} />;
  }
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
