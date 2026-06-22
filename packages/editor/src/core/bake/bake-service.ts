/**
 * The worker bake/index service client (docs/010 §7.5).
 *
 * Why this file exists
 * --------------------
 * Pure-compute bake and document indexing belong off the editing hot path. This
 * is the main-thread client that posts those jobs to a worker and awaits the
 * results, correlating responses to requests by job id. It is a *compute
 * service, not a second scheduler* (§7.5): callers `await` it from the idle /
 * debounced lanes; the main scheduler still owns the main-thread lanes.
 *
 * The client talks to a minimal `WorkerLike` transport, so the same code drives:
 *
 * - a real `Worker` in the browser (the view constructs one over `bake.worker`),
 *   and
 * - an in-memory loopback transport in tests/SSR where `Worker` is absent. The
 *   loopback still serializes the job, runs the real `runBakeWorkerJob` handler,
 *   and serializes the result back, so the request/response round-trip and its
 *   structured-clone safety are genuinely exercised without a real thread.
 */
import {
  runBakeWorkerJob,
  type BakeObjectResult,
  type BakeWorkerJob,
  type BakeWorkerResult,
  type DocumentIndex,
} from "./bake";
import type { EditorDocumentSnapshot, JsonValue } from "../model";
import type { BlockRegistry } from "../registry";

/** The minimal transport contract a `Worker` satisfies. */
export type WorkerLike = {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ): void;
  removeEventListener?(
    type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ): void;
  terminate?(): void;
};

/** The off-thread bake/index service the view drives from the idle lane. */
export type BakeService = {
  bakeObject(objectType: string, data: JsonValue): Promise<BakeObjectResult>;
  buildIndex(snapshot: EditorDocumentSnapshot): Promise<DocumentIndex>;
  dispose(): void;
};

/** Wrap a worker-like transport as a promise-based bake/index service. */
export function createWorkerBakeService(worker: WorkerLike): BakeService {
  const pending = new Map<string, (result: BakeWorkerResult) => void>();
  let counter = 0;

  const onMessage = (event: { readonly data: unknown }) => {
    const data = event.data as BakeWorkerResult | undefined;
    if (!data || typeof data.id !== "string") return;
    const resolve = pending.get(data.id);
    if (!resolve) return;
    pending.delete(data.id);
    resolve(data);
  };
  worker.addEventListener("message", onMessage);

  const post = (job: BakeWorkerJob) =>
    new Promise<BakeWorkerResult>((resolve) => {
      pending.set(job.id, resolve);
      // Worker.postMessage takes no targetOrigin; the rule targets window.postMessage.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      worker.postMessage(job);
    });

  return {
    async bakeObject(objectType, data) {
      const id = `bake-${(counter += 1)}`;
      const reply = await post({ data, id, kind: "bake-object", objectType });
      if (reply.kind !== "bake-object") {
        throw new Error(
          "Worker returned the wrong result kind for bake-object",
        );
      }
      return reply.result;
    },
    async buildIndex(snapshot) {
      const id = `index-${(counter += 1)}`;
      const reply = await post({ id, kind: "build-index", snapshot });
      if (reply.kind !== "build-index") {
        throw new Error(
          "Worker returned the wrong result kind for build-index",
        );
      }
      return reply.result;
    },
    dispose() {
      worker.removeEventListener?.("message", onMessage);
      worker.terminate?.();
      pending.clear();
    },
  };
}

/**
 * An in-memory transport that runs jobs through the real worker handler on a
 * microtask. Used in tests and where `Worker` is unavailable; it serializes the
 * job and result the way `postMessage`'s structured clone does, so the round-trip
 * stays honest.
 */
export function createLoopbackWorker(registry?: BlockRegistry): WorkerLike {
  const listeners = new Set<(event: { readonly data: unknown }) => void>();
  return {
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    postMessage(message) {
      const job = clone(message) as BakeWorkerJob;
      queueMicrotask(() => {
        const data = clone(runBakeWorkerJob(job, registry));
        listeners.forEach((listener) => listener({ data }));
      });
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
    terminate() {
      listeners.clear();
    },
  };
}

/** A bake service backed by the in-memory loopback transport. */
export function createLoopbackBakeService(
  registry?: BlockRegistry,
): BakeService {
  return createWorkerBakeService(createLoopbackWorker(registry));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
