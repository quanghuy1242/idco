/**
 * L1 object primitives (docs/015 §4.2): media figure, embed iframe, and post reference.
 * Pure and RSC-safe — these render the resolved/denormalized snapshot (a reference block
 * stores `{ ref, snapshot }`, docs/026), so the reader never calls the host. They keep
 * their Tailwind/DaisyUI chrome classes (these are object chrome the editor's resting
 * render already shares via the same primitive, not prose duplicated against the engine
 * CSS), and replace the `react-aria-components` link with a plain `<a>`.
 *
 * @categoryDefault L1 Objects
 */
import type { ReactNode } from "react";

/** Renders a media figure object: an image with an optional caption. */
export function RichTextMediaFigure({
  alt,
  caption,
  src,
}: {
  readonly alt?: string;
  readonly caption?: string;
  readonly src: string;
}): ReactNode {
  return (
    <figure className="m-0 overflow-hidden rounded-box border border-base-300 bg-base-200">
      <img
        alt={alt ?? ""}
        className="max-h-96 w-full object-contain"
        src={src}
      />
      {caption ? (
        <figcaption className="border-t border-base-300 px-3 py-2 text-sm text-base-content/60">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** Renders an embed object as a sandboxed, lazy-loaded `<iframe>`. */
export function RichTextEmbed({
  title,
  url,
}: {
  readonly title?: string;
  readonly url: string;
}): ReactNode {
  return (
    <figure className="m-0 overflow-hidden rounded-box border border-base-300 bg-base-200">
      <iframe
        className="aspect-video w-full"
        loading="lazy"
        // Send the origin (not the full URL): providers like YouTube reject the embed
        // ("Error 153") with no referrer to authorize the embedding domain.
        referrerPolicy="strict-origin-when-cross-origin"
        // `allow-same-origin` lets the third-party provider reach its own origin's
        // storage so its player initializes; paired with a cross-origin `src` it grants
        // access only to the provider's origin, never the host app's.
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
        src={url}
        title={title ?? "Embedded content"}
      />
    </figure>
  );
}

/** Renders a post reference object as a linked card, or a badge when it has no href. */
export function RichTextPostReference({
  href,
  label,
  postId,
}: {
  readonly href?: string;
  readonly label: string;
  readonly postId?: string;
}): ReactNode {
  if (!href) {
    return (
      <span className="badge" data-post-id={postId}>
        {label}
      </span>
    );
  }
  return (
    <a
      className="card card-border bg-base-100 transition hover:border-primary"
      data-post-id={postId}
      href={href}
    >
      <span className="card-body gap-1 p-4">
        <span className="text-xs font-semibold uppercase text-base-content/50">
          Read next
        </span>
        <span className="link link-primary">{label}</span>
      </span>
    </a>
  );
}
