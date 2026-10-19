import { useMemo } from "react";
import { downsample, generateEnvelope, seedForOrder } from "./waveform";
import styles from "./ledger-theme.module.css";
import posterRoot from "./poster-root.module.css";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 1000;
const WAVE_POINTS = 340;

/**
 * Ledger — "small evidence in a document," per the prototype's own
 * description. Same props shape as `PlayerThemeProps` (every theme
 * shares one data contract — `theme-registry.ts`'s own note on why),
 * but this component genuinely uses less of it, and that is a real,
 * stated adaptation rather than an incomplete port:
 *
 * NO TRANSPORT CONTROL, ANYWHERE. The prototype's own Ledger has none
 * — it is styled as a session-log document, not a player. Unlike
 * Player, where "make the iframe invisible, simulate a real player"
 * was a specific instruction this theme's own chrome asks for, Ledger
 * asks for nothing of the kind. Giving it a play button would be
 * inventing interactivity the design never called for. OPEN QUESTION,
 * not resolved here: if Heartfolio wants every theme to offer audio
 * regardless of its own visual language, that needs a control living
 * OUTSIDE any one theme's chrome — a real product decision, not
 * something to decide unilaterally inside one theme's component.
 *
 * THE SIX-ROW EVIDENCE TABLE (Album / Year / Runtime / Mark / Logged /
 * Location) IS NOT RENDERED. Every one of those six rows reads from a
 * field this product's schema does not collect — there is no album,
 * year, moment timestamp, moment date or moment place anywhere in
 * `SongPosterValues`. Inventing values for them would be exactly the
 * kind of fabricated content this whole project has avoided everywhere
 * else (the same reasoning `MUSIC_PRESETS` in Love Story Timeline
 * shipped with zero fabricated tracks rather than a placeholder tone).
 * Dropping the block is the honest adaptation; filling it with
 * "Unknown" six times is not.
 */
export interface LedgerThemeProps {
  track: string;
  artist: string;
  dedication?: string;
  photoUrl?: string;
  /** Accepted for interface parity with every other theme (all eight
   *  share one prop contract — see `theme-registry.ts`) but genuinely
   *  unused here, per this component's own docstring above. */
  youtubeVideoId?: string | null;
  liveCodeSvg?: React.ReactNode;
}

export function LedgerTheme({ track, artist, dedication, photoUrl }: LedgerThemeProps) {
  const bars = useMemo(() => {
    if (!track && !artist) return null;
    const seed = seedForOrder(track, artist);
    return downsample(generateEnvelope(seed), WAVE_POINTS);
  }, [track, artist]);

  return (
    <div
      dir="ltr"
      className={`${styles.sheet} ${posterRoot.root}`}
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
      data-testid="ledger-theme"
    >
      <div className={styles.head}>
        <span>Session log</span>
        <span>Sheet 01 / 01</span>
      </div>
      <div className={styles.rule} />

      <h1 className={styles.title} dir="auto">{track || " "}</h1>
      <p className={styles.artist} dir="auto">{artist || " "}</p>

      <div className={styles.mid}>
        <div className={styles.photo}>
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" />
          ) : null}
        </div>
      </div>
      <p className={styles.caption}>Print · affixed</p>

      <div className={styles.wavebox}>
        <span className={styles.wavelab}>Programme · full runtime</span>
        {bars && (
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
            <path
              d={Array.from(bars)
                .map((v, i) => {
                  const x = (i + 0.5) * (1000 / WAVE_POINTS);
                  const h = v * 44;
                  return `M${x.toFixed(2)} ${(50 - h).toFixed(2)}V${(50 + h).toFixed(2)}`;
                })
                .join("")}
              stroke="currentColor"
              strokeWidth={1}
              opacity={0.86}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>

      {dedication && <p className={styles.dedication} dir="auto">{dedication}</p>}

      <div className={styles.foot}>
        <span className={styles.footArtist} dir="auto">{artist || " "}</span>
        <span className={styles.footMark}>HEARTFOLIO</span>
      </div>
    </div>
  );
}
