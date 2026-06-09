// DaisyUI 5: https://daisyui.com/components/avatar/
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

type AvatarProps = {
  readonly initials?: string;
  readonly image?: string;
  readonly alt?: string;
  readonly size?: AvatarSize;
};

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
