// DaisyUI 5: https://daisyui.com/components/toast/
// React Aria: https://react-spectrum.adobe.com/react-aria/Toast.html
"use client";

import { flushSync } from "react-dom";
import {
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as AriaToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
  UNSTABLE_ToastRegion as AriaToastRegion,
  Button as AriaButton,
  Text as AriaText,
} from "react-aria-components";
import { Check, CircleAlert, Info, TriangleAlert, X } from "lucide-react";

export type ToastTone = "success" | "error" | "info" | "warning";

export type ToastSpec = {
  readonly title: string;
  readonly description?: string;
  readonly tone?: ToastTone;
};

/**
 * Global queue, instantiated once. State lives outside React so any module —
 * action handlers, content components, route files — can raise a toast through
 * the `toast` helper without prop drilling a context.
 */
export const toastQueue = new ToastQueue<ToastSpec>({
  maxVisibleToasts: 5,
  wrapUpdate(fn) {
    if (typeof document !== "undefined" && "startViewTransition" in document) {
      document.startViewTransition(() => flushSync(fn));
    } else {
      fn();
    }
  },
});

const toneAlertClass: Record<ToastTone, string> = {
  success: "alert-success",
  error: "alert-error",
  info: "alert-info",
  warning: "alert-warning",
};

const toneIcon: Record<ToastTone, typeof Check> = {
  success: Check,
  error: CircleAlert,
  info: Info,
  warning: TriangleAlert,
};

/**
 * Mount once near the app root. Renders fixed bottom-end and is theme-aware
 * because it inherits the `data-theme` token scope from the document tree.
 */
export function ToastRegion() {
  return (
    <AriaToastRegion
      queue={toastQueue}
      className="toast toast-end toast-bottom z-[100] outline-none"
    >
      {({ toast }) => {
        const tone = toast.content.tone ?? "info";
        const ToneIcon = toneIcon[tone];
        return (
          <AriaToast
            toast={toast}
            className={`alert ${toneAlertClass[tone]} shadow-lg max-w-sm items-start gap-3 data-[entering]:animate-popover-in data-[exiting]:animate-popover-out`}
          >
            <ToneIcon className="size-5 shrink-0" aria-hidden="true" />
            <AriaToastContent className="flex min-w-0 flex-col gap-0.5">
              <AriaText slot="title" className="text-sm font-semibold">
                {toast.content.title}
              </AriaText>
              {toast.content.description ? (
                <AriaText slot="description" className="text-xs opacity-90">
                  {toast.content.description}
                </AriaText>
              ) : null}
            </AriaToastContent>
            <AriaButton
              slot="close"
              aria-label="Dismiss notification"
              className="btn btn-ghost btn-circle btn-xs -mr-1 -mt-1 shrink-0"
            >
              <X className="size-4" aria-hidden="true" />
            </AriaButton>
          </AriaToast>
        );
      }}
    </AriaToastRegion>
  );
}

// 5s is the accessibility minimum for an auto-dismissing toast.
const defaultTimeout = 5000;

function show(spec: ToastSpec, timeout?: number): string {
  // Errors persist until dismissed; everything else auto-dismisses.
  return toastQueue.add(spec, timeout ? { timeout } : undefined);
}

/**
 * Raise a notification from anywhere. Success/info/warning auto-dismiss after
 * 5s (the a11y minimum); errors stay until the user closes them.
 */
export const toast = {
  success: (title: string, description?: string): string =>
    show({ title, description, tone: "success" }, defaultTimeout),
  info: (title: string, description?: string): string =>
    show({ title, description, tone: "info" }, defaultTimeout),
  warning: (title: string, description?: string): string =>
    show({ title, description, tone: "warning" }, defaultTimeout),
  error: (title: string, description?: string): string =>
    show({ title, description, tone: "error" }),
  dismiss: (key: string): void => toastQueue.close(key),
};
