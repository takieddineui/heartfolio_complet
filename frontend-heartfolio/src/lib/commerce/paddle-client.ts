/**
 * Paddle Sandbox checkout, browser side.
 *
 * WHAT THIS IS AND IS NOT AUTHORITATIVE FOR: opening Paddle's overlay and
 * reporting that the customer finished or closed it. It is NOT a source of
 * truth for payment. `checkout.completed` means the browser saw a
 * completion screen; the money is confirmed server-side by the
 * signature-verified `transaction.paid` webhook, and the only trustworthy
 * signal in this app is `order.status === "paid"` read back from Django.
 *
 * NO SECRETS LIVE HERE. The client token arrives in the `POST /orders/{id}/pay/`
 * response and is Paddle's public, client-side token. The Paddle API key and
 * webhook secret exist only on the server and appear in no API response.
 *
 * The SDK is imported lazily so it stays out of the main bundle — nobody
 * browsing the storefront should download a payments SDK.
 */

import type { Paddle } from "@paddle/paddle-js";

export type PaddleEnvironment = "sandbox" | "production";

/** Sandbox unless explicitly told otherwise. Deliberately fail-safe: a
 * missing variable must not silently point a test at live payments. */
export function getPaddleEnvironment(): PaddleEnvironment {
  return process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT === "production" ? "production" : "sandbox";
}

let paddlePromise: Promise<Paddle | undefined> | null = null;
let initialisedToken: string | null = null;

/**
 * Initialises Paddle.js once per client token. Repeated checkout attempts
 * reuse the same instance rather than re-injecting the SDK.
 */
async function getPaddle(clientToken: string): Promise<Paddle> {
  if (!paddlePromise || initialisedToken !== clientToken) {
    initialisedToken = clientToken;
    const { initializePaddle } = await import("@paddle/paddle-js");
    paddlePromise = initializePaddle({
      token: clientToken,
      environment: getPaddleEnvironment(),
    });
  }

  const paddle = await paddlePromise;
  if (!paddle) {
    paddlePromise = null;
    throw new Error("Paddle.js failed to initialise.");
  }
  return paddle;
}

export type PaddleCheckoutOutcome = "completed" | "closed" | "error";

/**
 * Heartfolio locale -> Paddle checkout locale.
 *
 * Paddle publishes a fixed list of supported checkout locales, and Arabic
 * is not on it. Passing `ar` would either be ignored or error, so it maps
 * explicitly to English — the same thing that would happen implicitly, but
 * visible here rather than a surprise in production.
 *
 * This is the ONE place the Arabic fallback is decided. If Paddle adds
 * Arabic, this map is the only edit.
 */
const PADDLE_LOCALES: Record<string, string> = {
  en: "en",
  fr: "fr",
  ar: "en", // not supported by Paddle checkout — documented fallback
};

export function toPaddleLocale(locale: string): string {
  return PADDLE_LOCALES[locale] ?? "en";
}

export interface PaddleCheckoutOptions {
  /** Prefills the overlay so the customer doesn't retype the address they
   * just gave us. It is the same email the order was created under. */
  email?: string;
  /** Heartfolio locale (`en` | `fr` | `ar`); mapped above. */
  locale?: string;
  /** Matches the site's light/dark mode, so handing over card details
   * doesn't mean a white overlay flashing over a dark page. */
  theme?: "light" | "dark";
}

/**
 * Opens the overlay for a transaction created server-side and resolves once
 * the customer finishes or dismisses it.
 *
 * `completed` deliberately does not mean "paid" — the caller must confirm
 * with Django. `closed` is not a failure either: the customer may have paid
 * and closed the overlay before the event fired, so the caller polls in both
 * cases rather than assuming.
 */
export async function openPaddleCheckout(
  transactionId: string,
  clientToken: string,
  options: PaddleCheckoutOptions = {}
): Promise<PaddleCheckoutOutcome> {
  const paddle = await getPaddle(clientToken);

  return new Promise<PaddleCheckoutOutcome>((resolve) => {
    let settled = false;
    const settle = (outcome: PaddleCheckoutOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    paddle.Update({
      eventCallback: (event) => {
        if (event.name === "checkout.completed") settle("completed");
        if (event.name === "checkout.closed") settle("closed");
        if (event.name === "checkout.error") settle("error");
      },
    });

    try {
      paddle.Checkout.open({
        transactionId,
        // Prefill only. The amount, currency and line item all come from
        // the transaction Django created — nothing chargeable is set here.
        ...(options.email ? { customer: { email: options.email } } : {}),
        settings: {
          locale: toPaddleLocale(options.locale ?? "en"),
          ...(options.theme ? { theme: options.theme } : {}),
          // `successUrl` is deliberately NOT set. A redirect would hand the
          // flow to Paddle and make the browser's arrival at a success page
          // look like proof of payment. Payment is confirmed only by the
          // signature-verified webhook, which the caller polls for.
        },
      });
    } catch {
      settle("error");
    }
  });
}
