/**
 * The built-in `divider` node view — docs/016 §8's worked example: a brand-new
 * node rendered through the SPI with no edit to the dispatcher. Its framework-free
 * definition is the built-in in `core/registry.ts`; this is its React half.
 */
import { type NodeView } from "../spi";

export const dividerView: NodeView = {
  ariaLabel: "Divider",
  ariaRole: "separator",
  chromeMeta: { icon: "Minus", label: "Divider" },
  // A divider has no settings (docs/020 §5.4), so the gear is hidden.
  configurable: false,
  insert: {
    createData: () => ({}),
    group: "Blocks",
    icon: "Minus",
    keywords: ["hr", "rule", "---"],
    label: "Divider",
  },
  renderResting: () => (
    <hr
      data-engine-object-baked="divider"
      style={{
        border: 0,
        borderTop: "1px solid color-mix(in srgb, CanvasText 24%, transparent)",
        margin: "8px 0",
      }}
    />
  ),
  schemaGroup: "divider",
  type: "divider",
};
