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
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AnchoredPopover,
  BlockChrome,
  Button,
  ChromeSelect,
  type ChromeSelectOption,
  CodeEditor,
  type CodeEditorLanguage,
  Input,
} from "@quanghuy1242/idco-ui";
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
  mediaBakedStyle,
  mediaThumbStyle,
  objectBlockStyle,
  objectConfigFieldStyle,
  objectStatusStyle,
} from "./styles";

/** A stable no-op for the read-only code surface's required `onChange`. */
const noop = () => {};

/**
 * `display:contents` so the chrome wrapper generates no box (its `BlockChrome`
 * children are absolutely positioned against the block container) while still
 * catching the mousedown that must not bubble to the container's activate.
 */
const contentsStyle = { display: "contents" } as const;

/** Code languages the highlighter supports, with their display labels. */
const CODE_LANGUAGES: readonly ChromeSelectOption<CodeEditorLanguage>[] = [
  { label: "TypeScript", value: "ts" },
  { label: "JavaScript", value: "js" },
  { label: "JSON", value: "json" },
  { label: "Python", value: "python" },
  { label: "TSX", value: "tsx" },
  { label: "Plain text", value: "text" },
];

const CODE_LANGUAGE_VALUES = new Set<string>(
  CODE_LANGUAGES.map((l) => l.value),
);

/** Coerce a stored language string to one the highlighter knows (else plain). */
function toCodeLanguage(value: string): CodeEditorLanguage {
  return CODE_LANGUAGE_VALUES.has(value)
    ? (value as CodeEditorLanguage)
    : "text";
}

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
      <ObjectChrome
        focusInPlace={focusInPlace}
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

/** Badge icon + label per object type for the floating chrome. */
const OBJECT_CHROME_META: Record<string, { icon: string; label: string }> = {
  "code-block": { icon: "Code", label: "Code" },
  divider: { icon: "Minus", label: "Divider" },
  embed: { icon: "ExternalLink", label: "Embed" },
  media: { icon: "Image", label: "Image" },
  "post-ref": { icon: "FileText", label: "Linked post" },
  table: { icon: "Table", label: "Table" },
  "table-of-contents": { icon: "List", label: "Contents" },
};

/**
 * The standardized floating chrome for an object block (docs/018 §2.8): the name
 * badge (left) and the config + delete actions (right), shared with callouts and
 * the legacy nodes via `@idco/ui`'s `BlockChrome`. The `display:contents` wrapper
 * stops a chrome press from bubbling to the container's activate-on-mousedown, so
 * configuring or deleting a resting block does not first enter live-edit.
 */
function ObjectChrome(props: {
  readonly node: ObjectNode;
  readonly store: EditorStore;
  readonly menuOpenRef: { current: boolean };
  readonly focusInPlace: () => void;
  readonly onRemove: () => void;
}) {
  const { node, store, menuOpenRef, focusInPlace, onRemove } = props;
  const meta = OBJECT_CHROME_META[node.type] ?? {
    icon: "Square",
    label: node.type,
  };
  return (
    <div onMouseDown={(event) => event.stopPropagation()} style={contentsStyle}>
      <BlockChrome
        actions={renderObjectConfig(node, store, menuOpenRef, focusInPlace)}
        icon={meta.icon}
        label={meta.label}
        onRemove={onRemove}
      />
    </div>
  );
}

/** Per-type chrome config control; code carries a language selector. */
function renderObjectConfig(
  node: ObjectNode,
  store: EditorStore,
  menuOpenRef: { current: boolean },
  focusInPlace: () => void,
) {
  if (node.type !== "code-block") return null;
  const language = toCodeLanguage(stringField(asRecord(node.data), "language"));
  return (
    <ChromeSelect
      label="Code language"
      menuClassName="w-40"
      onChange={(value) => {
        const record = currentObjectRecord(store, node.id);
        store.command({
          data: { ...record, language: value },
          node: node.id,
          type: "set-object-data",
        });
      }}
      onOpenChange={(open) => {
        menuOpenRef.current = open;
        if (!open) requestAnimationFrame(focusInPlace);
      }}
      options={CODE_LANGUAGES}
      value={language}
    />
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
 * In-place code editing surface (docs/018 §2.8). The live edit reuses `@idco/ui`'s
 * `CodeEditor` (transparent textarea over a Prism-highlighted `<pre>`), and the
 * resting render mounts the *same* component read-only, so highlighting matches
 * and the box does not drift on activation (AC3, the no-shift contract). The
 * language selector and delete live in the shared block chrome (`ObjectChrome`);
 * deactivation-on-blur is owned by the block container so chrome clicks do not
 * drop the surface. Commits re-bake the block through the store.
 */
function CodeLiveSurface(props: {
  readonly node: ObjectNode;
  readonly store: EditorStore;
  readonly registerObjectEditor: (id: NodeId, mounted: boolean) => void;
}) {
  const { node, store, registerObjectEditor } = props;
  const id = node.id;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // Code text is local (the textarea owns the caret while live), so it is seeded
  // once and never re-seeded on a commit. The language is derived from the live
  // node, so the chrome's language selector updates the highlighting immediately.
  const [code, setCode] = useState(() => bakedCodeText(node));
  const language = toCodeLanguage(stringField(asRecord(node.data), "language"));

  // Bridge to the reused CodeEditor: it does not expose its inner <textarea>
  // (no ref/data-attr/focus props), so the owned-editor live-slot contract — the
  // focusable, fillable `data-engine-object-editor="code"` element (e2e AC1/AC4/
  // AC5) plus autofocus on activation — is wired onto that one textarea here.
  // CodeEditor renders exactly one; React leaves the foreign attribute in place
  // across re-renders since it never set it.
  useLayoutEffect(() => {
    registerObjectEditor(id, true);
    const textarea = wrapperRef.current?.querySelector("textarea");
    if (textarea) {
      textarea.setAttribute("data-engine-object-editor", "code");
      textarea.focus();
    }
    return () => registerObjectEditor(id, false);
  }, [id, registerObjectEditor]);

  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          store.deactivateObject(id);
        }
        // Keep keystrokes inside the object; the document key handler is for text.
        event.stopPropagation();
      }}
      ref={wrapperRef}
    >
      <CodeEditor
        language={language}
        onChange={(value) => {
          setCode(value);
          const record = currentObjectRecord(store, id);
          store.command({
            data: { ...record, code: value, language },
            node: id,
            type: "set-object-data",
          });
        }}
        value={code}
      />
    </div>
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
  // The Insert (+) menu can drop a fresh code block; it activates for editing on
  // click, where the floating language selector picks the highlight grammar.
  insert: {
    createData: () => ({ code: "", language: "ts" }),
    group: "Blocks",
    keywords: ["code", "snippet", "```"],
    label: "Code block",
  },
  // Code edits in place (the CodeEditor replaces the baked render at the same
  // box), so activation does not shift layout (AC3); everything else uses the
  // popover.
  liveMode: "in-place",
  renderLive: (args) => (
    <CodeLiveSurface
      node={args.node}
      registerObjectEditor={args.registerObjectEditor}
      store={args.store}
    />
  ),
  // The resting render is the *same* CodeEditor read-only: Prism-highlighted code
  // (no longer a bare unhighlighted <pre>, docs/018 §2.8) and, because it is the
  // identical component the live surface uses, the box cannot drift on activation
  // (AC3). The read-only textarea carries no `data-engine-object-editor`, so AC1's
  // "no editor instance at rest" selector count stays zero. Highlighting runs in
  // the view layer (not core, G3/G4); routing it through a worker baker and the
  // shared reader primitive is the §2.8 follow-up when packages/reader lands.
  renderResting: ({ baked }) => {
    const payload = asRecord(baked.payload);
    return (
      <div data-engine-object-baked="code">
        <CodeEditor
          language={toCodeLanguage(stringField(payload, "language"))}
          onChange={noop}
          readOnly
          value={stringField(payload, "code")}
        />
      </div>
    );
  },
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
