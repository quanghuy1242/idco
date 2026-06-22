/**
 * Subscribe a component to the store's selection + commit so any command-surface's
 * query state stays live (docs/023 §5.3, docs/024 §5.4).
 *
 * The store has no global revision and the commit hot path must not gain one, so the
 * snapshot is a hook-local counter the subscription bumps. Shared by the ribbon
 * (`ribbon.tsx`) and the flat-surface coordinator (`use-command-surfaces.ts`) so the
 * subscription wiring lives once, not duplicated per surface.
 */
import { useRef, useSyncExternalStore } from "react";
import type { EditorStore } from "../../../core";

export function useStoreVersion(store: EditorStore): number {
  const versionRef = useRef(0);
  return useSyncExternalStore(
    (listener) => {
      const bump = () => {
        versionRef.current += 1;
        listener();
      };
      const offSel = store.subscribeSelection(bump);
      const offCommit = store.subscribeCommit(() => bump());
      return () => {
        offSel();
        offCommit();
      };
    },
    () => versionRef.current,
    () => 0,
  );
}
