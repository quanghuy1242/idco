/**
 * Built-in per-node diff renderers + their resolver (docs/039 §8, P3).
 *
 * The per-node diff SPI ({@link NodeDiffRenderer}, defined in the reader so `<DiffView>` can read it
 * without importing the editor) lets an OBJECT node render its own diff — a real code line diff, a
 * custom node's own before/after — in place of the truncated `diffData` field rows. These renderers
 * live in the VIEW layer, not the framework-free `core` (which stays worker-safe and React-free), and
 * a host wires them into `<DiffView getNodeDiffRenderer=...>` and the woven overlay's inline band via
 * {@link nodeDiffRendererResolver}. A type with no renderer resolves to `undefined`, and the diff view
 * degrades to its `diffData` field rows — the documented fallback (docs/039 §8).
 *
 * Scope: the code block (its source is opaque piece-table data the field rows only truncate) ships
 * here as the concrete reference. Structural nodes (a table) already diff through the reader's
 * structural recursion (changed cells decorate inline), so they are not object-SPI renderers; a custom
 * object node (mermaid, calc) ships its own renderer and registers it through the resolver's `extra`
 * map (docs/039 §16 / §8 contract).
 *
 * @categoryDefault Inline Review
 */
import type { CSSProperties, ReactNode } from "react";
import { isRecord } from "@quanghuy1242/idco-lib";
import type { NodeDiffRenderer } from "@quanghuy1242/idco-reader";
import { diffSequences, pieceTableText } from "../../core";

/**
 * @categoryDefault Inline Review
 */

/** The code block's registered object type (`core/registry/object-registry.ts`). */
const CODE_BLOCK_TYPE = "code-block";

/** Resolve a code block's opaque data to its flat source (its `code` field is a piece table). */
function codeSource(data: unknown): string {
  return isRecord(data) ? pieceTableText(data.code) : "";
}

const PRE: CSSProperties = {
  background:
    "color-mix(in oklab, var(--color-base-content, #171717) 3%, transparent)",
  borderRadius: "0.375rem",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
  margin: "0.35rem 0 0",
  overflowX: "auto",
  padding: "0.4rem 0",
  whiteSpace: "pre",
};

const LINE: CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  padding: "0 0.6rem",
};
const GUTTER: CSSProperties = {
  color:
    "color-mix(in oklab, var(--color-base-content, currentColor) 45%, transparent)",
  flex: "0 0 auto",
  userSelect: "none",
  width: "1ch",
};
const INS_LINE: CSSProperties = {
  ...LINE,
  background:
    "color-mix(in oklab, var(--color-success, #16a34a) 14%, transparent)",
};
const DEL_LINE: CSSProperties = {
  ...LINE,
  background:
    "color-mix(in oklab, var(--color-error, #dc2626) 12%, transparent)",
  color:
    "color-mix(in oklab, var(--color-base-content, currentColor) 60%, transparent)",
  textDecoration: "line-through",
  textDecorationColor:
    "color-mix(in oklab, var(--color-error, #dc2626) 55%, currentColor)",
};

/**
 * The code block's per-node diff renderer (docs/039 §8) — a real unified LINE diff of its source.
 *
 * Replaces the truncated `code: const x =…  →  const y =…` field row with a real diff: resolves both
 * sides' piece-table source to strings, splits on newlines, and aligns them with the engine's own
 * `diffSequences` (the same Myers LCS the block diff uses) — no second diff algorithm. Kept lines
 * render plain, inserts get a green wash with a `+` gutter, deletes a red struck wash with a `−`. Pure
 * and hookless, so it is RSC-safe and renders identically in the diff view card and the woven band.
 *
 * @category Inline Review
 */
export function codeBlockDiffRenderer(args: {
  readonly base: unknown;
  readonly target: unknown;
  readonly status: "added" | "removed" | "changed";
}): ReactNode {
  const { base, target } = args;
  const ops = diffSequences(
    codeSource(base).split("\n"),
    codeSource(target).split("\n"),
    (line) => line,
  );
  return (
    <pre data-engine-code-diff="" style={PRE}>
      {ops.map((op, index) => {
        const text = op.op === "delete" ? (op.base ?? "") : (op.target ?? "");
        const sign = op.op === "insert" ? "+" : op.op === "delete" ? "−" : " ";
        const style =
          op.op === "insert" ? INS_LINE : op.op === "delete" ? DEL_LINE : LINE;
        return (
          <div key={index} style={style}>
            <span aria-hidden="true" style={GUTTER}>
              {sign}
            </span>
            <span>{text === "" ? "​" : text}</span>
          </div>
        );
      })}
    </pre>
  );
}

/** The built-in per-node diff renderers, keyed by object type. */
const BUILTIN_NODE_DIFF_RENDERERS: ReadonlyMap<string, NodeDiffRenderer> =
  new Map([[CODE_BLOCK_TYPE, codeBlockDiffRenderer]]);

/**
 * Build the `getNodeDiffRenderer` resolver for `<DiffView>` and the woven inline band (docs/039 §8).
 *
 * Returns `(type) => NodeDiffRenderer | undefined`, resolving the caller's `extra` map first (a host's
 * custom node renderers — mermaid, calc), then the built-ins (the code block). A type with no renderer
 * returns `undefined`, so the diff view falls back to its `diffData` field rows — the degrade path. Pass
 * the result to `<DiffView getNodeDiffRenderer={nodeDiffRendererResolver()} />` and the same to the band.
 *
 * @category Inline Review
 */
export function nodeDiffRendererResolver(
  extra?: ReadonlyMap<string, NodeDiffRenderer>,
): (type: string) => NodeDiffRenderer | undefined {
  return (type) => extra?.get(type) ?? BUILTIN_NODE_DIFF_RENDERERS.get(type);
}
