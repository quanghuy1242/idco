/**
 * URL sanitization for link hrefs (docs/010 §10.5 sanitization boundary).
 *
 * A link href can reach a *navigable* `<a href>` in the resting/reader render
 * from several doors — the toolbar link editor, Payload/compat import, and the
 * HTML paste parser. Every one of those must pass the href through here so a
 * `javascript:`/`data:`/`vbscript:` URL can never become a live, clickable link.
 * Only http(s), mailto, tel, fragment, and same-origin relative URLs survive;
 * anything else sanitizes to an empty string (the link renders inert).
 *
 * This is framework-free core so it is the one shared boundary for both the
 * model edit path (commands/compat) and the view paste path.
 */
const SAFE_HREF = /^(?:https?:|mailto:|tel:|#|\/)/i;

// ASCII control characters (incl. tab/newline) an attacker could splice into a
// scheme to dodge the allowlist, e.g. "java\tscript:".
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/** A safe href, or `""` when the input is unsafe/empty (renders inert). */
export function safeHref(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.replace(CONTROL_CHARS, "").trim();
  return SAFE_HREF.test(value) ? value : "";
}
