/**
 * Resting (read/preview) render of an owned-model document (docs/010 §5.9, docs/028 §4.4).
 *
 * `RestingDocument` is now a thin wrapper over the published reader: it bakes the snapshot's
 * objects for display and renders it through `@quanghuy1242/idco-reader`'s `<Reader>` — the
 * SAME snapshot-native dispatch the published page uses. So the editor's in-app preview and
 * the published reader render block-for-block identically and cannot drift (the convergence
 * docs/028 calls for); the only differences are deliberate (`forceInlineToc`: the preview
 * has no side rail). The old per-node recursion that lived here is gone — its single source
 * is the reader dispatch.
 *
 * `renderRestingObject` stays: it is the editor's *live-surface* at-rest object render
 * (`BakedObjectView`, object-block.tsx), which keeps the richer client widgets (the live
 * `CodeEditor` read-only) while not focused — that is the editing surface, not the published
 * projection, so it legitimately differs from the reader's static render. `RestingLeaf` and
 * `calloutTone` are kept for their existing importers.
 */
import { type ReactNode } from "react";
import { type AlertTone } from "@quanghuy1242/idco-ui";
import {
  Reader,
  type ReaderObjectNode,
  type ReaderObjectRenderer,
} from "@quanghuy1242/idco-reader";
import {
  bakeObjectData,
  createDefaultBlockRegistry,
  headingAnchor,
  type BlockRegistry,
  type EditorDocumentSnapshot,
  type EditorNode,
  type ObjectNode,
  type TextLeafNode,
} from "../../core";
import { getNodeView, listNodeViews } from "../spi";
import { renderLeafMarks } from "./mark-render";
import { indentMarginStyle } from "../styles";

/**
 * The single resting render of a heavy object's baked content — the editor's at-rest
 * *live-surface* render (`BakedObjectView`). Bakes on the fly when `node.baked` is absent
 * (imported objects carry no baked snapshot, docs/010 §14) — for display only, never written
 * back — then dispatches to the registered `NodeView.renderResting`. This is the live
 * editing surface's at-rest render; the published projection is the reader dispatch.
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

// The built-in registry the editor bakes through by default (a snapshot carries no
// registry). A host with custom node types passes its own.
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

/**
 * Render one text leaf as its semantic element with its marks. Kept exported for importers;
 * `RestingDocument` itself now renders through the reader dispatch (docs/028 §4.4).
 */
export function RestingLeaf(props: { readonly node: TextLeafNode }) {
  const { node } = props;
  // The reader navigates links; only the editor keeps them inert.
  const children = renderLeafMarks(node, "navigable");
  const style = indentMarginStyle(node.attrs?.indent);
  switch (node.type) {
    case "heading": {
      const Tag = headingTag(node);
      return (
        <Tag
          data-engine-resting-block={node.id}
          id={headingAnchor(node.id, node.attrs)}
          style={style}
        >
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

export type RestingDocumentProps = {
  readonly snapshot: EditorDocumentSnapshot;
  readonly className?: string;
  /** Registry used to bake unbaked objects for display; defaults to built-ins. */
  readonly registry?: BlockRegistry;
};

/**
 * Bake every object in the snapshot for display (the reader reads `node.baked.payload`).
 * Pure and for display only — the projection stays clean; imported objects that carry no
 * bake (docs/010 §14) get one here on the fly, exactly as `renderRestingObject` does.
 */
function bakeForReader(
  snapshot: EditorDocumentSnapshot,
  registry: BlockRegistry,
): EditorDocumentSnapshot {
  const blocks: Record<string, EditorNode> = {};
  for (const [id, node] of Object.entries(snapshot.body.blocks)) {
    blocks[id] =
      node.kind === "object" && !node.baked
        ? ({
            ...node,
            baked:
              bakeObjectData(registry, node.type, node.data).baked ?? undefined,
          } as EditorNode)
        : node;
  }
  return { ...snapshot, body: { ...snapshot.body, blocks } };
}

/**
 * A per-type resting renderer for every registered node, from the editor's node-view
 * registry, handed to the reader as `objectRenderers` (docs/028 §4.4). Only *custom* types
 * reach these — the reader renders its built-ins through L1 itself (the single source) and
 * shadows the built-in entries here — so a host node registered via `registerNode` renders
 * in the preview through the same dispatch the published reader uses, with no edit here.
 */
function editorObjectRenderers(): Readonly<
  Record<string, ReaderObjectRenderer>
> {
  const out: Record<string, ReaderObjectRenderer> = {};
  for (const view of listNodeViews()) {
    out[view.type] = (node: ReaderObjectNode) => {
      const objectNode = node as unknown as ObjectNode;
      return objectNode.baked
        ? view.renderResting({ baked: objectNode.baked, node: objectNode })
        : null;
    };
  }
  return out;
}

/**
 * Render a document snapshot as themed resting HTML by delegating to the published reader
 * (docs/028 §4.4) — one dispatch, so the editor preview and the published page cannot drift.
 * The outer `prose`/`data-engine-resting-document` wrapper is kept for importers; the `.rt-*`
 * appearance the reader injects governs (the prose layer is a zero-specificity fallback).
 */
export function RestingDocument(props: RestingDocumentProps) {
  const {
    snapshot,
    className = "prose max-w-none",
    registry = DEFAULT_RESTING_REGISTRY,
  } = props;
  return (
    <div className={className} data-engine-resting-document="">
      <Reader
        forceInlineToc
        objectRenderers={editorObjectRenderers()}
        value={bakeForReader(snapshot, registry)}
      />
    </div>
  );
}
