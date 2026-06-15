export function SectionPlaceholder({
  height,
  sectionId,
}: {
  readonly height: number;
  readonly sectionId: string;
}) {
  return (
    <div
      aria-hidden="true"
      data-section-placeholder={sectionId}
      className="rounded-box border border-dashed border-base-300 bg-base-200/50"
      style={{ height }}
    />
  );
}
