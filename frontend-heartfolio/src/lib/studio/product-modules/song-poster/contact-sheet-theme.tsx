import { useMemo } from "react";
import { downsample, generateEnvelope, seedForOrder } from "./waveform";
import styles from "./contact-sheet-theme.module.css";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 1000;
const WAVE_BARS = 90;

/**
 * Contact Sheet — "several photos, not one," per the prototype's own
 * description. See `contact-sheet-theme.module.css`'s own docstring
 * for the honest account: this product's schema collects exactly one
 * photo, so all four frames show the SAME photo rather than three
 * fabricated ones. The grid stays, because dropping it loses the
 * theme entirely; the repetition is the stated adaptation, not a bug.
 *
 * No transport control — same as Ledger and Ephemeris, and for the
 * same reason: nothing in this theme's own design proposes one.
 */
export interface ContactSheetThemeProps {
  track: string;
  artist: string;
  dedication?: string;
  photoUrl?: string;
  youtubeVideoId?: string | null;
  liveCodeSvg?: React.ReactNode;
}

export function ContactSheetTheme({ track, artist, dedication, photoUrl }: ContactSheetThemeProps) {
  const bars = useMemo(() => {
    if (!track && !artist) return null;
    const seed = seedForOrder(track, artist);
    return downsample(generateEnvelope(seed), WAVE_BARS);
  }, [track, artist]);

  return (
    <div
      className={styles.sheet}
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
      data-testid="contact-sheet-theme"
    >
      <div className={styles.head}>
        <span>Contact sheet</span>
      </div>

      <div className={styles.grid}>
        {[0, 1, 2, 3].map((i) => (
          <div className={styles.frame} key={i}>
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="" />
            ) : null}
            <span className={styles.num}>{String(i + 1).padStart(2, "0")}</span>
          </div>
        ))}
      </div>

      <h1 className={styles.title}>{track || " "}</h1>
      <p className={styles.artist}>{artist || " "}</p>

      <div className={styles.wavebox}>
        {bars && (
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
            {Array.from(bars).map((v, i) => {
              const x = (i + 0.5) * (1000 / WAVE_BARS);
              const h = Math.max(2, v * 40);
              return (
                <rect
                  key={i}
                  x={(x - 4.2).toFixed(2)}
                  y={(50 - h).toFixed(2)}
                  width={8.4}
                  height={(h * 2).toFixed(2)}
                  fill="currentColor"
                  opacity={0.32}
                />
              );
            })}
          </svg>
        )}
      </div>

      {dedication && <p className={styles.caption}>{dedication}</p>}

      <div className={styles.foot}>
        <span className={styles.footArtist}>{artist || " "}</span>
        <span className={styles.footMark}>HEARTFOLIO</span>
      </div>
    </div>
  );
}
