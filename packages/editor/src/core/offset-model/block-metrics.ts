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
import type { NodeDefinition, NodeHeightHint } from "../registry";

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

/**
 * Map an editor node to the `BlockMetrics` its height estimate is derived from.
 *
 * When a `definition` is supplied (the object's `NodeDefinition`) its
 * `estimateMetrics` hook wins: an object that declares its own height signal —
 * a 16:9 embed, a reference card, code by line count — seeds accurately before
 * its async data resolves (docs/025 §5.3, backlog §3). The hook is consulted only
 * for object nodes and only when it returns a usable signal; otherwise (and for
 * text/structural nodes, or when no definition is passed) the generic data-shape
 * heuristics below apply, so callers that omit `definition` keep the old behavior.
 */
export function metricsForNode(
  node: EditorNode,
  definition?: NodeDefinition,
): BlockMetrics {
  if (node.kind === "object" && definition?.estimateMetrics) {
    const declared = declaredMetrics(node.type, definition, node.data);
    if (declared) return declared;
  }
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

/**
 * Resolve an object's declared height signal to `BlockMetrics`, or null when it
 * declares none / an unusable one (the caller then falls through to the generic
 * heuristics). The typeKey mirrors the analytic kind the hint maps onto, so a
 * declared `aspect`/`lines`/`fixed` calibrates in the same per-type bucket as an
 * analytically-classified block of that type would. Defensive like the rest of
 * this module: a throwing or nonsense hook costs a coarser seed, never a crash.
 */
function declaredMetrics(
  type: string,
  definition: NodeDefinition,
  data: JsonValue | undefined,
): BlockMetrics | null {
  let hint: NodeHeightHint | null;
  try {
    hint = definition.estimateMetrics!(data ?? null);
  } catch {
    return null;
  }
  if (!hint) return null;
  switch (hint.kind) {
    case "aspect":
      return Number.isFinite(hint.aspectRatio) && hint.aspectRatio > 0
        ? {
            aspectRatio: hint.aspectRatio,
            kind: "image",
            typeKey: `image:${type}`,
          }
        : null;
    case "lines":
      return Number.isFinite(hint.lines) && hint.lines > 0
        ? {
            kind: "code",
            lines: Math.max(1, Math.floor(hint.lines)),
            typeKey: `code:${type}`,
          }
        : null;
    case "fixed":
      return Number.isFinite(hint.height) && hint.height > 0
        ? { height: hint.height, kind: "fixed", typeKey: `fixed:${type}` }
        : null;
    default:
      return null;
  }
}
