// DaisyUI 5: https://daisyui.com/components/mockup-code/
import type { ReactNode } from "react";

type CodeBlockProps = {
  readonly label?: string;
  readonly value: string;
  readonly action?: ReactNode;
  readonly maxHeight?: "sm" | "md" | "lg";
};

const maxHeightClass: Record<
  NonNullable<CodeBlockProps["maxHeight"]>,
  string
> = {
  sm: "max-h-40",
  md: "max-h-72",
  lg: "max-h-96",
};

export function CodeBlock({
  label,
  value,
  action,
  maxHeight = "md",
}: CodeBlockProps) {
  return (
    <div className="overflow-hidden rounded-box border border-base-300 bg-base-200">
      {label || action ? (
        <div className="flex items-center justify-between gap-3 border-b border-base-300 px-3 py-2">
          {label ? (
            <span className="text-sm font-medium text-base-content">
              {label}
            </span>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      <div
        className={`mockup-code overflow-auto rounded-none bg-base-200 text-base-content ${maxHeightClass[maxHeight]}`}
      >
        {value.split("\n").map((line, index) => (
          <pre key={index} data-prefix="">
            <code>{line || " "}</code>
          </pre>
        ))}
      </div>
    </div>
  );
}
