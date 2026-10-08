import { cn } from "@/lib/utils";

export function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-full bg-candle-white/90 px-3 py-1 text-[11px] font-medium tracking-wide text-ink-navy",
        className
      )}
    >
      {children}
    </span>
  );
}
