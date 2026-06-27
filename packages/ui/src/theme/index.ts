/**
 * Theme helpers for reading, applying, and persisting the active DaisyUI theme.
 *
 * @categoryDefault Theme
 */

/** The DaisyUI theme family name (`idco`), the base for the `idco-light`/`idco-dark` variants. */
export const themeName = "idco";

/** The user's theme choice: follow the OS (`system`) or force `light`/`dark`. */
export type ThemeMode = "system" | "light" | "dark";

const storageKey = "idco-theme";

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Reads the persisted theme choice from local storage, defaulting to `system`. */
export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem(storageKey);
  if (stored === "light" || stored === "dark") return stored;
  return "system";
}

/** Applies a theme to the document and persists it via `data-theme`, a cookie, and local storage. */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  if (mode === "system") {
    document.documentElement.removeAttribute("data-theme");
    document.body.removeAttribute("data-theme");
    document.cookie = `${storageKey}=; path=/; max-age=0; SameSite=Lax`;
  } else {
    const value = mode === "light" ? "idco-light" : "idco-dark";
    document.documentElement.setAttribute("data-theme", value);
    document.body.setAttribute("data-theme", value);
    document.cookie = `${storageKey}=${mode}; path=/; max-age=31536000; SameSite=Lax`;
  }
  localStorage.setItem(storageKey, mode);
}

/** Resolves the concrete theme name currently in effect (`idco-light` or `idco-dark`), accounting for the system preference. */
export function getActiveThemeName(): string {
  if (typeof document === "undefined") return "idco-light";
  const bodyTheme = document.body.getAttribute("data-theme");
  if (bodyTheme === "idco-light" || bodyTheme === "idco-dark") return bodyTheme;
  const docTheme = document.documentElement.getAttribute("data-theme");
  if (docTheme === "idco-light" || docTheme === "idco-dark") return docTheme;
  return systemPrefersDark() ? "idco-dark" : "idco-light";
}
