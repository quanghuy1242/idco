import type {
  RichTextEditorDocument,
  RichTextEditorNode,
} from "../../model/schema";
import { richTextNodeSignature } from "./signatures";

export type RichTextNodeId = `rt_${string}`;

type EnsureDocumentNodeIdsOptions = {
  readonly previousDocument?: RichTextEditorDocument;
  readonly createId?: (seed: string) => string;
};

export function ensureDocumentNodeIds(
  document: RichTextEditorDocument,
  options: EnsureDocumentNodeIdsOptions = {},
): RichTextEditorDocument {
  const used = new Set<string>();
  const previousChildren = options.previousDocument?.root.children ?? [];
  const incomingRootIds = new Set(
    document.root.children
      .map((node) => cleanId(node.id))
      .filter((id): id is string => id !== undefined),
  );
  const children = document.root.children.map((node, index) =>
    repairNodeId({
      createId: options.createId,
      fillMissing: true,
      node,
      path: `root.${index}`,
      previous: sameTypePrevious(node, previousChildren[index]),
      reservedIds: incomingRootIds,
      used,
    }),
  );
  return { root: { children } };
}

export function isRichTextNodeId(value: unknown): value is RichTextNodeId {
  return typeof value === "string" && /^rt_[a-z0-9][a-z0-9_-]*$/i.test(value);
}

export function createRichTextNodeId(seed: string): RichTextNodeId {
  const clean = seed.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "");
  return `rt_${clean || "node"}`;
}

function repairNodeId({
  createId,
  fillMissing,
  node,
  path,
  previous,
  reservedIds,
  used,
}: {
  readonly createId?: (seed: string) => string;
  readonly fillMissing: boolean;
  readonly node: RichTextEditorNode;
  readonly path: string;
  readonly previous?: RichTextEditorNode;
  readonly reservedIds: ReadonlySet<string>;
  readonly used: Set<string>;
}): RichTextEditorNode {
  const children =
    node.children?.map((child, index) =>
      repairNodeId({
        createId,
        fillMissing: false,
        node: child,
        path: `${path}.${index}`,
        previous: sameTypePrevious(child, previous?.children?.[index]),
        reservedIds,
        used,
      }),
    ) ?? undefined;

  const previousId = cleanId(previous?.id);
  const preservedId =
    cleanId(node.id) ??
    (fillMissing && previousId && !reservedIds.has(previousId)
      ? previousId
      : undefined);
  const id = allocateId({
    createId,
    fillMissing,
    path,
    preferred: preservedId,
    seed: `${path}:${node.type}:${richTextNodeSignature(node)}`,
    used,
  });

  return {
    ...node,
    ...(id ? { id } : {}),
    ...(children ? { children } : {}),
  };
}

function allocateId({
  createId,
  fillMissing,
  path,
  preferred,
  seed,
  used,
}: {
  readonly createId?: (seed: string) => string;
  readonly fillMissing: boolean;
  readonly path: string;
  readonly preferred?: string;
  readonly seed: string;
  readonly used: Set<string>;
}): string | undefined {
  if (preferred && !used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  if (!preferred && !fillMissing) return undefined;

  const base =
    cleanId(createId?.(seed)) ?? createRichTextNodeId(hashSeed(seed));
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${hashSeed(`${path}:${suffix}`)}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function sameTypePrevious(
  node: RichTextEditorNode,
  previous: RichTextEditorNode | undefined,
): RichTextEditorNode | undefined {
  return previous?.type === node.type ? previous : undefined;
}

function cleanId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hashSeed(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash, 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}
