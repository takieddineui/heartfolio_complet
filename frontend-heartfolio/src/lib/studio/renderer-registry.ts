import type { ComponentType } from "react";
import type { RendererConfig, StudioSession } from "@/types/studio";

export interface RendererProps {
  config: RendererConfig;
  session: StudioSession;
}

/** Keyed by `RendererConfig["kind"]`. `preview-pane.tsx` looks up this
 * table instead of branching on kind itself, so registering a new
 * renderer strategy (a future `canvas` or `webgl` implementation) never
 * requires touching the preview pane again. */
export const rendererRegistry: Partial<Record<RendererConfig["kind"], ComponentType<RendererProps>>> = {};

export function registerRenderer(kind: RendererConfig["kind"], component: ComponentType<RendererProps>) {
  rendererRegistry[kind] = component;
}
