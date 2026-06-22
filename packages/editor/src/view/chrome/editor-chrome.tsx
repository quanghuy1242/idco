/**
 * Editor chrome: the formatting toolbar, block-type and insert menus, and the
 * link editor (docs/010 Phase 8 AC2/AC9).
 *
 * Built with `@idco/ui` (React Aria behavior + DaisyUI styling + lucide icons),
 * per docs/010 §7.1 — no hand-rolled menus, icon controls for the format/insert
 * actions, and a labeled block-type dropdown (icon + current style name + chevron)
 * matching the legacy Lexical toolbar's shape.
 * Every control operates on the engine's *model* selection through
 * `store.command`/`store.query`, never the DOM: a toggle reads `is-mark-active`
 * and dispatches `toggle-mark`; the block-type menu dispatches `set-block-type`;
 * the insert menu dispatches `insert-object` for each registered node's `insert`
 * affordance (docs/016 §6.2).
 *
 * Focus integration (docs/017 §3.5/§3.6): the engine owns focus via the EditContext host
 * and the model selection survives focus loss (011 §8.6), so toolbar presses do
 * not blur the editing surface (a capture-phase `mousedown` preventDefault on the
 * bar), and after a command we return focus to the block the selection now names
 * via `focusEditor`.
 */
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { Button as AriaButton } from "react-aria-components";
import {
  Button,
  Input,
  Menu,
  MenuItem,
  MenuTrigger,
  NavIcon,
  PopoverTrigger,
} from "@quanghuy1242/idco-ui";
import type { EditorStore } from "../../core";
import { listInsertableNodes } from "../spi";
import { listInsertableStructuralNodes } from "../spi";
import { listMarks } from "../spi";
import { listBlockTypes } from "../spi";
import { listToggleCommand } from "./chrome-commands";

// The format marks and block types are read from the W4/W5 registries
// (`listMarks().filter((m) => m.toolbar)` and `listBlockTypes().filter((b) =>
// b.chooser)`), so the toolbar and the context menu can no longer drift — both
// read the one source, and adding a mark/block type is one registration.

/**
 * Subscribe a component to selection + commit so toolbar query state stays live.
 * A hook-local counter is the snapshot: the store has no global revision and the
 * commit hot path must not gain one, so the subscription bumps the counter here.
 */
function useToolbarVersion(store: EditorStore): number {
  const versionRef = useRef(0);
  return useSyncExternalStore(
    (listener) => {
      const bump = () => {
        versionRef.current += 1;
        listener();
      };
      const offSel = store.subscribeSelection(bump);
      const offCommit = store.subscribeCommit(() => bump());
      return () => {
        offSel();
        offCommit();
      };
    },
    () => versionRef.current,
    () => 0,
  );
}

/** A thin divider between toolbar groups. */
function Sep() {
  return <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-base-300" />;
}

export function EditorToolbar(props: {
  readonly store: EditorStore;
  readonly focusEditor: () => void;
  /** Open the find card (wired to the same Ctrl/Cmd+F controller). */
  readonly onFind?: () => void;
  readonly className?: string;
}) {
  const { store, focusEditor, onFind } = props;
  // Re-read query state whenever selection or content changes.
  useToolbarVersion(store);
  // Format buttons + block-type chooser come from the registries (W6), so they
  // cannot drift from the context menu, which reads the same source.
  const formatMarks = listMarks().filter((mark) => mark.toolbar);
  const blockTypes = listBlockTypes().filter((entry) => entry.chooser);
  const [linkValue, setLinkValue] = useState("");

  const run = useCallback(
    (action: () => void) => {
      action();
      focusEditor();
    },
    [focusEditor],
  );

  // Seed the link input from the active link when the popover opens; return focus
  // to the editing surface when it closes (React Aria would otherwise restore
  // focus to the trigger button, docs/017 §3.5).
  const onLinkOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        const current = store.query({ type: "active-link-href" });
        setLinkValue(typeof current === "string" ? current : "");
      } else {
        requestAnimationFrame(() => focusEditor());
      }
    },
    [focusEditor, store],
  );

  const applyLink = useCallback(() => {
    const href = linkValue.trim();
    if (href.length > 0) store.command({ href, type: "set-link" });
    else store.command({ type: "clear-link" });
  }, [linkValue, store]);

  // The insert menu unifies structural inserts (callout) and object inserts
  // (code/media/…) into one enumeration (docs/020 §7.1): structural first (so the
  // callout stays first as before), then object nodes in registration order. Each
  // entry carries its own dispatch so the menu keeps no per-type knowledge.
  const insertEntries: readonly {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
    readonly run: () => void;
  }[] = [
    ...listInsertableStructuralNodes().map((view) => ({
      icon: view.insert.icon ?? "Plus",
      id: view.type,
      label: view.insert.label,
      run: () => run(() => store.command(view.insert.createCommand())),
    })),
    ...listInsertableNodes().map((view) => ({
      icon: view.insert.icon ?? "Plus",
      id: view.type,
      label: view.insert.label,
      run: () =>
        run(() =>
          store.command({
            data: view.insert.createData(),
            objectType: view.type,
            type: "insert-object",
          }),
        ),
    })),
  ];
  const linkActive =
    typeof store.query({ type: "active-link-href" }) === "string";
  // The list control is a toggle: pressing it on a non-list block makes it a
  // list item, and pressing it again on a list item returns it to a paragraph
  // (a one-way `set-block-type` to listitem could turn lists on but never off).
  const blockType = store.query({ type: "current-block-type" });
  const listActive = blockType === "listitem";
  // The list flavour of the current item (null when not a list): a bulleted item
  // reads as "bullet", a numbered item as "number" (docs/018 §2.10). Each list
  // button is an independent toggle on its own flavour.
  const listType = store.query({ type: "current-list-type" });
  const bulletActive = listType !== null && listType !== "number";
  const numberActive = listType === "number";
  // The block-type control shows the *current* style by name (a labeled dropdown
  // like the legacy editor), not a generic icon. Heading level rides on the `tag`
  // attr, so match on both type and tag to tell Heading 1/2/3 apart.
  const focusNode =
    store.selection?.type === "text"
      ? store.getNode(store.selection.focus.node)
      : null;
  const currentTag =
    focusNode?.kind === "text" && typeof focusNode.attrs?.tag === "string"
      ? focusNode.attrs.tag
      : undefined;
  const currentBlock =
    blockTypes.find(
      (choice) =>
        choice.blockType === blockType &&
        (choice.tag ?? undefined) === currentTag,
    ) ??
    (listActive
      ? { icon: "List", label: "List item" }
      : { icon: "Pilcrow", label: "Paragraph" });

  return (
    <div
      aria-label="Formatting toolbar"
      className={`flex flex-wrap items-center gap-0.5 border-b border-base-300 bg-base-100 p-1 ${props.className ?? ""}`}
      data-engine-toolbar=""
      // Pressing a toolbar control must not blur the editing host; model
      // selection survives focus loss, and we restore focus after the command.
      onMouseDownCapture={(event) => event.preventDefault()}
      role="toolbar"
    >
      <Button
        ariaLabel="Undo"
        disabled={!store.canUndo}
        iconName="Undo2"
        onClick={() => run(() => store.undo())}
        size="sm"
        square
        tooltip="Undo"
        variant="ghost"
      />
      <Button
        ariaLabel="Redo"
        disabled={!store.canRedo}
        iconName="Redo2"
        onClick={() => run(() => store.redo())}
        size="sm"
        square
        tooltip="Redo"
        variant="ghost"
      />

      <Sep />

      <span data-engine-block-type-menu="">
        <MenuTrigger placement="bottom start">
          {/* Labeled block-type dropdown (icon + current style name + chevron),
              matching the legacy toolbar — not an icon-only button. */}
          <AriaButton
            aria-label="Text style"
            className="btn btn-sm btn-ghost w-40 justify-start gap-2"
            data-engine-block-type-trigger=""
            onMouseDown={(event) => event.preventDefault()}
          >
            <NavIcon name={currentBlock.icon} />
            <span className="flex-1 truncate text-left">
              {currentBlock.label}
            </span>
            <NavIcon name="ChevronDown" />
          </AriaButton>
          <Menu
            className="w-56"
            onAction={(key) => {
              // Keyed by the registry's stable `blockType:tag` id, so order in
              // the registry never changes what an item does.
              const choice = blockTypes.find((c) => c.id === key);
              if (choice) {
                run(() =>
                  store.command({
                    blockType: choice.blockType,
                    ...(choice.tag ? { tag: choice.tag } : {}),
                    type: "set-block-type",
                  }),
                );
              }
            }}
          >
            {blockTypes.map((choice) => (
              <MenuItem id={choice.id} key={choice.id} textValue={choice.label}>
                {/* Each item previews its own style (Heading 1 large + bold, …),
                    the legacy block-style menu's look. */}
                <span className="flex items-center gap-3">
                  <NavIcon name={choice.icon} />
                  <span className={`leading-tight ${choice.preview}`}>
                    {choice.label}
                  </span>
                </span>
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
      </span>

      <Sep />

      {formatMarks.map((format) => {
        const active = store.query({
          mark: format.kind,
          type: "is-mark-active",
        });
        return (
          <span
            data-engine-format={format.kind}
            data-engine-format-active={active ? "true" : "false"}
            key={format.kind}
          >
            <Button
              ariaLabel={format.toolbar!.label}
              iconName={format.toolbar!.icon}
              onClick={() =>
                run(() =>
                  store.command({ mark: format.kind, type: "toggle-mark" }),
                )
              }
              size="sm"
              square
              tooltip={format.toolbar!.label}
              variant={active ? "primary" : "ghost"}
            />
          </span>
        );
      })}

      <Sep />

      <Button
        ariaLabel="Bulleted list"
        iconName="List"
        onClick={() =>
          run(() => store.command(listToggleCommand(bulletActive, "bullet")))
        }
        size="sm"
        square
        tooltip="Bulleted list"
        variant={bulletActive ? "primary" : "ghost"}
      />
      <Button
        ariaLabel="Numbered list"
        iconName="ListOrdered"
        onClick={() =>
          run(() => store.command(listToggleCommand(numberActive, "number")))
        }
        size="sm"
        square
        tooltip="Numbered list"
        variant={numberActive ? "primary" : "ghost"}
      />
      <Button
        ariaLabel="Outdent"
        iconName="IndentDecrease"
        onClick={() => run(() => store.command({ type: "outdent" }))}
        size="sm"
        square
        tooltip="Outdent"
        variant="ghost"
      />
      <Button
        ariaLabel="Indent"
        iconName="IndentIncrease"
        onClick={() => run(() => store.command({ type: "indent" }))}
        size="sm"
        square
        tooltip="Indent"
        variant="ghost"
      />

      <Sep />

      <span data-engine-link-control="">
        <PopoverTrigger
          ariaLabel="Link editor"
          onOpenChange={onLinkOpenChange}
          trigger={
            <Button
              ariaLabel={linkActive ? "Edit link" : "Link"}
              iconName={linkActive ? "Unlink" : "Link"}
              size="sm"
              square
              tooltip="Link"
              variant={linkActive ? "primary" : "ghost"}
            />
          }
        >
          {(close) => (
            <form
              className="grid w-64 gap-2"
              data-engine-link-editor=""
              onSubmit={(event) => {
                event.preventDefault();
                applyLink();
                close();
              }}
            >
              <span className="text-xs font-medium opacity-70">Link URL</span>
              <Input
                ariaLabel="Link URL"
                autoFocus
                onChange={setLinkValue}
                placeholder="https://example.com"
                size="sm"
                type="url"
                value={linkValue}
              />
              <div className="flex items-center justify-end gap-2">
                {linkActive ? (
                  <Button
                    ariaLabel="Remove link"
                    onClick={() => {
                      store.command({ type: "clear-link" });
                      close();
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    Remove
                  </Button>
                ) : null}
                <Button
                  ariaLabel="Apply link"
                  size="sm"
                  type="submit"
                  variant="primary"
                >
                  Apply
                </Button>
              </div>
            </form>
          )}
        </PopoverTrigger>
      </span>

      {/* The insert menu carries structural inserts (callout) and registered
          object nodes (code/media/embed/…) from one unified enumeration. */}
      <Sep />
      <span data-engine-insert-menu="">
        <MenuTrigger>
          <Button
            ariaLabel="Insert block"
            iconName="Plus"
            size="sm"
            square
            tooltip="Insert"
            variant="ghost"
          />
          <Menu
            onAction={(key) => {
              insertEntries.find((entry) => entry.id === key)?.run();
            }}
          >
            {insertEntries.map((entry) => (
              <MenuItem id={entry.id} key={entry.id} textValue={entry.label}>
                <NavIcon name={entry.icon} />
                {entry.label}
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
      </span>

      {onFind ? (
        <>
          <Sep />
          <Button
            ariaLabel="Find in document"
            iconName="Search"
            onClick={onFind}
            size="sm"
            square
            tooltip="Find (Ctrl/Cmd+F)"
            variant="ghost"
          />
        </>
      ) : null}
    </div>
  );
}
