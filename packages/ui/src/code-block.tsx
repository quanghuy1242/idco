// DaisyUI 5: https://daisyui.com/components/mockup-code/
/**
 * Renders preformatted source text in a scrollable, line-by-line code surface.
 *
 * @categoryDefault Data Display
 */
import type { ReactNode } from "react";

/** Props for {@link CodeBlock}. */
type CodeBlockProps = {
  /** Optional heading shown in the toolbar above the code. */
  readonly label?: string;
  /** The raw code text, split into lines for display. */
  readonly value: string;
  /** Optional toolbar slot, e.g. a copy button, aligned to the right of the label. */
  readonly action?: ReactNode;
  /** Caps the scroll height of the code area; defaults to `md`. */
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

/** A scrollable, line-numbered code panel with an optional label and action slot. */
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
