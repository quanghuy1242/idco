import { useState } from "react";
import type { Story, StoryDefault } from "@ladle/react";
import {
  Button,
  FilterDropdown,
  Inline,
  InlineTextFilter,
  Menu,
  MenuItem,
  MenuTrigger,
  Panel,
  SearchInput,
  Stack,
} from "../packages/ui/src/index";

export default {
  title: "List toolbar",
} satisfies StoryDefault;

/**
 * Mirrors the content-api collection-list toolbar: a grown search box plus
 * inline text filters and the saved-view dropdown, all at size `sm` so every
 * control shares one height (the consistency bug this story guards).
 */
export const PostsToolbar: Story = () => {
  const [search, setSearch] = useState("");
  const [slug, setSlug] = useState("");
  const [view, setView] = useState("");
  return (
    <div style={{ maxWidth: 880 }}>
      <Panel padding="sm">
        <Stack gap="sm">
          <Inline gap="sm" align="center" wrap>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search title"
              size="sm"
              grow
            />
            <Inline gap="sm" align="center" wrap>
              <InlineTextFilter
                label="Slug"
                size="sm"
                value={slug}
                onChange={setSlug}
              />
            </Inline>
            <Inline gap="xs" align="center">
              <FilterDropdown
                label="View"
                size="sm"
                options={[
                  { label: "Current filters", value: "" },
                  { label: "Published", value: "published" },
                ]}
                value={view}
                onChange={setView}
              />
              <MenuTrigger>
                <Button
                  variant="ghost"
                  size="sm"
                  iconName="Ellipsis"
                  ariaLabel="Saved view actions"
                />
                <Menu onAction={() => {}}>
                  <MenuItem id="save">Save current filters…</MenuItem>
                  <MenuItem id="delete">Delete selected view</MenuItem>
                </Menu>
              </MenuTrigger>
            </Inline>
          </Inline>
        </Stack>
      </Panel>
    </div>
  );
};
