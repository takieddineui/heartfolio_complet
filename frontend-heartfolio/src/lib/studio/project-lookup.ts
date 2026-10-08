/**
 * Resolves a saved project's product so `/project/:id` can hand off to the
 * Studio Shell the same way `/studio/:slug` does.
 *
 * Previously mocked to always return `null`, which made that route render
 * "project unavailable" unconditionally. It now asks Django.
 *
 * SLUG BOUNDARY: Django stores and returns the product's own slug
 * (`heart-map`). The Shell resolves products through the frontend registry,
 * which accepts either the public slug or the stable id, so the backend
 * value is handed through as-is and the public `where-we-met` URL is never
 * involved in an API call. See `lib/products/product-id.ts`.
 *
 * Returns `null` — not an error — when the project does not exist or
 * belongs to another guest, so the route keeps rendering its existing
 * error state rather than throwing. How a returning customer re-identifies
 * to reach their own project is a Step 9 decision.
 */

import { projectEngine } from "@/lib/studio/extension-points";

export async function resolveProjectProductId(projectId: string): Promise<string | null> {
  const loaded = await projectEngine.load(projectId);
  return loaded?.productId ?? null;
}
