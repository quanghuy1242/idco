/**
 * `tierOf` + `elementDisclosure` (docs/039 §6.1) — the pure change classifier and the ring-affordance
 * chip/band decision. These pin the §6.1 default table and the node-`renderDiff` override.
 */
import { describe, expect, it } from "vitest";
import {
  elementDisclosure,
  tierOf,
  type NodeDiffRenderer,
  type ReaderBlockDiff,
} from "@quanghuy1242/idco-reader";

const renderer: NodeDiffRenderer = () => null;
const withRenderer = (type: string) => (type === "code" ? renderer : undefined);

describe("tierOf", () => {
  it("maps the default table", () => {
    expect(tierOf("text.insert", "paragraph")).toBe("woven");
    expect(tierOf("text.delete", "paragraph")).toBe("woven");
    expect(tierOf("mark.add", "paragraph")).toBe("woven");
    expect(tierOf("mark.remove", "paragraph")).toBe("marked");
    expect(tierOf("mark.change", "paragraph")).toBe("marked");
    expect(tierOf("attr.block", "paragraph")).toBe("marked");
    expect(tierOf("attr.element", "tablecell")).toBe("marked");
    expect(tierOf("object.field", "image")).toBe("marked");
    expect(tierOf("object.opaque", "mermaid")).toBe("band");
    expect(tierOf("block.add", undefined)).toBe("woven");
    expect(tierOf("block.remove", undefined)).toBe("woven");
    expect(tierOf("block.move", undefined)).toBe("marked");
    expect(tierOf("child.add", "table")).toBe("woven");
    expect(tierOf("child.remove", "table")).toBe("woven");
    expect(tierOf("child.move", "table")).toBe("woven");
    expect(tierOf("collection", undefined)).toBe("pane");
    expect(tierOf("settings", undefined)).toBe("pane");
  });

  it("promotes a node with a renderDiff to the band for its own text and object changes", () => {
    expect(tierOf("text.insert", "code", withRenderer)).toBe("band");
    expect(tierOf("text.delete", "code", withRenderer)).toBe("band");
    expect(tierOf("object.field", "code", withRenderer)).toBe("band");
    // A node without a renderer keeps the default tier.
    expect(tierOf("text.insert", "image", withRenderer)).toBe("woven");
    expect(tierOf("object.field", "image", withRenderer)).toBe("marked");
  });
});

const objectBlock = (type: string): ReaderBlockDiff =>
  ({
    node: { type },
    object: { statusChanged: false },
    status: "changed",
  }) as unknown as ReaderBlockDiff;

const attrBlock = (
  changed: Record<string, { base: unknown; target: unknown }>,
): ReaderBlockDiff =>
  ({
    attrs: { added: {}, changed, removed: {} },
    node: { type: "tablecell" },
    status: "changed",
  }) as unknown as ReaderBlockDiff;

describe("elementDisclosure", () => {
  it("opens the band for an object with a renderDiff, else the chip", () => {
    expect(elementDisclosure(objectBlock("code"), withRenderer)).toBe("band");
    expect(elementDisclosure(objectBlock("image"), withRenderer)).toBe("chip");
    expect(elementDisclosure(objectBlock("image"))).toBe("chip");
  });

  it("opens the band for a structured attr value, the chip for a scalar", () => {
    expect(
      elementDisclosure(attrBlock({ fill: { base: "red", target: "green" } })),
    ).toBe("chip");
    expect(
      elementDisclosure(
        attrBlock({ colWidths: { base: [150, 220], target: [150, 220, 180] } }),
      ),
    ).toBe("band");
  });
});
