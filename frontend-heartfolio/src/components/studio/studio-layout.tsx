import type { ReactNode } from "react";

interface StudioLayoutProps {
  header: ReactNode;
  panels: ReactNode;
  footer: ReactNode;
  preview: ReactNode;
}

/**
 * The Studio Shell's structural layout. Left panel is a fixed-width rail
 * (scrolls independently once panels grow); right panel is a large,
 * responsive preview area. On small screens the preview collapses above
 * the panel rail so the layout never breaks — the two-column arrangement
 * is a `lg:` enhancement, not a requirement.
 */
/**
 * RTL NOTE (§15): the panel's divider uses `border-e` (inline-end), not
 * `border-r`. The sidebar sits on the reading-start side of the viewport, so
 * in Arabic it renders on the right and its divider belongs on its left. A
 * physical `border-r` drew the line down the outer edge of the screen instead
 * of between the panel and the canvas.
 *
 * `border-b` on the stacked mobile layout is left physical on purpose —
 * block-direction sides do not flip under `dir="rtl"`.
 */
export function StudioLayout({ header, panels, footer, preview }: StudioLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-page lg:flex-row">
      <aside className="flex w-full flex-col border-b border-subtle bg-card/40 lg:h-screen lg:w-[380px] lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-e">
        <div className="flex flex-1 flex-col gap-6 p-6">
          {header}
          <div className="flex flex-1 flex-col gap-4">{panels}</div>
          {footer}
        </div>
      </aside>

      <main className="flex flex-1 lg:h-screen lg:overflow-y-auto">{preview}</main>
    </div>
  );
}
