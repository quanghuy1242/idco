import type { Story, StoryDefault } from "@ladle/react";
import { useEffect, useMemo, useState } from "react";
import { CodeEditor, ConfirmDialog } from "@idco/ui";
import {
  OwnedModelEditor,
  RestingDocument,
  createEditorStoreFromCompat,
  importPayloadLexical,
  registerCommand,
  unregisterCommand,
  type EditorStore,
  type UploadImage,
} from "../packages/editor/src";

export default {
  title: "Engine / Phase 8",
} satisfies StoryDefault;

/**
 * A Payload-Lexical sample document (docs/017 §3.4): paragraphs with an inline
 * link, a heading, a complex live table (merged cells, header row+column, cell
 * background, vertical-align, numbered gutter — docs/022), an upload (image), a
 * horizontal rule, a list, and a Payload Block that the adapter drops-with-report.
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
      // A deliberately complex table to exercise the live-table feature (docs/022):
      // a header row AND header column, a vertical row-span merge, a horizontal
      // col-span merge, per-cell background + vertical-align, a numbered gutter, and
      // responsive layout. Right-click a cell for the menu; drag across cells to
      // select a range, then merge; hover the edges to insert/delete; drag a column
      // boundary to resize. Spanned rows are intentionally short (covered cells have
      // no node), the way the legacy Lexical table serializes.
      {
        children: [
          {
            children: [
              {
                children: [{ text: "Quarter", type: "text" }],
                headerState: 3,
                type: "tablecell",
              },
              {
                children: [{ text: "Product", type: "text" }],
                headerState: 1,
                type: "tablecell",
              },
              {
                children: [{ text: "Revenue", type: "text" }],
                headerState: 1,
                type: "tablecell",
              },
              {
                children: [{ text: "Status", type: "text" }],
                headerState: 1,
                type: "tablecell",
              },
            ],
            type: "tablerow",
          },
          {
            children: [
              {
                children: [{ text: "Q1", type: "text" }],
                headerState: 2,
                type: "tablecell",
              },
              {
                children: [{ text: "Widgets", type: "text" }],
                type: "tablecell",
              },
              {
                children: [{ text: "$12,400", type: "text" }],
                type: "tablecell",
              },
              {
                backgroundColor: "#14532d",
                children: [{ text: "On track ✓", type: "text" }],
                rowSpan: 2,
                type: "tablecell",
                verticalAlign: "middle",
              },
            ],
            type: "tablerow",
          },
          {
            // The Status column here is covered by the row-span above → 3 cells.
            children: [
              {
                children: [{ text: "Q2", type: "text" }],
                headerState: 2,
                type: "tablecell",
              },
              {
                children: [{ text: "Gadgets", type: "text" }],
                type: "tablecell",
              },
              {
                children: [{ text: "$18,900", type: "text" }],
                type: "tablecell",
              },
            ],
            type: "tablerow",
          },
          {
            // A col-span merge over Product+Revenue → 3 cells.
            children: [
              {
                children: [{ text: "Q3", type: "text" }],
                headerState: 2,
                type: "tablecell",
              },
              {
                backgroundColor: "#7c2d12",
                children: [
                  {
                    text: "Combined launch — Widgets + Gadgets bundle",
                    type: "text",
                  },
                ],
                colSpan: 2,
                type: "tablecell",
                verticalAlign: "middle",
              },
              {
                children: [{ text: "Planning", type: "text" }],
                type: "tablecell",
              },
            ],
            type: "tablerow",
          },
        ],
        colWidths: [150, 220, 150, 180],
        layout: "responsive",
        showRowNumbers: true,
        type: "table",
      },
      {
        type: "upload",
        value: {
          alt: "A scenic landscape",
          url: "https://payload-cdn.quanghuy.dev/zelda-botw-optimized.webp",
        },
      },
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
  const [jsonOpen, setJsonOpen] = useState(false);
  const [json, setJson] = useState("");
  // Add a "Save" button next to undo/redo through the command SPI (docs/023/024):
  // a `button` command in the persistent `global.history` slot. The `useState`
  // initializer registers it during this story's first render — before the child
  // editor's ribbon renders — so it is present on first paint (the same pattern the
  // Tools-tab demo uses). It lands after undo/redo simply by registering after them
  // (in-slot order is registration order — no order number to pick). Its `run` opens
  // a read-only dialog with the editor's current JSON snapshot, read from `ctx.store`.
  useState(() => {
    registerCommand({
      group: "history",
      icon: "Save",
      id: "story.save",
      kind: "button",
      label: "Save",
      run: (ctx) => {
        setJson(JSON.stringify(ctx.store.toSnapshot(), null, 2));
        setJsonOpen(true);
      },
      slot: "global.history",
      surfaces: { ribbon: "primary" },
    });
    return null;
  });
  // Drop the command on unmount so it does not leak into the other editor stories.
  useEffect(() => () => unregisterCommand("story.save"), []);
  return (
    <div style={{ maxWidth: 900 }}>
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
      <ConfirmDialog
        confirmLabel="Close"
        onConfirm={() => {}}
        onOpenChange={setJsonOpen}
        open={jsonOpen}
        size="xl"
        title="Document JSON (read-only)"
      >
        <CodeEditor
          label="store.toSnapshot()"
          language="json"
          maxHeight="lg"
          onChange={() => {}}
          readOnly
          value={json}
        />
      </ConfirmDialog>
      <p style={{ font: "12px ui-sans-serif", marginTop: 12, opacity: 0.7 }}>
        Try the table: hover it, then use the chrome's cell button (paint
        bucket) to merge a dragged cell range, fill a cell color, or set
        vertical align; hover an edge to insert/delete a row/column; drag a
        column boundary to resize; the gear toggles header row/column. Also:
        toolbar marks, <code># </code>/<code>- </code> shortcuts,{" "}
        <kbd>Ctrl/Cmd+F</kbd> to find, click the image to edit/upload.
      </p>
      <p
        style={{
          font: "12px ui-monospace, monospace",
          marginTop: 8,
          opacity: 0.7,
        }}
      >
        Imported from Payload-Lexical · {report} · autosave: {saved}
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
