import type { Story, StoryDefault } from "@ladle/react";
import { useEffect, useMemo, useState } from "react";
import { GridList, GridListItem, Text } from "react-aria-components";
import {
  Button,
  CodeEditor,
  ConfirmDialog,
  FileDropzone,
  Input,
  type ResourceOption,
} from "@idco/ui";
import {
  OwnedModelEditor,
  RestingDocument,
  createEditorStoreFromCompat,
  importPayloadLexical,
  registerCommand,
  registerCommentSource,
  registerDataSource,
  unregisterCommand,
  unregisterCommentSource,
  unregisterDataSource,
  type DataSourcePickerProps,
  type EditorStore,
  type RichTextCompatNode,
  type UploadImage,
} from "../packages/editor/src";
import { createInMemoryCommentSource } from "./_fake-comment-source";

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

// ============================================================================
// Host data sources for the reference-blocks demo (docs/026 §6.1, §8.2).
//
// A deployment registers one `DataSource` per host collection; the `media` and
// `post-ref` built-ins project them through their `resource` config field. These
// fakes stand in for a real backend: an in-memory media library and a posts
// collection, both served through the cursor-`paginated` `load` mode so the
// picker's `ListBoxLoadMoreItem` sentinel is exercised and a large collection
// never ships whole. `resolve` is the stale-while-revalidate refresh (§7.2);
// `media` also supplies `upload` (create-then-reference, §7.1).
// ============================================================================

// The five real screenshots, shaped as the `media` source's `ResourceOption`s.
// The `media` node's `toData` projects `image` → snapshot `src` and `label` →
// snapshot `alt` (the caption is author-local, typed in the gear, never from the
// option). All but the first are Nintendo titles; SteamWorld Dig 2 is the odd one
// out (Thunderful / Image & Form).
const MEDIA_ASSETS: readonly ResourceOption[] = [
  {
    id: "g-steamworld",
    label: "SteamWorld Dig 2",
    sublabel: "Thunderful · 2017",
    image: "https://payload-cdn.quanghuy.dev/SteamWorldDig2-optimized.webp",
  },
  {
    id: "g-zelda",
    label: "The Legend of Zelda: Breath of the Wild",
    sublabel: "Nintendo · 2017",
    image: "https://payload-cdn.quanghuy.dev/zelda-botw-optimized.webp",
  },
  {
    id: "g-mkw",
    label: "Mario Kart World",
    sublabel: "Nintendo · Switch 2 launch · 2025",
    image: "https://payload-cdn.quanghuy.dev/mkw-optimized.webp",
  },
  {
    id: "g-smo",
    label: "Super Mario Odyssey",
    sublabel: "Nintendo · 2017",
    image: "https://payload-cdn.quanghuy.dev/smo-2-optimized.webp",
  },
  {
    id: "g-dkc",
    label: "Donkey Kong Country: Tropical Freeze",
    sublabel: "Nintendo · 2014/2018",
    image: "https://payload-cdn.quanghuy.dev/dkctp%20(1).jpg",
  },
];

// A slice of the real `posts` collection (titles + slugs from payloadcms.db),
// shaped as the `post-ref` source's `ResourceOption`s. The `post-ref` node's
// `toData` projects `id` → `postId`, `label` → `title`, `sublabel` → `url`.
const POSTS: readonly ResourceOption[] = [
  {
    id: "6",
    label: "My gaming in 2023: A delightful year",
    sublabel: "/posts/my-gaming-in-2023-a-delightful-year-6f0f009c038b",
  },
  {
    id: "7",
    label: "Game in review 2024: The Maturity of My Gaming Experience",
    sublabel:
      "/posts/game-in-review-2024-the-maturity-of-my-gaming-experience-7f33869eef0f",
  },
  {
    id: "9",
    label: "Next generation of *.quanghuy.dev #1 — PayloadCMS migration",
    sublabel: "/posts/next-generation-of-quanghuydev-6dd8f53854a6",
  },
  {
    id: "10",
    label: "Next generation of *.quanghuy.dev #2 — Building PayloadCMS",
    sublabel:
      "/posts/next-generation-of-quanghuydev-2-authentication-system-fa1ae2dd181f",
  },
  {
    id: "12",
    label: "Python performance trap",
    sublabel: "/posts/python-performance-trap-eedc09120fc4",
  },
  {
    id: "5",
    label: "Sign 0 — Chouchou",
    sublabel: "/posts/sign-0-f5aa3d67e8d5",
  },
  {
    id: "1",
    label: "Một mớ giấy cũ",
    sublabel: "/posts/mot-mo-giay-cu-cda4c38a40d3",
  },
  {
    id: "2",
    label: "Kí túc xá vào một ngày lễ",
    sublabel: "/posts/ki-tuc-xa-vao-mot-ngay-le-d3beb76424b5",
  },
];

// A simulated cursor-paginated endpoint over an in-memory list: filters by query,
// returns one page, and hands back the next offset as an opaque cursor until the
// result set is exhausted (the same contract `editors-builders` uses). A small
// `pageSize` is deliberate so the picker's load-more sentinel fires after the
// first page on a short list.
function paginate(
  all: readonly ResourceOption[],
  pageSize: number,
): (params: {
  readonly query: string;
  readonly cursor?: string;
}) => Promise<{ items: ResourceOption[]; cursor?: string }> {
  return async ({ query, cursor }) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    const q = query.trim().toLowerCase();
    const matches = q
      ? all.filter(
          (o) =>
            o.label.toLowerCase().includes(q) ||
            (o.sublabel ?? "").toLowerCase().includes(q),
        )
      : all;
    const start = cursor ? Number(cursor) : 0;
    const items = matches.slice(start, start + pageSize);
    const next = start + pageSize;
    return { items, cursor: next < matches.length ? String(next) : undefined };
  };
}

// Resolve one record by ref (stale-while-revalidate, §7.2): the engine calls this
// on mount to refresh a block's snapshot. Returns the live option or `null` when
// the ref dangles (deleted host-side) — the block then keeps its stale snapshot
// and shows the quiet "couldn't refresh" affordance (§7.3).
function resolveById(
  all: readonly ResourceOption[],
): (ref: string) => Promise<ResourceOption | null> {
  return async (ref) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return all.find((o) => o.id === ref) ?? null;
  };
}

// Build the reference-blocks sample store: prose plus a pre-resolved `media` block
// and a pre-resolved `post-ref` block, so both reference kinds render their
// persisted snapshot immediately (the reader-static path, §7.4) and then revalidate
// against the sources on mount. `upload` nodes import to `media` (docs/017 §3.4);
// `post-ref` has no Payload dialect type, so it is injected straight into the
// compat children — `createEditorStoreFromCompat` ingests an owned `post-ref`
// object node the same way it ingests `media`.
function useReferenceStore(): EditorStore {
  return useMemo(() => {
    const REF_SAMPLE = {
      root: {
        children: [
          {
            children: [{ text: "Games I played", type: "text" }],
            tag: "h1",
            type: "heading",
          },
          {
            children: [
              {
                text: "Every screenshot below is a host-backed reference block — the image and the linked post are picked from a data source, not typed. Open the gear on a block to replace it; type ",
                type: "text",
              },
              { text: "/", format: 16, type: "text" },
              {
                text: " in an empty line to insert a fresh Image or Linked post and pick from the library.",
                type: "text",
              },
            ],
            type: "paragraph",
          },
          {
            type: "upload",
            value: {
              alt: "The Legend of Zelda: Breath of the Wild",
              caption:
                "Breath of the Wild — gliding over Hyrule at golden hour.",
              id: "g-zelda",
              url: "https://payload-cdn.quanghuy.dev/zelda-botw-optimized.webp",
            },
          },
          {
            children: [
              {
                text: "I wrote up the whole year — Zelda kicked it off:",
                type: "text",
              },
            ],
            type: "paragraph",
          },
          {
            type: "upload",
            value: {
              alt: "Mario Kart World",
              caption:
                "Mario Kart World — 24-racer open-world chaos, the Switch 2 launch title.",
              id: "g-mkw",
              url: "https://payload-cdn.quanghuy.dev/mkw-optimized.webp",
            },
          },
        ],
      },
    };
    const { document } = importPayloadLexical(REF_SAMPLE);
    // Inject a resolved post-ref between the two images. The snapshot is the
    // projection the post-ref baker reads (`{ postId, title, url }`, §7.4); the
    // source's `resolve` refreshes it on mount.
    const postRef: RichTextCompatNode = {
      ref: "6",
      snapshot: {
        postId: "6",
        title: "My gaming in 2023: A delightful year",
        url: "/posts/my-gaming-in-2023-a-delightful-year-6f0f009c038b",
      },
      type: "post-ref",
    } as RichTextCompatNode;
    document.root.children = [
      ...document.root.children.slice(0, 4),
      postRef,
      ...document.root.children.slice(4),
    ];
    return createEditorStoreFromCompat(document);
  }, []);
}

/**
 * The full editor wired with host data sources (docs/026): a `media` library
 * (browse + resolve + upload) and a `posts` collection (browse + resolve), both
 * cursor-paginated. Insert an Image or Linked post via the slash menu — choose-first
 * opens the picker and rolls the block back if you dismiss it (§7.1) — or open the
 * gear on an existing block to replace its record. The two pre-placed blocks render
 * their persisted snapshot first, then revalidate against the sources.
 */
export const ReferenceBlocks: Story = () => {
  const store = useReferenceStore();
  // Register the sources during this story's first render — before the child editor
  // mounts and its blocks resolve / its insert menu gates on provenance (§9). Both
  // are torn down on unmount so they do not leak into the other editor stories (the
  // registry is a module singleton); in particular the FullEditor `uploadImage` shim
  // only registers its `media` source when none exists (§14.12), so leaving this
  // `media` source registered would suppress it.
  useState(() => {
    registerDataSource({
      id: "media",
      load: { mode: "paginated", load: paginate(MEDIA_ASSETS, 2) },
      resolve: resolveById(MEDIA_ASSETS),
      // Upload-as-create (§7.1): fabricate a new asset from the dropped/selected
      // file (an object URL stands in for a real upload transport) and reference it.
      upload: async (file) => ({
        id: `upload-${file.name}`,
        label: file.name,
        image: URL.createObjectURL(file),
      }),
    });
    registerDataSource({
      id: "posts",
      load: { mode: "paginated", load: paginate(POSTS, 3) },
      resolve: resolveById(POSTS),
    });
    return null;
  });
  useEffect(
    () => () => {
      unregisterDataSource("media");
      unregisterDataSource("posts");
    },
    [],
  );
  return (
    <div style={{ maxWidth: 900 }}>
      <OwnedModelEditor
        store={store}
        toolbarCapabilities={{ media: true }}
        virtualize={false}
      />
      <p style={{ font: "12px ui-sans-serif", marginTop: 12, opacity: 0.7 }}>
        Reference blocks (docs/026): the image and the linked post are projected
        from host data sources, both served cursor-paginated (scroll the picker
        to load more). Insert a new one with <code>/</code> → choose-first opens
        the library; <kbd>Esc</kbd> rolls the empty block back. The gear
        replaces a block&apos;s record; the caption is author-local and survives
        a refresh.
      </p>
    </div>
  );
};

// Upload-as-create (docs/026 §7.1): fabricate an asset record from a file (an
// object URL stands in for a real upload transport) and return it as an option the
// pick path consumes. Shared by the source `upload` capability and the gallery's
// drop zone so both converge on one create path.
async function uploadMediaAsset(file: File): Promise<ResourceOption> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  return {
    id: `upload-${file.name}`,
    label: file.name,
    image: URL.createObjectURL(file),
    sublabel: "Just uploaded",
  };
}

/**
 * A host-supplied media-library pick surface (docs/026 §6.4) — the `renderPicker`
 * seam in action. The engine owns the overlay (it mounts this body inside its own
 * `@idco/ui` `Drawer`), so this returns only the body: a searchable thumbnail grid
 * plus a drop zone. The grid is a React Aria `GridList` with `layout="grid"`, so it
 * is keyboard-navigable in 2D and `onAction` fires the pick on click/Enter; DaisyUI
 * classes do the styling (the package's React-Aria-behavior + DaisyUI-styling rule).
 * Choosing — by click or by upload — calls `onChoose(option)`; the engine then runs
 * the block's `toData` and closes the overlay, never learning the option came from a
 * grid rather than the default ComboBox (docs/026 §6.4 — one commit path).
 *
 * This grid lives in the *story* (the host), not the neutral package: docs/026 §10
 * deliberately keeps a grid out of `@idco/ui` and composes it host-side from existing
 * primitives. That is exactly what this is.
 */
function MediaGalleryPicker({
  onChoose,
  onCancel,
  query,
}: DataSourcePickerProps) {
  const [q, setQ] = useState(query ?? "");
  const needle = q.trim().toLowerCase();
  const assets = needle
    ? MEDIA_ASSETS.filter(
        (a) =>
          a.label.toLowerCase().includes(needle) ||
          (a.sublabel ?? "").toLowerCase().includes(needle),
      )
    : MEDIA_ASSETS;
  return (
    <div className="grid gap-4">
      <Input
        ariaLabel="Search the media library"
        onChange={setQ}
        placeholder="Search games…"
        size="sm"
        value={q}
      />
      <GridList
        aria-label="Media library"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        items={assets}
        layout="grid"
        onAction={(key) => {
          const asset = MEDIA_ASSETS.find((a) => a.id === key);
          if (asset) onChoose(asset);
        }}
        renderEmptyState={() => (
          <p className="col-span-full py-8 text-center text-sm opacity-60">
            No matches.
          </p>
        )}
        selectionMode="none"
      >
        {(asset) => (
          <GridListItem
            className="group cursor-pointer overflow-hidden rounded-box border border-base-300 bg-base-100 outline-none transition hover:border-primary data-[focus-visible]:ring-2 data-[focus-visible]:ring-primary"
            id={asset.id}
            textValue={asset.label}
          >
            <img
              alt=""
              className="aspect-video w-full object-cover"
              src={asset.image ?? ""}
            />
            <div className="grid gap-0.5 p-2">
              {/* The primary label takes no slot; only "description" is a valid
                  React Aria `GridListItem` text slot. */}
              <Text className="line-clamp-1 text-sm font-medium">
                {asset.label}
              </Text>
              <Text className="text-xs opacity-60" slot="description">
                {asset.sublabel}
              </Text>
            </div>
          </GridListItem>
        )}
      </GridList>
      <FileDropzone
        accept={["image/*"]}
        hint="PNG, JPG, or WebP — uploads then references the new asset"
        label="Upload a new image"
        onFiles={(files) => {
          const file = files[0];
          if (file) void uploadMediaAsset(file).then(onChoose);
        }}
      />
      <div className="flex justify-end">
        <Button ariaLabel="Cancel" onClick={onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * The `renderPicker` path (docs/026 §6.4): the `media` source brings its own
 * pick surface — a thumbnail gallery + drop zone — so the image field opens the
 * host modal instead of the default ComboBox. The `posts` source keeps the default
 * dropdown, so this one editor shows both pick surfaces side by side: a host grid
 * for images, the standard ComboBox for linked posts. Everything else (cache,
 * resolve, the snapshot the reader paints) is identical to the dropdown path.
 */
export const MediaGallery: Story = () => {
  const store = useReferenceStore();
  useState(() => {
    registerDataSource({
      id: "media",
      // The host's own pick surface wins over the default ComboBox (§6.4). `load`
      // is omitted on purpose: this source browses through the grid, not a dropdown.
      renderPicker: (pickerProps) => <MediaGalleryPicker {...pickerProps} />,
      resolve: resolveById(MEDIA_ASSETS),
      upload: uploadMediaAsset,
    });
    registerDataSource({
      id: "posts",
      load: { mode: "paginated", load: paginate(POSTS, 3) },
      resolve: resolveById(POSTS),
    });
    return null;
  });
  useEffect(
    () => () => {
      unregisterDataSource("media");
      unregisterDataSource("posts");
    },
    [],
  );
  return (
    <div style={{ maxWidth: 900 }}>
      <OwnedModelEditor
        store={store}
        toolbarCapabilities={{ media: true }}
        virtualize={false}
      />
      <p style={{ font: "12px ui-sans-serif", marginTop: 12, opacity: 0.7 }}>
        Host-supplied media gallery (docs/026 §6.4 <code>renderPicker</code>):
        open the gear on the image (or insert one with <code>/</code>) to bring
        up its config, then click <em>Choose image</em> — the engine opens its
        own drawer filled with the host&apos;s thumbnail grid (arrow-key
        navigable, click or <kbd>Enter</kbd> to pick) plus an upload drop zone.
        The Linked post field still uses the default ComboBox — same SPI, two
        pick surfaces. No grid lives in the neutral package; it is composed here
        from <code>@idco/ui</code> primitives.
      </p>
    </div>
  );
};

/**
 * The full opt-in editing surface: toolbar, find, marks, objects, autosave, plus the
 * docs/027 Review dock — Comments (a fake in-memory source), Glossary (two seeded
 * terms), Insights, Accessibility, and Broken refs — and the View → Outline pane.
 */
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
    // Wire the same host data sources the Reference Blocks story uses (docs/026
    // §6.1) so the image config field browses a real library and `/` can insert a
    // Linked post. Registered here in the first-render initializer (before the
    // child editor mounts) and torn down on unmount, so they do not leak into the
    // other stories — and registering `media` with `load` here wins over the
    // `uploadImage` upload-only shim (§14.12), giving the field browse + upload.
    registerDataSource({
      id: "media",
      load: { mode: "paginated", load: paginate(MEDIA_ASSETS, 2) },
      resolve: resolveById(MEDIA_ASSETS),
      upload: async (file) => ({
        id: `upload-${file.name}`,
        label: file.name,
        image: URL.createObjectURL(file),
      }),
    });
    registerDataSource({
      id: "posts",
      load: { mode: "paginated", load: paginate(POSTS, 3) },
      resolve: resolveById(POSTS),
    });
    // Light up the full Review dock (docs/027): a fake comment source enables the
    // Comments pane + the flyout "Comment" action (§7.7), and two seeded glossary
    // terms give the Glossary pane content. Insights, Accessibility, and Broken refs
    // are always-on derived panes. So the Review tab here carries every §9 surface.
    registerCommentSource(createInMemoryCommentSource());
    store.command({
      collection: "glossary",
      items: [
        {
          definition:
            "An editor whose model is the source of truth, not the DOM.",
          id: "g-owned",
          term: "owned model",
        },
        {
          definition: "The off-thread pass that derives the document index.",
          id: "g-bake",
          term: "bake",
        },
      ],
      type: "set-collection",
    });
    return null;
  });
  // Drop the command + sources on unmount so they do not leak into the other
  // editor stories (the registries are module singletons).
  useEffect(
    () => () => {
      unregisterCommand("story.save");
      unregisterDataSource("media");
      unregisterDataSource("posts");
      unregisterCommentSource("comments");
    },
    [],
  );
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
        <kbd>Ctrl/Cmd+F</kbd> to find, click the image to edit/upload. Open{" "}
        <strong>Review</strong> for the document-insight dock (docs/027):
        Comments, Glossary, Insights, Accessibility, and Broken refs — or{" "}
        <strong>View → Outline</strong>. Select text for the flyout’s Comment
        and Add-to-glossary actions.
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
