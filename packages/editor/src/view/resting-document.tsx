/**
 * Resting (read/preview) render of an owned-model document (docs/010 §5.9).
 *
 * This is the non-editing projection of the model: text leaves render as their
 * semantic elements with marks, objects render their baked snapshot through the
 * registered `NodeView.renderResting` — the exact same render the editor mounts at
 * rest and the same one the reader (docs/015) will mount, so the editor and reader
 * cannot drift. It carries the DaisyUI `prose` class, so document theming
 * (headings, lists, quotes, links, code) is the typography framework's job, not
 * inline styles (docs/010 §7.1).
 *
 * `packages/reader` does not exist yet (docs/010 §6.2 / docs/015); when it lands,
 * the object resting render moves onto its L1 primitives. Until then this is the
 * shared resting primitive the editor uses.
 */
import { Fragment, type ReactNode } from "react";
import { type AlertTone } from "@quanghuy1242/idco-ui";
import {
  bakeObjectData,
  createDefaultBlockRegistry,
  type BlockRegistry,
  type EditorDocumentSnapshot,
  type EditorNode,
  type NodeId,
  type ObjectNode,
  type TextLeafNode,
} from "../core";
import { getNodeView } from "./node-view";
import { getStructuralView } from "./structural-view";
import { renderLeafMarks } from "./mark-render";
import { ENGINE_RESTING_TYPOGRAPHY_CSS, indentMarginStyle } from "./styles";

/**
 * The single resting render of a heavy object's baked content — the source of
 * truth the editor's at-rest view (`BakedObjectView`) AND the reader's
 * `RestingDocument` both call, so the two cannot drift (docs/010 §6.2; docs/018
 * §2.5). Duplicating this dispatch is exactly how they drifted: imported objects
 * carry no baked snapshot (compat does not bake, to keep the round-trip
 * deep-equal, docs/010 §14), so a renderer that honored only `node.baked` printed
 * the bare type name ("embed"/"media"/"divider") while the editor baked on the
 * fly.
 *
 * Bakes on the fly when `node.baked` is absent — for display only, never written
 * back to the model (the projection stays clean) — then dispatches to the
 * registered `NodeView.renderResting`, falling back to a status/placeholder when
 * there is no bake or no registered view.
 */
export function renderRestingObject(
  node: ObjectNode,
  registry: BlockRegistry,
): ReactNode {
  const baked =
    node.baked ?? bakeObjectData(registry, node.type, node.data).baked;
  if (!baked) {
    return node.status === "invalid"
      ? `⚠ ${node.type}: cannot bake (check its data)`
      : `${node.type}: not baked yet`;
  }
  const view = getNodeView(node.type);
  if (view) return view.renderResting({ baked, node });
  return `${node.type} (baked: ${baked.kind})`;
}

// The built-in registry the reader's RestingDocument bakes through by default
// (a snapshot carries no registry). A host with custom node types passes its own.
const DEFAULT_RESTING_REGISTRY = createDefaultBlockRegistry();

function headingTag(
  node: TextLeafNode,
): "h1" | "h2" | "h3" | "h4" | "h5" | "h6" {
  const tag = node.attrs?.tag;
  if (typeof tag === "string" && /^h[1-6]$/.test(tag)) {
    return tag as "h1";
  }
  return "h2";
}

/** The valid callout tones (matching the `Alert` component); default `info`. */
const CALLOUT_TONES = new Set<AlertTone>([
  "info",
  "success",
  "warning",
  "error",
]);

/** Coerce a stored tone to a valid `AlertTone`, defaulting to `info`. */
export function calloutTone(value: unknown): AlertTone {
  return typeof value === "string" && CALLOUT_TONES.has(value as AlertTone)
    ? (value as AlertTone)
    : "info";
}

/** Render one text leaf as its semantic element with its marks. */
export function RestingLeaf(props: { readonly node: TextLeafNode }) {
  const { node } = props;
  // The reader navigates links; only the editor keeps them inert.
  const children = renderLeafMarks(node, "navigable");
  // The block indent rides on `attrs.indent` (set by indent/outdent) as a left
  // margin, the same step the editing surface uses, so a persisted indent shows
  // identically at rest and in the reader (docs/018 §2.8).
  const style = indentMarginStyle(node.attrs?.indent);
  switch (node.type) {
    case "heading": {
      const Tag = headingTag(node);
      return (
        <Tag data-engine-resting-block={node.id} style={style}>
          {children}
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote data-engine-resting-block={node.id} style={style}>
          {children}
        </blockquote>
      );
    case "listitem":
      return (
        <li data-engine-resting-block={node.id} style={style}>
          {children}
        </li>
      );
    default:
      return (
        <p data-engine-resting-block={node.id} style={style}>
          {children}
        </p>
      );
  }
}

function renderBlock(
  node: EditorNode,
  snapshot: EditorDocumentSnapshot,
  registry: BlockRegistry,
): ReactNode {
  if (node.kind === "text") return <RestingLeaf key={node.id} node={node} />;
  if (node.kind === "object") {
    return (
      <div data-engine-resting-block={node.id} key={node.id}>
        {renderRestingObject(node, registry)}
      </div>
    );
  }
  // A structural container renders its children recursively, so nothing under a
  // structural node is hidden (docs/018 §2.11): a `list` becomes a real
  // <ul>/<ol>, and a generic container (a quote/callout holding block children)
  // stacks them. This mirrors the editor's recursive structural render so the two
  // surfaces never disagree.
  return renderRestingStructural(node, snapshot, registry);
}

/**
 * Render a structural container and everything beneath it (docs/018 §2.11),
 * dispatched through the structural SPI (docs/020 §4.2): a registered
 * `StructuralNodeView` (callout, list) owns its resting element; everything else
 * (quote, structural list-item, body) falls back to the default stacking
 * container. The recursion engine (`renderBlockSequence` / `renderRestingListItem`)
 * stays here and is injected so a view composes children without importing it.
 */
function renderRestingStructural(
  node: Extract<EditorNode, { kind: "structural" }>,
  snapshot: EditorDocumentSnapshot,
  registry: BlockRegistry,
): ReactNode {
  const children = node.children
    .map((id) => snapshot.body.blocks[id as NodeId])
    .filter((child): child is EditorNode => Boolean(child));
  const view = getStructuralView(node.type);
  if (view) {
    return view.renderResting({
      children,
      node,
      renderListItems: (nodes) =>
        nodes.map((child) => renderRestingListItem(child, snapshot, registry)),
      renderSequence: (nodes) => renderBlockSequence(nodes, snapshot, registry),
    });
  }
  return (
    <div data-engine-resting-block={node.id} key={node.id}>
      {renderBlockSequence(children, snapshot, registry)}
    </div>
  );
}

/** Render one item of a structural list: a real `<li>` plus any nested lists. */
function renderRestingListItem(
  node: EditorNode,
  snapshot: EditorDocumentSnapshot,
  registry: BlockRegistry,
): ReactNode {
  if (node.kind === "text" && node.type === "listitem") {
    return (
      <li
        data-engine-resting-block={node.id}
        key={node.id}
        style={indentMarginStyle(node.attrs?.indent)}
      >
        {renderLeafMarks(node, "navigable")}
      </li>
    );
  }
  // A structural list item holds its own text leaf plus nested list(s); render the
  // text inline and the nested lists after it, all inside one `<li>`.
  if (node.kind === "structural" && node.type === "listitem") {
    return (
      <li data-engine-resting-block={node.id} key={node.id}>
        {node.children
          .map((id) => snapshot.body.blocks[id as NodeId])
          .filter((child): child is EditorNode => Boolean(child))
          .map((child) =>
            child.kind === "text" && child.type === "listitem" ? (
              <Fragment key={child.id}>
                {renderLeafMarks(child, "navigable")}
              </Fragment>
            ) : (
              renderBlock(child, snapshot, registry)
            ),
          )}
      </li>
    );
  }
  return renderBlock(node, snapshot, registry);
}

export type RestingDocumentProps = {
  readonly snapshot: EditorDocumentSnapshot;
  readonly className?: string;
  /** Registry used to bake unbaked objects for display; defaults to built-ins. */
  readonly registry?: BlockRegistry;
};

/** The flat-list flavour of a node, or null when it is not a list item. */
function restingListFlavour(node: EditorNode): "bullet" | "number" | null {
  if (node.kind !== "text" || node.type !== "listitem") return null;
  return node.attrs?.listType === "number" ? "number" : "bullet";
}

/**
 * Render a sequence of sibling blocks, wrapping each run of consecutive
 * same-flavour `listitem` leaves in one real `<ul>`/`<ol>` (docs/018 §2.10) so an
 * ordered list numbers with the browser's counter. Shared by the body and by any
 * structural container (a callout, a quote-with-blocks) so a nested list numbers
 * identically — a bare `<li>` outside a list would lose its bullet/number.
 */
function renderBlockSequence(
  nodes: readonly EditorNode[],
  snapshot: EditorDocumentSnapshot,
  registry: BlockRegistry,
): ReactNode[] {
  const blocks: ReactNode[] = [];
  let listBuffer: ReactNode[] = [];
  let listFlavour: "bullet" | "number" = "bullet";
  const flushList = (key: string) => {
    if (listBuffer.length === 0) return;
    const items = listBuffer;
    blocks.push(
      listFlavour === "number" ? (
        <ol data-engine-resting-list="number" key={`ol-${key}`}>
          {items}
        </ol>
      ) : (
        <ul data-engine-resting-list="bullet" key={`ul-${key}`}>
          {items}
        </ul>
      ),
    );
    listBuffer = [];
  };
  for (const node of nodes) {
    const flavour = restingListFlavour(node);
    if (flavour && node.kind === "text") {
      // A flavour switch (bullet→number) ends the current list and opens a new one.
      if (listBuffer.length > 0 && flavour !== listFlavour) flushList(node.id);
      listFlavour = flavour;
      listBuffer.push(<RestingLeaf key={node.id} node={node} />);
      continue;
    }
    flushList(node.id);
    blocks.push(renderBlock(node, snapshot, registry));
  }
  flushList("end");
  return blocks;
}

/**
 * Render a document snapshot as themed resting HTML. Lists are flat-by-design
 * (docs/018 §2.10): a run of consecutive `listitem` leaves of the same flavour is
 * wrapped in one real `<ul>` (bullet) or `<ol>` (number), so the published page
 * numbers an ordered list with the browser's own counter and matches the editor
 * surface. A flavour change between adjacent items starts a new list; everything
 * else renders block by block.
 */
export function RestingDocument(props: RestingDocumentProps) {
  const {
    snapshot,
    className = "prose max-w-none",
    registry = DEFAULT_RESTING_REGISTRY,
  } = props;
  const bodyNodes = snapshot.body.order
    .map((id) => snapshot.body.blocks[id as NodeId])
    .filter((node): node is EditorNode => Boolean(node));
  return (
    <div className={className} data-engine-resting-document="">
      {/* Zero-specificity baseline so the published render is never unstyled when
          the host lacks a typography plugin; a real `prose` still overrides it. */}
      <style>{ENGINE_RESTING_TYPOGRAPHY_CSS}</style>
      {renderBlockSequence(bodyNodes, snapshot, registry)}
    </div>
  );
}
