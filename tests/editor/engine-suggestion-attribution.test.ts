/**
 * Suggestion attribution (docs/036 §7.4, docs/038 §18, R6-J J7).
 */
import { describe, expect, it } from "vitest";
import {
  attributionForTextRun,
  proposalAttribution,
  type Proposal,
  type TextRunDiff,
} from "../../packages/editor/src/core";

const proposal: Proposal = {
  author: {
    id: "agent-1",
    kind: "agent",
    label: "Assistant",
  },
  baseVersion: 0,
  createdAt: "2026-07-02T00:00:00Z",
  id: "p1",
  ops: [],
  status: "pending",
};

describe("suggestion attribution", () => {
  it("maps the active proposal author to a stable chip label and hue", () => {
    const a = proposalAttribution(proposal);
    const b = proposalAttribution(proposal);

    expect(a.label).toBe("Assistant");
    expect(a.author).toBe(proposal.author);
    expect(a.hue).toBe(b.hue);
    expect(a.hue).toMatch(/^hsl\(\d+ 78% 42%\)$/);
  });

  it("resolves identity-backed changed text runs to the single proposal author", () => {
    const inserted: TextRunDiff = {
      ids: [{ client: "idco_client_author", clock: 1 }],
      op: "insert",
      text: "new",
    };
    const kept: TextRunDiff = {
      ids: [{ client: "idco_client_author", clock: 2 }],
      op: "keep",
      text: "old",
    };
    const fallback: TextRunDiff = { op: "delete", text: "old" };

    expect(attributionForTextRun(proposal, inserted)?.label).toBe("Assistant");
    expect(attributionForTextRun(proposal, kept)).toBeNull();
    expect(attributionForTextRun(proposal, fallback)).toBeNull();
  });
});
