import {
  allocateHeadingAnchorId,
  headingLevelFromTag,
  headingTagFromLevel,
  normalizeTocSettings,
  type RichTextHeadingTag,
  type RichTextTocEntry,
  type RichTextTocSettingsInput,
} from "@quanghuy1242/idco-lib";
import {
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  type LexicalNode,
} from "lexical";
import { $isEditorHeadingNode } from "../nodes/heading-node";
import {
  createEditorSchedulerTask,
  type EditorTaskRunContext,
  type EditorUpdatePayload,
} from "./editor-performance";

export type EditorTocHeadingSnapshot = {
  readonly anchorId: string | undefined;
  readonly key: string;
  readonly tag: RichTextHeadingTag;
  readonly text: string;
};

type ChunkedTocJob = {
  counters: number[];
  entries: RichTextTocEntry[];
  headings: readonly EditorTocHeadingSnapshot[];
  index: number;
  publish: (entries: RichTextTocEntry[]) => void;
  settings: ReturnType<typeof normalizeTocSettings>;
  stack: number[];
  usedIds: Set<string>;
};

export function $collectEditorTocEntries(
  settings?: RichTextTocSettingsInput,
): RichTextTocEntry[] {
  return collectEditorTocEntriesFromHeadings(
    $snapshotEditorTocHeadings(),
    settings,
  );
}

export function $snapshotEditorTocHeadings(): EditorTocHeadingSnapshot[] {
  const headings: EditorTocHeadingSnapshot[] = [];
  $collectHeadingNodes($getRoot(), headings);
  return headings;
}

export function $hasTocRelevantUpdate(payload: EditorUpdatePayload): boolean {
  const dirtyKeys = new Set<string>([
    ...payload.dirtyElements.keys(),
    ...payload.dirtyLeaves,
  ]);
  if (dirtyKeys.size === 0) return false;
  if (dirtyKeys.size > 200) return true;

  let sawNonRootDirtyNode = false;
  for (const key of dirtyKeys) {
    const node = $getNodeByKey(key);
    if (!node) continue;
    if (node.getType() !== "root") sawNonRootDirtyNode = true;
    if ($isTocRelevantNodeOrAncestor(node)) return true;
  }

  return !sawNonRootDirtyNode;
}

export function collectEditorTocEntriesFromHeadings(
  headings: readonly EditorTocHeadingSnapshot[],
  settingsInput?: RichTextTocSettingsInput,
): RichTextTocEntry[] {
  const job = createTocJob(headings, settingsInput, () => undefined);
  while (job.index < job.headings.length) {
    processTocHeading(job, job.headings[job.index]);
    job.index += 1;
  }
  return job.entries;
}

export function createChunkedEditorTocEntriesTask({
  label,
}: {
  readonly label: string;
}) {
  const task = createEditorSchedulerTask<ChunkedTocJob>(
    {
      budgetMs: 4,
      coalesce: "latest",
      cost: "builds TOC entries from a heading snapshot in budgeted chunks",
      frequency: "after heading or TOC settings updates",
      label,
      lane: "idle",
      priority: "low",
    },
    (job, context) => runTocChunk(job, context),
  );

  return {
    cancel: task.cancel,
    schedule: ({
      headings,
      publish,
      settings,
    }: {
      readonly headings: readonly EditorTocHeadingSnapshot[];
      readonly publish: (entries: RichTextTocEntry[]) => void;
      readonly settings?: RichTextTocSettingsInput;
    }) => {
      task.schedule(createTocJob(headings, settings, publish));
    },
  };
}

export function sameTocEntries(
  current: readonly RichTextTocEntry[],
  next: readonly RichTextTocEntry[],
): boolean {
  if (current.length !== next.length) return false;
  return current.every((entry, index) => {
    const candidate = next[index];
    return (
      candidate !== undefined &&
      entry.depth === candidate.depth &&
      entry.href === candidate.href &&
      entry.id === candidate.id &&
      entry.level === candidate.level &&
      entry.number === candidate.number &&
      sameOrdinal(entry.ordinal, candidate.ordinal) &&
      entry.tag === candidate.tag &&
      entry.text === candidate.text
    );
  });
}

function createTocJob(
  headings: readonly EditorTocHeadingSnapshot[],
  settingsInput: RichTextTocSettingsInput | undefined,
  publish: (entries: RichTextTocEntry[]) => void,
): ChunkedTocJob {
  return {
    counters: [],
    entries: [],
    headings,
    index: 0,
    publish,
    settings: normalizeTocSettings(settingsInput),
    stack: [],
    usedIds: new Set(),
  };
}

function runTocChunk(job: ChunkedTocJob, context: EditorTaskRunContext) {
  let processed = 0;
  while (
    job.index < job.headings.length &&
    (processed === 0 || !context.shouldYield())
  ) {
    processTocHeading(job, job.headings[job.index]);
    job.index += 1;
    processed += 1;
  }

  if (job.index < job.headings.length) return "continue";
  job.publish(job.entries);
}

function processTocHeading(
  job: ChunkedTocJob,
  heading: EditorTocHeadingSnapshot | undefined,
): void {
  if (!heading) return;
  const level = headingLevelFromTag(heading.tag);
  if (level < job.settings.minLevel || level > job.settings.maxLevel) return;

  while (
    job.stack.length > 0 &&
    (job.stack[job.stack.length - 1] ?? 0) >= level
  ) {
    job.stack.pop();
  }
  const depth = job.stack.length;
  job.stack.push(level);
  job.counters.length = depth + 1;
  job.counters[depth] = (job.counters[depth] ?? 0) + 1;
  const ordinal = job.counters.slice(0, depth + 1);
  const id = allocateHeadingAnchorId(
    heading.anchorId ?? (heading.text || "section"),
    job.usedIds,
  );
  const text = heading.text.trim() || "Untitled section";
  job.entries.push({
    depth,
    href: `#${id}`,
    id,
    level,
    number:
      job.settings.numbering === "decimal" ? ordinal.join(".") : undefined,
    ordinal,
    tag: headingTagFromLevel(level),
    text,
  });
}

function $collectHeadingNodes(
  node: LexicalNode,
  headings: EditorTocHeadingSnapshot[],
): void {
  if ($isEditorHeadingNode(node)) {
    headings.push({
      anchorId: node.getAnchorId(),
      key: node.getKey(),
      tag: node.getTag(),
      text: node.getTextContent(),
    });
  }
  if (!$isElementNode(node)) return;
  for (const child of node.getChildren()) {
    $collectHeadingNodes(child, headings);
  }
}

function $isTocRelevantNodeOrAncestor(node: LexicalNode): boolean {
  let current: LexicalNode | null = node;
  while (current) {
    if (
      $isEditorHeadingNode(current) ||
      current.getType() === "table-of-contents"
    ) {
      return true;
    }
    current = current.getParent();
  }
  return false;
}

function sameOrdinal(
  current: readonly number[],
  next: readonly number[],
): boolean {
  return (
    current.length === next.length &&
    current.every((value, index) => value === next[index])
  );
}
