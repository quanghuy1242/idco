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
import {
  createTextInputController,
  type OwnedInputDiagnostics,
} from "../packages/editor/src/owned-model/core";

export default {
  title: "Owned Model / Input Spike",
} satisfies StoryDefault;

type ImeTraceEvent = {
  readonly atMs: number;
  readonly type: string;
  readonly key?: string;
  readonly code?: string;
  readonly data?: string | null;
  readonly inputType?: string;
  readonly isComposing?: boolean;
  readonly cancelable?: boolean;
  readonly defaultPrevented?: boolean;
  readonly model?: Pick<
    OwnedInputDiagnostics,
    "text" | "anchor" | "focus" | "composing" | "lastEvent"
  >;
  readonly textarea?: {
    readonly value: string;
    readonly selectionStart: number;
    readonly selectionEnd: number;
  };
};

type ImeTrace = {
  readonly schemaVersion: 1;
  readonly source: {
    readonly os: string;
    readonly browser: string;
    readonly backend: "native-editcontext" | "forced-polyfill" | "polyfill";
    readonly inputMethod: string;
    readonly story: string;
    readonly capturedAt: string;
  };
  readonly scenario: {
    readonly name: string;
    readonly initialText: string;
    readonly initialSelection: {
      readonly anchor: number;
      readonly focus: number;
    };
    readonly expectedFinalText: string;
    readonly expectedFinalSelection: {
      readonly anchor: number;
      readonly focus: number;
    };
  };
  readonly events: readonly ImeTraceEvent[];
};

const TRACE_KEY = "__IDCO_OWNED_IME_TRACE__";
const TRACE_CONTROL_KEY = "__IDCO_OWNED_TRACE_CONTROL__";

function hiddenTextarea(host: HTMLElement): HTMLTextAreaElement | null {
  return host.shadowRoot?.querySelector("textarea") ?? null;
}

function inputEventFields(
  event: Event,
): Pick<ImeTraceEvent, "data" | "inputType" | "isComposing" | "cancelable"> {
  if (!(event instanceof InputEvent)) return {};
  return {
    cancelable: event.cancelable,
    data: event.data,
    inputType: event.inputType,
    isComposing: event.isComposing,
  };
}

function keyEventFields(
  event: Event,
): Pick<ImeTraceEvent, "key" | "code" | "isComposing"> {
  if (!(event instanceof KeyboardEvent)) return {};
  return {
    code: event.code,
    isComposing: event.isComposing,
    key: event.key,
  };
}

function InputSpike({ force }: { readonly force: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLOutputElement>(null);
  const traceRef = useRef<ImeTraceEvent[]>([]);
  // Auto-record from mount so a capture always happens without needing a
  // (easy-to-miss on mobile) Start-trace tap. Stop trace still pauses it.
  const recordingRef = useRef(true);
  const dumpRef = useRef<HTMLTextAreaElement>(null);
  // Lets the Copy button regenerate a fresh trace at tap time instead of
  // reading a stale global published during an earlier render.
  const publishRef = useRef<() => void>(() => {});

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

    function publishTrace(): void {
      const diagnostics = controller.getDiagnostics();
      const trace: ImeTrace = {
        schemaVersion: 1,
        source: {
          backend:
            diagnostics.inputBackend === "native"
              ? "native-editcontext"
              : force
                ? "forced-polyfill"
                : "polyfill",
          browser: navigator.userAgent,
          capturedAt: new Date().toISOString(),
          inputMethod: "manual",
          os: navigator.platform,
          story: force ? "ForcedPolyfill" : "Native",
        },
        scenario: {
          expectedFinalSelection: {
            anchor: diagnostics.anchor,
            focus: diagnostics.focus,
          },
          expectedFinalText: diagnostics.text,
          initialSelection: { anchor: 0, focus: 0 },
          initialText: "",
          name: "manual-capture",
        },
        events: traceRef.current,
      };
      (window as unknown as Record<string, unknown>)[TRACE_KEY] = trace;
      if (countRef.current) {
        countRef.current.textContent = String(traceRef.current.length);
      }
    }
    publishRef.current = publishTrace;

    function record(event: Event): void {
      if (!recordingRef.current) return;
      const diagnostics = controller.getDiagnostics();
      const textarea = hiddenTextarea(host);
      traceRef.current = [
        ...traceRef.current,
        {
          ...inputEventFields(event),
          ...keyEventFields(event),
          atMs: Math.round(performance.now()),
          defaultPrevented: event.defaultPrevented,
          model: {
            anchor: diagnostics.anchor,
            composing: diagnostics.composing,
            focus: diagnostics.focus,
            lastEvent: diagnostics.lastEvent,
            text: diagnostics.text,
          },
          textarea: textarea
            ? {
                selectionEnd: textarea.selectionEnd,
                selectionStart: textarea.selectionStart,
                value: textarea.value,
              }
            : undefined,
          type: event.type,
        },
      ];
      publishTrace();
    }

    const eventTypes = [
      "keydown",
      "keyup",
      "compositionstart",
      "compositionupdate",
      "compositionend",
      "beforeinput",
      "input",
      "copy",
      "cut",
      "paste",
    ];
    for (const type of eventTypes) host.addEventListener(type, record, true);
    host.ownerDocument.addEventListener("selectionchange", record, true);
    publishTrace();

    (window as unknown as Record<string, unknown>)[TRACE_CONTROL_KEY] = {
      clear: () => {
        traceRef.current = [];
        publishTrace();
      },
      start: () => {
        recordingRef.current = true;
      },
      stop: () => {
        recordingRef.current = false;
        publishTrace();
      },
    };

    return () => {
      for (const type of eventTypes) {
        host.removeEventListener(type, record, true);
      }
      host.ownerDocument.removeEventListener("selectionchange", record, true);
      delete (window as unknown as Record<string, unknown>)[TRACE_KEY];
      delete (window as unknown as Record<string, unknown>)[TRACE_CONTROL_KEY];
      controller.destroy();
    };
  }, [force]);

  return (
    <div style={{ display: "grid", gap: "0.75rem", maxWidth: "40rem" }}>
      <p style={{ font: "14px/1.5 system-ui, sans-serif", margin: 0 }}>
        EditContext input spike ({force ? "forced API polyfill" : "default"}).
        Click to focus, then type. Arrow keys move the caret; Shift+Arrow and
        drag select. The caret and selection are engine-painted from the model.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <button
          data-owned-trace-start=""
          type="button"
          onClick={() => {
            traceRef.current = [];
            recordingRef.current = true;
            if (countRef.current) countRef.current.textContent = "0";
          }}
        >
          Start trace
        </button>
        <button
          data-owned-trace-stop=""
          type="button"
          onClick={() => {
            recordingRef.current = false;
            if (countRef.current) {
              countRef.current.textContent = String(traceRef.current.length);
            }
          }}
        >
          Stop trace
        </button>
        <output ref={countRef} data-owned-trace-count="">
          0
        </output>
        <button
          data-owned-trace-copy=""
          type="button"
          onClick={() => {
            // Regenerate the trace from the live controller/events first, so
            // the dump reflects what was just typed, not a stale snapshot.
            publishRef.current();
            const text = JSON.stringify(
              (window as unknown as Record<string, unknown>)[TRACE_KEY] ?? {
                error:
                  "no trace yet — type into the box above, then Copy trace",
              },
              null,
              2,
            );
            if (dumpRef.current) {
              dumpRef.current.value = text;
              dumpRef.current.focus();
              dumpRef.current.select();
            }
            // Clipboard may be unavailable on non-secure origins (Firefox
            // Android over http); the textarea below is the manual fallback.
            void navigator.clipboard?.writeText(text).catch(() => {});
          }}
        >
          Copy trace
        </button>
      </div>
      <textarea
        ref={dumpRef}
        data-owned-trace-dump=""
        readOnly
        aria-label="Recorded IME trace dump"
        placeholder="Tap 'Copy trace' to dump recorded events here, then long-press → Select all → Copy."
        style={{
          minHeight: "12rem",
          padding: "0.5rem",
          font: "12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
          whiteSpace: "pre",
          overflow: "auto",
        }}
      />
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
      <textarea
        data-owned-ime-baseline=""
        aria-label="Plain textarea IME baseline"
        placeholder="Plain textarea baseline"
        style={{
          minHeight: "3rem",
          padding: "0.5rem",
          font: "14px/1.5 system-ui, sans-serif",
        }}
      />
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
