/**
 * The default object config popover (docs/006), shown for a live object that has
 * no custom `renderLive` surface (embed, post-ref, media, table-of-contents). Its
 * fields come from the node's `configFields` (docs/020 §5.4), so the panel keeps no
 * per-type knowledge.
 *
 * Each field is one of two kinds (docs/026 §6.2). A `resource` field is a host
 * record picked from a registered data source: it renders the standardized
 * `@idco/ui` ComboBox (never a hand-rolled list) plus an upload affordance when the
 * source can create, and on pick/upload it projects the chosen option through the
 * field's `toData` and commits `{ ref, snapshot }` (docs/026 §7.1). A `text` field
 * is a plain `Input`; in a *reference* block (one that has a resource field) it
 * edits an author-local field (`data.local`, e.g. a media caption) that a resolve
 * never overwrites (§7.2), while in an owned block it edits the flat `data`. The
 * picker, cache, resolve, and upload are generic engine the host never touches
 * (docs/026 §6.3); the host only registers the source.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, ResourceSelector } from "@quanghuy1242/idco-ui";
import {
  type EditorStore,
  type JsonValue,
  type NodeId,
  type ObjectNode,
} from "../../core";
import {
  getDataSource,
  getNodeView,
  type NodeViewResourceConfigField,
} from "../spi";
import {
  asRecord,
  currentObjectRecord,
  localRecord,
  refField,
  setReference,
  stringField,
} from "../object-data";
import { objectConfigFieldStyle } from "../styles";

/**
 * One `resource` config field (docs/026 §6.2). Owns its own selected-ref state so
 * a pick reflects immediately without waiting for a store re-render, and seeds
 * from the live store so reopening the popover shows the current selection. The
 * default surface is the ComboBox (driven by `source.load`) plus an upload button
 * (driven by `source.upload`, upload-as-create §7.1) — a source may offer either or
 * both. When the declared source offers neither (or is unregistered) the field is
 * inert (provenance, docs/026 §9 — the full insert-affordance gate is Phase 5).
 */
function ResourceConfigField(props: {
  readonly field: NodeViewResourceConfigField;
  readonly store: EditorStore;
  readonly nodeId: NodeId;
}) {
  const { field, store, nodeId } = props;
  const source = getDataSource(field.source);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [ref, setRef] = useState<string>(() =>
    refField(currentObjectRecord(store, nodeId)),
  );

  const commit = useCallback(
    (nextRef: string, snapshot: Record<string, JsonValue>) => {
      store.command({
        data: setReference(
          currentObjectRecord(store, nodeId),
          nextRef,
          snapshot,
        ),
        node: nodeId,
        type: "set-object-data",
      });
    },
    [nodeId, store],
  );

  const onUpload = useCallback(
    async (file: File | undefined) => {
      if (!file || !source?.upload) return;
      // Upload-as-create: the source makes the record and returns it as an option,
      // then the pick proceeds identically (docs/026 §7.1). A manual upload is not
      // cancellable, so a fresh signal is enough.
      const option = await source.upload(file, new AbortController().signal);
      setRef(option.id);
      commit(option.id, { ...field.toData(option) } as Record<
        string,
        JsonValue
      >);
    },
    [commit, field, source],
  );

  if (!source || (!source.load && !source.upload)) {
    return (
      <div className="text-sm opacity-70">
        Source “{field.source}” is not available in this deployment.
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {source.load ? (
        <ResourceSelector
          kind="record"
          label={field.label}
          onChange={(next) => {
            const nextRef = Array.isArray(next) ? (next[0] ?? "") : next;
            setRef(nextRef);
            // A cleared selection drops the ref and snapshot but keeps any
            // author-local fields (setReference preserves `local`, docs/026 §7.1).
            if (nextRef === "") commit("", {});
          }}
          onSelectOption={(option) => {
            setRef(option.id);
            commit(option.id, { ...field.toData(option) } as Record<
              string,
              JsonValue
            >);
          }}
          showLabel
          size="sm"
          source={source.load}
          value={ref}
        />
      ) : (
        <span className="text-sm">{field.label}</span>
      )}
      {source.upload ? (
        <div className="flex justify-end">
          <input
            accept="image/*"
            aria-hidden="true"
            hidden
            onChange={(event) => void onUpload(event.target.files?.[0])}
            ref={fileRef}
            type="file"
          />
          <Button
            ariaLabel={`Upload ${field.label.toLowerCase()}`}
            iconName="Upload"
            onClick={() => fileRef.current?.click()}
            size="sm"
            variant="secondary"
          >
            Upload
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ObjectConfigPanel(props: {
  readonly node: ObjectNode;
  readonly store: EditorStore;
  readonly registerObjectEditor: (id: NodeId, mounted: boolean) => void;
}) {
  const { node, store, registerObjectEditor } = props;
  const id = node.id;
  const fields = getNodeView(node.type)?.configFields ?? [];
  // A reference block routes its `text` fields to `data.local`; an owned block
  // edits the flat `data` (docs/026 §4.3 / §14.7).
  const isReference = fields.some((field) => field.kind === "resource");
  // Optimistic text-field values; resource fields manage their own ref state.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const record = asRecord(node.data);
    const local = localRecord(record);
    return Object.fromEntries(
      fields
        .filter((field) => field.kind !== "resource")
        .map((field) => [
          field.key,
          isReference
            ? stringField(local, field.key)
            : stringField(record, field.key),
        ]),
    );
  });

  useEffect(() => {
    registerObjectEditor(id, true);
    return () => registerObjectEditor(id, false);
  }, [id, registerObjectEditor]);

  const commitText = useCallback(
    (key: string, value: string) => {
      const record = currentObjectRecord(store, id);
      store.command({
        data: isReference
          ? { ...record, local: { ...localRecord(record), [key]: value } }
          : { ...record, [key]: value },
        node: id,
        type: "set-object-data",
      });
    },
    [id, isReference, store],
  );

  return (
    <div className="grid w-72 gap-2" data-engine-object-editor="config">
      {fields.length === 0 ? (
        <div className="text-sm opacity-70">
          No inline config for {node.type}.
        </div>
      ) : (
        fields.map((field) =>
          field.kind === "resource" ? (
            <div data-engine-config-field={field.key} key={field.key}>
              <ResourceConfigField field={field} nodeId={id} store={store} />
            </div>
          ) : (
            <label
              data-engine-config-field={field.key}
              key={field.key}
              style={objectConfigFieldStyle}
            >
              <span className="min-w-16 text-sm">{field.label}</span>
              <Input
                ariaLabel={field.label}
                onChange={(value) => {
                  setValues((current) => ({ ...current, [field.key]: value }));
                  commitText(field.key, value);
                }}
                size="sm"
                value={values[field.key] ?? ""}
              />
            </label>
          ),
        )
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
