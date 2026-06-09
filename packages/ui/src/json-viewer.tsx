// DaisyUI 5: https://daisyui.com/components/mockup-code/
import { Fragment, type ReactNode } from "react";

type JsonViewerProps = {
  readonly value: object | string;
  readonly label?: string;
  readonly maxHeight?: "sm" | "md" | "lg";
  readonly action?: ReactNode;
};

const maxHeightClass: Record<
  NonNullable<JsonViewerProps["maxHeight"]>,
  string
> = {
  sm: "max-h-40",
  md: "max-h-72",
  lg: "max-h-96",
};

const tokenPattern =
  /("(?:\\.|[^"\\])*"\s*:?)|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

// In-house JSON highlighter: no external dep (side-effect-free, SSR-safe); renders React spans, not raw HTML.
export function highlightJson(json: string): ReactNode[] {
  const out: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of json.matchAll(tokenPattern)) {
    const text = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex)
      out.push(<Fragment key={key++}>{json.slice(lastIndex, start)}</Fragment>);
    let cls = "text-warning"; // number
    if (text.startsWith('"')) {
      cls = text.trimEnd().endsWith(":") ? "text-info" : "text-success";
    } else if (text === "true" || text === "false" || text === "null") {
      cls = "text-secondary";
    }
    out.push(
      <span key={key++} className={cls}>
        {text}
      </span>,
    );
    lastIndex = start + text.length;
  }
  if (lastIndex < json.length)
    out.push(<Fragment key={key++}>{json.slice(lastIndex)}</Fragment>);
  return out;
}

export function JsonViewer({
  value,
  label,
  maxHeight = "md",
  action,
}: JsonViewerProps) {
  let json: string;
  if (typeof value === "string") {
    try {
      json = JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      json = value;
    }
  } else {
    json = JSON.stringify(value, null, 2);
  }

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-box border border-base-300 bg-base-200">
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
      <pre
        className={`m-0 overflow-auto p-3 font-mono text-sm leading-relaxed whitespace-pre text-base-content ${maxHeightClass[maxHeight]}`}
      >
        <code>{highlightJson(json)}</code>
      </pre>
    </div>
  );
}
