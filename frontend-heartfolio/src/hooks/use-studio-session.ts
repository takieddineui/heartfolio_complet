"use client";

import { useEffect, useState } from "react";
import { resolveProductEntry } from "@/hooks/use-product-entry";
import { loadProductModule } from "@/lib/studio/module-loader";
import { projectEngine } from "@/lib/studio/extension-points";
import { refreshMediaUrls } from "@/lib/studio/media-values";
import type { StudioLoadState, StudioSession } from "@/types/studio";

/**
 * Drives the Studio's entry flow:
 *
 *   read productId → load registry → locate product → loading state
 *   → initialize studio → load product module → [restore saved project]
 *   → ready
 *
 * Two entry shapes, one state machine:
 *
 *   /studio/:slug     product known up front, no network call for the
 *                     project — seeded from the Product Module, exactly
 *                     as before.
 *   /project/:id      product NOT known up front. The project is loaded
 *                     first and reports which product it belongs to.
 *
 * The project load runs here, in the browser, rather than in the route's
 * Server Component. Guest identity is a browser session cookie by design
 * (see lib/api/client.ts) — the server has no session to act on and would
 * have to be handed the customer's cookie to fake one. Keeping it client-
 * side means there is exactly one place that speaks for the customer.
 *
 * A missing product or an unavailable project resolves to
 * `{ status: "not-found" }` rather than throwing, so the Shell always
 * renders a page. A genuine failure (network, 5xx) resolves to `error`,
 * because quietly opening an empty editor would look to the customer like
 * their work had been lost.
 */
export function useStudioSession(productSlugOrId: string | undefined, projectId?: string): StudioLoadState {
  /**
   * §17 — loading is DERIVED, not set.
   *
   * This used to call `setState({ status: "loading" })` synchronously at the
   * top of the effect to reset when the inputs changed. That is the pattern
   * React's `set-state-in-effect` rule flags: the component renders once
   * with the previous product's state, the effect fires, and it renders
   * again — so for one frame the Studio can show the *wrong* project's data
   * before blanking. On a slow device that flash is visible.
   *
   * Storing the resolved value together with the inputs it was resolved for
   * removes the reset entirely. If the current inputs do not match what was
   * resolved, the answer is "loading" — no state change, no extra render,
   * and no window in which stale data is displayed as if it were current.
   */
  const requestKey = `${productSlugOrId ?? ""}|${projectId ?? ""}`;
  const [resolved, setResolved] = useState<{ key: string; state: StudioLoadState } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initialize(): Promise<StudioSession | null> {
      const loaded = projectId ? await projectEngine.load(projectId) : null;
      if (projectId && !loaded) return null;

      // The saved project is authoritative about which product it is;
      // it stores the Django id (`heart-map`), which `resolveProductEntry`
      // accepts alongside the public slug.
      const product = resolveProductEntry(loaded?.productId ?? productSlugOrId ?? "");
      if (!product) return null;

      const productModule = await loadProductModule(product);

      // A saved project stores each photo's durable `assetId`, but its
      // stored `url` is a presigned R2 link that expired minutes after it
      // was issued. Re-resolve them so the preview shows the customer's
      // real photos instead of broken images.
      const restoredValues = loaded
        ? ((await refreshMediaUrls(loaded.state.values)) as Record<string, unknown>)
        : null;

      return {
        product,
        ...(projectId ? { projectId } : {}),
        module: productModule,
        ...(loaded && restoredValues
          ? {
              restored: {
                values: restoredValues,
                themeSelections: loaded.state.themeSelections,
              },
            }
          : {}),
      };
    }

    initialize()
      .then((session) => {
        if (cancelled) return;
        setResolved({
          key: requestKey,
          state: session ? { status: "ready", session } : { status: "not-found" },
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResolved({
          key: requestKey,
          state: {
            status: "error",
            message: err instanceof Error ? err.message : "Something went wrong loading the Studio.",
          },
        });
      });

    return () => {
      cancelled = true;
    };
  }, [productSlugOrId, projectId, requestKey]);

  // A mismatch means the inputs changed and the new load has not landed yet.
  return resolved?.key === requestKey ? resolved.state : { status: "loading" };
}
