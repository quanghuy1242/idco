/**
 * Shared chrome command builders (note.md W6 / C5).
 *
 * Some model commands are dispatched from more than one chrome control. Keeping
 * the command shape here once stops the controls from drifting — the same reason
 * the toolbar and context menu now share the mark/block-type registries.
 */
import type { EditorCommand } from "../core";

/**
 * The `set-block-type` command toggling a list item on or off. A list item flips
 * back to a paragraph; anything else becomes a list item of `listType` (bullet
 * when omitted). Dispatched from the toolbar's bullet + numbered buttons and the
 * context menu's List item, which is why it lives here rather than inline in each.
 */
export function listToggleCommand(
  active: boolean,
  listType?: string,
): EditorCommand {
  return {
    blockType: active ? "paragraph" : "listitem",
    ...(listType ? { listType } : {}),
    type: "set-block-type",
  };
}
