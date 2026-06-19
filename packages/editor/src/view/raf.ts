/**
 * requestAnimationFrame helpers with a setTimeout fallback (docs/017 §3.1).
 *
 * Shared by the editor shell and the text block so a frame-scheduled reveal or
 * focus works in jsdom (where rAF is absent) as well as the browser.
 */

export function requestFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(callback);
  }
  return setTimeout(callback, 16) as unknown as number;
}

export function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
  clearTimeout(handle);
}
