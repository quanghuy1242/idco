"use client";

import {
  Badge,
  Button,
  Input,
  Stack,
  Text,
  Toolbar,
} from "@quanghuy1242/idco-ui";
import type {
  RichTextHeadingIndexEntry,
  RichTextSearchResult,
} from "./indexes";

export type LargeDocumentDiagnostics = {
  readonly activeSectionId: string | null;
  readonly blockCount: number;
  readonly measuredHeightCount: number;
  readonly renderedSectionCount: number;
  readonly sectionCount: number;
};

export function LargeDocumentToolbar({
  diagnostics,
  headings,
  onHeadingSelect,
  onQueryChange,
  onResultSelect,
  query,
  results,
}: {
  readonly diagnostics: LargeDocumentDiagnostics;
  readonly headings: readonly RichTextHeadingIndexEntry[];
  readonly onHeadingSelect: (heading: RichTextHeadingIndexEntry) => void;
  readonly onQueryChange: (query: string) => void;
  readonly onResultSelect: (result: RichTextSearchResult) => void;
  readonly query: string;
  readonly results: readonly RichTextSearchResult[];
}) {
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-3">
      <Stack gap="sm">
        <Toolbar align="start">
          <div className="min-w-64 flex-1">
            <Input
              ariaLabel="Search document"
              placeholder="Search document"
              size="sm"
              value={query}
              onChange={onQueryChange}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{diagnostics.blockCount} blocks</Badge>
            <Badge>{diagnostics.sectionCount} sections</Badge>
            <Badge>{diagnostics.renderedSectionCount} rendered</Badge>
            <Badge>{diagnostics.measuredHeightCount} measured</Badge>
          </div>
        </Toolbar>
        {query.trim() ? (
          <div className="rounded-box bg-base-200 p-2">
            <Text variant="caption">
              {results.length} search{" "}
              {results.length === 1 ? "result" : "results"}
            </Text>
            <div className="mt-2 flex flex-col gap-1">
              {results.slice(0, 8).map((result, index) => (
                <Button
                  key={`${result.sectionId}-${result.path}-${index}`}
                  size="sm"
                  variant="ghost"
                  onClick={() => onResultSelect(result)}
                >
                  {result.preview}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex max-h-32 flex-wrap gap-1 overflow-auto">
          {headings.slice(0, 24).map((heading) => (
            <Button
              key={`${heading.sectionId}-${heading.path}`}
              size="sm"
              variant="ghost"
              onClick={() => onHeadingSelect(heading)}
            >
              {heading.text}
            </Button>
          ))}
        </div>
      </Stack>
    </div>
  );
}
