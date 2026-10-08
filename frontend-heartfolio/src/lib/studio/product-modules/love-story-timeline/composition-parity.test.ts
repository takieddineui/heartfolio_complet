import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/**
 * WHERE THE BACKEND LIVES.
 *
 * These paths used to be hardcoded relative strings resolved against the
 * working directory, which assumed one checkout layout: the original
 * monorepo, with the frontend and the Django project nested two levels
 * apart. Where the two are separate repos cloned side by side, that path
 * points outside the project and the suite failed to load with ENOENT
 * before a single assertion ran. A parity test that cannot find what it
 * compares against is not a passing test; it is no test.
 *
 * Resolution order: an explicit HEARTFOLIO_BACKEND_PATH first, so any
 * layout works without editing this file, then the layouts actually in use.
 *
 * THROWS rather than skipping when nothing matches. Skipping would turn
 * "the two renderers may have drifted" into a green run, which is the
 * exact failure this file exists to catch.
 */
function backendRoot(): string {
  const configured = process.env.HEARTFOLIO_BACKEND_PATH;
  const candidates = [
    ...(configured ? [isAbsolute(configured) ? configured : join(process.cwd(), configured)] : []),
    join(process.cwd(), "..", "backend"),
    join(process.cwd(), "..", "..", "backend", "backend"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "apps", "delivery", "product_renderers"))) return candidate;
  }
  throw new Error(
    "Parity test cannot locate the Django backend. Set HEARTFOLIO_BACKEND_PATH to " +
      "its root (the directory containing manage.py). Tried: " + candidates.join(" | ")
  );
}

const LST_RENDERER_DIR = join(
  backendRoot(), "apps", "delivery", "product_renderers", "love_story_timeline"
);

/**
 * ---------------------------------------------------------------------
 * PREVIEW / DELIVERY PARITY (§7)
 * ---------------------------------------------------------------------
 * The preview and the delivered file are two implementations by decision —
 * CSS in `renderer.module.css`, Pillow in `png_renderer.py`. That is
 * workable for one plain list and a standing risk across six compositions,
 * because nothing errors when they drift: the customer approves one thing
 * and receives another.
 *
 * `compositions.py` holds every proportion that defines a composition as a
 * number. This test asserts the CSS uses the SAME numbers. It cannot prove
 * the two renders look identical — font metrics and text wrapping differ
 * between a browser and Pillow, and no test closes that. What it closes is
 * the drift that comes from someone changing a column width on one side
 * only, which is the likely failure and the invisible one.
 *
 * Parsed from the Python source rather than duplicated here, so this file
 * cannot be the thing that goes stale.
 */
const python = readFileSync(
  join(LST_RENDERER_DIR, "compositions.py"),
  "utf8"
);
const css = readFileSync(
  "src/lib/studio/product-modules/love-story-timeline/renderer.module.css",
  "utf8"
);

function pythonValue(field: string, className = "NeatStackGeometry"): number {
  // Scoped to one dataclass: both geometries declare `photo_width` and
  // `photo_tilt_deg` with different values, and an unscoped match would
  // silently compare the cascade's numbers against Neat Stack's CSS.
  const block = python.slice(python.indexOf(`class ${className}`));
  const match = block.match(new RegExp(`${field}:\\s*(?:float|int)\\s*=\\s*([\\d.]+)`));
  if (!match) throw new Error(`${className} has no field '${field}'`);
  return parseFloat(match[1]!);
}

/**
 * The declarations of every CSS rule whose selector list contains
 * `selector` exactly — a single-selector rule or one selector of a grouped
 * rule (`.a, .b { ... }`) — joined, since one selector's declarations may be
 * split across rules. Comments are stripped first so a comment above a rule
 * cannot be mistaken for part of its selector.
 */
function cssRule(selector: string): string {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const bodies = [];
  for (const [, selectors, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors!.split(",").map((s) => s.trim()).includes(selector)) bodies.push(body!);
  }
  if (bodies.length === 0) throw new Error(`renderer.module.css has no rule '${selector}'`);
  return bodies.join("\n");
}

describe("Neat Stack geometry (§7.1)", () => {
  it("uses the same photo column width on both sides", () => {
    const photoColumn = pythonValue("photo_column");
    // The CSS grid declares it as a percentage of the same content box.
    expect(css).toContain(`grid-template-columns: ${Math.round(photoColumn * 100)}%`);
  });

  it("gives every milestone an equal row, and sizes the card to fit it", () => {
    // The preview used to stack fixed-width cards that grew past the
    // clipped timeline at 5 and 8 milestones. Each milestone now gets an
    // equal row (cell, entry), as the print gives each an equal slot, and
    // the card is the column share or whatever its tilted outline fits.
    expect(cssRule(".neatPhotoCell")).toContain("flex: 1 1 0");
    expect(cssRule(".neatPhotoCell")).toContain("container-type: size");
    expect(cssRule(".neatEntry")).toContain("flex: 1 1 0");
    const [, top, side, bottom] = cssRule(".neatPhoto").match(/padding:\s*(\d+)px (\d+)px (\d+)px/)!.map(Number);
    const taller = top! + bottom! - 2 * side!;
    const tilt = (Math.max(pythonValue("photo_tilt_deg"), pythonValue("photo_tilt_even_deg")) * Math.PI) / 180;
    const factor = (Math.cos(tilt) + Math.sin(tilt)).toFixed(4);
    expect(cssRule(".neatPhoto")).toContain(
      `width: min(${Math.round(pythonValue("photo_width") * 100)}cqw, calc((100cqh - ${taller}px) / ${factor}))`
    );
  });

  it("fits the text to its row no further than the print does, keeping milestones apart", () => {
    expect(cssRule(".neatEntry")).toContain("--text-scale: calc(var(--base-text-scale, 1) * var(--text-fit, 1))");
    // Half a date line at each end: the print keeps one date line between
    // milestones (`_fit_milestone_text`'s separation). Without it, text
    // fitted to its row touched the next milestone's (0px at 5 and 8).
    const dateSize = Number(cssRule(".neatDate").match(/font-size:\s*calc\(([\d.]+)px/)![1]);
    expect(cssRule(".neatEntry")).toContain(`padding-block: calc(${dateSize / 2}px * var(--text-scale, 1))`);
  });

  it("tilts the odd and even cards by the same two angles", () => {
    // This used to assert only `rotate(-2deg)`, under a comment claiming it
    // matched "the Pillow renderer's odd/even handling" — when the Pillow
    // renderer drew every card flat, and the even cards' 1.6deg was pinned
    // nowhere. Both angles are now real on both sides: the 1st, 3rd...
    // card anticlockwise, the 2nd, 4th... clockwise, and they differ.
    // Selected on the CELL's position: each card is the only child of
    // its cell, so `.neatPhoto:nth-child(even)` would never match.
    expect(cssRule(".neatPhotoCell:nth-child(odd) .neatPhoto")).toContain(
      `transform: rotate(-${pythonValue("photo_tilt_deg")}deg)`
    );
    expect(cssRule(".neatPhotoCell:nth-child(even) .neatPhoto")).toContain(
      `transform: rotate(${pythonValue("photo_tilt_even_deg")}deg)`
    );
  });

  it("gives the cards the same drop shadow", () => {
    const offset = pythonValue("card_shadow_offset_px");
    const blur = pythonValue("card_shadow_blur_px");
    const opacity = pythonValue("card_shadow_opacity");
    expect(cssRule(".neatPhoto")).toContain(
      `box-shadow: 0 ${offset}px ${blur}px rgba(0, 0, 0, ${opacity})`
    );
  });

  it("keeps the columns adding up to the full width", () => {
    // A silent overflow here would push the text column off the page in
    // Pillow while CSS quietly shrank it — the two would disagree with no
    // error on either side.
    const total =
      pythonValue("photo_column") +
      pythonValue("spine_column") +
      pythonValue("column_gap") * 2;
    expect(total).toBeLessThan(1);
  });

  it("gives the Polaroid a heavier bottom border than its sides", () => {
    // What makes it read as a Polaroid rather than a white box. Asserted
    // because it is the kind of detail a later tidy-up would "simplify".
    expect(pythonValue("polaroid_bottom_border")).toBeGreaterThan(
      pythonValue("polaroid_border") * 2
    );
    expect(css).toContain("padding: 5px 5px 16px");
  });
});

describe("layout coverage (§7)", () => {
  it("maps every layout on both sides, with no unstyled fallthrough", () => {
    // Five compositions are still pending. They fall back to Neat Stack on
    // BOTH sides deliberately: an unmapped layout would render an unstyled
    // column in CSS and a different fallback in Pillow, which is worse than
    // showing a complete composition that is not yet the right one.
    const renderer = readFileSync(
      "src/lib/studio/product-modules/love-story-timeline/renderer.tsx",
      "utf8"
    );
    const layouts = readFileSync(
      "src/lib/studio/product-modules/love-story-timeline/layouts.ts",
      "utf8"
    );

    const ids = [...layouts.matchAll(/id: "([a-z-]+)",\n\s+orientation/g)].map((m) => m[1]!);
    expect(ids.length).toBe(6);

    for (const id of ids) {
      expect(renderer, `renderer.tsx does not map ${id}`).toContain(`"${id}"`);
      expect(python, `compositions.py does not map ${id}`).toContain(`"${id}"`);
    }
  });
});

describe("Overlapping Cascade geometry (§7.3)", () => {
  const cascade = (field: string) => pythonValue(field, "CascadeGeometry");

  it("uses the same photo column split on both sides", () => {
    expect(css).toContain(`grid-template-columns: ${Math.round(cascade("photo_column") * 100)}%`);
  });

  it("puts the spine where Pillow puts it", () => {
    const spine = cssRule(".cascadeSpine");
    expect(spine).toContain(`inset-inline-start: ${cascade("spine_position") * 100}%`);
    expect(spine).toContain(`inset-block: ${cascade("spine_inset") * 100}%`);
    expect(spine).toContain(`width: ${cascade("spine_width_px")}px`);
  });

  it("starts the text where Pillow starts it", () => {
    // The text column begins after the photo column plus its own 9% inset.
    // `.timeline`'s 14px gap used to push it (and the nodes) 14px further.
    expect(cssRule(".layoutCascade")).toContain("gap: 0");
    const inset = Number(cssRule(".cascadeEntries").match(/padding-inline-start:\s*([\d.]+)%/)![1]) / 100;
    const photoColumn = cascade("photo_column");
    expect(photoColumn + inset * (1 - photoColumn)).toBeCloseTo(cascade("text_start"), 3);
  });

  it("gives every milestone an equal row, with half the overlap spare at each end", () => {
    // Rows of height / (count + overlap), as the print divides its band;
    // a card may be (1 + overlap) rows tall, so it overlaps its neighbours
    // and the first and last still fit. This used to be a column of
    // fixed-width cards that grew past the clipped timeline: 90px at 3
    // milestones, 518px at 5, 1,161px at 8.
    expect(cssRule(".layoutCascade")).toContain("grid-template-rows: minmax(0, 1fr)");
    for (const spacer of [".cascadePhotos::before", ".cascadePhotos::after", ".cascadeEntries::before", ".cascadeEntries::after"]) {
      expect(cssRule(spacer)).toContain(`flex: ${cascade("photo_overlap") / 2} 1 0`);
    }
    expect(cssRule(".cascadePhotoCell")).toContain("flex: 1 1 0");
    expect(cssRule(".cascadePhotoCell")).toContain("container-type: size");
    expect(cssRule(".cascadeEntry")).toContain("flex: 1 1 0");
  });

  it("sizes the tilted card to fit (1 + overlap) rows, as Pillow does", () => {
    // The card is `photo_width` of the column, or as wide as its tilted
    // outline can be inside 1 + overlap rows. A photo 1.15x as tall as wide
    // makes the card aspect x width + (top + bottom - aspect x 2 sides) tall;
    // tilted, (aspect cos + sin) x width + that constant x cos.
    const [, top, side, bottom] = cssRule(".cascadePhoto").match(/padding:\s*(\d+)px (\d+)px (\d+)px/)!.map(Number);
    const aspect = cascade("photo_aspect");
    const tilt = (Math.max(cascade("photo_tilt_deg"), cascade("photo_tilt_even_deg")) * Math.PI) / 180;
    const extra = top! + bottom! - aspect * 2 * side!;
    const height = Math.round((1 + cascade("photo_overlap")) * 100);
    expect(cssRule(".cascadePhoto")).toContain(
      `--card-w: min(${Math.round(cascade("photo_width") * 100)}cqw, calc((${height}cqh - ${(extra * Math.cos(tilt)).toFixed(2)}px) / ${(aspect * Math.cos(tilt) + Math.sin(tilt)).toFixed(4)}))`
    );
    expect(cssRule(".cascadePhoto img")).toContain(`aspect-ratio: 1 / ${aspect}`);
  });

  it("drifts the cards along one even diagonal, inside the column", () => {
    // `drift` of the column end to end, narrowed so the widest tilted card
    // (width cos + height sin) stays inside it — Pillow's `spread`. Each
    // card's place on the diagonal comes from renderer.tsx, evenly from
    // -0.5 to 0.5: a fixed table by position drifted one way only at 3.
    const [, top, side, bottom] = cssRule(".cascadePhoto").match(/padding:\s*(\d+)px (\d+)px (\d+)px/)!.map(Number);
    const aspect = cascade("photo_aspect");
    const tilt = (Math.max(cascade("photo_tilt_deg"), cascade("photo_tilt_even_deg")) * Math.PI) / 180;
    const extra = top! + bottom! - aspect * 2 * side!;
    expect(cssRule(".cascadePhoto")).toContain(
      `min(${Math.round(cascade("drift") * 100)}cqw, 100cqw - ${(Math.cos(tilt) + aspect * Math.sin(tilt)).toFixed(4)} * var(--card-w) - ${(extra * Math.sin(tilt)).toFixed(2)}px)`
    );
    const renderer = readFileSync("src/lib/studio/product-modules/love-story-timeline/renderer.tsx", "utf8");
    expect(renderer).toContain('"--cascade-offset": String(i / Math.max(1, events.length - 1) - 0.5)');
    expect(css).not.toMatch(/\.cascadePhoto:nth-child\(\d+\)/);
  });

  it("tilts the odd and even cards by the same two angles", () => {
    // The tilt is a custom property so the drift can be direction-aware
    // for RTL; the value still has to match Pillow's.
    expect(cssRule(".cascadePhotoCell:nth-child(odd) .cascadePhoto")).toContain(`--cascade-tilt: -${cascade("photo_tilt_deg")}deg`);
    expect(cssRule(".cascadePhotoCell:nth-child(even) .cascadePhoto")).toContain(`--cascade-tilt: ${cascade("photo_tilt_even_deg")}deg`);
  });

  it("gives the cards the same shadow and border", () => {
    expect(cssRule(".cascadePhoto")).toContain(
      `box-shadow: 0 ${cascade("card_shadow_offset_px")}px ${cascade("card_shadow_blur_px")}px rgba(0, 0, 0, ${cascade("card_shadow_opacity")})`
    );
    const [, top, , bottom] = cssRule(".cascadePhoto").match(/padding:\s*(\d+)px (\d+)px (\d+)px/)!.map(Number);
    expect(Math.round(cascade("polaroid_border") * cascade("preview_photo_px"))).toBe(top);
    expect(Math.round(cascade("polaroid_bottom_border") * cascade("preview_photo_px"))).toBe(bottom);
  });

  it("draws the same node, level with the date line", () => {
    const node = cssRule(".cascadeNode");
    expect(node).toContain(`width: ${cascade("node_size_px")}px`);
    expect(node).toContain("top: 50%");
    expect(cssRule(".cascadeEntry .neatDate")).toContain("position: relative");
  });

  it("fits the text to its row as the print does, keeping milestones apart", async () => {
    const { TIMELINE_TEXT_FIT_FLOOR } = await import("./timeline-text-fit");
    expect(TIMELINE_TEXT_FIT_FLOOR).toBe(cascade("text_fit_floor"));
    const entry = cssRule(".cascadeEntry");
    expect(entry).toContain("--text-scale: calc(var(--base-text-scale, 1) * var(--text-fit, 1))");
    // Half a date line at each end: the print keeps one date line between
    // milestones (`_fit_milestone_text`'s separation).
    const dateSize = Number(cssRule(".neatDate").match(/font-size:\s*calc\(([\d.]+)px/)![1]);
    expect(entry).toContain(`padding-block: calc(${dateSize / 2}px * var(--text-scale, 1))`);
  });

  it("mirrors the drift under RTL", () => {
    /**
     * §15. `translateX` is a physical axis and does not flip with
     * `dir="rtl"`, so without this an Arabic poster would cascade toward
     * the spine instead of away from it and the photographs would drift
     * into the text column.
     *
     * The tilt is deliberately NOT mirrored: a Polaroid tilted two degrees
     * looks the same either way round.
     */
    expect(css).toContain('[dir="rtl"] .cascadePhoto');
    expect(css).toContain("--cascade-direction: -1");
  });

  it("keeps the timeline secondary, as §7.3 requires", () => {
    // The distinguishing property of this composition: a heavier spine
    // competes with the photographs it is meant to sit behind.
    expect(cascade("spine_width_px")).toBeLessThanOrEqual(1);
    expect(css).toContain(".cascadeSpine");
  });

});

describe("Alternating Tilt geometry (§7.2)", () => {
  const alt = (field: string) => pythonValue(field, "AlternatingGeometry");

  it("uses the same side-column split on both sides", () => {
    expect(css).toContain(`grid-template-columns: ${Math.round(alt("side_column") * 100)}%`);
  });

  it("gives every milestone an equal row, and sizes the card to fit it", () => {
    // The preview used to let rows grow to fixed-width cards: 5 or 8
    // milestones pushed milestones 4-8 out of the (clipped) timeline. The
    // print gives each milestone an equal slot and fits the tilted card to
    // it; the preview must follow the same rule.
    expect(cssRule(".layoutAlternating")).toContain("grid-auto-rows: minmax(0, 1fr)");
    expect(cssRule(".altPhotoCell")).toContain("container-type: size");

    // The card is 86% of its column, or as wide as its tilted outline can
    // be inside the row: (cos + sin of the tilt) x width + (padding the card
    // is taller than wide) <= row height.
    const padding = cssRule(".altPhoto").match(/padding:\s*(\d+)px (\d+)px (\d+)px/);
    expect(padding).toBeTruthy();
    const [, top, side, bottom] = padding!.map(Number);
    const taller = top! + bottom! - 2 * side!;
    const tilt = (Math.max(alt("photo_tilt_deg"), alt("photo_tilt_even_deg")) * Math.PI) / 180;
    const factor = (Math.cos(tilt) + Math.sin(tilt)).toFixed(4);
    expect(cssRule(".altPhoto")).toContain(
      `width: min(${Math.round(alt("photo_width") * 100)}cqw, calc((100cqh - ${taller}px) / ${factor}))`
    );
  });

  it("tilts the odd and even cards by the same two angles", () => {
    expect(cssRule(".altPhotoOdd")).toContain(`transform: rotate(-${alt("photo_tilt_deg")}deg)`);
    expect(cssRule(".altPhotoEven")).toContain(`transform: rotate(${alt("photo_tilt_even_deg")}deg)`);
  });

  it("gives the cards the same shadow and border", () => {
    expect(cssRule(".altPhoto")).toContain(
      `box-shadow: 0 ${alt("card_shadow_offset_px")}px ${alt("card_shadow_blur_px")}px rgba(0, 0, 0, ${alt("card_shadow_opacity")})`
    );
    // The print's border fractions are the CSS pixels over the preview's
    // photo width.
    const [, top, , bottom] = cssRule(".altPhoto").match(/padding:\s*(\d+)px (\d+)px (\d+)px/)!.map(Number);
    expect(Math.round(alt("polaroid_border") * alt("preview_photo_px"))).toBe(top);
    expect(Math.round(alt("polaroid_bottom_border") * alt("preview_photo_px"))).toBe(bottom);
  });

  it("gives this layout larger heart nodes than 7.1, per §7.2", () => {
    // The only ornament in a composition that is otherwise photographs and
    // space, and the reference posters make them noticeably bigger. The
    // print draws the same heart at the same share of the poster's width.
    expect(alt("node_size_px")).toBeGreaterThan(9);
    expect(cssRule(".altNode")).toContain(`width: ${alt("node_size_px")}px`);
  });

  it("aligns the text inward toward the spine", () => {
    expect(cssRule(".altText")).toContain("text-align: start");
    expect(cssRule(".altTextStart")).toContain("text-align: end");
  });

  it("shrinks the text no further than the print does", async () => {
    const { TIMELINE_TEXT_FIT_FLOOR } = await import("./timeline-text-fit");
    expect(TIMELINE_TEXT_FIT_FLOOR).toBe(alt("text_fit_floor"));
    expect(cssRule(".altText")).toContain("--text-scale: calc(var(--base-text-scale, 1) * var(--text-fit, 1))");
  });

  it("keeps both halves inside the page", () => {
    // Two side columns plus the spine must fit. Overflow here would push
    // the trailing column off the edge in Pillow while CSS silently
    // shrank it — the two would disagree with no error on either side.
    expect(alt("side_column") * 2).toBeLessThan(1);
  });

  it("puts photo and text on opposite sides", () => {
    // The defining rule of 7.2. Same-side would collapse it into 7.1 with
    // a zigzag, which is a different composition wearing this one's name.
    const renderer = readFileSync(
      "src/lib/studio/product-modules/love-story-timeline/renderer.tsx",
      "utf8"
    );
    expect(renderer).toContain("photoOnStart ? photo : text");
    expect(renderer).toContain("photoOnStart ? text : photo");
  });
});

describe("Dotted Branching geometry (§7.4)", () => {
  const dotted = (field: string) => pythonValue(field, "DottedGeometry");

  it("uses the same column split and spine position", () => {
    expect(css).toContain(`grid-template-columns: ${Math.round(dotted("photo_column") * 100)}%`);
    expect(css).toContain(`inset-inline-start: ${dotted("spine_position") * 100}%`);
  });

  it("uses the same dash rhythm on both sides", () => {
    // Pillow has no dash support and draws a loop of segments; CSS uses a
    // repeating gradient. Different mechanisms, same figures — which is
    // exactly the kind of thing that drifts silently.
    const dash = dotted("dash_length_px");
    const gap = dotted("dash_gap_px");
    expect(css).toContain(`var(--p-line) 0 ${dash}px`);
    expect(css).toContain(`transparent ${dash}px ${dash + gap}px`);
  });

  it("puts the year on the spine, not in the text column", () => {
    // The detail that most distinguishes 7.4 from 7.1. Both sides draw a
    // background-filled chip so the line is punched through rather than
    // segmented.
    expect(css).toContain(".dottedYear");
    expect(css).toContain("background: var(--p-bg)");
  });

  it("overlaps more than 7.1 and less than 7.3", () => {
    // The reference cascades its photographs, but not as far as 7.3 does.
    // Asserted as an ordering so it survives someone tuning the numbers.
    expect(dotted("photo_overlap")).toBeGreaterThan(
      pythonValue("photo_overlap", "NeatStackGeometry")
    );
    expect(dotted("photo_overlap")).toBeLessThan(
      pythonValue("photo_overlap", "CascadeGeometry")
    );
  });
});

describe("Landscape compositions (§7.5, §7.6)", () => {
  const h = (field: string) => pythonValue(field, "HorizontalGeometry");

  it("uses the same photo width and gap on both sides", () => {
    expect(css).toContain(`width: ${Math.round(h("photo_width") * 100)}%`);
    expect(css).toContain(`column-gap: 2%`);
  });

  it("lays milestones out as columns, not rows", () => {
    // The structural difference from the four portrait layouts: adding a
    // milestone makes every milestone narrower rather than making the page
    // taller. It is why these are strongest at 5-7.
    expect(css).toContain("grid-auto-flow: column");
    expect(css).toContain("grid-auto-columns: 1fr");
  });

  it("uses smaller type than the portrait layouts", () => {
    // At eight milestones a landscape page gives each barely an eighth of
    // its width, so the portrait layouts' sizes would not fit.
    expect(css).toContain("font-size: calc(7px * var(--text-scale, 1))");
  });

  it("puts the caption inside the Polaroid for 7.5 only", () => {
    // From the reference: 7.5's caption sits in the lower border, 7.6's
    // label sits under the axis. Confusing the two would make them the
    // same composition with different photo shapes.
    expect(css).toContain(".hPolaroidCaption");
    expect(css).toContain(".hAxis");
  });
});

describe("landscape orientation (§2, §7)", () => {
  it("declares both horizontal layouts as landscape", () => {
    const layouts = readFileSync(
      "src/lib/studio/product-modules/love-story-timeline/layouts.ts",
      "utf8"
    );
    for (const id of ["horizontal-polaroid", "horizontal-circles"]) {
      const block = layouts.slice(layouts.indexOf(`id: "${id}"`));
      expect(block.slice(0, 200)).toContain('orientation: "landscape"');
    }
  });

  it("turns the page for a landscape layout on the backend too", () => {
    /**
     * The frontend swaps dimensions through `dimensionsFor`; the backend
     * stores every print size in portrait and must swap at render time.
     * Without this the composition would be drawn sideways on a portrait
     * page — which rendered without error and looked like a design fault.
     *
     * Scoped to print targets: a wallpaper's dimensions come from the
     * device, and rotating one produces a file that does not fit the
     * screen it was made for.
     */
    expect(python).toBeTruthy();
    const renderer = readFileSync(
      join(LST_RENDERER_DIR, "png_renderer.py"),
      "utf8"
    );
    expect(renderer).toContain("width, height = height, width");
    expect(renderer).toContain('target_id.startswith("print-")');
  });
});

describe("layout differentiation (§7, §9)", () => {
  const showsDescription = (className: string) => {
    const block = python.slice(python.indexOf(`class ${className}`));
    const match = block.match(/shows_description:\s*bool\s*=\s*(True|False)/);
    if (!match) throw new Error(`${className} does not declare shows_description`);
    return match[1] === "True";
  };

  it("splits the four portrait layouts into caption-carrying and photo-led", () => {
    /**
     * THE DIFFERENTIATOR THAT WAS MISSING.
     *
     * All four originally carried the same content, so they could differ
     * only by column width — which reads as one layout nudged rather than
     * four compositions. The reference posters do not do this: images 3
     * and 5 carry a sentence, images 2, 4 and 7 carry a year and two or
     * three words while the photographs do the talking.
     *
     * Dropping the description is also what lets those layouts afford
     * larger photographs, so the two properties reinforce each other.
     */
    expect(showsDescription("NeatStackGeometry")).toBe(true);
    expect(showsDescription("CascadeGeometry")).toBe(true);
    expect(showsDescription("AlternatingGeometry")).toBe(false);
    expect(showsDescription("DottedGeometry")).toBe(false);
  });

  it("gives the photo-led layouts larger photographs", () => {
    // The room a sentence would have taken goes to the photograph. If
    // these ever matched the caption-carrying widths, the differentiation
    // would be words alone.
    expect(pythonValue("photo_width", "AlternatingGeometry")).toBeGreaterThan(
      pythonValue("photo_width", "NeatStackGeometry")
    );
  });

  it("hides the description in the preview for photo-led layouts too", () => {
    // Otherwise the Studio previews a sentence the delivered file omits —
    // the exact divergence this whole parity file exists to prevent.
    // Inside the rule for each selector, not merely somewhere in the file:
    // a `display: none` elsewhere, or a selector dropped from this rule,
    // would have passed the old file-wide check.
    expect(cssRule(".layoutAlternating .neatDescription")).toMatch(/display:\s*none/);
    expect(cssRule(".layoutDotted .neatDescription")).toMatch(/display:\s*none/);
  });

  it("keeps the description in the data regardless of layout", () => {
    // §9 — layout and content are separate concerns. A customer switching
    // layouts must not lose what they wrote, and switching back must
    // restore it.
    const schema = readFileSync(
      "src/lib/studio/product-modules/love-story-timeline/schema.ts",
      "utf8"
    );
    expect(schema).toContain('id: "description"');
  });
});
