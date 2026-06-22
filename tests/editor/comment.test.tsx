// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  RichTextEditor,
  type RichTextEditorComment,
  type RichTextEditorDocument,
} from "@quanghuy1242/idco-editor-legacy";

// A document whose paragraph already carries a comment mark (highlight) on the
// word "intro" — the shape the host stores once a comment is added.
const seeded: RichTextEditorDocument = {
  root: {
    children: [
      {
        type: "paragraph",
        children: [
          { type: "text", text: "Centered " },
          {
            type: "mark",
            ids: ["c1"],
            children: [{ type: "text", text: "intro" }],
          },
          { type: "text", text: " paragraph" },
        ],
      },
    ],
  },
};

function Harness({
  onUpdate,
  onDelete,
}: {
  readonly onUpdate: (id: string, body: string) => void;
  readonly onDelete: (id: string) => void;
}) {
  const [value, setValue] = useState<RichTextEditorDocument>(seeded);
  const [comments, setComments] = useState<RichTextEditorComment[]>([
    { id: "c1", quote: "intro", body: "Needs a citation" },
  ]);
  return (
    <RichTextEditor
      label="Body"
      value={value}
      onChange={setValue}
      comments={comments}
      onCommentUpdate={(id, body) => {
        onUpdate(id, body);
        setComments((current) =>
          current.map((comment) =>
            comment.id === id ? { ...comment, body } : comment,
          ),
        );
      }}
      onCommentDelete={(id) => {
        onDelete(id);
        setComments((current) =>
          current.filter((comment) => comment.id !== id),
        );
      }}
    />
  );
}

const updateSpy = () => vi.fn<(id: string, body: string) => void>();
const deleteSpy = () => vi.fn<(id: string) => void>();

describe("comment highlights", () => {
  it("opens the thread body when a highlight is clicked", async () => {
    render(<Harness onUpdate={updateSpy()} onDelete={deleteSpy()} />);

    const mark = document.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark).toHaveTextContent("intro");

    fireEvent.click(mark!);

    expect(
      await screen.findByRole("textbox", { name: /comment text/i }),
    ).toHaveValue("Needs a citation");
  });

  it("saves an edited comment body through onCommentUpdate", async () => {
    const onUpdate = updateSpy();
    render(<Harness onUpdate={onUpdate} onDelete={deleteSpy()} />);

    fireEvent.click(document.querySelector("mark")!);
    const textarea = await screen.findByRole("textbox", {
      name: /comment text/i,
    });
    fireEvent.change(textarea, { target: { value: "Add the source" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(onUpdate).toHaveBeenCalledWith("c1", "Add the source");
  });

  it("removes the highlight and notifies the host on delete", async () => {
    const onDelete = deleteSpy();
    render(<Harness onUpdate={updateSpy()} onDelete={onDelete} />);

    fireEvent.click(document.querySelector("mark")!);
    await screen.findByRole("textbox", { name: /comment text/i });
    fireEvent.click(screen.getByRole("button", { name: /delete comment/i }));

    expect(onDelete).toHaveBeenCalledWith("c1");
    // The mark is unwrapped, so the highlight is gone but the text remains.
    await waitFor(() => expect(document.querySelector("mark")).toBeNull());
    expect(screen.getByRole("textbox", { name: /^body$/i })).toHaveTextContent(
      "Centered intro paragraph",
    );
  });
});
