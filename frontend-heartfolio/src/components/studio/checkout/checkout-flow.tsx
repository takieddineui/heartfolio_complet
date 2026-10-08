"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useTheme } from "@/components/theme/theme-provider";
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import type { DeliveryPack } from "@/types/commerce";
import {
  groupPacksForPresentation,
  packForUnits,
  unitSavingsCents,
  unitSelectionModel,
  unitsForPack,
  type BaseUnit,
  type UnitOption,
} from "@/lib/commerce/pack-presentation";
import { useProductState } from "@/lib/studio/product-state-context";
import { resolveShellText } from "@/lib/studio/i18n";
import { SHOW_WALLPAPER_ADDON } from "@/lib/feature-flags";
import { formatCents } from "@/lib/studio/pricing-engine";
import {
  prepareOrder,
  startPayment,
  waitForPaidOrder,
  prepareFreemiusStaging,
  waitForStagedOrder,
  isFreemiusCheckoutActive,
} from "@/lib/studio/engines/checkout-engine";
import { openPaddleCheckout, type PaddleCheckoutOutcome } from "@/lib/commerce/paddle-client";
import { openFreemiusCheckout } from "@/lib/commerce/freemius-client";
import { completeFreemiusCheckout } from "@/lib/api/freemius-checkout";
import { ApiError } from "@/lib/api/errors";
import { getOrder, getOrderEntitlements, type ApiEntitlement, type ApiOrder } from "@/lib/api/orders";
import { checkoutErrorMessageKey } from "@/lib/studio/checkout-error-mapping";
import { PartialUploadFailure } from "@/lib/studio/media-values";
import { Button } from "@/components/studio/ui/button";
import { Card } from "@/components/studio/ui/card";
import { OrderDownloads } from "@/components/commerce/order-downloads";
import { RevealGroup, RevealItem } from "@/components/motion/reveal";

/**
 * The checkout modal. Visually the same as before — same steps, same card,
 * same pricing box, same success/failure views. Everything underneath is
 * real:
 *
 *   packs      Django catalog, not a hardcoded registry
 *   pricing    the totals Django computed, not a local calculation
 *   payment    a real checkout with the active provider, not "simulate" buttons
 *   paid       confirmed by Django, never decided here
 *
 * ONE PROVIDER IS ACTIVE AT A TIME — `isFreemiusCheckoutActive()` (mirrors
 * the backend's `FREEMIUS_ENABLED` switch) picks which of the two flows
 * below actually runs; this is not a customer-facing choice. Currently
 * Freemius (`startFreemiusCheckout`) — Paddle (`startPaddleCheckout`) is
 * left fully in place, untouched, for when the switch flips back.
 *
 * The rule both flows exist to respect: finishing a checkout overlay is not
 * proof of payment on its own. Paddle's path only trusts `order.status ===
 * "paid"` read back after its signature-verified webhook lands; Freemius's
 * path re-verifies the overlay's own `license_id` against Freemius's API
 * server-side before ever creating an Order (see
 * `apps/commerce/services.py::_complete_freemius_purchase`) — neither ever
 * takes the browser's word for it.
 */
type Step = "select-pack" | "checkout" | "paying" | "result";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CheckoutFlow() {
  const locale = useLocale();
  const router = useRouter();
  const { theme } = useTheme();
  const st = (key: string, params?: Record<string, string | number>) => resolveShellText(key, locale, params);
  const {
    session,
    closeCheckout,
    t: moduleT,
    packs,
    packsError,
    selectedPack,
    setSelectedPack,
    values,
    themeSelections,
    replaceValues,
  } = useProductState();

  const [step, setStep] = useState<Step>("select-pack");
  const [guestEmail, setGuestEmail] = useState("");
  const [order, setOrder] = useState<ApiOrder | null>(null);
  const [entitlements, setEntitlements] = useState<ApiEntitlement[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("checkout.preparing");
  const [error, setError] = useState<string | null>(null);
  /** Set only on Freemius's rare "closed before the callback fired, and the
   * webhook safety net hasn't landed it either yet" path — see
   * `startFreemiusCheckout` below. There is genuinely no `Order` to show in
   * this case (Freemius's Order is created only once payment is verified),
   * so `step === "result"` renders a minimal pending view instead of
   * `OrderResultView`, which requires one. */
  const [freemiusPendingNoOrder, setFreemiusPendingNoOrder] = useState(false);

  function selectPack(pack: DeliveryPack) {
    setSelectedPack(pack);
    setStep("checkout");
  }

  function mapProgressStage(progress: "identifying" | "uploading" | "saving" | "ordering") {
    return progress === "identifying"
      ? "checkout.preparing"
      : progress === "uploading"
        ? "checkout.uploadingPhotos"
        : progress === "saving"
          ? "checkout.savingProject"
          : "checkout.creatingOrder";
  }

  /**
   * identity -> photo upload -> project save -> order -> payment.
   *
   * The order is created once and held in state: a retry after a failed or
   * abandoned payment reuses it rather than creating a duplicate, and the
   * backend's `/pay/` is itself idempotent (it reuses an existing pending
   * Paddle transaction instead of opening a second one).
   */
  async function startPaddleCheckout() {
    if (!selectedPack) return;
    let currentOrder = order;

    if (!currentOrder) {
      const prepared = await prepareOrder(
        {
          productId: session.module.productId,
          deliveryPackId: selectedPack.id,
          email: guestEmail.trim(),
          // The language they are checking out in, recorded on the order.
          locale,
          values,
          themeSelections,
          projectId: session.projectId,
        },
        (progress) => setStage(mapProgressStage(progress))
      );
      // Adopt the uploaded photos so a retry never re-uploads them.
      replaceValues(prepared.values);
      currentOrder = prepared.order;
      setOrder(prepared.order);
    }

    const { order: afterPay, checkout } = await startPayment(currentOrder.orderId);
    setOrder(afterPay);

    /**
     * HOW THE OVERLAY ENDED CHANGES HOW LONG WE WAIT, and ignoring it was
     * a real bug: a customer who opened Paddle, changed their mind and
     * closed it sat for the full ninety seconds under "Confirming your
     * payment… please keep this window open" — for a payment they had
     * deliberately abandoned. It looked like the page had hung.
     *
     * Still polled after a close, because closing is NOT proof of
     * anything: the overlay can be dismissed in the moment between paying
     * and the `completed` event firing. But a few seconds is enough to
     * catch that, where ninety is enough to look broken.
     */
    let outcome: PaddleCheckoutOutcome = "completed";
    if (checkout) {
      outcome = await openPaddleCheckout(checkout.transactionId, checkout.clientToken, {
        email: guestEmail.trim(),
        locale,
        theme,
      });
    }

    if (outcome === "error") {
      // The overlay itself failed to open or errored — nothing was
      // charged, and polling would only wait for something that cannot
      // arrive.
      setError(st("checkout.genericError"));
      setStep("checkout");
      return;
    }

    setStage("checkout.confirming");
    const { order: settled } = await waitForPaidOrder(currentOrder.orderId, {
      timeoutMs: outcome === "closed" ? 8_000 : 90_000,
    });
    setOrder(settled);

    if (settled.status === "paid") {
      setEntitlements((await getOrderEntitlements(settled.orderId)).entitlements);
    }
    setStep("result");
  }

  /**
   * identity -> photo upload -> project save -> staged checkout -> overlay.
   *
   * No `Order` exists yet at any point up to the overlay opening — Freemius's
   * checkout has no passthrough field to resolve a webhook back to a pending
   * one, so (per the approved design) the Order is created only once payment
   * is verified. See `apps/commerce/services.py`'s module comment and
   * `FreemiusCheckoutStaging` for the full reasoning.
   *
   * Two ways this reaches a real Order, in priority order:
   *  1. The overlay's own `purchaseCompleted` callback fires (the common
   *     case — Freemius's checkout is an in-page overlay, not a navigation,
   *     same as Paddle's) and `completeFreemiusCheckout` re-verifies it
   *     server-side. No polling needed on this path.
   *  2. It doesn't (closed early, or that call itself failed transiently):
   *     falls back to polling the staging row, the same shape as Paddle's
   *     `waitForPaidOrder`, in case the webhook safety net lands it
   *     independently.
   */
  async function startFreemiusCheckout() {
    if (!selectedPack) return;

    const prepared = await prepareFreemiusStaging(
      {
        productId: session.module.productId,
        deliveryPackId: selectedPack.id,
        email: guestEmail.trim(),
        locale,
        values,
        themeSelections,
        projectId: session.projectId,
      },
      (progress) => setStage(mapProgressStage(progress))
    );
    replaceValues(prepared.values);
    const staging = prepared.staging;

    if (!staging.planId) {
      // The backend already refuses to stage a pack with no Freemius plan
      // configured (`FreemiusPlanNotConfigured`) — reaching here would mean
      // a real misconfiguration, not something a retry fixes.
      setError(st("checkout.genericError"));
      setStep("checkout");
      return;
    }

    const { outcome, purchase } = await openFreemiusCheckout({
      productId: staging.freemiusProductId,
      publicKey: staging.publicKey,
      planId: staging.planId,
      pricingId: staging.pricingId,
      sandbox: staging.sandbox,
      email: guestEmail.trim(),
      locale,
    });

    if (outcome === "error") {
      setError(st("checkout.genericError"));
      setStep("checkout");
      return;
    }

    if (outcome === "completed" && purchase) {
      setStage("checkout.confirming");
      try {
        const completedOrder = await completeFreemiusCheckout(staging.stagingId, purchase.licenseId);
        setOrder(completedOrder);
        if (completedOrder.status === "paid") {
          setEntitlements((await getOrderEntitlements(completedOrder.orderId)).entitlements);
        }
        setStep("result");
        return;
      } catch {
        // The overlay already reported success — this must not surface as
        // a customer-facing failure. Falls through to the same poll-based
        // fallback as "closed" below; the webhook safety net may still
        // land it independently of this failed call.
      }
    }

    setStage("checkout.confirming");
    const { staging: polled } = await waitForStagedOrder(staging.stagingId, {
      timeoutMs: outcome === "closed" ? 8_000 : 90_000,
    });

    if (polled.status === "completed" && polled.orderId) {
      const settled = await getOrder(polled.orderId);
      setOrder(settled);
      if (settled.status === "paid") {
        setEntitlements((await getOrderEntitlements(settled.orderId)).entitlements);
      }
      setStep("result");
      return;
    }

    // Still awaiting/expired/failed — no Order was ever created. Reuses the
    // same pending visual language (see the render below) without a real
    // order to link to.
    setFreemiusPendingNoOrder(true);
    setStep("result");
  }

  async function startCheckout() {
    if (!selectedPack) return;
    if (!EMAIL_PATTERN.test(guestEmail.trim())) {
      setError(st("checkout.invalidEmail"));
      return;
    }

    setError(null);
    setFreemiusPendingNoOrder(false);
    setBusy(true);
    setStage("checkout.preparing");
    setStep("paying");

    try {
      if (isFreemiusCheckoutActive()) {
        await startFreemiusCheckout();
      } else {
        await startPaddleCheckout();
      }
    } catch (cause) {
      if (cause instanceof PartialUploadFailure) {
        // Persist whatever DID upload successfully — every photo that got
        // an `assetId` in this attempt keeps it, and won't be re-uploaded
        // (or, worse, silently lost) on the next one. See
        // `PartialUploadFailure`'s own docstring in media-values.ts for
        // the bug this prevents: without this, a photo that genuinely
        // uploaded could become permanently stuck.
        replaceValues(cause.values as Record<string, unknown>);
      }

      /**
       * A 5xx carries no message worth showing: `fallbackMessage()` in
       * `lib/api/errors.ts` is hardcoded English with no locale, and a
       * backend-supplied message is English too — so a French customer was
       * shown "Something went wrong on our side." mid-checkout. The Shell
       * already has that sentence translated as `checkout.genericError`.
       *
       * Most other 4xx messages are still surfaced as-is: those are specific
       * and actionable (an invalid pack, a rejected email), and replacing
       * them with a generic sentence would lose information the customer
       * needs. The missing-photo cases are the exception — see
       * `checkoutErrorMessageKey`'s own comment (lib/studio/checkout-error-mapping.ts)
       * for why neither of their real messages is fit to show a customer.
       */
      const messageKey = checkoutErrorMessageKey(cause);
      setError(
        messageKey
          ? st(messageKey)
          : cause instanceof ApiError && !cause.isServerError
            ? cause.message
            : st("checkout.genericError")
      );
      setStep("checkout");
    } finally {
      setBusy(false);
    }
  }

  return (
    // GRID, NOT FLEX, for centering — a `w-full` child inside a
    // `justify-content: center` flex row resolves its percentage width
    // against an indeterminate basis in this exact "centered flex item"
    // configuration, so the card rendered at a fixed max-w-md (448px)
    // regardless of viewport width, overflowing off-screen on anything
    // narrower (confirmed directly: measured a 448px card on a 375px-wide
    // viewport, text clipped past the right edge). `grid place-items-center`
    // doesn't have this ambiguity — a `w-full` grid item genuinely fills its
    // track. `overflow-y-auto` on this same wrapper is what makes a card
    // taller than the viewport (the paid-success view, with its QR block
    // and several buttons, easily is on a short phone) scrollable instead
    // of silently clipped with no way to reach the rest. `backdrop-blur-sm`
    // matches this codebase's other overlays (header, cookie banner) — the
    // modal previously had none, which was part of why it read as pasted on
    // top of the artwork rather than genuinely floating above it.
    <div className="fixed inset-0 z-[200] grid place-items-center overflow-y-auto bg-ink-navy/60 p-4 backdrop-blur-sm">
      {/* `bg-card`, not `bg-page` — the latter was an accidental override:
          Card's own base styling already sets `bg-card` (a deliberately
          distinct, slightly lighter surface tone than the page background —
          see globals.css) plus its shadow, but `bg-page` here matched the
          page almost exactly in dark mode, so the modal read as flat and
          barely separated from what was behind it. */}
      <Card className="relative my-8 w-full max-w-md bg-card p-6">
        <button
          onClick={closeCheckout}
          aria-label={st("checkout.close")}
          // §15: `end-4`, so the close button stays on the reading-end
          // corner in Arabic. Sized and shaped to match the header's own
          // icon-button convention (`h-10 w-10 rounded-full`, see
          // components/layout/header.tsx) — this previously had no defined
          // hit target at all beyond the bare 16px icon.
          className="absolute end-2 top-2 flex h-10 w-10 items-center justify-center rounded-full text-body/50 transition-colors hover:bg-subtle/50 hover:text-heading"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>

        {step === "select-pack" && (
          <div className="space-y-4">
            <h2 className="font-serif text-lg text-heading">{st("checkout.selectPack")}</h2>
            {packs === null ? (
              <Loader2 className="h-5 w-5 animate-spin text-champagne-gold" />
            ) : packs.length === 0 ? (
              <p className="text-sm text-body/60">
                {packsError ? st("checkout.genericError") : st("checkout.noPacks")}
              </p>
            ) : (
              <PackSelector
                packs={packs}
                selectedPack={selectedPack}
                onSelect={selectPack}
                moduleT={moduleT}
                st={st}
                locale={locale}
              />
            )}
          </div>
        )}

        {step === "checkout" && selectedPack && (
          <div className="space-y-4">
            <h2 className="font-serif text-lg text-heading">{moduleT(selectedPack.nameKey)}</h2>
            <PricingBreakdown pack={selectedPack} order={order} locale={locale} st={st} />
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-heading">{st("checkout.email")}</label>
              <input
                type="email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                className="h-11 w-full rounded-[var(--radius-md)] border border-subtle bg-page px-3 text-sm text-body focus:border-champagne-gold focus:outline-none"
              />
              <p className="text-xs text-body/50">{st("checkout.emailHelp")}</p>
              {/* Same error treatment the forms already use — no new visual language. */}
              {error && <p className="text-xs text-error-warm">{error}</p>}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setStep("select-pack")}>
                {st("checkout.back")}
              </Button>
              <Button className="flex-1" disabled={!guestEmail || busy} onClick={startCheckout}>
                {st("checkout.continueToPayment")}
              </Button>
            </div>
          </div>
        )}

        {step === "paying" && selectedPack && (
          <div className="space-y-4">
            <PricingBreakdown pack={selectedPack} order={order} locale={locale} st={st} />
            <p className="text-sm text-body/70">{st("checkout.payWith")}</p>
            <div className="flex items-center gap-2 text-sm text-body/60">
              <Loader2 className="h-4 w-4 animate-spin text-champagne-gold" />
              <span>{st(stage)}</span>
            </div>
            {stage === "checkout.confirming" && <p className="text-xs text-body/50">{st("checkout.confirmingBody")}</p>}
          </div>
        )}

        {step === "result" && order && (
          <OrderResultView
            order={order}
            entitlements={entitlements}
            locale={locale}
            st={st}
            onClose={closeCheckout}
            onViewOrder={() => router.push(`/orders/${order.orderId}`)}
          />
        )}

        {/* Freemius only, and rare: the overlay closed before its callback
            fired AND the fallback poll window lapsed with the webhook
            safety net not having landed it either. No Order exists yet to
            show or link to — same visual language as the ordinary pending
            view, minus the "view order" link that view has nothing to
            point at here. */}
        {step === "result" && !order && freemiusPendingNoOrder && (
          <div className="space-y-4 text-center">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-champagne-gold" strokeWidth={1.5} />
            <RevealGroup>
              <RevealItem as="h2" className="font-serif text-lg text-heading">
                {st("checkout.pendingTitle")}
              </RevealItem>
              <RevealItem as="p" className="text-sm text-body/70">
                {st("checkout.pendingBody")}
              </RevealItem>
            </RevealGroup>
            <Button className="w-full" onClick={closeCheckout}>
              {st("checkout.close")}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * ---------------------------------------------------------------------
 * THE PACK-SELECTION STEP
 * ---------------------------------------------------------------------
 * Two shapes, chosen per product by what its catalog actually sells:
 *
 *   UnitToggle  a product with at least two base units and a pack that sells
 *               them together (today: Love Story Timeline, Printable and
 *               Digital). The customer ticks units; the selection resolves to
 *               the ONE pack that is that combination.
 *   PackCards   everything else — the product's packs as equal-weight cards,
 *               exactly as before. A product with no combo pack must not get
 *               a toggle whose "both" has nothing to buy.
 *
 * A COMBINATION IS A PACK, NOT A SET OF LINE ITEMS. `Order.delivery_pack` is
 * a single foreign key — there is no line-item concept in this schema,
 * confirmed directly against the model and against an existing test that
 * asserts no `order_items` relation exists at all. So ticking both boxes can
 * only ever mean "select the combo pack", and `onSelect` swaps which
 * `DeliveryPack` object is selected, never mutates one.
 *
 * WALLPAPER NEVER APPEARS AS ITS OWN CARD. The backend's `wallpaper` pack
 * is `status=disabled` and the API already excludes it before this
 * component ever sees the list — this file has no code that could
 * accidentally surface it even if that changed, because `primary` only
 * ever contains the known slugs from `pack-presentation.ts`.
 */
interface PackSelectorProps {
  packs: DeliveryPack[];
  onSelect: (pack: DeliveryPack) => void;
  moduleT: (key: string) => string;
  st: (key: string, params?: Record<string, string | number>) => string;
  locale: string;
}

/** Exported for tests: the selection step is where combo-vs-cards is decided. */
export function PackSelector({
  selectedPack,
  ...props
}: PackSelectorProps & { selectedPack: DeliveryPack | null }) {
  const unitOptions = unitSelectionModel(props.packs);
  if (unitOptions) {
    return <UnitToggle {...props} options={unitOptions} initialPack={selectedPack} />;
  }
  return <PackCards {...props} />;
}

/**
 * The toggle. Selection lives here, not in the checkout's state: nothing is
 * chosen until Continue, so there is no half-selected pack to leak into the
 * pricing box or the staging call. The selected pack is only ever read off
 * `packForUnits`, so what is shown as the total is the pack's own catalog
 * price — the charge itself is still computed by Django.
 */
function UnitToggle({
  packs,
  options,
  initialPack,
  onSelect,
  moduleT,
  st,
  locale,
}: PackSelectorProps & { options: UnitOption[]; initialPack: DeliveryPack | null }) {
  // Reopens with the right boxes ticked when the customer comes Back from
  // the email step, which remounts this component.
  const [selected, setSelected] = useState<BaseUnit[]>(() => unitsForPack(initialPack));

  const target = packForUnits(packs, selected);
  const savingsCents = unitSavingsCents(packs, selected);

  function toggle(unit: BaseUnit, checked: boolean) {
    setSelected((prev) => (checked ? [...prev.filter((u) => u !== unit), unit] : prev.filter((u) => u !== unit)));
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-body/60">{st("checkout.unitsHint")}</p>

      {options.map(({ unit, pack }) => {
        const checked = selected.includes(unit);
        return (
          <label
            key={unit}
            className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border p-4 transition-colors hover:border-champagne-gold ${
              checked ? "border-champagne-gold bg-champagne-gold/5" : "border-subtle"
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => toggle(unit, e.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 rounded border-subtle accent-champagne-gold"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-heading">{moduleT(pack.nameKey)}</span>
                <span className="text-sm text-body/70">{formatCents(pack.priceCents, pack.currency, locale)}</span>
              </span>
              <span className="mt-1 block text-xs text-body/60">{moduleT(pack.descriptionKey)}</span>
            </span>
          </label>
        );
      })}

      <div className="space-y-1 rounded-[var(--radius-md)] bg-champagne-gold/10 px-4 py-3 text-sm" aria-live="polite">
        {target ? (
          <>
            <div className="flex justify-between font-medium text-heading">
              <span>{st("checkout.total")}</span>
              <span>{formatCents(target.priceCents, target.currency, locale)}</span>
            </div>
            {savingsCents > 0 && (
              <p className="text-xs text-body/70">
                {st("checkout.unitsSavings", { price: formatCents(savingsCents, target.currency, locale) })}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-body/70">
            {selected.length === 0 ? st("checkout.unitsSelectOne") : st("checkout.unitsUnavailable")}
          </p>
        )}
      </div>

      <Button className="w-full" disabled={!target} onClick={() => target && onSelect(target)}>
        {st("checkout.unitsContinue")}
      </Button>
    </div>
  );
}

/**
 * The plain list: each pack in `PRIMARY_PACK_SLUGS` as an equal-weight card,
 * with the wallpaper checkbox that `SHOW_WALLPAPER_ADDON` currently hides.
 */
function PackCards({ packs, onSelect, moduleT, st, locale }: PackSelectorProps) {
  const { primary, wallpaperAddonFor } = groupPacksForPresentation(packs);
  const [wantsWallpaper, setWantsWallpaper] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-3">
      {primary.map((pack) => {
        // `SHOW_WALLPAPER_ADDON` gates this, not `groupPacksForPresentation`
        // — see that flag's own comment for why. `combo` staying `undefined`
        // here already makes the checkbox not render (its JSX below is
        // itself conditional on `combo`) and `effectivePack` fall through
        // to the base pack, with no other change needed at this call site.
        const combo = SHOW_WALLPAPER_ADDON ? wallpaperAddonFor[pack.id] : undefined;
        const checked = wantsWallpaper[pack.id] ?? false;
        // The pack this card actually chooses on click — the combo pack
        // while the box is ticked, the base pack otherwise. Computed here
        // rather than inside the click handler so the displayed price
        // always matches what clicking the card will select.
        const effectivePack = checked && combo ? combo : pack;

        return (
          <div
            key={pack.id}
            className="rounded-[var(--radius-md)] border border-subtle p-4 transition-colors hover:border-champagne-gold"
          >
            <button onClick={() => onSelect(effectivePack)} className="w-full text-start">
              <div className="flex items-baseline justify-between">
                <span className="font-medium text-heading">{moduleT(pack.nameKey)}</span>
                <span className="text-sm text-body/70">
                  {formatCents(effectivePack.priceCents, effectivePack.currency, locale)}
                </span>
              </div>
              <p className="mt-1 text-xs text-body/60">{moduleT(pack.descriptionKey)}</p>
            </button>

            {combo && (
              <label className="mt-3 flex items-center gap-2 border-t border-subtle pt-3 text-xs text-body/70">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) =>
                    setWantsWallpaper((prev) => ({ ...prev, [pack.id]: e.target.checked }))
                  }
                  className="h-3.5 w-3.5 rounded border-subtle accent-champagne-gold"
                />
                {st("checkout.addWallpapers", {
                  price: formatCents(combo.priceCents - pack.priceCents, combo.currency, locale),
                })}
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Once an order exists its server-computed totals are shown; before that,
 * the pack's catalog price. Both come from Django — nothing is calculated
 * in the browser, so what is displayed is always what will be charged.
 */
function PricingBreakdown({
  pack,
  order,
  locale,
  st,
}: {
  pack: DeliveryPack;
  order: ApiOrder | null;
  locale: string;
  st: (k: string) => string;
}) {
  const currency = order?.currency ?? pack.currency;
  const subtotalCents = order?.subtotalCents ?? pack.priceCents;
  const discountCents = order?.discountCents ?? 0;
  const totalCents = order?.totalCents ?? pack.priceCents;

  return (
    <div className="space-y-1 rounded-[var(--radius-md)] bg-champagne-gold/10 px-4 py-3 text-sm">
      <div className="flex justify-between text-body/70">
        <span>{st("checkout.subtotal")}</span>
        <span>{formatCents(subtotalCents, currency, locale)}</span>
      </div>
      {discountCents > 0 && (
        <div className="flex justify-between text-body/70">
          <span>{st("checkout.discount")}</span>
          <span>-{formatCents(discountCents, currency, locale)}</span>
        </div>
      )}
      <div className="flex justify-between font-medium text-heading">
        <span>{st("checkout.total")}</span>
        <span>{formatCents(totalCents, currency, locale)}</span>
      </div>
    </div>
  );
}

function OrderResultView({
  order,
  entitlements,
  locale,
  st,
  onClose,
  onViewOrder,
}: {
  order: ApiOrder;
  entitlements: ApiEntitlement[];
  locale: string;
  st: (key: string) => string;
  onClose: () => void;
  onViewOrder: () => void;
}) {
  if (order.status === "paid") {
    return (
      <div className="space-y-4 text-center">
        {/*
          The one moment in this whole flow that earns something more
          than the site's usual restrained fade+drift — a customer just
          paid and the keepsake is now genuinely theirs. Still no
          bounce, still no confetti: a soft settle plus a single ripple
          echoing outward once, borrowing the same "arrival" register
          the live page's opening mark uses, not a new, louder language
          invented just for this moment.

          `CheckCircle2`'s own internal strokes aren't exposed as
          separately animatable paths (unlike the brand mark, which is
          hand-authored SVG this codebase owns) — wrapping the whole
          icon in scale+opacity, plus a separate ripple element behind
          it, is what "arriving" looks like without needing to reach
          inside a third-party icon's internals.
        */}
        <div className="relative mx-auto flex h-10 w-10 items-center justify-center">
          <motion.span
            aria-hidden="true"
            className="absolute inset-0 rounded-full border border-muted-sage"
            initial={{ opacity: 0.6, scale: 0.4 }}
            animate={{ opacity: 0, scale: 2.2 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.75 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
          >
            <CheckCircle2 className="h-10 w-10 text-muted-sage" strokeWidth={1.5} />
          </motion.div>
        </div>

        <RevealGroup>
          <RevealItem as="h2" className="font-serif text-lg text-heading">
            {st("checkout.successTitle")}
          </RevealItem>
          <RevealItem as="p" className="text-sm text-body/70">
            {st("checkout.successBody")}
          </RevealItem>

          {/* The customer's paid deliverables. Every button is an authorized
              GET — Django re-checks session, ownership and paid state on each
              one, so this UI can never be what grants access. */}
          <RevealItem>
            <OrderDownloads orderId={order.orderId} entitlements={entitlements} variant="summary" />
          </RevealItem>

          {/*
            §10 — the real thank-you page.

            The downloads stay here so nobody is forced to navigate to get
            what they just paid for; the page is where the rest of §10 lives
            (the review box, other products) and is the URL the emailed
            receipt points at. Offered rather than forced: a redirect fired
            automatically would yank the page out from under someone
            mid-download.
          */}
          <RevealItem className="space-y-2">
            {/* `secondary`, not the default `primary` — this used to render
                identically to "Download your keepsake" above (in
                OrderDownloads), which is the one action on this screen that
                should actually read as primary. Two equal-weight primary
                buttons stacked isn't a hierarchy. */}
            <Button variant="secondary" className="w-full" onClick={onViewOrder}>
              {st("checkout.openOrderPage")}
            </Button>
            <Button variant="secondary" className="w-full" onClick={onClose}>
              {st("checkout.close")}
            </Button>
          </RevealItem>
        </RevealGroup>
      </div>
    );
  }

  /**
   * `pending` is not failure. The webhook may simply not have arrived yet
   * and the payment can still complete, so telling a customer who has been
   * charged that it failed would be false.
   */
  if (order.status === "pending") {
    return (
      <div className="space-y-4 text-center">
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-champagne-gold" strokeWidth={1.5} />
        <RevealGroup>
          <RevealItem as="h2" className="font-serif text-lg text-heading">
            {st("checkout.pendingTitle")}
          </RevealItem>
          <RevealItem as="p" className="text-sm text-body/70">
            {st("checkout.pendingBody")}
          </RevealItem>
        </RevealGroup>
        <a
          href={`/${locale}/orders/${order.orderId}`}
          className="block w-full rounded-[var(--radius-md)] border border-subtle px-4 py-2 text-center text-sm text-heading transition-colors hover:border-champagne-gold"
        >
          {st("checkout.viewOrder")}
        </a>
      </div>
    );
  }

  const isCancelled = order.status === "cancelled";
  return (
    <div className="space-y-4 text-center">
      <XCircle className="mx-auto h-10 w-10 text-error-warm" strokeWidth={1.5} />
      <RevealGroup>
        <RevealItem as="h2" className="font-serif text-lg text-heading">
          {isCancelled ? st("checkout.cancelledTitle") : st("checkout.failedTitle")}
        </RevealItem>
        <RevealItem as="p" className="text-sm text-body/70">
          {isCancelled ? st("checkout.cancelledBody") : st("checkout.failedBody")}
        </RevealItem>
      </RevealGroup>
      <Button className="w-full" onClick={onClose}>
        {st("checkout.tryAgain")}
      </Button>
    </div>
  );
}
