/**
 * Map an {@link EditorNode} to the {@link BlockMetrics} the estimator consumes
 * (docs/025 §5.3). This is the only place that knows node shapes; the estimator
 * stays a pure function of metrics so it is testable without the model.
 *
 * Coverage, grounded in the actual node data shapes:
 * - text leaves carry their string → analytic by character count;
 * - code-block objects carry `data.code` → analytic by line count;
 * - media (image) objects carry only `src`/`alt`/`caption`, no dimensions, so
 *   they have no analytic signal and fall to the per-type bucket mean. A custom
 *   object that *does* store `width`/`height` gets the image analytic.
 * - everything else (embed, divider, structural containers) is opaque, bucketed
 *   by type so each calibrates separately.
 *
 * Extraction is defensive: anything unexpected degrades to an opaque bucket,
 * never throws. A wrong-but-safe metric only costs estimate accuracy, which
 * anchoring and re-measurement correct (docs/025 §5.4, §10).
 */
import { isRecord } from "@quanghuy1242/idco-lib";
import type { BlockMetrics } from "./block-estimator";
import type { EditorNode, JsonValue } from "../model";

function asRecord(value: JsonValue | undefined): {
  readonly [key: string]: JsonValue;
} {
  return isRecord(value)
    ? (value as { readonly [key: string]: JsonValue })
    : {};
}

function numberField(
  record: { readonly [key: string]: JsonValue },
  key: string,
): number | null {
  const v = record[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * @categoryDefault Virtual Geometry
 */

/** Map an editor node to the `BlockMetrics` its height estimate is derived from. */
export function metricsForNode(node: EditorNode): BlockMetrics {
  switch (node.kind) {
    case "text":
      return {
        chars: node.content.text.length,
        kind: "text",
        typeKey: `text:${node.type}`,
      };
    case "structural":
      // A container's height is its children; no per-block analytic, so bucket it.
      return { kind: "opaque", typeKey: `struct:${node.type}` };
    case "object": {
      const data = asRecord(node.data);
      const code = data.code;
      if (typeof code === "string") {
        const lines = code.length === 0 ? 1 : code.split("\n").length;
        return { kind: "code", lines, typeKey: `code:${node.type}` };
      }
      const width = numberField(data, "width");
      const height = numberField(data, "height");
      if (width !== null && height !== null && width > 0) {
        return {
          aspectRatio: height / width,
          kind: "image",
          typeKey: `image:${node.type}`,
        };
      }
      return { kind: "opaque", typeKey: `obj:${node.type}` };
    }
    default:
      return { kind: "opaque", typeKey: "unknown" };
  }
}
