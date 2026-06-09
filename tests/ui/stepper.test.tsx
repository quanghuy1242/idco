// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Stepper, type Step } from "@idco/ui";

const steps: Step[] = [
  { id: "type", label: "Type", content: <p>Type step</p> },
  { id: "uris", label: "URIs", content: <p>URIs step</p> },
  { id: "review", label: "Review", content: <p>Review step</p> },
];

describe("Stepper", () => {
  it("renders step labels and the active step content", () => {
    render(
      <Stepper
        steps={steps}
        activeStep={0}
        onStepChange={() => {}}
        onComplete={() => {}}
      />,
    );
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Type step")).toBeInTheDocument();
    expect(screen.queryByText("URIs step")).toBeNull();
  });

  it("advances with Next", () => {
    const onStepChange = vi.fn<(n: number) => void>();
    render(
      <Stepper
        steps={steps}
        activeStep={0}
        onStepChange={onStepChange}
        onComplete={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(onStepChange).toHaveBeenCalledWith(1);
  });

  it("disables Back on the first step", () => {
    render(
      <Stepper
        steps={steps}
        activeStep={0}
        onStepChange={() => {}}
        onComplete={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /back/i })).toBeDisabled();
  });

  it("disables Next when the active step is invalid", () => {
    const guarded: Step[] = [
      { ...steps[0], isValid: false },
      steps[1],
      steps[2],
    ];
    render(
      <Stepper
        steps={guarded}
        activeStep={0}
        onStepChange={() => {}}
        onComplete={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("shows Complete on the last step and calls onComplete", () => {
    const onComplete = vi.fn<() => void>();
    render(
      <Stepper
        steps={steps}
        activeStep={2}
        onStepChange={() => {}}
        onComplete={onComplete}
        completeLabel="Create"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(onComplete).toHaveBeenCalled();
  });

  it("jumps back when a completed step is clicked", () => {
    const onStepChange = vi.fn<(n: number) => void>();
    render(
      <Stepper
        steps={steps}
        activeStep={2}
        onStepChange={onStepChange}
        onComplete={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    expect(onStepChange).toHaveBeenCalledWith(0);
  });

  it("applies compact step and button sizing when requested", () => {
    const { container } = render(
      <Stepper
        steps={steps}
        activeStep={0}
        onStepChange={() => {}}
        onComplete={() => {}}
        size="sm"
      />,
    );
    expect(container.querySelector(".steps")).toHaveClass("text-xs");
    expect(screen.getByRole("button", { name: /next/i })).toHaveClass("btn-sm");
  });
});
