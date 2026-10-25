"use client";

import { useEffect, useId, useState } from "react";
import { useLocale } from "next-intl";
import { Download, Loader2 } from "lucide-react";
import {
  DownloadIncompleteError,
  downloadOrderCategory,
  downloadOrderPack,
  fetchGiftLink,
  type DownloadCategory,
} from "@/lib/api/delivery";
import { ApiError } from "@/lib/api/errors";
import { resolveShellText } from "@/lib/studio/i18n";
import { LIVE_TARGET_ID } from "@/types/commerce";
import { API_BASE_PATH } from "@/lib/api/client";
import type { ApiEntitlement } from "@/lib/api/orders";
import { Button } from "@/components/studio/ui/button";

/**
 * The paid customer's deliverables.
 *
 * Heartfolio sells packs, so the primary action is one button that
 * downloads the whole pack as a single archive. The per-file rows below it
 * are secondary — and are the only route for a digital (`__live__`)
 * entitlement, which resolves to a hosted URL and therefore cannot be a
 * file inside a zip.
 *
 * TWO VARIANTS, one component. The success screen right after payment uses
 * "summary": the whole-pack archive, and the gift QR card — the two things
 * someone needs in the first minute. Everything else the archive already
 * contains (print files, thank-you and printing-advice PDFs, the QR card PNGs),
 * so repeating it as three more buttons was clutter. The order page keeps
 * "full": the same two, plus every individual zip under "Download individual
 * files" — for the print shop that wants only the print files, for the person
 * who wants only the cards, and as the fallback when the heavy whole-pack
 * render is slow or fails (the small zips do not depend on artwork renders).
 *
 * A Digital-only order has no archive (the live page is a link, not a file), so
 * there the gift QR card itself is the primary action.
 *
 * This component renders nothing that grants access. Every button is an
 * ordinary authorized GET; Django checks the session, the ownership and
 * the paid state on each one. If this were rendered for an unpaid order —
 * by a bug, or by someone editing state in devtools — the buttons would
 * simply fail server-side with a 404.
 *
 * Uses the existing Button and the same type scale as the surrounding
 * views; no new visual language.
 */
/**
 * §14's four category buttons, all sharing one shape.
 *
 * DECLARED AT MODULE SCOPE, not inside `OrderDownloads`. It was
 * originally a closure defined during render, which recreates the
 * component's identity on every render — `react-hooks/static-components`
 * catches this because React then treats it as a brand-new component
 * type each time, discarding and remounting it instead of updating it.
 * State (there is none here yet, but the busy/spinner prop would still
 * flicker) and DOM identity both reset needlessly. Taking `busy` and the
 * `run`/`onDownload` callback as props, rather than closing over the
 * outer component's state, is what makes hoisting it out possible.
 *
 * Styled the same as the outline buttons elsewhere in this file — border,
 * hover state, spinner-on-busy — rather than as small `Button` primaries:
 * five equally-prominent primary buttons on one screen is not a
 * hierarchy, and the whole-pack download stays the one visually heavier
 * action, matching it being the one most people actually want.
 */
function CategoryButton({
  category,
  label,
  busy,
  onDownload,
  orderId,
  accessToken,
}: {
  category: DownloadCategory;
  label: string;
  busy: string | null;
  onDownload: (key: string, action: () => Promise<unknown>) => void;
  orderId: string;
  accessToken?: string;
}) {
  return (
    <button
      disabled={busy !== null}
      onClick={() => onDownload(category, () => downloadOrderCategory(orderId, category, undefined, accessToken))}
      className="flex items-center justify-center gap-2 rounded-[var(--radius-md)] border border-subtle px-3 py-2 text-sm text-heading transition-colors hover:border-champagne-gold disabled:opacity-60"
    >
      {busy === category ? (
        <Loader2 className="h-4 w-4 animate-spin text-champagne-gold" />
      ) : (
        <Download className="h-4 w-4 text-body/40" strokeWidth={1.75} />
      )}
      {label}
    </button>
  );
}

/**
 * The gift's link, to paste into a message, beside the QR card (owner's
 * decision, 25 Oct 2026: on a computer there was no way to send the gift
 * except as a QR image). Asked for once from the Digital entitlement's own
 * endpoint, which checks ownership and payment like every download. If it
 * cannot be fetched, nothing is shown: the QR card still works.
 */
function GiftLink({
  entitlementId,
  accessToken,
  st,
}: {
  entitlementId: string;
  accessToken?: string;
  st: (key: string) => string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inputId = useId();

  useEffect(() => {
    const controller = new AbortController();
    fetchGiftLink(entitlementId, accessToken, controller.signal)
      .then(setUrl)
      .catch(() => setUrl(null));
    return () => controller.abort();
  }, [entitlementId, accessToken]);

  if (!url) return null;

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard (an insecure context, or permission refused): select the
      // text so it can be copied by hand.
      const input = document.getElementById(inputId) as HTMLInputElement | null;
      input?.select();
    }
  }

  return (
    <div className="mt-2 w-full space-y-1.5 text-start">
      <label htmlFor={inputId} className="block text-xs text-body/60">
        {st("checkout.giftLinkLabel")}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          readOnly
          value={url}
          dir="ltr"
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-subtle bg-transparent px-2 py-1.5 text-xs text-heading"
        />
        <button
          type="button"
          onClick={() => copy(url)}
          className="shrink-0 rounded-[var(--radius-sm)] border border-subtle px-3 py-1.5 text-xs text-heading transition-colors hover:border-champagne-gold"
        >
          {copied ? st("checkout.giftLinkCopied") : st("checkout.copyGiftLink")}
        </button>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-xs text-body/70 underline decoration-champagne-gold underline-offset-4 hover:text-heading"
      >
        {st("checkout.openGiftLink")}
      </a>
    </div>
  );
}

export type OrderDownloadsVariant = "summary" | "full";

export function OrderDownloads({
  orderId,
  entitlements,
  /** §12: present when the customer arrived from an emailed receipt. Passed
   *  to every download call, so the buttons work on a device with no
   *  session — which is the entire point of the emailed link. */
  accessToken,
  /** "summary" on the success screen, "full" on the order page. Defaults to
   *  "full" so a caller that says nothing keeps every download available. */
  variant = "full",
}: {
  orderId: string;
  entitlements: ApiEntitlement[];
  accessToken?: string;
  variant?: OrderDownloadsVariant;
}) {
  const locale = useLocale();
  const st = (key: string) => resolveShellText(key, locale);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A digital entitlement has no bytes, so a pack archive cannot contain
  // it — the backend skips it for the same reason.
  const archivable = entitlements.filter((entitlement) => entitlement.targetId !== LIVE_TARGET_ID);

  /**
   * ONLY THE ARCHIVE IS OFFERED FOR FILES. This used to list every
   * entitlement as its own row beneath the pack button, so a customer who
   * had just paid faced eleven near-identical download buttons — three
   * print sizes in two mountings plus three wallpapers — with no guidance
   * on which they wanted. They want all of them; that is what a pack is.
   *
   * The rows remain for anything the archive genuinely cannot carry, which
   * today is only the digital (`__live__`) entitlement: it resolves to a
   * hosted URL, not bytes, so without a row there would be no way to reach
   * it at all.
   */
  const outsideArchive = entitlements.filter((entitlement) => entitlement.targetId === LIVE_TARGET_ID);

  /**
   * §14 — which category buttons to offer.
   *
   * Read from the entitlement target ids already on hand, by the SAME
   * prefix convention `infer_delivery_type`'s own fallback branch uses on
   * the backend (`print-`, `wallpaper-`) — not re-deriving the backend's
   * full pack-slug disambiguation client-side. That is safe here
   * specifically because this only decides which buttons are SHOWN; the
   * backend re-checks ownership, payment and category membership on every
   * one of these routes regardless, so a button shown by an imprecise
   * guess just means one extra click, never an unauthorized download.
   *
   * Bonuses has no flag: `BONUS_THANK_YOU` is unconditional on every
   * paid order (see `bonuses.py`), so if there is anything to show at
   * all, there is a bonuses zip.
   */
  const hasPrintable = entitlements.some((e) => e.targetId.startsWith("print-"));
  const hasWallpaper = entitlements.some((e) => e.targetId.startsWith("wallpaper-"));
  const hasLive = outsideArchive.length > 0;

  const full = variant === "full";
  const hasPack = archivable.length > 0;
  // With no archive to offer — a Digital-only order — the gift QR card is the
  // only thing there is to hand over, so it takes the primary slot.
  const cardIsPrimary = hasLive && !hasPack;
  const giftQrHref = `${API_BASE_PATH}/orders/${orderId}/qr/recipient${accessToken ? `/${accessToken}` : ""}/`;
  const filesHeadingId = useId();

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : cause instanceof DownloadIncompleteError
            ? st("checkout.downloadIncomplete")
            : st("checkout.downloadFailed")
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {hasPack && (
        <Button
          className="w-full"
          disabled={busy !== null}
          onClick={() => run("pack", () => downloadOrderPack(orderId, undefined, accessToken))}
        >
          {busy === "pack" ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {st("checkout.downloading")}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Download className="h-4 w-4" strokeWidth={1.75} />
              {st("checkout.downloadPack")}
            </span>
          )}
        </Button>
      )}

      {/*
        §16/§18d — the live page's QR card, for the gift RECIPIENT only. Shown
        in both variants: it is the gift.

        ONE CARD. This used to show two side by side: the buyer's own QR (which
        opened the order page) with its caption and an "open your live page"
        link, and the recipient's. The buyer's was removed on purpose — someone
        handing this keepsake to another person needs the recipient's card,
        which opens the live keepsake directly (see `apps/delivery/bonuses.py`'s
        `render_recipient_qr_card`), and the buyer already has their order page
        in front of them.

        "Download gift QR" saves THIS card (the one previewed) as a single PNG,
        with a plain link to the same endpoint the preview already uses — no new
        route. It is the primary action when there is no archive (Digital-only)
        and a quiet text link beside the archive button otherwise. The QR zip
        (both audiences, every design) is under "Download individual files".
      */}
      {hasLive && (
        <figure className="mx-auto flex w-full max-w-xs flex-col items-center gap-2 rounded-[var(--radius-md)] border border-subtle p-4">
          <p className="text-xs font-medium text-body/50">{st("checkout.qrForRecipient")}</p>
          <img
            src={giftQrHref}
            alt={st("checkout.qrRecipientAlt")}
            className="h-auto w-44 max-w-full rounded-[var(--radius-sm)]"
          />
          <figcaption className="text-center text-xs text-body/60">{st("checkout.qrRecipientCaption")}</figcaption>
          <Button
            asChild
            variant={cardIsPrimary ? "primary" : "ghost"}
            size={cardIsPrimary ? "default" : "sm"}
            className={cardIsPrimary ? "w-full" : undefined}
          >
            <a href={giftQrHref} download="heartfolio-gift-qr.png">
              <Download className="h-4 w-4" strokeWidth={1.75} />
              {st("checkout.downloadGiftQr")}
            </a>
          </Button>
          <GiftLink entitlementId={outsideArchive[0]!.id} accessToken={accessToken} st={st} />
        </figure>
      )}

      {/*
        §14 — the individual zips, FULL VARIANT ONLY (the order page). Not
        replacing the whole-pack button: each is a subset of it, kept for an
        audience (a print shop, someone who only wants the cards) and as a
        fallback that does not depend on the heavy artwork renders. Only the
        categories THIS order actually has appear — a Printable-only order never
        shows a QR zip that would just 404.

        Bonuses has no flag: `BONUS_THANK_YOU` is unconditional on every paid
        order (see `bonuses.py`), so there is always a bonuses zip — for a
        Digital-only order it is a single thank-you PDF, and it lives here, not
        on the success screen.
      */}
      {full && (
        <section aria-labelledby={filesHeadingId} className="space-y-2 border-t border-subtle pt-3">
          <h3 id={filesHeadingId} className="text-xs font-medium text-body/50">
            {st("checkout.individualFiles")}
          </h3>

          {(hasPrintable || hasWallpaper) && (
            <div className="grid grid-cols-2 gap-2">
              {hasPrintable && (
                <CategoryButton
                  category="printable"
                  label={st("checkout.downloadPrintable")}
                  busy={busy}
                  onDownload={run}
                  orderId={orderId}
                  accessToken={accessToken}
                />
              )}
              {hasWallpaper && (
                <CategoryButton
                  category="wallpapers"
                  label={st("checkout.downloadWallpapers")}
                  busy={busy}
                  onDownload={run}
                  orderId={orderId}
                  accessToken={accessToken}
                />
              )}
            </div>
          )}

          <CategoryButton
            category="bonuses"
            label={st("checkout.downloadBonuses")}
            busy={busy}
            onDownload={run}
            orderId={orderId}
            accessToken={accessToken}
          />

          {/*
            ONE download for the QR cards. The buyer's and the recipient's cards
            used to have a button each; they are one zip, so someone handing this
            keepsake to another person gets every design in the same place. Note
            the zip still carries the buyer's card designs too (backend) even
            though only the recipient's card is previewed above.
          */}
          {hasLive && (
            <CategoryButton
              category="live-cards"
              label={st("checkout.downloadLiveCards")}
              busy={busy}
              onDownload={run}
              orderId={orderId}
              accessToken={accessToken}
            />
          )}
        </section>
      )}

      {/* Same error treatment used throughout the checkout flow. */}
      {error && <p className="text-xs text-error-warm">{error}</p>}
    </div>
  );
}
