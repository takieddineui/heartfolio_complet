// @vitest-environment node
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPTURE_WORK_DIR, captureModeEnabled } from "./capture-mode";

/**
 * The capture page and its photo route render fictional sample keepsakes for
 * the storefront's recordings (`scripts/captures/record.mjs`). They must stay
 * unreachable on the live site: open only on a development server started
 * with `HEARTFOLIO_CAPTURE=1`. The proxy is the first lock (`proxy.test.ts`);
 * these are the second.
 */

class NotFoundSignal extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundSignal("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl/server", () => ({ setRequestLocale: () => {} }));
vi.mock("@/components/live/live-payload", () => ({ LivePayloadView: () => null }));
vi.mock("@/lib/captures/capture-payload", () => ({
  readCapturePayload: async () => ({ productId: "song-poster", locale: "en", values: {} }),
}));

const { default: CapturePage } = await import("@/app/[locale]/capture/[product]/page");
const { GET } = await import("@/app/capture-assets/[file]/route");

const page = (product = "song-poster") => CapturePage({ params: Promise.resolve({ locale: "en", product }) });
const asset = (file: string) => GET(new Request(`http://localhost/capture-assets/${file}`), { params: Promise.resolve({ file }) });

afterEach(() => vi.unstubAllEnvs());

describe("captureModeEnabled", () => {
  it.each([
    [{ HEARTFOLIO_CAPTURE: "1", NODE_ENV: "development" }, true],
    [{ HEARTFOLIO_CAPTURE: "1", NODE_ENV: "test" }, true],
    [{ HEARTFOLIO_CAPTURE: "1", NODE_ENV: "production" }, false],
    [{ HEARTFOLIO_CAPTURE: "true", NODE_ENV: "development" }, false],
    [{ NODE_ENV: "development" }, false],
  ])("%j -> %s", (env, expected) => {
    expect(captureModeEnabled(env)).toBe(expected);
  });
});

describe("the capture page", () => {
  it("is not found when capture mode is off", async () => {
    vi.stubEnv("HEARTFOLIO_CAPTURE", "");
    await expect(page()).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it("is not found in a production build, flag or not", async () => {
    vi.stubEnv("HEARTFOLIO_CAPTURE", "1");
    vi.stubEnv("NODE_ENV", "production");
    await expect(page()).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it("is not found for a product it has no sample of", async () => {
    vi.stubEnv("HEARTFOLIO_CAPTURE", "1");
    await expect(page("heart-map")).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it("renders the sample when the server was started for captures", async () => {
    vi.stubEnv("HEARTFOLIO_CAPTURE", "1");
    await expect(page()).resolves.toBeTruthy();
  });
});

describe("the capture photo route", () => {
  const dir = join(process.cwd(), CAPTURE_WORK_DIR, "assets");
  const name = "capture-lock-test.jpg";

  it("answers 404 when capture mode is off, even for a file that exists", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), "jpeg");
    try {
      vi.stubEnv("HEARTFOLIO_CAPTURE", "");
      expect((await asset(name)).status).toBe(404);
      vi.stubEnv("HEARTFOLIO_CAPTURE", "1");
      const served = await asset(name);
      expect(served.status).toBe(200);
      expect(served.headers.get("content-type")).toBe("image/jpeg");
    } finally {
      rmSync(join(dir, name), { force: true });
    }
  });

  // `../../public/icon-512.png` is a real image outside the folder: only the
  // name check stops it.
  it.each(["../../public/icon-512.png", "..%2F..%2Fpackage.json", "../package.json", ".env", "notes.txt", "a/b.jpg"])(
    "refuses %s even in capture mode",
    async (file) => {
      vi.stubEnv("HEARTFOLIO_CAPTURE", "1");
      expect((await asset(file)).status).toBe(404);
    }
  );
});
