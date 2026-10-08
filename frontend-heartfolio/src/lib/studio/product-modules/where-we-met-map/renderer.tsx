import type { ProductRendererProps } from "@/types/studio";
import type { MapValues } from "./initial-state";
import styles from "./renderer.module.css";

/**
 * CSS Module class lookups. Typed `string | undefined` because
 * `noUncheckedIndexedAccess` (on in this project) widens every CSS Module
 * property access — a class that is missing from the stylesheet resolves to
 * `undefined` at runtime, and the type now says so. Consumers fall back to
 * an empty class, which is what the old implicitly-`string` version already
 * did at runtime when interpolated into a template literal.
 */
const FRAME_CLASS: Record<string, string | undefined> = {
  none: styles.frameNone,
  "thin-black": styles.frameThinBlack,
  vintage: styles.frameVintage,
};

const MAP_STYLE_CLASS: Record<string, string | undefined> = {
  line: styles.mapLine,
  vintage: styles.mapVintage,
  night: styles.mapNight,
  topographic: styles.mapTopographic,
};

/** Deterministic equirectangular projection — given the same
 * coordinates, always the same pixel position. No map tiles, no
 * external service, no backend: an art-directed static illustration
 * (a decorative grid + graticule lines), which is what the actual
 * product brief describes ("a quiet, art-directed map... marked with a
 * single heart") rather than literal cartography. Per Step 8's
 * instruction, this validates the renderer contract without
 * prematurely building production map infrastructure. */
function project(lat: number, lng: number, width: number, height: number) {
  const x = ((lng + 180) / 360) * width;
  const y = ((90 - lat) / 180) * height;
  return { x, y };
}

/** A minimal decorative backdrop standing in for a real basemap —
 * latitude/longitude graticule lines plus a scattering of dots, styled
 * per `mapStyle` via CSS Module classes on the wrapping <svg>. */
function DecorativeMapBackdrop({ styleId }: { styleId: string }) {
  const gridLines = Array.from({ length: 7 }, (_, i) => (i + 1) * (100 / 8));
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={`h-full w-full ${MAP_STYLE_CLASS[styleId] ?? MAP_STYLE_CLASS.line}`} fill="none">
      {gridLines.map((pos) => (
        <line key={`v-${pos}`} x1={pos} y1="0" x2={pos} y2="100" strokeWidth="0.3" />
      ))}
      {gridLines.map((pos) => (
        <line key={`h-${pos}`} x1="0" y1={pos} x2="100" y2={pos} strokeWidth="0.3" />
      ))}
      {Array.from({ length: 40 }).map((_, i) => {
        const seed = (i * 9301 + 49297) % 233280;
        const x = (seed / 233280) * 100;
        const y = ((seed * 37) % 233280 / 233280) * 100;
        return <circle key={i} cx={x} cy={y} r="0.4" fill="currentColor" opacity="0.5" />;
      })}
    </svg>
  );
}

function Marker({ shape }: { shape: string }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "var(--p-accent)" };
  if (shape === "pin") {
    return (
      <svg {...common}>
        <path d="M12 1c6.1 0 11 4.8 11 10.8C23 19.6 12 23 12 23S1 19.6 1 11.8C1 5.8 5.9 1 12 1Z" />
      </svg>
    );
  }
  if (shape === "star") {
    return (
      <svg {...common}>
        <path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.8-6.3 3.8 1.7-7L2 9.2l7.1-.6L12 2Z" />
      </svg>
    );
  }
  if (shape === "dot") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="7" />
      </svg>
    );
  }
  // heart (default)
  return (
    <svg {...common}>
      <path d="M12 21s-8-4.5-8-11a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.5-8 11-8 11Z" />
    </svg>
  );
}

export function WhereWeMetMapRenderer({ values, tokens, themeSelections, locale, t }: ProductRendererProps<MapValues>) {
  const frameClass = FRAME_CLASS[themeSelections.frame as string] ?? FRAME_CLASS["thin-black"];
  const mapStyleId = (themeSelections.mapStyle as string) ?? "line";
  const markerStyleId = (themeSelections.markerStyle as string) ?? "heart";

  const { lat, lng } = values.coordinates ?? { lat: null, lng: null };
  const hasCoordinates = lat !== null && lng !== null;
  const position = hasCoordinates ? project(lat as number, lng as number, 100, 100) : null;

  const date = values.date ? new Date(values.date) : null;
  const dateLabel = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(locale, { month: "long", day: "numeric", year: "numeric" }) : "";

  return (
    <div className={`${styles.poster} ${frameClass}`} style={tokens as React.CSSProperties}>
      <div className={styles.mapArea}>
        <DecorativeMapBackdrop styleId={mapStyleId} />
        {position && (
          <div className={styles.marker} style={{ left: `${position.x}%`, top: `${position.y}%` }} aria-label={t("renderer.marker", { label: values.locationLabel })}>
            <Marker shape={markerStyleId} />
          </div>
        )}
      </div>

      <footer className={styles.footer}>
        <p className={styles.names}>
          {values.partner1} &amp; {values.partner2}
        </p>
        {values.locationLabel && <p className={styles.locationLabel}>{values.locationLabel}</p>}
        {dateLabel && <p className={styles.date}>{dateLabel}</p>}
        {values.message && <p className={styles.message}>&ldquo;{values.message}&rdquo;</p>}
      </footer>
    </div>
  );
}
