export function PreviewLoadingState() {
  return (
    <div className="h-full w-full overflow-hidden rounded-[var(--radius-lg)] border border-subtle bg-card">
      <div
        className="h-full w-full animate-shimmer bg-[length:200%_100%]"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent, rgba(201,162,75,0.08), transparent)",
        }}
      />
    </div>
  );
}
