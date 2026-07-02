// DaisyUI 5: https://daisyui.com/components/input/
"use client";

/**
 * Form controls: React Aria field behavior (validation, labels, errors) with DaisyUI 5 input styling.
 *
 * @categoryDefault Forms
 */

import { useRef, type FormEvent, type ReactNode } from "react";
import {
  FieldError,
  Form as AriaForm,
  Input as AriaInput,
  Label,
  TextArea as AriaTextArea,
  TextField,
} from "react-aria-components";
import { useRadioGroup, useRadio, useCheckbox } from "react-aria";
import {
  useRadioGroupState,
  type RadioGroupState,
  useToggleState,
} from "react-stately";

/** Props for {@link Form}. */
type FormProps = {
  readonly children: ReactNode;
  /** Submit handler; call `preventDefault` to keep control client-side. */
  readonly onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** Fired when native/aria validation fails on submit. */
  readonly onInvalid?: (event: FormEvent<HTMLFormElement>) => void;
  /** Native action URL or a function receiving the collected `FormData`. */
  readonly action?: string | ((formData: FormData) => void | Promise<void>);
  /** HTTP method or `dialog` for in-dialog submission. */
  readonly method?: "get" | "post" | "dialog";
  /** Whether validation surfaces via the browser (`native`) or ARIA messaging (`aria`). */
  readonly validationBehavior?: "native" | "aria";
  /** Server/async validation errors keyed by field name. */
  readonly validationErrors?: Record<string, string | string[]>;
};

/**
 * A form wrapper with React Aria validation wiring; renders `display: contents` so it adds no layout box.
 */
export function Form({
  children,
  onSubmit,
  onInvalid,
  action,
  method,
  validationBehavior,
  validationErrors,
}: FormProps) {
  return (
    <AriaForm
      action={action}
      method={method}
      onSubmit={onSubmit}
      onInvalid={onInvalid}
      validationBehavior={validationBehavior}
      validationErrors={validationErrors}
      className="contents"
    >
      {children}
    </AriaForm>
  );
}

/** Props for {@link Input}. */
type BareInputProps = {
  /** Current value (controlled). */
  readonly value: string;
  /** Called with the next value on edit. */
  readonly onChange: (value: string) => void;
  /** Accessible name; these bare controls render no visible label. */
  readonly ariaLabel: string;
  /** Input type; defaults to `text`. */
  readonly type?: "email" | "text" | "url";
  /**
   * Control height; defaults to `md`. `lg`/`xl` suit a hero field; `2xl` is the
   * page-title scale above DaisyUI's `input-xl` (R4 / content-api PV20) — a real
   * document-title weight for the borderless title, not a sized-up subheading.
   */
  readonly size?: "sm" | "md" | "lg" | "xl" | "2xl";
  /**
   * Visual frame. `bordered` (default) is the standard boxed field; `ghost`
   * drops the border for a borderless, label-less title input (DaisyUI
   * `input-ghost`) — pair with `size="xl"` or `size="2xl"` for a Notion/Word-style
   * document title (R4, note.md §5.10).
   */
  readonly variant?: "bordered" | "ghost";
  readonly placeholder?: string;
  readonly autoFocus?: boolean;
  /** Apply the error style. */
  readonly invalid?: boolean;
  readonly className?: string;
};

// DaisyUI 5 input sizes (xs/sm/md/lg/xl); `md` is the default and needs no class.
// `2xl` has no DaisyUI step, so it composes utilities instead: Tailwind's utility
// layer overrides DaisyUI's component-layer `input` font-size/height, so `text-3xl`
// + `h-auto py-1.5` produce a genuine document-title scale (deterministic across
// the cascade — utilities always win the layer order) rather than fighting a
// fixed-height `input-xl`.
const INPUT_SIZE_CLASS: Record<NonNullable<BareInputProps["size"]>, string> = {
  sm: "input-sm",
  md: "",
  lg: "input-lg",
  xl: "input-xl",
  "2xl": "text-3xl font-semibold leading-tight h-auto py-1.5",
};

/**
 * Bare text input — React Aria `TextField` + `Input` with DaisyUI `input`
 * styling and no label/error chrome. For inline editing surfaces (popovers,
 * block controls) that provide their own labels. Use `TextInput` for a full
 * labelled form field.
 *
 * `variant="ghost"` + a larger `size` is the borderless document-title input
 * (R4, note.md §5.10): `<Input variant="ghost" size="xl" placeholder="Title"
 * ariaLabel="Title" />` renders a label-less hero title above the body.
 */
export function Input({
  value,
  onChange,
  ariaLabel,
  type = "text",
  size = "md",
  variant = "bordered",
  placeholder,
  autoFocus,
  invalid,
  className,
}: BareInputProps) {
  const sizeClass = INPUT_SIZE_CLASS[size];
  // DaisyUI 5: border is the default, so `bordered` keeps `input-bordered` (the
  // package convention) and `ghost` swaps to `input-ghost` for a borderless box.
  const variantClass = variant === "ghost" ? "input-ghost" : "input-bordered";
  return (
    <TextField
      aria-label={ariaLabel}
      type={type}
      value={value}
      onChange={onChange}
      isInvalid={invalid || undefined}
      className="w-full"
    >
      <AriaInput
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={`input ${variantClass} w-full ${sizeClass}${invalid ? " input-error" : ""}${className ? ` ${className}` : ""}`.trim()}
      />
    </TextField>
  );
}

/** Props for {@link TextArea}. */
type BareTextAreaProps = {
  /** Current value (controlled). */
  readonly value: string;
  /** Called with the next value on edit. */
  readonly onChange: (value: string) => void;
  /** Accessible name; the control renders no visible label. */
  readonly ariaLabel: string;
  /** Visible row count; defaults to 3. */
  readonly rows?: number;
  /** Control height; defaults to `md`. */
  readonly size?: "sm" | "md";
  readonly placeholder?: string;
  readonly autoFocus?: boolean;
  readonly className?: string;
};

/**
 * Bare multiline control — the textarea counterpart to `Input`. No label/error
 * chrome and no forced monospace; for inline editing surfaces. Use `Textarea`
 * for a full labelled form field.
 */
export function TextArea({
  value,
  onChange,
  ariaLabel,
  rows = 3,
  size = "md",
  placeholder,
  autoFocus,
  className,
}: BareTextAreaProps) {
  const sizeClass = size === "sm" ? "textarea-sm" : "";
  return (
    <TextField
      aria-label={ariaLabel}
      value={value}
      onChange={onChange}
      className="w-full"
    >
      <AriaTextArea
        autoFocus={autoFocus}
        rows={rows}
        placeholder={placeholder}
        className={`textarea textarea-bordered w-full ${sizeClass}${className ? ` ${className}` : ""}`.trim()}
      />
    </TextField>
  );
}

/** Props for {@link TextInput}. */
type TextInputProps = {
  /** Visible field label, also used as the accessible name. */
  readonly label: string;
  /** Field name submitted with the form. */
  readonly name: string;
  /** Input type; defaults to `text`. */
  readonly type?: "email" | "password" | "text";
  /** Control height; defaults to `md`. */
  readonly size?: "sm" | "md";
  readonly autoComplete?: string;
  /** Mark the field required for native/aria validation. */
  readonly required?: boolean;
  /** Append "(Optional)" to the label when not required; defaults to `true`. */
  readonly showOptionalLabel?: boolean;
  /** Controlled value. */
  readonly value?: string;
  /** Initial uncontrolled value. */
  readonly defaultValue?: string;
  /** External error message to display. */
  readonly error?: string;
  /** Per-keystroke validator; return a message string, or `true`/nullish when valid. */
  readonly validate?: (value: string) => string | true | null | undefined;
  /** Called with the next value on edit. */
  readonly onChange?: (value: string) => void;
};

/**
 * A labelled text field with validation message, optional marker, and DaisyUI input styling.
 */
export function TextInput({
  label,
  name,
  type = "text",
  size = "md",
  autoComplete,
  required,
  showOptionalLabel = true,
  value,
  defaultValue,
  error,
  validate,
  onChange,
}: TextInputProps) {
  const sizeClass = size === "sm" ? "input-sm" : "";

  return (
    <TextField
      name={name}
      type={type}
      autoComplete={autoComplete}
      isRequired={required}
      value={value}
      defaultValue={defaultValue}
      isInvalid={error ? true : undefined}
      validate={validate}
      onChange={onChange}
      className="form-control w-full"
    >
      <Label className="label">
        <span className="label-text text-base font-medium text-base-content">
          {label}
          {!required && showOptionalLabel ? " (Optional)" : ""}
        </span>
      </Label>
      <AriaInput
        name={name}
        aria-label={label}
        className={`input input-bordered ${sizeClass} w-full bg-base-100 text-base-content focus:input-primary${error ? " input-error" : ""}`.trim()}
      />
      <div className="label">
        <FieldError className="label-text-alt text-error">{error}</FieldError>
      </div>
    </TextField>
  );
}

// DaisyUI 5 Radio: https://daisyui.com/components/radio/
/** Props for {@link HiddenInput}. */
type HiddenInputProps = {
  /** Field name submitted with the form. */
  readonly name: string;
  /** Value submitted under `name`. */
  readonly value: string;
};

/** A hidden form field that submits a fixed name/value pair. */
export function HiddenInput({ name, value }: HiddenInputProps) {
  return <input type="hidden" name={name} value={value} />;
}

/** A single selectable choice in a {@link RadioGroup}. */
type RadioOption = {
  /** Submitted value when chosen. */
  readonly value: string;
  /** Visible option label. */
  readonly label: string;
};

/** Props for {@link RadioGroup}. */
type RadioGroupProps = {
  /** Group legend / question. */
  readonly title: string;
  /** Field name submitted with the form. */
  readonly name: string;
  /** Selectable options. */
  readonly options: readonly RadioOption[];
  /** Controlled selected value. */
  readonly value?: string;
  /** Initial uncontrolled value. */
  readonly defaultValue?: string;
  /** Control size; defaults to `md`. */
  readonly size?: "sm" | "md";
  readonly required?: boolean;
  /** External error message to display. */
  readonly error?: string;
  /** Called with the next value on selection. */
  readonly onChange?: (value: string) => void;
};

/** A labelled set of radio options built on React Aria's radio-group state, with DaisyUI styling. */
export function RadioGroup({
  title,
  name,
  options,
  value,
  defaultValue,
  size = "md",
  required,
  error,
  onChange,
}: RadioGroupProps) {
  const state = useRadioGroupState({
    name,
    value,
    defaultValue,
    isRequired: required,
    isInvalid: error ? true : undefined,
    onChange,
  });

  const { radioGroupProps, labelProps, errorMessageProps } = useRadioGroup(
    { name, isRequired: required, isInvalid: error ? true : undefined },
    state,
  );

  const radioSizeClass = size === "sm" ? "radio-sm" : "";

  return (
    <div {...radioGroupProps} className="fieldset">
      <span
        {...labelProps}
        className="fieldset-legend text-base font-medium text-base-content"
      >
        {title}
      </span>
      {options.map((option) => (
        <RadioItem
          key={option.value}
          state={state}
          value={option.value}
          label={option.label}
          sizeClass={radioSizeClass}
        />
      ))}
      {error ? (
        <div className="label">
          <span {...errorMessageProps} className="label-text-alt text-error">
            {error}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function RadioItem({
  state,
  value,
  label,
  sizeClass,
}: {
  state: RadioGroupState;
  value: string;
  label: string;
  sizeClass: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const { inputProps, labelProps } = useRadio(
    { value, "aria-label": label },
    state,
    ref,
  );

  return (
    <label className="label cursor-pointer justify-start gap-3 py-0.5">
      <input
        {...inputProps}
        ref={ref}
        className={`radio ${sizeClass} radio-primary`.trim()}
      />
      <span {...labelProps} className="label-text text-base text-base-content">
        {label}
      </span>
    </label>
  );
}

// DaisyUI 5 Checkbox: https://daisyui.com/components/checkbox/
/** Props for {@link Checkbox}. */
type CheckboxProps = {
  /** Visible label, also the accessible name. */
  readonly label: string;
  /** Field name submitted with the form. */
  readonly name: string;
  /** Submitted value when checked. */
  readonly value?: string;
  /** Controlled checked state. */
  readonly selected?: boolean;
  /** Initial uncontrolled checked state. */
  readonly defaultSelected?: boolean;
  /** Render the mixed/indeterminate state. */
  readonly indeterminate?: boolean;
  readonly required?: boolean;
  /** Control size; defaults to `md`. */
  readonly size?: "sm" | "md";
  /** External error message to display. */
  readonly error?: string;
  /** Called with the next checked state. */
  readonly onChange?: (selected: boolean) => void;
};

/** A labelled checkbox built on React Aria's toggle/checkbox hooks, with indeterminate support. */
export function Checkbox({
  label,
  name,
  value,
  selected,
  defaultSelected,
  indeterminate,
  required,
  size = "md",
  error,
  onChange,
}: CheckboxProps) {
  const state = useToggleState({
    isSelected: selected,
    defaultSelected,
    onChange,
  });

  const ref = useRef<HTMLInputElement>(null);
  const { inputProps, labelProps } = useCheckbox(
    {
      name,
      value,
      "aria-label": label,
      isRequired: required,
      isInvalid: error ? true : undefined,
      isIndeterminate: indeterminate,
    },
    state,
    ref,
  );

  const checkboxSizeClass = size === "sm" ? "checkbox-sm" : "";

  return (
    <div className="form-control w-full">
      <label
        {...labelProps}
        className="label cursor-pointer justify-start gap-3"
      >
        <input
          {...inputProps}
          ref={ref}
          className={`checkbox ${checkboxSizeClass} checkbox-primary`.trim()}
        />
        <span className="label-text text-base text-base-content">{label}</span>
      </label>
      {error ? (
        <span className="label">
          <span className="label-text-alt text-error">{error}</span>
        </span>
      ) : null}
    </div>
  );
}

// DaisyUI 5 Textarea: https://daisyui.com/components/textarea/
/** Props for {@link Textarea}. */
type TextareaProps = {
  /** Visible field label, also the accessible name. */
  readonly label: string;
  /** Field name submitted with the form. */
  readonly name: string;
  readonly required?: boolean;
  /** Controlled value. */
  readonly value?: string;
  /** Initial uncontrolled value. */
  readonly defaultValue?: string;
  /** External error message to display. */
  readonly error?: string;
  /** Visible row count; defaults to 4. */
  readonly rows?: number;
  readonly placeholder?: string;
  /** Called with the next value on edit. */
  readonly onChange?: (value: string) => void;
};

/** A labelled multiline field (monospace) with validation message and DaisyUI textarea styling. */
export function Textarea({
  label,
  name,
  required,
  value,
  defaultValue,
  error,
  rows = 4,
  placeholder,
  onChange,
}: TextareaProps) {
  return (
    <TextField
      name={name}
      isRequired={required}
      value={value}
      defaultValue={defaultValue}
      isInvalid={error ? true : undefined}
      onChange={onChange}
      className="form-control w-full"
    >
      <Label className="label">
        <span className="label-text text-base font-medium text-base-content">
          {label}
          {!required ? " (Optional)" : ""}
        </span>
      </Label>
      <AriaTextArea
        name={name}
        aria-label={label}
        rows={rows}
        placeholder={placeholder}
        className={`textarea textarea-bordered w-full bg-base-100 text-base-content font-mono focus:textarea-primary${error ? " textarea-error" : ""}`.trim()}
      />
      <div className="label">
        <FieldError className="label-text-alt text-error">{error}</FieldError>
      </div>
    </TextField>
  );
}
