/**
 * Ambient type for `markdown-it-mark` (the `==highlight==` plugin), which ships no types.
 * It is a plain markdown-it plugin (a function taking the `MarkdownIt` instance).
 */
declare module "markdown-it-mark" {
  import type MarkdownIt from "markdown-it";
  const plugin: (md: MarkdownIt) => void;
  export default plugin;
}
