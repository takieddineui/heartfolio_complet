import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildZip } from "../../../test/zip-fixture";
import {
  DownloadIncompleteError,
  downloadEntitlement,
  downloadOrderCategory,
  downloadOrderPack,
  filenameFromDisposition,
} from "./delivery";
import { ApiError } from "./errors";

function setCookie(value: string) {
  Object.defineProperty(document, "cookie", { value, writable: true, configurable: true });
}

/** Bytes, not a jsdom Blob: jsdom's Blob and Node's Response come from
 * different implementations, and constructing one from the other fails on
 * `.stream()`. The client calls `response.blob()` itself, which produces a
 * Blob from whichever runtime owns the Response. */
function fileResponse(body: string | Uint8Array, headers: Record<string, string>, status = 200) {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return new Response(bytes as BodyInit, { status, headers });
}

const ZIP_HEADERS = {
  "Content-Type": "application/zip",
  "Content-Disposition": 'attachment; filename="heartfolio-pack.zip"',
};

function stubSave() {
  const clicks: { href: string; download: string }[] = [];
  const createObjectURL = vi.fn().mockReturnValue("blob:fake-url");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const element = realCreate(tag) as HTMLAnchorElement;
    if (tag === "a") {
      element.click = () => clicks.push({ href: element.href, download: element.download });
    }
    return element;
  });

  return { clicks, revokeObjectURL };
}

describe("filenameFromDisposition", () => {
  it("reads the filename Django set", () => {
    expect(filenameFromDisposition('attachment; filename="heartfolio-heart-map-wallpaper.zip"')).toBe(
      "heartfolio-heart-map-wallpaper.zip"
    );
  });

  it("falls back when the header is absent", () => {
    expect(filenameFromDisposition(null, "fallback.zip")).toBe("fallback.zip");
  });

  it("strips path separators, so a header can never write outside the downloads folder", () => {
    // The backend already sanitises this; the client does not trust it.
    expect(filenameFromDisposition('attachment; filename="../../etc/passwd"')).toBe("etcpasswd");
    expect(filenameFromDisposition('attachment; filename=".hidden"')).toBe("hidden");
  });
});

describe("downloadOrderPack", () => {
  beforeEach(() => setCookie("csrftoken=t"));
  afterEach(() => vi.restoreAllMocks());

  it("requests the pack archive with credentials and saves it", async () => {
    const { clicks } = stubSave();
    const fetchMock = vi.fn().mockResolvedValue(
      fileResponse(buildZip({ "story.png": "png" }), {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="heartfolio-heart-map-wallpaper.zip"',
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadOrderPack("order-1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/orders/order-1/download");
    expect(init.credentials).toBe("include");
    expect(result.filename).toBe("heartfolio-heart-map-wallpaper.zip");
    expect(clicks[0]?.download).toBe("heartfolio-heart-map-wallpaper.zip");
  });

  it("surfaces a refusal as a typed error rather than saving an error page as a file", async () => {
    stubSave();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "entitlement_not_found", message: "Not found." } }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const error = await downloadOrderPack("order-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isNotFound).toBe(true);
  });

  it("treats an unpaid order's 404 as a failure, never as an empty download", async () => {
    const { clicks } = stubSave();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } }))
    );

    await downloadOrderPack("order-1").catch(() => undefined);
    expect(clicks).toHaveLength(0);
  });
});

describe("a truncated archive is never saved", () => {
  beforeEach(() => setCookie("csrftoken=t"));
  afterEach(() => vi.restoreAllMocks());

  // The real failure: the server's worker is killed mid-stream, after the
  // 200 and part of the body are already sent. `fetch` resolves with the
  // partial bytes and nothing rejects.
  const truncated = () => buildZip({ "a.png": "a".repeat(4000), "b.png": "b".repeat(4000) }).slice(0, 5000);

  it("refuses a pack zip that ends early, and saves nothing", async () => {
    const { clicks } = stubSave();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fileResponse(truncated(), ZIP_HEADERS)));

    const error = await downloadOrderPack("order-1").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DownloadIncompleteError);
    expect(clicks).toHaveLength(0);
  });

  it("refuses a category zip that ends early, and saves nothing", async () => {
    const { clicks } = stubSave();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fileResponse(truncated(), ZIP_HEADERS)));

    const error = await downloadOrderCategory("order-1", "printable").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DownloadIncompleteError);
    expect(clicks).toHaveLength(0);
  });

  it("treats a connection that drops mid-body the same way", async () => {
    const { clicks } = stubSave();
    const dropped = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(buildZip().slice(0, 20));
        controller.error(new TypeError("terminated"));
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(dropped, { status: 200, headers: ZIP_HEADERS })));

    const error = await downloadOrderPack("order-1").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DownloadIncompleteError);
    expect(clicks).toHaveLength(0);
  });

  it("still saves a complete category zip", async () => {
    const { clicks } = stubSave();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fileResponse(buildZip({ "a.png": "a" }), ZIP_HEADERS)));

    const result = await downloadOrderCategory("order-1", "printable");

    expect(result.filename).toBe("heartfolio-pack.zip");
    expect(clicks).toHaveLength(1);
  });

  it("does not apply to single-file downloads, which are not zips", async () => {
    const { clicks } = stubSave();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fileResponse("png-bytes", { "Content-Type": "image/png", "Content-Disposition": 'attachment; filename="a.png"' })
      )
    );

    await downloadEntitlement("ent-1");

    expect(clicks).toHaveLength(1);
  });
});

describe("downloadEntitlement", () => {
  beforeEach(() => setCookie("csrftoken=t"));
  afterEach(() => vi.restoreAllMocks());

  it("saves a rendered file", async () => {
    const { clicks } = stubSave();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fileResponse("png-bytes", {
          "Content-Type": "image/png",
          "Content-Disposition": 'attachment; filename="story-png.png"',
        })
      )
    );

    const result = await downloadEntitlement("ent-1");
    expect(result.filename).toBe("story-png.png");
    expect(clicks[0]?.download).toBe("story-png.png");
  });

  it("opens the hosted keepsake for a digital entitlement instead of saving a file", async () => {
    const { clicks } = stubSave();
    const open = vi.fn();
    vi.stubGlobal("open", open);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ url: "https://example.test/live/abc" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const result = await downloadEntitlement("ent-live");

    expect(result.url).toBe("https://example.test/live/abc");
    expect(open).toHaveBeenCalledWith("https://example.test/live/abc", "_blank", "noopener,noreferrer");
    expect(clicks).toHaveLength(0);
  });

  it("never sends anything that could influence what is delivered", async () => {
    stubSave();
    const fetchMock = vi.fn().mockResolvedValue(
      fileResponse("x", { "Content-Type": "image/png", "Content-Disposition": 'attachment; filename="a.png"' })
    );
    vi.stubGlobal("fetch", fetchMock);

    await downloadEntitlement("ent-1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // No query string, no body: the entitlement id in the path is the
    // only input, and Django derives project and renderer from it.
    expect(url).not.toContain("?");
    expect(init.body).toBeUndefined();
    expect(init.method).toBe("GET");
  });
});
