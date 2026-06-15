import {
  RichTextEditor,
  VirtualRichTextEditor,
  type RichTextEditorDocument,
} from "@idco/editor";
import { Stack, Text } from "@idco/ui";
import type { Story, StoryDefault } from "@ladle/react";
import { useEffect, useState } from "react";

type DocumentChild = RichTextEditorDocument["root"]["children"][number];

export default {
  title: "Packages Editor / Rich Text Editor",
} satisfies StoryDefault;

const mediaAssets = [
  {
    alt: "Mountain sunrise",
    id: "media_sunrise",
    label: "Sunrise over the ridge",
    previewUrl: "https://picsum.photos/seed/idco-sunrise/640/360",
  },
  {
    alt: "City skyline",
    id: "media_city",
    label: "Evening skyline",
    previewUrl: "https://picsum.photos/seed/idco-city/640/360",
  },
];

const postReferences = [
  {
    href: "/posts/getting-started",
    id: "post_intro",
    label: "Getting started",
  },
  {
    href: "/posts/architecture",
    id: "post_arch",
    label: "System architecture",
  },
];

const mediaLibrary = {
  load: async (query: string) => {
    const normalized = query.trim().toLowerCase();
    return mediaAssets.filter((asset) =>
      normalized
        ? `${asset.label} ${asset.alt}`.toLowerCase().includes(normalized)
        : true,
    );
  },
  resolve: async (mediaId: string) =>
    mediaAssets.find((asset) => asset.id === mediaId) ?? null,
};

const postLibrary = {
  load: async (query: string) => {
    const normalized = query.trim().toLowerCase();
    return postReferences.filter((post) =>
      normalized
        ? `${post.label} ${post.href}`.toLowerCase().includes(normalized)
        : true,
    );
  },
};

const richDocument: RichTextEditorDocument = {
  root: {
    children: [
      {
        type: "heading",
        tag: "h2",
        children: [{ type: "text", text: "Chapter one" }],
      },
      {
        type: "table-of-contents",
        title: "On this page",
        minLevel: 1,
        maxLevel: 4,
        numbering: "decimal",
        style: "plain",
      },
      {
        type: "paragraph",
        format: "center",
        children: [
          {
            type: "text",
            text: "Centered intro paragraph — alignment is live.",
          },
        ],
      },
      {
        type: "heading",
        tag: "h3",
        children: [{ type: "text", text: "Inline formatting" }],
      },
      {
        type: "paragraph",
        children: [
          { type: "text", text: "Body text with " },
          { type: "text", text: "bold", format: 1 },
          { type: "text", text: " and " },
          { type: "text", text: "italic", format: 2 },
          { type: "text", text: " runs." },
        ],
      },
      {
        type: "paragraph",
        children: [
          { type: "text", text: "Visit the " },
          {
            type: "link",
            url: "https://lexical.dev",
            children: [{ type: "text", text: "Lexical docs" }],
          },
          { type: "text", text: " and define " },
          {
            type: "glossary",
            term: "decorator node",
            definition: "A Lexical node that renders arbitrary React UI.",
          },
          { type: "text", text: " inline." },
        ],
      },
      {
        type: "quote",
        children: [
          {
            type: "text",
            text: "Quotes are plain text — the bold/italic buttons disable here.",
          },
        ],
      },
      {
        type: "list",
        listType: "check",
        children: [
          {
            type: "listitem",
            checked: true,
            children: [{ type: "text", text: "Type / for the command menu" }],
          },
          {
            type: "listitem",
            checked: false,
            children: [
              { type: "text", text: "Drag the gutter handle to reorder" },
            ],
          },
        ],
      },
      {
        type: "callout",
        tone: "success",
        children: [{ type: "text", text: "Callouts render live in place." }],
      },
      {
        type: "code-block",
        language: "ts",
        text: "const editor = createEditor();",
      },
      {
        type: "table",
        children: [
          {
            type: "tablerow",
            children: [
              {
                type: "tablecell",
                headerState: 1,
                children: [
                  {
                    type: "paragraph",
                    children: [{ type: "text", text: "Feature" }],
                  },
                ],
              },
              {
                type: "tablecell",
                headerState: 1,
                children: [
                  {
                    type: "paragraph",
                    children: [{ type: "text", text: "Status" }],
                  },
                ],
              },
            ],
          },
          {
            type: "tablerow",
            children: [
              {
                type: "tablecell",
                headerState: 0,
                children: [
                  {
                    type: "paragraph",
                    children: [{ type: "text", text: "Tables" }],
                  },
                ],
              },
              {
                type: "tablecell",
                headerState: 0,
                children: [
                  {
                    type: "paragraph",
                    children: [{ type: "text", text: "Live" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

const selectionActionDocument: RichTextEditorDocument = {
  root: {
    children: [
      {
        type: "heading",
        tag: "h2",
        children: [{ type: "text", text: "Selection actions" }],
      },
      {
        type: "paragraph",
        children: [
          {
            type: "text",
            text: "The contextual action model keeps selected text commands close to the authoring surface.",
          },
        ],
      },
      {
        type: "quote",
        children: [
          {
            type: "text",
            text: "This quote keeps inline formatting unavailable while annotation actions remain possible.",
          },
        ],
      },
    ],
  },
};

// A document whose first and last children are atomic blocks. Use the gutter
// handle's "+" or click/arrow into the gaps above, between, and below the
// blocks; empty paragraphs are only created after real input.
const blockBoundedDocument: RichTextEditorDocument = {
  root: {
    children: [
      {
        type: "code-block",
        language: "json",
        text: '{\n  "leading": "block"\n}',
      },
      {
        type: "media",
        mediaId: "media_city",
        alt: "Evening skyline",
        caption: "",
      },
    ],
  },
};

// A document that exercises gap placement inside a table-cell block scope, not
// only around root-level blocks.
const tableCellBlockDocument: RichTextEditorDocument = {
  root: {
    children: [
      {
        type: "table",
        children: [
          {
            type: "tablerow",
            children: [
              {
                type: "tablecell",
                headerState: 0,
                children: [
                  {
                    type: "code-block",
                    language: "ts",
                    text: "const value = true;",
                  },
                  {
                    type: "callout",
                    tone: "info",
                    children: [{ type: "text", text: "Callout" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

export const FullEditor: Story = () => {
  const [doc, setDoc] = useState<RichTextEditorDocument>(richDocument);
  const [comments, setComments] = useState<
    { id: string; quote: string; body: string }[]
  >([]);
  return (
    <Stack>
      <Text variant="body">
        Slash menu (/), drag-handle reorder, inline links, glossary tooltips,
        comments, check lists, live tables (add/remove row & column, drag to
        resize), alignment, markdown shortcuts, and capability gating — all
        editing the same JSON value.
      </Text>
      <RichTextEditor
        label="Book section"
        name="section"
        value={doc}
        onChange={setDoc}
        allowedEmbedDomains={["www.youtube.com", "example.com"]}
        mediaLibrary={mediaLibrary}
        postLibrary={postLibrary}
        comments={comments}
        onComment={(id, quote, body) =>
          // The host owns thread storage/UI; here we just collect them.
          setComments((current) => [...current, { body, id, quote }])
        }
        onCommentUpdate={(id, body) =>
          setComments((current) =>
            current.map((comment) =>
              comment.id === id ? { ...comment, body } : comment,
            ),
          )
        }
        onCommentDelete={(id) =>
          setComments((current) =>
            current.filter((comment) => comment.id !== id),
          )
        }
        onUploadMedia={(files) => {
          const file = files[0];
          if (!file) return undefined;
          return [
            {
              alt: file.name,
              caption: "",
              mediaId: `upload_${file.name}`,
              previewUrl: URL.createObjectURL(file),
              type: "media",
            },
          ];
        }}
      />
      {comments.length > 0 ? (
        <Stack gap="xs">
          <Text variant="h4">Comment threads (host-owned)</Text>
          {comments.map((comment) => (
            <Text key={comment.id} variant="caption">
              “{comment.quote}” — {comment.body}
            </Text>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
};

export const SelectionActions: Story = () => {
  const [doc, setDoc] = useState<RichTextEditorDocument>(
    selectionActionDocument,
  );
  const [comments, setComments] = useState<
    { id: string; quote: string; body: string }[]
  >([]);
  return (
    <RichTextEditor
      label="Selection action surface"
      name="selection-actions"
      value={doc}
      onChange={setDoc}
      comments={comments}
      onComment={(id, quote, body) =>
        setComments((current) => [...current, { body, id, quote }])
      }
    />
  );
};

export const CaretAroundBlocks: Story = () => {
  const [doc, setDoc] = useState<RichTextEditorDocument>(blockBoundedDocument);
  return (
    <Stack>
      <Text variant="body">
        This document starts and ends with a block. Hover the gutter handle to
        insert a line, or click/arrow into the empty spaces above, between, and
        below the blocks to place the gap cursor.
      </Text>
      <RichTextEditor
        label="Block-bounded document"
        name="bounded"
        value={doc}
        onChange={setDoc}
        mediaLibrary={mediaLibrary}
      />
    </Stack>
  );
};

export const TableCellBlockGaps: Story = () => {
  const [doc, setDoc] = useState<RichTextEditorDocument>(
    tableCellBlockDocument,
  );
  return (
    <Stack>
      <Text variant="body">
        This table cell starts with adjacent atomic blocks. Click before,
        between, or after them inside the cell, then type or press Enter.
      </Text>
      <RichTextEditor
        label="Table-cell block scope"
        name="table-cell-blocks"
        value={doc}
        onChange={setDoc}
      />
    </Stack>
  );
};

export const SlashMenuInsertion: Story = () => {
  const [doc, setDoc] = useState<RichTextEditorDocument>({
    root: { children: [] },
  });
  return (
    <RichTextEditor
      label="Slash menu insertion"
      name="slash-menu"
      value={doc}
      onChange={setDoc}
    />
  );
};

export const ConstrainedNodes: Story = () => {
  const [doc, setDoc] = useState<RichTextEditorDocument>({
    root: {
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", text: "Only paragraphs and headings." }],
        },
      ],
    },
  });
  return (
    <RichTextEditor
      label="Constrained editor"
      name="constrained"
      allowedNodes={["paragraph", "heading", "text"]}
      value={doc}
      onChange={setDoc}
    />
  );
};

const sideTocFiller =
  "This paragraph exists to give the document enough height that the side rail has somewhere to stick while you scroll. The table of contents should stay pinned beside the body as these sections move past it.";

const sideTocDocument: RichTextEditorDocument = {
  root: {
    children: [
      {
        type: "table-of-contents",
        title: "On this page",
        minLevel: 1,
        maxLevel: 3,
        numbering: "decimal",
        // `panel`/`plain` wrap long headings with a hanging indent and clamp at
        // three lines in the narrow rail instead of truncating; switch this to
        // `compact` in the node settings to see single-line truncation.
        style: "panel",
        placement: "aside",
        side: "left",
      },
      // Deliberately long sub-headings so the narrow rail has to wrap them.
      ...[
        ["Introduction", "What this guide covers and who it is written for"],
        [
          "Getting started",
          "Installing the CLI and configuring your environment variables",
        ],
        [
          "Configuration",
          "Configuring the production deployment pipeline with environment-specific secrets",
        ],
        [
          "Advanced usage",
          "Deploying to multiple regions with zero-downtime rolling releases",
        ],
        [
          "Troubleshooting",
          "Diagnosing common failures and reading the structured request logs",
        ],
      ].flatMap(
        ([
          heading,
          detail,
        ]): RichTextEditorDocument["root"]["children"][number][] => [
          {
            type: "heading",
            tag: "h2",
            children: [{ type: "text", text: heading }],
          },
          {
            type: "paragraph",
            children: [{ type: "text", text: sideTocFiller }],
          },
          {
            type: "heading",
            tag: "h3",
            children: [{ type: "text", text: detail }],
          },
          {
            type: "paragraph",
            children: [{ type: "text", text: sideTocFiller }],
          },
          {
            type: "paragraph",
            children: [{ type: "text", text: sideTocFiller }],
          },
        ],
      ),
    ],
  },
};

export const SideTableOfContents: Story = () => {
  const [doc, setDoc] = useState<RichTextEditorDocument>(sideTocDocument);
  return (
    <Stack>
      <Text variant="body">
        The table of contents is set to <code>placement: aside</code>. It
        renders as a sticky rail beside the editor frame; in the document flow
        it leaves a compact placeholder. Open its settings to switch placement
        (inline / side rail) and side (left / right). Scroll to see the rail
        stay pinned. The sub-headings are intentionally long: in the rail they
        wrap with a hanging indent and clamp at three lines rather than
        truncating (switch the style to <code>compact</code> to compare).
      </Text>
      <RichTextEditor
        label="Book section"
        name="side-toc"
        value={doc}
        onChange={setDoc}
      />
    </Stack>
  );
};

// docs/009 §6.1.1 — decorator-heavy fixture for the Phase 0 benchmark. Each
// iteration contributes two decorator blocks (a Prism code editor and a live
// callout), interleaved with a heading and a paragraph so the document is
// realistic, not just a wall of widgets. Kept fully local (no external media or
// embeds) so the perf numbers reflect decorator React/DOM cost, not network.
const DECORATOR_PAIRS = 130;

const codeSample = [
  "export function reconcile(prev, next) {",
  "  const dirty = diff(prev, next);",
  "  for (const key of dirty) {",
  "    patch(key, next.get(key));",
  "  }",
  "  return next;",
  "}",
].join("\n");

function decoratorHeavyDocument(pairs: number): RichTextEditorDocument {
  const children: DocumentChild[] = [
    {
      type: "heading",
      tag: "h1",
      children: [{ type: "text", text: "Decorator-heavy document" }],
    },
  ];
  for (let index = 0; index < pairs; index += 1) {
    children.push(
      {
        type: "heading",
        tag: "h2",
        children: [{ type: "text", text: `Section ${index + 1}` }],
      },
      {
        type: "paragraph",
        children: [
          {
            type: "text",
            text: `Prose ahead of the widgets in section ${index + 1}. Each section carries a live code editor and a callout — the bodies Phase 0 virtualizes.`,
          },
        ],
      },
      {
        type: "code-block",
        language: "ts",
        text: codeSample,
      },
      {
        type: "callout",
        tone: index % 2 === 0 ? "info" : "success",
        children: [
          {
            type: "text",
            text: `Callout ${index + 1}: callouts render their body live; offscreen they collapse to a placeholder when virtualization is on.`,
          },
        ],
      },
    );
  }
  return { root: { children } };
}

const decoratorHeavyValue = decoratorHeavyDocument(DECORATOR_PAIRS);

// Reads the global the virtualization module publishes so reviewers can watch
// mounted-vs-total decorator bodies change live while scrolling.
function VirtualizationDiagnostics() {
  const [snapshot, setSnapshot] = useState<{
    mountedBodies: number;
    totalBodies: number;
  } | null>(null);
  useEffect(() => {
    const read = () =>
      setSnapshot(
        (
          window as {
            __IDCO_DECORATOR_VIRT__?: {
              mountedBodies: number;
              totalBodies: number;
            };
          }
        )["__IDCO_DECORATOR_VIRT__"] ?? null,
      );
    read();
    const id = window.setInterval(read, 250);
    return () => window.clearInterval(id);
  }, []);
  return (
    <Text variant="caption">
      Mounted decorator bodies: {snapshot?.mountedBodies ?? "—"} /{" "}
      {snapshot?.totalBodies ?? "—"} total
    </Text>
  );
}

function DecoratorHeavyEditor({
  virtualized,
}: {
  readonly virtualized: boolean;
}) {
  const [doc, setDoc] = useState<RichTextEditorDocument>(decoratorHeavyValue);
  return (
    <Stack>
      <Text variant="body">
        {DECORATOR_PAIRS * 2} decorator blocks (live code editors + callouts).
        Virtualization is <strong>{virtualized ? "on" : "off"}</strong>. With it
        on, offscreen bodies collapse to placeholders; scroll and watch the
        mounted count stay bounded.
      </Text>
      <VirtualizationDiagnostics />
      <RichTextEditor
        label="Book section"
        name={virtualized ? "decorator-virtualized" : "decorator-standard"}
        value={doc}
        onChange={setDoc}
        decoratorVirtualization={virtualized}
      />
    </Stack>
  );
}

export const DecoratorHeavyStandard: Story = () => (
  <DecoratorHeavyEditor virtualized={false} />
);

export const DecoratorHeavyVirtualized: Story = () => (
  <DecoratorHeavyEditor virtualized />
);

export const DecoratorHeavySectionShell: Story = () => {
  const [doc, setDoc] = useState<RichTextEditorDocument>(decoratorHeavyValue);
  return (
    <Stack>
      <Text variant="body">
        The same {DECORATOR_PAIRS * 2} decorator-block fixture rendered through
        the full large-document section shell. Inactive sections are read
        chunks; clicking a section mounts one focused Lexical editor.
      </Text>
      <VirtualRichTextEditor
        label="Book section"
        largeDocument={{
          fallbackBlocksPerSection: 20,
          mode: "large-document",
          overscanSections: 2,
        }}
        name="decorator-section-shell"
        value={doc}
        onChange={setDoc}
      />
    </Stack>
  );
};

function paragraphDocument(count: number): RichTextEditorDocument {
  return {
    root: {
      children: Array.from({ length: count }, (_, index) => ({
        type: "paragraph",
        children: [
          {
            type: "text",
            text: `Paragraph ${index + 1}: generated long-form body text for the virtual shell benchmark.`,
          },
        ],
      })),
    },
  };
}

function mixedBookDocument(sections: number): RichTextEditorDocument {
  const children: DocumentChild[] = [
    {
      type: "table-of-contents",
      placement: "inline",
      style: "compact",
      title: "Book outline",
    },
  ];
  for (let index = 0; index < sections; index += 1) {
    children.push(
      {
        type: index % 8 === 0 ? "heading" : "paragraph",
        tag: "h2",
        children: [
          {
            type: "text",
            text:
              index % 8 === 0
                ? `Chapter ${index / 8 + 1}`
                : `Narrative paragraph ${index + 1}`,
          },
        ],
      },
      {
        type: "paragraph",
        children: [
          {
            type: "text",
            text: `Search marker ${index + 1}: this text is indexed from JSON even when the section is offscreen.`,
          },
        ],
      },
    );
    if (index % 10 === 0) {
      children.push({
        type: "code-block",
        language: "ts",
        text: codeSample,
      });
    }
    if (index % 12 === 0) {
      children.push({
        type: "callout",
        tone: "info",
        children: [
          { type: "text", text: `Author note for section ${index + 1}` },
        ],
      });
    }
  }
  return { root: { children } };
}

function LargeDocumentStory({
  value,
  label,
}: {
  readonly value: RichTextEditorDocument;
  readonly label: string;
}) {
  const [doc, setDoc] = useState(value);
  return (
    <Stack>
      <VirtualRichTextEditor
        label={label}
        largeDocument={{
          fallbackBlocksPerSection: 40,
          mode: "large-document",
          overscanSections: 2,
        }}
        value={doc}
        onChange={setDoc}
      />
    </Stack>
  );
}

export const LargeDocumentParagraphs1000: Story = () => (
  <LargeDocumentStory
    label="Large document 1000 paragraphs"
    value={paragraphDocument(1000)}
  />
);

export const LargeDocumentParagraphs5000: Story = () => (
  <LargeDocumentStory
    label="Large document 5000 paragraphs"
    value={paragraphDocument(5000)}
  />
);

export const LargeDocumentDecorators1000: Story = () => (
  <LargeDocumentStory
    label="Large document decorator mix"
    value={decoratorHeavyDocument(500)}
  />
);

export const LargeDocumentMixedBook: Story = () => (
  <LargeDocumentStory
    label="Large document mixed book"
    value={mixedBookDocument(260)}
  />
);

export const LargeDocumentSearchAndToc: Story = () => (
  <LargeDocumentStory
    label="Large document search and TOC"
    value={mixedBookDocument(160)}
  />
);
