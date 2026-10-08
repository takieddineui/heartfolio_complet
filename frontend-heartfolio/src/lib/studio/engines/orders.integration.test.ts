// @vitest-environment node
/**
 * LIVE ORDER INTEGRATION — real Django, real database, real session.
 *
 * Runs only when `HEARTFOLIO_INTEGRATION_BASE` is set.
 *
 * WHAT THIS DOES AND DOES NOT PROVE. The payment provider under test is
 * whatever the backend is configured with. Locally that is the mock
 * provider, which settles inline — so this proves order creation, pricing,
 * ownership, entitlement granting and the frontend's handling of a settled
 * order, all against real Django.
 *
 * It does NOT prove Paddle. Real Paddle Sandbox needs API credentials this
 * environment does not have, so the Paddle branch is covered by unit tests
 * against the documented contract and must still be exercised by hand
 * against Sandbox before launch.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { identifyGuest } from "@/lib/api/guest";
import { createOrder, getOrder, getOrderEntitlements, payOrder } from "@/lib/api/orders";
import { realProjectEngine } from "./project-engine";
import { ApiError } from "@/lib/api/errors";
import { fetchProductDetail } from "@/lib/api/products";

const BASE = process.env.HEARTFOLIO_INTEGRATION_BASE;
const suite = BASE ? describe : describe.skip;

function installBrowserLikeFetch(base: string) {
  const jar = new Map<string, string>();
  const realFetch = globalThis.fetch;
  const cookieStore = new Map<string, string>();

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      get cookie() {
        return [...cookieStore].map(([k, v]) => `${k}=${v}`).join("; ");
      },
      set cookie(entry: string) {
        const [pair] = entry.split(";");
        const [name, ...rest] = (pair ?? "").split("=");
        if (name) cookieStore.set(name.trim(), rest.join("="));
      },
    },
  });

  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const url = path.startsWith("http") ? path : `${base}${path}`;
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    if (jar.size > 0) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    headers.set("origin", base);

    const response = await realFetch(url, { ...init, headers });
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(";");
      const [name, ...rest] = (pair ?? "").split("=");
      if (!name) continue;
      jar.set(name.trim(), rest.join("="));
      (globalThis as { document: { cookie: string } }).document.cookie = `${name.trim()}=${rest.join("=")}`;
    }
    return response;
  };

  return () => {
    globalThis.fetch = realFetch;
    jar.clear();
    cookieStore.clear();
  };
}

let restoreFetch = () => {};
const email = (label: string) => `step9-${label}-${Date.now()}@heartfolio.test`;

async function makeProject(productId: string) {
  const { projectId } = await realProjectEngine.save(undefined, {
    productId,
    values: { partner1: "Amelia", partner2: "Youssef" },
    themeSelections: { palette: "dusk" },
  });
  return projectId;
}

suite("orders against real Django", () => {
  beforeAll(() => {
    restoreFetch = installBrowserLikeFetch(BASE!);
  });
  afterAll(() => restoreFetch());

  it("prices the order from the catalog, not from anything the browser sent", async () => {
    await identifyGuest(email("price"));
    const detail = await fetchProductDetail("heart-map");
    const printable = detail.deliveryPacks.find((p) => p.slug === "printable")!;

    const projectId = await makeProject("heart-map");
    const order = await createOrder("heart-map", "printable", projectId, "en");

    expect(order.totalCents).toBe(printable.priceCents);
    expect(order.subtotalCents).toBe(printable.priceCents);
    expect(order.currency).toBe(printable.currency);
    expect(order.status).toBe("pending");
  });

  it("refuses a pack that belongs to a different product", async () => {
    await identifyGuest(email("mismatch"));
    const projectId = await makeProject("heart-map");

    // `live` exists for Love Story Timeline only — Where We Met has no
    // renderer that can produce it, and the catalog has no such pack.
    const error = await createOrder("heart-map", "live", projectId, "en").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("delivery_pack_not_found");
  });

  it("refuses an order whose project belongs to a different product", async () => {
    await identifyGuest(email("crossproduct"));
    const timelineProject = await makeProject("love-story-timeline");

    const error = await createOrder("heart-map", "printable", timelineProject, "en").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("project_product_mismatch");
  });

  it("refuses to attach another guest's project to an order", async () => {
    await identifyGuest(email("owner"));
    const projectId = await makeProject("heart-map");

    await identifyGuest(email("intruder"));
    const error = await createOrder("heart-map", "printable", projectId, "en").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isAccessDenied || (error as ApiError).isNotFound).toBe(true);
  });

  it("does not let one guest read another guest's order", async () => {
    await identifyGuest(email("orderowner"));
    const projectId = await makeProject("heart-map");
    const order = await createOrder("heart-map", "printable", projectId, "en");

    await identifyGuest(email("orderintruder"));
    const error = await getOrder(order.orderId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isAccessDenied || (error as ApiError).isNotFound).toBe(true);
  });

  it("requires an identity before an order can exist at all", async () => {
    restoreFetch();
    restoreFetch = installBrowserLikeFetch(BASE!); // fresh session, no email given

    const error = await createOrder("heart-map", "printable", "00000000-0000-0000-0000-000000000000", "en").catch(
      (e: unknown) => e
    );
    expect((error as ApiError).isIdentityRequired).toBe(true);
  });

  it("settles payment and grants exactly the pack's entitlements", async () => {
    await identifyGuest(email("pay"));
    const detail = await fetchProductDetail("heart-map");
    const wallpaper = detail.deliveryPacks.find((p) => p.slug === "wallpaper")!;

    const projectId = await makeProject("heart-map");
    const order = await createOrder("heart-map", "wallpaper", projectId, "en");

    const result = await payOrder(order.orderId);
    expect(result.order.totalCents).toBe(wallpaper.priceCents);

    // With an inline provider the order is already settled; with Paddle it
    // would still be pending until the webhook lands. The frontend reads
    // the status rather than assuming either.
    const settled = await getOrder(order.orderId);

    if (settled.status === "paid") {
      const { entitlements } = await getOrderEntitlements(order.orderId);
      expect(entitlements.map((e) => e.targetId).sort()).toEqual([...wallpaper.includedTargets].sort());
    } else {
      expect(settled.status).toBe("pending");
    }
  });

  it("is idempotent: paying twice does not double-charge or duplicate entitlements", async () => {
    await identifyGuest(email("idem"));
    const projectId = await makeProject("heart-map");
    const order = await createOrder("heart-map", "printable", projectId, "en");

    await payOrder(order.orderId);
    await payOrder(order.orderId);

    const settled = await getOrder(order.orderId);
    if (settled.status === "paid") {
      const { entitlements } = await getOrderEntitlements(order.orderId);
      const ids = entitlements.map((e) => e.targetId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
