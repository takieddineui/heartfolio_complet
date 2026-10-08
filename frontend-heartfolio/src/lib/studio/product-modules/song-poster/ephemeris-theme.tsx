import { useMemo } from "react";
import { downsample, generateEnvelope, seedForOrder } from "./waveform";
import styles from "./ephemeris-theme.module.css";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 1000;
const RING_POINTS = 520;
const PLATE_CENTER = 280;
const PLATE_RADIUS = 232;
const PLATE_AMPLITUDE = 27;

/**
 * Ephemeris — "an astronomical dial... the circle finally means
 * something," per the prototype. See `ephemeris-theme.module.css`'s
 * own docstring for the full, honest account: the theme's central idea
 * — circumference as runtime, the moment as a plotted point — needs a
 * `duration` and a moment-position this product's schema does not
 * collect. What is drawn here is the part that survives that
 * adaptation intact: concentric rings, a polar ring built from the
 * real seeded waveform (the same data every theme shares), and a
 * circular photo at the centre.
 *
 * Same props shape as every other theme (`theme-registry.ts`);
 * `youtubeVideoId` accepted for interface parity, genuinely unused —
 * Ephemeris has no transport control, the same as Ledger and for the
 * same reason: nothing in its own design proposes one.
 */
export interface EphemerisThemeProps {
  track: string;
  artist: string;
  dedication?: string;
  photoUrl?: string;
  youtubeVideoId?: string | null;
  liveCodeSvg?: React.ReactNode;
}

/** The polar ring path — direct adaptation of the prototype's own
 *  `platePolar()`, reading the real seeded envelope instead of the
 *  fixed one. */
function polarRingPath(envelope: Float64Array): string {
  const points: string[] = [];
  for (let i = 0; i <= RING_POINTS; i++) {
    const k = i % RING_POINTS;
    const angle = (k / RING_POINTS) * Math.PI * 2 - Math.PI / 2;
    const r = PLATE_RADIUS + (envelope[k]! - 0.5) * PLATE_AMPLITUDE * 2;
    const x = PLATE_CENTER + Math.cos(angle) * r;
    const y = PLATE_CENTER + Math.sin(angle) * r;
    points.push(`${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return points.join(" ") + " Z";
}

export function EphemerisTheme({ track, artist, dedication, photoUrl }: EphemerisThemeProps) {
  const ringPath = useMemo(() => {
    if (!track && !artist) return null;
    const seed = seedForOrder(track, artist);
    const envelope = downsample(generateEnvelope(seed), RING_POINTS);
    return polarRingPath(envelope);
  }, [track, artist]);

  return (
    <div
      className={styles.sheet}
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
      data-testid="ephemeris-theme"
    >
      <div className={styles.head}>
        <span>Ephemeris of one recording</span>
      </div>

      <div className={styles.plate}>
        <svg viewBox="0 0 560 560" aria-hidden="true">
          <circle cx={PLATE_CENTER} cy={PLATE_CENTER} r={279} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.45} vectorEffect="non-scaling-stroke" />
          <circle cx={PLATE_CENTER} cy={PLATE_CENTER} r={262} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.28} vectorEffect="non-scaling-stroke" />
          {ringPath && (
            <path d={ringPath} fill="none" stroke="currentColor" strokeWidth={1.15} opacity={0.92} vectorEffect="non-scaling-stroke" />
          )}
          <circle cx={PLATE_CENTER} cy={PLATE_CENTER} r={198} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.22} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className={styles.photo}>
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" />
          ) : null}
        </div>
      </div>

      <h1 className={styles.title}>{track || " "}</h1>
      <p className={styles.artist}>{artist || " "}</p>

      {dedication && <p className={styles.dedication}>{dedication}</p>}

      <div className={styles.foot}>
        <span>{artist || " "}</span>
        <span>HEARTFOLIO</span>
      </div>
    </div>
  );
}
