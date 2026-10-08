import "./component-renderer"; // registers the "component" renderer kind as a side effect
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

  return (
    <div className="flex h-full min-h-[420px] flex-1 flex-col p-4 sm:p-6 lg:p-10">
      {Renderer ? <Renderer config={session.module.renderer} session={session} /> : <PreviewEmptyState />}
    </div>
  );
}
