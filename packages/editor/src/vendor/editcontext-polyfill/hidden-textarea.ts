// Creates a visually-hidden textarea that captures keyboard/IME input.
// When possible, the textarea is placed inside a shadow root on the host
// element so that :focus CSS matches the host (shadow DOM retargets focus
// to the shadow host from outside).

export interface HiddenTextarea {
  element: HTMLTextAreaElement;
  destroy: () => void;
}

// Track elements where we've attached a shadow root (permanent).
const shadowRoots = new WeakMap<HTMLElement, ShadowRoot>();
const FOCUS_OUTLINE_STYLE_ID = "idco-editcontext-polyfill-focus-outline";

function ensureFocusOutlineStyle(shadow: ShadowRoot): void {
  if (shadow.querySelector(`#${FOCUS_OUTLINE_STYLE_ID}`)) return;
  const style = shadow.ownerDocument.createElement("style");
  style.id = FOCUS_OUTLINE_STYLE_ID;
  style.textContent = `
:host(:focus),
:host(:focus-within) {
  outline: auto;
  outline: -webkit-focus-ring-color auto 1px;
}
`;
  shadow.prepend(style);
}

/**
 * Ensure the host has a shadow root with a <slot> for light DOM children.
 * Returns the shadow root, or null if shadow DOM isn't available (e.g. canvas).
 */
export function ensureShadowRoot(host: HTMLElement): ShadowRoot | null {
  const existing = shadowRoots.get(host);
  if (existing) return existing;

  // Check for user-created shadow root
  if (host.shadowRoot) {
    ensureFocusOutlineStyle(host.shadowRoot);
    shadowRoots.set(host, host.shadowRoot);
    return host.shadowRoot;
  }

  try {
    const shadow = host.attachShadow({ mode: "open" });
    ensureFocusOutlineStyle(shadow);
    // Slot preserves light DOM children visibility
    shadow.appendChild(host.ownerDocument.createElement("slot"));
    shadowRoots.set(host, shadow);
    return shadow;
  } catch {
    // Canvas and some other elements can't have shadow DOM
    return null;
  }
}

export function createHiddenTextarea(host: HTMLElement): HiddenTextarea {
  const ownerDocument = host.ownerDocument;
  const textarea = ownerDocument.createElement("textarea");
  textarea.setAttribute("autocomplete", "off");
  textarea.setAttribute("autocorrect", "off");
  textarea.setAttribute("autocapitalize", "off");
  textarea.setAttribute("spellcheck", "false");
  // No `aria-hidden` here: this textarea is the focus sink (we focus it on
  // activation), and Chrome 124+ blocks `aria-hidden` on a focused element or its
  // ancestor — "Blocked aria-hidden on an element because its descendant retained
  // focus". The host block carries the `role=textbox`/label (text-block.tsx) and
  // this proxy lives in its open shadow root, so AT follows focus to the synced
  // input correctly (mirrors CodeMirror's offscreen textarea). `inert` is not an
  // option — it would block the focus the textarea needs.
  // Prevent text wrapping — Firefox's word/line deletion boundaries depend on
  // visual line layout, so wrapping in a tiny textarea breaks them.
  textarea.setAttribute("wrap", "off");
  textarea.tabIndex = -1;

  Object.assign(textarea.style, {
    position: "fixed",
    top: "0px",
    left: "0px",
    width: "1px",
    height: "1px",
    padding: "0",
    border: "none",
    outline: "none",
    opacity: "0",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "-1",
  });

  // Prefer shadow root so :focus matches the host element.
  // Fall back to document.body (canvas can't have shadow DOM, and WebKit
  // doesn't reliably focus textarea children inside canvas elements).
  const shadow = ensureShadowRoot(host);
  if (shadow) {
    shadow.appendChild(textarea);
  } else {
    ownerDocument.body.appendChild(textarea);
  }

  return {
    element: textarea,
    destroy: () => textarea.remove(),
  };
}
