// DaisyUI 5: https://daisyui.com/components/avatar/
/**
 * Renders a circular user avatar from an image or fallback initials.
 *
 * @categoryDefault Data Display
 */

/** Diameter preset for an avatar, from extra-small to large. */
export type AvatarSize = "xs" | "sm" | "md" | "lg";

const sizeMap: Record<AvatarSize, string> = {
  xs: "w-5",
  sm: "w-7",
  md: "w-10",
  lg: "w-14",
};

const textSizeMap: Record<AvatarSize, string> = {
  xs: "text-[0.5rem]",
  sm: "text-xs",
  md: "text-sm",
  lg: "text-lg",
};

/** Props for {@link Avatar}. */
type AvatarProps = {
  /** Fallback text shown when no image is given; first two characters are used. */
  readonly initials?: string;
  /** Image source URL; when present it replaces the initials placeholder. */
  readonly image?: string;
  /** Alt text for the avatar image. */
  readonly alt?: string;
  /** Diameter preset; defaults to `md`. */
  readonly size?: AvatarSize;
};

/** A circular avatar that shows the given image, or initials as a placeholder. */
export function Avatar({ initials, image, alt, size = "md" }: AvatarProps) {
  const sizeClass = sizeMap[size];
  const textClass = textSizeMap[size];

  return (
    <div className="avatar avatar-placeholder">
      {image ? (
        <div className={`${sizeClass} rounded-full`}>
          <img src={image} alt={alt ?? ""} />
        </div>
      ) : (
        <div
          className={`bg-neutral text-neutral-content ${sizeClass} rounded-full ${textClass} font-medium flex items-center justify-center`}
        >
          <span>{initials?.slice(0, 2) ?? "?"}</span>
        </div>
      )}
    </div>
  );
}
