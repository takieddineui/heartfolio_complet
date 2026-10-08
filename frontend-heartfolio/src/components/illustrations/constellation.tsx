export function ConstellationMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 160 60"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <g stroke="var(--color-champagne-gold)" strokeWidth="0.6" opacity="0.9">
        <path d="M10 40 L38 14 L72 30 L104 12 L150 24" />
      </g>
      <g fill="var(--color-champagne-gold)">
        <circle cx="10" cy="40" r="1.6" />
        <circle cx="38" cy="14" r="2.1" />
        <circle cx="72" cy="30" r="1.4" />
        <circle cx="104" cy="12" r="1.8" />
        <circle cx="150" cy="24" r="1.6" />
      </g>
    </svg>
  );
}

export function FrameCorner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" className={className}>
      <path
        d="M2 2 L2 18 M2 2 L18 2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="2" cy="2" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function BotanicalSprig({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 90" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12 88 C12 60 12 40 12 4"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      {[14, 26, 38, 50, 62].map((y, i) => (
        <path
          key={y}
          d={
            i % 2 === 0
              ? `M12 ${y} C 6 ${y - 4}, 2 ${y - 10}, 4 ${y - 16}`
              : `M12 ${y} C 18 ${y - 4}, 22 ${y - 10}, 20 ${y - 16}`
          }
          stroke="currentColor"
          strokeWidth="0.9"
          strokeLinecap="round"
        />
      ))}
      <circle cx="12" cy="4" r="2" fill="currentColor" />
    </svg>
  );
}

export function MoonMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" className={className}>
      <path
        d="M22 4a16 16 0 1 0 14 22A12.5 12.5 0 0 1 22 4Z"
        stroke="currentColor"
        strokeWidth="1.1"
        fill="none"
      />
    </svg>
  );
}

export function MapPinMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 32" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12 1c6.1 0 11 4.8 11 10.8C23 19.6 12 31 12 31S1 19.6 1 11.8C1 5.8 5.9 1 12 1Z"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <circle cx="12" cy="11.5" r="1.3" fill="currentColor" />
    </svg>
  );
}
