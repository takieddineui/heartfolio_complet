import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./sleeve-theme.module.css";
import posterRoot from "./poster-root.module.css";

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;
const RING_RADII = [130, 113, 96, 79];

/**
 * The prototype's own six palettes, ported verbatim (`palettes:[...]`
 * on Sleeve's registry entry) — WIRED UP NOW, correcting the earlier
 * version of this file, which used Cream unconditionally and left the
 * other five undiscoverable. `bg`/`ink`/`soft` are set as CSS custom
 * properties on the sheet's own root (`--sv-bg`/`--sv-ink`/`--sv-soft`
 * in `sleeve-theme.module.css`, and read directly by `DiscSvg` below
 * for the same reason inline SVG can use `var()` — it is part of the
 * same DOM tree, not a separate document), matching the prototype's
 * own material note: "the palette picker sets --bg/--ink on this one
 * sheet directly."
 */
export interface SleevePalette {
  id: string;
  /** Translation key. */
  name: string;
  bg: string;
  ink: string;
  soft: string;
}

export const SLEEVE_PALETTES: SleevePalette[] = [
  { id: "cream", name: "themes.sleevePalette.options.cream", bg: "#f1ece2", ink: "#171512", soft: "#5c574c" },
  { id: "mustard", name: "themes.sleevePalette.options.mustard", bg: "#e3a83c", ink: "#171512", soft: "#4a3b18" },
  { id: "red", name: "themes.sleevePalette.options.red", bg: "#b93b2c", ink: "#f4eee1", soft: "#e7c9bf" },
  { id: "orange", name: "themes.sleevePalette.options.orange", bg: "#d66f2e", ink: "#171512", soft: "#4a2e14" },
  { id: "black", name: "themes.sleevePalette.options.black", bg: "#151412", ink: "#efe8d6", soft: "#b7ae97" },
  { id: "blueGrey", name: "themes.sleevePalette.options.blueGrey", bg: "#57666c", ink: "#f1eee4", soft: "#c7cfd1" },
];

export const DEFAULT_SLEEVE_PALETTE = "cream";

export function getSleevePalette(id: string | undefined): SleevePalette {
  return SLEEVE_PALETTES.find((p) => p.id === id) ?? SLEEVE_PALETTES[0]!;
}

/**
 * Sleeve — "editorial pastiche + the literal lyric spiral": two discs
 * positioned so the gap between them reads as a heart, each ringed in
 * real curved type, a small rotated photo tucked in the seam. LANDSCAPE
 * ONLY, matching the prototype's own registry.
 *
 * See `sleeve-theme.module.css`'s own docstring for the remaining
 * stated adaptation: album/year/runtime credits dropped, since no such
 * fields exist in this schema. The six palettes ARE now wired up —
 * `paletteId` selects one, defaulting to Cream.
 *
 * The ring text is the prototype's own fallback chain, unchanged:
 * dedication where the prototype would have used a lyric, since this
 * schema has no `lyric` field at all — the same "dense and small on
 * purpose, a texture… not a passage meant to be read" effect, built
 * from whatever text is actually available.
 */
export interface SleeveThemeProps {
  track: string;
  artist: string;
  dedication?: string;
  photoUrl?: string;
  youtubeVideoId?: string | null;
  liveCodeSvg?: React.ReactNode;
  /** Every other theme ignores this — it is genuinely Sleeve-specific
   *  — but it lives on the SHARED prop contract every theme takes
   *  (`theme-registry.ts`'s own note on why: one data contract, eight
   *  visual treatments) rather than a special-cased branch in the
   *  renderer adapter for the one theme that needs it. */
  sleevePaletteId?: string;
}

function ringText(raw: string, circumference: number): string {
  const totalChars = Math.max(30, Math.floor(circumference / 3.35));
  let str = raw ? `${raw} · ` : "· ";
  while (str.length < totalChars) str += str;
  return str.slice(0, totalChars);
}

function DiscSvg({ idPrefix, ringSource, palette }: { idPrefix: string; ringSource: string; palette: SleevePalette }) {
  return (
    <svg viewBox="0 0 300 300" aria-hidden="true">
      <circle cx={150} cy={150} r={148} fill={palette.ink} />
      {RING_RADII.map((r, i) => {
        const id = `${idPrefix}-ring-${i}`;
        const text = ringText(ringSource, 2 * Math.PI * r);
        return (
          <g key={id}>
            <path id={id} d={`M${(150 - r).toFixed(1)} 150 A${r} ${r} 0 1 1 ${(150 + r).toFixed(1)} 150 A${r} ${r} 0 1 1 ${(150 - r).toFixed(1)} 150`} fill="none" />
            <text fontSize={6.3} letterSpacing={0.5} fill={palette.bg} opacity={0.82}>
              <textPath href={`#${id}`} startOffset={i % 2 ? "50%" : "0%"}>
                {text}
              </textPath>
            </text>
          </g>
        );
      })}
      <circle cx={150} cy={150} r={25} fill={palette.bg} />
      <circle cx={150} cy={150} r={25} fill="none" stroke={palette.ink} strokeWidth={1} />
      <circle cx={150} cy={150} r={2.6} fill={palette.ink} />
    </svg>
  );
}

/**
 * Whether the two-line title is cut (`-webkit-line-clamp: 2`). Every title
 * box has extra room below for an Arabic title's tails (19 Oct 2026), but
 * Sleeve's lines sit only 1.04em apart, so when a third line exists (hidden,
 * yet still painted) that room would show its top. A cut title keeps the old
 * bottom edge (`.title[data-clamped]`); measured again when the title changes
 * and once the fonts have loaded, since both change the wrapping.
 */
function useTitleClamped(track: string) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    let live = true;
    // Counts the laid-out lines (hidden ones included), not `scrollHeight`:
    // two lines of Arabic already overflow a box without the room, which
    // would read as cut and take the room away again.
    const measure = () => {
      const el = ref.current;
      if (!live || !el) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      const scale = el.getBoundingClientRect().height / (el.offsetHeight || 1) || 1;
      const halfLine = (parseFloat(getComputedStyle(el).lineHeight) * scale) / 2 || 0;
      let lines = 0;
      let last = -Infinity;
      // jsdom has no `getClientRects` on a range; every browser does.
      const rects = typeof range.getClientRects === "function" ? [...range.getClientRects()] : [];
      for (const top of rects.map((r) => r.top).sort((a, b) => a - b)) {
        if (top - last > halfLine) {
          lines += 1;
          last = top;
        }
      }
      setClamped(lines > 2);
    };
    measure();
    document.fonts?.ready.then(measure);
    return () => {
      live = false;
    };
  }, [track]);
  return [ref, clamped] as const;
}

export function SleeveTheme({ track, artist, dedication, photoUrl, sleevePaletteId }: SleeveThemeProps) {
  const [titleRef, titleClamped] = useTitleClamped(track);
  const idPrefix = useId();
  const ringSource = (dedication || "").trim();
  const palette = getSleevePalette(sleevePaletteId);

  const discs = useMemo(
    () => ({
      left: <DiscSvg idPrefix={`${idPrefix}-l`} ringSource={ringSource} palette={palette} />,
      right: <DiscSvg idPrefix={`${idPrefix}-r`} ringSource={ringSource} palette={palette} />,
    }),
    [idPrefix, ringSource, palette]
  );

  return (
    <div
      dir="ltr"
      className={`${styles.sheet} ${posterRoot.root}`}
      style={{
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        // Sets the three custom properties every palette-aware rule in
        // `sleeve-theme.module.css` reads — "the palette picker sets
        // --bg/--ink on this one sheet directly," per the prototype's
        // own material note.
        ["--sv-bg" as string]: palette.bg,
        ["--sv-ink" as string]: palette.ink,
        ["--sv-soft" as string]: palette.soft,
      }}
      data-testid="sleeve-theme"
    >
      <div className={styles.row}>
        <div className={styles.hearts}>
          <div className={`${styles.disc} ${styles.discLeft}`}>{discs.left}</div>
          <div className={`${styles.disc} ${styles.discRight}`}>{discs.right}</div>
          <div className={styles.sleevePhoto}>
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="" />
            ) : null}
          </div>
        </div>

        <div className={styles.info}>
          <div className={styles.head}>
            <div className={styles.swatches}>
              {/* Fixed accent colours, independent of the ground
                  palette — the prototype's own `--swatch1/2/3` never
                  changed when the palette picker swapped `--bg/--ink`,
                  so these stay literal regardless of `palette`. */}
              <i style={{ background: "#1f6e6b" }} />
              <i style={{ background: "#c6432e" }} />
              <i style={{ background: "#d9a233" }} />
            </div>
            <svg className={styles.mark} viewBox="0 0 46 46" aria-hidden="true">
              <circle cx={23} cy={23} r={15} fill="none" stroke="currentColor" />
              <path
                d="M8 23h30M23 8v30M12 12q11 11 22 0M12 34q11-11 22 0"
                stroke="currentColor"
                strokeWidth={1}
                fill="none"
              />
            </svg>
          </div>
          <h1 ref={titleRef} className={styles.title} data-clamped={titleClamped || undefined} dir="auto">
            {track || " "}
          </h1>
          <p className={styles.artist} dir="auto">{artist || " "}</p>
        </div>
      </div>

      <div className={styles.foot}>
        <span className={styles.footArtist} dir="auto">{artist || " "}</span>
        <span className={styles.footMark}>HEARTFOLIO</span>
      </div>
    </div>
  );
}
