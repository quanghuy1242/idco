/**
 * The built-in `list` structural node view (docs/020 §7.1).
 *
 * A structural `list` numbers its items with the same render-time ordinal pass the
 * flat top-level lists use (a CSS counter would misnumber a virtualized run). Live
 * render stacks its already-numbered children in a `structuralListStyle` box;
 * resting render emits a real `<ul>`/`<ol>` whose `<li>` children the resting
 * engine builds via `renderListItems`. Co-located so the two cannot drift.
 */
import { type StructuralNodeView } from "../structural-view";
import { structuralListStyle } from "../styles";

export const listStructuralView: StructuralNodeView = {
  renderContainer: ({ node, registerBlock, children }) => (
    <div
      data-engine-block-id={node.id}
      data-engine-structural="list"
      ref={(element) => registerBlock(node.id, element)}
      style={structuralListStyle}
    >
      {children}
    </div>
  ),
  renderResting: ({ node, children, renderListItems }) => {
    const items = renderListItems(children);
    return node.attrs?.listType === "number" ? (
      <ol
        data-engine-resting-block={node.id}
        data-engine-resting-list="number"
        key={node.id}
      >
        {items}
      </ol>
    ) : (
      <ul
        data-engine-resting-block={node.id}
        data-engine-resting-list="bullet"
        key={node.id}
      >
        {items}
      </ul>
    );
  },
  type: "list",
};
