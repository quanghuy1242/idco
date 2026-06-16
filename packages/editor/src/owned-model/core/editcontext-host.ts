// docs/010 §5.5 / §7.4 — bind the exact EditContext API to one host element.
// Native EditContext and this package's hidden-textarea implementation are two
// implementations of the same contract; backend-specific glue is contained in
// this adapter so editor controllers do not grow native-vs-polyfill behavior.

import {
  install,
  releaseForcedInstall,
  syncPolyfillSelection,
} from "../vendor/editcontext-polyfill";

/** The exact EditContext surface the controllers depend on. */
export type EditContextLike = EventTarget & {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  readonly isComposing?: boolean;
  readonly compositionStart?: number;
  readonly compositionEnd?: number;
  updateText(rangeStart: number, rangeEnd: number, text: string): void;
  updateSelection(start: number, end: number): void;
  updateControlBounds(controlBounds: DOMRect): void;
  updateSelectionBounds(selectionBounds: DOMRect): void;
  updateCharacterBounds(
    rangeStart: number,
    characterBounds: readonly DOMRect[],
  ): void;
};

export type EditContextBackend = "native" | "polyfill";

export type EditContextReplacementResult = {
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
};

type EditContextConstructor = new (init?: {
  text?: string;
  selectionStart?: number;
  selectionEnd?: number;
}) => EditContextLike;

type MaybePolyfilledEditContextConstructor = EditContextConstructor & {
  readonly isIdcoPolyfill?: boolean;
};

export type EditContextHost = {
  readonly editContext: EditContextLike;
  /** Which EditContext implementation is active; exposed for tests only. */
  readonly backend: EditContextBackend;
  /** Focus the active implementation's input sink. */
  readonly focus: () => void;
  /**
   * Replace text through the EditContext API and collapse the selection after
   * the inserted text. Editor commands use this for text insertion so native
   * and hidden-textarea implementations observe the same contract.
   */
  readonly replaceText: (
    rangeStart: number,
    rangeEnd: number,
    text: string,
  ) => EditContextReplacementResult;
  /** Re-align the active implementation's input sink after selection moves. */
  readonly syncInputSelection: () => void;
  readonly destroy: () => void;
};

export type CreateEditContextHostOptions = {
  readonly host: HTMLElement;
  readonly initialText?: string;
  /** Force the API polyfill even when native EditContext exists (AC5). */
  readonly forcePolyfill?: boolean;
};

export function createEditContextHost(
  options: CreateEditContextHostOptions,
): EditContextHost {
  const { host, initialText = "", forcePolyfill = false } = options;
  const view = host.ownerDocument.defaultView ?? window;
  const activeCtor = (view as { EditContext?: unknown }).EditContext as
    | MaybePolyfilledEditContextConstructor
    | undefined;
  const hasNative =
    typeof activeCtor === "function" && activeCtor.isIdcoPolyfill !== true;
  const backend: EditContextBackend =
    forcePolyfill || !hasNative ? "polyfill" : "native";

  if (backend === "polyfill") {
    install({ force: forcePolyfill });
  }

  const Ctor = (view as unknown as { EditContext: EditContextConstructor })
    .EditContext;
  const editContext = new Ctor({
    text: initialText,
    selectionStart: initialText.length,
    selectionEnd: initialText.length,
  });

  if (host.tabIndex < 0) host.tabIndex = 0;

  // Attach through the platform shape. Native uses the browser's
  // `HTMLElement.editContext`; the polyfill installs the same property and
  // wires it to the hidden-textarea input sink.
  (host as unknown as { editContext: EditContextLike }).editContext =
    editContext;

  const syncInputSelection = (): void => {
    if (backend === "polyfill") syncPolyfillSelection(host);
  };

  const focus = (): void => {
    host.focus({ preventScroll: true });
  };

  const replaceText = (
    rangeStart: number,
    rangeEnd: number,
    text: string,
  ): EditContextReplacementResult => {
    const length = editContext.text.length;
    const start = Math.min(
      Math.max(0, Math.floor(Math.min(rangeStart, rangeEnd))),
      length,
    );
    const end = Math.min(
      Math.max(0, Math.floor(Math.max(rangeStart, rangeEnd))),
      length,
    );
    editContext.updateText(start, end, text);
    const selection = start + text.length;
    editContext.updateSelection(selection, selection);
    syncInputSelection();
    return {
      text: editContext.text,
      selectionStart: editContext.selectionStart,
      selectionEnd: editContext.selectionEnd,
    };
  };

  const destroy = (): void => {
    (host as unknown as { editContext: EditContextLike | null }).editContext =
      null;
    if (forcePolyfill) releaseForcedInstall();
  };

  return {
    editContext,
    backend,
    focus,
    replaceText,
    syncInputSelection,
    destroy,
  };
}
