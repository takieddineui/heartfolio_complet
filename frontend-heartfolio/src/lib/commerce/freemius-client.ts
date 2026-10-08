/**
 * Freemius Checkout overlay, browser side (sandbox review build).
 *
 * WHAT THIS IS AND IS NOT AUTHORITATIVE FOR: opening the overlay and
 * reporting what it reported. It is NOT proof of payment on its own —
 * see `checkout-engine.ts`'s `completeFreemiusCheckout`/
 * `waitForStagedOrder` for why: the overlay's own `license_id` is a
 * lookup key the backend re-verifies against Freemius's API, never
 * trusted as-is (mirrors this file's own `openPaddleCheckout` sibling,
 * which treats `checkout.completed` the same way).
 *
 * NO SDK PACKAGE, NO SKILL AUTOMATION — deliberate, matching the
 * hand-rolled integration decision. Freemius's own docs publish a plain
 * `<script src="https://checkout.freemius.com/js/v1/">` that exposes a
 * global `FS.Checkout` constructor; loaded lazily here, once, the same
 * reason `@paddle/paddle-js` is imported lazily in `paddle-client.ts` —
 * nobody browsing the storefront should download a payments script.
 */

export type FreemiusCheckoutOutcome = "completed" | "closed" | "error";

export interface FreemiusPurchaseData {
  licenseId: string;
  planId: string;
}

export interface FreemiusSandbox {
  token: string;
  ctx: string;
}

const FREEMIUS_SCRIPT_URL = "https://checkout.freemius.com/js/v1/";

declare global {
  interface Window {
    FS?: {
      Checkout: new (options: Record<string, unknown>) => FreemiusCheckoutInstance;
    };
  }
}

interface FreemiusCheckoutInstance {
  open(options: Record<string, unknown>): void;
}

let scriptPromise: Promise<void> | null = null;

function loadFreemiusScript(): Promise<void> {
  if (window.FS?.Checkout) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = FREEMIUS_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Freemius checkout script failed to load."));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface FreemiusCheckoutOptions {
  productId: string;
  /** Not secret — Freemius's own generated buy-button snippet puts this
   * directly in the constructor, sandbox and live checkouts alike. */
  publicKey: string;
  planId: string;
  pricingId?: string | null;
  /** Absent entirely once the backend is confirmed live — see
   * `FreemiusStagingSerializer.get_sandbox` on the backend, which never
   * computes or returns one once `FREEMIUS_LIVE_CONFIRMED=true`. */
  sandbox?: FreemiusSandbox | null;
  email?: string;
  locale?: string;
}

/**
 * Opens the overlay for a plan staged server-side and resolves once the
 * customer finishes or dismisses it.
 *
 * `completed` hands back `{licenseId, planId}` — the lookup key for
 * `completeFreemiusCheckout`, not proof of payment. `closed` is not a
 * failure: the customer may have paid and closed the confirmation
 * screen before the callback fired, same reasoning `openPaddleCheckout`
 * already documents for its own `closed` outcome — the caller falls
 * back to polling in both cases rather than assuming.
 */
export async function openFreemiusCheckout(
  options: FreemiusCheckoutOptions
): Promise<{ outcome: FreemiusCheckoutOutcome; purchase: FreemiusPurchaseData | null }> {
  await loadFreemiusScript();
  const FS = window.FS;
  if (!FS) throw new Error("Freemius checkout script loaded but window.FS is missing.");

  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome: FreemiusCheckoutOutcome, purchase: FreemiusPurchaseData | null = null) => {
      if (settled) return;
      settled = true;
      resolve({ outcome, purchase });
    };

    let checkout: FreemiusCheckoutInstance;
    try {
      checkout = new FS.Checkout({
        product_id: options.productId,
        public_key: options.publicKey,
        plan_id: options.planId,
        ...(options.pricingId ? { pricing_id: options.pricingId } : {}),
        ...(options.sandbox ? { sandbox: options.sandbox } : {}),
      });
    } catch {
      settle("error");
      return;
    }

    try {
      checkout.open({
        ...(options.email ? { user_email: options.email, readonly_user: true } : {}),
        ...(options.locale ? { language: options.locale } : {}),
        purchaseCompleted: (data: { purchase?: { license_id?: string; plan_id?: string } }) => {
          // Confirmed against a real sandbox purchase: the callback nests
          // these under `purchase`, not at the top level — `{ user: {...},
          // purchase: { license_id, plan_id, ... } }`. An earlier version
          // of this handler read them flat and would have reported every
          // real purchase as "error".
          const licenseId = data?.purchase?.license_id;
          if (!licenseId) {
            settle("error");
            return;
          }
          settle("completed", { licenseId: String(licenseId), planId: String(data.purchase?.plan_id ?? options.planId) });
        },
        cancel: () => settle("closed"),
      });
    } catch {
      settle("error");
    }
  });
}
