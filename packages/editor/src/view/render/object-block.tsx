/**
 * The object-block dispatcher, driven entirely by the node SPI (docs/016 §10,
 * docs/020 §7.2). This file holds *no* per-type knowledge: `EngineObjectBlock`
 * looks up the active node's `NodeView` by `type` and renders its resting/live
 * surfaces and chrome from the contract. The built-in node views live one-per-file
 * under `view/nodes/`; a custom node registers its own and renders here with no
 * edit to this dispatcher.
 */
import {
  useCallback,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import {
  AnchoredPopover,
  BlockChrome,
  ChromeButton,
} from "@quanghuy1242/idco-ui";
import { type EditorStore, type NodeId, type ObjectNode } from "../../core";
import { getNodeView, type NodeViewResourceConfigField } from "../spi";
import {
  referenceFieldOf,
  useResolveReference,
} from "../controllers/use-resolve";
import { refField } from "../object-data";
import { ObjectConfigPanel } from "./object-config";
import { renderRestingObject } from "./resting-document";
import { objectBlockStyle } from "../styles";

/**
 * `display:contents` so the chrome wrapper generates no box (its `BlockChrome`
 * children are absolutely positioned against the block container) while still
 * catching the mousedown that must not bubble to the container's activate.
 */
const contentsStyle = { display: "contents" } as const;

/** The accessible name for an atomic object block, from the node's `ariaLabel`. */
function objectAriaLabel(node: ObjectNode): string {
  const kind = getNodeView(node.type)?.ariaLabel ?? `${node.type} block`;
  return node.status === "ready" || node.status === "dirty"
    ? kind
    : `${kind} (${node.status})`;
}

/** The ARIA role for an atomic object block, from the node's `ariaRole`. */
function objectAriaRole(type: string): string {
  return getNodeView(type)?.ariaRole ?? "group";
}

/**
 * One heavy object in the body (docs/010 §5.3). At rest it mounts only its baked
 * static snapshot — no editor instance (AC1) — and activates on pointer down. The
 * outer box is stable across resting↔live so activation never shifts layout
 * (AC3); the live editing surface either edits in place (`liveMode: "in-place"`,
 * code) or opens an anchored React Aria popover that floats over the baked view.
 */
export function EngineObjectBlock(props: {
  readonly node: ObjectNode;
  readonly store: EditorStore;
  readonly registerBlock: (id: NodeId, element: HTMLElement | null) => void;
  readonly registerObjectEditor: (id: NodeId, mounted: boolean) => void;
}) {
  const { node, store, registerBlock, registerObjectEditor } = props;
  const live = useSyncExternalStore(
    (listener) => store.subscribeActiveObject(listener),
    () => store.activeObjectId === node.id,
    () => false,
  );
  // Reference blocks revalidate their snapshot on mount and drive their status
  // lifecycle (docs/026 §7.2/§7.5); the hook no-ops for non-reference objects.
  useResolveReference(node, store);
  const referenceField = referenceFieldOf(node.type);
  // The resting baked content height, captured at activation. The in-place live
  // editor opens at exactly this height so the block box does not shift (AC3).
  const restHeightRef = useRef(0);
  const containerRef = useRef<HTMLElement | null>(null);
  // The settings popover anchors to the chrome gear (not the whole block), so it
  // opens beside the gear exactly like the callout/code chrome menus do.
  const gearRef = useRef<HTMLSpanElement | null>(null);
  // A *stable* ref callback. An inline `ref={(el) => …}` gets a new identity each
  // render, so React calls it with null then the element on every re-render —
  // which nulls the popover's `triggerRef` exactly when the block re-renders
  // resting→live, making React Aria lose and re-acquire the anchor (the
  // double-flicker before the popover settles, docs/010 §6.4). A stable callback
  // only fires on mount/unmount, so the anchor stays put.
  const bindContainer = useCallback(
    (element: HTMLElement | null) => {
      containerRef.current = element;
      registerBlock(node.id, element);
    },
    [node.id, registerBlock],
  );
  // True while a chrome menu (a portal) is open, so a focus-out into it does not
  // deactivate an in-place live surface (the toolbar/chrome focus pattern, §8.6).
  const menuOpenRef = useRef(false);
  const focusInPlace = useCallback(() => {
    containerRef.current?.querySelector("textarea")?.focus();
  }, []);
  const removeBlock = useCallback(() => {
    store.deactivateObject(node.id);
    store.command({ node: node.id, type: "remove-block" });
  }, [node.id, store]);
  const view = getNodeView(node.type);
  // "in-place" live surfaces (code) replace the baked view at the captured
  // height; everything else keeps the baked view and edits in an anchored React
  // Aria popover, so the chrome is a real popover (docs/010 §7.1), not a
  // hand-positioned div.
  const inPlaceLive =
    live && view?.renderLive !== undefined && view.liveMode === "in-place";
  const popoverLive = live && !inPlaceLive;
  // An object that does not edit in place uses the anchored popover. The popover
  // is rendered whenever the object *can* use one and toggled via `isOpen` (not
  // conditionally unmounted), so React Aria can play the exit animation on close
  // and then unmount it — a `{popoverLive ? … : null}` would yank it out before
  // the `data-[exiting]` animation runs (the missing transition-out). When closed
  // React Aria renders nothing, so the live content mounts only while open.
  const usesPopover = !(
    view?.renderLive !== undefined && view.liveMode === "in-place"
  );
  const popoverContent = view?.renderLive ? (
    view.renderLive({
      initialHeight: restHeightRef.current,
      node,
      registerObjectEditor,
      store,
    })
  ) : (
    <ObjectConfigPanel
      node={node}
      registerObjectEditor={registerObjectEditor}
      store={store}
    />
  );
  return (
    <div
      aria-current={live ? "true" : undefined}
      // Atomic objects are not text-caret targets, so the engine reflects their
      // focus/selection itself (docs/011 §8.7, docs/018 §2.3): a stable DOM `id`
      // the surface points `aria-activedescendant` at, a role + accessible name so
      // a screen reader announces the object, and `aria-selected` while live.
      aria-label={objectAriaLabel(node)}
      aria-selected={live ? "true" : undefined}
      // `group/block` scopes the chrome's hover-reveal (CHROME_REVEAL).
      className="group/block"
      data-engine-block-id={node.id}
      data-engine-object-state={live ? "live" : "resting"}
      data-engine-object-status={node.status}
      data-engine-object-type={node.type}
      id={node.id}
      role={objectAriaRole(node.type)}
      // An in-place live surface (code) deactivates when focus leaves the whole
      // block — not just the editor — so the floating chrome (inside the block)
      // can be clicked without deactivating; a chrome menu (a portal) is guarded
      // by `menuOpenRef`. Popover-live objects deactivate via the popover instead.
      onBlur={
        inPlaceLive
          ? (event) => {
              if (menuOpenRef.current) return;
              if (
                containerRef.current?.contains(
                  event.relatedTarget as Node | null,
                )
              ) {
                return;
              }
              store.deactivateObject(node.id);
            }
          : undefined
      }
      // Only an in-place object (code) activates on a body click — editing its
      // text in place is the natural gesture. A popover object (media/embed/…)
      // renders real content (an <img>/<iframe>) that swallows clicks over its
      // box, so it is configured from the gear in the chrome instead (docs/018
      // §2.11 follow-up), never by clicking the body.
      onMouseDown={
        !live && !usesPopover
          ? (event) => {
              event.preventDefault();
              const baked = (event.currentTarget as HTMLElement).querySelector(
                "[data-engine-object-baked]",
              );
              restHeightRef.current =
                baked instanceof HTMLElement ? baked.offsetHeight : 0;
              store.activateObject(node.id);
            }
          : undefined
      }
      ref={bindContainer}
      style={objectBlockStyle}
    >
      <ObjectChrome
        focusInPlace={focusInPlace}
        gearRef={gearRef}
        menuOpenRef={menuOpenRef}
        node={node}
        onRemove={removeBlock}
        store={store}
      />
      {inPlaceLive ? (
        view!.renderLive!({
          initialHeight: restHeightRef.current,
          node,
          registerObjectEditor,
          store,
        })
      ) : (
        <BakedObjectView node={node} store={store} />
      )}
      {!live && referenceField ? (
        <ReferenceStateChrome
          field={referenceField}
          node={node}
          store={store}
        />
      ) : null}
      {usesPopover ? (
        <AnchoredPopover
          ariaLabel={`Edit ${node.type}`}
          isOpen={popoverLive}
          onOpenChange={(open) => {
            if (!open) store.deactivateObject(node.id);
          }}
          placement="bottom end"
          triggerRef={gearRef}
        >
          {popoverContent}
        </AnchoredPopover>
      ) : null}
    </div>
  );
}

/**
 * The standardized floating chrome for an object block (docs/018 §2.8): the name
 * badge (left) and the config + delete actions (right), shared with callouts and
 * the legacy nodes via `@idco/ui`'s `BlockChrome`. The `display:contents` wrapper
 * stops a chrome press from bubbling to the container's activate-on-mousedown, so
 * configuring or deleting a resting block does not first enter live-edit. The
 * badge metadata comes from the node's `chromeMeta` (docs/020 §5.4).
 */
function ObjectChrome(props: {
  readonly node: ObjectNode;
  readonly store: EditorStore;
  readonly menuOpenRef: { current: boolean };
  readonly gearRef: RefObject<HTMLSpanElement | null>;
  readonly focusInPlace: () => void;
  readonly onRemove: () => void;
}) {
  const { node, store, menuOpenRef, gearRef, focusInPlace, onRemove } = props;
  const meta = getNodeView(node.type)?.chromeMeta ?? {
    icon: "Square",
    label: node.type,
  };
  return (
    <div onMouseDown={(event) => event.stopPropagation()} style={contentsStyle}>
      <BlockChrome
        actions={renderObjectConfig(
          node,
          store,
          menuOpenRef,
          focusInPlace,
          gearRef,
        )}
        icon={meta.icon}
        label={meta.label}
        onRemove={onRemove}
      />
    </div>
  );
}

/**
 * The inline chrome config control for an object block. A node with a custom
 * control (the code block's language selector) provides `renderChromeControl`;
 * a node with `configurable: false` (divider/table) shows none; everything else
 * gets the default settings gear that opens its config popover (docs/020 §5.4).
 * The gear (not a body click) is what opens media/embed settings, because a
 * rendered `<img>`/`<iframe>` swallows clicks over its own box.
 */
function renderObjectConfig(
  node: ObjectNode,
  store: EditorStore,
  menuOpenRef: { current: boolean },
  focusInPlace: () => void,
  gearRef: RefObject<HTMLSpanElement | null>,
): ReactNode {
  const view = getNodeView(node.type);
  if (view?.renderChromeControl) {
    return view.renderChromeControl({
      focusInPlace,
      gearRef,
      menuOpenRef,
      node,
      store,
    });
  }
  if (view?.configurable === false) return null;
  // The gear is the popover's anchor (via `gearRef`), so the settings open beside
  // it — the same placement as the callout/code chrome (docs/018 §2.11 follow-up).
  return (
    <span ref={gearRef}>
      <ChromeButton
        icon="Settings"
        label={`${view?.ariaLabel ?? node.type} settings`}
        onPress={() => store.activateObject(node.id)}
      />
    </span>
  );
}

/**
 * The static, publish-ready render of an object's baked snapshot. Delegates to
 * the shared `renderRestingObject` (resting-document.tsx) so the editor's at-rest
 * view and the reader's `RestingDocument` render heavy objects identically and
 * cannot drift (docs/010 §6.2). That shared renderer bakes an unbaked node for
 * display only (imported objects carry no bake, docs/010 §14) and dispatches to
 * the registered `NodeView.renderResting`.
 */
function BakedObjectView(props: {
  readonly node: ObjectNode;
  readonly store: EditorStore;
}) {
  const { node, store } = props;
  return <>{renderRestingObject(node, store.registry)}</>;
}

/**
 * The reference-block state affordance (docs/026 §7.1 / §7.3 / §14.9). The baked
 * snapshot always renders behind it; this adds the three lifecycle states the
 * snapshot alone cannot express, generically for any reference block (built-in or
 * custom), so a block author never re-implements them:
 *
 * - `unresolved` + a ref → a quiet "Refreshing…" hint while the on-mount resolve
 *   runs; the stale snapshot stays visible (SWR, §7.2).
 * - `invalid` → "Couldn’t refresh" (a dangling ref or a failed resolve, §7.3); the
 *   stale snapshot is kept and the affordance reopens the picker to repair it.
 * - `unresolved` + no ref → "Pick a {label}", the empty-state call to action.
 *
 * A `ready`/`dirty` block shows nothing. The actionable variants open the config
 * popover via `activateObject`; `onMouseDown` stop-prop keeps the press from also
 * tripping an in-place object's activate-on-mousedown.
 */
function ReferenceStateChrome(props: {
  readonly node: ObjectNode;
  readonly store: EditorStore;
  readonly field: NodeViewResourceConfigField;
}) {
  const { node, store, field } = props;
  if (node.status === "ready" || node.status === "dirty") return null;
  const hasRef = refField(node.data) !== "";
  if (node.status === "unresolved" && hasRef) {
    return (
      <span
        aria-live="polite"
        className="badge badge-ghost badge-sm absolute bottom-1 left-1 z-10"
        data-engine-reference-state="resolving"
      >
        Refreshing…
      </span>
    );
  }
  const invalid = node.status === "invalid";
  return (
    <button
      className={`badge badge-sm absolute bottom-1 left-1 z-10 cursor-pointer ${
        invalid ? "badge-warning" : "badge-outline"
      }`}
      data-engine-reference-state={invalid ? "invalid" : "empty"}
      onClick={() => store.activateObject(node.id)}
      onMouseDown={(event) => event.stopPropagation()}
      type="button"
    >
      {invalid ? "Couldn’t refresh" : `Pick a ${field.label.toLowerCase()}`}
    </button>
  );
}
