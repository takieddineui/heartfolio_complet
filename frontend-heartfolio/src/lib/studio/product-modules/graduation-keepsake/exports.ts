import type { ExportEngineConfig } from "@/types/studio";

/**
 * Nothing is exported, because this product has no printed or downloadable
 * file YET - its only deliverable is the hosted live page (`delivery.mode:
 * "interactive"` in `index.ts` is what the Studio shows). `targets` stays an
 * empty record, not a missing field, so the day a printable pack arrives it
 * is a matter of listing its formats here rather than reshaping the config.
 */
export const graduationExports: ExportEngineConfig = {
  targets: {},
  hideCustomerFacingList: true,
};
