// Owned-model engine view layer (docs/010 §7.1). The thin React binding that
// renders the visible block window, paints the selection overlay, and hosts
// object chrome — reusing `@idco/content-renderer` and `@idco/ui`.
//
// Phase 1 only establishes the home for this layer; rendering lands in later
// phases (P4 React view + scheduler/frame loop onward).

/** Placeholder surface contract for the owned-model React view (docs/010 §7.1). */
export type OwnedModelViewPlaceholder = {
  /** Reserved until the P4 React view + scheduler/frame loop lands. */
  readonly ready: false;
};
