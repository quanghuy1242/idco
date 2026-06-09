// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DescriptionList } from "@idco/ui";

describe("DescriptionList", () => {
  it("renders term/description pairs", () => {
    render(
      <DescriptionList
        items={[
          { term: "Algorithm", description: "EdDSA" },
          { term: "Status", description: "Active" },
        ]}
      />,
    );
    expect(screen.getByText("Algorithm")).toBeInTheDocument();
    expect(screen.getByText("EdDSA")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
  });

  it("applies font-mono to mono descriptions", () => {
    render(
      <DescriptionList
        items={[{ term: "Key ID", description: "abc123", mono: true }]}
      />,
    );
    expect(screen.getByText("abc123")).toHaveClass("font-mono");
  });

  it("applies the columns class", () => {
    const { container } = render(
      <DescriptionList columns={3} items={[{ term: "A", description: "1" }]} />,
    );
    expect(container.querySelector("dl")).toHaveClass("sm:grid-cols-3");
  });

  it("uses semantic dl/dt/dd elements", () => {
    const { container } = render(
      <DescriptionList items={[{ term: "A", description: "1" }]} />,
    );
    expect(container.querySelector("dl")).toHaveClass("w-full");
    expect(container.querySelector("dl dt")).toHaveTextContent("A");
    expect(container.querySelector("dl dd")).toHaveTextContent("1");
  });
});
