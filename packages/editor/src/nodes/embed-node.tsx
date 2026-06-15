// DaisyUI 5: https://daisyui.com/components/card/

import { Input, Text } from "@quanghuy1242/idco-ui";
import { useContext } from "react";
import { normalizeEmbedNode } from "../model/normalize";
import { stringValue } from "../model/schema";
import {
  BlockShell,
  embedAllowed,
  FieldLabel,
  RichTextEditorBindingsContext,
} from "./base";
import {
  defineDecoratorBlock,
  type DecoratorBlockProps,
} from "./decorator-block";

export const EmbedNode = defineDecoratorBlock({
  Editor: EmbedEditor,
  normalize: normalizeEmbedNode,
  type: "embed",
});

function EmbedEditor({ node, nodeKey, update }: DecoratorBlockProps) {
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
        <Input
          ariaLabel="Embed URL"
          invalid={!allowed}
          value={url}
          onChange={(value) => update({ url: value })}
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
