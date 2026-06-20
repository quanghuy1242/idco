/**
 * The floating chrome for a callout text leaf (docs/018 §2.8): the "Callout"
 * badge, a tone gear, and a delete button — the same standardized `BlockChrome`
 * the object blocks and legacy nodes use. It renders as a sibling *overlay* of
 * the `role=textbox` block (in the block wrapper, not inside the textbox) so it
 * never nests an interactive control inside a textbox (an ARIA violation), and a
 * `display:contents` host stops a chrome press from reaching the block's
 * pointer-down (which would re-place the caret).
 */
import {
  BlockChrome,
  ChromeSelect,
  type ChromeSelectOption,
} from "@quanghuy1242/idco-ui";
import type { EditorStore, NodeId, TextLeafNode } from "../core";

/** Callout tones, matching the `Alert` component (info / success / warning / error). */
const CALLOUT_TONES: readonly ChromeSelectOption<string>[] = [
  { icon: "Info", iconClassName: "text-info", label: "Info", value: "info" },
  {
    icon: "Check",
    iconClassName: "text-success",
    label: "Success",
    value: "success",
  },
  {
    icon: "TriangleAlert",
    iconClassName: "text-warning",
    label: "Warning",
    value: "warning",
  },
  {
    icon: "CircleAlert",
    iconClassName: "text-error",
    label: "Error",
    value: "error",
  },
];

const contentsStyle = { display: "contents" } as const;

export function CalloutChrome(props: {
  readonly node: TextLeafNode;
  readonly store: EditorStore;
}) {
  const { node, store } = props;
  const id: NodeId = node.id;
  const tone = typeof node.attrs?.tone === "string" ? node.attrs.tone : "info";
  return (
    <div onMouseDown={(event) => event.stopPropagation()} style={contentsStyle}>
      <BlockChrome
        actions={
          <ChromeSelect
            label="Callout tone"
            menuClassName="w-40"
            onChange={(value) =>
              store.command({
                key: "tone",
                node: id,
                type: "set-block-attr",
                value,
              })
            }
            options={CALLOUT_TONES}
            triggerIcon="Settings"
            value={tone}
          />
        }
        icon="Info"
        label="Callout"
        onRemove={() => store.command({ node: id, type: "remove-block" })}
      />
    </div>
  );
}
