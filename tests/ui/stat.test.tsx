// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stat, StatGroup, StatSummaryGroup } from "@idco/ui";

describe("StatGroup / Stat", () => {
  it("renders title, value, and description", () => {
    const { container } = render(
      <Stat title="Active" value={3} description="signs new" />,
    );
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(container.querySelector(".stat-value")).toHaveTextContent("3");
    expect(screen.getByText("signs new")).toBeInTheDocument();
  });

  it("applies the tone class to the value", () => {
    const { container } = render(
      <Stat title="Active" value={1} tone="success" />,
    );
    expect(container.querySelector(".stat-value")).toHaveClass("text-success");
  });

  it("renders an icon figure when iconName is provided", () => {
    const { container } = render(
      <Stat title="Keys" value={4} iconName="KeyRound" />,
    );
    expect(container.querySelector(".stat-figure svg")).toBeInTheDocument();
  });

  it("renders a meter when passed", () => {
    render(<Stat title="Usage" value="80%" meter={{ value: 80, max: 100 }} />);
    expect(screen.getByRole("meter")).toBeInTheDocument();
  });

  it("applies the columns class on the group", () => {
    const { container } = render(
      <StatGroup columns={3}>
        <Stat title="A" value={1} />
      </StatGroup>,
    );
    expect(container.firstChild).toHaveClass("sm:grid-cols-3");
  });

  it("supports seamless rows inside a summary group", () => {
    const { container } = render(
      <StatSummaryGroup>
        <StatGroup columns={4} density="compact" frame="seamless">
          <Stat title="A" value={1} />
          <Stat title="B" value={2} />
        </StatGroup>
        <StatGroup columns={4} density="compact" frame="seamless">
          <Stat title="C" value={3} />
          <Stat title="D" value={4} />
        </StatGroup>
      </StatSummaryGroup>,
    );
    expect(container.firstChild).toHaveClass(
      "flex",
      "gap-px",
      "overflow-hidden",
      "rounded-box",
    );
    expect(container.querySelectorAll(".grid")).toHaveLength(2);
    expect(container.querySelector(".grid")).not.toHaveClass("rounded-box");
  });

  it("supports an inline layout that does not force a full-width grid", () => {
    const { container } = render(
      <StatGroup layout="inline">
        <Stat title="A" value={1} />
        <Stat title="B" value={2} />
      </StatGroup>,
    );
    expect(container.firstChild).toHaveClass("stats");
    expect(container.firstChild).toHaveClass("stats-horizontal");
    expect(container.firstChild).toHaveClass("w-fit");
    expect(container.firstChild).toHaveClass("self-start");
  });
});
