"use client";

// DaisyUI 5: https://daisyui.com/components/modal/
// React Aria: https://react-spectrum.adobe.com/react-aria/Dialog.html
import { useLayoutEffect, useState } from "react";
import {
  Dialog,
  Modal,
  ModalOverlay,
  Heading as DialogHeading,
} from "react-aria-components";
import { Button } from "./button";
import { RadioGroup } from "./form";
import {
  getStoredTheme,
  applyTheme,
  getActiveThemeName,
  type ThemeMode,
} from "./theme";

/** Props for {@link ThemeDialog}. */
type ThemeDialogProps = {
  /** Whether the dialog is currently open (controlled). */
  readonly open: boolean;
  /** Called when the dialog requests to open or close (e.g. dismissal). */
  readonly onOpenChange: (open: boolean) => void;
};

/**
 * A modal for selecting the DaisyUI theme, built on React Aria with DaisyUI
 * modal styling.
 *
 * @categoryDefault Overlays
 */

/**
 * A modal that lets the user pick the system/light/dark theme mode and applies
 * the choice on confirm.
 */
export function ThemeDialog({ open, onOpenChange }: ThemeDialogProps) {
  const [themeName, setThemeName] = useState("idco-light");
  const [selected, setSelected] = useState<ThemeMode>("system");

  useLayoutEffect(() => {
    if (open) {
      setThemeName(getActiveThemeName());
      setSelected(getStoredTheme());
    }
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
            <>
              <DialogHeading slot="title" className="font-bold text-lg">
                Theme
              </DialogHeading>
              <div className="py-4">
                <RadioGroup
                  title="Appearance"
                  name="theme"
                  value={selected}
                  onChange={(value) => setSelected(value as ThemeMode)}
                  options={[
                    { value: "system", label: "System" },
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                  ]}
                />
              </div>
              <div className="modal-action">
                <Button type="button" variant="secondary" onClick={close}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    applyTheme(selected);
                    close();
                  }}
                >
                  Apply
                </Button>
              </div>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export { getStoredTheme, applyTheme, type ThemeMode } from "./theme";
