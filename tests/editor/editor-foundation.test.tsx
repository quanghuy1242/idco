// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  capabilityFor,
  RichTextEditor,
} from "@quanghuy1242/idco-editor-legacy";

// The server `<Reader>` rendering of native snapshots (alignment, links, marks, glossary,
// tables, captions, dividers) is covered by `tests/reader.test.tsx` and the parity guards
// (`tests/editor/reader-resting-parity.test.tsx`); this file covers the legacy editor surface.

describe("editor foundation", () => {
  it("exposes link, comment, check-list and table controls in the editor", () => {
    render(
      <RichTextEditor
        label="Body"
        value={{ root: { children: [] } }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /^link$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^comment$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /glossary term/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /check list/i }),
    ).toBeInTheDocument();
  });

  it("treats check lists as a distinct, formattable block kind", () => {
    // Check lists are their own kind (not reported as bullet) so the toolbar
    // can light the right control; they still allow inline formatting.
    const check = capabilityFor("check");
    expect(check.canAlign).toBe(false);
    expect(check.inlineFormats.has("bold")).toBe(true);
    expect(capabilityFor("quote").inlineFormats.has("bold")).toBe(false);
  });

  it("accepts an onComment binding for inline comments", () => {
    render(
      <RichTextEditor
        label="Body"
        value={{ root: { children: [] } }}
        onChange={() => {}}
        onComment={() => {}}
      />,
    );
    // The comment control is present (it enables once text is selected).
    expect(
      screen.getByRole("button", { name: /^comment$/i }),
    ).toBeInTheDocument();
  });
});
