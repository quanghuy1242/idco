"use client";

/**
 * Confirmation / acknowledge modal built on React Aria overlays with DaisyUI modal styling.
 *
 * @categoryDefault Overlays
 */

// DaisyUI 5: https://daisyui.com/components/modal/
// React Aria: https://react-spectrum.adobe.com/react-aria/Dialog.html
import {
  useLayoutEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Dialog,
  Modal,
  ModalOverlay,
  Heading as DialogHeading,
} from "react-aria-components";
import { Alert } from "./alert";
import { Button } from "./button";
import { Form } from "./form";
import { getActiveThemeName } from "./theme";

/** Max-width preset for the dialog box; widen to `lg`/`xl` for builder-heavy forms. */
export type ConfirmDialogSize = "sm" | "md" | "lg" | "xl";

// Wider than DaisyUI's narrow `modal-box` default so multi-field forms read as a
// panel, not a tall thin column. Pick `lg`/`xl` for builder-heavy dialogs.
const sizeClass: Record<ConfirmDialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
};

/** Props for {@link ConfirmDialog}. */
type ConfirmDialogProps = {
  /** Whether the modal is open (controlled). */
  readonly open: boolean;
  /** Called when the user requests open/close (confirm, cancel, dismiss, Escape). */
  readonly onOpenChange: (open: boolean) => void;
  /** Heading text, wired as the dialog's accessible title. */
  readonly title: string;
  /** Optional supporting copy under the title. */
  readonly description?: string;
  /** Confirm button label; defaults to "Confirm". */
  readonly confirmLabel?: string;
  /** Cancel button label; defaults to "Cancel". */
  readonly cancelLabel?: string;
  /**
   * Hide the cancel button, leaving a single action — for a read-only / acknowledge
   * dialog (a JSON viewer, a preview) where a separate Cancel and Close are redundant.
   */
  readonly hideCancel?: boolean;
  /** Confirm-button intent; `danger` styles a destructive action. Defaults to `primary`. */
  readonly variant?: "primary" | "danger";
  /** Dialog width preset; defaults to `md`. */
  readonly size?: ConfirmDialogSize;
  /** Error message rendered as an inline alert above the actions; keeps the dialog open. */
  readonly error?: string;
  /**
   * Submit handler receiving the dialog form's `FormData`. Return `false` (or throw) to
   * keep the dialog open; any other result closes it. May be async.
   */
  readonly onConfirm: (
    formData: FormData,
  ) => boolean | void | Promise<boolean | void>;
  /** Disable the confirm button (e.g. while inputs are invalid). */
  readonly confirmDisabled?: boolean;
  /** Body content; typically the form fields collected into `FormData`. */
  readonly children?: ReactNode;
};

/**
 * A confirmation modal whose body submits as a form, with typed danger variant and inline error.
 *
 * @example
 * <ConfirmDialog open={open} onOpenChange={setOpen} title="Delete post"
 *   variant="danger" onConfirm={() => deletePost(id)}>
 *   This cannot be undone.
 * </ConfirmDialog>
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  hideCancel = false,
  variant = "primary",
  size = "md",
  error,
  onConfirm,
  confirmDisabled,
  children,
}: ConfirmDialogProps) {
  const [themeName, setThemeName] = useState("idco-light");

  useLayoutEffect(() => {
    setThemeName(getActiveThemeName());
  }, [open]);

  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={onOpenChange}
      isDismissable
      className="modal modal-open bg-black/40 data-[entering]:animate-modal-overlay-in data-[exiting]:animate-modal-overlay-out"
    >
      <Modal
        data-theme={themeName}
        className={`modal-box w-full ${sizeClass[size]} data-[entering]:animate-modal-panel-in data-[exiting]:animate-modal-panel-out`}
      >
        <Dialog className="outline-none">
          {({ close }) => (
            <Form
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                void (async () => {
                  try {
                    const shouldClose = await onConfirm(formData);
                    if (shouldClose !== false) close();
                  } catch {
                    // Keep the dialog open when submit fails; callers can surface errors via the error prop.
                  }
                })();
              }}
            >
              <DialogHeading slot="title" className="font-bold text-lg">
                {title}
              </DialogHeading>
              {description && (
                <p className="py-4 text-base-content/70">{description}</p>
              )}
              {error ? <Alert tone="error">{error}</Alert> : null}
              {children && (
                <div className="flex flex-col gap-3 py-2">{children}</div>
              )}
              <div className="modal-action">
                {hideCancel ? null : (
                  <Button type="button" variant="secondary" onClick={close}>
                    {cancelLabel}
                  </Button>
                )}
                <Button
                  type="submit"
                  variant={variant === "danger" ? "danger" : "primary"}
                  disabled={confirmDisabled}
                >
                  {confirmLabel}
                </Button>
              </div>
            </Form>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
