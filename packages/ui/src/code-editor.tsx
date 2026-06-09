// DaisyUI 5: https://daisyui.com/components/mockup-code/
"use client";

type CodeEditorProps = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly name?: string;
  readonly language?: "json";
  readonly error?: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly readOnly?: boolean;
};

// Controlled monospace editor. CodeMirror 6 upgrade deferred (docs/027 §14); prop surface is forward-compatible.
export function CodeEditor(props: CodeEditorProps) {
  const {
    value,
    onChange,
    name,
    language = "json",
    error,
    label,
    placeholder,
    readOnly,
  } = props;
  const rows = 8;
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
    </div>
  );
}
