/**
 * Inline SVG icons for L1 (docs/015 §4.2). RSC-safe and self-contained: L1 must not
 * import `@idco/ui`'s `NavIcon`/`AlertGlyph` (that would cross the client boundary), so
 * the few glyphs the read primitives need are inlined here. The callout glyph paths are
 * the same ones the `Alert` component uses, so the callout reads identically.
 */
import type { ReactNode } from "react";
import type { RichTextCalloutTone } from "./types";

const CALLOUT_ICON_PATH: Record<RichTextCalloutTone, string> = {
  error: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z",
  success: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  warning:
    "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z",
  info: "M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z",
};

/** The callout tone glyph (matches `@idco/ui` `AlertGlyph`). */
export function CalloutGlyph({
  tone,
}: {
  readonly tone: RichTextCalloutTone;
}): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className="h-6 w-6 shrink-0 stroke-current"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d={CALLOUT_ICON_PATH[tone]}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

/** The heading anchor-link glyph (lucide `Link2`). */
export function LinkGlyph(): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className="inline h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <line x1="8" x2="16" y1="12" y2="12" />
    </svg>
  );
}

/** The table-of-contents heading glyph (lucide `ScrollText`). */
export function ScrollTextGlyph(): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className="inline h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M15 12h-5" />
      <path d="M15 8h-5" />
      <path d="M19 17V5a2 2 0 0 0-2-2H4" />
      <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
    </svg>
  );
}
