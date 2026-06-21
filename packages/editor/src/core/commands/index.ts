/** Command/query dispatch table + public re-exports (docs/020 §7.5). */
import {
  type EditorNode,
  type JsonValue,
  type NodeId,
  type TextLeafType,
  type TextMarkKind,
} from "../model";
import type { MarkdownShortcut } from "../markdown-shortcuts";
import type { EditorStore, TransactionBuilder } from "../store";
import {
  compileDelete,
  compileDeleteSelection,
  compileInsertText,
  compileSplit,
} from "./text";
import { compileLink, compileToggleMark } from "./marks";
import {
  compileApplyMarkdown,
  compileIndent,
  compileSetBlockAttr,
  compileSetBlockType,
} from "./blocks";
import {
  compileInsertBlocks,
  compileInsertObject,
  compileInsertStructural,
  compileMoveBlock,
  compileRemoveBlock,
  compileSetObjectData,
} from "./objects";
import {
  activeLinkHref,
  canIndent,
  canOutdent,
  currentBlockType,
  currentListType,
  isMarkActive,
} from "./shared";
export type EditorCommand =
  | { readonly type: "insert-text"; readonly text: string }
  | { readonly type: "delete-backward" }
  | { readonly type: "delete-forward" }
  | { readonly type: "delete-selection" }
  | { readonly type: "split-block" }
  | {
      readonly type: "toggle-mark";
      readonly mark: TextMarkKind;
    }
  | {
      readonly type: "set-link";
      readonly href: string;
    }
  | { readonly type: "clear-link" }
  | {
      readonly type: "set-block-type";
      readonly blockType: TextLeafType;
      /** Optional heading tag (`h1`..`h6`) carried as a `tag` attr. */
      readonly tag?: string;
      /** Optional list flavour (`bullet`/`number`) carried as a `listType` attr. */
      readonly listType?: string;
    }
  | {
      readonly type: "set-block-attr";
      readonly key: string;
      /** The new attr value; `undefined` clears it. */
      readonly value: JsonValue | undefined;
      /** Target a specific block; defaults to the covered leaves (selection). */
      readonly node?: NodeId;
    }
  | {
      readonly type: "remove-block";
      readonly node: NodeId;
    }
  | { readonly type: "indent" }
  | { readonly type: "outdent" }
  | {
      readonly type: "move-block";
      readonly node: NodeId;
      /** New index in the body order (clamped). */
      readonly toIndex: number;
    }
  | {
      readonly type: "insert-object";
      readonly objectType: string;
      readonly data: JsonValue;
    }
  | {
      readonly type: "apply-markdown";
      readonly shortcut: MarkdownShortcut;
    }
  | {
      readonly type: "insert-blocks";
      readonly nodes: readonly EditorNode[];
    }
  | { readonly type: "insert-structural"; readonly structuralType: string }
  | {
      readonly type: "set-object-data";
      readonly node: NodeId;
      readonly data: JsonValue;
    };

export type EditorCommandType = EditorCommand["type"];

/** A read-only query over current state for toolbar enabled/active flags. */
export type EditorQuery =
  | { readonly type: "is-mark-active"; readonly mark: TextMarkKind }
  | { readonly type: "can-indent" }
  | { readonly type: "can-outdent" }
  | { readonly type: "current-block-type" }
  | { readonly type: "current-list-type" }
  | { readonly type: "active-link-href" };

type CommandCompiler = (
  store: EditorStore,
  command: EditorCommand,
) => TransactionBuilder | null;

const compilers: { [K in EditorCommandType]: CommandCompiler } = {
  "apply-markdown": (store, command) =>
    command.type === "apply-markdown"
      ? compileApplyMarkdown(store, command.shortcut)
      : null,
  "clear-link": (store) => compileLink(store, null),
  "delete-backward": (store) => compileDelete(store, -1),
  "delete-forward": (store) => compileDelete(store, 1),
  "delete-selection": (store) => compileDeleteSelection(store),
  indent: (store) => compileIndent(store, "indent"),
  "insert-blocks": (store, command) =>
    command.type === "insert-blocks"
      ? compileInsertBlocks(store, command.nodes)
      : null,
  "insert-object": (store, command) =>
    command.type === "insert-object"
      ? compileInsertObject(store, command.objectType, command.data)
      : null,
  "insert-structural": (store, command) =>
    command.type === "insert-structural"
      ? compileInsertStructural(store, command.structuralType)
      : null,
  "insert-text": (store, command) =>
    command.type === "insert-text"
      ? compileInsertText(store, command.text)
      : null,
  "move-block": (store, command) =>
    command.type === "move-block"
      ? compileMoveBlock(store, command.node, command.toIndex)
      : null,
  outdent: (store) => compileIndent(store, "outdent"),
  "remove-block": (store, command) =>
    command.type === "remove-block"
      ? compileRemoveBlock(store, command.node)
      : null,
  "set-block-attr": (store, command) =>
    command.type === "set-block-attr"
      ? compileSetBlockAttr(store, command.key, command.value, command.node)
      : null,
  "set-block-type": (store, command) =>
    command.type === "set-block-type"
      ? compileSetBlockType(
          store,
          command.blockType,
          command.tag,
          command.listType,
        )
      : null,
  "set-link": (store, command) =>
    command.type === "set-link" ? compileLink(store, command.href) : null,
  "set-object-data": (store, command) =>
    command.type === "set-object-data"
      ? compileSetObjectData(store, command.node, command.data)
      : null,
  "split-block": (store) => compileSplit(store),
  "toggle-mark": (store, command) =>
    command.type === "toggle-mark"
      ? compileToggleMark(store, command.mark)
      : null,
};

/** Compile a command to a transaction, or `null` when it does not apply. */
export function compileCommand(
  store: EditorStore,
  command: EditorCommand,
): TransactionBuilder | null {
  return compilers[command.type](store, command);
}

/** Answer a read-only query over the current state. */
export function runQuery(
  store: EditorStore,
  query: EditorQuery,
): boolean | TextLeafType | string | null {
  switch (query.type) {
    case "is-mark-active":
      return isMarkActive(store, query.mark);
    case "can-indent":
      return canIndent(store);
    case "can-outdent":
      return canOutdent(store);
    case "current-block-type":
      return currentBlockType(store);
    case "current-list-type":
      return currentListType(store);
    case "active-link-href":
      return activeLinkHref(store);
  }
}

// Re-export the shared scope/insertion helpers and type so the public
// `core/commands` surface is unchanged after the split (docs/020 §7.5).
export {
  activeScope,
  childrenOf,
  isDisposableEmpty,
  pendingFormatMarkSteps,
  placeNodes,
  resolveInsertionPoint,
  scopePath,
  type InsertionPoint,
} from "./shared";
