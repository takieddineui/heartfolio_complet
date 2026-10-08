"use client";

import Script from "next/script";
import { useSyncExternalStore } from "react";

/**
 * ---------------------------------------------------------------------
 * ANALYTICS — TWO LAYERS, ONLY ONE OF WHICH NEEDS PERMISSION
 * ---------------------------------------------------------------------
 * **Plausible runs always.** It sets no cookies, stores no identifiers and
 * cannot follow anyone between sites, which is what takes it outside the
 * consent requirement rather than a claim made about it. It is loaded
 * unconditionally so the basic question — is anyone visiting, and from
 * where — has an answer even from visitors who decline everything, which is
 * most of them.
 *
 * **GA4 runs only after explicit consent.** It sets identifying cookies, so
 * under GDPR it needs opt-in before it loads — not a banner that appears
 * while the script is already running, which is the common and useless
 * arrangement. The script is not in the DOM until `granted`.
 *
 * WHY THE DEFAULT IS DENIED
 * -------------------------
 * `localStorage` is read once on mount. Absent means undecided, which is
 * treated as denied: pre-loading GA4 and removing it if someone declines
 * would already have set the cookies and sent the first pageview. There is
 * no undo for a request that has been made.
 *
 * The stored value is a single string, set only by a deliberate click. No
 * fingerprinting, no implied consent from scrolling, no "by continuing to
 * browse you agree".
 */

const CONSENT_KEY = "heartfolio-analytics-consent";

export type ConsentState = "granted" | "denied" | "undecided";

export function readConsent(): ConsentState {
  if (typeof window === "undefined") return "undecided";
  try {
    const stored = window.localStorage.getItem(CONSENT_KEY);
    return stored === "granted" || stored === "denied" ? stored : "undecided";
  } catch {
    // Private browsing, or storage disabled entirely. Undecided is the safe
    // reading — it withholds GA4 rather than assuming permission.
    return "undecided";
  }
}

export function writeConsent(state: Exclude<ConsentState, "undecided">) {
  try {
    window.localStorage.setItem(CONSENT_KEY, state);
  } catch {
    // If it cannot be stored the banner reappears next visit, which is
    // annoying but correct — a consent we cannot record is not a consent
    // we can rely on.
  }
  window.dispatchEvent(new CustomEvent("heartfolio-consent", { detail: state }));
}

/**
 * Subscribes to consent changes. Shared by `useConsent` below and by the
 * banner, so both read the same value from the same source at the same
 * time — two independent `useState` copies could disagree for a render.
 */
function subscribeToConsent(onChange: () => void) {
  window.addEventListener("heartfolio-consent", onChange);
  return () => window.removeEventListener("heartfolio-consent", onChange);
}

/**
 * Reads consent without setting state inside an effect.
 *
 * The obvious implementation — `useState("undecided")` plus a
 * `useEffect` that reads `localStorage` and calls `setState` — is the exact
 * pattern §17 removed from two hooks in this codebase, and it renders once
 * with the wrong value before correcting itself. Here that would mean a
 * visitor who accepted last month seeing the banner flash on every page
 * load.
 *
 * `useSyncExternalStore` exists for precisely this: a value that lives
 * outside React, differs between server and client, and changes over time.
 * The server snapshot is "undecided" because the server genuinely cannot
 * know, and the client reads storage during render without an effect.
 */
export function useConsent(): ConsentState {
  return useSyncExternalStore(
    subscribeToConsent,
    readConsent,
    () => "undecided" as const
  );
}

export function Analytics() {
  const consent = useConsent();

  const plausibleDomain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  const gaId = process.env.NEXT_PUBLIC_GA_ID;

  return (
    <>
      {/* Cookieless. No consent gate, because there is nothing to consent to. */}
      {plausibleDomain && (
        <Script
          defer
          data-domain={plausibleDomain}
          src="https://plausible.io/js/script.js"
          strategy="afterInteractive"
        />
      )}

      {/* Only ever mounted after an explicit grant. */}
      {gaId && consent === "granted" && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              // Belt and braces: even here, ad signals stay off. Consent was
              // given for measurement, not for advertising profiles.
              gtag('consent', 'default', {
                ad_storage: 'denied',
                ad_user_data: 'denied',
                ad_personalization: 'denied',
                analytics_storage: 'granted'
              });
              gtag('config', '${gaId}', { anonymize_ip: true });
            `}
          </Script>
        </>
      )}
    </>
  );
}
