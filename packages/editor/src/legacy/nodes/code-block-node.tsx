// DaisyUI 5: https://daisyui.com/components/mockup-code/

import { CodeEditor } from "@quanghuy1242/idco-ui";
import { normalizeCodeBlockNode } from "../model/normalize";
import { codeLanguageValue, stringValue } from "../model/schema";
import { CHROME_REVEAL, ChromeButton, ChromeSelect } from "./chrome";
import {
  defineDecoratorBlock,
  type DecoratorBlockProps,
} from "./decorator-block";

const codeLanguages = [
  { label: "TypeScript", value: "ts" },
  { label: "JavaScript", value: "js" },
  { label: "JSON", value: "json" },
  { label: "Python", value: "python" },
  { label: "TSX", value: "tsx" },
  { label: "Text", value: "text" },
] as const;

export const CodeBlockNode = defineDecoratorBlock({
  Editor: CodeBlockEditor,
  normalize: normalizeCodeBlockNode,
  type: "code-block",
});

function CodeBlockEditor({ node, update, remove }: DecoratorBlockProps) {
  const language = codeLanguageValue(node.language);

  // No BlockShell border/label: the code editor already reads as a panel, so
  // the chrome (language picker + remove) sits stuck to its top-right corner,
  // matching the lighter callout-style treatment.
  return (
    <div className="group/block relative">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <ChromeSelect
          label="Code language"
          value={language}
          options={codeLanguages}
          onChange={(value) => update({ language: value })}
        />
        <div className={CHROME_REVEAL}>
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
        onChange={(value) => update({ text: value })}
      />
    </div>
  );
}
