/**
 * Join class-name fragments, dropping falsy ones. The monorepo's standard
 * replacement for the repeated `[a, b, c].filter(Boolean).join(" ")` idiom.
 * Intentionally minimal — no Tailwind conflict resolution; callers order their
 * own classes.
 */
export function cn(
  ...parts: readonly (string | false | null | undefined)[]
): string {
  return parts.filter(Boolean).join(" ");
}
