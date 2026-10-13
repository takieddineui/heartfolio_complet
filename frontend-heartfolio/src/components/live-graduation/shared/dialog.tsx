"use client";

import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal layer inside the keepsake's frame (never the window - the Studio
 * embeds this page). On open it moves focus into the dialog, keeps Tab inside
 * it, closes on Escape or a tap on the backdrop, and puts focus back where it
 * came from. `inert` on the page behind is the shell's job.
 */
export function Dialog({
  open,
  label,
  onClose,
  className,
  backdropClassName,
  children,
}: {
  open: boolean;
  label: string;
  onClose: () => void;
  className?: string;
  backdropClassName?: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const returnTo = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement;
    const node = panel.current;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (returnTo.current instanceof HTMLElement) returnTo.current.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className={backdropClassName}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={className}>
        {children}
      </div>
    </div>
  );
}
