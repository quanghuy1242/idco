/**
 * Comment Source SPI — the docs/026 sibling for host-owned annotation threads
 * (docs/027 §7.1).
 *
 * Comments are *metadata*, not content (docs/027 §2.1): the conversation lives in the
 * host, the document carries only an anchor mark plus an optional snapshot. So the host
 * registers a comment source the same way it registers a display-record `DataSource`
 * (docs/026) — but with *thread* capabilities (load/resolve/create/reply/update/
 * remove/setResolved) instead of record capabilities (load/resolve). This is a
 * deliberately *separate* registry, not an overload of the docs/026 data-source type
 * (decision D4): thread ops and display-record ops are genuinely different sets, and
 * fusing them would force every display source to grow thread methods it never uses.
 * The shared discipline — the snapshot as the offline/error fallback, stale-while-
 * revalidate resolve, and provenance gating — carries over unchanged (§7.3/§7.7).
 *
 * Shape mirrors the sibling registries: module singleton, register-by-id, idempotent,
 * registration-order listing. All imports are type-only.
 *
 * @categoryDefault Comments SPI
 */

/** Comment author identity (docs/027 §7.2); lives in the host, never the document. */
export type CommentAuthor = {
  readonly id: string;
  readonly name: string;
  readonly avatar?: string;
};

/** One reply in a thread (docs/027 §7.2). */
export type Comment = {
  readonly id: string;
  readonly body: string;
  readonly author: CommentAuthor;
  readonly createdAt: string;
};

/**
 * A comment thread — the rich shape docs/006 §4.6 asked for and legacy lacked
 * (docs/027 §7.2). Authoring identity, timestamps, resolved state, and replies all
 * live here in the host; the document's only knowledge of it is the anchoring mark.
 */
export type Thread = {
  readonly id: string;
  /** The quoted range text, denormalized for display without a document read. */
  readonly excerpt: string;
  readonly body: string;
  readonly author: CommentAuthor;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resolved: boolean;
  readonly replies: readonly Comment[];
};

/** Where a new thread attaches (docs/027 §7.2): the anchor node + the quoted text. */
export type CommentAnchor = {
  readonly node: string;
  readonly excerpt: string;
};

/**
 * The thin denormalized copy a comment mark stores (docs/027 §7.3): enough for the
 * reader to paint a margin note statically and for the editor to show a sensible
 * highlight before `resolve` returns or when the host is unreachable.
 */
export type CommentSnapshot = {
  readonly author: string;
  readonly excerpt: string;
  readonly resolved: boolean;
};

/**
 * One host comment source, joined to comment marks by the thread id they reference
 * (docs/027 §7.1). The deployment owns the thread store, identity, permissions, and
 * persistence; the editor owns the picker-free seam (a comment is created from a
 * selection, not picked), the snapshot cache, and the static reader render.
 */
export type CommentSource = {
  readonly id: string;
  /** Threads for the current document (the host closure knows which document). */
  load(signal: AbortSignal): Promise<readonly Thread[]>;
  /** Refresh one thread by id (stale-while-revalidate, docs/027 §7.3). */
  resolve?(threadId: string, signal: AbortSignal): Promise<Thread | null>;
  /** Open a new thread on a range; returns the created thread (with its id). */
  create(anchor: CommentAnchor, body: string): Promise<Thread>;
  /** Append a reply to a thread. */
  reply(threadId: string, body: string): Promise<Thread>;
  /** Edit a comment body (the thread's root body). */
  update(threadId: string, body: string): Promise<void>;
  /** Delete a thread. */
  remove(threadId: string): Promise<void>;
  /** Toggle a thread's resolved state. */
  setResolved(threadId: string, resolved: boolean): Promise<void>;
};

const COMMENT_SOURCES = new Map<string, CommentSource>();

/** Register a host comment source. Idempotent by id (HMR / test-safe). */
export function registerCommentSource(source: CommentSource): void {
  COMMENT_SOURCES.set(source.id, source);
}

/** The source for an id, or undefined when none is registered. */
export function getCommentSource(id: string): CommentSource | undefined {
  return COMMENT_SOURCES.get(id);
}

/** Every registered comment source, in registration order (docs/027 §7.1). */
export function listCommentSources(): readonly CommentSource[] {
  return [...COMMENT_SOURCES.values()];
}

/**
 * The active comment source — the first registered (docs/027 §7.7). Comments are a
 * single conversation backing per deployment; the registry stays a list to match the
 * sibling SPIs and to let a host swap one by re-registering. `undefined` means no
 * source, which provenance gating reads to hide the Comments pane and add action.
 */
export function activeCommentSource(): CommentSource | undefined {
  return COMMENT_SOURCES.values().next().value;
}

/** Drop a registration (host teardown / test cleanup). */
export function unregisterCommentSource(id: string): void {
  COMMENT_SOURCES.delete(id);
}
