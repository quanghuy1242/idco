import { RichTextEditor, type RichTextEditorDocument } from "@idco/editor";
import { Stack, Text } from "@idco/ui";
import type { Story, StoryDefault } from "@ladle/react";
import { useState } from "react";

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
