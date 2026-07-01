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
  // A static rule costs nothing to render, so skip the virtualization fling
  // placeholder (docs/025 §5.5, backlog §3) — otherwise it flashes a blank box and
  // mounts a beat behind a structural block (a callout) next to it, which never
  // placeholders. The placeholder is for objects whose decorator is expensive.
  lightweight: true,
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
