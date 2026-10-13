"use client";

import type { ProductRendererProps } from "@/types/studio";

/**
 * Never shown today: `previewModes: ["live"]` means the Shell mounts the Live
 * tab, not the "flat" artwork this component stands in for. It exists because
 * `ProductModuleConfig.renderer` is required, and so that the day a printable
 * pack is added the slot is already the right shape.
 */
export function GraduationPreviewPlaceholder(_props: ProductRendererProps) {
  return null;
}
