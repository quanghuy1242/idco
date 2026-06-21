/**
 * The default object config popover (docs/006), shown for a live object that has
 * no custom `renderLive` surface (embed, post-ref, table-of-contents). Its fields
 * come from the node's `configFields` (docs/020 §5.4), so the panel keeps no
 * per-type knowledge.
 */
import { useCallback, useEffect, useState } from "react";
import { Button, Input } from "@quanghuy1242/idco-ui";
import { type EditorStore, type NodeId, type ObjectNode } from "../core";
import { getNodeView } from "./node-view";
import { asRecord, currentObjectRecord, stringField } from "./object-data";
import { objectConfigFieldStyle } from "./styles";

export function ObjectConfigPanel(props: {
  readonly node: ObjectNode;
  readonly store: EditorStore;
  readonly registerObjectEditor: (id: NodeId, mounted: boolean) => void;
}) {
  const { node, store, registerObjectEditor } = props;
  const id = node.id;
  const fields = getNodeView(node.type)?.configFields ?? [];
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
