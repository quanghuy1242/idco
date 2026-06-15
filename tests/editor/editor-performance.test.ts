import { describe, expect, it } from "vitest";
import { createEditorSchedulerTask } from "../../packages/editor/src/plugins/editor-performance";

describe("editor performance scheduler", () => {
  it("coalesces debounced work to the latest pending payload and records dashboard metrics", async () => {
    const seen: number[] = [];
    const task = createEditorSchedulerTask<{ readonly value: number }>(
      {
        budgetMs: 20,
        coalesce: "latest",
        cost: "test task",
        debounceMs: 1,
        frequency: "test",
        label: "test debounced task",
        lane: "debounced",
        priority: "normal",
      },
      (payload) => {
        seen.push(payload.value);
      },
    );

    window["__IDCO_EDITOR_PERF__"]?.reset();
    task.schedule({ value: 1 });
    task.schedule({ value: 2 });
    task.schedule({ value: 3 });

    await new Promise((resolve) => setTimeout(resolve, 30));

    const snapshot = window["__IDCO_EDITOR_PERF__"]?.snapshot();
    const taskSnapshot = snapshot?.tasks.find(
      (candidate) => candidate.label === "test debounced task",
    );

    expect(seen).toEqual([3]);
    expect(taskSnapshot?.coalescedUpdates).toBe(2);
    expect(taskSnapshot?.runs).toBe(1);

    task.cancel();
  });
});
