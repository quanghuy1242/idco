/**
 * Shared narrow-viewport hook for the editor chrome.
 *
 * Two surfaces need the same `max-width: 767px` breakpoint: the ribbon falls back
 * to a horizontal-scroll command row instead of an overflow menu (note.md "Mobile is
 * horizontal scroll"), and the side-panel dock becomes an overlay sheet instead of a
 * side column (docs/027 §8.3). Keeping the matchMedia logic in one hook keeps the two
 * in lockstep and out of the duplicate-code gate. SSR-safe: starts `false` and
 * subscribes on mount, so the first server/initial render is the desktop layout.
 */
import { useEffect, useState } from "react";

const MOBILE_QUERY = "(max-width: 767px)";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.(MOBILE_QUERY);
    if (!query) return;
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isMobile;
}
