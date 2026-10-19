import styles from "./mosaic-theme.module.css";
import posterRoot from "./poster-root.module.css";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 1000;

/**
 * Mosaic — "one photograph on a quiet ground": a hero card floating on
 * a dark, marked field. The simplest of the eight themes structurally
 * — no waveform, no disc, no multi-photo grid.
 *
 * ADAPTED: the progress bar shows no real moment/duration, same static
 * "not started" treatment Player's own progress row uses. The
 * footer's names+date join becomes the same artist + wordmark line
 * most other themes use.
 *
 * THE EIGHT MARKS ARE REAL EMOJI, unmodified — this is what actually
 * renders in a browser, and every OS handles emoji natively. The
 * prototype's own material note is worth repeating rather than
 * dropping silently: "they render in whatever glyph set the device
 * carries… worth a physical proof before this one ships." Nothing new
 * added to that caution here; it was already true of the original.
 */
export interface MosaicThemeProps {
  track: string;
  artist: string;
  dedication?: string;
  photoUrl?: string;
  youtubeVideoId?: string | null;
  liveCodeSvg?: React.ReactNode;
}

interface Mark {
  c: string;
  x: number;
  y: number;
  s: number;
  r: number;
  o: number;
}

/** Direct port of the prototype's own `MOSAIC_MARKS` — authored
 *  percentages, not random, so the composition is identical every
 *  render, and every mark sits in the top/bottom bands a print crop
 *  never reaches. */
const MOSAIC_MARKS: Mark[] = [
  { c: "❤️", x: 14, y: 8, s: 46, r: -12, o: 0.92 },
  { c: "🎵", x: 34, y: 15, s: 28, r: 9, o: 0.7 },
  { c: "🎶", x: 62, y: 7, s: 40, r: -7, o: 0.86 },
  { c: "✨", x: 84, y: 16, s: 26, r: 0, o: 0.72 },
  { c: "🎧", x: 16, y: 88, s: 34, r: -9, o: 0.8 },
  { c: "❤️", x: 40, y: 92, s: 40, r: 6, o: 0.92 },
  { c: "🎵", x: 63, y: 86, s: 28, r: 10, o: 0.7 },
  { c: "💿", x: 84, y: 92, s: 30, r: -6, o: 0.74 },
];

export function MosaicTheme({ track, artist, dedication, photoUrl }: MosaicThemeProps) {
  return (
    <div
      dir="ltr"
      className={`${styles.sheet} ${posterRoot.root}`}
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
      data-testid="mosaic-theme"
    >
      {MOSAIC_MARKS.map((m, i) => (
        <span
          key={i}
          className={styles.mark}
          aria-hidden="true"
          style={{ left: `${m.x}%`, top: `${m.y}%`, opacity: m.o, ["--r" as string]: `${m.r}deg` }}
        >
          <i className={styles.markGlyph} style={{ fontSize: m.s }}>
            {m.c}
          </i>
        </span>
      ))}

      <div className={styles.hero}>
        <div className={styles.heroPhoto}>
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" />
          ) : null}
        </div>
        <div className={styles.heroBody}>
          <div className={styles.row}>
            <div className={styles.titleBlock}>
              <h1 className={styles.title} dir="auto">{track || " "}</h1>
              <p className={styles.artist} dir="auto">{artist || " "}</p>
            </div>
            <svg className={styles.heart} viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 20.5S3 14.8 3 8.9C3 5.6 5.5 3.4 8.3 3.4c1.8 0 3.3.9 4.2 2.3.9-1.4 2.4-2.3 4.2-2.3 2.8 0 5.3 2.2 5.3 5.5 0 5.9-9 11.6-9 11.6z"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.4}
              />
            </svg>
          </div>

          <div className={styles.progress}>
            <div className={styles.rule} />
            <div className={styles.times}>
              <span>0:00</span>
              <span />
            </div>
          </div>

          {dedication && <p className={styles.dedication} dir="auto">{dedication}</p>}

          <div className={styles.foot}>
            <span className={styles.footArtist} dir="auto">{artist || " "}</span>
            <span className={styles.footMark}>HEARTFOLIO</span>
          </div>
        </div>
      </div>
    </div>
  );
}
