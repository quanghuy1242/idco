"use client";

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

type ConfirmDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly variant?: "primary" | "danger";
  readonly error?: string;
  readonly onConfirm: (
    formData: FormData,
  ) => boolean | void | Promise<boolean | void>;
  readonly confirmDisabled?: boolean;
  readonly children?: ReactNode;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "primary",
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
        className="modal-box data-[entering]:animate-modal-panel-in data-[exiting]:animate-modal-panel-out"
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
                <Button type="button" variant="secondary" onClick={close}>
                  {cancelLabel}
                </Button>
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
