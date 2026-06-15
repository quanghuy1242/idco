import { describe, expect, it } from "vitest";
import {
  collectRichTextTocEntries,
  ensureRichTextHeadingAnchors,
  normalizeTocSettings,
  slugifyHeadingAnchor,
} from "@quanghuy1242/idco-lib";

const mkHeading = (tag: string, text: string) => ({
  type: "heading",
  tag,
  children: [{ type: "text", text }],
});

/** Build a TOC from `[tag, text]` heading pairs and project to `[text, number, depth]`. */
const tocShape = (
  headings: readonly (readonly [string, string])[],
  settings: Parameters<typeof collectRichTextTocEntries>[1],
) =>
  collectRichTextTocEntries(
    { root: { children: headings.map(([tag, text]) => mkHeading(tag, text)) } },
    settings,
  ).map((entry) => [entry.text, entry.number, entry.depth]);

describe("rich-text heading anchors and TOC helpers", () => {
  it("slugifies heading text for URL anchors", () => {
    expect(slugifyHeadingAnchor("Déjà Vu: Heading!")).toBe("deja-vu-heading");
    expect(slugifyHeadingAnchor("")).toBe("section");
  });

  it("allocates missing and duplicate heading anchors deterministically", () => {
    const document = ensureRichTextHeadingAnchors({
      root: {
        children: [
          {
            type: "heading",
            tag: "h2",
            children: [{ type: "text", text: "Overview" }],
          },
          {
            type: "heading",
            tag: "h2",
            anchorId: "overview",
            children: [{ type: "text", text: "Renamed" }],
          },
          {
            type: "heading",
            tag: "h3",
            children: [{ type: "text", text: "" }],
          },
        ],
      },
    });

    expect(document.root.children?.map((node) => node.anchorId)).toEqual([
      "overview",
      "overview-2",
      "section",
    ]);
  });

  it("collects filtered numbered TOC entries from the current document tree", () => {
    const entries = collectRichTextTocEntries(
      {
        root: {
          children: [
            {
              type: "heading",
              tag: "h1",
              children: [{ type: "text", text: "Skipped" }],
            },
            {
              type: "heading",
              tag: "h2",
              children: [{ type: "text", text: "Install" }],
            },
            {
              type: "heading",
              tag: "h3",
              children: [{ type: "text", text: "Configure" }],
            },
            {
              type: "heading",
              tag: "h2",
              children: [{ type: "text", text: "Deploy" }],
            },
            {
              type: "heading",
              tag: "h4",
              children: [{ type: "text", text: "Too deep" }],
            },
            { type: "table-of-contents", title: "Ignored" },
          ],
        },
      },
      { minLevel: 2, maxLevel: 3, numbering: "decimal" },
    );

    expect(
      entries.map((entry) => [entry.text, entry.href, entry.number]),
    ).toEqual([
      ["Install", "#install", "1"],
      ["Configure", "#configure", "1.1"],
      ["Deploy", "#deploy", "2"],
    ]);
  });

  describe("TOC numbering and depth", () => {
    const decimal = { minLevel: 2, maxLevel: 3, numbering: "decimal" } as const;

    it("indents by heading level relative to minLevel (h3 sits under h2)", () => {
      expect(
        tocShape(
          [
            ["h2", "A"],
            ["h3", "A.1"],
            ["h3", "A.2"],
            ["h2", "B"],
            ["h3", "B.1"],
          ],
          decimal,
        ),
      ).toEqual([
        ["A", "1", 0],
        ["A.1", "1.1", 1],
        ["A.2", "1.2", 1],
        ["B", "2", 0],
        ["B.1", "2.1", 1],
      ]);
    });

    it("nests headings under a single h1 as the relative outline root", () => {
      // h1 -> h3 -> h2 -> h3 -> h2: the lone h1 is the root; the first h3 and
      // the h2 are both its children at the same depth, and the second h3 nests
      // under that h2. Depth follows the relative outline, not absolute level.
      expect(
        tocShape(
          [
            ["h1", "Introduction"],
            ["h3", "Introduction details"],
            ["h2", "Getting started"],
            ["h3", "Getting started details"],
            ["h2", "Configuration"],
          ],
          { minLevel: 1, maxLevel: 3, numbering: "decimal" },
        ),
      ).toEqual([
        ["Introduction", "1", 0],
        ["Introduction details", "1.1", 1],
        ["Getting started", "1.2", 1],
        ["Getting started details", "1.2.1", 2],
        ["Configuration", "1.3", 1],
      ]);
    });

    it("promotes a deep heading to the top when its parent level is filtered out", () => {
      // With minLevel 2 the h1 is excluded, so the h3 that followed it has no
      // in-range parent and becomes a top-level entry; numbering stays
      // continuous with no duplicates.
      expect(
        tocShape(
          [
            ["h1", "Introduction"],
            ["h3", "Introduction details"],
            ["h2", "Getting started"],
            ["h3", "Getting started details"],
            ["h2", "Configuration"],
          ],
          decimal,
        ),
      ).toEqual([
        ["Introduction details", "1", 0],
        ["Getting started", "2", 0],
        ["Getting started details", "2.1", 1],
        ["Configuration", "3", 0],
      ]);
    });

    it("keeps numbering continuous for consecutive deep headings before any shallower one", () => {
      expect(
        tocShape(
          [
            ["h3", "Solo one"],
            ["h3", "Solo two"],
            ["h2", "First section"],
            ["h3", "First section details"],
          ],
          decimal,
        ),
      ).toEqual([
        ["Solo one", "1", 0],
        ["Solo two", "2", 0],
        ["First section", "3", 0],
        ["First section details", "3.1", 1],
      ]);
    });

    it("compacts a skipped level so a lone deep child nests one step under its parent", () => {
      expect(
        tocShape(
          [
            ["h2", "Top"],
            ["h4", "Jumps to h4"],
            ["h2", "Next top"],
          ],
          { minLevel: 2, maxLevel: 4, numbering: "decimal" },
        ),
      ).toEqual([
        ["Top", "1", 0],
        ["Jumps to h4", "1.1", 1],
        ["Next top", "2", 0],
      ]);
    });

    it("restarts deeper counters after stepping back to a shallower heading", () => {
      expect(
        tocShape(
          [
            ["h2", "A"],
            ["h3", "A.1"],
            ["h3", "A.2"],
            ["h2", "B"],
            ["h3", "B.1"],
            ["h2", "C"],
          ],
          decimal,
        ).map(([, number]) => number),
      ).toEqual(["1", "1.1", "1.2", "2", "2.1", "3"]);
    });

    it("supports three numbered levels when the range allows", () => {
      expect(
        tocShape(
          [
            ["h2", "A"],
            ["h3", "A.1"],
            ["h4", "A.1.a"],
            ["h4", "A.1.b"],
            ["h3", "A.2"],
            ["h2", "B"],
          ],
          { minLevel: 2, maxLevel: 4, numbering: "decimal" },
        ),
      ).toEqual([
        ["A", "1", 0],
        ["A.1", "1.1", 1],
        ["A.1.a", "1.1.1", 2],
        ["A.1.b", "1.1.2", 2],
        ["A.2", "1.2", 1],
        ["B", "2", 0],
      ]);
    });

    it("respects a minLevel of 1 so h1 is the top level", () => {
      expect(
        tocShape(
          [
            ["h1", "Title"],
            ["h2", "Section"],
            ["h3", "Sub"],
          ],
          { minLevel: 1, maxLevel: 3, numbering: "decimal" },
        ),
      ).toEqual([
        ["Title", "1", 0],
        ["Section", "1.1", 1],
        ["Sub", "1.1.1", 2],
      ]);
    });

    it("excludes headings outside the level range", () => {
      expect(
        tocShape(
          [
            ["h1", "Excluded shallow"],
            ["h2", "Kept"],
            ["h3", "Kept deeper"],
            ["h4", "Excluded deep"],
          ],
          decimal,
        ).map(([text]) => text),
      ).toEqual(["Kept", "Kept deeper"]);
    });

    it("keeps depth but omits numbers when numbering is none", () => {
      expect(
        tocShape(
          [
            ["h2", "A"],
            ["h3", "A.1"],
            ["h2", "B"],
          ],
          { minLevel: 2, maxLevel: 3, numbering: "none" },
        ),
      ).toEqual([
        ["A", undefined, 0],
        ["A.1", undefined, 1],
        ["B", undefined, 0],
      ]);
    });

    it("falls back to a placeholder for empty heading text", () => {
      expect(tocShape([["h2", "   "]], decimal).map(([text]) => text)).toEqual([
        "Untitled section",
      ]);
    });
  });

  it("normalizes malformed TOC settings to safe defaults", () => {
    expect(
      normalizeTocSettings({
        maxLevel: 2,
        minLevel: 4,
        numbering: "weird",
        style: "giant",
        title: "",
        placement: "sidebar",
        side: "top",
      }),
    ).toEqual({
      maxLevel: 4,
      minLevel: 2,
      numbering: "decimal",
      placement: "inline",
      side: "left",
      style: "plain",
      title: "Table of contents",
    });
  });

  it("defaults TOC placement to inline / left and preserves valid aside settings", () => {
    expect(normalizeTocSettings(undefined)).toMatchObject({
      placement: "inline",
      side: "left",
    });
    expect(
      normalizeTocSettings({ placement: "aside", side: "right" }),
    ).toMatchObject({ placement: "aside", side: "right" });
  });
});
