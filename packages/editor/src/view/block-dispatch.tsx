/**
 * The per-block dispatcher (docs/020 §4.5). `EngineBlock` maps one node id to its
 * surface by `node.kind`: a text leaf → `EngineTextBlock`, an object → the
 * `EngineObjectBlock` SPI dispatcher, a structural container → the structural SPI
 * (`getStructuralView`) with a default stacking-container fallback. It carries no
 * node-type knowledge of its own; everything comes through props or the registry.
 * Lifted verbatim from `react-view.tsx`.
 */
import type { RefObject } from "react";
import type { EditorStore, NodeId, TextPoint } from "../core";
import { EngineObjectBlock } from "./object-block";
import { getStructuralView } from "./structural-view";
import { useEditorNode } from "./store-hooks";
import { EngineTextBlock } from "./text-block";
import {
  computeWindowListMeta,
  structuralContainerStyle,
  type ListItemMeta,
} from "./styles";

export function EngineBlock(props: {
  readonly id: NodeId;
  readonly store: EditorStore;
  readonly forcePolyfill: boolean;
  readonly registerBlock: (id: NodeId, element: HTMLElement | null) => void;
  readonly registerInputBackend: (
    id: NodeId,
    backend: "native" | "polyfill" | null,
  ) => void;
  readonly onRender: (id: NodeId) => void;
  readonly requestFocus: (id: NodeId) => boolean;
  readonly revealBlock: (id: NodeId) => void;
  readonly beginDrag: (anchor: TextPoint) => void;
  readonly registerObjectEditor: (id: NodeId, mounted: boolean) => void;
  readonly goalColumnRef: RefObject<number | null>;
  readonly pageCaret: (direction: -1 | 1, extend: boolean) => boolean;
  readonly focusRoot: () => void;
  readonly listMeta?: ListItemMeta;
}) {
  const {
    id,
    store,
    forcePolyfill,
    registerBlock,
    registerInputBackend,
    onRender,
    requestFocus,
    revealBlock,
    beginDrag,
    registerObjectEditor,
    goalColumnRef,
    pageCaret,
    focusRoot,
    listMeta,
  } = props;
  const node = useEditorNode(store, id);
  onRender(id);
  // The node was removed in the same tick (merge/delete); render nothing until
  // the order change unmounts this block.
  if (!node) return null;
  if (node.kind === "text") {
    const textBlock = (
      <EngineTextBlock
        beginDrag={beginDrag}
        focusRoot={focusRoot}
        forcePolyfill={forcePolyfill}
        goalColumnRef={goalColumnRef}
        listMeta={listMeta}
        node={node}
        pageCaret={pageCaret}
        registerBlock={registerBlock}
        registerInputBackend={registerInputBackend}
        requestFocus={requestFocus}
        revealBlock={revealBlock}
        store={store}
      />
    );
    return textBlock;
  }
  if (node.kind === "object") {
    return (
      <EngineObjectBlock
        node={node}
        registerBlock={registerBlock}
        registerObjectEditor={registerObjectEditor}
        store={store}
      />
    );
  }
  // A structural container renders its children recursively (docs/018 §2.11:
  // "Rendering is separable from virtualizing" — mapping a container's `children`
  // through the same block dispatch *is* the render, and block-level
  // virtualization already mounts/unmounts the whole small subtree as one
  // top-level block). Everything under a structural node renders: nested lists,
  // paragraphs, objects (media/code), the lot — the same `EngineBlock` dispatch
  // recurses. A `list` numbers its items with the same render-time ordinal pass
  // the flat top-level lists use (a CSS counter would misnumber a virtualized
  // run); other containers just stack their children.
  //
  // Large containers (a single subtree big enough that mounting it whole hurts)
  // are the *separate* recursive-windowing tier (docs/018 §2.11), built against
  // the measurement guardrail when a real consumer needs it — that is the only
  // deferred half, and it is a virtualization concern, not this render.
  // Any structural container numbers the list runs among its children — a `list`,
  // but also a callout holding list items — so a nested numbered list renders as
  // `N.`, not bullets. Containers with no list items get an empty map (paragraphs
  // are unaffected). Without this, nested items fell back to the bullet default.
  const childListMeta = computeWindowListMeta(store, node.children, 0);
  const children = node.children.map((childId) => (
    <EngineBlock
      beginDrag={beginDrag}
      focusRoot={focusRoot}
      forcePolyfill={forcePolyfill}
      goalColumnRef={goalColumnRef}
      id={childId}
      key={childId}
      listMeta={childListMeta?.get(childId)}
      onRender={onRender}
      pageCaret={pageCaret}
      registerBlock={registerBlock}
      registerInputBackend={registerInputBackend}
      registerObjectEditor={registerObjectEditor}
      requestFocus={requestFocus}
      revealBlock={revealBlock}
      store={store}
    />
  ));
  // The structural type's container render is registry-driven (docs/020 §4.2): a
  // registered `StructuralNodeView` (callout, list) owns its wrapper, styling, and
  // chrome; everything else (quote, structural list-item, body) falls back to the
  // default stacking container.
  const structuralView = getStructuralView(node.type);
  if (structuralView) {
    return structuralView.renderContainer({
      children,
      node,
      registerBlock,
      store,
    });
  }
  return (
    <div
      data-engine-block-id={node.id}
      data-engine-structural={node.type}
      ref={(element) => registerBlock(node.id, element)}
      style={structuralContainerStyle}
    >
      {children}
    </div>
  );
}
