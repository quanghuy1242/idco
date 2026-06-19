/**
 * Block-style invariants that prevent the React inline-style shorthand/longhand
 * reconciliation bug (docs/010 §14 hardening).
 *
 * The text block is restyled across renders (`blockStyleFor` returns a different
 * shape for paragraph vs list item vs indented). React clears a now-absent
 * *longhand* (`paddingTop`) by writing `""` *after* a *shorthand* (`padding`), so
 * a block flipping listitem→paragraph would collapse its top padding to 0 if the
 * styles mixed a shorthand with its longhands. These tests lock the rule in even
 * against an `as`-cast that bypasses the `LonghandBlockStyle` type guard.
 */
import { describe, expect, it } from "vitest";
import {
  blockStyle,
  blockStyleFor,
} from "../../packages/editor/src/view/styles";

/** Box-model shorthands that must never appear on a dynamically-restyled block. */
const BANNED_SHORTHANDS = [
  "padding",
  "margin",
  "border",
  "font",
  "inset",
  "gap",
] as const;

/** The padding longhands every variant must define so transitions reset cleanly. */
const PADDING_LONGHANDS = [
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
] as const;

const VARIANTS: readonly { type: string; attrs?: Record<string, unknown> }[] = [
  { type: "paragraph" },
  { type: "heading", attrs: { tag: "h2" } },
  { type: "quote" },
  { type: "listitem" },
  { type: "listitem", attrs: { indent: 2 } },
  { type: "paragraph", attrs: { indent: 3 } },
];

describe("block style invariants (docs/010 §14)", () => {
  it("blockStyle declares longhands only — no box-model shorthand", () => {
    for (const key of BANNED_SHORTHANDS) {
      expect({ key, present: key in blockStyle }).toEqual({
        key,
        present: false,
      });
    }
  });

  it("blockStyleFor never emits a box-model shorthand for any node variant", () => {
    for (const variant of VARIANTS) {
      const style = blockStyleFor(variant) as Record<string, unknown>;
      for (const key of BANNED_SHORTHANDS) {
        expect({ type: variant.type, key, present: key in style }).toEqual({
          type: variant.type,
          key,
          present: false,
        });
      }
    }
  });

  it("every variant defines all four padding longhands so listitem↔paragraph toggles diff cleanly", () => {
    for (const variant of VARIANTS) {
      const style = blockStyleFor(variant) as Record<string, unknown>;
      for (const key of PADDING_LONGHANDS) {
        expect({ type: variant.type, key, present: key in style }).toEqual({
          type: variant.type,
          key,
          present: true,
        });
      }
    }
  });
});
