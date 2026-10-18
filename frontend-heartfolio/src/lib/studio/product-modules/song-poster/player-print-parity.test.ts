import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/**
 * PLAYER'S DEDICATION: THE PREVIEW AND THE PRINT PUT IT IN THE SAME PLACE.
 *
 * The preview positions it in CSS (`player-theme.module.css`: `.bottom` and
 * `.message`); the print (`song_poster/png_renderer.py`) repeats those numbers
 * as named constants. Nothing else ties the two together, so this reads both
 * files and fails if they disagree (18 Oct 2026, when the print's fake code
 * and its placeholder label were removed and the dedication moved to where
 * the preview has it).
 */
function backendRenderer(): string {
  const configured = process.env.HEARTFOLIO_BACKEND_PATH;
  const roots = [
    ...(configured ? [isAbsolute(configured) ? configured : join(process.cwd(), configured)] : []),
    join(process.cwd(), "..", "backend"),
    join(process.cwd(), "..", "..", "backend", "backend"),
  ];
  for (const root of roots) {
    const file = join(root, "apps", "delivery", "product_renderers", "song_poster", "png_renderer.py");
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  // Throws rather than skipping: a skipped comparison would report drift as green.
  throw new Error("Cannot locate the backend's png_renderer.py. Set HEARTFOLIO_BACKEND_PATH. Tried: " + roots.join(" | "));
}

function pythonNumber(source: string, name: string): number {
  const match = source.match(new RegExp(`^${name}\\s*=\\s*([\\d.]+)`, "m"));
  if (!match) throw new Error(`png_renderer.py has no ${name}`);
  return Number(match[1]);
}

function cssRule(css: string, selector: string): string {
  const match = css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`player-theme.module.css has no ${selector} rule`);
  return match[1]!;
}

function cssPx(rule: string, property: string): number {
  const match = rule.match(new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([\\d.]+)(px)?`));
  if (!match) throw new Error(`no ${property}`);
  return Number(match[1]);
}

const css = readFileSync(join(__dirname, "player-theme.module.css"), "utf8");
const py = backendRenderer();

describe("Player's dedication, preview against print", () => {
  const bottom = cssRule(css, ".bottom");
  const message = cssRule(css, ".message");

  it("sits the same distance above the sheet's bottom edge", () => {
    expect(pythonNumber(py, "PLAYER_BOTTOM_PX")).toBe(cssPx(bottom, "bottom"));
    // `margin: 0 0 20px`: the third value is the bottom margin.
    const margin = message.match(/margin\s*:\s*([^;]+);/)![1]!.trim().split(/\s+/);
    expect(pythonNumber(py, "PLAYER_MESSAGE_MARGIN_BOTTOM_PX")).toBe(parseFloat(margin[2]!));
  });

  it("is the same size, line height and width", () => {
    expect(pythonNumber(py, "PLAYER_MESSAGE_SIZE_PX")).toBe(cssPx(message, "font-size"));
    expect(pythonNumber(py, "PLAYER_MESSAGE_LINE_HEIGHT")).toBe(cssPx(message, "line-height"));
    expect(pythonNumber(py, "PLAYER_MESSAGE_INSET_PX")).toBe(cssPx(bottom, "inset-inline"));
  });

  it("has no placeholder label on either side", () => {
    expect(css).not.toMatch(/\.codeLabel\s*\{/);
    // The print's module docstring may name the removed label; its code may not.
    const code = py.replace(/"""[\s\S]*?"""/g, "").replace(/#.*$/gm, "");
    expect(code).not.toMatch(/CODE POSITION|LINKS TO YOUR PAGE|_draw_decorative_code/);
  });
});
