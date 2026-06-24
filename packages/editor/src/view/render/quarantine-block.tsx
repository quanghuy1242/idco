/**
 * The quarantine placeholder (note.md item 6) — how the editor renders a block whose
 * schema group is *not* permitted by the deployment's `SchemaProfile`.
 *
 * The deliberate posture is **quarantine, not deletion** (note.md item 6): a block that
 * is out-of-profile in a loaded document is *preserved* — its node (and, for a structural
 * container, its whole subtree) stays in the store untouched, so the snapshot round-trips
 * byte-for-byte and the server's Zod union stays the authority that rejects on write. The
 * editor only refuses to mount its normal editable surface, showing this inert card
 * instead. The author can remove it deliberately (the button), but the editor never
 * auto-removes it — losing content the author did not choose to drop would be the bad
 * practice this design exists to avoid.
 *
 * `EngineBlock` returns this *before* dispatching to the object/structural renderers and
 * before recursing into a container's children, so a quarantined table never paints its
 * rows/cells as orphans — the whole family collapses to one placeholder, which is why the
 * schema group (not the type) is the gating unit (`schema-profile.ts`).
 */
import { Alert, Button } from "@quanghuy1242/idco-ui";
import type {
  EditorStore,
  NodeId,
  ObjectNode,
  StructuralNode,
} from "../../core";
import { structuralContainerStyle } from "../styles";

export function QuarantineBlock(props: {
  readonly node: ObjectNode | StructuralNode;
  readonly store: EditorStore;
  readonly registerBlock: (id: NodeId, element: HTMLElement | null) => void;
}) {
  const { node, store, registerBlock } = props;
  return (
    <div
      data-engine-block-id={node.id}
      data-engine-quarantined={node.type}
      ref={(element) => registerBlock(node.id, element)}
      style={structuralContainerStyle}
    >
      <Alert tone="warning">
        <div className="flex w-full items-center justify-between gap-2">
          <span>
            This <strong>{node.type}</strong> block isn’t available in this
            content profile. Its content is preserved.
          </span>
          <Button
            ariaLabel={`Remove ${node.type} block`}
            onClick={() =>
              store.command({ node: node.id, type: "remove-block" })
            }
            size="sm"
            variant="ghost"
          >
            Remove
          </Button>
        </div>
      </Alert>
    </div>
  );
}
