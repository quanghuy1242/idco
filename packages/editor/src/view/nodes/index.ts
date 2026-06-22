/**
 * Built-in node-view registrations (docs/020 §4.4).
 *
 * Each built-in object node lives in its own file and exports its `NodeView`;
 * `registerBuiltInNodeViews()` registers them in one place. The object order below
 * is the object insert-menu order (`listInsertableNodes()` enumerates the registry
 * in registration order): code, media, embed, post-ref, divider, table-of-contents.
 * The table family is structural (docs/022), registered as structural views. The
 * call is idempotent (the registry replaces by type), so the orchestrator can
 * invoke it on module load without guarding.
 *
 * A custom node calls `registerNode` itself and renders without editing any view
 * internals — that is the whole point of the SPI (docs/016 §10).
 */
import { registerNodeView } from "../spi";
import { registerStructuralView } from "../spi";
import { codeBlockView } from "./code-block";
import { mediaView } from "./media";
import { embedView } from "./embed";
import { postRefView } from "./post-ref";
import { dividerView } from "./divider";
import {
  editorTableStructuralView,
  tableCellStructuralView,
  tableRowStructuralView,
  tableStructuralView,
} from "./table";
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
    tableOfContentsView,
  ]) {
    registerNodeView(view);
  }
  // Structural views: callout, list, and the table family (docs/022 §4.4). The
  // table is structural now, so its insert affordance comes through the structural
  // insert menu (`listInsertableStructuralNodes`), not the object insert.
  for (const view of [
    calloutStructuralView,
    listStructuralView,
    tableStructuralView,
    editorTableStructuralView,
    tableRowStructuralView,
    tableCellStructuralView,
  ]) {
    registerStructuralView(view);
  }
}
