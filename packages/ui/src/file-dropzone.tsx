// DaisyUI 5: https://daisyui.com/components/file-input/
"use client";

import { useState } from "react";
import { DropZone, FileTrigger, Text } from "react-aria-components";
import { Button } from "./button";

type FileDropzoneProps = {
  readonly label: string;
  readonly accept?: ReadonlyArray<string>;
  readonly onFiles: (files: File[]) => void;
  readonly multiple?: boolean;
  readonly maxSizeBytes?: number;
  readonly hint?: string;
};

function matchesAccept(file: File, accept?: ReadonlyArray<string>): boolean {
  if (!accept || accept.length === 0) return true;
  return accept.some((a) => {
    if (a.startsWith("."))
      return file.name.toLowerCase().endsWith(a.toLowerCase());
    if (a.endsWith("/*")) return file.type.startsWith(a.slice(0, -1));
    return file.type === a;
  });
}

export function FileDropzone({
  label,
  accept,
  onFiles,
  multiple,
  maxSizeBytes,
  hint,
}: FileDropzoneProps) {
  const [rejected, setRejected] = useState<string | undefined>(undefined);

  function acceptFiles(files: File[]) {
    const tooBig =
      maxSizeBytes !== undefined && files.some((f) => f.size > maxSizeBytes);
    const wrongType = files.some((f) => !matchesAccept(f, accept));
    if (tooBig) {
      setRejected("Some files exceed the maximum size.");
      return;
    }
    if (wrongType) {
      setRejected("Some files have an unsupported type.");
      return;
    }
    setRejected(undefined);
    onFiles(multiple ? files : files.slice(0, 1));
  }

  async function handleDrop(
    items: { kind: string; getFile: () => Promise<File> }[],
  ) {
    const files = await Promise.all(
      items.filter((i) => i.kind === "file").map((i) => i.getFile()),
    );
    if (files.length > 0) acceptFiles(files);
  }

  return (
    <div className="form-control w-full">
      <span className="label-text mb-1 text-base font-medium text-base-content">
        {label}
      </span>
      <DropZone
        aria-label={label}
        onDrop={(e) => void handleDrop(e.items as never[])}
        className="flex flex-col items-center justify-center gap-2 rounded-box border-2 border-dashed border-base-300 bg-base-100 px-6 py-8 text-center data-[drop-target]:border-primary data-[drop-target]:bg-primary/5"
      >
        <Text slot="label" className="text-sm text-base-content/70">
          Drag &amp; drop {multiple ? "files" : "a file"} here
        </Text>
        <FileTrigger
          acceptedFileTypes={accept ? [...accept] : undefined}
          allowsMultiple={multiple}
          onSelect={(fileList) => {
            if (fileList) acceptFiles(Array.from(fileList));
          }}
        >
          <Button variant="secondary" size="sm">
            Browse files
          </Button>
        </FileTrigger>
        {hint ? (
          <span className="text-xs text-base-content/50">{hint}</span>
        ) : null}
      </DropZone>
      {rejected ? (
        <span role="alert" className="label-text-alt mt-1 text-error">
          {rejected}
        </span>
      ) : null}
    </div>
  );
}
