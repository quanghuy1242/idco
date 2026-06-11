// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  Checkbox,
  Form,
  HiddenInput,
  RadioGroup,
  Textarea,
  TextInput,
} from "@idco/ui";

describe("Form", () => {
  it("renders a form element", () => {
    render(
      <Form>
        <button type="submit">Submit</button>
      </Form>,
    );
    expect(
      screen.getByRole("button", { name: /submit/i }).closest("form"),
    ).toBeInTheDocument();
  });
});

describe("TextInput", () => {
  it("renders a labeled input", () => {
    render(<TextInput label="Email" name="email" />);
    expect(screen.getByText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /email/i })).toBeInTheDocument();
  });

  it("renders email type input", () => {
    render(<TextInput label="Email" name="email" type="email" />);
    const input = screen.getByRole("textbox", { name: /email/i });
    expect(input).toHaveAttribute("type", "email");
  });

  it("renders password type input", () => {
    render(<TextInput label="Password" name="password" type="password" />);
    const input = screen.getByLabelText(/password/i);
    expect(input).toHaveAttribute("type", "password");
  });

  it("sets required attribute", () => {
    render(<TextInput label="Name" name="name" required />);
    const input = screen.getByRole("textbox", { name: /name/i });
    expect(input).toBeRequired();
  });

  it("sets autoComplete attribute", () => {
    render(<TextInput label="Email" name="email" autoComplete="username" />);
    const input = screen.getByRole("textbox", { name: /email/i });
    expect(input).toHaveAttribute("autoComplete", "username");
  });

  it("sets defaultValue", () => {
    render(<TextInput label="Name" name="name" defaultValue="John" />);
    const input = screen.getByRole("textbox", { name: /name/i });
    expect(input).toHaveValue("John");
  });

  it("supports controlled values", () => {
    const { rerender } = render(
      <TextInput label="Name" name="name" value="Ada" onChange={() => {}} />,
    );
    expect(screen.getByRole("textbox", { name: /name/i })).toHaveValue("Ada");

    rerender(
      <TextInput label="Name" name="name" value="Grace" onChange={() => {}} />,
    );
    expect(screen.getByRole("textbox", { name: /name/i })).toHaveValue("Grace");
  });

  it("supports controlled textarea values", () => {
    render(
      <Textarea
        label="Body"
        name="body"
        value="Existing"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("textbox", { name: /body/i })).toHaveValue(
      "Existing",
    );
  });

  it("can hide the optional label suffix", () => {
    render(
      <TextInput label="Filter" name="filter" showOptionalLabel={false} />,
    );
    expect(screen.getByText("Filter")).toBeInTheDocument();
    expect(screen.queryByText(/optional/i)).toBeNull();
  });

  it("shows error message when error prop is provided", () => {
    render(<TextInput label="Email" name="email" error="Invalid email" />);
    expect(screen.getByText(/invalid email/i)).toBeInTheDocument();
  });

  it("sets aria-invalid when error is present", () => {
    render(<TextInput label="Email" name="email" error="Invalid email" />);
    const input = screen.getByRole("textbox", { name: /email/i });
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("does not set aria-invalid when no error", () => {
    render(<TextInput label="Email" name="email" />);
    const input = screen.getByRole("textbox", { name: /email/i });
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("applies input-error class when error is present", () => {
    render(<TextInput label="Email" name="email" error="Invalid" />);
    const input = screen.getByRole("textbox", { name: /email/i });
    expect(input).toHaveClass("input-error");
  });

  it("uses default input size instead of input-sm", () => {
    render(<TextInput label="Email" name="email" />);
    const input = screen.getByRole("textbox", { name: /email/i });
    expect(input).not.toHaveClass("input-sm");
  });

  it("applies input-sm when small size is specified", () => {
    render(<TextInput label="Email" name="email" size="sm" />);
    const input = screen.getByRole("textbox", { name: /email/i });
    expect(input).toHaveClass("input-sm");
  });
});

describe("HiddenInput", () => {
  it("renders a hidden input with name and value", () => {
    render(<HiddenInput name="token" value="abc123" />);
    const input = screen.getByDisplayValue("abc123");
    expect(input).toHaveAttribute("type", "hidden");
    expect(input).toHaveAttribute("name", "token");
    expect(input).toHaveAttribute("value", "abc123");
  });
});

describe("RadioGroup", () => {
  const options = [
    { value: "option1", label: "Option 1" },
    { value: "option2", label: "Option 2" },
  ] as const;

  it("renders a fieldset with legend", () => {
    render(
      <RadioGroup
        title="Select"
        name="selection"
        options={options}
        value="option1"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/select/i)).toBeInTheDocument();
  });

  it("renders all radio options", () => {
    render(
      <RadioGroup
        title="Select"
        name="selection"
        options={options}
        value="option1"
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText(/option 1/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/option 2/i)).toBeInTheDocument();
  });

  it("checks the radio matching the value prop", () => {
    render(
      <RadioGroup
        title="Select"
        name="selection"
        options={options}
        value="option2"
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText(/option 1/i)).not.toBeChecked();
    expect(screen.getByLabelText(/option 2/i)).toBeChecked();
  });

  it("calls onChange with the correct value when a radio is clicked", () => {
    const onChange = vi.fn<(value: string) => void>();
    render(
      <RadioGroup
        title="Select"
        name="selection"
        options={options}
        value="option1"
        onChange={onChange}
      />,
    );
    screen.getByLabelText(/option 2/i).click();
    expect(onChange).toHaveBeenCalledWith("option2");
  });

  it("uses default radio size instead of radio-xs", () => {
    render(
      <RadioGroup
        title="Select"
        name="selection"
        options={options}
        value="option1"
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText(/option 1/i)).not.toHaveClass("radio-xs");
  });

  it("applies radio-sm when small size is specified", () => {
    const { container } = render(
      <RadioGroup
        title="Select"
        name="selection"
        options={options}
        value="option1"
        size="sm"
        onChange={() => {}}
      />,
    );
    expect(container.querySelector(".radio")).toHaveClass("radio-sm");
  });

  it("uses a real DaisyUI radio input for the active radio", () => {
    render(
      <RadioGroup
        title="Select"
        name="selection"
        options={options}
        value="option1"
        onChange={() => {}}
      />,
    );
    const selectedRadio = screen.getByLabelText(/option 1/i);
    expect(selectedRadio).toHaveAttribute("type", "radio");
    expect(selectedRadio).toHaveClass("radio", "radio-primary");
    expect(selectedRadio).toBeChecked();
  });

  it("shows error message when error prop is set", () => {
    render(
      <RadioGroup
        title="Select"
        name="selection"
        options={options}
        error="You must pick an option."
      />,
    );
    expect(screen.getByText("You must pick an option.")).toBeInTheDocument();
  });

  it("works uncontrolled with defaultValue", () => {
    render(
      <RadioGroup
        title="Select"
        name="selection"
        options={options}
        defaultValue="option2"
      />,
    );
    expect(screen.getByLabelText(/option 1/i)).not.toBeChecked();
    expect(screen.getByLabelText(/option 2/i)).toBeChecked();
  });

  it("selects option when clicked in uncontrolled mode", () => {
    const onChange = vi.fn<(value: string) => void>();
    render(
      <RadioGroup
        title="Select"
        name="selection"
        options={options}
        defaultValue="option1"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(/option 2/i));
    expect(screen.getByLabelText(/option 2/i)).toBeChecked();
    expect(onChange).toHaveBeenCalledWith("option2");
  });
});

describe("Checkbox", () => {
  it("renders a labeled checkbox", () => {
    render(<Checkbox label="Accept terms" name="terms" value="yes" />);
    const checkbox = screen.getByLabelText(/accept terms/i);
    expect(checkbox).toHaveAttribute("type", "checkbox");
    expect(checkbox).toHaveAttribute("name", "terms");
    expect(checkbox).toHaveAttribute("value", "yes");
  });

  it("applies checkbox-sm when small size is specified", () => {
    const { container } = render(
      <Checkbox label="Accept terms" name="terms" size="sm" />,
    );
    expect(container.querySelector(".checkbox")).toHaveClass("checkbox-sm");
  });

  it("calls onChange when toggled", () => {
    const onChange = vi.fn<(selected: boolean) => void>();
    render(
      <Checkbox
        label="Subscribe"
        name="subscribe"
        value="yes"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(/subscribe/i));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("renders as checked when selected", () => {
    render(<Checkbox label="Accept" name="accept" selected />);
    expect(screen.getByLabelText(/accept/i)).toBeChecked();
  });

  it("renders as unchecked by default", () => {
    render(<Checkbox label="Accept" name="accept" />);
    expect(screen.getByLabelText(/accept/i)).not.toBeChecked();
  });

  it("shows error message when error prop is set", () => {
    render(<Checkbox label="Accept" name="accept" error="Required field" />);
    expect(screen.getByText("Required field")).toBeInTheDocument();
  });

  it("renders indeterminate checkbox", () => {
    render(<Checkbox label="Select all" name="selectAll" indeterminate />);
    const input = screen.getByLabelText(/select all/i) as HTMLInputElement;
    expect(input.indeterminate).toBe(true);
  });

  it("shows checked + indeterminate together", () => {
    render(<Checkbox label="Parent" name="parent" selected indeterminate />);
    const input = screen.getByLabelText(/parent/i) as HTMLInputElement;
    expect(input).toBeChecked();
    expect(input.indeterminate).toBe(true);
  });
});

describe("Textarea", () => {
  it("renders a labeled textarea", () => {
    render(<Textarea label="Notes" name="notes" />);
    expect(screen.getByText(/notes/i)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /notes/i })).toBeInTheDocument();
  });

  it("sets defaultValue", () => {
    render(
      <Textarea label="Notes" name="notes" defaultValue='{"key":"value"}' />,
    );
    expect(screen.getByRole("textbox", { name: /notes/i })).toHaveValue(
      '{"key":"value"}',
    );
  });

  it("sets required attribute", () => {
    render(<Textarea label="Notes" name="notes" required />);
    expect(screen.getByRole("textbox", { name: /notes/i })).toBeRequired();
  });

  it("shows error message when error prop is provided", () => {
    render(<Textarea label="Notes" name="notes" error="Must be valid JSON" />);
    expect(screen.getByText(/must be valid json/i)).toBeInTheDocument();
  });

  it("applies textarea-error class when error is present", () => {
    render(<Textarea label="Notes" name="notes" error="Invalid" />);
    const textarea = screen.getByRole("textbox", { name: /notes/i });
    expect(textarea).toHaveClass("textarea-error");
  });

  it("applies font-mono class for code-friendly display", () => {
    render(<Textarea label="Notes" name="notes" />);
    const textarea = screen.getByRole("textbox", { name: /notes/i });
    expect(textarea).toHaveClass("font-mono");
  });

  it("calls onChange when value changes", () => {
    const onChange = vi.fn<(value: string) => void>();
    render(<Textarea label="Notes" name="notes" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: /notes/i }), {
      target: { value: "hello" },
    });
    expect(onChange).toHaveBeenCalled();
  });

  it("renders placeholder when provided", () => {
    render(<Textarea label="Notes" name="notes" placeholder="Enter JSON..." />);
    expect(screen.getByPlaceholderText("Enter JSON...")).toBeInTheDocument();
  });
});
