import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNodeByKey,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isRangeSelection,
  $isRootNode,
  $setSelection,
  type BaseSelection,
  type LexicalNode,
} from "lexical";
import { useEffect, useRef } from "react";

type Action =
  | {
      readonly kind: "redirect";
      readonly key: string;
      readonly edge: "start" | "end";
    }
  | { readonly kind: "restore" };

/**
 * Keeps the caret visible during arrow navigation. Lexical has no caret slot in
 * the space around atomic blocks (decorator blocks and tables), so arrowing past
 * the last block — or above the first — lands a collapsed `RangeSelection`
 * anchored on the `RootNode`, which has no on-screen position and renders no
 * caret at all (the "cursor disappears" bug). This plugin watches for that
 * root-anchored selection and redirects it to the nearest text-bearing block
 * edge; if neither side can hold a caret it restores the last good selection so
 * the arrow is a harmless no-op instead of a vanish.
 *
 * A future gap cursor (docs/002 Part B) will let the caret actually *rest* in
 * those gaps; this is the Part A safety net so it is never invisible.
 */
export function BlockNavigationPlugin() {
  const [editor] = useLexicalComposerContext();
  const lastGood = useRef<BaseSelection | null>(null);

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        const resolved = editorState.read((): Action | null => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
            return null;
          }
          const anchorNode = selection.anchor.getNode();
          if (!$isRootNode(anchorNode)) {
            // A normal text caret — remember it so we can fall back to it.
            lastGood.current = selection.clone();
            return null;
          }
          // Collapsed on the root = the invisible boundary slot. Prefer the
          // block just before the boundary (arrowed down past it), else the one
          // after (arrowed up above it).
          const before = anchorNode.getChildAtIndex(
            selection.anchor.offset - 1,
          );
          const after = anchorNode.getChildAtIndex(selection.anchor.offset);
          if (before && canHoldCaret(before)) {
            return { edge: "end", key: before.getKey(), kind: "redirect" };
          }
          if (after && canHoldCaret(after)) {
            return { edge: "start", key: after.getKey(), kind: "redirect" };
          }
          return { kind: "restore" };
        });
        if (!resolved) return;
        editor.update(() => {
          if (resolved.kind === "restore") {
            const saved = lastGood.current;
            if (!saved) return;
            try {
              $setSelection(saved.clone());
            } catch {
              // The saved selection can reference nodes that no longer exist.
            }
            return;
          }
          const node = $getNodeByKey(resolved.key);
          if (!$isElementNode(node)) return;
          if (resolved.edge === "end") node.selectEnd();
          else node.selectStart();
        });
      }),
    [editor],
  );

  return null;
}

/**
 * Element blocks (paragraph/heading/quote/list, and tables via their cells) have
 * a text caret slot; decorator blocks (callout/code/media/embed/post-ref) do
 * not, so the caret can't rest on them.
 */
function canHoldCaret(node: LexicalNode): boolean {
  return $isElementNode(node) && !$isDecoratorNode(node);
}
