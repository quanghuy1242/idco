"use client";

/**
 * The live-code island (docs/015 §6, §7.4). Enhances the static `<pre>` (L1
 * `RichTextCodeBlock`, no Prism) into the syntax-highlighted `@idco/ui` `CodeEditor`
 * (read-only). Hydrates on `visible` so a long page does not pay Prism's cost for code
 * blocks the reader never scrolls to; the plain `<pre>` is complete and readable until
 * then. This is the one island that imports `@idco/ui` — allowed because islands are
 * `"use client"` and live behind the `./islands` entry, never in the server graph.
 */
import { isRecord } from "@quanghuy1242/idco-lib";
import type { ReactNode } from "react";
import { CodeEditor, type CodeEditorLanguage } from "@quanghuy1242/idco-ui";
import { registerReaderIsland } from "./registry";

export type LiveCodeData = {
  readonly value: string;
  readonly language?: string;
};

function isLiveCodeData(value: unknown): value is LiveCodeData {
  return isRecord(value) && typeof value.value === "string";
}

function codeEditorLanguage(value: unknown): CodeEditorLanguage {
  if (
    value === "json" ||
    value === "ts" ||
    value === "tsx" ||
    value === "js" ||
    value === "python" ||
    value === "text"
  ) {
    return value;
  }
  if (value === "typescript") return "ts";
  if (value === "javascript") return "js";
  if (value === "py") return "python";
  return "text";
}

function LiveCodeInteractive({
  data,
  children,
}: {
  readonly data: unknown;
  readonly children: ReactNode;
}): ReactNode {
  if (!isLiveCodeData(data)) return <>{children}</>;
  return (
    <CodeEditor
      label="Code content"
      language={codeEditorLanguage(data.language)}
      maxHeight="lg"
      onChange={() => {}}
      readOnly
      value={data.value}
    />
  );
}

export const liveCodeIsland = {
  Interactive: LiveCodeInteractive,
  hydrate: "visible" as const,
  kind: "code-block",
};

registerReaderIsland(liveCodeIsland);
