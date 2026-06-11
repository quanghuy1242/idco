import type { Story, StoryDefault } from "@ladle/react";
import {
  RichTextRenderer,
  type RichTextDocument,
} from "@idco/content-renderer";
import { CodeBlock, Columns, Panel, Stack, Text } from "@idco/ui";

export default {
  title: "Packages Content Renderer / Rich Text Renderer",
} satisfies StoryDefault;

const richTextDocument: RichTextDocument = {
  root: {
    children: [
      {
        type: "heading",
        tag: "h2",
        children: [{ type: "text", text: "Composable rich text" }],
      },
      {
        type: "paragraph",
        children: [
          { type: "text", text: "The renderer supports " },
          {
            type: "link",
            url: "https://example.test/docs",
            children: [{ type: "text", text: "links" }],
          },
          {
            type: "text",
            text: ", media, embeds, references, and code blocks.",
          },
        ],
      },
      {
        type: "callout",
        tone: "info",
        children: [
          { type: "text", text: "Custom renderers can replace any node type." },
        ],
      },
      {
        type: "list",
        tag: "ul",
        children: [
          {
            type: "listitem",
            children: [{ type: "text", text: "Paragraphs and headings" }],
          },
          {
            type: "listitem",
            children: [{ type: "text", text: "Ordered and unordered lists" }],
          },
          {
            type: "listitem",
            children: [{ type: "text", text: "Resolver-backed references" }],
          },
        ],
      },
      {
        type: "code-block",
        language: "ts",
        text: "export const packageName = '@idco/content-renderer';",
      },
      {
        type: "media",
        mediaId: "media_logo",
        alt: "IDCO mark",
      },
      {
        type: "post-ref",
        postId: "post_shared_ui",
        title: "Shared UI release notes",
      },
      {
        type: "embed",
        url: "https://example.test/embed/demo",
      },
    ],
  },
};

export const Default: Story = () => (
  <Columns>
    <Panel>
      <Stack>
        <Text variant="h2">Rendered output</Text>
        <RichTextRenderer
          value={richTextDocument}
          allowedEmbedDomains={["example.test"]}
          resolveMedia={(node) =>
            node.mediaId === "media_logo"
              ? {
                  src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 80'%3E%3Crect width='160' height='80' rx='12' fill='%233a5a6b'/%3E%3Ctext x='80' y='48' text-anchor='middle' font-family='Arial' font-size='26' fill='white'%3EIDCO%3C/text%3E%3C/svg%3E",
                  alt: "IDCO mark",
                }
              : null
          }
          resolvePost={(node) =>
            node.postId === "post_shared_ui"
              ? { href: "/posts/shared-ui", label: "Shared UI release notes" }
              : null
          }
        />
      </Stack>
    </Panel>
    <CodeBlock
      label="Input document"
      value={JSON.stringify(richTextDocument, null, 2)}
      maxHeight="lg"
    />
  </Columns>
);

export const CustomRenderer: Story = () => (
  <Panel>
    <Stack>
      <Text variant="h2">Custom callout renderer</Text>
      <RichTextRenderer
        value={richTextDocument}
        renderers={{
          callout: (_node, children, key) => (
            <strong key={key} className="text-info">
              {children}
            </strong>
          ),
        }}
      />
    </Stack>
  </Panel>
);
