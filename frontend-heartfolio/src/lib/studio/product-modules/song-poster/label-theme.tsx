import styles from "./label-theme.module.css";
import posterRoot from "./poster-root.module.css";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 1000;
const DISC_R = 280;
const GROOVE_RADII = [258, 240, 222, 204, 186, 168, 150];

/**
 * Label — a vinyl record: dark disc, concentric grooves, the photo as
 * the circular label at its centre. `.lb-meta` (duration + momentAt)
 * and the header's album/year are dropped, same reasoning as every
 * theme so far — none of those four fields exist in this product's
 * schema. The footer's names/place/date join is replaced with the
 * same artist + wordmark footer every other theme uses.
 *
 * No transport control, no waveform at all — this theme's own design
 * has neither; the grooves are purely decorative circles, not data.
 */
export interface LabelThemeProps {
  track: string;
  artist: string;
  dedication?: string;
  photoUrl?: string;
  youtubeVideoId?: string | null;
  liveCodeSvg?: React.ReactNode;
}

export function LabelTheme({ track, artist, dedication, photoUrl }: LabelThemeProps) {
  return (
    <div
      dir="ltr"
      className={`${styles.sheet} ${posterRoot.root}`}
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
      data-testid="label-theme"
    >
      <div className={styles.head}>Pressed for one recording</div>

      <div className={styles.disc}>
        <svg viewBox="0 0 560 560" aria-hidden="true">
          <circle cx={DISC_R} cy={DISC_R} r={278} fill="#101012" />
          {GROOVE_RADII.map((r, i) => (
            <circle
              key={r}
              cx={DISC_R}
              cy={DISC_R}
              r={r}
              fill="none"
              stroke="#2b2b2e"
              strokeWidth={1}
              opacity={i % 2 ? 0.55 : 0.85}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        <div className={styles.label}>
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" />
          ) : null}
        </div>
        <span className={styles.spindle} />
      </div>

      <h1 className={styles.title} dir="auto">{track || " "}</h1>
      <p className={styles.artist} dir="auto">{artist || " "}</p>

      {dedication && <p className={styles.dedication} dir="auto">{dedication}</p>}

      <div className={styles.foot}>
        <span className={styles.footArtist} dir="auto">{artist || " "}</span>
        <span className={styles.footMark}>HEARTFOLIO</span>
      </div>
    </div>
  );
}
