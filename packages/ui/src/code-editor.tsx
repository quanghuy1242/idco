// DaisyUI 5: https://daisyui.com/components/mockup-code/
"use client";

import Prism from "prismjs";

type CodeEditorProps = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly name?: string;
  readonly language?: "json" | "ts" | "tsx" | "text";
  readonly engine?: "plain" | "prism";
  readonly error?: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly readOnly?: boolean;
  readonly showPreview?: boolean;
};

// Controlled monospace editor. CodeMirror 6 upgrade deferred (docs/027 §14); prop surface is forward-compatible.
export function CodeEditor(props: CodeEditorProps) {
  const {
    value,
    onChange,
    name,
    language = "json",
    engine = "plain",
    error,
    label,
    placeholder,
    readOnly,
    showPreview,
  } = props;
  const rows = 8;
  const grammar = grammarFor(language);
  const preview =
    engine === "prism" && showPreview
      ? Prism.highlight(value, grammar, prismLanguage(language))
      : null;
  return (
    <div className="form-control w-full">
      {label ? (
        <span className="label-text mb-1 text-base font-medium text-base-content">
          {label}
        </span>
      ) : null}
      <textarea
        aria-label={label ?? `${language} editor`}
        aria-invalid={error ? true : undefined}
        name={name}
        placeholder={placeholder}
        spellCheck={false}
        readOnly={readOnly}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`textarea textarea-bordered w-full resize-y bg-base-200 font-mono text-sm leading-relaxed text-base-content focus:textarea-primary${
          error ? " textarea-error" : ""
        }${readOnly ? " opacity-80" : ""}`}
      />
      {error ? (
        <span role="alert" className="label-text-alt mt-1 text-error">
          {error}
        </span>
      ) : null}
      {preview !== null ? (
        <pre
          aria-label={`${label ?? language} highlighted preview`}
          className="mockup-code mt-2 overflow-auto bg-base-300 text-base-content"
        >
          <code dangerouslySetInnerHTML={{ __html: preview }} />
        </pre>
      ) : null}
    </div>
  );
}

function grammarFor(language: NonNullable<CodeEditorProps["language"]>) {
  if (language === "json") return Prism.languages.json ?? Prism.languages.clike;
  if (language === "ts" || language === "tsx") {
    return Prism.languages.typescript ?? Prism.languages.javascript;
  }
  return Prism.languages.plain ?? {};
}

function prismLanguage(
  language: NonNullable<CodeEditorProps["language"]>,
): string {
  if (language === "ts" || language === "tsx") return "typescript";
  return language;
}
