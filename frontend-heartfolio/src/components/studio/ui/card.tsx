import { cn } from "@/lib/utils";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-subtle bg-card shadow-[var(--shadow-whisper)] transition-shadow duration-300 [transition-timing-function:var(--ease-heartfolio)] hover:shadow-[var(--shadow-lift)]",
        className
      )}
    >
      {children}
    </div>
  );
}
