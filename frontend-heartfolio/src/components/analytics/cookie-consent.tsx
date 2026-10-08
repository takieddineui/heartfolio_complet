"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { useConsent, writeConsent } from "@/components/analytics/analytics";

/**
 * ---------------------------------------------------------------------
 * COOKIE CONSENT (GDPR)
 * ---------------------------------------------------------------------
 * Shown only while the choice is genuinely undecided. Once someone has
 * answered either way it never appears again, because a banner that keeps
 * asking after a "no" is asking someone to change their mind, not asking
 * for consent.
 *
 * DECLINE IS AS EASY AS ACCEPT. Both are buttons, side by side, same size,
 * same prominence. A greyed-out "manage preferences" link beside a large
 * green "Accept all" is the pattern regulators have specifically ruled
 * against, and it is also just dishonest.
 *
 * WHAT IT DOES NOT CLAIM. It does not say "we use cookies to improve your
 * experience" — the only optional cookies here are Google Analytics, and
 * the text says so. Declining costs the visitor nothing: the site is fully
 * functional, and the cookieless analytics that run either way are named
 * rather than hidden.
 *
 * RENDERED AFTER MOUNT, never during SSR. The server has no way to know
 * what this browser has already chosen, so rendering it server-side would
 * flash a banner at people who declined months ago.
 *
 * ACCESSIBILITY: `role="dialog"` with a label, but deliberately NOT a focus
 * trap. This is not a modal — the page underneath is usable and the visitor
 * is free to ignore it. Trapping focus would make an optional choice
 * mandatory for keyboard users while remaining optional for everyone else.
 */
export function CookieConsent() {
  const t = useTranslations("CookieConsent");
  // Same source as `Analytics`, so the two cannot disagree for a render —
  // and no setState in an effect, which would flash the banner at someone
  // who accepted months ago. See `useConsent`.
  const consent = useConsent();

  if (consent !== "undecided") return null;

  function choose(state: "granted" | "denied") {
    // No local state to update: `writeConsent` dispatches the event that
    // both this component and `Analytics` are subscribed to.
    writeConsent(state);
  }

  return (
    <div
      role="dialog"
      aria-label={t("label")}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-subtle bg-card/95 p-4 backdrop-blur sm:p-5"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-relaxed text-body/80">
          {t("body")}{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-heading">
            {t("privacyLink")}
          </Link>
        </p>
        <div className="flex shrink-0 gap-2">
          {/* Decline first in the DOM: it reaches a screen reader and a
              keyboard first, and it is the choice that requires no trust. */}
          <Button variant="secondary" onClick={() => choose("denied")} className="flex-1 sm:flex-none">
            {t("decline")}
          </Button>
          <Button onClick={() => choose("granted")} className="flex-1 sm:flex-none">
            {t("accept")}
          </Button>
        </div>
      </div>
    </div>
  );
}
