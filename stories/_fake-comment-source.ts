/**
 * A fake in-memory `CommentSource` for the stories (docs/027 §7.1).
 *
 * A real deployment registers a source backed by its thread store; the stories stand
 * one up in memory so the Comments pane and the add action light up (§7.7). Shared by
 * the Review stories and the full-editor story so the fake lives in one place.
 */
import type { CommentSource, Thread } from "../packages/editor/src";

const now = () => "just now";

export function createInMemoryCommentSource(
  seed: readonly Thread[] = [],
): CommentSource {
  const threads = new Map<string, Thread>(seed.map((t) => [t.id, t]));
  let seq = seed.length;
  return {
    create: async (anchor, body) => {
      seq += 1;
      const thread: Thread = {
        author: { id: "me", name: "You" },
        body,
        createdAt: now(),
        excerpt: anchor.excerpt,
        id: `c${seq}`,
        replies: [],
        resolved: false,
        updatedAt: now(),
      };
      threads.set(thread.id, thread);
      return thread;
    },
    id: "comments",
    load: async () => [...threads.values()],
    remove: async (id) => {
      threads.delete(id);
    },
    reply: async (id, body) => {
      seq += 1;
      const thread = threads.get(id)!;
      const next: Thread = {
        ...thread,
        replies: [
          ...thread.replies,
          {
            author: { id: "me", name: "You" },
            body,
            createdAt: now(),
            id: `r${seq}`,
          },
        ],
      };
      threads.set(id, next);
      return next;
    },
    resolve: async (id) => threads.get(id) ?? null,
    setResolved: async (id, resolved) => {
      const thread = threads.get(id);
      if (thread) threads.set(id, { ...thread, resolved });
    },
    update: async () => {},
  };
}
