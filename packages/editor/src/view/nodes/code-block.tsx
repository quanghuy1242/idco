/**
 * The built-in `code-block` node view (docs/016 §10, docs/020 §7.2).
 *
 * Code edits in place: the live `CodeEditor` replaces the baked render at the same
 * box (`liveMode: "in-place"`), so activation does not shift layout (AC3). The
 * resting render mounts the *same* `CodeEditor` read-only, so highlighting matches
 * and the box cannot drift. The language selector is this node's custom chrome
 * control (`renderChromeControl`); deactivation-on-blur is owned by the dispatcher.
 */
import { useLayoutEffect, useRef, useState } from "react";
import {
  ChromeSelect,
  type ChromeSelectOption,
  CodeEditor,
  type CodeEditorLanguage,
} from "@quanghuy1242/idco-ui";
import { type EditorStore, type NodeId, type ObjectNode } from "../../core";
import { type NodeView } from "../spi";
import { asRecord, currentObjectRecord, stringField } from "../object-data";

/** A stable no-op for the read-only code surface's required `onChange`. */
const noop = () => {};

/** Code languages the highlighter supports, with their display labels. */
const CODE_LANGUAGES: readonly ChromeSelectOption<CodeEditorLanguage>[] = [
  { label: "TypeScript", value: "ts" },
  { label: "JavaScript", value: "js" },
  { label: "JSON", value: "json" },
  { label: "Python", value: "python" },
  { label: "TSX", value: "tsx" },
  { label: "Plain text", value: "text" },
];

const CODE_LANGUAGE_VALUES = new Set<string>(
  CODE_LANGUAGES.map((l) => l.value),
);

/** Coerce a stored language string to one the highlighter knows (else plain). */
function toCodeLanguage(value: string): CodeEditorLanguage {
  return CODE_LANGUAGE_VALUES.has(value)
    ? (value as CodeEditorLanguage)
    : "text";
}

/** The code text for the editor surface, read from the baked snapshot. */
function bakedCodeText(node: ObjectNode): string {
  if (node.baked?.kind === "code") {
    return stringField(asRecord(node.baked.payload), "code");
  }
  return "";
}

/**
 * In-place code editing surface (docs/018 §2.8). The live edit reuses `@idco/ui`'s
 * `CodeEditor` (transparent textarea over a Prism-highlighted `<pre>`), and the
 * resting render mounts the *same* component read-only, so highlighting matches
 * and the box does not drift on activation (AC3, the no-shift contract). The
 * language selector and delete live in the shared block chrome; deactivation-on-
 * blur is owned by the block container so chrome clicks do not drop the surface.
 * Commits re-bake the block through the store.
 */
function CodeLiveSurface(props: {
  readonly node: ObjectNode;
  readonly store: EditorStore;
  readonly registerObjectEditor: (id: NodeId, mounted: boolean) => void;
}) {
  const { node, store, registerObjectEditor } = props;
  const id = node.id;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // Code text is local (the textarea owns the caret while live), so it is seeded
  // once and never re-seeded on a commit. The language is derived from the live
  // node, so the chrome's language selector updates the highlighting immediately.
  const [code, setCode] = useState(() => bakedCodeText(node));
  const language = toCodeLanguage(stringField(asRecord(node.data), "language"));

  // Bridge to the reused CodeEditor: it does not expose its inner <textarea>
  // (no ref/data-attr/focus props), so the owned-editor live-slot contract — the
  // focusable, fillable `data-engine-object-editor="code"` element (e2e AC1/AC4/
  // AC5) plus autofocus on activation — is wired onto that one textarea here.
  // CodeEditor renders exactly one; React leaves the foreign attribute in place
  // across re-renders since it never set it.
  useLayoutEffect(() => {
    registerObjectEditor(id, true);
    const textarea = wrapperRef.current?.querySelector("textarea");
    if (textarea) {
      textarea.setAttribute("data-engine-object-editor", "code");
      textarea.focus();
    }
    return () => registerObjectEditor(id, false);
  }, [id, registerObjectEditor]);

  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          store.deactivateObject(id);
        }
        // Keep keystrokes inside the object; the document key handler is for text.
        event.stopPropagation();
      }}
      ref={wrapperRef}
    >
      <CodeEditor
        language={language}
        onChange={(value) => {
          setCode(value);
          const record = currentObjectRecord(store, id);
          store.command({
            data: { ...record, code: value, language },
            node: id,
            type: "set-object-data",
          });
        }}
        value={code}
      />
    </div>
  );
}

export const codeBlockView: NodeView = {
  // A freshly inserted code block drills straight into its editor (slash/insert
  // palette or the markdown ` ``` ` affordance) so the caret is ready to type
  // rather than leaving a node-selection to click into (docs/030 §4.1). The
  // textarea focus itself happens in `CodeLiveSurface`'s mount effect.
  activateOnInsert: true,
  ariaLabel: "Code block",
  chromeMeta: { icon: "Code", label: "Code" },
  // The Insert (+) menu can drop a fresh code block; it activates for editing on
  // click, where the floating language selector picks the highlight grammar.
  insert: {
    createData: () => ({ code: "", language: "ts" }),
    group: "Blocks",
    icon: "Code",
    keywords: ["code", "snippet", "```"],
    label: "Code block",
  },
  // Code edits in place (the CodeEditor replaces the baked render at the same
  // box), so activation does not shift layout (AC3); everything else uses the
  // popover.
  liveMode: "in-place",
  // The language selector is the code block's inline chrome control, replacing the
  // default settings gear (docs/020 §5.4).
  renderChromeControl: ({ node, store, menuOpenRef, focusInPlace }) => {
    const language = toCodeLanguage(
      stringField(asRecord(node.data), "language"),
    );
    return (
      <ChromeSelect
        label="Code language"
        menuClassName="w-40"
        onChange={(value) => {
          const record = currentObjectRecord(store, node.id);
          store.command({
            data: { ...record, language: value },
            node: node.id,
            type: "set-object-data",
          });
        }}
        onOpenChange={(open) => {
          menuOpenRef.current = open;
          if (!open) requestAnimationFrame(focusInPlace);
        }}
        options={CODE_LANGUAGES}
        value={language}
      />
    );
  },
  renderLive: (args) => (
    <CodeLiveSurface
      node={args.node}
      registerObjectEditor={args.registerObjectEditor}
      store={args.store}
    />
  ),
  // The resting render is the *same* CodeEditor read-only: Prism-highlighted code
  // (no longer a bare unhighlighted <pre>, docs/018 §2.8) and, because it is the
  // identical component the live surface uses, the box cannot drift on activation
  // (AC3). The read-only textarea carries no `data-engine-object-editor`, so AC1's
  // "no editor instance at rest" selector count stays zero. Highlighting runs in
  // the view layer (not core, G3/G4); routing it through a worker baker and the
  // shared reader primitive is the §2.8 follow-up when packages/reader lands.
  renderResting: ({ baked }) => {
    const payload = asRecord(baked.payload);
    return (
      <div data-engine-object-baked="code">
        <CodeEditor
          language={toCodeLanguage(stringField(payload, "language"))}
          onChange={noop}
          readOnly
          value={stringField(payload, "code")}
        />
      </div>
    );
  },
  schemaGroup: "code",
  type: "code-block",
};
