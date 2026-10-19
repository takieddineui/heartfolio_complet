import styles from "./award-theme.module.css";
import posterRoot from "./poster-root.module.css";

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;
const DISC_R = 110;
const GROOVE_RADII = [96, 86, 76, 66, 56];

/**
 * Award — "the keepsake as a physical object," per the prototype: a
 * photo beside a small disc inside a drawn frame, closing on an
 * engraved plaque. LANDSCAPE ONLY, matching the prototype's own
 * registry (`ratios:['landscape']`) — its portrait branch was already
 * unreachable there, so nothing is lost by not porting it. First theme
 * in this product needing a genuinely different canvas shape (1200x800,
 * 3:2) from the five portrait themes before it.
 *
 * ADAPTED: album/year (header) and the plaque's names+date join are
 * dropped — same reasoning as every theme so far, none of those
 * fields exist in this schema. The plaque's own material note in the
 * prototype is worth repeating rather than treating as settled: its
 * brass tone "is a print-safe stand-in… worth a physical proof before
 * this one ships."
 *
 * No waveform, no transport control — this theme's own design has
 * neither.
 */
export interface AwardThemeProps {
  track: string;
  artist: string;
  dedication?: string;
  photoUrl?: string;
  youtubeVideoId?: string | null;
  liveCodeSvg?: React.ReactNode;
}

export function AwardTheme({ track, artist, dedication, photoUrl }: AwardThemeProps) {
  return (
    <div
      dir="ltr"
      className={`${styles.sheet} ${posterRoot.root}`}
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
      data-testid="award-theme"
    >
      <div className={styles.frameOuter} />
      <div className={styles.frameInner} />

      <div className={styles.head}>Awarded for one recording</div>

      <div className={styles.row}>
        <div className={styles.photo}>
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" />
          ) : null}
        </div>
        <div className={styles.info}>
          <svg className={styles.disc} viewBox="0 0 220 220" aria-hidden="true">
            <circle cx={DISC_R} cy={DISC_R} r={108} fill="#1a1917" />
            {GROOVE_RADII.map((r, i) => (
              <circle
                key={r}
                cx={DISC_R}
                cy={DISC_R}
                r={r}
                fill="none"
                stroke="#cfc8b4"
                strokeWidth={1}
                opacity={i % 2 ? 0.5 : 0.8}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <circle cx={DISC_R} cy={DISC_R} r={38} fill="#f1ede3" />
            <circle cx={DISC_R} cy={DISC_R} r={38} fill="none" stroke="#cfc8b4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <circle cx={DISC_R} cy={DISC_R} r={2} fill="#1a1917" />
          </svg>
          <h1 className={styles.title} dir="auto">{track || " "}</h1>
          <p className={styles.artist} dir="auto">{artist || " "}</p>
        </div>
      </div>

      <div className={styles.plaque}>
        <div className={styles.plaqueRule} />
        {dedication && <p className={styles.plaqueDedication} dir="auto">{dedication}</p>}
        <p className={styles.plaqueFoot} dir="auto">
          <span className={styles.plaqueArtist}>{artist || " "}</span>
          <span className={styles.plaqueMark}> · HEARTFOLIO</span>
        </p>
      </div>
    </div>
  );
}
