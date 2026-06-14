// DaisyUI 5: https://daisyui.com/components/mockup-code/
/* eslint-disable no-underscore-dangle -- Lexical node subclasses use __ fields by convention. */

import { CodeEditor } from "@quanghuy1242/idco-ui";
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
import { ChromeButton, ChromeSelect } from "./chrome";

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

  // No BlockShell border/label: the code editor already reads as a panel, so
  // the chrome (language picker + remove) sits stuck to its top-right corner,
  // matching the lighter callout-style treatment.
  return (
    <div className="group/code relative">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <ChromeSelect
          label="Code language"
          value={language}
          options={codeLanguages}
          onChange={(value) => updateNode({ language: value })}
        />
        <div className="opacity-0 transition-opacity group-hover/code:opacity-100 group-focus-within/code:opacity-100">
          <ChromeButton
            icon="X"
            label="Remove code"
            intent="danger"
            onPress={remove}
          />
        </div>
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
