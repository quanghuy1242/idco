// Inline decorator: a glossary term. In the editor it is clickable to edit its
// term/definition (a popover); the definition also shows in a tooltip on hover.
/* eslint-disable no-underscore-dangle -- Lexical node subclasses use __ fields by convention. */

import { Input, TextArea, Tooltip } from "@quanghuy1242/idco-ui";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createTextNode,
  $getNodeByKey,
  DecoratorNode,
  type DOMExportOutput,
  type NodeKey,
  type SerializedLexicalNode,
} from "lexical";
import { useSelectionRestore } from "../hooks/use-selection-restore";
import type { Spread } from "lexical";
import { useState, type ReactNode } from "react";
import {
  Button as AriaButton,
  DialogTrigger as AriaDialogTrigger,
} from "react-aria-components";
import { EditorPopover } from "../toolbar/editor-popover";
import { FieldLabel } from "./base";

export type SerializedGlossaryNode = Spread<
  { term: string; definition: string },
  SerializedLexicalNode
>;

/**
 * An inline term whose definition appears in a React Aria tooltip on hover or
 * focus — a dictionary/footnote affordance. Because it is inline
 * (`isInline() => true`), the caret sits naturally before and after it within a
 * line of text. In editor mode it is clickable to edit its term/definition.
 */
export class GlossaryNode extends DecoratorNode<ReactNode> {
  __term: string;
  __definition: string;

  constructor(term: string, definition: string, key?: NodeKey) {
    super(key);
    this.__term = term;
    this.__definition = definition;
  }

  static getType(): string {
    return "glossary";
  }

  static clone(node: GlossaryNode): GlossaryNode {
    return new GlossaryNode(node.__term, node.__definition, node.__key);
  }

  static importJSON(serialized: SerializedGlossaryNode): GlossaryNode {
    return new GlossaryNode(serialized.term ?? "", serialized.definition ?? "");
  }

  exportJSON(): SerializedGlossaryNode {
    return {
      definition: this.__definition,
      term: this.__term,
      type: "glossary",
      version: 1,
    };
  }

  getTerm(): string {
    return this.getLatest().__term;
  }

  getDefinition(): string {
    return this.getLatest().__definition;
  }

  setTerm(term: string): void {
    this.getWritable().__term = term;
  }

  setDefinition(definition: string): void {
    this.getWritable().__definition = definition;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("abbr");
    element.textContent = this.__term;
    element.title = this.__definition;
    return { element };
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "inline";
    return span;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): true {
    return true;
  }

  getTextContent(): string {
    return this.__term;
  }

  decorate(): ReactNode {
    return (
      <GlossaryEditor
        nodeKey={this.__key}
        term={this.__term}
        definition={this.__definition}
      />
    );
  }
}

function GlossaryEditor({
  nodeKey,
  term,
  definition,
}: {
  readonly nodeKey: NodeKey;
  readonly term: string;
  readonly definition: string;
}) {
  const [editor] = useLexicalComposerContext();
  const [termDraft, setTermDraft] = useState(term);
  const [definitionDraft, setDefinitionDraft] = useState(definition);
  const { onOpen, onClose, markHandled } = useSelectionRestore();

  function syncDrafts() {
    setTermDraft(term);
    setDefinitionDraft(definition);
  }

  // Unwrap the glossary back to plain text so the word survives; only this
  // node's chrome is dropped, never the term itself.
  function unwrap(label: string) {
    const node = $getNodeByKey(nodeKey);
    if (node instanceof GlossaryNode) {
      node.replace($createTextNode(label || node.getTerm()));
    }
  }

  function apply(close: () => void) {
    const label = termDraft.trim();
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (!(node instanceof GlossaryNode)) return;
      if (label === "") {
        unwrap("");
        return;
      }
      node.setTerm(label);
      node.setDefinition(definitionDraft.trim());
    });
    markHandled();
    close();
    requestAnimationFrame(() => editor.focus());
  }

  function remove(close: () => void) {
    editor.update(() => {
      unwrap("");
    });
    markHandled();
    close();
    requestAnimationFrame(() => editor.focus());
  }

  return (
    <AriaDialogTrigger
      onOpenChange={(open) => {
        if (open) {
          onOpen();
          syncDrafts();
        } else {
          onClose();
        }
      }}
    >
      <Tooltip content={definition || term}>
        <AriaButton
          type="button"
          aria-label={`Edit glossary term ${term}`}
          className="cursor-pointer align-baseline font-medium text-base-content underline decoration-dotted decoration-base-content/40 underline-offset-2 outline-none focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-primary"
        >
          {term}
        </AriaButton>
      </Tooltip>
      <EditorPopover width="sm">
        {({ close }) => (
          <form
            className="grid gap-2 p-2"
            onSubmit={(event) => {
              event.preventDefault();
              apply(close);
            }}
          >
            <FieldLabel>Term</FieldLabel>
            <Input
              ariaLabel="Glossary term"
              autoFocus
              size="sm"
              value={termDraft}
              onChange={setTermDraft}
            />
            <FieldLabel>Definition</FieldLabel>
            <TextArea
              ariaLabel="Glossary definition"
              size="sm"
              rows={3}
              value={definitionDraft}
              onChange={setDefinitionDraft}
            />
            <div className="flex items-center justify-between gap-2">
              <AriaButton
                type="button"
                onPress={() => remove(close)}
                className="btn btn-sm btn-ghost text-error"
              >
                Remove
              </AriaButton>
              <AriaButton type="submit" className="btn btn-sm btn-primary">
                Save
              </AriaButton>
            </div>
          </form>
        )}
      </EditorPopover>
    </AriaDialogTrigger>
  );
}

export function $createGlossaryNode(
  term: string,
  definition: string,
): GlossaryNode {
  return new GlossaryNode(term, definition);
}
