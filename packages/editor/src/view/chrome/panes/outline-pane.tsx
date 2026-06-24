/**
 * The Outline dock pane (docs/027 §8.2/§8.4 — the outline "reunion").
 *
 * When the side/aside TOC rail was removed (the shell is the host's concern,
 * docs/027 §3.6), the outline lost its in-editor home. The dock gives it one as
 * edit-mode chrome: Outline is just another registered `SidePanel`, so it returns to
 * the editor without becoming a host-layout dependency again (docs/027 §8.4).
 *
 * Like the `table-of-contents` node view, this is a pure *consumer* of the
 * whole-document index through the read-side SPI (`useDocumentIndex`), which the bake
 * worker computes off-thread and the dock feeds in through its `DocumentIndexProvider`
 * (docs/027 §2.2 — derive, do not store). It does not walk the document; it renders
 * `index.toc` and navigates by NodeId through `reveal` (the engine's `scrollToBlock`),
 * which reaches a windowed-out heading a plain `#hash` cannot under virtualization.
 *
 * It deliberately stays simpler than the TOC node: no numbering, no level window, no
 * settings — a flat list indented by heading level, the always-on overview. The TOC
 * node remains the in-document, configurable contents block; this is the chrome
 * overview.
 */
import { NavIcon } from "@quanghuy1242/idco-ui";
import type { NodeId } from "../../../core";
import { useDocumentIndex } from "../../document-index";

export function OutlinePane(props: { readonly reveal: (id: NodeId) => void }) {
  const { reveal } = props;
  const index = useDocumentIndex();
  const toc = index?.toc ?? [];

  if (toc.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-base-content/60">
        <NavIcon name="ScrollText" />
        <span>
          No headings yet. Add a heading and it appears here as you type.
        </span>
      </div>
    );
  }

  // Indent relative to the shallowest heading present, so a document whose top level
  // is H2 does not start one indent deep. Recomputed each render from the live index;
  // the list is tiny, so there is no memo to maintain.
  const minLevel = toc.reduce((min, entry) => Math.min(min, entry.level), 6);

  return (
    <nav aria-label="Document outline" className="p-2">
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {toc.map((entry) => (
          <li
            key={entry.id}
            style={{
              paddingInlineStart: `${(entry.level - minLevel) * 0.85}rem`,
            }}
          >
            <button
              className="w-full truncate rounded px-2 py-1 text-left text-sm text-base-content/80 outline-none hover:bg-base-200 hover:text-base-content focus-visible:bg-base-200"
              onClick={() => reveal(entry.id)}
              type="button"
            >
              {entry.text.trim() || "Untitled section"}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
