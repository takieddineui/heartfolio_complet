import type { ThemeSelections } from "@/types/studio";
import type { CoordinatesValue } from "@/components/studio/generic-form/field-inputs";

export interface MapPhoto {
  url: string;
  mimeType: string;
  filename: string;
  /** Durable Django/R2 reference, stamped in when the photo is uploaded at
   * checkout. The delivery renderers read `photo.assetId` to fetch the
   * original bytes server-side; `url` is only ever a preview. */
  assetId?: string;
}

export interface MapValues {
  partner1: string;
  partner2: string;
  date: string;
  message: string;
  locationLabel: string;
  coordinates: CoordinatesValue;
  photo?: MapPhoto;
}

/** Sample content so the preview shows something real immediately —
 * same reasoning as Timeline's initial state. Coordinates are the Eiffel
 * Tower, a deliberately recognizable landmark so the map projection's
 * correctness is easy to eyeball during the end-to-end trace. */
export function createInitialState(): MapValues {
  return {
    partner1: "Emma",
    partner2: "James",
    date: "2019-04-12",
    message: "Right here, a rainy afternoon, a shared umbrella.",
    locationLabel: "Paris, France",
    coordinates: { lat: 48.8584, lng: 2.2945 },
  };
}

export function createInitialThemeSelections(): ThemeSelections {
  return {
    palette: "classic",
    typography: "serif-classic",
    mapStyle: "line",
    markerStyle: "heart",
    frame: "thin-black",
    format: "print",
    scale: 100,
  };
}
