/**
 * ---------------------------------------------------------------------
 * SKELETONS
 * ---------------------------------------------------------------------
 * Every route that reads the catalog is `force-dynamic`, so Next streams
 * the page and there is a real gap before content arrives. Until now that
 * gap rendered nothing at all — a blank page, indistinguishable from a
 * broken one on a slow connection.
 *
 * THEY MIRROR THE REAL LAYOUT, which is the whole point. A generic centred
 * spinner is easier to write and worse: content then lands in a completely
 * different place and the page jumps. These reuse the actual container
 * widths, grid columns and aspect ratios from the components they stand in
 * for, so the arriving content occupies roughly the space already held.
 * When a real layout changes, its skeleton should change with it.
 *
 * MOTION IS ALREADY HANDLED. `globals.css` neutralises animation under
 * `prefers-reduced-motion`, so `animate-pulse` stops for visitors who ask
 * for that without anything special here.
 *
 * ANNOUNCED, NOT JUST DRAWN. The wrappers carry `aria-busy` and a
 * screen-reader-only "Loading" — a silent skeleton is invisible to anyone
 * not looking at it, and they get no signal that anything is happening.
 */

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-[var(--radius-md)] bg-subtle/50 ${className}`} />;
}

export function SkeletonText({ width = "w-full" }: { width?: string }) {
  return <SkeletonBlock className={`h-4 ${width}`} />;
}

/** Wraps a skeleton so assistive technology knows the page is working. */
export function SkeletonRegion({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Matches `ProductCollection`'s three-column grid and 4:5 cards. */
export function SkeletonProductGrid({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="space-y-4">
          <SkeletonBlock className="aspect-[4/5] w-full rounded-[var(--radius-xl)]" />
          <SkeletonText width="w-2/3" />
          <SkeletonText width="w-full" />
          <SkeletonText width="w-1/3" />
        </div>
      ))}
    </div>
  );
}
