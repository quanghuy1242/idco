import type { Story, StoryDefault } from "@ladle/react";
import { useMemo, useState } from "react";
import {
  OwnedModelEditor,
  RestingDocument,
  createEditorStoreFromCompat,
  importPayloadLexical,
  type EditorStore,
  type UploadImage,
} from "../packages/editor/src";

export default {
  title: "Engine / Phase 8",
} satisfies StoryDefault;

/**
 * A Payload-Lexical sample document (docs/017 §3.4): paragraphs with an inline
 * link, a heading, a youtube embed, an upload (image), a horizontal rule, a list,
 * and a Payload Block that the adapter drops-with-report (AC7).
 */
const PAYLOAD_SAMPLE = {
  root: {
    children: [
      {
        children: [{ tag: "h1", text: "The Live Book", type: "text" }],
        tag: "h1",
        type: "heading",
      },
      {
        children: [
          { text: "An owned-model editor with ", type: "text" },
          { format: 1, text: "bold", type: "text" },
          { text: ", ", type: "text" },
          { format: 2, text: "italic", type: "text" },
          { text: ", and a ", type: "text" },
          {
            children: [{ text: "real link", type: "text" }],
            type: "link",
            url: "https://idco.dev",
          },
          { text: ".", type: "text" },
        ],
        type: "paragraph",
      },
      { fields: { videoID: "dQw4w9WgXcQ" }, type: "youtube" },
      { type: "upload", value: { alt: "A diagram", url: "/diagram.png" } },
      { type: "horizontalrule" },
      {
        children: [
          {
            children: [{ text: "Marks render to the DOM", type: "text" }],
            type: "listitem",
          },
          {
            children: [{ text: "Toolbar drives the model", type: "text" }],
            type: "listitem",
          },
          {
            children: [
              { text: "Find works under virtualization", type: "text" },
            ],
            type: "listitem",
          },
        ],
        type: "list",
      },
      { blockType: "callToAction", fields: {}, type: "block" },
    ],
  },
};

function usePhase8Store(): { store: EditorStore; report: string } {
  return useMemo(() => {
    const { document, report } = importPayloadLexical(PAYLOAD_SAMPLE);
    const store = createEditorStoreFromCompat(document);
    return {
      report: `mapped ${JSON.stringify(report.mapped)} · dropped ${JSON.stringify(report.dropped)}`,
      store,
    };
  }, []);
}

// A fake host upload binding: resolves a data URL after a short delay (AC10).
const fakeUpload: UploadImage = async (file) => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  return { alt: file.name, src: `/uploads/${file.name}` };
};

/** The full opt-in editing surface: toolbar, find, marks, objects, autosave. */
export const FullEditor: Story = () => {
  const { store, report } = usePhase8Store();
  const [saved, setSaved] = useState("clean");
  return (
    <div style={{ maxWidth: 900 }}>
      <p style={{ font: "12px ui-monospace, monospace", opacity: 0.7 }}>
        Imported from Payload-Lexical · {report} · autosave: {saved}
      </p>
      <OwnedModelEditor
        autosave={{
          delayMs: 600,
          onSave: async () => {
            setSaved("saving…");
            await new Promise((resolve) => setTimeout(resolve, 250));
            setSaved(`saved ${new Date().toLocaleTimeString()}`);
          },
        }}
        store={store}
        uploadImage={fakeUpload}
        virtualize={false}
      />
      <p style={{ font: "12px ui-sans-serif", marginTop: 12, opacity: 0.7 }}>
        Try: select text and use the toolbar (icons), type <code># </code> or{" "}
        <code>- </code> at a line start, press <kbd>Ctrl/Cmd+F</kbd> to find,
        click the image to edit/upload, use Insert to add a divider/image.
      </p>
    </div>
  );
};

/** The themed resting render — the same baked projection the reader ships. */
export const RestingRead: Story = () => {
  const { store } = usePhase8Store();
  return (
    <div style={{ maxWidth: 760 }}>
      <RestingDocument snapshot={store.toSnapshot()} />
    </div>
  );
};
