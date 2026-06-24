// @vitest-environment jsdom

/**
 * note.md §7 P1 — the document-index rebuild runs as a scheduler idle-lane task.
 *
 * The controller used to debounce the rebuild with a hand-rolled `setTimeout`
 * invisible to the perf dashboard. It now schedules an `engine-document-index`
 * task on the idle lane: the O(N) `store.toSnapshot()` clone + the worker
 * round-trip coalesce under the shared lane budget, and the work is observable in
 * the scheduler snapshot next to the selection overlay. This test proves the task
 * is registered, runs, and lands a real index, using the loopback bake service
 * (the controller picks it when `createBakeWorker` returns null).
 */
import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import {
  createEditorStore,
  createEngineScheduler,
  createIdAllocator,
  makeTextNode,
  type EditorStore,
  type EngineScheduler,
} from "../../packages/editor/src/core";
import { useViewRefs } from "../../packages/editor/src/view/controllers/refs";
import { useDocumentIndexController } from "../../packages/editor/src/view/controllers/use-document-index";

function storeWithHeading(): EditorStore {
  const allocator = createIdAllocator("idco_client_doc_index_sched");
  const heading = makeTextNode({
    attrs: { tag: "h2" },
    content: allocator.createTextSlice("Install"),
    id: allocator.createNodeId(),
    type: "heading",
  });
  return createEditorStore({
    allocator,
    snapshot: {
      body: { blocks: { [heading.id]: heading }, order: [heading.id] },
      settings: {},
      version: 1,
    },
  });
}

type Refs = ReturnType<typeof useViewRefs>;

function Harness(props: {
  readonly store: EditorStore;
  readonly scheduler: EngineScheduler;
  readonly capture: (refs: Refs) => void;
}) {
  const { store, scheduler, capture } = props;
  const refs = useViewRefs();
  useDocumentIndexController({
    createBakeWorker: () => null,
    refs,
    scheduler,
    store,
  });
  // The refs bag is stable across renders; hand it to the test once so it can read
  // the landed index out of the same store the controller publishes into.
  useEffect(() => {
    capture(refs);
  }, [capture, refs]);
  return null;
}

describe("document-index scheduler task (note.md §7 P1)", () => {
  it("registers an idle-lane task that rebuilds the index and is dashboard-visible", async () => {
    const store = storeWithHeading();
    // publishDashboard:false keeps this instance off the shared window key so the
    // test reads its metrics directly without clobbering any global dashboard.
    const scheduler = createEngineScheduler({ publishDashboard: false });
    let captured: Refs | null = null;
    const capture = (refs: Refs) => {
      captured = refs;
    };
    render(<Harness capture={capture} scheduler={scheduler} store={store} />);

    await waitFor(() => {
      const index = captured?.documentIndexStoreRef.current.getSnapshot();
      expect(index?.toc.some((entry) => entry.text === "Install")).toBe(true);
    });

    const task = scheduler
      .snapshot()
      .tasks.find((candidate) => candidate.label === "engine-document-index");
    expect(task).toBeDefined();
    expect(task?.lane).toBe("idle");
    expect(task?.runs).toBeGreaterThanOrEqual(1);
  });
});
