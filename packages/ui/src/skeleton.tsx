// DaisyUI 5: https://daisyui.com/components/skeleton/
/**
 * Placeholder loading rows rendered with the DaisyUI skeleton shimmer.
 *
 * @categoryDefault Feedback
 */

/** Row height of a skeleton placeholder. */
type SkeletonHeight = "xs" | "sm" | "md";

/** Props for {@link Skeleton}. */
type SkeletonProps = {
  /** Number of placeholder rows to render; defaults to `1`. */
  readonly rows?: number;
  /** Height of each placeholder row; defaults to `sm`. */
  readonly height?: SkeletonHeight;
};

const heightClass: Record<SkeletonHeight, string> = {
  xs: "h-3",
  sm: "h-4",
  md: "h-6",
};

/** Placeholder loading rows with the DaisyUI skeleton shimmer. */
export function Skeleton({ rows = 1, height = "sm" }: SkeletonProps) {
  return (
    <div className="flex flex-col gap-2 w-full">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={`skeleton ${heightClass[height]} w-full rounded`}
        />
      ))}
    </div>
  );
}
