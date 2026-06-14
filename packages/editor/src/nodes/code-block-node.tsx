// DaisyUI 5: https://daisyui.com/components/mockup-code/
/* eslint-disable no-underscore-dangle -- Lexical node subclasses use __ fields by convention. */

import {
  CodeEditor,
  Menu,
  MenuItem,
  MenuTrigger,
  NavIcon,
} from "@quanghuy1242/idco-ui";
import type { ElementFormatType, NodeKey } from "lexical";
import { normalizeCodeBlockNode } from "../model/normalize";
import {
  codeLanguageValue,
  stringValue,
  type RichTextEditorNode,
} from "../model/schema";
import {
  RichTextDecoratorBlockNode,
  useDecoratorNodeUpdater,
  useRemoveNode,
  type SerializedRichTextDecoratorNode,
} from "./base";
import { Button as AriaButton } from "react-aria-components";

const codeLanguages = [
  { label: "TypeScript", value: "ts" },
  { label: "JavaScript", value: "js" },
  { label: "JSON", value: "json" },
  { label: "Python", value: "python" },
  { label: "TSX", value: "tsx" },
  { label: "Text", value: "text" },
] as const;

export class CodeBlockNode extends RichTextDecoratorBlockNode {
  static getType(): string {
    return "code-block";
  }

  static clone(node: CodeBlockNode): CodeBlockNode {
    return new CodeBlockNode(node.__data, node.__format, node.__key);
  }

  static importJSON(serializedNode: SerializedRichTextDecoratorNode) {
    return new CodeBlockNode(
      normalizeCodeBlockNode(serializedNode),
      (serializedNode.format as ElementFormatType) || "",
    );
  }

  decorate() {
    return <CodeBlockEditor nodeKey={this.__key} node={this.getData()} />;
  }
}

function CodeBlockEditor({
  node,
  nodeKey,
}: {
  readonly node: RichTextEditorNode;
  readonly nodeKey: NodeKey;
}) {
  const updateNode = useDecoratorNodeUpdater(nodeKey);
  const remove = useRemoveNode(nodeKey);
  const language = codeLanguageValue(node.language);
  const languageLabel =
    codeLanguages.find((option) => option.value === language)?.label ??
    language;

  // No BlockShell border/label: the code editor already reads as a panel, so
  // the chrome (language picker + remove) sits stuck to its top-right corner,
  // matching the lighter callout-style treatment.
  return (
    <div className="group/code relative">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <MenuTrigger>
          <AriaButton
            aria-label="Code language"
            className="flex items-center gap-1 rounded-full border border-base-300 bg-base-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-base-content/70 shadow-sm transition hover:text-base-content"
          >
            {languageLabel}
            <NavIcon name="ChevronDown" variant="timeline" />
          </AriaButton>
          <Menu aria-label="Code language" className="w-40">
            {codeLanguages.map((option) => (
              <MenuItem
                key={option.value}
                id={option.value}
                label={option.label}
                onAction={() => updateNode({ language: option.value })}
              />
            ))}
          </Menu>
        </MenuTrigger>
        <AriaButton
          type="button"
          aria-label="Remove code"
          onPress={remove}
          className="grid size-6 place-items-center rounded-full border border-base-300 bg-base-100 text-base-content/60 opacity-0 shadow-sm transition hover:text-error group-hover/code:opacity-100 group-focus-within/code:opacity-100"
        >
          <NavIcon name="X" variant="timeline" />
        </AriaButton>
      </div>
      <CodeEditor
        label="Code content"
        srOnlyLabel
        value={stringValue(node.text) ?? ""}
        language={language}
        maxHeight="lg"
        onChange={(value) => updateNode({ text: value })}
      />
    </div>
  );
}
