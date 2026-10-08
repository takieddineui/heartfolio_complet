import { afterEach, describe, expect, it, vi } from "vitest";
import { getPaddleEnvironment, openPaddleCheckout, toPaddleLocale } from "./paddle-client";

describe("toPaddleLocale", () => {
  it("passes through the locales Paddle checkout supports", () => {
    expect(toPaddleLocale("en")).toBe("en");
    expect(toPaddleLocale("fr")).toBe("fr");
  });

  it("falls back to English for Arabic, which Paddle checkout does not support", () => {
    // Documented, deliberate fallback — see PADDLE_LOCALES. Heartfolio's own
    // UI stays Arabic and RTL; only the payment overlay is English.
    expect(toPaddleLocale("ar")).toBe("en");
  });

  it("falls back to English for anything unrecognised", () => {
    expect(toPaddleLocale("de")).toBe("en");
    expect(toPaddleLocale("")).toBe("en");
  });
});

describe("getPaddleEnvironment", () => {
  const original = process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT;
  afterEach(() => {
    process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT = original;
  });

  it("defaults to sandbox when unset, so a missing variable never means live payments", () => {
    delete process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT;
    expect(getPaddleEnvironment()).toBe("sandbox");
  });

  it("uses production only when explicitly told to", () => {
    process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT = "production";
    expect(getPaddleEnvironment()).toBe("production");

    process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT = "anything-else";
    expect(getPaddleEnvironment()).toBe("sandbox");
  });
});

describe("openPaddleCheckout", () => {
  afterEach(() => vi.restoreAllMocks());

  /** Waits until `Paddle.Update` has been called, then returns the
   * eventCallback the implementation registered. `openPaddleCheckout`
   * awaits a dynamic import first, so this cannot be read synchronously. */
  async function eventCallbackOf(update: { mock: { calls: unknown[][] } }) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const registered = (update.mock.calls[0]?.[0] as { eventCallback?: (e: { name: string }) => void })
        ?.eventCallback;
      if (registered) return registered;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Paddle.Update was never called with an eventCallback");
  }

  function stubPaddle() {
    const open = vi.fn();
    const update = vi.fn();
    const paddle = { Checkout: { open }, Update: update };

    vi.doMock("@paddle/paddle-js", () => ({
      initializePaddle: vi.fn().mockResolvedValue(paddle),
    }));
    return { open, update, paddle };
  }

  it("opens the server-created transaction and never sends an amount", async () => {
    const { open, update } = stubPaddle();
    vi.resetModules();
    const { openPaddleCheckout: open_ } = await import("./paddle-client");

    const promise = open_("txn_123", "test_token", { email: "a@b.com", locale: "fr", theme: "dark" });

    // Fire the completion event the SDK would emit.
    (await eventCallbackOf(update))({ name: "checkout.completed" });
    await promise;

    const options = open.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options.transactionId).toBe("txn_123");

    // Prefill only — the price lives on the transaction Django created.
    expect(options.customer).toEqual({ email: "a@b.com" });
    for (const forbidden of ["items", "amount", "price", "unitPrice", "total"]) {
      expect(options).not.toHaveProperty(forbidden);
    }
  });

  it("applies the mapped locale and the site theme", async () => {
    const { open, update } = stubPaddle();
    vi.resetModules();
    const { openPaddleCheckout: open_ } = await import("./paddle-client");

    const promise = open_("txn_1", "tok", { locale: "ar", theme: "dark" });
    (await eventCallbackOf(update))({ name: "checkout.closed" });
    await promise;

    const settings = (open.mock.calls[0]?.[0] as { settings: Record<string, unknown> }).settings;
    expect(settings.locale).toBe("en"); // Arabic fallback
    expect(settings.theme).toBe("dark");
  });

  it("never sets successUrl, so a redirect can never stand in for payment confirmation", async () => {
    const { open, update } = stubPaddle();
    vi.resetModules();
    const { openPaddleCheckout: open_ } = await import("./paddle-client");

    const promise = open_("txn_1", "tok", {});
    (await eventCallbackOf(update))({ name: "checkout.completed" });
    await promise;

    const settings = (open.mock.calls[0]?.[0] as { settings: Record<string, unknown> }).settings;
    expect(settings).not.toHaveProperty("successUrl");
  });

  it.each([
    ["checkout.completed", "completed"],
    ["checkout.closed", "closed"],
    ["checkout.error", "error"],
  ])("reports %s as %s", async (eventName, expected) => {
    const { update } = stubPaddle();
    vi.resetModules();
    const { openPaddleCheckout: open_ } = await import("./paddle-client");

    const promise = open_("txn_1", "tok");
    (await eventCallbackOf(update))({ name: eventName });

    // None of these outcomes means "paid" — the caller polls Django either
    // way, because a customer can pay and dismiss the overlay before the
    // completion event fires.
    await expect(promise).resolves.toBe(expected);
  });
});

// Referenced so the top-level import is exercised even when the mocked
// module variants are used above.
void openPaddleCheckout;
