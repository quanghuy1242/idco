// DaisyUI 5: https://daisyui.com/components/mockup-code/
"use client";

import Prism from "prismjs";
// Load grammars beyond Prism's core (markup/css/clike/javascript) so json/ts/python tokenize.
/* eslint-disable import/no-unassigned-import -- Prism grammar packs register onto the Prism singleton via import side effect; there is no functional API. */
import "prismjs/components/prism-json";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-python";
/* eslint-enable import/no-unassigned-import */
import { useRef, type KeyboardEvent } from "react";

export type CodeEditorLanguage =
  | "json"
  | "ts"
  | "tsx"
  | "js"
  | "python"
  | "text";

type CodeEditorProps = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly name?: string;
  readonly language?: CodeEditorLanguage;
  /** Highlight engine. `prism` (default) tokenizes with Prism; `plain` renders escaped monospace. */
  readonly engine?: "plain" | "prism";
  readonly error?: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly readOnly?: boolean;
  /** Show the line-number gutter. Default true. */
  readonly lineNumbers?: boolean;
  /** Cap the editor height and scroll instead of growing. Default false (auto-grow). */
  readonly maxHeight?: "sm" | "md" | "lg";
};

const maxHeightClass = {
  sm: "max-h-40",
  md: "max-h-72",
  lg: "max-h-96",
} as const;

const TAB = "  ";

// Controlled Prism editor: a transparent textarea overlaid on a highlighted <pre>, single-sourced on `value`.
// CodeMirror 6 engine swap deferred to the `id` repo (docs/029 §18.6); the prop surface stays engine-pluggable.
export function CodeEditor(props: CodeEditorProps) {
  const {
    value,
    onChange,
    name,
    language = "json",
    engine = "prism",
    error,
    label,
    placeholder,
    readOnly,
    lineNumbers = true,
    maxHeight,
  } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const grammar = grammarFor(language);
  // A trailing newline collapses in <pre>; pad it so the overlay height matches the textarea.
  const highlighted =
    engine === "prism"
      ? Prism.highlight(value, grammar, prismLanguage(language))
      : escapeHtml(value);
  const lineCount = value.split("\n").length;

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab" || readOnly) return;
    event.preventDefault();
    const textarea = event.currentTarget;
    // execCommand keeps the native undo stack intact; jsdom and old engines fall back to a manual splice.
    if (typeof document.execCommand === "function") {
      const inserted = document.execCommand("insertText", false, TAB);
      if (inserted) return;
    }
    const { selectionStart, selectionEnd } = textarea;
    const next =
      value.slice(0, selectionStart) + TAB + value.slice(selectionEnd);
    onChange(next);
    requestAnimationFrame(() => {
      textarea.selectionStart = textarea.selectionEnd =
        selectionStart + TAB.length;
    });
  }

  return (
    <div className="form-control w-full">
      {label ? (
        <span className="label-text mb-1 text-base font-medium text-base-content">
          {label}
        </span>
      ) : null}
      <div
        className={`relative overflow-auto rounded-box border bg-base-200 font-mono text-sm leading-6 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary ${
          error ? "border-error" : "border-base-300"
        } ${maxHeight ? maxHeightClass[maxHeight] : ""}`}
      >
        <div className="flex w-max min-w-full">
          {lineNumbers ? (
            <div
              aria-hidden="true"
              className="sticky left-0 z-10 select-none border-r border-base-300 bg-base-200 px-3 py-3 text-right text-base-content/40 tabular-nums"
            >
              {Array.from({ length: lineCount }, (_, index) => (
                <div key={index}>{index + 1}</div>
              ))}
            </div>
          ) : null}
          <div className="relative flex-1">
            <pre
              aria-hidden="true"
              className="pointer-events-none m-0 overflow-visible whitespace-pre px-3 py-3"
            >
              <code dangerouslySetInnerHTML={{ __html: `${highlighted}\n` }} />
            </pre>
            <textarea
              ref={textareaRef}
              aria-label={label ?? `${language} editor`}
              aria-invalid={error ? true : undefined}
              name={name}
              placeholder={placeholder}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              wrap="off"
              readOnly={readOnly}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={handleKeyDown}
              className="absolute inset-0 m-0 resize-none overflow-hidden whitespace-pre bg-transparent px-3 py-3 text-transparent caret-base-content outline-none placeholder:text-base-content/40 selection:bg-primary/30"
            />
          </div>
        </div>
      </div>
      {error ? (
        <span role="alert" className="label-text-alt mt-1 text-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function grammarFor(language: CodeEditorLanguage) {
  if (language === "json") return Prism.languages.json ?? Prism.languages.clike;
  if (language === "tsx") return Prism.languages.tsx ?? Prism.languages.jsx;
  if (language === "ts") {
    return Prism.languages.typescript ?? Prism.languages.javascript;
  }
  if (language === "js") return Prism.languages.javascript;
  if (language === "python") return Prism.languages.python ?? {};
  return Prism.languages.plain ?? {};
}

function prismLanguage(language: CodeEditorLanguage): string {
  if (language === "ts") return "typescript";
  if (language === "tsx") return "tsx";
  if (language === "js") return "javascript";
  return language;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
