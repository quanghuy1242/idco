// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ThemeDialog, applyTheme, getStoredTheme } from "@idco/ui";

describe("ThemeDialog", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.body.removeAttribute("data-theme");
    vi.restoreAllMocks();
  });

  it("renders closed without visible content", () => {
    render(<ThemeDialog open={false} onOpenChange={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders options when open", () => {
    render(<ThemeDialog open onOpenChange={() => {}} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByLabelText("System")).toBeInTheDocument();
    expect(screen.getByLabelText("Light")).toBeInTheDocument();
    expect(screen.getByLabelText("Dark")).toBeInTheDocument();
  });

  it("selects stored theme on open", async () => {
    localStorage.setItem("idco-theme", "dark");

    render(<ThemeDialog open onOpenChange={() => {}} />);

    await waitFor(() => {
      const darkInput = screen.getByLabelText("Dark") as HTMLInputElement;
      expect(darkInput.checked).toBe(true);
    });
  });

  it("defaults to system when no stored theme", async () => {
    render(<ThemeDialog open onOpenChange={() => {}} />);

    await waitFor(() => {
      const systemInput = screen.getByLabelText("System") as HTMLInputElement;
      expect(systemInput.checked).toBe(true);
    });
  });

  it("applies selected theme on Apply", async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    document.documentElement.setAttribute("data-theme", "idco-light");
    document.body.setAttribute("data-theme", "idco-light");

    render(<ThemeDialog open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByLabelText("Dark"));
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe(
        "idco-dark",
      );
      expect(document.body.getAttribute("data-theme")).toBe("idco-dark");
      expect(localStorage.getItem("idco-theme")).toBe("dark");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("closes on Cancel without applying", async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    document.documentElement.setAttribute("data-theme", "idco-light");
    document.body.setAttribute("data-theme", "idco-light");

    render(<ThemeDialog open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByLabelText("Dark"));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe(
        "idco-light",
      );
      expect(document.body.getAttribute("data-theme")).toBe("idco-light");
      expect(localStorage.getItem("idco-theme")).toBeNull();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("applies light theme via applyTheme utility", () => {
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe(
      "idco-light",
    );
    expect(document.body.getAttribute("data-theme")).toBe("idco-light");
    expect(localStorage.getItem("idco-theme")).toBe("light");
  });

  it("applies dark theme via applyTheme utility", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe(
      "idco-dark",
    );
    expect(document.body.getAttribute("data-theme")).toBe("idco-dark");
    expect(localStorage.getItem("idco-theme")).toBe("dark");
  });

  it("applies system theme via applyTheme utility", () => {
    document.documentElement.setAttribute("data-theme", "idco-dark");
    document.body.setAttribute("data-theme", "idco-dark");
    applyTheme("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(document.body.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("idco-theme")).toBe("system");
  });

  it("getStoredTheme returns stored preference", () => {
    localStorage.setItem("idco-theme", "dark");
    expect(getStoredTheme()).toBe("dark");

    localStorage.setItem("idco-theme", "light");
    expect(getStoredTheme()).toBe("light");
  });

  it("getStoredTheme defaults to system when nothing stored", () => {
    expect(getStoredTheme()).toBe("system");
  });

  it("has the correct backdrop and panel theme attributes", () => {
    document.documentElement.setAttribute("data-theme", "idco-light");

    render(<ThemeDialog open onOpenChange={() => {}} />);

    expect(document.querySelector(".modal")).toHaveClass("bg-black/40");
    expect(document.querySelector(".modal")).not.toHaveAttribute("data-theme");

    const modalBox = document.querySelector(".modal-box");
    expect(modalBox).toBeInTheDocument();
    expect(modalBox).toHaveAttribute("data-theme", "idco-light");
  });
});
