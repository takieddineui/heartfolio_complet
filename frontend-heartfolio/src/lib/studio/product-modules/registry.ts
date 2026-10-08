import type { ProductModuleConfig } from "@/types/studio";

/**
 * The registry deliberately erases each module's value type. A
 * `ProductModuleConfig<TValues>` is invariant in `TValues` (it both produces
 * values via `createInitialState` and consumes them via `validate`), so a
 * concrete `ProductModuleConfig<TimelineValues>` is not assignable to
 * `ProductModuleConfig<unknown>` — and it shouldn't be: the Shell genuinely
 * doesn't know, and must not assume, what any given module's values look
 * like. `any` here states that erasure once, at the one boundary where it's
 * true, instead of pushing casts into every module or weakening the module
 * types themselves. The Shell still only ever touches values through the
 * module's own schema/validate/renderer, never by reaching into the shape.
 */
type ProductModuleLoader = () => Promise<ProductModuleConfig<any>>;

/** One entry per product that has been extracted into a native Product
 * Module. A slug with no entry here falls back to the Shell's default
 * empty-module mock in `module-loader.ts` — that's what lets products
 * stay `"coming_soon"`/`"waitlist"` in the registry without a real
 * module existing yet, and what makes registering a new module (Moon
 * Phase, Star Map, ...) a one-line addition instead of a change to the
 * loader's control flow. */
export const productModuleRegistry: Record<string, ProductModuleLoader> = {
  "love-story-timeline": async () => (await import("./love-story-timeline")).loveStoryTimelineModule,
  "heart-map": async () => (await import("./where-we-met-map")).whereWeMetMapModule,
  // Player, Song Poster's reference theme (see that module's own files
  // for what is and is not built yet — seven more themes, a Python
  // renderer, and print/wallpaper composition all remain). Registered
  // here but NOT YET in `lib/products/registry.ts`'s customer-facing
  // catalog — the same "built, deliberately not listed" state `heart-map`
  // itself is in today, and for the same kind of reason: price, launch
  // wording and catalogue images are real decisions for someone to make,
  // not something to invent while wiring infrastructure. Registering the
  // module here is what makes `/studio/song-poster` resolvable once that
  // decision is made; it changes nothing about what a customer can see
  // before then.
  "song-poster": async () => (await import("./song-poster")).songPosterModule,
};

export function getProductModuleLoader(slug: string): ProductModuleLoader | undefined {
  return productModuleRegistry[slug];
}
