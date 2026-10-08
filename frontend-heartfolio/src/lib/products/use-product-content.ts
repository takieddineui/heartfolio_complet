"use client";

import { useTranslations } from "next-intl";
import type { ProductEntry } from "./types";

export interface ProductContent {
  name: string;
  shortDescription: string;
  fullDescription: string;
  badge?: string;
}

/**
 * The single place product text gets read. Components should never call
 * `useTranslations("Products.something")` directly or hardcode a product's
 * name/description — use this hook instead, so if the translation lookup
 * ever needs to change (e.g. moving to a database-backed registry per
 * STUDIO_INTEGRATION_GUIDE.md §3), there's exactly one call site to update.
 */
export function useProductContent(product: ProductEntry): ProductContent {
  const t = useTranslations(`Products.${product.i18nKey}`);
  const tBadges = useTranslations("Products.badges");

  return {
    name: t("name"),
    shortDescription: t("shortDescription"),
    fullDescription: t("fullDescription"),
    badge: product.badgeKey ? tBadges(product.badgeKey) : undefined,
  };
}
