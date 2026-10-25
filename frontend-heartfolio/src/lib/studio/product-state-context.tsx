"use client";

import { createContext, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useLocale } from "next-intl";
import type { StudioSession, ThemeSelections, ValidationResult } from "@/types/studio";
import { formEngine } from "@/lib/studio/form-engine";
import { themeEngine } from "@/lib/studio/theme-engine";
import { pricingEngine } from "@/lib/studio/pricing-engine";
import { proposeTitleKey } from "./product-modules/love-story-timeline/story-types";
import { resolveModuleText } from "@/lib/studio/i18n";
import { useDeliveryPacks } from "@/lib/commerce/use-delivery-packs";
import type { DeliveryPack } from "@/types/commerce";

interface ProductStateValue {
  session: StudioSession;
  locale: string;
  /** Resolves a translation key against the active module's own
   * `messages` for the current locale. Every left-panel section uses
   * this instead of rendering schema/theme/pricing labels raw. */
  t: (key: string, params?: Record<string, string | number>) => string;
  values: Record<string, unknown>;
  setValues: (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
  themeSelections: ThemeSelections;
  setThemeSelections: (updater: (prev: ThemeSelections) => ThemeSelections) => void;
  tokens: Record<string, string>;
  validation: ValidationResult;
  pricing: ReturnType<typeof pricingEngine.computeTotal>;
  /** Keyed by export target id — a single-canvas product only ever
   * registers `"default"`, but the map exists so a future multi-surface
   * product (e.g. a Wedding Invitation with a cover + an RSVP card)
   * doesn't force another context reshape to add a second target. */
  exportTargets: RefObject<Record<string, HTMLElement | null>>;
  registerExportTarget: (targetId: string, node: HTMLElement | null) => void;
  checkoutOpen: boolean;
  openCheckout: () => void;
  closeCheckout: () => void;
  /** The product's real delivery packs from Django. `null` while loading.
   * Commercial data is never held in the frontend, so this is the only
   * source of pack prices in the Studio. */
  packs: DeliveryPack[] | null;
  packsError: boolean;
  /** The pack the customer picked in checkout, so the left panel can show
   * what they will actually be charged rather than an estimate. */
  selectedPack: DeliveryPack | null;
  setSelectedPack: (pack: DeliveryPack | null) => void;
  /** Adopted after checkout uploads photos, so `assetId`s persist into the
   * Studio state and a retry does not re-upload the same files. */
  replaceValues: (values: Record<string, unknown>) => void;
}

const ProductStateContext = createContext<ProductStateValue | null>(null);

/** Owns the two pieces of mutable state every Product Module needs —
 * form `values` and `themeSelections` — seeded once from the module's
 * `createInitialState`/`createInitialThemeSelections` when a session
 * becomes ready. A Product Module never holds its own React state; it
 * only describes schema/themes/pricing as data and reads/writes through
 * this context. */
export function ProductStateProvider({ session, children }: { session: StudioSession; children: ReactNode }) {
  const locale = useLocale();
  /**
   * Seeded once, from the saved project when the Studio was entered via
   * `/project/:id`, otherwise from the Product Module's own defaults —
   * identical behaviour to before for every new session. Restored values
   * are used as-is: `values`/`themeSelections` are opaque product-module
   * state that Django stores and returns byte-for-byte, so there is
   * nothing to translate on the way back in.
   */
  const [values, setValuesState] = useState<Record<string, unknown>>(
    () => session.restored?.values ?? (session.module.createInitialState(locale) as Record<string, unknown>)
  );
  const [themeSelections, setThemeSelectionsState] = useState<ThemeSelections>(
    () => session.restored?.themeSelections ?? session.module.createInitialThemeSelections()
  );
  const exportTargets = useRef<Record<string, HTMLElement | null>>({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [selectedPack, setSelectedPack] = useState<DeliveryPack | null>(null);
  const { packs, error: packsError } = useDeliveryPacks(session.module.productId);

  const setValues = (updater: (prev: Record<string, unknown>) => Record<string, unknown>) =>
    setValuesState((prev) => {
      const next = updater(prev);
      return applyGeneratedTitle(prev, next, (key) =>
        resolveModuleText(key, locale, session.module.messages)
      );
    });
  const replaceValues = (next: Record<string, unknown>) => setValuesState(next);
  const setThemeSelections = (updater: (prev: ThemeSelections) => ThemeSelections) =>
    setThemeSelectionsState((prev) => updater(prev));
  const registerExportTarget = (targetId: string, node: HTMLElement | null) => {
    exportTargets.current[targetId] = node;
  };

  const t = (key: string, params?: Record<string, string | number>) =>
    resolveModuleText(key, locale, session.module.messages, params);

  const tokens = useMemo(
    () => themeEngine.resolveTokens(session.module.themes, themeSelections),
    [session, themeSelections]
  );

  const validation = useMemo(() => {
    const generic = formEngine.validate(session.module.formSchema, values, themeSelections);
    const domain = session.module.validate?.(values, themeSelections);
    if (!domain) return generic;
    return {
      valid: generic.valid && domain.valid,
      errors: { ...generic.errors, ...domain.errors },
    };
  }, [session, values, themeSelections]);

  const pricing = useMemo(
    () => pricingEngine.computeTotal(session.module.pricing, { values, theme: themeSelections }),
    [session, values, themeSelections]
  );

  return (
    <ProductStateContext.Provider
      value={{
        session,
        locale,
        t,
        values,
        setValues,
        themeSelections,
        setThemeSelections,
        tokens,
        validation,
        pricing,
        exportTargets,
        registerExportTarget,
        checkoutOpen,
        openCheckout: () => setCheckoutOpen(true),
        closeCheckout: () => setCheckoutOpen(false),
        packs,
        packsError,
        selectedPack,
        setSelectedPack,
        replaceValues,
      }}
    >
      {children}
    </ProductStateContext.Provider>
  );
}

export function useProductState(): ProductStateValue {
  const ctx = useContext(ProductStateContext);
  if (!ctx) throw new Error("useProductState must be used within a ProductStateProvider");
  return ctx;
}

/**
 * §17 — proposes a story title when the story type changes.
 *
 * Applied in `setValues` rather than in the form field, so it holds no
 * matter which control caused the change — including a future one. Doing it
 * in the select's own handler would work today and quietly stop working the
 * moment the type became settable anywhere else.
 *
 * Delegated to the product module: the rule about when NOT to overwrite is
 * product knowledge, and this context is shared by every product. A module
 * without `proposeTitleKey` is untouched.
 */
function applyGeneratedTitle(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  resolve: (key: string) => string
): Record<string, unknown> {
  const typeChanged = previous.storyType !== next.storyType;
  if (!typeChanged || typeof next.storyType !== "string") return next;

  const key = proposeTitleKey(String(next.posterTitle ?? ""), next.storyType, resolve);
  return key ? { ...next, posterTitle: resolve(key) } : next;
}
