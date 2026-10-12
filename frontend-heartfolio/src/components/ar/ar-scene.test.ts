import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AR_PHOTO_GAP, AR_PHOTO_SIZE, milestonePhotoSize, milestoneSpacing } from "./ar-timeline-layout";

/**
 * ---------------------------------------------------------------------
 * §21f — the AR route must stay unreachable except by its own URL
 * ---------------------------------------------------------------------
 * These are source-level assertions rather than behavioural ones, because
 * the requirements they protect are absences: no link from navigation, no
 * index, no distinguishing between failure modes. An absence cannot be
 * tested by exercising the page — only by checking nothing reintroduced it.
 */
describe("AR page security (§21f)", () => {
  const raw = readFileSync("src/app/[locale]/ar/[arId]/page.tsx", "utf8");
  /**
   * Comments stripped before matching. The page explains these exact rules
   * in prose, and a check that matched its own reasoning would pass or fail
   * on the wording rather than the code — the same trap the §15 RTL guard
   * fell into.
   */
  const page = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("is marked noindex", () => {
    // §21f: AR pages must never be indexed or discoverable via search.
    expect(page).toContain("index: false");
    expect(page).toContain("follow: false");
  });

  it("renders per request rather than being cached or prebuilt", () => {
    // A snapshotted AR page would keep working after revocation until the
    // next deploy — §21e requires rendering fresh every time.
    expect(page).toContain('export const dynamic = "force-dynamic"');
  });

  it("collapses every failure into one response", () => {
    // Distinguishing revoked from never-existed here would undo Django's
    // single generic 404 by leaking the same information one layer up.
    expect(page).toContain("notFound()");
    expect(page).not.toMatch(/revoked/i);
  });

  it("is not linked from site navigation anywhere", () => {
    // §21f — AR pages must not be reachable except by their own URL.
    for (const file of [
      "src/components/layout/header.tsx",
      "src/components/layout/footer.tsx",
      "src/app/sitemap.ts",
    ]) {
      expect(readFileSync(file, "utf8"), `${file} links to /ar`).not.toMatch(/["'`]\/ar[/"'`]/);
    }
  });
});

describe("AR scene (§21i)", () => {
  const scene = readFileSync("src/components/ar/ar-scene.tsx", "utf8");

  it("pins its library versions", () => {
    // An AR page whose library silently updated under it breaks without
    // anyone deploying anything — and the recipient has no way to report
    // it usefully.
    expect(scene).toMatch(/three@\d+\.\d+\.\d+/);
    expect(scene).toMatch(/mind-ar@\d+\.\d+\.\d+/);
  });

  it("checks for camera and WebGL support before downloading the library", () => {
    // Downloading megabytes onto a browser that cannot use a camera spends
    // a recipient's data to reach the same failure message.
    const guardIndex = scene.indexOf("WebGLRenderingContext");
    const loadIndex = scene.indexOf("loadScript(THREE_URL)");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(loadIndex);
  });

  it("distinguishes a refused camera from a general failure", () => {
    // The most likely failure, and the only one the recipient can fix
    // themselves — "something went wrong" would leave them stuck.
    expect(scene).toContain('"denied"');
    expect(scene).toMatch(/permission\|denied\|NotAllowed/);
  });

  it("never leaves a blank screen", () => {
    // A blank screen is indistinguishable from a broken product to someone
    // holding a printed card.
    for (const phase of ["loading", "unsupported", "denied", "failed"]) {
      expect(scene).toContain(`"${phase}"`);
    }
  });
});

describe("AR experience levels (§14, §15)", () => {
  const page = readFileSync("src/app/[locale]/ar/[arId]/page.tsx", "utf8");
  // Read here rather than reusing the `scene` above: that one is scoped to
  // its own describe block, and referencing it from here silently resolved
  // to nothing.
  const sceneSource = readFileSync("src/components/ar/ar-scene.tsx", "utf8");

  it("takes the level from the backend rather than deriving it", () => {
    // The backend owns what "enhanced" means. Two implementations would
    // drift the first time either changed — the same reasoning that keeps
    // §21c's scene selection server-side.
    expect(page).toContain("payload.level");
    expect(sceneSource).toContain("level: string");
  });

  it("never branches the scene on level", () => {
    /**
     * §14 — Basic is a COMPLETE experience, not a degraded Enhanced. The
     * scene is built the same way at either level and media only adds to
     * it.
     *
     * A branch here would mean a customer with no video receiving a lesser
     * experience rather than a different one, which §14 rules out
     * explicitly.
     */
    expect(sceneSource).not.toMatch(/if\s*\(\s*level\s*===/);
    expect(sceneSource).not.toMatch(/level\s*===\s*["']enhanced["']\s*\?/);
  });

  it("receives media as ids, never as urls", () => {
    // §21f — a URL in this payload would be a second route to a customer's
    // files, outside the ownership-checked path everything else uses.
    expect(page).toContain("backgroundMusic: string | null");
    expect(page).not.toMatch(/mediaUrl|videoUrl|audioUrl/);
  });
});

describe("the AR scene itself (§14, §15)", () => {
  const source = readFileSync("src/components/ar/ar-scene.tsx", "utf8");

  it("is no longer a placeholder plane", () => {
    // It was one, and I had been treating "no card artwork" as blocking
    // the whole feature. Only the TRACKING TARGET needs the artwork; the
    // scene needs the story.
    expect(source).toContain("STEP_INTERVAL");
    expect(source).toContain("TextureLoader");
  });

  it("positions everything in card space, never pixels", () => {
    // MindAR's anchor is one unit wide and matches the tracked image, so a
    // pixel value would mean the scene only fitted one printed size.
    expect(source).not.toMatch(/position\.set\(\s*\d{2,}/);
  });

  it("drives progression from a clock, not from scroll", () => {
    // There is no scroll in AR — the reader is holding a phone over a card.
    expect(source).toContain("getElapsedTime");
    expect(source).not.toContain("scrollY");
  });

  it("starts the story when the card is found, not when the page loads", () => {
    // A clock created at module load would mean milestones had already
    // played by the time someone aimed the camera.
    const startIndex = source.indexOf("await mindar.start()");
    const clockIndex = source.indexOf("new THREE.Clock()");
    expect(clockIndex).toBeGreaterThan(-1);
    expect(clockIndex).toBeLessThan(startIndex);
  });

  it("adds media to the same scene rather than building a different one", () => {
    /**
     * §14 — Basic is complete, Enhanced adds. `attachMedia` wraps the
     * existing update function; it does not replace the scene, and nothing
     * above it is re-run.
     */
    expect(source).toContain("attachMedia(media, handle, clock)");
    expect(source).toContain("const originalUpdate = handle.update");
  });

  it("stops audio when tracking is lost", () => {
    // A voice continuing after the card is gone would be a small horror.
    expect(source).toContain("cleanupMedia()");
    expect(source).toContain("element.pause()");
  });

  it("treats a refused play as unremarkable", () => {
    // The visual milestone still appeared, and §14 says that alone is a
    // complete experience.
    expect(source).toMatch(/play\(\)\.catch/);
  });
});

describe("AR timeline layout (§21i)", () => {
  it("never lets one milestone's photograph cover the next", () => {
    // From five milestones the 0.26 photographs overlapped (by 0.05 at five,
    // 0.14 at eight, more than half a photograph): the Studio offered three
    // until it was raised to eight.
    for (let count = 1; count <= 8; count += 1) {
      if (count === 1) continue;
      const size = milestonePhotoSize(count);
      expect(size, `${count} milestones`).toBeGreaterThan(0);
      expect(milestoneSpacing(count) - size, `${count} milestones`).toBeGreaterThanOrEqual(AR_PHOTO_GAP - 1e-9);
    }
  });

  it("keeps the usual size wherever it already fitted", () => {
    // Up to four milestones the photograph is unchanged.
    for (const count of [2, 3, 4]) expect(milestonePhotoSize(count)).toBeCloseTo(AR_PHOTO_SIZE, 10);
    expect(milestonePhotoSize(8)).toBeLessThan(AR_PHOTO_SIZE);
  });

  it("is what the scene builds with", () => {
    // The scene spaces and sizes through these two functions, not its own
    // arithmetic (it used to hold `0.84 / ...` and `PlaneGeometry(0.26, 0.26)`).
    const scene = readFileSync("src/components/ar/ar-scene.tsx", "utf8");
    expect(scene).toContain("milestoneSpacing(milestones.length)");
    expect(scene).toContain("milestonePhotoSize(milestones.length)");
    expect(scene).not.toContain("PlaneGeometry(0.26, 0.26)");
  });
});
