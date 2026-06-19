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
import type { EditorStore, JsonValue, NodeId, ObjectNode } from "../core";
import { getNodeView, registerNodeView } from "./node-view";
import {
  codeBakedStyle,
  codeLiveStyle,
  mediaBakedStyle,
  mediaThumbStyle,
  objectBlockStyle,
  objectConfigDoneStyle,
  objectConfigFieldStyle,
  objectConfigInputStyle,
  objectConfigStyle,
  objectStatusStyle,
} from "./styles";

/**
 * One heavy object in the body (docs/010 §5.3). At rest it mounts only its baked
 * static snapshot — no editor instance (AC1) — and activates on pointer down. The
 * outer box is stable across resting↔live so activation never shifts layout
 * (AC3); the live editing surface either edits in place (a `NodeView.renderLive`)
 * or overlays a config panel that does not affect the measured box.
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
  const view = getNodeView(node.type);
  // A node renders in place while live only when its view supplies a live
  // surface (code today); otherwise the config panel overlays the baked view.
  const inPlaceLive = live && view?.renderLive !== undefined;
  return (
    <div
      data-engine-block-id={node.id}
      data-engine-object-state={live ? "live" : "resting"}
      data-engine-object-status={node.status}
      data-engine-object-type={node.type}
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
      ref={(element) => registerBlock(node.id, element)}
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
        <BakedObjectView node={node} />
      )}
      {live && !inPlaceLive ? (
        <ObjectConfigPanel
          node={node}
          registerObjectEditor={registerObjectEditor}
          store={store}
        />
      ) : null}
    </div>
  );
}

/**
 * The static, publish-ready render of an object's baked snapshot. Dispatches to
 * the registered `NodeView.renderResting`; an unbaked node shows its status and a
 * node with no registered view falls back to a generic placeholder (docs/016 §10).
 */
function BakedObjectView(props: { readonly node: ObjectNode }) {
  const { node } = props;
  const baked = node.baked;
  if (!baked) {
    return (
      <div data-engine-object-baked="none" style={objectStatusStyle}>
        {node.status === "invalid"
          ? `⚠ ${node.type}: cannot bake (check its data)`
          : `${node.type}: not baked yet`}
      </div>
    );
  }
  const view = getNodeView(node.type);
  if (view) return <>{view.renderResting({ baked, node })}</>;
  return (
    <div data-engine-object-baked={baked.kind} style={objectStatusStyle}>
      {node.type} (baked: {baked.kind})
    </div>
  );
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

/** A chrome config panel (docs/006) for non-code objects; overlaid, not inline. */
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
    <div data-engine-object-editor="config" style={objectConfigStyle}>
      {fields.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No inline config for {node.type}.</div>
      ) : (
        fields.map((field) => (
          <label key={field.key} style={objectConfigFieldStyle}>
            <span style={{ minWidth: 64 }}>{field.label}</span>
            <input
              data-engine-config-field={field.key}
              onChange={(event) => {
                const next = { ...values, [field.key]: event.target.value };
                setValues(next);
                commit(next);
              }}
              style={objectConfigInputStyle}
              type="text"
              value={values[field.key] ?? ""}
            />
          </label>
        ))
      )}
      <button
        data-engine-object-done=""
        onClick={() => store.deactivateObject(id)}
        style={objectConfigDoneStyle}
        type="button"
      >
        Done
      </button>
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

registerNodeView({
  insert: {
    createData: () => ({ alt: "", caption: "", src: "" }),
    group: "Media",
    keywords: ["img", "photo", "upload"],
    label: "Image",
  },
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
