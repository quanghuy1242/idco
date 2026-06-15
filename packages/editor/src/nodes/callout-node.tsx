// DaisyUI 5: https://daisyui.com/components/alert/

import { Alert, type AlertTone } from "@quanghuy1242/idco-ui";
import { useEffect, useRef } from "react";
import { childText, normalizeCalloutNode } from "../model/normalize";
import { calloutToneValue } from "../model/schema";
import { BlockShell } from "./base";
import { type ChromeSelectOption, ChromeSelect } from "./chrome";
import {
  defineDecoratorBlock,
  type DecoratorBlockProps,
} from "./decorator-block";

const calloutToneOptions: readonly ChromeSelectOption<AlertTone>[] = [
  { icon: "Info", iconClassName: "text-info", label: "Info", value: "info" },
  {
    icon: "Check",
    iconClassName: "text-success",
    label: "Success",
    value: "success",
  },
  {
    icon: "TriangleAlert",
    iconClassName: "text-warning",
    label: "Warning",
    value: "warning",
  },
  {
    icon: "CircleAlert",
    iconClassName: "text-error",
    label: "Error",
    value: "error",
  },
];

const calloutBadgeIcon: Record<AlertTone, string> = {
  info: "Info",
  success: "Check",
  warning: "TriangleAlert",
  error: "CircleAlert",
};

export const CalloutNode = defineDecoratorBlock({
  Editor: CalloutEditor,
  normalize: normalizeCalloutNode,
  type: "callout",
});

function CalloutEditor({ node, nodeKey, update }: DecoratorBlockProps) {
  const tone = calloutToneValue(node.tone);
  const text = childText(node);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  return (
    <BlockShell
      actions={
        <ChromeSelect
          label="Callout tone"
          value={tone}
          options={calloutToneOptions}
          onChange={(value) => update({ tone: value })}
          menuClassName="w-40"
          triggerIcon="Settings"
        />
      }
      icon={calloutBadgeIcon[tone]}
      label="Callout"
      nodeKey={nodeKey}
      padded={false}
    >
      <Alert tone={tone}>
        <textarea
          ref={textareaRef}
          aria-label="Callout text"
          className="block w-full min-w-0 resize-none overflow-hidden bg-transparent text-sm leading-6 outline-none placeholder:opacity-60"
          placeholder="Write a callout…"
          rows={1}
          value={text}
          onChange={(event) =>
            update({ children: [{ text: event.target.value, type: "text" }] })
          }
        />
      </Alert>
    </BlockShell>
  );
}
