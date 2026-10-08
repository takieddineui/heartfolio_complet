import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareOrder, startPayment, waitForPaidOrder } from "./checkout-engine";
import { createOrder } from "@/lib/api/orders";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function setCookie(value: string) {
  Object.defineProperty(document, "cookie", { value, writable: true, configurable: true });
}

const ORDER = {
  id: "o-1",
  orderId: "o-1",
  productId: "heart-map",
  deliveryPackId: "printable",
  projectId: "p-1",
  guestEmail: "a@b.com",
  currency: "USD",
  subtotalCents: 1800,
  discountCents: 0,
  totalCents: 1800,
  status: "pending",
  paymentProvider: "paddle",
  paymentStatus: "pending",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function bodyOf(mock: { mock: { calls: unknown[][] } }, index = 0): Record<string, unknown> {
  const call = mock.mock.calls[index];
  if (!call) throw new Error(`fetch call #${index} never happened`);
  return JSON.parse(String((call[1] as RequestInit).body));
}

describe("order creation cannot be price-tampered", () => {
  beforeEach(() => setCookie("csrftoken=t"));
  afterEach(() => vi.restoreAllMocks());

  it("sends only identifiers — no amount, currency or total", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(ORDER, 201));
    vi.stubGlobal("fetch", fetchMock);

    await createOrder("heart-map", "printable", "p-1", "en");

    const body = bodyOf(fetchMock);
    // `locale` joined this list deliberately — it is the language the order
    // is recorded in, and it carries no commercial meaning. The exhaustive
    // key check is the point of this test: any *new* field has to be added
    // here consciously, which is what would stop a price sneaking in.
    expect(Object.keys(body).sort()).toEqual([
      "deliveryPackId",
      "locale",
      "productId",
      "projectId",
    ]);
    for (const forbidden of ["totalCents", "subtotalCents", "priceCents", "amount", "currency", "total"]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it("sends the locale so the delivered keepsake knows its own language", async () => {
    // Recorded at purchase rather than read at download: re-downloading from
    // a differently-configured browser must return the artifact that was
    // bought, not a re-rendered one.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(ORDER, 201));
    vi.stubGlobal("fetch", fetchMock);

    await createOrder("heart-map", "printable", "p-1", "ar");
    expect(bodyOf(fetchMock).locale).toBe("ar");
  });

  it("sends the Django product slug, never the public one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(ORDER, 201));
    vi.stubGlobal("fetch", fetchMock);

    await createOrder("heart-map", "printable", "p-1", "en");
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain("where-we-met");
  });
});

describe("prepareOrder sequencing", () => {
  beforeEach(() => setCookie("csrftoken=t"));
  afterEach(() => vi.restoreAllMocks());

  it("identifies, saves the project, then orders — in that order", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const path = url.replace("/api/backend", "");
        calls.push(`${init?.method ?? "GET"} ${path}`);
        if (path === "/guest") return jsonResponse({ customerId: "c-1", email: "a@b.com" });
        if (path === "/projects") return jsonResponse({ ...ORDER, projectId: "p-1", productId: "heart-map", data: {}, status: "draft" }, 201);
        if (path === "/orders") return jsonResponse(ORDER, 201);
        return jsonResponse({});
      })
    );

    const stages: string[] = [];
    await prepareOrder(
      {
        productId: "heart-map",
        deliveryPackId: "printable",
        email: "a@b.com",
        values: { partner1: "A" },
        themeSelections: { palette: "dusk" },
        locale: "en",
      },
      (stage) => stages.push(stage)
    );

    // The project must exist before the order: the delivery renderer raises
    // without one, so an order created first would take money for something
    // that can never be produced.
    const projectIndex = calls.findIndex((c) => c === "POST /projects");
    const orderIndex = calls.findIndex((c) => c === "POST /orders");
    expect(projectIndex).toBeGreaterThan(-1);
    expect(orderIndex).toBeGreaterThan(projectIndex);
    expect(stages).toEqual(["identifying", "uploading", "saving", "ordering"]);
  });
});

describe("payment status is never decided in the browser", () => {
  beforeEach(() => setCookie("csrftoken=t"));
  afterEach(() => vi.restoreAllMocks());

  it("returns the Paddle handle without treating it as payment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          order: ORDER,
          payment: null,
          checkout: { provider: "paddle", transactionId: "txn_1", clientToken: "test_token" },
        })
      )
    );

    const { order, checkout } = await startPayment("o-1");
    expect(checkout?.transactionId).toBe("txn_1");
    // The order is still pending: opening a checkout is not paying for it.
    expect(order.status).toBe("pending");
  });

  it("keeps polling while the order is pending, and reports paid only when Django says so", async () => {
    const responses = [
      jsonResponse({ ...ORDER, status: "pending" }),
      jsonResponse({ ...ORDER, status: "pending" }),
      jsonResponse({ ...ORDER, status: "paid", paymentStatus: "success" }),
    ];
    const fetchMock = vi.fn().mockImplementation(async () => responses.shift() ?? jsonResponse({ ...ORDER, status: "paid" }));
    vi.stubGlobal("fetch", fetchMock);

    const { order, outcome } = await waitForPaidOrder("o-1", { intervalMs: 1, timeoutMs: 5000 });

    expect(outcome).toBe("paid");
    expect(order.status).toBe("paid");
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("reports pending — not failed — when the webhook has not arrived in time", async () => {
    // A customer may genuinely have paid; calling this a failure would be
    // false and would send them to a "try again" screen after being charged.
    // A fresh Response per call: a Response body can only be read once, so
    // reusing one instance would make the second poll look like a failure.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => jsonResponse({ ...ORDER, status: "pending" })));

    const { outcome } = await waitForPaidOrder("o-1", { intervalMs: 1, timeoutMs: 20 });
    expect(outcome).toBe("pending");
  });

  it("surfaces a genuinely failed order as failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => jsonResponse({ ...ORDER, status: "failed" })));
    const { outcome } = await waitForPaidOrder("o-1", { intervalMs: 1, timeoutMs: 50 });
    expect(outcome).toBe("failed");
  });
});
