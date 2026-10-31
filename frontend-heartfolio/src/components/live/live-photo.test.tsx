import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Photo } from "@/components/live-graduation/scenes";
import { livePhotoSize, livePhotoSources } from "./live-photo";

/**
 * The live pages download web copies, not the full photo (owner, 31 Oct
 * 2026): a 12 MP photo is 3-4 MB, its 960 copy about 90 KB.
 */
const PHOTO = {
  url: "https://r2.test/uploads/p/a.w960.webp",
  srcset: "https://r2.test/uploads/p/a.w480.webp 480w, https://r2.test/uploads/p/a.w960.webp 960w, https://r2.test/uploads/p/a.w1600.webp 1600w",
  width: 3024,
  height: 4032,
};

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("a live page photo", () => {
  it("offers every web copy at the slot's size", () => {
    expect(livePhotoSources(PHOTO, "300px")).toEqual({ src: PHOTO.url, srcSet: PHOTO.srcset, sizes: "300px" });
    expect(livePhotoSize(PHOTO)).toEqual({ width: 3024, height: 4032 });
  });

  it("is served as before when it has no copies (stored before 31 Oct 2026, or the Studio's preview)", () => {
    expect(livePhotoSources({ url: "blob:x" }, "300px")).toEqual({ src: "blob:x" });
    expect(livePhotoSize({ url: "blob:x" })).toEqual({});
  });

  it("reaches the browser on Graduation's photos and drawings", () => {
    const { container } = render(<Photo media={PHOTO} alt="" />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("srcset")).toBe(PHOTO.srcset);
    expect(img.getAttribute("sizes")).toBe("(min-width: 600px) 480px, 92vw");
    expect(img.getAttribute("src")).toBe(PHOTO.url);
  });

  it("is how every customer photo on every live page is drawn", () => {
    for (const file of [
      "src/components/live/live-keepsake.tsx",
      "src/components/live-song/song-live-keepsake.tsx",
      "src/components/live-reasons/reasons-keepsake.tsx",
      "src/components/live-graduation/scenes.tsx",
    ]) {
      const source = strip(readFileSync(file, "utf8"));
      const images = source.match(/<img\b/g)?.length ?? 0;
      const sourced = source.match(/\{\.\.\.livePhotoSources\(/g)?.length ?? 0;
      expect({ file, sourced }).toEqual({ file, sourced: images });
    }
    // The opening's glimpse of the first photo takes its srcset as a prop.
    const opening = strip(readFileSync("src/components/live/opening-sequence.tsx", "utf8"));
    expect(opening).toMatch(/srcSet=\{photoSrcSet\}/);
    expect(strip(readFileSync("src/components/live/live-keepsake.tsx", "utf8"))).toContain("photoSrcSet={milestones[0]?.photo?.srcset}");
  });

  it("reserves Love Story Timeline's milestone photo box and loads the later ones lazily", () => {
    const source = strip(readFileSync("src/components/live/live-keepsake.tsx", "utf8"));
    expect(source).toContain("{...livePhotoSize(milestone.photo)}");
    expect(source).toContain('loading={index === 0 ? "eager" : "lazy"}');
    const css = readFileSync("src/components/live/live-keepsake.module.css", "utf8");
    expect(css).toMatch(/\.photo \{[^}]*height: auto;/);
  });
});
