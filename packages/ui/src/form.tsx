// DaisyUI 5: https://daisyui.com/components/input/
"use client";

import { useRef, type FormEvent, type ReactNode } from "react";
import {
  FieldError,
  Form as AriaForm,
  Input,
  Label,
  TextArea,
  TextField,
} from "react-aria-components";
import { useRadioGroup, useRadio, useCheckbox } from "react-aria";
import {
  useRadioGroupState,
  type RadioGroupState,
  useToggleState,
} from "react-stately";

type FormProps = {
  readonly children: ReactNode;
  readonly onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  readonly onInvalid?: (event: FormEvent<HTMLFormElement>) => void;
  readonly action?: string | ((formData: FormData) => void | Promise<void>);
  readonly method?: "get" | "post" | "dialog";
  readonly validationBehavior?: "native" | "aria";
  readonly validationErrors?: Record<string, string | string[]>;
};

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

type TextInputProps = {
  readonly label: string;
  readonly name: string;
  readonly type?: "email" | "password" | "text";
  readonly size?: "sm" | "md";
  readonly autoComplete?: string;
  readonly required?: boolean;
  readonly showOptionalLabel?: boolean;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly error?: string;
  readonly validate?: (value: string) => string | true | null | undefined;
  readonly onChange?: (value: string) => void;
};

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
      <Input
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
type HiddenInputProps = {
  readonly name: string;
  readonly value: string;
};

export function HiddenInput({ name, value }: HiddenInputProps) {
  return <input type="hidden" name={name} value={value} />;
}

type RadioOption = {
  readonly value: string;
  readonly label: string;
};

type RadioGroupProps = {
  readonly title: string;
  readonly name: string;
  readonly options: readonly RadioOption[];
  readonly value?: string;
  readonly defaultValue?: string;
  readonly size?: "sm" | "md";
  readonly required?: boolean;
  readonly error?: string;
  readonly onChange?: (value: string) => void;
};

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
type CheckboxProps = {
  readonly label: string;
  readonly name: string;
  readonly value?: string;
  readonly selected?: boolean;
  readonly defaultSelected?: boolean;
  readonly indeterminate?: boolean;
  readonly required?: boolean;
  readonly size?: "sm" | "md";
  readonly error?: string;
  readonly onChange?: (selected: boolean) => void;
};

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
type TextareaProps = {
  readonly label: string;
  readonly name: string;
  readonly required?: boolean;
  readonly defaultValue?: string;
  readonly error?: string;
  readonly rows?: number;
  readonly placeholder?: string;
  readonly onChange?: (value: string) => void;
};

export function Textarea({
  label,
  name,
  required,
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
      <TextArea
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
