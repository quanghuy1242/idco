// DaisyUI 5: https://daisyui.com/components/steps/
"use client";

/**
 * A multi-step wizard that pairs DaisyUI step styling with controlled navigation between numbered steps.
 *
 * @categoryDefault Navigation
 */

import { useState, type ReactNode } from "react";
import { Button } from "./button";

/** A single wizard step with its label, body content, and optional validity gate. */
export type Step = {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
  readonly isValid?: boolean;
};

/** Props for {@link Stepper}. */
type StepperProps = {
  readonly steps: ReadonlyArray<Step>;
  /** Zero-based index of the currently displayed step. */
  readonly activeStep: number;
  /** Called with the target index when the user navigates to another step. */
  readonly onStepChange: (step: number) => void;
  /** Called when the final step's complete button is pressed; awaited to show a submitting state. */
  readonly onComplete: () => void | Promise<void>;
  /** Label for the final-step action button (defaults to "Complete"). */
  readonly completeLabel?: string;
  /** Visual scale of the steps row and footer buttons (defaults to "md"). */
  readonly size?: "sm" | "md";
};

const stepsSizeClass: Record<NonNullable<StepperProps["size"]>, string> = {
  sm: "text-xs [&_.step]:grid-rows-[24px_1fr] [&_.step]:min-w-12 [&_.step:before]:h-0.5 [&_.step:after]:h-5 [&_.step:after]:w-5",
  md: "text-sm [&_.step]:grid-rows-[30px_1fr] [&_.step]:min-w-14 [&_.step:before]:h-1 [&_.step:after]:h-6 [&_.step:after]:w-6",
};

/** A controlled multi-step wizard that renders the active step's content with Back/Next/Complete navigation. */
export function Stepper({
  steps,
  activeStep,
  onStepChange,
  onComplete,
  completeLabel = "Complete",
  size = "md",
}: StepperProps) {
  const [submitting, setSubmitting] = useState(false);
  const current = steps[activeStep];
  const isLast = activeStep === steps.length - 1;
  const canAdvance = current?.isValid !== false;

  async function handleComplete() {
    setSubmitting(true);
    try {
      await onComplete();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <ul className={`steps w-full ${stepsSizeClass[size]}`}>
        {steps.map((step, index) => {
          const done = index < activeStep;
          const active = index === activeStep;
          return (
            <li
              key={step.id}
              className={`step ${index <= activeStep ? "step-primary" : ""}`}
              aria-current={active ? "step" : undefined}
            >
              {done ? (
                <button
                  type="button"
                  className="cursor-pointer hover:underline"
                  onClick={() => onStepChange(index)}
                >
                  {step.label}
                </button>
              ) : (
                step.label
              )}
            </li>
          );
        })}
      </ul>

      <div>{current?.content}</div>

      <div className="flex items-center justify-between">
        <Button
          variant="secondary"
          size={size}
          disabled={activeStep === 0 || submitting}
          onClick={() => onStepChange(activeStep - 1)}
        >
          Back
        </Button>
        {isLast ? (
          <Button
            variant="primary"
            size={size}
            disabled={!canAdvance || submitting}
            onClick={() => void handleComplete()}
          >
            {completeLabel}
          </Button>
        ) : (
          <Button
            variant="primary"
            size={size}
            disabled={!canAdvance}
            onClick={() => onStepChange(activeStep + 1)}
          >
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
