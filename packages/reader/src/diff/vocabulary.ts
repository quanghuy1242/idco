/**
 * The change vocabulary and the `tierOf` classifier (docs/039 §6.1).
 *
 * Every change resolves to one of four disclosure tiers through a pure function both the diff view
 * and the woven overlay read, so the two surfaces agree on how much of a change is shown inline vs
 * floated vs drilled into. The vocabulary is a superset of CriticMarkup's five verbs and CKEditor
 * 5's suggestion types (insertion, deletion, attribute, format, plus a generic type for widgets) —
 * the `object.opaque` kind is that generic-widget escape hatch, filled by a node's `renderDiff`.
 *
 * Tier is a property of `(kind × nodeType)`: the default table is the contract, and a node type
 * overrides only its own opaque path by supplying a `renderDiff` ({@link NodeDiffRenderer}), which
 * promotes its `object.*` and inner `text.*` changes from a summary to a scoped diff (`band`). The
 * classifier is framework-free so an out-of-process consumer (docs/037 agent) can classify a change
 * without React; only the render atoms are React.
 *
 * @categoryDefault Diff View
 */
import type { ReactNode } from "react";
import { isRecord } from "@quanghuy1242/idco-lib";
import type { ReaderBlockDiff } from "./types";

/**
 * @categoryDefault Diff View
 */

/**
 * How much of a change is disclosed where (docs/039 §4.3, §6.1).
 *
 * `woven` renders inline with zero reflow (track-changes runs, a real added block, a ghost);
 * `marked` shows a non-reflowing marker (bar or ring) plus a floated one-line chip; `band` expands
 * on demand into a scoped diff view (a code line diff, a custom node's own diff); `pane` has no
 * block to anchor to and routes to the Changes pane (settings, a collection).
 */
export type DisclosureTier = "woven" | "marked" | "band" | "pane";

/**
 * The closed set of change kinds (docs/039 §6.1) — the vocabulary both surfaces classify against.
 */
export type ChangeKind =
  | "text.insert"
  | "text.delete"
  | "mark.add"
  | "mark.remove"
  | "mark.change"
  | "attr.block"
  | "attr.element"
  | "object.field"
  | "object.opaque"
  | "block.add"
  | "block.remove"
  | "block.move"
  | "child.add"
  | "child.remove"
  | "child.move"
  | "collection"
  | "settings";

/**
 * The per-node diff renderer seam (docs/039 §8) — a read-only, RSC-safe render of one object node's
 * own diff, consumed identically by the diff view's card body and the woven overlay's inline band.
 *
 * It takes the base and target opaque data (widened to `unknown` on the reader side, so the editor's
 * `JsonValue` is assignable) plus the lifecycle status, and returns the rich visual (a code line
 * diff, a table cell grid, base/target thumbnails). It is injected, never imported — the reader
 * cannot reach the editor registry — so a host builds it from its node definitions and passes it to
 * `<DiffView>` and the band. A node without it degrades to its `diffData` field rows.
 */
export type NodeDiffRenderer = (args: {
  readonly base: unknown;
  readonly target: unknown;
  readonly status: "added" | "removed" | "changed";
}) => ReactNode;

/** Whether a node type supplies its own diff renderer (drives the tier override). */
function hasNodeRenderer(
  nodeType: string | undefined,
  getRenderer: ((type: string) => NodeDiffRenderer | undefined) | undefined,
): boolean {
  return Boolean(nodeType && getRenderer && getRenderer(nodeType));
}

/**
 * Classify one change to its disclosure tier (docs/039 §6.1) — the pure classifier.
 *
 * Returns the default-table tier for the kind, with one override: a node type that supplies a
 * `renderDiff` promotes its own `object.field`/`object.opaque` and inner `text.insert`/`text.delete`
 * to `band` (a code block routes its source edit to a line diff instead of weaving it into a live
 * editor). `object.opaque` is always `band` (a custom node is drilled into, never woven).
 */
export function tierOf(
  kind: ChangeKind,
  nodeType: string | undefined,
  getRenderer?: (type: string) => NodeDiffRenderer | undefined,
): DisclosureTier {
  const overridden = hasNodeRenderer(nodeType, getRenderer);
  switch (kind) {
    case "text.insert":
    case "text.delete":
      return overridden ? "band" : "woven";
    case "mark.add":
      return "woven";
    case "mark.remove":
    case "mark.change":
      return "marked";
    case "attr.block":
      return "marked";
    case "attr.element":
      // A scalar attr (a re-colored cell) is a one-line chip; a structured value (a `colWidths`
      // array) routes to the band via `elementDisclosure`, which can see the value — `tierOf` cannot.
      return "marked";
    case "object.field":
      return overridden ? "band" : "marked";
    case "object.opaque":
      return "band";
    case "block.add":
    case "block.remove":
      return "woven";
    case "block.move":
      return "marked";
    case "child.add":
    case "child.remove":
    case "child.move":
      return "woven";
    case "collection":
    case "settings":
      return "pane";
  }
}

/** A structured value (an array or a record): such an attr routes to the band, a scalar to the chip. */
function isStructuredValue(value: unknown): boolean {
  return Array.isArray(value) || isRecord(value);
}

/** Whether any attr value in the diff is a structured (array / object) value → the band. */
function hasStructuredAttr(attrs: ReaderBlockDiff["attrs"]): boolean {
  if (!attrs) return false;
  return (
    Object.values(attrs.added).some(isStructuredValue) ||
    Object.values(attrs.removed).some(isStructuredValue) ||
    Object.values(attrs.changed).some(
      (pair) => isStructuredValue(pair.base) || isStructuredValue(pair.target),
    )
  );
}

/**
 * Decide whether a ringed nested element opens a floating chip or an inline band (docs/039 §6.1,
 * §7.6, D5) — the convenience the woven ring affordance uses.
 *
 * An object with a `renderDiff` opens the `band` (its rich diff); an object without one, or a
 * scalar attr change (a re-colored cell), opens the one-line `chip`; a structured attr value (a
 * `colWidths` array) opens the `band`. This reads the `ReaderBlockDiff` directly, so it can see the
 * attr value that `tierOf` cannot.
 */
export function elementDisclosure(
  block: ReaderBlockDiff,
  getRenderer?: (type: string) => NodeDiffRenderer | undefined,
): "chip" | "band" {
  const type = block.node?.type;
  if (block.object) {
    // The object's disclosure is `tierOf`'s decision (object.field → band iff the node ships a
    // renderDiff, object.opaque → always band). Delegating keeps `tierOf` the single classifier both
    // surfaces read (§6.1) rather than a second copy of the same rule.
    return tierOf("object.field", type, getRenderer) === "band"
      ? "band"
      : "chip";
  }
  if (block.attrs) {
    // A structured attr value (a `colWidths` array) routes to the band — the one case `tierOf` cannot
    // see (it has no value), so `elementDisclosure` decides it; a scalar attr is `tierOf`'s
    // `attr.element` → `marked` → chip.
    if (hasStructuredAttr(block.attrs)) return "band";
    return tierOf("attr.element", type, getRenderer) === "band"
      ? "band"
      : "chip";
  }
  return "chip";
}
