/**
 * Resting (read/preview) render of an owned-model document (docs/010 §5.9).
 *
 * This is the non-editing projection of the model: text leaves render as their
 * semantic elements with marks, objects render their baked snapshot through the
 * registered `NodeView.renderResting` — the exact same render the editor mounts at
 * rest and the same one the reader (docs/015) will mount, so the editor and reader
 * cannot drift. It carries the DaisyUI `prose` class, so document theming
 * (headings, lists, quotes, links, code) is the typography framework's job, not
 * inline styles (note.md §1, docs/010 §7.1).
 *
 * `packages/reader` does not exist yet (docs/010 §6.2 / docs/015); when it lands,
 * the object resting render moves onto its L1 primitives. Until then this is the
 * shared resting primitive the editor uses.
 */
import type { ReactNode } from "react";
import type {
  EditorDocumentSnapshot,
  EditorNode,
  NodeId,
  TextLeafNode,
} from "../core";
import { getNodeView } from "./node-view";
import { renderLeafMarks } from "./mark-render";

function headingTag(
  node: TextLeafNode,
): "h1" | "h2" | "h3" | "h4" | "h5" | "h6" {
  const tag = node.attrs?.tag;
  if (typeof tag === "string" && /^h[1-6]$/.test(tag)) {
    return tag as "h1";
  }
  return "h2";
}

/** Render one text leaf as its semantic element with its marks. */
export function RestingLeaf(props: { readonly node: TextLeafNode }) {
  const { node } = props;
  // The reader navigates links; only the editor keeps them inert.
  const children = renderLeafMarks(node, "navigable");
  switch (node.type) {
    case "heading": {
      const Tag = headingTag(node);
      return <Tag data-engine-resting-block={node.id}>{children}</Tag>;
    }
    case "quote":
      return (
        <blockquote data-engine-resting-block={node.id}>{children}</blockquote>
      );
    case "callout":
      return (
        <aside data-engine-resting-block={node.id} role="note">
          {children}
        </aside>
      );
    case "listitem":
      return <li data-engine-resting-block={node.id}>{children}</li>;
    default:
      return <p data-engine-resting-block={node.id}>{children}</p>;
  }
}

function renderBlock(node: EditorNode): ReactNode {
  if (node.kind === "text") return <RestingLeaf key={node.id} node={node} />;
  if (node.kind === "object") {
    const baked = node.baked;
    const view = baked ? getNodeView(node.type) : undefined;
    if (view && baked) {
      return (
        <div data-engine-resting-block={node.id} key={node.id}>
          {view.renderResting({ baked, node })}
        </div>
      );
    }
    return (
      <div data-engine-resting-block={node.id} key={node.id}>
        {node.type}
        {node.status === "invalid" ? " (cannot render)" : ""}
      </div>
    );
  }
  // Structural containers (list) are rendered by grouping below; a bare one here
  // is a defensive fallback.
  return null;
}

export type RestingDocumentProps = {
  readonly snapshot: EditorDocumentSnapshot;
  readonly className?: string;
};

/**
 * Render a document snapshot as themed resting HTML. Consecutive `listitem`
 * leaves are wrapped in a single `<ul>` so the typography list styling applies;
 * everything else renders block by block.
 */
export function RestingDocument(props: RestingDocumentProps) {
  const { snapshot, className = "prose max-w-none" } = props;
  const blocks: ReactNode[] = [];
  let listBuffer: ReactNode[] = [];
  const flushList = (key: string) => {
    if (listBuffer.length === 0) return;
    blocks.push(
      <ul data-engine-resting-list="" key={`ul-${key}`}>
        {listBuffer}
      </ul>,
    );
    listBuffer = [];
  };
  for (const id of snapshot.body.order) {
    const node = snapshot.body.blocks[id as NodeId];
    if (!node) continue;
    if (node.kind === "text" && node.type === "listitem") {
      listBuffer.push(<RestingLeaf key={node.id} node={node} />);
      continue;
    }
    flushList(id);
    blocks.push(renderBlock(node));
  }
  flushList("end");
  return (
    <div className={className} data-engine-resting-document="">
      {blocks}
    </div>
  );
}
