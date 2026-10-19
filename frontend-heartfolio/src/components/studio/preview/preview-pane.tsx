import "./component-renderer"; // registers the "component" renderer kind as a side effect
import "./live-only-renderer"; // registers the "live" renderer kind (live-only products) as a side effect
import type { StudioSession } from "@/types/studio";
import { rendererRegistry } from "@/lib/studio/renderer-registry";
import { PreviewEmptyState } from "./preview-empty-state";

interface PreviewPaneProps {
  session: StudioSession;
}

export function PreviewPane({ session }: PreviewPaneProps) {
  const Renderer = rendererRegistry[session.module.renderer.kind];

  if (!Renderer && session.module.renderer.kind !== "unset" && process.env.NODE_ENV !== "production") {
    console.warn(
      `[Product Module: ${session.module.productId}] renderer.kind "${session.module.renderer.kind}" ` +
        `has no entry in rendererRegistry — falling back to the empty preview state.`
    );
  }

  // `min-w-0`: this column is a flex item, and its default `min-width: auto`
  // let a fixed-size canvas (Song Poster's 1200px Award and Sleeve) stretch it
  // past the screen, so `ScaleToFit` measured the canvas instead of the pane:
  // off screen at 1280 and 1440, and the whole Studio wider than a phone
  // (19 Oct 2026). `preview-pane-layout.test.ts` pins it.
  return (
    <div className="flex h-full min-h-[420px] min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-10">
      {Renderer ? <Renderer config={session.module.renderer} session={session} /> : <PreviewEmptyState />}
    </div>
  );
}
