// docs/010 Phase 2 — Input + caret + selection spike. Binds one EditContext to
// one host element rendering a single plain-text block, with the owned-model
// core controllers driving input, caret, and selection. Two variants exercise
// the same EditContext API contract: `Native` uses the platform implementation
// when available, and `ForcedPolyfill` forces our API polyfill even on Chromium
// (AC5).
//
// Driven by tests/e2e/owned-model-input.spec.ts across chromium/webkit/firefox.

import type { Story, StoryDefault } from "@ladle/react";
import { useEffect, useRef, useState } from "react";
import { createTextInputController } from "../packages/editor/src/owned-model/core";

export default {
  title: "Owned Model / Input Spike",
} satisfies StoryDefault;

function InputSpike({ force }: { readonly force: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const textElement = host.querySelector<HTMLElement>("[data-owned-text]");
    const overlayElement = host.querySelector<HTMLElement>(
      "[data-owned-overlay]",
    );
    if (!textElement || !overlayElement) return;

    const controller = createTextInputController({
      host,
      textElement,
      overlayElement,
      initialText: "",
      forcePolyfill: force,
      publishGlobal: true,
    });
    return () => controller.destroy();
  }, [force]);

  return (
    <div style={{ display: "grid", gap: "0.75rem", maxWidth: "40rem" }}>
      <p style={{ font: "14px/1.5 system-ui, sans-serif", margin: 0 }}>
        EditContext input spike ({force ? "forced API polyfill" : "default"}).
        Click to focus, then type. Arrow keys move the caret; Shift+Arrow and
        drag select. The caret and selection are engine-painted from the model.
      </p>
      <div
        ref={hostRef}
        data-owned-host=""
        aria-label="Owned model input spike"
        role="textbox"
        aria-multiline="true"
        style={{
          position: "relative",
          minHeight: "6rem",
          padding: "0.75rem 1rem",
          border: "1px solid #888",
          borderRadius: "8px",
          font: "16px/1.6 system-ui, sans-serif",
          whiteSpace: "pre-wrap",
          cursor: "text",
          background: "#fff",
          color: "#111",
        }}
      >
        <div data-owned-text="" />
        <div
          data-owned-overlay=""
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}

export const Native: Story = () => <InputSpike force={false} />;
export const ForcedPolyfill: Story = () => <InputSpike force />;

export const SwitchingHarness: Story = () => {
  const [force, setForce] = useState(true);
  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <button
        data-owned-switch=""
        type="button"
        onClick={() => setForce(false)}
      >
        Switch to native
      </button>
      {/* The forced-polyfill bridge creates a shadow root, and browsers do not
      allow removing a shadow root from an existing host. Remount on backend
      switches so the native story gets the same clean host a real page load
      would provide. */}
      <InputSpike key={force ? "polyfill" : "native"} force={force} />
    </div>
  );
};
