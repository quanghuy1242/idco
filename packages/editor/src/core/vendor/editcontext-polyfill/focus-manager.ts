// Manages focus redirection from EditContext-associated elements to the hidden
// textarea. A document-level focusin listener intercepts focus anywhere in an
// EditContext's editable subtree and redirects to the hidden textarea.

import { getEditContext, findEditContextHost } from "./context-registry.js";
import {
  createHiddenTextarea,
  ensureShadowRoot,
  type HiddenTextarea,
} from "./hidden-textarea.js";
import {
  createInputTranslator,
  type InputTranslator,
} from "./input-translator.js";

interface FocusBinding {
  element: HTMLElement;
  hiddenTextarea: HiddenTextarea;
  inputTranslator: InputTranslator;
  onTextareaBlur: () => void;
}

let activeBinding: FocusBinding | null = null;
let refocusing = false;
let tabbing = false;
const managedElements = new Set<HTMLElement>();
const originalBlurMethods = new WeakMap<HTMLElement, () => void>();
const originalFocusMethods = new WeakMap<
  HTMLElement,
  typeof HTMLElement.prototype.focus
>();
let listening = false;
let removalObserver: MutationObserver | null = null;
let originalActiveElementDescriptor: PropertyDescriptor | undefined;

function handleGlobalKeydown(event: KeyboardEvent): void {
  if (event.key === "Tab" && activeBinding) {
    // Chrome deactivates the current EditContext on Tab and activates the
    // new target's EditContext (if any). Set the tabbing flag so handleFocusIn
    // can deactivate the old binding before activating the new one.
    // If focus doesn't move (nothing to Tab to), the flag is cleared on the
    // next focusin or keydown. Chrome keeps the EditContext active in that case.
    tabbing = true;
    return;
  }
  // Any non-Tab keydown clears a stale tabbing flag
  tabbing = false;
}

function handleMutations(mutations: MutationRecord[]): void {
  if (!activeBinding) return;
  for (const mutation of mutations) {
    for (let i = 0; i < mutation.removedNodes.length; i++) {
      const node = mutation.removedNodes[i];
      if (
        node === activeBinding.element ||
        (node instanceof Node && node.contains(activeBinding.element))
      ) {
        deactivate();
        return;
      }
    }
  }
}

function connectRemovalObserver(): void {
  if (!removalObserver) removalObserver = new MutationObserver(handleMutations);
  removalObserver.observe(document, { childList: true, subtree: true });
}

function disconnectRemovalObserver(): void {
  removalObserver?.disconnect();
}

function installListener(): void {
  if (listening) return;
  document.addEventListener("focusin", handleFocusIn, true);
  document.addEventListener("keydown", handleGlobalKeydown, true);

  // Patch document.activeElement to return the EditContext host element
  // instead of the hidden textarea, matching Chrome native behavior.
  originalActiveElementDescriptor =
    Object.getOwnPropertyDescriptor(Document.prototype, "activeElement") ??
    Object.getOwnPropertyDescriptor(document, "activeElement");
  if (originalActiveElementDescriptor?.get) {
    const originalGet = originalActiveElementDescriptor.get;
    Object.defineProperty(document, "activeElement", {
      get() {
        const real = originalGet.call(this);
        if (activeBinding && real === activeBinding.hiddenTextarea.element) {
          return activeBinding.element;
        }
        return real;
      },
      configurable: true,
      enumerable: true,
    });
  }

  listening = true;
}

function handleFocusIn(event: FocusEvent): void {
  if (refocusing) return;

  const target = event.target;
  if (!target || !(target instanceof HTMLElement)) return;
  if (activeBinding && target === activeBinding.hiddenTextarea.element) return;

  // Chrome deactivates the old EditContext on Tab and activates the new
  // target's EditContext. Cancel the deferred deactivation timer (focusin
  // fired, so focus DID move) and deactivate the old binding synchronously
  // before falling through to activate the new target.
  if (tabbing) {
    tabbing = false;
    if (activeBinding) {
      deactivate();
    }
    // Fall through to activate the new target's EditContext
  }

  const host = findEditContextHost(target);

  if (host) {
    activateElement(host);
  } else {
    deactivate();
  }
}

export function manageElement(element: HTMLElement): void {
  if (managedElements.has(element)) return;
  managedElements.add(element);

  if (!element.hasAttribute("tabindex") && element.tabIndex < 0) {
    element.setAttribute("tabindex", "0");
  }

  // Pre-attach shadow root so :focus CSS works from the first activation.
  // This avoids a visual flash when the shadow root is created on focus.
  ensureShadowRoot(element);

  // Override focus() so calling element.focus() activates the EditContext
  // even when the host is already document.activeElement (which makes
  // the native focus() a no-op that doesn't fire focusin).
  originalFocusMethods.set(element, element.focus.bind(element));
  Object.defineProperty(element, "focus", {
    configurable: true,
    writable: true,
    value: (options?: FocusOptions) => {
      originalFocusMethods.get(element)!(options);
      activateElement(element);
    },
  });

  // Override blur() so calling element.blur() deactivates the EditContext
  originalBlurMethods.set(element, element.blur.bind(element));
  Object.defineProperty(element, "blur", {
    configurable: true,
    writable: true,
    value: () => {
      if (activeBinding?.element === element) {
        const textarea = activeBinding.hiddenTextarea.element;
        deactivate();
        textarea.blur();
      }
      originalBlurMethods.get(element)!();
    },
  });

  installListener();
}

export function unmanageElement(element: HTMLElement): void {
  managedElements.delete(element);
  if (activeBinding?.element === element) deactivate();

  // Restore original methods
  const originalBlur = originalBlurMethods.get(element);
  if (originalBlur) {
    Object.defineProperty(element, "blur", {
      configurable: true,
      writable: true,
      value: originalBlur,
    });
    originalBlurMethods.delete(element);
  }
  const originalFocus = originalFocusMethods.get(element);
  if (originalFocus) {
    Object.defineProperty(element, "focus", {
      configurable: true,
      writable: true,
      value: originalFocus,
    });
    originalFocusMethods.delete(element);
  }
}

export function activateElement(element: HTMLElement): void {
  const editContext = getEditContext(element);
  if (!editContext) return;

  // Already active — just re-focus the textarea (needed after blur/focus cycles)
  if (activeBinding?.element === element) {
    refocusing = true;
    activeBinding.hiddenTextarea.element.focus();
    refocusing = false;
    return;
  }

  if (activeBinding) deactivate();

  const hiddenTextarea = createHiddenTextarea(element);

  const inputTranslator = createInputTranslator(
    hiddenTextarea.element,
    () => getEditContext(element),
    () => element,
  );

  // Sync textarea content from the EditContext's current state
  inputTranslator.syncFromEditContext();

  // Keep textarea in sync when updateText/updateSelection are called programmatically
  editContext._onStateChange = () => inputTranslator.syncFromEditContext();

  // Position textarea at selection bounds for IME candidate window placement
  editContext._onSelectionBoundsChange = (bounds: DOMRect) => {
    hiddenTextarea.element.style.left = `${bounds.x}px`;
    hiddenTextarea.element.style.top = `${bounds.y}px`;
  };

  // When the textarea loses focus (e.g. clicking empty space on the page),
  // deactivate the EditContext. This handles cases where focusin doesn't fire
  // on the new target (non-focusable elements like body).
  const onTextareaBlur = () => {
    if (!refocusing) deactivate();
  };
  hiddenTextarea.element.addEventListener("blur", onTextareaBlur);

  activeBinding = { element, hiddenTextarea, inputTranslator, onTextareaBlur };
  connectRemovalObserver();
  element.setAttribute("data-editcontext-active", "");

  refocusing = true;
  hiddenTextarea.element.focus();
  refocusing = false;

  // With shadow DOM, focusin naturally retargets to the host element,
  // so app code already sees the correct events. Without shadow DOM
  // (canvas fallback), we dispatch synthetic events on the element.
  if (!element.shadowRoot) {
    refocusing = true;
    element.dispatchEvent(
      new FocusEvent("focus", { bubbles: false, relatedTarget: null }),
    );
    element.dispatchEvent(
      new FocusEvent("focusin", { bubbles: true, relatedTarget: null }),
    );
    refocusing = false;
  }
}

function deactivate(): void {
  if (!activeBinding) return;

  const binding = activeBinding;
  const element = binding.element;

  // Set null early to prevent re-entrant deactivation (removing the focused
  // textarea causes focusin on body → handleFocusIn → deactivate again).
  activeBinding = null;
  disconnectRemovalObserver();
  element.removeAttribute("data-editcontext-active");

  // If mid-composition, finish it before tearing down (fires compositionend)
  const editContext = getEditContext(element);
  if (editContext) {
    editContext._blur();
    editContext._onStateChange = null;
    editContext._onSelectionBoundsChange = null;
  }

  binding.hiddenTextarea.element.removeEventListener(
    "blur",
    binding.onTextareaBlur,
  );
  binding.inputTranslator.destroy();
  binding.hiddenTextarea.destroy();

  // Without shadow DOM (canvas fallback), dispatch synthetic blur/focusout.
  // With shadow DOM, removing the textarea naturally fires focusout on the host.
  if (!element.shadowRoot) {
    refocusing = true;
    element.dispatchEvent(
      new FocusEvent("blur", { bubbles: false, relatedTarget: null }),
    );
    element.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
    );
    refocusing = false;
  }
}

export function hasActiveEditContext(): boolean {
  return activeBinding !== null;
}

export function isElementActive(element: HTMLElement): boolean {
  return activeBinding?.element === element;
}

export function destroyAllBindings(): void {
  deactivate();
  managedElements.clear();
  tabbing = false;
  if (listening) {
    document.removeEventListener("focusin", handleFocusIn, true);
    document.removeEventListener("keydown", handleGlobalKeydown, true);
    disconnectRemovalObserver();
    removalObserver = null;

    // Restore original document.activeElement
    if (originalActiveElementDescriptor) {
      Object.defineProperty(
        document,
        "activeElement",
        originalActiveElementDescriptor,
      );
    } else {
      delete (document as unknown as Record<string, unknown>).activeElement;
    }
    originalActiveElementDescriptor = undefined;

    listening = false;
  }
}

export function syncElementFromEditContext(element: HTMLElement): void {
  if (activeBinding?.element === element) {
    activeBinding.inputTranslator.syncFromEditContext();
  }
}
