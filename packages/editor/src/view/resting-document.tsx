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
import type { ReactNode } from "react";
import {
  AlertGlyph,
  alertToneClass,
  type AlertTone,
} from "@quanghuy1242/idco-ui";
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
    case "callout": {
      // Render the real DaisyUI alert (the legacy callout look) so the published
      // page matches the editor surface and the theme (docs/018 §2.8).
      const tone = calloutTone(node.attrs?.tone);
      return (
        <aside
          className={`alert ${alertToneClass[tone]} items-start`}
          data-engine-callout-tone={tone}
          data-engine-resting-block={node.id}
          role="note"
          style={style}
        >
          <AlertGlyph tone={tone} />
          <span className="w-full">{children}</span>
        </aside>
      );
    }
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

function renderBlock(node: EditorNode, registry: BlockRegistry): ReactNode {
  if (node.kind === "text") return <RestingLeaf key={node.id} node={node} />;
  if (node.kind === "object") {
    return (
      <div data-engine-resting-block={node.id} key={node.id}>
        {renderRestingObject(node, registry)}
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
  /** Registry used to bake unbaked objects for display; defaults to built-ins. */
  readonly registry?: BlockRegistry;
};

/**
 * Render a document snapshot as themed resting HTML. Consecutive `listitem`
 * leaves are wrapped in a single `<ul>` so the typography list styling applies;
 * everything else renders block by block.
 */
export function RestingDocument(props: RestingDocumentProps) {
  const {
    snapshot,
    className = "prose max-w-none",
    registry = DEFAULT_RESTING_REGISTRY,
  } = props;
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
    blocks.push(renderBlock(node, registry));
  }
  flushList("end");
  return (
    <div className={className} data-engine-resting-document="">
      {/* Zero-specificity baseline so the published render is never unstyled when
          the host lacks a typography plugin; a real `prose` still overrides it. */}
      <style>{ENGINE_RESTING_TYPOGRAPHY_CSS}</style>
      {blocks}
    </div>
  );
}
