/**
 * Heavy-object block rendering, dispatched through the node SPI (docs/016, §10).
 *
 * `EngineObjectBlock` is a thin dispatcher with no per-type knowledge: at rest it
 * renders the active `NodeView.renderResting`; once live it renders that view's
 * `renderLive` (code today) or the default config panel. The built-in views
 * below are the old hardcoded `switch (baked.kind)` arms, lifted verbatim behind
 * the registry (docs/017 §3.2) — same behavior, registry lookup instead of a
 * switch, so a new node is a `registerNode` call rather than an edit here.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AnchoredPopover, Button, Input } from "@quanghuy1242/idco-ui";
import {
  type EditorStore,
  type JsonValue,
  type NodeId,
  type ObjectNode,
} from "../core";
import { getNodeView, registerNodeView } from "./node-view";
import { renderRestingObject } from "./resting-document";
import { useUpload } from "./upload-context";
import {
  codeBakedStyle,
  codeLiveStyle,
  mediaBakedStyle,
  mediaThumbStyle,
  objectBlockStyle,
  objectConfigFieldStyle,
  objectStatusStyle,
} from "./styles";

/** A friendly object-kind name for screen readers (docs/018 §2.3). */
const OBJECT_LABELS: Record<string, string> = {
  "code-block": "Code block",
  divider: "Divider",
  embed: "Embedded content",
  media: "Image",
  "post-ref": "Linked post",
  table: "Table",
  "table-of-contents": "Table of contents",
};

/** The accessible name for an atomic object block. */
function objectAriaLabel(node: ObjectNode): string {
  const kind = OBJECT_LABELS[node.type] ?? `${node.type} block`;
  return node.status === "ready" || node.status === "dirty"
    ? kind
    : `${kind} (${node.status})`;
}

/** The ARIA role for an atomic object block, by type. */
function objectAriaRole(type: string): string {
  if (type === "divider") return "separator";
  if (type === "media") return "img";
  return "group";
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
  // The resting baked content height, captured at activation. The in-place live
  // editor opens at exactly this height so the block box does not shift (AC3).
  const restHeightRef = useRef(0);
  const containerRef = useRef<HTMLElement | null>(null);
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
      data-engine-block-id={node.id}
      data-engine-object-state={live ? "live" : "resting"}
      data-engine-object-status={node.status}
      data-engine-object-type={node.type}
      id={node.id}
      role={objectAriaRole(node.type)}
      onMouseDown={
        live
          ? undefined
          : (event) => {
              event.preventDefault();
              const baked = (event.currentTarget as HTMLElement).querySelector(
                "[data-engine-object-baked]",
              );
              restHeightRef.current =
                baked instanceof HTMLElement ? baked.offsetHeight : 0;
              store.activateObject(node.id);
            }
      }
      ref={bindContainer}
      style={objectBlockStyle}
    >
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
      {usesPopover ? (
        <AnchoredPopover
          ariaLabel={`Edit ${node.type}`}
          isOpen={popoverLive}
          onOpenChange={(open) => {
            if (!open) store.deactivateObject(node.id);
          }}
          triggerRef={containerRef}
        >
          {popoverContent}
        </AnchoredPopover>
      ) : null}
    </div>
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

/** In-place code editing surface; commits re-bake the block through the store. */
function CodeLiveSurface(props: {
  readonly node: ObjectNode;
  readonly store: EditorStore;
  readonly registerObjectEditor: (id: NodeId, mounted: boolean) => void;
  /** Resting baked height captured at activation; opens at this height (AC3). */
  readonly initialHeight: number;
}) {
  const { node, store, registerObjectEditor, initialHeight } = props;
  const id = node.id;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Local editing state, seeded once at activation. The store is the source of
  // truth on commit, but the textarea owns the caret while live, so it must not
  // re-seed from the node on every keystroke commit.
  const [code, setCode] = useState(() => bakedCodeText(node));

  // Auto-size the textarea to its content so the live box matches the resting
  // baked <pre> (same font, padding, and line count) and activation does not
  // shift layout (AC3, the no-drift property).
  const autoSize = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, []);

  useEffect(() => {
    registerObjectEditor(id, true);
    // Open at the captured resting height so the box matches exactly (AC3);
    // subsequent edits auto-size to content.
    const element = textareaRef.current;
    if (element) {
      if (initialHeight > 0) element.style.height = `${initialHeight}px`;
      else autoSize();
    }
    element?.focus();
    return () => registerObjectEditor(id, false);
  }, [autoSize, id, initialHeight, registerObjectEditor]);

  const commit = useCallback(
    (next: string) => {
      const record = currentObjectRecord(store, id);
      store.command({
        data: {
          ...record,
          code: next,
          language: stringField(record, "language") || "ts",
        },
        node: id,
        type: "set-object-data",
      });
    },
    [id, store],
  );

  return (
    <textarea
      data-engine-object-editor="code"
      onBlur={() => store.deactivateObject(id)}
      onChange={(event) => {
        setCode(event.target.value);
        commit(event.target.value);
        autoSize();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          store.deactivateObject(id);
        }
        // Keep keystrokes inside the object; the document key handler is for text.
        event.stopPropagation();
      }}
      ref={textareaRef}
      spellCheck={false}
      style={codeLiveStyle}
      value={code}
    />
  );
}

/** The default config form (docs/006) for non-code objects, shown in the popover. */
function ObjectConfigPanel(props: {
  readonly node: ObjectNode;
  readonly store: EditorStore;
  readonly registerObjectEditor: (id: NodeId, mounted: boolean) => void;
}) {
  const { node, store, registerObjectEditor } = props;
  const id = node.id;
  const fields = OBJECT_CONFIG_FIELDS[node.type] ?? [];
  const [values, setValues] = useState<Record<string, string>>(() => {
    const record = asRecord(node.data);
    return Object.fromEntries(
      fields.map((field) => [field.key, stringField(record, field.key)]),
    );
  });

  useEffect(() => {
    registerObjectEditor(id, true);
    return () => registerObjectEditor(id, false);
  }, [id, registerObjectEditor]);

  const commit = useCallback(
    (next: Record<string, string>) => {
      const record = currentObjectRecord(store, id);
      store.command({
        data: { ...record, ...next },
        node: id,
        type: "set-object-data",
      });
    },
    [id, store],
  );

  return (
    <div className="grid w-72 gap-2" data-engine-object-editor="config">
      {fields.length === 0 ? (
        <div className="text-sm opacity-70">
          No inline config for {node.type}.
        </div>
      ) : (
        fields.map((field) => (
          <label
            data-engine-config-field={field.key}
            key={field.key}
            style={objectConfigFieldStyle}
          >
            <span className="min-w-16 text-sm">{field.label}</span>
            <Input
              ariaLabel={field.label}
              onChange={(value) => {
                const next = { ...values, [field.key]: value };
                setValues(next);
                commit(next);
              }}
              size="sm"
              value={values[field.key] ?? ""}
            />
          </label>
        ))
      )}
      <div className="flex justify-end">
        <Button
          ariaLabel="Done"
          onClick={() => store.deactivateObject(id)}
          size="sm"
          variant="primary"
        >
          Done
        </Button>
      </div>
    </div>
  );
}

type ObjectConfigField = { readonly key: string; readonly label: string };

/** Inline config fields per object type (docs/006 chrome popover). */
const OBJECT_CONFIG_FIELDS: Record<string, readonly ObjectConfigField[]> = {
  embed: [
    { key: "url", label: "URL" },
    { key: "title", label: "Title" },
  ],
  media: [
    { key: "src", label: "Source" },
    { key: "alt", label: "Alt" },
    { key: "caption", label: "Caption" },
  ],
  "post-ref": [
    { key: "postId", label: "Post id" },
    { key: "title", label: "Title" },
    { key: "url", label: "URL" },
  ],
  "table-of-contents": [{ key: "title", label: "Title" }],
};

function asRecord(value: unknown): Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

function stringField(record: Record<string, JsonValue>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

/** The object's current data as a record, read live from the store. */
function currentObjectRecord(
  store: EditorStore,
  id: NodeId,
): Record<string, JsonValue> {
  const node = store.getNode(id);
  return node && node.kind === "object" ? asRecord(node.data) : {};
}

/** The code text for the editor surface, read from the baked snapshot. */
function bakedCodeText(node: ObjectNode): string {
  if (node.baked?.kind === "code") {
    return stringField(asRecord(node.baked.payload), "code");
  }
  return "";
}

// --- Built-in node views (docs/016 §10): the old `switch (baked.kind)` arms,
// lifted verbatim behind the registry, plus the divider worked example.

registerNodeView({
  // Code edits in place (the textarea replaces the baked <pre> at its height),
  // so activation does not shift layout (AC3); everything else uses the popover.
  liveMode: "in-place",
  renderLive: (args) => (
    <CodeLiveSurface
      initialHeight={args.initialHeight}
      node={args.node}
      registerObjectEditor={args.registerObjectEditor}
      store={args.store}
    />
  ),
  renderResting: ({ baked }) => (
    <pre data-engine-object-baked="code" style={codeBakedStyle}>
      <code>{stringField(asRecord(baked.payload), "code")}</code>
    </pre>
  ),
  type: "code-block",
});

/**
 * The image worked example's live surface (docs/016 §9, docs/010 Phase 8 AC6).
 *
 * Rendered inside the block's anchored React Aria popover (the baked figure stays
 * mounted behind it, so the box does not shift, AC3). `@idco/ui` Source/Alt/
 * Caption fields plus an upload affordance; upload transport is the host's
 * `uploadImage` binding (AC10, §10.5) — the node only receives a resolved `src`.
 */
function MediaLiveSurface(props: {
  readonly node: ObjectNode;
  readonly store: EditorStore;
  readonly registerObjectEditor: (id: NodeId, mounted: boolean) => void;
}) {
  const { node, store, registerObjectEditor } = props;
  const id = node.id;
  const upload = useUpload();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const record = asRecord(node.data);
    return {
      alt: stringField(record, "alt"),
      caption: stringField(record, "caption"),
      src: stringField(record, "src"),
    };
  });

  useEffect(() => {
    registerObjectEditor(id, true);
    return () => registerObjectEditor(id, false);
  }, [id, registerObjectEditor]);

  const commit = useCallback(
    (next: Record<string, string>) => {
      const record = currentObjectRecord(store, id);
      store.command({
        data: { ...record, ...next },
        node: id,
        type: "set-object-data",
      });
    },
    [id, store],
  );

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file || !upload) return;
      const result = await upload(file);
      const next = {
        ...values,
        alt: result.alt ?? values.alt,
        src: result.src,
      };
      setValues(next);
      commit(next);
    },
    [commit, upload, values],
  );

  return (
    <div className="grid w-72 gap-2" data-engine-object-editor="media">
      {(["src", "alt", "caption"] as const).map((key) => (
        <label
          data-engine-config-field={key}
          key={key}
          style={objectConfigFieldStyle}
        >
          <span className="min-w-16 text-sm capitalize">{key}</span>
          <Input
            ariaLabel={
              key === "src" ? "Source" : key === "alt" ? "Alt" : "Caption"
            }
            onChange={(value) => {
              const next = { ...values, [key]: value };
              setValues(next);
              commit(next);
            }}
            size="sm"
            value={values[key] ?? ""}
          />
        </label>
      ))}
      <div className="flex items-center justify-end gap-2">
        {upload ? (
          <>
            <input
              accept="image/*"
              aria-hidden="true"
              hidden
              onChange={(event) => void onFile(event.target.files?.[0])}
              ref={fileRef}
              type="file"
            />
            <Button
              ariaLabel="Upload image"
              iconName="Upload"
              onClick={() => fileRef.current?.click()}
              size="sm"
              variant="secondary"
            >
              Upload
            </Button>
          </>
        ) : null}
        <Button
          ariaLabel="Done"
          onClick={() => store.deactivateObject(id)}
          size="sm"
          variant="primary"
        >
          Done
        </Button>
      </div>
    </div>
  );
}

registerNodeView({
  insert: {
    createData: () => ({ alt: "", caption: "", src: "" }),
    group: "Media",
    keywords: ["img", "photo", "upload"],
    label: "Image",
  },
  renderLive: (args) => (
    <MediaLiveSurface
      node={args.node}
      registerObjectEditor={args.registerObjectEditor}
      store={args.store}
    />
  ),
  renderResting: ({ baked }) => {
    const payload = asRecord(baked.payload);
    const src = stringField(payload, "src");
    const caption = stringField(payload, "caption");
    return (
      <figure data-engine-object-baked="media" style={mediaBakedStyle}>
        <div style={mediaThumbStyle}>{src ? `🖼 ${src}` : "🖼 media"}</div>
        {caption ? <figcaption>{caption}</figcaption> : null}
      </figure>
    );
  },
  type: "media",
});

registerNodeView({
  renderResting: ({ baked }) => {
    const payload = asRecord(baked.payload);
    return (
      <div data-engine-object-baked="embed" style={objectStatusStyle}>
        🔗 {stringField(payload, "title") || stringField(payload, "url")}
      </div>
    );
  },
  type: "embed",
});

registerNodeView({
  renderResting: ({ baked }) => {
    const payload = asRecord(baked.payload);
    return (
      <div data-engine-object-baked="post-ref" style={objectStatusStyle}>
        📄 {stringField(payload, "title") || stringField(payload, "postId")}
      </div>
    );
  },
  type: "post-ref",
});

// docs/016 §8 — the divider worked example: a brand-new node, rendered through
// the SPI with no edit to the dispatcher above. Its definition is the built-in
// in core/registry.ts.
registerNodeView({
  insert: {
    createData: () => ({}),
    group: "Blocks",
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
  type: "divider",
});
