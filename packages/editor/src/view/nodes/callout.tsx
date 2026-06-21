/**
 * The built-in `callout` structural node view (docs/020 §7.1).
 *
 * A callout is a tinted box (the `[data-engine-callout-tone]` CSS) holding block
 * children, with floating block chrome (badge + tone + delete) and the tone glyph
 * in the left gutter. Live and resting renders are co-located here so they cannot
 * drift (docs/020 §3.7): the editor surface uses divs + chrome; the published page
 * uses the real DaisyUI `alert`.
 */
import { AlertGlyph, alertToneClass } from "@quanghuy1242/idco-ui";
import { type StructuralNodeView } from "../structural-view";
import { CalloutChrome } from "../callout-chrome";
import { calloutTone } from "../resting-document";
import { structuralContainerStyle } from "../styles";

export const calloutStructuralView: StructuralNodeView = {
  // The insert menu inserts a callout through the generic structural command (note
  // §7); its initial subtree (a scope holding one empty paragraph, not an atom)
  // comes from the `callout` StructuralDefinition's `createSubtree`.
  insert: {
    createCommand: () => ({
      structuralType: "callout",
      type: "insert-structural",
    }),
    group: "Blocks",
    icon: "Info",
    keywords: ["callout", "note", "aside", "admonition"],
    label: "Callout",
  },
  // Live: floating chrome is a sibling overlay in a `group/block relative` wrapper
  // (never inside the measured container box), mirroring the object blocks' chrome.
  // The tone glyph matches the resting `AlertGlyph` so the two surfaces read alike.
  renderContainer: ({ node, store, registerBlock, children }) => {
    const tone = calloutTone(node.attrs?.tone);
    return (
      <div className="group/block relative">
        <CalloutChrome node={node} store={store} />
        <div
          data-engine-block-id={node.id}
          data-engine-callout-tone={tone}
          data-engine-structural="callout"
          ref={(element) => registerBlock(node.id, element)}
          style={structuralContainerStyle}
        >
          <span aria-hidden="true" data-engine-callout-glyph="">
            <AlertGlyph tone={tone} />
          </span>
          {children}
        </div>
      </div>
    );
  },
  // Resting: the published callout is the real DaisyUI alert (the legacy look), a
  // container that stacks its block children so the page matches the editor surface
  // and the theme (docs/018 §2.8, docs/019).
  renderResting: ({ node, children, renderSequence }) => {
    const tone = calloutTone(node.attrs?.tone);
    return (
      <aside
        className={`alert ${alertToneClass[tone]} items-start`}
        data-engine-callout-tone={tone}
        data-engine-resting-block={node.id}
        key={node.id}
        role="note"
      >
        <AlertGlyph tone={tone} />
        <div className="w-full">{renderSequence(children)}</div>
      </aside>
    );
  },
  type: "callout",
};
