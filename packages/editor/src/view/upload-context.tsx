/**
 * Image/file upload binding seam (docs/010 Phase 8 AC10, §10.5; docs/016 §9).
 *
 * Upload transport is a *host* concern, not a node concern: the engine does not
 * own how a file becomes a URL. The host injects an `uploadImage` binding through
 * this context; the image node's live surface and the editor's drop handler call
 * it and receive a resolved `src`. When no binding is provided, upload
 * affordances are inert (documented, not a crash) — the editor still works with
 * pasted/typed URLs.
 */
import { createContext, useContext } from "react";

/** Resolve a dropped/selected file to a media source. Host-provided. */
export type UploadImage = (
  file: File,
) => Promise<{ readonly src: string; readonly alt?: string }>;

const UploadContext = createContext<UploadImage | null>(null);

export const UploadProvider = UploadContext.Provider;

/** The host upload binding, or null when the host did not provide one. */
export function useUpload(): UploadImage | null {
  return useContext(UploadContext);
}
