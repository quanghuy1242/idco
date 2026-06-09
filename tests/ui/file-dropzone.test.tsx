// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileDropzone } from "@idco/ui";

function fileInputOf(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

describe("FileDropzone", () => {
  it("renders the label, browse button, and hint", () => {
    render(
      <FileDropzone
        label="Upload CSV"
        onFiles={() => {}}
        hint="content,scope,description"
      />,
    );
    expect(screen.getByText("Upload CSV")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /browse files/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("content,scope,description")).toBeInTheDocument();
  });

  it("calls onFiles when a file is selected", () => {
    const onFiles = vi.fn<(files: File[]) => void>();
    const { container } = render(
      <FileDropzone
        label="Upload CSV"
        accept={["text/csv"]}
        onFiles={onFiles}
      />,
    );
    const file = new File(["a,b,c"], "data.csv", { type: "text/csv" });
    fireEvent.change(fileInputOf(container), { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0][0].name).toBe("data.csv");
  });

  it("rejects files over the max size and does not call onFiles", () => {
    const onFiles = vi.fn<(files: File[]) => void>();
    const { container } = render(
      <FileDropzone
        label="Upload CSV"
        accept={["text/csv"]}
        maxSizeBytes={2}
        onFiles={onFiles}
      />,
    );
    const file = new File(["too large"], "data.csv", { type: "text/csv" });
    fireEvent.change(fileInputOf(container), { target: { files: [file] } });
    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/maximum size/i);
  });

  it("rejects files of an unsupported type", () => {
    const onFiles = vi.fn<(files: File[]) => void>();
    const { container } = render(
      <FileDropzone label="Upload CSV" accept={[".csv"]} onFiles={onFiles} />,
    );
    const file = new File(["x"], "data.png", { type: "image/png" });
    fireEvent.change(fileInputOf(container), { target: { files: [file] } });
    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/unsupported type/i);
  });

  it("renders a drop target region", () => {
    const { container } = render(
      <FileDropzone label="Upload CSV" onFiles={() => {}} />,
    );
    expect(container.querySelector(".border-dashed")).toBeInTheDocument();
  });
});
