// docs/010 §5.5 / §7.4 — bind an EditContext to one host element. On Chromium
// the native `EditContext` drives the host; elsewhere (or when forced) the
// vendored polyfill provides it through a hidden-textarea bridge. The engine
// only ever touches the EditContext API surface, so the two are invisible here.

import {
  install,
  syncPolyfillSelection,
} from "../vendor/editcontext-polyfill";

/** The EditContext surface the controllers depend on (native or polyfilled). */
export type EditContextLike = EventTarget & {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  updateText(rangeStart: number, rangeEnd: number, text: string): void;
  updateSelection(start: number, end: number): void;
  updateControlBounds(controlBounds: DOMRect): void;
  updateSelectionBounds(selectionBounds: DOMRect): void;
  updateCharacterBounds(
    rangeStart: number,
    characterBounds: readonly DOMRect[],
  ): void;
};

type EditContextConstructor = new (init?: {
  text?: string;
  selectionStart?: number;
  selectionEnd?: number;
}) => EditContextLike;

export type EditContextHost = {
  readonly editContext: EditContextLike;
  /** Whether the polyfill (not native EditContext) is driving this host. */
  readonly polyfilled: boolean;
  /** Re-align the polyfill input sink after engine-driven selection moves. */
  readonly syncInputSelection: () => void;
  readonly destroy: () => void;
};

export type CreateEditContextHostOptions = {
  readonly host: HTMLElement;
  readonly initialText?: string;
  /** Force the polyfill path even when native EditContext exists (AC5). */
  readonly forcePolyfill?: boolean;
};

export function createEditContextHost(
  options: CreateEditContextHostOptions,
): EditContextHost {
  const { host, initialText = "", forcePolyfill = false } = options;
  const view = host.ownerDocument.defaultView ?? window;
  const hasNative =
    typeof (view as { EditContext?: unknown }).EditContext === "function";
  const polyfilled = forcePolyfill || !hasNative;

  if (polyfilled) {
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

  // docs/010 §7.4: the `data-editcontext-active` marker is polyfill-only — never
  // set it on the native Chromium path, where it would suppress the native
  // `::selection` painting the native path may rely on.
  if (polyfilled) host.setAttribute("data-editcontext-active", "");

  // Attach. Native: real `HTMLElement.editContext`. Polyfill: the patched
  // setter wires the hidden-textarea bridge for this host.
  (host as unknown as { editContext: EditContextLike }).editContext =
    editContext;

  const syncInputSelection = (): void => {
    if (polyfilled) syncPolyfillSelection(host);
  };

  const destroy = (): void => {
    (host as unknown as { editContext: EditContextLike | null }).editContext =
      null;
    host.removeAttribute("data-editcontext-active");
  };

  return { editContext, polyfilled, syncInputSelection, destroy };
}
