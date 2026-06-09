// @vitest-environment jsdom

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, PageIntro } from "@idco/ui";

describe("PageIntro", () => {
  it("renders the title as a level-1 heading", () => {
    render(<PageIntro title="Users" />);
    expect(
      screen.getByRole("heading", { name: "Users", level: 1 }),
    ).toBeInTheDocument();
  });

  it("renders the description helper text", () => {
    render(
      <PageIntro title="Users" description="Manage accounts and roles." />,
    );
    expect(screen.getByText("Manage accounts and roles.")).toBeInTheDocument();
  });

  it("renders an info popover trigger when info is provided", () => {
    render(<PageIntro title="Users" info="Users can sign in." />);
    expect(
      screen.getByRole("button", { name: /about users/i }),
    ).toBeInTheDocument();
  });

  it("reveals info content on click", async () => {
    render(<PageIntro title="Users" info="Users can sign in." />);
    fireEvent.click(screen.getByRole("button", { name: /about users/i }));
    await waitFor(() => {
      expect(screen.getByText("Users can sign in.")).toBeInTheDocument();
    });
  });

  it("renders actions on the right", () => {
    render(<PageIntro title="Users" actions={<Button>New</Button>} />);
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });

  it("omits description and actions when not provided", () => {
    render(<PageIntro title="Users" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
