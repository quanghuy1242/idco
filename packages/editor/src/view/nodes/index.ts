/**
 * Built-in node-view registrations (docs/020 §4.4).
 *
 * Each built-in object node lives in its own file and exports its `NodeView`;
 * `registerBuiltInNodeViews()` registers them in one place. The order below is the
 * insert-menu order (`listInsertableNodes()` enumerates the registry in
 * registration order), so it must stay: code, media, embed, post-ref, divider,
 * table, table-of-contents. The call is idempotent (the registry replaces by
 * type), so the orchestrator can invoke it on module load without guarding.
 *
 * A custom node calls `registerNode` itself and renders without editing any view
 * internals — that is the whole point of the SPI (docs/016 §10).
 */
import { registerNodeView } from "../node-view";
import { registerStructuralView } from "../structural-view";
import { codeBlockView } from "./code-block";
import { mediaView } from "./media";
import { embedView } from "./embed";
import { postRefView } from "./post-ref";
import { dividerView } from "./divider";
import { editorTableView, tableView } from "./table";
import { tableOfContentsView } from "./table-of-contents";
import { calloutStructuralView } from "./callout";
import { listStructuralView } from "./list";

/**
 * Register every built-in view exactly once. Object views register in insert-menu
 * order (code, media, embed, post-ref, divider, table, table-of-contents); the
 * structural views (callout, list) are the only structural types with non-default
 * rendering — quote, structural list-item, and body use the default container.
 */
export function registerBuiltInNodeViews(): void {
  for (const view of [
    codeBlockView,
    mediaView,
    embedView,
    postRefView,
    dividerView,
    tableView,
    editorTableView,
    tableOfContentsView,
  ]) {
    registerNodeView(view);
  }
  for (const view of [calloutStructuralView, listStructuralView]) {
    registerStructuralView(view);
  }
}
