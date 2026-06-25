/**
 * The object-editor registry seam (docs/029 R1-G).
 *
 * A live object-editor surface (a code block, the object-config form) registers when it mounts
 * and unregisters on unmount so diagnostics can assert the one-live-at-a-time cap (AC2). The
 * registration callback lives in `react-view` (it writes the view's `objectEditors` set). When
 * the object-config form moved onto the overlay authority it began rendering inside the portal
 * layer — outside the block tree — so it can no longer receive that callback as a prop. This
 * context carries it across the portal (React context propagates through `createPortal`), so
 * the authority-rendered config registers exactly like an in-tree live surface does.
 */
import { createContext, useContext } from "react";
import type { NodeId } from "../../core";

/** Register (mounted=true) / unregister (mounted=false) a live object editor by node id. */
export type RegisterObjectEditor = (id: NodeId, mounted: boolean) => void;

const noop: RegisterObjectEditor = () => {};

const ObjectEditorRegistryContext = createContext<RegisterObjectEditor>(noop);

/** Provide the object-editor registration callback to the editing subtree (incl. portals). */
export const ObjectEditorRegistryProvider =
  ObjectEditorRegistryContext.Provider;

/** Read the object-editor registration callback (a no-op outside a providing view). */
export function useObjectEditorRegistry(): RegisterObjectEditor {
  return useContext(ObjectEditorRegistryContext);
}
