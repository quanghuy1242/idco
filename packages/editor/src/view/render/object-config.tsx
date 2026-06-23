/**
 * The default object config popover (docs/006), shown for a live object that has
 * no custom `renderLive` surface (embed, post-ref, table-of-contents). Its fields
 * come from the node's `configFields` (docs/020 §5.4), so the panel keeps no
 * per-type knowledge.
 *
 * Each field is one of two kinds (docs/026 §6.2). A `text` field is today's plain
 * `Input`, committed flat into the node's `data`. A `resource` field is a host
 * record picked from a registered data source: it renders the standardized
 * `@idco/ui` ComboBox (never a hand-rolled list), and on pick it projects the
 * chosen option through the field's `toData` and commits `{ ref, snapshot }`
 * (docs/026 §7.1). The picker, the cache, and resolve are generic engine the host
 * never touches (docs/026 §6.3); the host only registers the source.
 */
import { useCallback, useEffect, useState } from "react";
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
  refField,
  setReference,
  stringField,
} from "../object-data";
import { objectConfigFieldStyle } from "../styles";

/**
 * One `resource` config field (docs/026 §6.2). Owns its own selected-ref state so
 * a pick reflects immediately without waiting for a store re-render, and seeds
 * from the live store so reopening the popover shows the current selection. When
 * the declared source is not registered in this deployment the field is inert
 * (provenance, docs/026 §9 — the full insert-affordance gate lands in Phase 5).
 */
function ResourceConfigField(props: {
  readonly field: NodeViewResourceConfigField;
  readonly store: EditorStore;
  readonly nodeId: NodeId;
}) {
  const { field, store, nodeId } = props;
  const source = getDataSource(field.source);
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

  if (!source?.load) {
    return (
      <div className="text-sm opacity-70">
        Source “{field.source}” is not available in this deployment.
      </div>
    );
  }

  return (
    <ResourceSelector
      kind="record"
      label={field.label}
      onChange={(next) => {
        const nextRef = Array.isArray(next) ? (next[0] ?? "") : next;
        setRef(nextRef);
        // A cleared selection drops the ref and the snapshot but keeps any
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
  // Optimistic text-field values; resource fields manage their own ref state.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const record = asRecord(node.data);
    return Object.fromEntries(
      fields
        .filter((field) => field.kind !== "resource")
        .map((field) => [field.key, stringField(record, field.key)]),
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
                  const next = { ...values, [field.key]: value };
                  setValues(next);
                  commit(next);
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
