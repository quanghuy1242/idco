"use client";

/**
 * The live-code island (docs/015 §6, §7.4). Enhances the static `<pre>` (L1
 * `RichTextCodeBlock`, no Prism) into the syntax-highlighted `@idco/ui` `CodeEditor`
 * (read-only). Hydrates on `visible` so a long page does not pay Prism's cost for code
 * blocks the reader never scrolls to; the plain `<pre>` is complete and readable until
 * then. This is the one island that imports `@idco/ui`, so it lives behind its OWN
 * `./islands/live-code` entry — NOT the core `./islands` barrel. A public reader imports
 * `./islands` and gets checklist + scroll-spy (pure React) with zero Prism / `@idco/ui`; a
 * host that wants live code highlighting additionally imports this entry to register it.
 *
 * It imports `CodeEditor` from the `@idco/ui` **subpath** (`/code-editor`), NOT the package
 * barrel. The barrel `export *`s every `@idco/ui` module — drawer, popover, data-table, the
 * whole react-aria family — so a barrel import would put ~300 KB of react-aria one failed
 * tree-shake away from this chunk. `CodeEditor` only needs Prism; the subpath resolves to
 * that one ~3.7 KB module and can never pull react-aria, tree-shaking or not.
 *
 * @categoryDefault Islands
 */
import type { ReactNode } from "react";
import { isRecord } from "@quanghuy1242/idco-lib";
import {
  CodeEditor,
  type CodeEditorLanguage,
} from "@quanghuy1242/idco-ui/code-editor";
import { registerReaderIsland } from "./registry";

/**
 * The island data for a code block: its source plus an optional language hint.
 *
 * @category Islands
 */
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

/**
 * The live-code island: upgrades a static `<pre>` into a syntax-highlighted read-only `CodeEditor`.
 *
 * @category Islands
 */
export const liveCodeIsland = {
  Interactive: LiveCodeInteractive,
  hydrate: "visible" as const,
  kind: "code-block",
};

registerReaderIsland(liveCodeIsland);
