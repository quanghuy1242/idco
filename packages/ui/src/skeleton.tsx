// DaisyUI 5: https://daisyui.com/components/skeleton/

type SkeletonHeight = "xs" | "sm" | "md";

type SkeletonProps = {
  readonly rows?: number;
  readonly height?: SkeletonHeight;
};

const heightClass: Record<SkeletonHeight, string> = {
  xs: "h-3",
  sm: "h-4",
  md: "h-6",
};

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
