/**
 * Suggestion Source SPI — the host-owned store for proposals (docs/036 §7.3; docs/038 §10, §17,
 * R6-J J5).
 *
 * A suggested edit is host-owned, exactly like a comment thread (docs/036 §7.3, the sibling posture
 * of `comment-source-registry.ts`): the live document is never polluted with pending markup — it
 * carries at most a discussion anchor — and the change itself is the op-log the source holds. A
 * deployment registers a `SuggestionSource` (a DB, a per-session queue, or the streamed output of an
 * async agent per docs/037) the same way it registers a `CommentSource`, and the Changes pane + the
 * woven review read proposals through it.
 *
 * Shape mirrors the sibling registries: a module-level singleton, register-by-id, idempotent so an HMR
 * reload or a test re-import replaces rather than throws, and `listSuggestionSources` returns
 * registration order. All imports are type-only, so nothing from this file lands in the runtime graph.
 *
 * Grounding note — the §7.3 signature amended to the shipped sibling. docs/036 §7.3 sketched
 * `load(docId, signal)` / `subscribe(docId, onChange)`, but the shipped `CommentSource` established the
 * house pattern: the host closure knows which document it backs, so `load(signal)` takes no `docId`
 * (comment-source-registry.ts:80). J5 follows the sibling — a host wires a suggestion source and a
 * comment source the same way — over the pre-sibling draft. The producer/lifecycle capabilities
 * (`create`/`accept`/`reject`/`update`/`subscribe`) are kept as §7.3 names them; `subscribe` is
 * first-class here (unlike CommentSource, which the pane polls) because an async agent produces a
 * proposal *after* the pane has loaded, and the pane needs to know without a manual refresh.
 *
 * @categoryDefault Suggestion Source SPI
 */
import type { Proposal } from "../../core";
import type { Step } from "../../core";

/**
 * One host suggestion source (docs/036 §7.3). The deployment owns storage, identity, permissions, and
 * lifecycle; the editor owns the review surface (the woven overlay + the Changes pane) that derives
 * everything from the proposals this source returns. Joined to the document only by the discussion
 * anchor a proposal's `threadId` may carry — never by the change itself, which is the op-log.
 */
export type SuggestionSource = {
  readonly id: string;
  /** Proposals for the current document (the host closure knows which one, like `CommentSource.load`). */
  load(signal: AbortSignal): Promise<readonly Proposal[]>;
  /** Refresh one proposal by id (stale-while-revalidate), optional — mirrors `CommentSource.resolve`. */
  resolve?(proposalId: string, signal: AbortSignal): Promise<Proposal | null>;
  /**
   * Mint a new proposal — a producer seam (docs/037's agent, or a human "suggest this" action). The
   * host assigns the `id` and initial `status`, so the caller passes everything else.
   */
  create(proposal: Omit<Proposal, "id" | "status">): Promise<Proposal>;
  /** Record a proposal accepted in the host; the editor applies the ops locally (docs/036 §7.3). */
  accept(proposalId: string): Promise<void>;
  /** Record a proposal rejected in the host; the editor drops the ops locally. */
  reject(proposalId: string): Promise<void>;
  /** Replace a proposal's ops — per-block reject reduces the set to the surviving blocks (§7.5). */
  update(proposalId: string, ops: readonly Step[]): Promise<void>;
  /**
   * Subscribe to proposal changes (an async agent produced or resolved one); returns an unsubscribe.
   * First-class here because a proposal can arrive after the pane loaded — the pane cannot poll it.
   */
  subscribe(onChange: () => void): () => void;
};

const SUGGESTION_SOURCES = new Map<string, SuggestionSource>();

/** Register a host suggestion source. Idempotent by id (HMR / test-safe). */
export function registerSuggestionSource(source: SuggestionSource): void {
  SUGGESTION_SOURCES.set(source.id, source);
}

/** The source for an id, or undefined when none is registered. */
export function getSuggestionSource(id: string): SuggestionSource | undefined {
  return SUGGESTION_SOURCES.get(id);
}

/** Every registered suggestion source, in registration (insertion) order. */
export function listSuggestionSources(): readonly SuggestionSource[] {
  return [...SUGGESTION_SOURCES.values()];
}

/**
 * The active suggestion source — the first registered (the sibling posture of `activeCommentSource`).
 * Under single-proposal review (docs/038 §11) a deployment has one proposal backing at a time;
 * `undefined` means no source, which the Changes pane + the Review-tab command read to stay hidden
 * until a host wires one.
 */
export function activeSuggestionSource(): SuggestionSource | undefined {
  return SUGGESTION_SOURCES.values().next().value;
}

/** Drop a registration (host teardown / test cleanup). */
export function unregisterSuggestionSource(id: string): void {
  SUGGESTION_SOURCES.delete(id);
}
