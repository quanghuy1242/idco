/**
 * Fresh scheduler for the owned-model engine.
 *
 * Why this file exists
 * --------------------
 * The legacy scheduler in `legacy/plugins/editor-performance.ts` solved the
 * right performance problem for the Lexical editor: bursts of update-listener
 * work must collapse into named, budgeted tasks instead of becoming one React
 * update per keypress. Phase 4 needs that same discipline, but the owned-model
 * engine cannot import the legacy module because that file is Lexical/React
 * aware. This scheduler is therefore a fresh core implementation of the same
 * scheduling idea: framework-free, editor-model agnostic, and small enough for
 * the canonical engine to own.
 *
 * Runtime flow
 * ------------
 * A view or model-adjacent service creates a task with a review contract:
 *
 *   createTask(contract, run)
 *     -> schedule(payload)
 *     -> set/merge/drop the task's one pending payload slot
 *     -> enqueue the task on its lane
 *     -> wake the lane with rAF / idle callback / debounce timer
 *     -> flush tasks by priority/FIFO under the lane budget
 *     -> run(payload, context)
 *     -> record metrics and optionally requeue if the task returns "continue"
 *
 * The key invariant is the one-payload slot. A held key or rapid selection
 * movement can schedule the same task dozens of times before the next frame. The
 * scheduler keeps only the latest useful payload unless the task explicitly
 * asks for `drop-if-pending` or `merge`, so visual work tracks the newest model
 * state instead of replaying stale intermediate states.
 *
 * Difference from the legacy scheduler
 * ------------------------------------
 * The legacy file exposes Lexical listener wrappers, React state helpers, DOM
 * selection fast paths, and a process-wide singleton. This file exposes only a
 * task scheduler factory. Each `createEngineScheduler()` call owns an isolated
 * queue and metrics map; the React view can publish the familiar
 * `window.__IDCO_EDITOR_PERF__` dashboard for Playwright, while unit tests can
 * opt out so they do not clobber the legacy scheduler's dashboard.
 */

/**
 * @categoryDefault Engine Core — Store
 */

/** Which timing lane owns a task. Lane choice is semantic, not just delay. */
export type EngineSchedulerLane = "sync" | "frame" | "idle" | "debounced";

/** Ordering inside one lane; it never moves work across lanes. */
export type EngineSchedulerPriority = "critical" | "high" | "normal" | "low";

/**
 * What happens when a new payload arrives before the previous one has run.
 *
 * `latest` is the hot-path default: it keeps the newest coherent model/view
 * state. `drop-if-pending` is for edge-triggered work where the first queued
 * payload is enough. `merge` is for aggregating dirty sets or append-only work.
 */
export type EngineSchedulerCoalesce = "latest" | "drop-if-pending" | "merge";

/**
 * Review contract for every scheduled engine task.
 *
 * These fields are deliberately prose-heavy. They are surfaced in the perf
 * dashboard and make reviewers answer "what does this task read, how often can
 * it run, and how much frame budget may it spend?" before new derived work lands
 * on the typing path.
 */
export type EngineSchedulerContract<Payload> = {
  readonly label: string;
  readonly lane: EngineSchedulerLane;
  readonly frequency: string;
  readonly cost: string;
  readonly budgetMs?: number;
  readonly priority?: EngineSchedulerPriority | number;
  readonly coalesce?: EngineSchedulerCoalesce;
  readonly debounceMs?: number;
  readonly merge?: (current: Payload, next: Payload) => Payload;
};

/**
 * Budget-aware context passed into task bodies.
 *
 * Longer derived work can check `shouldYield()` and return `"continue"` so the
 * scheduler requeues the same payload for another frame/idle slice. Phase 4 uses
 * this lightly for selection overlay work; later phases can reuse the same hook
 * for chunked indexes/search/bake projections.
 */
export type EngineTaskRunContext = {
  readonly budgetMs: number;
  readonly deadlineMs: number;
  readonly elapsedMs: () => number;
  readonly shouldYield: () => boolean;
};

export type EngineTaskRunResult = "continue" | void;

/**
 * Public handle for one scheduled task.
 *
 * `schedule` enters the coalescing/queue path. `flush` is for tests or explicit
 * synchronous drains. `cancel` marks the task dead and removes any queued payload
 * so unmounted React views do not publish stale work.
 */
export type EngineSchedulerTask<Payload> = {
  readonly schedule: (payload: Payload) => void;
  readonly flush: () => void;
  readonly cancel: () => void;
};

export type EnginePerformanceTaskSnapshot = {
  readonly averageMs: number;
  readonly budgetMs: number;
  readonly coalescedUpdates: number;
  readonly continuedRuns: number;
  readonly cost: string;
  readonly droppedUpdates: number;
  readonly frequency: string;
  readonly label: string;
  readonly lane: EngineSchedulerLane;
  readonly lastDurationMs: number;
  readonly maxMs: number;
  readonly overBudgetRuns: number;
  readonly pending: boolean;
  readonly priority: number;
  readonly runs: number;
};

/** Aggregate scheduler state exposed to Playwright and diagnostics. */
export type EnginePerformanceSnapshot = {
  readonly coalescedUpdates: number;
  readonly droppedUpdates: number;
  readonly frameBudgetMs: number;
  readonly generatedAt: string;
  readonly idleBudgetMs: number;
  readonly overBudgetRuns: number;
  readonly pendingTasks: number;
  readonly runs: number;
  readonly tasks: readonly EnginePerformanceTaskSnapshot[];
};

export type EnginePerformanceDashboard = {
  readonly reset: () => void;
  readonly snapshot: () => EnginePerformanceSnapshot;
};

/**
 * Instance-level engine scheduler.
 *
 * This intentionally differs from the legacy process singleton. The owned-model
 * view can run an isolated scheduler per mounted engine, and tests can construct
 * a non-publishing scheduler to inspect metrics without replacing the standard
 * editor's global dashboard.
 */
export type EngineScheduler = {
  createTask<Payload>(
    contract: EngineSchedulerContract<Payload>,
    run: (
      payload: Payload,
      context: EngineTaskRunContext,
    ) => EngineTaskRunResult,
  ): EngineSchedulerTask<Payload>;
  readonly reset: () => void;
  readonly snapshot: () => EnginePerformanceSnapshot;
  readonly flushAll: () => void;
  /**
   * Drain one non-sync lane synchronously, now. The drag path uses this to paint
   * the selection overlay in the *same* animation frame as the extend: the extend
   * runs inside a rAF and `dispatch` would otherwise schedule the overlay's frame
   * task onto the *next* rAF (a `requestAnimationFrame` issued from within a rAF
   * fires a frame later), leaving the painted selection one frame behind the
   * pointer. Flushing the frame lane here collapses that gap.
   */
  readonly flushLane: (lane: Exclude<EngineSchedulerLane, "sync">) => void;
};

export type EngineSchedulerOptions = {
  readonly publishDashboard?: boolean;
};

/** Browser idle-callback subset used by both native and timeout fallback paths. */
type EngineIdleDeadline = {
  readonly didTimeout: boolean;
  readonly timeRemaining: () => number;
};

/*
 * Metrics are mutable internally so scheduling a payload does not allocate a new
 * public snapshot object on every keypress. `snapshot()` copies and rounds them
 * at the boundary where tests/devtools read the data.
 */
type MutableTaskMetrics = {
  averageMs: number;
  budgetMs: number;
  coalescedUpdates: number;
  continuedRuns: number;
  cost: string;
  droppedUpdates: number;
  frequency: string;
  label: string;
  lane: EngineSchedulerLane;
  lastDurationMs: number;
  maxMs: number;
  overBudgetRuns: number;
  pending: boolean;
  priority: number;
  runs: number;
  totalMs: number;
};

/*
 * Payload-specific task state.
 *
 * `pendingPayload` is the single coalescing slot. `queued` tells us whether the
 * task is already in `pendingTasks`; `hasPendingPayload` is separate so a task
 * can remain known for metrics even after the slot is consumed.
 */
type InternalTask<Payload> = {
  readonly contract: EngineSchedulerContract<Payload>;
  readonly id: number;
  readonly run: (
    payload: Payload,
    context: EngineTaskRunContext,
  ) => EngineTaskRunResult;
  debounceHandle: ReturnType<typeof setTimeout> | null;
  disposed: boolean;
  hasPendingPayload: boolean;
  pendingPayload: Payload | null;
  queued: boolean;
  sequence: number;
};

/*
 * One scheduler instance. The queue is shared across all tasks created by this
 * instance so lane budgets are global within one engine view rather than per
 * subscriber. That is the important behavior from the old scheduler: many small
 * listeners cannot each spend a full frame budget independently.
 */
type SchedulerState = {
  debouncedHandle: ReturnType<typeof setTimeout> | null;
  frameHandle: number | null;
  idleHandle: number | null;
  nextTaskId: number;
  pendingTasks: Set<InternalTask<unknown>>;
  sequence: number;
  taskMetrics: Map<string, MutableTaskMetrics>;
};

const DEFAULT_BUDGET_MS = 8;
const DEFAULT_DEBOUNCE_MS = 80;
const DEFAULT_FRAME_BUDGET_MS = 6;
const DEFAULT_IDLE_BUDGET_MS = 10;
const DEFAULT_DEBOUNCED_BUDGET_MS = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 160;

const PERF_DASHBOARD_KEY = "__IDCO_EDITOR_PERF__";

/**
 * Create one independent engine scheduler.
 *
 * The default publishes `window.__IDCO_EDITOR_PERF__` so the Phase 4 browser perf
 * spec can read the same dashboard key as the standard editor. Tests pass
 * `{ publishDashboard: false }` when they want direct access to this instance's
 * metrics without stealing that global from the legacy scheduler.
 */
export function createEngineScheduler(
  options: EngineSchedulerOptions = {},
): EngineScheduler {
  const state: SchedulerState = {
    debouncedHandle: null,
    frameHandle: null,
    idleHandle: null,
    nextTaskId: 1,
    pendingTasks: new Set(),
    sequence: 1,
    taskMetrics: new Map(),
  };
  if (options.publishDashboard !== false) installDashboard(state);

  function createTask<Payload>(
    contract: EngineSchedulerContract<Payload>,
    run: (
      payload: Payload,
      context: EngineTaskRunContext,
    ) => EngineTaskRunResult,
  ): EngineSchedulerTask<Payload> {
    /*
     * A task is registered once and scheduled many times. Its type-specific
     * payload stays inside this closure; the global queue only needs the erased
     * `InternalTask<unknown>` fields for lane sorting and metrics.
     */
    const task: InternalTask<Payload> = {
      contract,
      debounceHandle: null,
      disposed: false,
      hasPendingPayload: false,
      id: state.nextTaskId,
      pendingPayload: null,
      queued: false,
      run,
      sequence: 0,
    };
    state.nextTaskId += 1;
    syncMetrics(state, task);

    return {
      cancel: () => cancelTask(state, task),
      flush: () => flushTask(state, task),
      schedule: (payload) => scheduleTask(state, task, payload),
    };
  }

  return {
    createTask,
    flushAll: () => flushAll(state),
    flushLane: (lane) => flushLane(state, lane),
    reset: () => state.taskMetrics.clear(),
    snapshot: () => snapshot(state),
  };
}

/**
 * Public `task.schedule(payload)` implementation.
 *
 * The scheduler first updates the one-slot pending payload according to the
 * task's coalescing policy. After that the lane decides timing:
 *
 * - `sync`: run now, still measured.
 * - `frame`: run on the next animation frame.
 * - `idle`: run on requestIdleCallback or the timeout fallback.
 * - `debounced`: wait for the task debounce, then enter the normal queue.
 */
function scheduleTask<Payload>(
  state: SchedulerState,
  task: InternalTask<Payload>,
  payload: Payload,
): void {
  if (task.disposed) return;
  setTaskPayload(state, task, payload);
  if (task.contract.lane === "sync") {
    flushTask(state, task);
    return;
  }
  if (task.contract.lane === "debounced") {
    if (task.debounceHandle !== null) clearTimeout(task.debounceHandle);
    task.debounceHandle = setTimeout(() => {
      task.debounceHandle = null;
      enqueueTask(state, task);
    }, task.contract.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    return;
  }
  enqueueTask(state, task);
}

/**
 * Update the one pending payload slot.
 *
 * This is the scheduler's main protection against typing-path backlog. Repeated
 * selection changes before a frame should repaint once with the newest
 * selection, not N times with stale coordinates. Metrics count coalesced/dropped
 * updates so perf specs can tell whether a scenario is collapsing work as
 * intended.
 */
function setTaskPayload<Payload>(
  state: SchedulerState,
  task: InternalTask<Payload>,
  payload: Payload,
): void {
  const coalesce = task.contract.coalesce ?? "latest";
  const metrics = metricsFor(state, task.contract);
  if (!task.hasPendingPayload) {
    task.pendingPayload = payload;
    task.hasPendingPayload = true;
    syncMetrics(state, task);
    return;
  }
  if (coalesce === "drop-if-pending") {
    metrics.droppedUpdates += 1;
    return;
  }
  if (coalesce === "merge") {
    if (!task.contract.merge) {
      throw new Error(`Scheduler task ${task.contract.label} is missing merge`);
    }
    task.pendingPayload = task.contract.merge(task.pendingPayload!, payload);
  } else {
    task.pendingPayload = payload;
  }
  metrics.coalescedUpdates += 1;
  syncMetrics(state, task);
}

/**
 * Add a task to the shared pending queue and wake the right lane.
 *
 * A task already in the queue is not added twice. New payloads simply update the
 * pending slot; the already-scheduled lane flush will consume the newest payload.
 */
function enqueueTask<Payload>(
  state: SchedulerState,
  task: InternalTask<Payload>,
): void {
  if (task.disposed || task.queued || !task.hasPendingPayload) return;
  task.queued = true;
  task.sequence = state.sequence;
  state.sequence += 1;
  state.pendingTasks.add(task as InternalTask<unknown>);
  syncMetrics(state, task);
  scheduleLane(state, task.contract.lane);
}

/**
 * Run one task immediately.
 *
 * Used by `sync` tasks, tests, and explicit flushes. Debounced timers are cleared
 * first so the same payload cannot run later through a stale timeout.
 */
function flushTask<Payload>(
  state: SchedulerState,
  task: InternalTask<Payload>,
): void {
  if (task.disposed || !task.hasPendingPayload) return;
  if (task.debounceHandle !== null) {
    clearTimeout(task.debounceHandle);
    task.debounceHandle = null;
  }
  state.pendingTasks.delete(task as InternalTask<unknown>);
  task.queued = false;
  runTask(state, task, createRunContext(task.contract));
}

/**
 * Dispose one task and remove its queued payload.
 *
 * React views call this during unmount through the task handle. Without this,
 * a frame scheduled by an old view could fire after the DOM/subscribers it was
 * supposed to update are gone.
 */
function cancelTask<Payload>(
  state: SchedulerState,
  task: InternalTask<Payload>,
): void {
  task.disposed = true;
  task.hasPendingPayload = false;
  task.pendingPayload = null;
  task.queued = false;
  if (task.debounceHandle !== null) clearTimeout(task.debounceHandle);
  state.pendingTasks.delete(task as InternalTask<unknown>);
  syncMetrics(state, task);
}

/**
 * Wake a lane if it is not already scheduled.
 *
 * Each lane has exactly one outstanding browser/timer handle. That keeps bursts
 * cheap: 100 selection changes still schedule one frame callback for that lane,
 * not 100 separate requestAnimationFrame callbacks.
 */
function scheduleLane(state: SchedulerState, lane: EngineSchedulerLane): void {
  if (lane === "sync") return;
  if (lane === "frame") {
    if (state.frameHandle !== null) return;
    state.frameHandle = requestFrame(() => {
      state.frameHandle = null;
      flushLane(state, "frame");
    });
    return;
  }
  if (lane === "idle") {
    if (state.idleHandle !== null) return;
    state.idleHandle = requestIdle((deadline) => {
      state.idleHandle = null;
      flushLane(state, "idle", deadline);
    });
    return;
  }
  if (state.debouncedHandle !== null) return;
  state.debouncedHandle = setTimeout(() => {
    state.debouncedHandle = null;
    flushLane(state, "debounced");
  }, 0);
}

/**
 * Drain one non-sync lane under its shared budget.
 *
 * Tasks are selected by priority, then FIFO sequence. If the lane spends its
 * budget before the queue is empty, remaining work is carried into another lane
 * wake-up. This is the key difference between "every subscriber gets to run" and
 * "visual work shares the next frame's limited time."
 */
function flushLane(
  state: SchedulerState,
  lane: Exclude<EngineSchedulerLane, "sync">,
  idleDeadline?: EngineIdleDeadline,
): void {
  const budget =
    lane === "frame"
      ? DEFAULT_FRAME_BUDGET_MS
      : lane === "idle"
        ? Math.min(DEFAULT_IDLE_BUDGET_MS, idleDeadline?.timeRemaining() ?? 0)
        : DEFAULT_DEBOUNCED_BUDGET_MS;
  const started = now();
  const deadlineMs = started + Math.max(1, budget);
  while (true) {
    const task = nextPendingTask(state, lane);
    if (!task) break;
    state.pendingTasks.delete(task);
    task.queued = false;
    runTask(state, task, {
      budgetMs: budget,
      deadlineMs,
      elapsedMs: () => now() - started,
      shouldYield: () => now() >= deadlineMs,
    });
    if (now() >= deadlineMs) break;
  }
  if (hasPendingLaneTasks(state, lane)) scheduleLane(state, lane);
}

/**
 * Execute a task body and record its cost.
 *
 * Returning `"continue"` means the task intentionally yielded while processing
 * the current payload. We put that same payload back into the pending slot and
 * enqueue the task again so chunked work can resume without blocking the current
 * frame/idle slice.
 */
function runTask<Payload>(
  state: SchedulerState,
  task: InternalTask<Payload>,
  context: EngineTaskRunContext,
): void {
  if (!task.hasPendingPayload) {
    syncMetrics(state, task);
    return;
  }
  const payload = task.pendingPayload!;
  task.pendingPayload = null;
  task.hasPendingPayload = false;
  const started = now();
  const result = task.run(payload, context);
  const duration = now() - started;
  const metrics = metricsFor(state, task.contract);
  metrics.runs += 1;
  metrics.totalMs += duration;
  metrics.averageMs = metrics.totalMs / metrics.runs;
  metrics.lastDurationMs = duration;
  metrics.maxMs = Math.max(metrics.maxMs, duration);
  if (duration > metrics.budgetMs) metrics.overBudgetRuns += 1;
  if (result === "continue") {
    metrics.continuedRuns += 1;
    task.pendingPayload = payload;
    task.hasPendingPayload = true;
    enqueueTask(state, task);
  }
  syncMetrics(state, task);
}

/**
 * Synchronous drain used by unit tests.
 *
 * Browser runtime normally lets lane callbacks drive flushing. Tests use this to
 * assert coalescing and metrics deterministically without waiting on rAF/timers.
 */
function flushAll(state: SchedulerState): void {
  while (state.pendingTasks.size > 0) {
    const task = state.pendingTasks.values().next().value;
    if (!task) break;
    flushTask(state, task);
  }
}

/**
 * Pick the next runnable task in one lane.
 *
 * Higher priority wins; equal priority preserves the enqueue order. The function
 * returns the erased task because the queue does not need to know the payload
 * type, only how to invoke the stored runner through `runTask`.
 */
function nextPendingTask(
  state: SchedulerState,
  lane: EngineSchedulerLane,
): InternalTask<unknown> | undefined {
  return [...state.pendingTasks]
    .filter((task) => task.contract.lane === lane)
    .sort(
      (left, right) =>
        priorityValue(right.contract.priority) -
          priorityValue(left.contract.priority) ||
        left.sequence - right.sequence,
    )[0];
}

/** Cheap existence check used to decide whether another lane wake-up is needed. */
function hasPendingLaneTasks(
  state: SchedulerState,
  lane: EngineSchedulerLane,
): boolean {
  for (const task of state.pendingTasks) {
    if (task.contract.lane === lane) return true;
  }
  return false;
}

/**
 * Create the task-local budget context.
 *
 * `flushLane` passes a lane deadline when running frame/idle work. Direct
 * `flush()` calls do not have a lane deadline, so the task falls back to its own
 * contract budget. Task bodies should use `shouldYield()` instead of reading
 * `performance.now()` themselves; that keeps later budget-policy changes local.
 */
function createRunContext<Payload>(
  contract: EngineSchedulerContract<Payload>,
): EngineTaskRunContext {
  const budgetMs =
    contract.budgetMs ??
    (contract.lane === "frame"
      ? DEFAULT_FRAME_BUDGET_MS
      : contract.lane === "idle"
        ? DEFAULT_IDLE_BUDGET_MS
        : DEFAULT_BUDGET_MS);
  const started = now();
  const deadlineMs = started + budgetMs;
  return {
    budgetMs,
    deadlineMs,
    elapsedMs: () => now() - started,
    shouldYield: () => now() >= deadlineMs,
  };
}

/**
 * Return or initialize the mutable metrics row for a task label.
 *
 * The label is the dashboard key. If a task is created before it ever runs, it
 * still gets a metrics row so tests/devtools can see pending work, the declared
 * lane, and the declared cost.
 */
function metricsFor<Payload>(
  state: SchedulerState,
  contract: EngineSchedulerContract<Payload>,
): MutableTaskMetrics {
  const existing = state.taskMetrics.get(contract.label);
  if (existing) return existing;
  const metrics: MutableTaskMetrics = {
    averageMs: 0,
    budgetMs:
      contract.budgetMs ??
      (contract.lane === "frame"
        ? DEFAULT_FRAME_BUDGET_MS
        : contract.lane === "idle"
          ? DEFAULT_IDLE_BUDGET_MS
          : DEFAULT_BUDGET_MS),
    coalescedUpdates: 0,
    continuedRuns: 0,
    cost: contract.cost,
    droppedUpdates: 0,
    frequency: contract.frequency,
    label: contract.label,
    lane: contract.lane,
    lastDurationMs: 0,
    maxMs: 0,
    overBudgetRuns: 0,
    pending: false,
    priority: priorityValue(contract.priority),
    runs: 0,
    totalMs: 0,
  };
  state.taskMetrics.set(contract.label, metrics);
  return metrics;
}

/**
 * Keep the metrics row's pending flag aligned with task state.
 *
 * This is intentionally separate from recording a run: schedule/cancel/flush
 * state changes are visible in diagnostics even if the task body has not run.
 */
function syncMetrics<Payload>(
  state: SchedulerState,
  task: InternalTask<Payload>,
): void {
  const metrics = metricsFor(state, task.contract);
  metrics.pending = task.hasPendingPayload || task.queued;
}

/**
 * Copy the current dashboard state into an immutable snapshot.
 *
 * Internal counters stay mutable for hot-path cheapness; consumers get rounded,
 * sorted copies. The shape mirrors the legacy dashboard because existing
 * Playwright perf tooling already knows how to read these fields.
 */
function snapshot(state: SchedulerState): EnginePerformanceSnapshot {
  const tasks = [...state.taskMetrics.values()]
    .map((task) => ({
      averageMs: rounded(task.averageMs),
      budgetMs: task.budgetMs,
      coalescedUpdates: task.coalescedUpdates,
      continuedRuns: task.continuedRuns,
      cost: task.cost,
      droppedUpdates: task.droppedUpdates,
      frequency: task.frequency,
      label: task.label,
      lane: task.lane,
      lastDurationMs: rounded(task.lastDurationMs),
      maxMs: rounded(task.maxMs),
      overBudgetRuns: task.overBudgetRuns,
      pending: task.pending,
      priority: task.priority,
      runs: task.runs,
    }))
    .sort(
      (left, right) =>
        right.priority - left.priority || left.label.localeCompare(right.label),
    );
  return {
    coalescedUpdates: tasks.reduce(
      (total, task) => total + task.coalescedUpdates,
      0,
    ),
    droppedUpdates: tasks.reduce(
      (total, task) => total + task.droppedUpdates,
      0,
    ),
    frameBudgetMs: DEFAULT_FRAME_BUDGET_MS,
    generatedAt: new Date().toISOString(),
    idleBudgetMs: DEFAULT_IDLE_BUDGET_MS,
    overBudgetRuns: tasks.reduce(
      (total, task) => total + task.overBudgetRuns,
      0,
    ),
    pendingTasks: state.pendingTasks.size,
    runs: tasks.reduce((total, task) => total + task.runs, 0),
    tasks,
  };
}

/**
 * Publish this scheduler instance to the standard editor perf dashboard key.
 *
 * Only browser/dev/test surfaces need this. The option exists because the legacy
 * scheduler also owns this key; unit tests that mount both schedulers should
 * inspect the engine scheduler instance directly instead of replacing the global.
 */
function installDashboard(state: SchedulerState): void {
  if (typeof window === "undefined") return;
  (window as unknown as Record<string, EnginePerformanceDashboard>)[
    PERF_DASHBOARD_KEY
  ] = {
    reset: () => state.taskMetrics.clear(),
    snapshot: () => snapshot(state),
  };
}

/**
 * Convert semantic priorities to sortable numbers.
 *
 * Values are intentionally spaced out so a future caller can pass a numeric
 * priority between named buckets without changing the string API.
 */
function priorityValue(priority: EngineSchedulerPriority | number = "normal") {
  if (typeof priority === "number") return priority;
  if (priority === "critical") return 1000;
  if (priority === "high") return 750;
  if (priority === "normal") return 500;
  return 250;
}

/** Browser/Node-compatible rAF fallback for jsdom and non-window tests. */
function requestFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(callback);
  }
  return Number(setTimeout(callback, 16));
}

/**
 * Browser/Node-compatible idle callback.
 *
 * Chromium/WebKit/Firefox can use real `requestIdleCallback` when available; the
 * timeout fallback supplies a small fake idle budget so tests and non-browser
 * environments exercise the same scheduling branch.
 */
function requestIdle(callback: (deadline: EngineIdleDeadline) => void): number {
  const idle = (
    globalThis as {
      requestIdleCallback?: (
        cb: (deadline: EngineIdleDeadline) => void,
        options?: { timeout: number },
      ) => number;
    }
  ).requestIdleCallback;
  if (idle) return idle(callback, { timeout: DEFAULT_IDLE_TIMEOUT_MS });
  return Number(
    setTimeout(
      () =>
        callback({
          didTimeout: false,
          timeRemaining: () => DEFAULT_IDLE_BUDGET_MS,
        }),
      1,
    ),
  );
}

/** Central clock helper so metrics work in browsers, jsdom, and Node. */
function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

/** Keep dashboard JSON stable and readable without affecting internal precision. */
function rounded(value: number): number {
  return Number(value.toFixed(3));
}
