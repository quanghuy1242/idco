// DaisyUI 5: https://daisyui.com/components/alert/
/* eslint-disable no-underscore-dangle -- Lexical node subclasses use __ fields by convention. */

import {
  Alert,
  Menu,
  MenuItem,
  MenuTrigger,
  NavIcon,
  type AlertTone,
} from "@quanghuy1242/idco-ui";
import type { ElementFormatType, NodeKey } from "lexical";
import { useEffect, useRef } from "react";
import { childText, normalizeCalloutNode } from "../model/normalize";
import { calloutToneValue, type RichTextEditorNode } from "../model/schema";
import {
  BlockShell,
  RichTextDecoratorBlockNode,
  useDecoratorNodeUpdater,
  type SerializedRichTextDecoratorNode,
} from "./base";
import { ChromeButton } from "./chrome";

const calloutTones: readonly {
  readonly value: AlertTone;
  readonly label: string;
  readonly icon: string;
  readonly text: string;
}[] = [
  { icon: "Info", label: "Info", text: "text-info", value: "info" },
  { icon: "Check", label: "Success", text: "text-success", value: "success" },
  {
    icon: "TriangleAlert",
    label: "Warning",
    text: "text-warning",
    value: "warning",
  },
  { icon: "CircleAlert", label: "Error", text: "text-error", value: "error" },
];

const calloutBadgeIcon: Record<AlertTone, string> = {
  info: "Info",
  success: "Check",
  warning: "TriangleAlert",
  error: "CircleAlert",
};

export class CalloutNode extends RichTextDecoratorBlockNode {
  static getType(): string {
    return "callout";
  }

  static clone(node: CalloutNode): CalloutNode {
    return new CalloutNode(node.__data, node.__format, node.__key);
  }

  static importJSON(serializedNode: SerializedRichTextDecoratorNode) {
    return new CalloutNode(
      normalizeCalloutNode(serializedNode),
      (serializedNode.format as ElementFormatType) || "",
    );
  }

  decorate() {
    return <CalloutEditor nodeKey={this.__key} node={this.getData()} />;
  }
}

function CalloutEditor({
  node,
  nodeKey,
}: {
  readonly node: RichTextEditorNode;
  readonly nodeKey: NodeKey;
}) {
  const updateNode = useDecoratorNodeUpdater(nodeKey);
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
        <MenuTrigger>
          <ChromeButton icon="Settings" label="Callout tone" />
          <Menu aria-label="Callout tone" className="w-40">
            {calloutTones.map((option) => (
              <MenuItem
                key={option.value}
                id={option.value}
                textValue={option.label}
                onAction={() => updateNode({ tone: option.value })}
              >
                <span className="flex items-center gap-2">
                  <span className={option.text}>
                    <NavIcon name={option.icon} />
                  </span>
                  {option.label}
                </span>
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
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
            updateNode({
              children: [{ text: event.target.value, type: "text" }],
            })
          }
        />
      </Alert>
    </BlockShell>
  );
}
