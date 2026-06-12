import { useState } from "react";
import type { Story, StoryDefault } from "@ladle/react";
import {
  CodeEditor,
  FileDropzone,
  Inline,
  Panel,
  ResourceSelector,
  RichTextEditor,
  ScopeBuilder,
  Stack,
  Text,
  UrlListBuilder,
  type ResourceOption,
  type RichTextEditorDocument,
} from "@idco/ui";

export default {
  title: "Packages UI / Editors and Builders",
} satisfies StoryDefault;

const resources: ResourceOption[] = [
  {
    id: "usr_ada",
    label: "Ada Lovelace",
    sublabel: "ada@example.test",
    badge: "Owner",
  },
  {
    id: "usr_grace",
    label: "Grace Hopper",
    sublabel: "grace@example.test",
    badge: "Admin",
  },
  {
    id: "usr_katherine",
    label: "Katherine Johnson",
    sublabel: "katherine@example.test",
  },
];

const oauthClients: ResourceOption[] = [
  {
    id: "cli_content_web",
    label: "Content Web",
    sublabel: "cli_content_web",
    badge: "web",
  },
  {
    id: "cli_admin_console",
    label: "Admin Console",
    sublabel: "cli_admin_console",
    badge: "public",
  },
  {
    id: "cli_docs",
    label: "Docs Portal",
    sublabel: "cli_docs",
    badge: "native",
  },
];

const scopeSuggestions = [
  { value: "members:read", description: "Read members", group: "Members" },
  { value: "members:write", description: "Write members", group: "Members" },
  { value: "settings:read", description: "Read settings", group: "Settings" },
  { value: "settings:write", description: "Write settings", group: "Settings" },
];

const initialDocument: RichTextEditorDocument = {
  root: {
    children: [
      {
        type: "paragraph",
        children: [{ type: "text", text: "Shared rich text content." }],
      },
    ],
  },
};

export const Builders: Story = () => {
  const [scopes, setScopes] = useState(["members:read"]);
  const [urls, setUrls] = useState(["https://example.test/callback"]);
  const [singleResource, setSingleResource] = useState("usr_ada");
  const [multiResource, setMultiResource] = useState<string[]>([
    "usr_ada",
    "usr_grace",
  ]);

  return (
    <Stack>
      <ScopeBuilder
        label="Allowed scopes"
        value={scopes}
        onChange={setScopes}
        suggestions={scopeSuggestions}
        allowCustom
      />
      <ScopeBuilder
        label="Menu scopes"
        value={scopes}
        onChange={setScopes}
        suggestions={scopeSuggestions}
        variant="menu"
        size="sm"
      />
      <UrlListBuilder label="Redirect URLs" value={urls} onChange={setUrls} />
      <Inline align="start">
        <ResourceSelector
          kind="user"
          value={singleResource}
          onChange={(next) => setSingleResource(String(next))}
          source={{ mode: "sync", items: resources }}
          showLabel
        />
        <ResourceSelector
          kind="member"
          selectionMode="multiple"
          value={multiResource}
          onChange={(next) =>
            setMultiResource(Array.isArray(next) ? next : [next])
          }
          source={{ mode: "sync", items: resources }}
          variant="menu"
          width="compact"
          showLabel
        />
        <ResourceSelector
          kind="oauth-client"
          label="Async OAuth client"
          value="cli_content_web"
          onChange={(next) => setSingleResource(String(next))}
          source={{
            mode: "async",
            load: async (query) => {
              await new Promise((resolve) => setTimeout(resolve, 150));
              const normalized = query.trim().toLowerCase();
              return oauthClients.filter((client) =>
                normalized
                  ? `${client.label} ${client.sublabel}`
                      .toLowerCase()
                      .includes(normalized)
                  : true,
              );
            },
          }}
          initialOptions={oauthClients.slice(0, 1)}
          minQueryLength={1}
          variant="menu"
          width="compact"
          showLabel
        />
      </Inline>
    </Stack>
  );
};

export const CodeAndRichText: Story = () => {
  const [code, setCode] = useState(
    '{\n  "name": "@idco/ui",\n  "stories": true\n}',
  );
  const [document, setDocument] =
    useState<RichTextEditorDocument>(initialDocument);

  return (
    <Stack>
      <CodeEditor
        label="JSON editor"
        name="json"
        value={code}
        onChange={setCode}
        language="json"
        engine="prism"
        showPreview
      />
      <RichTextEditor
        label="Rich text"
        name="body"
        value={document}
        onChange={setDocument}
        onUploadMedia={() => {}}
      />
    </Stack>
  );
};

export const FileUpload: Story = () => {
  const [files, setFiles] = useState<string[]>([]);

  return (
    <Stack>
      <FileDropzone
        label="Asset upload"
        accept={["image/*", ".json"]}
        multiple
        maxSizeBytes={1_000_000}
        hint="PNG, JPEG, SVG, or JSON under 1 MB"
        onFiles={(next) => setFiles(next.map((file) => file.name))}
      />
      <Panel tone="muted">
        <Text variant="caption">Selected: {files.join(", ") || "none"}</Text>
      </Panel>
    </Stack>
  );
};
