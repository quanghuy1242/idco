/**
 * Autosave / dirty-state / stale-write guard (docs/010 Phase 8 AC10, §10.5).
 *
 * A "live book platform" needs durable saves, not a Save button. This hook wires
 * the public editor handle's dirty/change events to a debounced `onSave`, marks
 * the document clean on success, and guards against two failure modes:
 *
 * - **In-flight clobber.** An edit during a save bumps a token; if the token moved
 *   by the time the save resolves, the document is *not* marked clean and another
 *   save is scheduled, so a late completion never hides a newer edit.
 * - **Stale write (multi-tab).** The host's `onSave` does the optimistic
 *   concurrency check (compare-and-set a version); when it throws a conflict the
 *   hook surfaces it through `onConflict`/`error` instead of marking clean, so a
 *   second tab cannot silently overwrite the first.
 */
import { useEffect, useRef, useState } from "react";
import type { EditorDocumentSnapshot, OwnedEditorHandle } from "../core";

export type AutosaveOptions = {
  /** Persist the snapshot. Throw to signal a save failure or a stale-write conflict. */
  readonly onSave: (snapshot: EditorDocumentSnapshot) => Promise<void>;
  /** Debounce window in ms (default 1000). */
  readonly delayMs?: number;
  /** Disable autosave (e.g. read-only or detached). */
  readonly enabled?: boolean;
  /** Called when `onSave` rejects (save failure or stale-write conflict). */
  readonly onError?: (error: unknown) => void;
};

export type AutosaveState = {
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly lastError: unknown;
};

export function useAutosave(
  handle: OwnedEditorHandle | null,
  options: AutosaveOptions,
): AutosaveState {
  const { onSave, delayMs = 1000, enabled = true, onError } = options;
  const [state, setState] = useState<AutosaveState>({
    isDirty: false,
    isSaving: false,
    lastError: null,
  });
  const tokenRef = useRef(0);
  const savingRef = useRef(false);
  const optionsRef = useRef({ onError, onSave });
  optionsRef.current = { onError, onSave };

  useEffect(() => {
    if (!enabled || !handle) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const runSave = async () => {
      if (savingRef.current) return; // a save is in flight; the token guard re-runs
      if (!handle.isDirty()) return;
      const token = tokenRef.current;
      savingRef.current = true;
      setState((prev) => ({ ...prev, isSaving: true }));
      try {
        await optionsRef.current.onSave(handle.getEditorSnapshot());
        // Only mark clean if no edit landed while saving (no clobber).
        if (tokenRef.current === token) {
          handle.markClean();
          setState({ isDirty: false, isSaving: false, lastError: null });
        } else {
          setState((prev) => ({ ...prev, isSaving: false }));
          schedule(); // a newer edit arrived mid-save; save again
        }
      } catch (error) {
        // A save failure (network error or a stale-write conflict the host's
        // onSave threw) leaves the document dirty and surfaces through onError +
        // lastState. It is deliberately NOT auto-retried here: a conflict would
        // retry-loop, and a transient failure re-saves on the next edit (or the
        // host can re-enable/force a save from onError). The dirty state stays
        // visible so nothing is silently lost.
        optionsRef.current.onError?.(error);
        setState({
          isDirty: handle.isDirty(),
          isSaving: false,
          lastError: error,
        });
      } finally {
        savingRef.current = false;
      }
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void runSave(), delayMs);
    };

    const offChange = handle.on("change", () => {
      tokenRef.current += 1;
      setState((prev) => ({ ...prev, isDirty: true }));
      schedule();
    });
    const offDirty = handle.on("dirtychange", () => {
      setState((prev) => ({ ...prev, isDirty: handle.isDirty() }));
    });

    return () => {
      if (timer) clearTimeout(timer);
      offChange();
      offDirty();
    };
  }, [delayMs, enabled, handle]);

  return state;
}
