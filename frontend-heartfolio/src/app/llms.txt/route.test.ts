import { describe, expect, it } from "vitest";
import { GET } from "./route";

/**
 * llms.txt is what an AI assistant reads to answer "what does Heartfolio
 * sell?". Until 26 Oct 2026 it promised phone, tablet and desktop wallpapers
 * (none is sold) and said the AR pages were excluded in robots.txt (they are
 * `noindex`; robots.txt does not list them).
 */
describe("/llms.txt", () => {
  it("promises only what is sold", async () => {
    const body = await GET().text();
    expect(body).not.toMatch(/wallpaper/i);
    expect(body).toMatch(/Digital:/);
    expect(body).toMatch(/Printable:/);
  });

  it("describes the keepsake pages as noindex, not robots.txt exclusions", async () => {
    const body = await GET().text();
    expect(body).not.toMatch(/order and AR pages/);
    expect(body).toMatch(/AR view\) are marked noindex/);
  });
});
