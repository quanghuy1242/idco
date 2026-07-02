/**
 * A fake in-memory `SuggestionSource` for the stories (docs/036 §7.3, docs/038 §17, R6-J J5).
 *
 * A real deployment (or docs/037's agent host) registers a source backed by its proposal store; the
 * stories stand one up in memory so the Changes pane lights up and accept/reject/subscribe are live.
 * `accept`/`reject` flip the proposal's status and notify subscribers, so the pane moves a resolved
 * proposal to its Resolved section without a manual refresh — the same signal an async agent uses.
 */
import type { Proposal, SuggestionSource } from "../packages/editor/src";

export function createInMemorySuggestionSource(
  seed: readonly Proposal[] = [],
): SuggestionSource {
  const proposals = new Map<string, Proposal>(seed.map((p) => [p.id, p]));
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  let seq = seed.length;
  return {
    accept: async (id) => {
      const proposal = proposals.get(id);
      if (proposal) proposals.set(id, { ...proposal, status: "accepted" });
      notify();
    },
    create: async (proposal) => {
      seq += 1;
      const created: Proposal = {
        ...proposal,
        id: `s${seq}`,
        status: "pending",
      };
      proposals.set(created.id, created);
      notify();
      return created;
    },
    id: "changes",
    load: async () => [...proposals.values()],
    reject: async (id) => {
      const proposal = proposals.get(id);
      if (proposal) proposals.set(id, { ...proposal, status: "rejected" });
      notify();
    },
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    update: async (id, ops) => {
      const proposal = proposals.get(id);
      if (proposal) proposals.set(id, { ...proposal, ops });
      notify();
    },
  };
}
