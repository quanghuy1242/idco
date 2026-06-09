// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog, TextInput } from "@idco/ui";

describe("ConfirmDialog", () => {
  it("submits child form fields as FormData", async () => {
    const onConfirm = vi.fn<(formData: FormData) => void>();

    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Create User"
        confirmLabel="Create"
        onConfirm={onConfirm}
      >
        <TextInput label="Name" name="name" />
      </ConfirmDialog>,
    );

    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    const formData = onConfirm.mock.calls[0][0];
    expect(formData.get("name")).toBe("Ada Lovelace");
  });

  it("uses the danger button variant when requested", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete User"
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: /delete/i })).toHaveClass(
      "btn-error",
    );
  });

  it("renders API errors inside the dialog", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Create User"
        confirmLabel="Create"
        error="Email already exists"
        onConfirm={() => false}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Email already exists");
  });

  it("keeps the dialog open when submit returns false", async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();

    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Create User"
        confirmLabel="Create"
        onConfirm={() => false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });
  });

  it("keeps the backdrop dimmed while applying the active theme to the dialog panel", () => {
    document.documentElement.setAttribute("data-theme", "idco-light");

    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Create User"
        confirmLabel="Create"
        onConfirm={() => {}}
      />,
    );

    expect(document.querySelector(".modal")).toHaveClass("bg-black/40");
    expect(document.querySelector(".modal")).not.toHaveAttribute("data-theme");
    expect(document.querySelector(".modal-box")).toHaveAttribute(
      "data-theme",
      "idco-light",
    );
  });
});
