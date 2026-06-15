// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

// The shared ResourceSelector picker is a React Aria ComboBox: focus opens the
// popover listbox, then options can be clicked.
async function pickFromCombo(name: RegExp, option: RegExp): Promise<void> {
  const combo = (await screen.findAllByRole("combobox", { name }))[0]!;
  await act(async () => {
    combo.focus();
    fireEvent.focus(combo);
  });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { RichTextEditor, type RichTextEditorDocument } from "@idco/editor";

function ControlledMediaEditor() {
  const [value, setValue] = useState<RichTextEditorDocument>({
    root: {
      children: [
        {
          alt: "",
          caption: "",
          mediaId: "media-1",
          type: "media",
        },
      ],
    },
  });
  return <RichTextEditor label="Body" value={value} onChange={setValue} />;
}

describe("RichTextEditor", () => {
  it("renders a Lexical textbox with formatting toolbar controls", () => {
    const onChange = vi.fn<(value: unknown) => void>();
    render(
      <RichTextEditor
        label="Body"
        value={{ root: { children: [] } }}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("textbox", { name: /^body$/i })).toHaveAttribute(
      "contenteditable",
      "true",
    );
    expect(
      screen.getByRole("toolbar", { name: /body formatting/i }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /bold/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /italic/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /more/i })).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("exposes icon-only formatting controls and a text-style picker", () => {
    render(
      <RichTextEditor
        label="Body"
        value={{ root: { children: [] } }}
        onChange={() => {}}
      />,
    );

    for (const name of [
      /^undo$/i,
      /^redo$/i,
      /^bold$/i,
      /^italic$/i,
      /^underline$/i,
      /^strikethrough$/i,
      /inline code/i,
      /bullet list/i,
      /numbered list/i,
      /text style/i,
    ]) {
      expect(screen.getByRole("button", { name })).toBeVisible();
    }
    // History buttons start disabled until there is something to undo/redo.
    expect(screen.getByRole("button", { name: /^undo$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^redo$/i })).toBeDisabled();
    // Formatting needs the editable to hold the selection; disabled until focused.
    expect(screen.getByRole("button", { name: /^bold$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /text style/i })).toBeDisabled();
  });

  it("round-trips quote and list blocks from the document value", () => {
    render(
      <RichTextEditor
        label="Body"
        onChange={() => {}}
        value={{
          root: {
            children: [
              { type: "quote", children: [{ type: "text", text: "Be bold" }] },
              {
                type: "list",
                listType: "bullet",
                children: [
                  {
                    type: "listitem",
                    children: [{ type: "text", text: "First item" }],
                  },
                  {
                    type: "listitem",
                    children: [{ type: "text", text: "Second item" }],
                  },
                ],
              },
            ],
          },
        }}
      />,
    );

    const body = screen.getByRole("textbox", { name: /^body$/i });
    expect(body).toHaveTextContent("Be bold");
    expect(body).toHaveTextContent("First item");
    expect(body).toHaveTextContent("Second item");
  });

  it("renders heading anchors by default and repairs duplicate ids", () => {
    const { container } = render(
      <RichTextEditor
        label="Body"
        onChange={() => {}}
        value={{
          root: {
            children: [
              {
                type: "heading",
                tag: "h2",
                children: [{ type: "text", text: "Overview" }],
              },
              {
                type: "heading",
                tag: "h3",
                anchorId: "overview",
                children: [{ type: "text", text: "Details" }],
              },
            ],
          },
        }}
      />,
    );

    expect(
      container.querySelector('[data-idco-heading-anchor="overview"]'),
    ).toHaveTextContent("Overview");
    expect(
      container.querySelector('[data-idco-heading-anchor="overview-2"]'),
    ).toHaveTextContent("Details");
  });

  it("adds starter nodes from the slash menu", async () => {
    const onChange = vi.fn<(value: unknown) => void>();
    render(
      <RichTextEditor
        label="Body"
        value={{ root: { children: [] } }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /code/i }));

    expect(
      await screen.findByRole("textbox", { name: /code content/i }),
    ).toHaveValue("const value = true;");
    // The language picker is an always-on chip in the block chrome.
    expect(
      screen.getByRole("button", { name: /code language/i }),
    ).toBeVisible();
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          root: {
            children: expect.arrayContaining([
              {
                language: "ts",
                text: "const value = true;",
                type: "code-block",
              },
            ]),
          },
        }),
      ),
    );
  });

  it("inserts a TOC block and stores only its settings", async () => {
    const onChange = vi.fn<(value: RichTextEditorDocument) => void>();
    render(
      <RichTextEditor
        label="Body"
        value={{
          root: {
            children: [
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
            ],
          },
        }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: /table of contents/i }),
    );

    expect(
      await screen.findByRole("navigation", { name: /table of contents/i }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: /install/i })).toHaveAttribute(
      "href",
      "#install",
    );
    await waitFor(() =>
      expect(
        onChange.mock.calls.some(([value]) =>
          value.root.children.some(
            (node) =>
              node.type === "table-of-contents" &&
              node.maxLevel === 4 &&
              node.minLevel === 1 &&
              node.numbering === "decimal" &&
              node.style === "plain" &&
              !("entries" in node),
          ),
        ),
      ).toBe(true),
    );
  });

  it("updates TOC numbering, max level, style, and title settings", async () => {
    const onChange = vi.fn<(value: RichTextEditorDocument) => void>();
    render(
      <RichTextEditor
        label="Body"
        value={{
          root: {
            children: [
              {
                type: "heading",
                tag: "h2",
                children: [{ type: "text", text: "Install" }],
              },
              {
                maxLevel: 3,
                minLevel: 1,
                numbering: "none",
                style: "panel",
                title: "Table of contents",
                type: "table-of-contents",
              },
            ],
          },
        }}
        onChange={onChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /table of contents settings/i }),
    );
    const settings = await screen.findByRole("dialog", {
      name: /table of contents settings/i,
    });

    fireEvent.click(
      within(settings).getByRole("button", { name: /numbering/i }),
    );
    fireEvent.click(await screen.findByRole("option", { name: /numbered/i }));
    fireEvent.click(
      within(settings).getByRole("button", { name: /maximum heading level/i }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "H2" }));
    fireEvent.click(within(settings).getByRole("button", { name: /style/i }));
    fireEvent.click(await screen.findByRole("option", { name: /compact/i }));
    fireEvent.change(
      within(settings).getByRole("textbox", { name: /title/i }),
      {
        target: { value: "On this page" },
      },
    );

    await waitFor(() =>
      expect(
        onChange.mock.calls.some(([value]) =>
          value.root.children.some(
            (node) =>
              node.type === "table-of-contents" &&
              node.numbering === "decimal" &&
              node.maxLevel === 2 &&
              node.style === "compact" &&
              node.title === "On this page",
          ),
        ),
      ).toBe(true),
    );
  });

  it("seeds column widths when inserting a table from the toolbar", async () => {
    const onChange = vi.fn<(value: unknown) => void>();
    render(
      <RichTextEditor
        label="Body"
        value={{ root: { children: [] } }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("textbox", { name: /^body$/i }));
    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^table$/i }));

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          root: {
            children: expect.arrayContaining([
              expect.objectContaining({
                colWidths: [120, 120, 120],
                layout: "responsive",
                type: "editor-table",
              }),
            ]),
          },
        }),
      ),
    );
    const toolbar = screen.getByRole("toolbar", { name: /body formatting/i });
    expect(
      within(toolbar).queryByRole("button", { name: /delete row/i }),
    ).toBeNull();
    expect(
      within(toolbar).queryByRole("button", { name: /delete column/i }),
    ).toBeNull();
  });

  it("hides node actions that are not allowed", () => {
    render(
      <RichTextEditor
        allowedNodes={["paragraph", "text"]}
        label="Body"
        value={{ root: { children: [] } }}
        onChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    expect(screen.queryByRole("menuitem", { name: /code/i })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /paragraph/i })).toBeVisible();
  });

  it("edits a media node with a product-provided media library", async () => {
    const onChange = vi.fn<(value: unknown) => void>();
    render(
      <RichTextEditor
        label="Body"
        value={{ root: { children: [] } }}
        onChange={onChange}
        mediaLibrary={{
          load: async () => [{ id: "media-1", label: "Cover image" }],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /media/i }));
    await pickFromCombo(/pick from media library/i, /cover/i);

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          root: {
            children: expect.arrayContaining([
              {
                alt: "",
                caption: "",
                mediaId: "media-1",
                type: "media",
              },
            ]),
          },
        }),
      ),
    );
  });

  it("edits callout, embed, and post reference nodes", async () => {
    const onChange = vi.fn<(value: unknown) => void>();
    render(
      <RichTextEditor
        allowedEmbedDomains={["example.com"]}
        label="Body"
        value={{ root: { children: [] } }}
        onChange={onChange}
        postLibrary={{
          load: async () => [
            {
              href: "/posts/referenced-post",
              id: "post-1",
              label: "Referenced post",
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /callout/i }));
    fireEvent.change(
      await screen.findByRole("textbox", { name: /callout text/i }),
      {
        target: { value: "Check this" },
      },
    );

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          root: {
            children: expect.arrayContaining([
              expect.objectContaining({
                children: expect.arrayContaining([
                  expect.objectContaining({
                    text: "Check this",
                    type: "text",
                  }),
                ]),
                tone: "info",
                type: "callout",
              }),
            ]),
          },
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /embed/i }));
    const embedUrl = await screen.findByRole("textbox", { name: /embed url/i });
    expect(embedUrl).not.toHaveClass("input-error");
    fireEvent.change(embedUrl, {
      target: { value: "https://evil.test/embed" },
    });
    await waitFor(() => expect(embedUrl).toHaveClass("input-error"));

    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /post ref/i }));
    await pickFromCombo(/referenced post/i, /referenced post/i);

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          root: {
            children: expect.arrayContaining([
              expect.objectContaining({
                postId: "post-1",
                title: "Referenced post",
                type: "post-ref",
                url: "/posts/referenced-post",
              }),
            ]),
          },
        }),
      ),
    );
  });

  it("does not expose raw media id inputs for upload-only media nodes", async () => {
    render(
      <RichTextEditor
        label="Body"
        value={{ root: { children: [] } }}
        onChange={() => {}}
        onUploadMedia={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /media/i }));

    expect(await screen.findByText("Upload a new image")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /media id/i })).toBeNull();
  });

  it("renders a live iframe preview for an allowed embed URL", async () => {
    render(
      <RichTextEditor
        allowedEmbedDomains={["www.youtube.com"]}
        label="Body"
        value={{ root: { children: [] } }}
        onChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /embed/i }));
    fireEvent.change(
      await screen.findByRole("textbox", { name: /embed url/i }),
      { target: { value: "https://www.youtube.com/embed/abc" } },
    );

    const frame = await screen.findByTitle("Embedded preview");
    expect(frame).toHaveAttribute("src", "https://www.youtube.com/embed/abc");
  });

  it("renders a live image preview when media is picked", async () => {
    render(
      <RichTextEditor
        label="Body"
        value={{ root: { children: [] } }}
        onChange={() => {}}
        mediaLibrary={{
          load: async () => [
            {
              alt: "Cover",
              id: "media-1",
              label: "Cover image",
              previewUrl: "https://cdn.test/cover.png",
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /media/i }));
    await pickFromCombo(/pick from media library/i, /cover/i);

    const image = await screen.findByRole("img", { name: /cover/i });
    expect(image).toHaveAttribute("src", "https://cdn.test/cover.png");
  });

  it("removes a custom block via its remove control", async () => {
    render(
      <RichTextEditor
        label="Body"
        value={{ root: { children: [] } }}
        onChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /callout/i }));
    expect(
      await screen.findByRole("textbox", { name: /callout text/i }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /remove callout/i }));

    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: /callout text/i }),
      ).toBeNull(),
    );
  });

  it("keeps custom node inputs focused while controlled value updates", async () => {
    render(<ControlledMediaEditor />);

    const altInput = await screen.findByRole("textbox", {
      name: /media alt text/i,
    });
    altInput.focus();
    fireEvent.change(altInput, { target: { value: "Cover" } });

    await waitFor(() => expect(altInput).toHaveValue("Cover"));
    expect(document.activeElement).toBe(altInput);
  });
});
