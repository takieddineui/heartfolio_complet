import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/**
 * SONG POSTER'S TITLES AND DEDICATIONS: THE PRINT SETS THEM AS THE PREVIEW DOES.
 *
 * The print (`song_poster/png_renderer.py`) repeats each theme's CSS numbers in
 * `TITLE_LAYOUT` and `DEDICATION_LAYOUT`. Nothing else ties the two together,
 * so this reads both and fails if they disagree (18 Oct 2026, when the print
 * stopped cutting dedications to one line and started fitting titles).
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

const py = backendRenderer();

function pyTable(name: string): Record<string, string[]> {
  const body = py.match(new RegExp(`^${name} = \\{([\\s\\S]*?)^\\}`, "m"));
  if (!body) throw new Error(`png_renderer.py has no ${name}`);
  const rows: Record<string, string[]> = {};
  for (const row of body[1]!.matchAll(/"(\w+)":\s*\(([^)]*)\)/g)) {
    rows[row[1]!] = row[2]!.split(",").map((part) => part.trim().replace(/^"|"$/g, ""));
  }
  return rows;
}

function pyNumber(name: string): number {
  const match = py.match(new RegExp(`^${name}\\s*=\\s*([\\d.]+)`, "m"));
  if (!match) throw new Error(`png_renderer.py has no ${name}`);
  return Number(match[1]);
}

const css = (theme: string) => readFileSync(join(__dirname, `${theme}-theme.module.css`), "utf8");

function rule(source: string, selector: string): string {
  const match = source.match(new RegExp(`(?:^|\\n)\\s*\\.${selector}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no .${selector} rule`);
  return match[1]!;
}

function prop(body: string, property: string): string | undefined {
  return body.match(new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+);`))?.[1]?.trim();
}

const px = (value: string | undefined) => (value === undefined ? NaN : parseFloat(value));

const TITLES = pyTable("TITLE_LAYOUT");
const DEDICATIONS = pyTable("DEDICATION_LAYOUT");
const CSS_FILE: Record<string, string> = {
  player: "player",
  ledger: "ledger",
  ephemeris: "ephemeris",
  contactsheet: "contact-sheet",
  label: "label",
  award: "award",
  sleeve: "sleeve",
  mosaic: "mosaic",
};

describe("titles, preview against print", () => {
  it("covers every theme", () => {
    expect(Object.keys(TITLES).sort()).toEqual(Object.keys(CSS_FILE).sort());
  });

  for (const [theme, [, size, lines]] of Object.entries(TITLES)) {
    it(`${theme}: same size and the same number of lines`, () => {
      const title = rule(css(CSS_FILE[theme]!), "title");
      expect(Number(size)).toBe(px(prop(title, "font-size")));
      if (theme === "sleeve") {
        expect(Number(lines)).toBe(Number(prop(title, "-webkit-line-clamp")));
        expect(pyNumber("SLEEVE_TITLE_LINE_HEIGHT")).toBe(Number(prop(title, "line-height")));
      } else {
        expect(Number(lines)).toBe(1);
        expect(prop(title, "white-space")).toBe("nowrap");
        expect(prop(title, "text-overflow")).toBe("ellipsis");
      }
    });
  }

  it("shrinks to 80% of the design size before cutting", () => {
    expect(pyNumber("TITLE_MIN_SCALE")).toBe(0.8);
  });
});

describe("dedications, preview against print", () => {
  /** [CSS file, the dedication's selector]. */
  const SELECTOR: Record<string, [string, string]> = {
    player: ["player", "message"],
    ledger: ["ledger", "dedication"],
    ephemeris: ["ephemeris", "dedication"],
    contactsheet: ["contact-sheet", "caption"],
    label: ["label", "dedication"],
    award: ["award", "plaqueDedication"],
    mosaic: ["mosaic", "dedication"],
  };
  /** `max-width: 56ch` is a width only the preview's own font can measure;
   * these are the widths measured in the browser on 18 Oct 2026. If the CSS
   * or the font changes, re-measure and update both sides. */
  const MEASURED_56CH: Record<string, number> = { ledger: 528.3, ephemeris: 544.7, label: 475.5 };

  it("covers every theme with a written dedication (Sleeve's is ring text)", () => {
    expect(Object.keys(DEDICATIONS).sort()).toEqual(Object.keys(SELECTOR).sort());
  });

  for (const [theme, [width, size, lineHeight]] of Object.entries(DEDICATIONS)) {
    it(`${theme}: same width, size and line height, and it wraps`, () => {
      const [file, selector] = SELECTOR[theme]!;
      const source = css(file);
      const body = rule(source, selector);
      expect(Number(size)).toBe(px(prop(body, "font-size")));
      // Ledger and Ephemeris set no line height and inherit the page's 1.5.
      expect(Number(lineHeight)).toBe(prop(body, "line-height") === undefined ? 1.5 : Number(prop(body, "line-height")));
      expect(prop(body, "white-space")).toBeUndefined(); // never `nowrap`: the preview wraps it in full
      expect(prop(body, "-webkit-line-clamp")).toBeUndefined();

      let expected: number;
      if (theme in MEASURED_56CH) {
        expect(prop(body, "max-width")).toBe("56ch");
        expected = MEASURED_56CH[theme]!;
      } else if (theme === "player") {
        expected = 800 - 2 * px(prop(rule(source, "bottom"), "inset-inline"));
      } else if (theme === "contactsheet") {
        expected = px(prop(body, "max-width"));
      } else if (theme === "award") {
        const plaque = rule(source, "plaque");
        const [, padX] = prop(plaque, "padding")!.split(/\s+/).map(parseFloat);
        expected = 1200 - 2 * px(prop(plaque, "inset-inline")) - 2 * padX!;
      } else {
        const [, padX] = prop(rule(source, "heroBody"), "padding")!.split(/\s+/).map(parseFloat);
        expected = px(prop(rule(source, "hero"), "width")) - 2 * padX!;
      }
      expect(Number(width)).toBe(expected);
    });
  }
});
