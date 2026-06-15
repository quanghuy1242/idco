import {
  $getSelection,
  $isRangeSelection,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";

/**
 * Editor update work is split by how close it must stay to Lexical's critical
 * editing path. Keep `sync` rare: every other lane enters the shared scheduler
 * so repeated key events cannot build an unbounded queue of React work.
 */
export type EditorUpdateLane = "sync" | "frame" | "idle" | "debounced";

/**
 * Priority only orders tasks within the same lane. It does not let low-value
 * work jump from `idle` into `frame`, which keeps the lane choice explicit.
 */
export type EditorUpdatePriority = "critical" | "high" | "normal" | "low";

/**
 * Controls what happens when a listener receives another editor update before
 * its previous scheduled work has run.
 */
export type EditorUpdateCoalesce = "latest" | "drop-if-pending" | "merge";

/**
 * The review contract every editor update subscriber must declare. The values
 * are intentionally descriptive because they are surfaced in dev warnings,
 * Playwright perf artifacts, and the in-browser perf dashboard.
 */
export type EditorUpdateContract<Payload = unknown> = {
  /** Stable human-readable task name used as the metrics key. */
  readonly label: string;
  /** Scheduling lane for this work. */
  readonly lane: EditorUpdateLane;
  /** When this task is expected to run. */
  readonly frequency: string;
  /** What this task reads or writes; used by reviewers to spot hidden cost. */
  readonly cost: string;
  /** Per-task budget before slow-listener instrumentation records a violation. */
  readonly budgetMs?: number;
  /** Pending payload policy. Defaults to latest-state-wins. */
  readonly coalesce?: EditorUpdateCoalesce;
  /** Debounce delay for `debounced` lane work. */
  readonly debounceMs?: number;
  /** Required only for `coalesce: "merge"`. */
  readonly merge?: (current: Payload, next: Payload) => Payload;
  /** Queue ordering within the selected lane. */
  readonly priority?: EditorUpdatePriority | number;
};

/**
 * Passed to budget-aware tasks. Derived work can call `shouldYield()` and return
 * `"continue"` to resume on a later frame/idle callback without blocking input.
 */
export type EditorTaskRunContext = {
  readonly budgetMs: number;
  readonly deadlineMs: number;
  readonly elapsedMs: () => number;
  readonly shouldYield: () => boolean;
};

export type EditorTaskRunResult = "continue" | void;

/** Handle returned by `createEditorSchedulerTask` for non-Lexical derived work. */
export type EditorSchedulerTask<Payload extends object> = {
  /** Dispose the task and remove any pending payload from the queue. */
  readonly cancel: () => void;
  /** Run the pending payload immediately, bypassing lane timing. */
  readonly flush: () => void;
  /** Schedule a payload under the task contract's lane/coalescing policy. */
  readonly schedule: (payload: Payload) => void;
};

/** Per-task row exposed through `window.__IDCO_EDITOR_PERF__`. */
export type EditorPerformanceTaskSnapshot = {
  readonly averageMs: number;
  readonly budgetMs: number;
  readonly coalescedUpdates: number;
  readonly continuedRuns: number;
  readonly cost: string;
  readonly droppedUpdates: number;
  readonly frequency: string;
  readonly label: string;
  readonly lane: EditorUpdateLane;
  readonly lastDurationMs: number;
  readonly maxMs: number;
  readonly overBudgetRuns: number;
  readonly pending: boolean;
  readonly priority: number;
  readonly runs: number;
};

/** Point-in-time scheduler metrics consumed by Playwright perf tests. */
export type EditorPerformanceSnapshot = {
  readonly coalescedUpdates: number;
  readonly droppedUpdates: number;
  readonly frameBudgetMs: number;
  readonly generatedAt: string;
  readonly idleBudgetMs: number;
  readonly overBudgetRuns: number;
  readonly pendingTasks: number;
  readonly runs: number;
  readonly tasks: readonly EditorPerformanceTaskSnapshot[];
};

/** Development/test-only dashboard installed on `window`. */
export type EditorPerformanceDashboard = {
  readonly reset: () => void;
  readonly snapshot: () => EditorPerformanceSnapshot;
};

type EditorUpdateListener = Parameters<
  LexicalEditor["registerUpdateListener"]
>[0];

export type EditorUpdatePayload = Parameters<EditorUpdateListener>[0];

type EditorIdleDeadline = {
  readonly didTimeout: boolean;
  readonly timeRemaining: () => number;
};

/*
 * Internal metrics stay mutable so hot-path updates do not allocate a fresh
 * snapshot object for every editor update. Public callers only receive copied
 * immutable snapshots through `editorPerformanceSnapshot`.
 */
type InternalTaskMetrics = {
  averageMs: number;
  budgetMs: number;
  coalescedUpdates: number;
  continuedRuns: number;
  cost: string;
  droppedUpdates: number;
  frequency: string;
  label: string;
  lane: EditorUpdateLane;
  lastDurationMs: number;
  maxMs: number;
  overBudgetRuns: number;
  pending: boolean;
  priority: number;
  runs: number;
  totalMs: number;
};

/*
 * Type-erased task metadata is what the global queue needs for sorting and
 * metrics. The payload-specific runner stays behind `runPending`, so the queue
 * can hold many differently typed tasks without unsafe payload access.
 */
type EditorTaskMetadata = {
  readonly budgetMs?: number;
  readonly cost: string;
  readonly frequency: string;
  readonly label: string;
  readonly lane: EditorUpdateLane;
  readonly priority?: EditorUpdatePriority | number;
};

type QueuedEditorTask = {
  readonly contract: EditorTaskMetadata;
  readonly id: number;
  readonly runPending: (context: EditorTaskRunContext) => void;
  disposed: boolean;
  hasPendingPayload: boolean;
  queued: boolean;
  sequence: number;
};

/*
 * Payload-specific state lives here. `pendingPayload` is deliberately one slot:
 * a burst of editor updates should collapse into the latest useful state, not
 * replay every intermediate document snapshot.
 */
type InternalScheduledTask<Payload extends object> = QueuedEditorTask & {
  readonly coalesce: EditorUpdateCoalesce | undefined;
  readonly merge: ((current: Payload, next: Payload) => Payload) | undefined;
  readonly run: (
    payload: Payload,
    context: EditorTaskRunContext,
  ) => EditorTaskRunResult;
  debounceHandle: ReturnType<typeof setTimeout> | null;
  pendingPayload: Payload | null;
};

/** Single process-wide scheduler; individual editors register tasks into it. */
type EditorSchedulerState = {
  debouncedHandle: ReturnType<typeof setTimeout> | null;
  frameHandle: number | null;
  idleHandle: number | null;
  nextTaskId: number;
  pendingTasks: Set<QueuedEditorTask>;
  sequence: number;
  taskMetrics: Map<string, InternalTaskMetrics>;
};

const DEFAULT_BUDGET_MS = 8;
const DEFAULT_DEBOUNCE_MS = 80;
const DEFAULT_FRAME_BUDGET_MS = 6;
const DEFAULT_IDLE_BUDGET_MS = 10;
const DEFAULT_DEBOUNCED_BUDGET_MS = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 160;

let schedulerState: EditorSchedulerState | null = null;

declare global {
  interface Window {
    __IDCO_EDITOR_PERF__?: EditorPerformanceDashboard;
  }
}

/**
 * Register a Lexical update listener through the editor performance contract.
 *
 * `sync` listeners run immediately and are only measured. All other lanes enter
 * the shared scheduler, where repeated updates coalesce and lane budgets decide
 * when the work is allowed to run.
 */
export function registerEditorUpdateListener(
  editor: LexicalEditor,
  contract: EditorUpdateContract<EditorUpdatePayload>,
  listener: EditorUpdateListener,
): () => void {
  if (contract.lane === "sync") {
    return editor.registerUpdateListener((payload) => {
      runMeasuredEditorUpdate(contract, () => listener(payload));
    });
  }

  return registerCoalescedEditorUpdateListener(editor, contract, listener);
}

/**
 * Compatibility helper for Lexical update listeners that should be scheduled.
 * Prefer `registerEditorUpdateListener` at call sites so the `sync` decision is
 * visible next to the contract.
 */
export function registerCoalescedEditorUpdateListener(
  editor: LexicalEditor,
  contract: EditorUpdateContract<EditorUpdatePayload>,
  listener: EditorUpdateListener,
): () => void {
  const task = createEditorSchedulerTask(contract, (payload) => {
    listener(payload);
  });
  const unregister = editor.registerUpdateListener((payload) => {
    task.schedule(payload);
  });
  return () => {
    task.cancel();
    unregister();
  };
}

/**
 * Create a scheduled task for derived editor work that is not itself a raw
 * Lexical update listener, for example chunked TOC building after a heading
 * snapshot has already been captured.
 */
export function createEditorSchedulerTask<Payload extends object>(
  contract: EditorUpdateContract<Payload>,
  run: (payload: Payload, context: EditorTaskRunContext) => EditorTaskRunResult,
): EditorSchedulerTask<Payload> {
  const scheduler = getEditorSchedulerState();
  let task: InternalScheduledTask<Payload>;
  task = {
    coalesce: contract.coalesce,
    contract,
    debounceHandle: null,
    disposed: false,
    hasPendingPayload: false,
    id: scheduler.nextTaskId,
    merge: contract.merge,
    pendingPayload: null,
    queued: false,
    run,
    // Keep the queue type-erased while preserving the payload type in this closure.
    runPending: (context) => runEditorSchedulerTask(scheduler, task, context),
    sequence: 0,
  };
  scheduler.nextTaskId += 1;
  syncTaskMetrics(scheduler, task);

  const schedule = (payload: Payload) => {
    if (task.disposed) return;
    setTaskPayload(scheduler, task, payload);
    if (contract.lane === "debounced") {
      // Debounced work still enters the global queue after the timer fires, so it
      // shares metrics and budget enforcement with frame/idle work.
      if (task.debounceHandle !== null) clearTimeout(task.debounceHandle);
      task.debounceHandle = setTimeout(() => {
        task.debounceHandle = null;
        enqueueEditorTask(scheduler, task);
      }, contract.debounceMs ?? DEFAULT_DEBOUNCE_MS);
      return;
    }
    enqueueEditorTask(scheduler, task);
  };

  const flush = () => {
    if (task.disposed || !task.hasPendingPayload) return;
    if (task.debounceHandle !== null) {
      clearTimeout(task.debounceHandle);
      task.debounceHandle = null;
    }
    scheduler.pendingTasks.delete(task);
    task.queued = false;
    runEditorSchedulerTask(scheduler, task, createTaskRunContext(contract));
  };

  const cancel = () => {
    task.disposed = true;
    task.hasPendingPayload = false;
    task.pendingPayload = null;
    if (task.debounceHandle !== null) {
      clearTimeout(task.debounceHandle);
      task.debounceHandle = null;
    }
    scheduler.pendingTasks.delete(task);
    task.queued = false;
    syncTaskMetrics(scheduler, task);
  };

  return { cancel, flush, schedule };
}

/** Set React state only when semantic equality says the value really changed. */
export function setStateIfChanged<T>(
  setState: Dispatch<SetStateAction<T>>,
  next: T,
  equals: (current: T, next: T) => boolean = Object.is,
): void {
  setState((current) => (equals(current, next) ? current : next));
}

/**
 * Fast DOM-level guard for selection surfaces. During normal typing/backspace
 * the selection is collapsed, so plugins can avoid reading expensive command
 * context from Lexical.
 */
export function hasNonCollapsedDomSelection(root: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false;
  }
  const range = selection.getRangeAt(0);
  return rootContainsNode(root, range.commonAncestorContainer);
}

/** Lexical-side equivalent of the DOM collapsed-selection fast path. */
export function $hasCollapsedRangeSelection(): boolean {
  const selection = $getSelection();
  return $isRangeSelection(selection) && selection.isCollapsed();
}

/**
 * Publish derived state through the scheduler. This is used for host-facing or
 * diagnostic outputs where freshness may trail typing, such as JSON previews.
 */
export function useDerivedStatePublisher<Input extends object, Output>({
  budgetMs = DEFAULT_BUDGET_MS,
  cost = "derives and publishes non-Lexical editor state",
  derive,
  equals = Object.is,
  label = "derived editor state publisher",
  lane,
  publish,
  priority,
  timeoutMs,
}: {
  readonly budgetMs?: number;
  readonly cost?: string;
  readonly derive: (input: Input) => Output;
  readonly equals?: (current: Output, next: Output) => boolean;
  readonly label?: string;
  readonly lane: "idle" | "debounced";
  readonly publish: (output: Output) => void;
  readonly priority?: EditorUpdatePriority | number;
  readonly timeoutMs?: number;
}): {
  readonly cancel: () => void;
  readonly flush: () => void;
  readonly schedule: (input: Input) => void;
} {
  const deriveRef = useRef(derive);
  const equalsRef = useRef(equals);
  const latestOutputRef = useRef<Output | null>(null);
  const publishRef = useRef(publish);
  const taskRef = useRef<EditorSchedulerTask<Input> | null>(null);

  // Keep the scheduled task stable while letting it call the latest closures.
  useEffect(() => {
    deriveRef.current = derive;
    equalsRef.current = equals;
    publishRef.current = publish;
  }, [derive, equals, publish]);

  if (taskRef.current === null) {
    taskRef.current = createEditorSchedulerTask<Input>(
      {
        budgetMs,
        cost,
        debounceMs: timeoutMs,
        frequency:
          lane === "debounced"
            ? "after the latest input settles"
            : "during idle time after the latest input",
        label,
        lane,
        priority: priority ?? (lane === "idle" ? "low" : "normal"),
      },
      (input) => {
        const next = deriveRef.current(input);
        const current = latestOutputRef.current;
        if (current !== null && equalsRef.current(current, next)) return;
        latestOutputRef.current = next;
        publishRef.current(next);
      },
    );
  }

  const cancel = useCallback(() => {
    taskRef.current?.cancel();
  }, []);

  const flush = useCallback(() => {
    taskRef.current?.flush();
  }, []);

  const schedule = useCallback((input: Input) => {
    taskRef.current?.schedule(input);
  }, []);

  useEffect(() => () => flush(), [flush]);

  return { cancel, flush, schedule };
}

/** Convenience wrapper for debounced derivation from a Lexical EditorState. */
export function useDebouncedEditorStatePublisher<Output>({
  budgetMs,
  cost,
  delayMs = DEFAULT_DEBOUNCE_MS,
  derive,
  label,
  publish,
  priority,
}: {
  readonly budgetMs?: number;
  readonly cost?: string;
  readonly delayMs?: number;
  readonly derive: (editorState: EditorState) => Output;
  readonly label?: string;
  readonly publish: (output: Output) => void;
  readonly priority?: EditorUpdatePriority | number;
}): {
  readonly flush: () => void;
  readonly schedule: (editorState: EditorState) => void;
} {
  const { flush, schedule } = useDerivedStatePublisher<EditorState, Output>({
    budgetMs,
    cost,
    derive,
    label,
    lane: "debounced",
    publish,
    priority,
    timeoutMs: delayMs,
  });
  return { flush, schedule };
}

function runMeasuredEditorUpdate(
  contract: EditorUpdateContract<EditorUpdatePayload>,
  run: () => void,
): void {
  const scheduler = getEditorSchedulerState();
  const startedAt = now();
  run();
  const duration = now() - startedAt;
  recordTaskRun(scheduler, contract, duration, false);
  logSlowEditorUpdate(duration, contract);
}

function setTaskPayload<Payload extends object>(
  scheduler: EditorSchedulerState,
  task: InternalScheduledTask<Payload>,
  payload: Payload,
): void {
  if (!task.hasPendingPayload) {
    task.pendingPayload = payload;
    task.hasPendingPayload = true;
    syncTaskMetrics(scheduler, task);
    return;
  }

  const metrics = taskMetricsFor(scheduler, task.contract);
  const coalesce = task.coalesce ?? "latest";
  if (coalesce === "drop-if-pending") {
    metrics.droppedUpdates += 1;
    return;
  }

  // Most editor tasks want latest-state-wins behavior: if a new keypress arrives
  // before scheduled work runs, only the newest coherent payload matters.
  metrics.coalescedUpdates += 1;
  task.pendingPayload =
    coalesce === "merge" && task.merge && task.pendingPayload
      ? task.merge(task.pendingPayload, payload)
      : payload;
}

function enqueueEditorTask<Payload extends object>(
  scheduler: EditorSchedulerState,
  task: InternalScheduledTask<Payload>,
): void {
  if (task.disposed || !task.hasPendingPayload) return;
  if (!task.queued) {
    task.sequence = scheduler.sequence;
    scheduler.sequence += 1;
    scheduler.pendingTasks.add(task);
    task.queued = true;
  }
  syncTaskMetrics(scheduler, task);
  scheduleLaneFlush(scheduler, task.contract.lane);
}

function scheduleLaneFlush(
  scheduler: EditorSchedulerState,
  lane: EditorUpdateLane,
): void {
  if (lane === "frame") {
    if (scheduler.frameHandle !== null) return;
    scheduler.frameHandle = requestAnimationFrame(() => {
      scheduler.frameHandle = null;
      flushEditorLane(scheduler, "frame");
    });
    return;
  }

  if (lane === "idle") {
    if (scheduler.idleHandle !== null) return;
    scheduler.idleHandle = scheduleIdleWork((deadline) => {
      scheduler.idleHandle = null;
      flushEditorLane(scheduler, "idle", deadline);
    });
    return;
  }

  if (lane === "debounced") {
    if (scheduler.debouncedHandle !== null) return;
    scheduler.debouncedHandle = setTimeout(() => {
      scheduler.debouncedHandle = null;
      flushEditorLane(scheduler, "debounced");
    }, 0);
  }
}

function flushEditorLane(
  scheduler: EditorSchedulerState,
  lane: Exclude<EditorUpdateLane, "sync">,
  idleDeadline?: EditorIdleDeadline,
): void {
  const budgetMs = laneBudgetMs(lane, idleDeadline);
  const startedAt = now();
  let ranTask = false;

  while (hasPendingLaneTasks(scheduler, lane)) {
    // Always run at least one task once the lane wakes up; after that, respect
    // the lane's shared budget and carry remaining work to the next flush.
    if (ranTask && now() - startedAt >= budgetMs) break;
    const task = nextPendingTask(scheduler, lane);
    if (!task) break;
    scheduler.pendingTasks.delete(task);
    task.queued = false;
    task.runPending(createTaskRunContext(task.contract, startedAt + budgetMs));
    ranTask = true;
  }

  if (hasPendingLaneTasks(scheduler, lane)) {
    scheduleLaneFlush(scheduler, lane);
  }
}

function runEditorSchedulerTask<Payload extends object>(
  scheduler: EditorSchedulerState,
  task: InternalScheduledTask<Payload>,
  context: EditorTaskRunContext,
): void {
  if (
    task.disposed ||
    !task.hasPendingPayload ||
    task.pendingPayload === null
  ) {
    syncTaskMetrics(scheduler, task);
    return;
  }

  const payload = task.pendingPayload;
  task.hasPendingPayload = false;
  task.pendingPayload = null;
  syncTaskMetrics(scheduler, task);

  const startedAt = now();
  let result: EditorTaskRunResult = undefined;
  let thrown: unknown;
  try {
    result = task.run(payload, context);
  } catch (error) {
    thrown = error;
  }
  const duration = now() - startedAt;
  recordTaskRun(scheduler, task.contract, duration, result === "continue");
  logSlowEditorUpdate(duration, task.contract);

  if (!task.disposed && result === "continue" && !task.hasPendingPayload) {
    // Chunked tasks requeue the same payload only when no newer payload replaced
    // it while the task was running.
    task.pendingPayload = payload;
    task.hasPendingPayload = true;
    enqueueEditorTask(scheduler, task);
  } else if (!task.disposed && task.hasPendingPayload) {
    enqueueEditorTask(scheduler, task);
  }

  if (thrown !== undefined) throw thrown;
}

function nextPendingTask(
  scheduler: EditorSchedulerState,
  lane: EditorUpdateLane,
): QueuedEditorTask | null {
  const tasks = Array.from(scheduler.pendingTasks).filter(
    (task) => task.contract.lane === lane,
  );
  // Higher priority wins within a lane; sequence preserves FIFO among equals.
  tasks.sort((left, right) => {
    const priorityDelta =
      priorityValue(right.contract.priority, right.contract.lane) -
      priorityValue(left.contract.priority, left.contract.lane);
    return priorityDelta || left.sequence - right.sequence;
  });
  return tasks[0] ?? null;
}

function hasPendingLaneTasks(
  scheduler: EditorSchedulerState,
  lane: EditorUpdateLane,
): boolean {
  for (const task of scheduler.pendingTasks) {
    if (task.contract.lane === lane) return true;
  }
  return false;
}

function createTaskRunContext(
  contract: EditorTaskMetadata,
  laneDeadlineMs = Infinity,
): EditorTaskRunContext {
  const startedAt = now();
  const budgetMs = contract.budgetMs ?? DEFAULT_BUDGET_MS;
  // The effective deadline is the stricter of the task's own budget and the
  // lane's remaining frame/idle budget.
  const deadlineMs = Math.min(laneDeadlineMs, startedAt + budgetMs);
  return {
    budgetMs,
    deadlineMs,
    elapsedMs: () => now() - startedAt,
    shouldYield: () => now() >= deadlineMs,
  };
}

function laneBudgetMs(
  lane: Exclude<EditorUpdateLane, "sync">,
  idleDeadline: EditorIdleDeadline | undefined,
): number {
  if (lane === "frame") return DEFAULT_FRAME_BUDGET_MS;
  if (lane === "debounced") return DEFAULT_DEBOUNCED_BUDGET_MS;
  const available = idleDeadline?.timeRemaining() ?? DEFAULT_IDLE_BUDGET_MS;
  return Math.max(1, Math.min(DEFAULT_IDLE_BUDGET_MS, available));
}

function priorityValue(
  priority: EditorUpdatePriority | number | undefined,
  lane: EditorUpdateLane,
): number {
  if (typeof priority === "number") return priority;
  if (priority === "critical") return 100;
  if (priority === "high") return 75;
  if (priority === "normal") return 50;
  if (priority === "low") return 25;
  if (lane === "sync") return 100;
  if (lane === "frame") return 60;
  if (lane === "debounced") return 40;
  return 25;
}

function recordTaskRun(
  scheduler: EditorSchedulerState,
  contract: EditorTaskMetadata,
  duration: number,
  continued: boolean,
): void {
  const metrics = taskMetricsFor(scheduler, contract);
  metrics.runs += 1;
  metrics.totalMs += duration;
  metrics.averageMs = metrics.totalMs / metrics.runs;
  metrics.lastDurationMs = duration;
  metrics.maxMs = Math.max(metrics.maxMs, duration);
  metrics.overBudgetRuns += shouldLogSlowEditorUpdate(duration, contract)
    ? 1
    : 0;
  metrics.continuedRuns += continued ? 1 : 0;
}

function syncTaskMetrics<Payload extends object>(
  scheduler: EditorSchedulerState,
  task: InternalScheduledTask<Payload>,
): void {
  const metrics = taskMetricsFor(scheduler, task.contract);
  metrics.pending = task.hasPendingPayload || task.queued;
}

function taskMetricsFor(
  scheduler: EditorSchedulerState,
  contract: EditorTaskMetadata,
): InternalTaskMetrics {
  const existing = scheduler.taskMetrics.get(contract.label);
  const priority = priorityValue(contract.priority, contract.lane);
  if (existing) {
    existing.budgetMs = contract.budgetMs ?? DEFAULT_BUDGET_MS;
    existing.cost = contract.cost;
    existing.frequency = contract.frequency;
    existing.lane = contract.lane;
    existing.priority = priority;
    return existing;
  }

  const metrics: InternalTaskMetrics = {
    averageMs: 0,
    budgetMs: contract.budgetMs ?? DEFAULT_BUDGET_MS,
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
    priority,
    runs: 0,
    totalMs: 0,
  };
  scheduler.taskMetrics.set(contract.label, metrics);
  return metrics;
}

function getEditorSchedulerState(): EditorSchedulerState {
  if (schedulerState) return schedulerState;
  schedulerState = {
    debouncedHandle: null,
    frameHandle: null,
    idleHandle: null,
    nextTaskId: 1,
    pendingTasks: new Set(),
    sequence: 1,
    taskMetrics: new Map(),
  };
  installEditorPerformanceDashboard(schedulerState);
  return schedulerState;
}

function installEditorPerformanceDashboard(state: EditorSchedulerState): void {
  if (isProductionEnvironment() || typeof window === "undefined") return;
  // Playwright reads this dashboard after each scenario and fails the scenario
  // when over-budget runs or slow-listener warnings are present.
  window["__IDCO_EDITOR_PERF__"] = {
    reset: () => {
      state.taskMetrics.clear();
    },
    snapshot: () => editorPerformanceSnapshot(state),
  };
}

function editorPerformanceSnapshot(
  state: EditorSchedulerState,
): EditorPerformanceSnapshot {
  const tasks = Array.from(state.taskMetrics.values())
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
  // Return an immutable aggregate so tests can archive stable JSON artifacts.
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

function runWithConsoleWarn(
  message: string,
  payload: Record<string, string | number>,
): void {
  const devConsole = globalThis["console"] as Console | undefined;
  devConsole?.warn(message, payload);
}

function logSlowEditorUpdate(
  duration: number,
  contract: EditorTaskMetadata,
): void {
  if (!shouldLogSlowEditorUpdate(duration, contract)) return;
  runWithConsoleWarn("[idco-editor] slow update listener", {
    budgetMs: contract.budgetMs ?? DEFAULT_BUDGET_MS,
    cost: contract.cost,
    durationMs: rounded(duration),
    frequency: contract.frequency,
    label: contract.label,
    lane: contract.lane,
    priority: priorityValue(contract.priority, contract.lane),
  });
}

function shouldLogSlowEditorUpdate(
  duration: number,
  contract: EditorTaskMetadata,
): boolean {
  if (isProductionEnvironment()) return false;
  return duration > (contract.budgetMs ?? DEFAULT_BUDGET_MS);
}

function isProductionEnvironment(): boolean {
  return (
    typeof process !== "undefined" && process.env.NODE_ENV === "production"
  );
}

function scheduleIdleWork(
  callback: (deadline: EditorIdleDeadline) => void,
): number {
  if (typeof window.requestIdleCallback === "function") {
    return window.requestIdleCallback(callback, {
      timeout: DEFAULT_IDLE_TIMEOUT_MS,
    });
  }
  // Older browsers and jsdom do not expose requestIdleCallback. The fallback
  // still routes through the idle lane and reports a small synthetic budget.
  return window.setTimeout(
    () =>
      callback({
        didTimeout: true,
        timeRemaining: () => DEFAULT_IDLE_BUDGET_MS,
      }),
    DEFAULT_DEBOUNCE_MS,
  );
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function rounded(value: number): number {
  return Number(value.toFixed(1));
}

function rootContainsNode(root: HTMLElement, node: Node): boolean {
  const target =
    node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  return target ? root.contains(target) : false;
}
