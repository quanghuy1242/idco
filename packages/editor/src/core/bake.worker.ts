/**
 * The Web Worker entry for pure-compute bake and document indexing (docs/010
 * §7.5). It is loaded by the view with `new Worker(new URL("./bake.worker.ts",
 * import.meta.url), { type: "module" })`; it must stay framework- and DOM-free.
 *
 * It is a thin shell: every job runs through the shared `runBakeWorkerJob`
 * dispatcher (bake.ts), so the worker and the main-thread/loopback paths execute
 * identical code. The worker bakes the built-in object set with a default
 * registry; custom object definitions carry functions that do not survive
 * `postMessage`, so they bake on the main thread instead.
 */
import { runBakeWorkerJob, type BakeWorkerJob } from "./bake";

type WorkerScope = {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    listener: (event: { readonly data: BakeWorkerJob }) => void,
  ): void;
};

const scope = self as unknown as WorkerScope;

scope.addEventListener("message", (event) => {
  // A worker's own postMessage takes no targetOrigin (that is window.postMessage).
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  scope.postMessage(runBakeWorkerJob(event.data));
});
