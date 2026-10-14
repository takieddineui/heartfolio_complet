"use client";

import { useProductState } from "@/lib/studio/product-state-context";
import { registerRenderer, type RendererProps } from "@/lib/studio/renderer-registry";

/**
 * THE PREVIEW FOR A LIVE-ONLY PRODUCT (`renderer: { kind: "live" }`).
 *
 * The component renderer's preview is built around a printed object: Artwork
 * and Framed tabs, a scale-to-fit poster, a watermark, an export target, with
 * the Live tab beside them only as an extra. A product that IS its live page
 * (Reasons I Love You is the first) has nothing to show in any of those, and
 * `kind: "unset"` would show the empty state with no Live tab at all. This
 * mounts the module's own `livePreview` and nothing else.
 *
 * THE PANE IS THE EXPERIENCE'S WHOLE WORLD. The box below is a containing
 * block for everything inside it (`contain: layout paint`, `overflow:
 * hidden`): even an element styled `position: fixed` is placed against this
 * pane, not the window, and cannot cover the Studio around it. The experience
 * keeps its own overlays inside its own frame as well; this is the second
 * guard, for anything a later change might add.
 *
 * No watermark: like the component renderer's Live tab (see its note), the
 * watermark exists to protect a static image from being screenshotted, and an
 * interactive page is not one.
 */
function LiveOnlyRenderer(_props: RendererProps) {
  const { values, themeSelections, locale, session } = useProductState();
  const LivePreview = session.module.livePreview?.component;
  if (!LivePreview) return null;
  return (
    <div
      data-testid="live-only-preview"
      className="relative h-full min-h-[560px] w-full overflow-hidden rounded-[var(--radius-lg)] border border-subtle"
      // `clip` overrides the class's `hidden`: clipped the same, but it can
      // never be scrolled (a hidden box can be, by focus or script).
      style={{ contain: "layout paint", isolation: "isolate", overflow: "clip" }}
    >
      <LivePreview values={values} themeSelections={themeSelections} locale={locale} />
    </div>
  );
}

registerRenderer("live", LiveOnlyRenderer);
