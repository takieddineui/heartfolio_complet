"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface ScaleToFitProps {
  width: number;
  height: number;
  children: ReactNode;
}

/** Renders `children` at their true `width`×`height`, then scales the
 * whole block down (never up) to fit whatever space the parent gives it,
 * preserving aspect ratio. Any fixed-dimension renderer needs this exact
 * behavior — it isn't specific to posters or to Timeline's five export
 * formats, so it lives here once rather than inside a renderer. */
export function ScaleToFit({ width, height, children }: ScaleToFitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width: availableWidth, height: availableHeight } = entry.contentRect;
      const next = Math.min(1, availableWidth / width, availableHeight / height);
      setScale(Number.isFinite(next) && next > 0 ? next : 1);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [width, height]);

  return (
    <div ref={containerRef} className="flex h-full w-full items-center justify-center overflow-hidden">
      <div
        style={{
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          flexShrink: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}
