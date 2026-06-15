import type { Story, StoryDefault } from "@ladle/react";
import {
  RichTextRenderer,
  type RichTextDocument,
} from "@idco/content-renderer";
import {
  Alert,
  Badge,
  CodeBlock,
  Columns,
  Container,
  Stack,
  Text,
} from "@idco/ui";

export default {
  title: "Packages Content Renderer / Rich Text Renderer",
} satisfies StoryDefault;

const mediaSrc =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 960 540'%3E%3Crect width='960' height='540' fill='%23f3f4f6'/%3E%3Crect x='80' y='72' width='800' height='396' rx='32' fill='%23ffffff' stroke='%23d1d5db' stroke-width='8'/%3E%3Ccircle cx='214' cy='202' r='62' fill='%233b82f6'/%3E%3Cpath d='M140 406l186-172 132 124 88-72 274 120z' fill='%2310b981'/%3E%3Ctext x='480' y='128' text-anchor='middle' font-family='Arial' font-size='42' font-weight='700' fill='%23111827'%3EIDCO content image%3C/text%3E%3C/svg%3E";

const blogDocument: RichTextDocument = {
  root: {
    children: [
      {
        children: [
          { text: "Shipping rich content without drift", type: "text" },
        ],
        tag: "h1",
        type: "heading",
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
        children: [
          {
            text: "A compact demo post showing every node shape emitted by the ",
            type: "text",
          },
          {
            format: 1,
            text: "current Lexical editor",
            type: "text",
          },
          { text: ".", type: "text" },
        ],
        type: "paragraph",
      },
      {
        children: [
          { text: "Inline text can be ", type: "text" },
          { format: 1, text: "bold", type: "text" },
          { text: ", ", type: "text" },
          { format: 2, text: "italic", type: "text" },
          { text: ", ", type: "text" },
          { format: 8, text: "underlined", type: "text" },
          { text: ", ", type: "text" },
          { format: 4, text: "struck", type: "text" },
          { text: ", and include ", type: "text" },
          { format: 16, text: "inlineCode()", type: "text" },
          { text: ".", type: "text" },
          { type: "linebreak" },
          {
            text: "Linebreak nodes stay inline instead of creating a new paragraph.",
            type: "text",
          },
        ],
        type: "paragraph",
      },
      {
        children: [
          {
            text: "Links render with the same theme tokens as the rest of the UI: ",
            type: "text",
          },
          {
            children: [{ text: "read the implementation notes", type: "text" }],
            type: "link",
            url: "https://example.test/docs/rich-content",
          },
          { text: ".", type: "text" },
        ],
        type: "paragraph",
      },
      {
        children: [{ text: "Editor block nodes", type: "text" }],
        tag: "h2",
        type: "heading",
      },
      {
        children: [
          {
            text: "Callout rendering mirrors the editor block and shared alert tones.",
            type: "text",
          },
        ],
        tone: "info",
        type: "callout",
      },
      {
        children: [
          {
            text: "Quotes keep the Lexical quote visual language: left rule, italic body, and muted content color.",
            type: "text",
          },
        ],
        type: "quote",
      },
      {
        children: [{ text: "List coverage", type: "text" }],
        tag: "h3",
        type: "heading",
      },
      {
        children: [
          {
            children: [
              {
                text: "Paragraphs, headings, quotes, and linebreaks",
                type: "text",
              },
            ],
            type: "listitem",
          },
          {
            children: [
              {
                text: "Resolver-backed media and post references",
                type: "text",
              },
            ],
            type: "listitem",
          },
          {
            children: [
              {
                text: "Embed allow-listing before iframe output",
                type: "text",
              },
            ],
            type: "listitem",
          },
        ],
        listType: "bullet",
        tag: "ul",
        type: "list",
      },
      {
        children: [
          {
            children: [{ text: "Normalize the editor document", type: "text" }],
            type: "listitem",
            value: 2,
          },
          {
            children: [
              { text: "Render without loading Lexical runtime", type: "text" },
            ],
            type: "listitem",
            value: 3,
          },
        ],
        listType: "number",
        start: 2,
        tag: "ol",
        type: "list",
      },
      {
        language: "tsx",
        text: "export function BlogPreview() {\n  return <RichTextRenderer value={document} />;\n}",
        type: "code-block",
      },
      {
        alt: "An IDCO content preview card",
        caption: "Media nodes render as theme-aware figures with captions.",
        mediaId: "media_article_preview",
        type: "media",
      },
      {
        postId: "post_shared_ui_release",
        title: "Shared UI release notes",
        type: "post-ref",
        url: "/posts/shared-ui-release-notes",
      },
      {
        title: "Example embed preview",
        type: "embed",
        url: "https://example.test/embed/content-preview",
      },
      {
        children: [
          { text: "Small heading levels still map safely", type: "text" },
        ],
        tag: "h4",
        type: "heading",
      },
      {
        children: [
          {
            text: "The renderer also preserves unknown future nodes by rendering their children.",
            type: "text",
          },
        ],
        type: "paragraph",
      },
    ],
  },
};

export const BlogPost: Story = () => (
  <Container width="wide">
    <Stack>
      <Stack gap="xs">
        <Badge tone="primary">Content renderer</Badge>
        <Text variant="h2">Blog post preview</Text>
        <Text variant="caption">
          Static rendering for the same rich text document shape produced by the
          shared editor.
        </Text>
      </Stack>
      <Columns>
        <Container width="content">
          <RichTextRenderer
            value={blogDocument}
            allowedEmbedDomains={["example.test"]}
            resolveMedia={(node) =>
              node.mediaId === "media_article_preview"
                ? {
                    alt: node.alt,
                    caption: node.caption,
                    src: mediaSrc,
                  }
                : null
            }
            resolvePost={(node) =>
              node.postId === "post_shared_ui_release"
                ? {
                    href: "/posts/shared-ui-release-notes",
                    label: "Shared UI release notes",
                  }
                : null
            }
          />
        </Container>
        <CodeBlock
          label="Editor document"
          value={JSON.stringify(blogDocument, null, 2)}
          maxHeight="lg"
        />
      </Columns>
    </Stack>
  </Container>
);

export const CustomRenderer: Story = () => (
  <Container width="content">
    <Stack>
      <Text variant="h2">Custom callout renderer</Text>
      <Text variant="caption">
        Consumers can still override individual node renderers without changing
        the default editor-compatible output.
      </Text>
      <RichTextRenderer
        value={blogDocument}
        renderers={{
          callout: (_node, children, key) => (
            <Alert key={key} tone="info">
              {children}
            </Alert>
          ),
        }}
      />
    </Stack>
  </Container>
);

const sideTocFiller =
  "Published article body. This text gives the page enough height for the sticky rail to travel: the table of contents on the side stays pinned beside the content as you scroll past these sections.";

function sideTocDocument(side: "left" | "right"): RichTextDocument {
  return {
    root: {
      children: [
        {
          type: "table-of-contents",
          title: "On this page",
          minLevel: 2,
          maxLevel: 3,
          numbering: "decimal",
          // `panel` (and `plain`) wrap long headings with a hanging indent and
          // clamp at 3 lines instead of truncating — easy to see here because
          // the rail is only 16rem wide. Switch to `compact` to see the
          // single-line truncation variant.
          style: "panel",
          placement: "aside",
          side,
        },
        // Deliberately long sub-headings so the narrow rail has to wrap them.
        ...[
          ["Overview", "What this guide covers and who it is written for"],
          [
            "Installation",
            "Installing the CLI and configuring your environment variables",
          ],
          [
            "Configuration",
            "Configuring the production deployment pipeline with environment-specific secrets",
          ],
          [
            "Deployment",
            "Deploying to multiple regions with zero-downtime rolling releases",
          ],
          [
            "Troubleshooting",
            "Diagnosing common failures and reading the structured request logs",
          ],
        ].flatMap(([heading, detail]) => [
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
        ]),
      ],
    },
  };
}

export const SideTableOfContentsLeft: Story = () => (
  <Container width="wide">
    <Stack gap="xs">
      <Badge tone="primary">Content renderer</Badge>
      <Text variant="h2">Side table of contents — left rail</Text>
      <Text variant="caption">
        A <code>placement: aside</code> TOC renders as a sticky left rail beside
        the article; the in-flow node is hidden at <code>lg</code>+ and falls
        back to an inline TOC on narrow screens. Scroll to see the rail stay
        pinned. The sub-headings are intentionally long: in the 16rem rail they
        wrap with a hanging indent and clamp at three lines rather than
        truncating.
      </Text>
    </Stack>
    <RichTextRenderer value={sideTocDocument("left")} />
  </Container>
);

export const SideTableOfContentsRight: Story = () => (
  <Container width="wide">
    <Stack gap="xs">
      <Badge tone="primary">Content renderer</Badge>
      <Text variant="h2">Side table of contents — right rail</Text>
      <Text variant="caption">
        The same document with <code>side: right</code>: the sticky rail docks
        to the right of the article.
      </Text>
    </Stack>
    <RichTextRenderer value={sideTocDocument("right")} />
  </Container>
);
