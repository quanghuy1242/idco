/**
 * The reader island registry (docs/015 §6.2). The read-tier mirror of the editor node
 * registry: the same `kind` string that selects a `NodeView` in the editor selects a
 * `ReaderIsland` here. An object kind with no registered island is pure static (the
 * common case); a registered island is a client enhancement layered over the static L1
 * output the server already rendered, so the static page is always complete on its own.
 *
 * This module is types + a registry map only — no `"use client"` — so the server `<Reader>`
 * can read it (to decide which kinds get a hydration boundary) without pulling client
 * code. The island components themselves are `"use client"` and live in their own files.
 */
import type { ReactNode } from "react";

/** When an island hydrates (docs/015 §6.3). Absent → never (stays static forever). */
export type ReaderIslandHydrate = "visible" | "idle" | "interaction";

/** Props the interactive half receives: its node data plus the static markup to enhance. */
export type ReaderIslandProps<Data = unknown> = {
  readonly data: Data;
  /** The server-rendered static L1 output (the children slot) the island enhances. */
  readonly children: ReactNode;
};

/**
 * One read-tier island. `Interactive` is the client enhancement; it receives its node
 * `data` plus the static L1 output as `children`. It may either wrap `children` (scroll-spy)
 * or build its own tree from `data` (live-code, checklist) — both are safe because the
 * boundary mounts it as a *post-mount swap*, never an in-place hydration over the static
 * markup (so there is no hydration mismatch; see `IslandBoundary`). `hydrate` is when the
 * enhancement activates. Note: an island that rebuilds from `data` (checklist) renders only
 * what `data` carries, so rich inline markup inside an item is not preserved once active —
 * keep island `data` lossless if that matters.
 */
export type ReaderIsland<Data = unknown> = {
  readonly kind: string;
  readonly hydrate?: ReaderIslandHydrate;
  readonly Interactive: (props: ReaderIslandProps<Data>) => ReactNode;
};

const ISLANDS = new Map<string, ReaderIsland>();

/** Register an island by kind. Idempotent (re-import/HMR replaces). */
export function registerReaderIsland<Data>(island: ReaderIsland<Data>): void {
  ISLANDS.set(island.kind, island as ReaderIsland);
}

/** The island for a kind, or undefined → render the static L1 output unenhanced. */
export function getReaderIsland(kind: string): ReaderIsland | undefined {
  return ISLANDS.get(kind);
}

/** Every registered island (test/introspection). */
export function listReaderIslands(): readonly ReaderIsland[] {
  return [...ISLANDS.values()];
}
