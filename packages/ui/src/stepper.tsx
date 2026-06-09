// DaisyUI 5: https://daisyui.com/components/steps/
"use client";

import { useState, type ReactNode } from "react";
import { Button } from "./button";

export type Step = {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
  readonly isValid?: boolean;
};

type StepperProps = {
  readonly steps: ReadonlyArray<Step>;
  readonly activeStep: number;
  readonly onStepChange: (step: number) => void;
  readonly onComplete: () => void | Promise<void>;
  readonly completeLabel?: string;
  readonly size?: "sm" | "md";
};

const stepsSizeClass: Record<NonNullable<StepperProps["size"]>, string> = {
  sm: "text-xs [&_.step]:grid-rows-[24px_1fr] [&_.step]:min-w-12 [&_.step:before]:h-0.5 [&_.step:after]:h-5 [&_.step:after]:w-5",
  md: "text-sm [&_.step]:grid-rows-[30px_1fr] [&_.step]:min-w-14 [&_.step:before]:h-1 [&_.step:after]:h-6 [&_.step:after]:w-6",
};

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
