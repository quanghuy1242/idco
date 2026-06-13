import { useState } from "react";
import type { Story, StoryDefault } from "@ladle/react";
import {
  CodeEditor,
  FileDropzone,
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

const mediaAssets = [
  {
    alt: "Launch dashboard screenshot",
    id: "media_launch_dashboard",
    label: "Launch dashboard",
    previewUrl: "https://picsum.photos/seed/launch/640/360",
  },
  {
    alt: "Editor preview screenshot",
    id: "media_editor_preview",
    label: "Editor preview",
    previewUrl: "https://picsum.photos/seed/editor/640/360",
  },
];

const postReferences = [
  {
    href: "/posts/launch-notes",
    id: "post_launch_notes",
    label: "Launch notes",
  },
  {
    href: "/posts/editor-guide",
    id: "post_editor_guide",
    label: "Editor guide",
  },
];

const scopeSuggestions = [
  { value: "members:read", description: "Read members", group: "Members" },
  { value: "members:write", description: "Write members", group: "Members" },
  { value: "settings:read", description: "Read settings", group: "Settings" },
  { value: "settings:write", description: "Write settings", group: "Settings" },
];

// Simulated server-side search: a debounced async picker calls these on keystrokes.
function filterByQuery(
  items: ResourceOption[],
  query: string,
): ResourceOption[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return items;
  return items.filter((item) =>
    `${item.label} ${item.sublabel ?? ""} ${item.badge ?? ""}`
      .toLowerCase()
      .includes(normalized),
  );
}

async function searchUsers(query: string): Promise<ResourceOption[]> {
  await new Promise((resolve) => setTimeout(resolve, 200));
  return filterByQuery(resources, query);
}

async function searchOauthClients(query: string): Promise<ResourceOption[]> {
  await new Promise((resolve) => setTimeout(resolve, 200));
  return filterByQuery(oauthClients, query);
}

// A large mock directory to demonstrate cursor-based pagination + infinite scroll.
const directory: ResourceOption[] = Array.from({ length: 137 }, (_, index) => {
  const n = index + 1;
  return {
    id: `usr_dir_${n}`,
    label: `Directory User ${n}`,
    sublabel: `user${n}@directory.test`,
    badge: n % 7 === 0 ? "Service" : undefined,
  };
});

const PAGE_SIZE = 20;

// Simulated paginated server endpoint: returns one page plus an opaque cursor
// (the next offset) until the filtered result set is exhausted.
async function searchDirectoryPaginated({
  query,
  cursor,
}: {
  query: string;
  cursor?: string;
}): Promise<{ items: ResourceOption[]; cursor?: string }> {
  await new Promise((resolve) => setTimeout(resolve, 400));
  const matches = filterByQuery(directory, query);
  const start = cursor ? Number(cursor) : 0;
  const items = matches.slice(start, start + PAGE_SIZE);
  const nextStart = start + PAGE_SIZE;
  return {
    items,
    cursor: nextStart < matches.length ? String(nextStart) : undefined,
  };
}

const initialDocument: RichTextEditorDocument = {
  root: {
    children: [
      {
        type: "heading",
        tag: "h2",
        children: [{ type: "text", text: "Release notes" }],
      },
      {
        type: "paragraph",
        children: [{ type: "text", text: "Shared rich text content." }],
      },
      {
        type: "quote",
        children: [
          { type: "text", text: "Single source of truth, edited live." },
        ],
      },
      {
        type: "list",
        listType: "bullet",
        children: [
          {
            type: "listitem",
            children: [{ type: "text", text: "Headings, quotes, and lists" }],
          },
          {
            type: "listitem",
            children: [{ type: "text", text: "Inline bold / italic / code" }],
          },
        ],
      },
      {
        type: "callout",
        tone: "success",
        children: [{ type: "text", text: "Live blocks render in place." }],
      },
      {
        type: "code-block",
        language: "python",
        text: 'def greet(name: str) -> str:\n    # say hello\n    return f"Hello, {name}!"',
      },
    ],
  },
};

export const Builders: Story = () => {
  // Each control owns its own state so the samples never overwrite one another.
  const [allowedScopes, setAllowedScopes] = useState(["members:read"]);
  const [urls, setUrls] = useState(["https://example.test/callback"]);
  const [ownerId, setOwnerId] = useState("usr_ada");
  const [memberIds, setMemberIds] = useState<string[]>([
    "usr_ada",
    "usr_grace",
  ]);
  const [clientId, setClientId] = useState("cli_content_web");
  const [reviewerId, setReviewerId] = useState("");
  const [directoryId, setDirectoryId] = useState("");

  return (
    <Stack>
      <ScopeBuilder
        label="Allowed scopes"
        value={allowedScopes}
        onChange={setAllowedScopes}
        suggestions={scopeSuggestions}
        variant="menu"
        allowCustom
      />
      <UrlListBuilder label="Redirect URLs" value={urls} onChange={setUrls} />
      <div className="grid gap-4 sm:grid-cols-2">
        <ResourceSelector
          kind="user"
          label="Owner"
          value={ownerId}
          onChange={(next) => setOwnerId(String(next))}
          source={{ mode: "sync", items: resources }}
          variant="menu"
          showLabel
        />
        <ResourceSelector
          kind="member"
          label="Team members"
          selectionMode="multiple"
          value={memberIds}
          onChange={(next) => setMemberIds(Array.isArray(next) ? next : [next])}
          source={{ mode: "sync", items: resources }}
          variant="menu"
          showLabel
        />
        {/* Async single-select: debounced server search, min 1 char before loading. */}
        <ResourceSelector
          kind="oauth-client"
          label="OAuth client (async)"
          value={clientId}
          onChange={(next) => setClientId(String(next))}
          source={{ mode: "async", load: (query) => searchOauthClients(query) }}
          initialOptions={oauthClients.slice(0, 1)}
          minQueryLength={1}
          variant="menu"
          showLabel
        />
        {/* Async single-select starting empty: shows the "type to search" empty state. */}
        <ResourceSelector
          kind="user"
          label="Reviewer (async)"
          placeholder="Search people…"
          value={reviewerId}
          onChange={(next) => setReviewerId(String(next))}
          source={{ mode: "async", load: (query) => searchUsers(query) }}
          minQueryLength={1}
          variant="menu"
          showLabel
        />
        {/*
          Async paginated: opens with the first page already loaded, then keeps
          appending pages as you scroll the list (React Aria load-more sentinel).
          Typing filters server-side and resets to page 1.
        */}
        <ResourceSelector
          kind="user"
          label="Directory user (async paginated)"
          placeholder="Scroll to load more…"
          value={directoryId}
          onChange={(next) => setDirectoryId(String(next))}
          source={{ mode: "paginated", load: searchDirectoryPaginated }}
          variant="menu"
          showLabel
        />
      </div>
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
      />
      <RichTextEditor
        label="Rich text"
        name="body"
        value={document}
        onChange={setDocument}
        mediaLibrary={{
          load: async (query) => {
            const normalized = query.trim().toLowerCase();
            return mediaAssets.filter((asset) =>
              normalized
                ? `${asset.label} ${asset.alt}`
                    .toLowerCase()
                    .includes(normalized)
                : true,
            );
          },
          resolve: async (mediaId) =>
            mediaAssets.find((asset) => asset.id === mediaId) ?? null,
        }}
        postLibrary={{
          load: async (query) => {
            const normalized = query.trim().toLowerCase();
            return postReferences.filter((post) =>
              normalized
                ? `${post.label} ${post.href}`
                    .toLowerCase()
                    .includes(normalized)
                : true,
            );
          },
        }}
        onUploadMedia={(files) => {
          // The host app performs the real upload here; it returns the stored
          // asset's id plus a preview URL so the editor can show it live.
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
