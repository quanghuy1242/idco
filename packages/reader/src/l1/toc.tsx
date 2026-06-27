/**
 * L1 table-of-contents, checklist, and layout primitives (docs/015 §4.2). Pure and
 * RSC-safe. The static visuals live here; the *behavior* (scroll-spy active-section
 * highlight, the checklist toggle) is an L3 island that hydrates over this markup
 * (docs/015 §6). The sticky rail is pure CSS (`lg:sticky`), so it stays L1; only the
 * active-highlight needs the client.
 *
 * @categoryDefault Typography
 */
import type { ReactNode } from "react";
import type {
  RichTextTableOfContentsEntry,
  RichTextTableOfContentsStyle,
  RichTextTocSide,
} from "./types";
import { ScrollTextGlyph } from "./icons";

type RichTextChildrenProps = { readonly children?: ReactNode };

// Margin (not padding): `menu` owns the anchor's `padding-inline`, so depth indents with
// `margin-inline-start` to avoid fighting it.
const tocDepthClass: Record<number, string> = {
  0: "",
  1: "ms-6",
  2: "ms-12",
  3: "ms-18",
  4: "ms-24",
  5: "ms-30",
};

/** Renders a static table of contents as a nested, optionally-numbered list of heading anchors. */
export function RichTextTableOfContents({
  entries,
  style = "plain",
  title = "Table of contents",
}: {
  readonly entries: readonly RichTextTableOfContentsEntry[];
  readonly style?: RichTextTableOfContentsStyle;
  readonly title?: string;
}) {
  const hasNumbers = entries.some((entry) => Boolean(entry.number));
  const body = (
    <>
      <div className="flex items-center gap-2 text-sm font-semibold text-base-content">
        <ScrollTextGlyph />
        {title}
      </div>
      {entries.length > 0 ? (
        <ul
          className={`menu w-full p-0 ${style === "compact" ? "text-xs" : "text-sm"}`}
          data-rt-toc=""
        >
          {entries.map((entry) => (
            <li key={entry.id}>
              <a
                aria-label={
                  entry.number ? `${entry.number} ${entry.text}` : entry.text
                }
                className={[
                  "items-baseline",
                  tocDepthClass[Math.min(entry.depth ?? 0, 5)] ?? "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-rt-toc-link={entry.id}
                href={entry.href}
              >
                {hasNumbers ? (
                  <span className="min-w-9 text-right font-mono text-xs tabular-nums text-base-content/50">
                    {entry.number ?? ""}
                  </span>
                ) : null}
                <span
                  className={`min-w-0 ${style === "compact" ? "truncate" : "line-clamp-3"}`}
                >
                  {entry.text}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-sm text-base-content/60">
          No headings in this document.
        </p>
      )}
    </>
  );

  if (style === "plain") {
    return (
      <nav aria-label={title} className="my-3 grid gap-2">
        {body}
      </nav>
    );
  }
  if (style === "compact") {
    return (
      <nav
        aria-label={title}
        className="my-2 rounded-box border border-base-300 bg-base-100 p-3"
      >
        <div className="grid gap-1.5">{body}</div>
      </nav>
    );
  }
  return (
    <nav
      aria-label={title}
      className="card my-3 border border-base-300 bg-base-100"
    >
      <div className="card-body gap-2 p-4">{body}</div>
    </nav>
  );
}

/**
 * Sticky side rail for an `aside`-placed TOC. Hidden below `lg`; at `lg`+ it pins to the
 * top via pure CSS (`lg:sticky`). Presentational only — the active-section highlight is
 * the scroll-spy island (docs/015 §6).
 */
export function RichTextTocRail({
  entries,
  title = "Table of contents",
  style = "compact",
  top = "1rem",
}: {
  readonly entries: readonly RichTextTableOfContentsEntry[];
  readonly title?: string;
  readonly style?: RichTextTableOfContentsStyle;
  readonly top?: string;
}) {
  return (
    <aside className="hidden lg:block">
      <div className="lg:sticky [&>nav]:my-0" style={{ top }}>
        <RichTextTableOfContents
          entries={entries}
          style={style}
          title={title}
        />
      </div>
    </aside>
  );
}

/** Side-aware responsive shell that reserves a column for a TOC rail. */
export function RichTextTocLayout({
  children,
  rail,
  side = "left",
}: {
  readonly children: ReactNode;
  readonly rail?: ReactNode;
  readonly side?: RichTextTocSide;
}) {
  if (!rail) return <>{children}</>;
  const columns =
    side === "right"
      ? "lg:grid-cols-[minmax(0,1fr)_16rem]"
      : "lg:grid-cols-[16rem_minmax(0,1fr)]";
  return (
    <div className={`lg:grid ${columns} lg:gap-6`}>
      {side === "left" ? rail : null}
      {children}
      {side === "right" ? rail : null}
    </div>
  );
}

/** Renders a checklist container as a `<ul data-rt-checklist>` the checklist island hydrates over. */
export function RichTextCheckList({ children }: RichTextChildrenProps) {
  return (
    <ul className="rt-block m-0 ml-1 list-none space-y-1" data-rt-checklist="">
      {children}
    </ul>
  );
}

/**
 * The static checklist item. The checkbox is `readOnly` and inert by default; the toggle
 * behavior is the checklist island, which hydrates over this exact markup (docs/015 §6).
 */
export function RichTextCheckListItem({
  checked,
  children,
}: RichTextChildrenProps & { readonly checked?: boolean }) {
  return (
    <li className="flex items-start gap-2" data-rt-checklist-item="">
      {/* A real read-only checkbox (not `aria-hidden`): the static, zero-JS reader still
          conveys checked/unchecked to assistive tech. Out of tab order (it is inert until
          the checklist island activates), but present in the accessibility tree. */}
      <input
        checked={Boolean(checked)}
        className="checkbox checkbox-sm mt-0.5"
        readOnly
        tabIndex={-1}
        type="checkbox"
      />
      <span className={checked ? "text-base-content/60 line-through" : ""}>
        {children}
      </span>
    </li>
  );
}
