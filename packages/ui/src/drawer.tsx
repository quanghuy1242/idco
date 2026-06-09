// DaisyUI 5: https://daisyui.com/components/drawer/
// React Aria: https://react-spectrum.adobe.com/react-aria/Dialog.html
"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import {
  Dialog,
  Heading as DialogHeading,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import { Button } from "./button";
import { getActiveThemeName } from "./theme";

type DrawerProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly side?: "right" | "left";
  readonly width?: "sm" | "md" | "lg";
  readonly children?: ReactNode;
};

const widthClass: Record<NonNullable<DrawerProps["width"]>, string> = {
  sm: "w-80",
  md: "w-96",
  lg: "w-[32rem]",
};

// A side panel for quick-peek detail. Prefer a route for durable, deep-linkable
// detail (docs/027 §5.12); this is for ephemeral inspection only.
export function Drawer({
  open,
  onOpenChange,
  title,
  side = "right",
  width = "md",
  children,
}: DrawerProps) {
  const [themeName, setThemeName] = useState("idco-light");

  useLayoutEffect(() => {
    setThemeName(getActiveThemeName());
  }, [open]);

  // Literal class strings (not interpolated) so Tailwind can statically detect them.
  const panelSideClass =
    side === "right"
      ? "right-0 ml-auto data-[entering]:animate-drawer-right-in data-[exiting]:animate-drawer-right-out"
      : "left-0 mr-auto data-[entering]:animate-drawer-left-in data-[exiting]:animate-drawer-left-out";

  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={onOpenChange}
      isDismissable
      className="modal modal-open bg-black/40 data-[entering]:animate-modal-overlay-in data-[exiting]:animate-modal-overlay-out"
    >
      <Modal
        data-theme={themeName}
        className={`fixed inset-y-0 flex max-w-[calc(100vw-2rem)] ${widthClass[width]} ${panelSideClass} flex-col border-base-300 bg-base-100 shadow-xl`}
      >
        <Dialog className="flex h-full flex-col outline-none">
          {({ close }) => (
            <>
              <div className="flex items-center justify-between border-b border-base-300 px-5 py-4">
                <DialogHeading
                  slot="title"
                  className="text-lg font-bold text-base-content"
                >
                  {title}
                </DialogHeading>
                <Button
                  variant="ghost"
                  size="sm"
                  circle
                  iconName="X"
                  ariaLabel="Close"
                  tooltip="Close"
                  onClick={close}
                />
              </div>
              <div className="flex-1 overflow-y-auto p-5">{children}</div>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
