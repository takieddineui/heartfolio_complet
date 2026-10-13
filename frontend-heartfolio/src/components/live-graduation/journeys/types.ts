import type { ComponentType } from "react";
import type { Lang, Story } from "../model";
import type { SharedCopy } from "../copy";
import type { SfxEngine, SfxKit } from "../shared/sfx";

/**
 * What the shared shell hands every journey, and what every journey hands
 * back. The shell owns the flow (start -> page -> finale), the overlays
 * (sheets, lightbox, particles, toast, controls) and the state that outlives
 * a chapter; a journey owns how each moment LOOKS and FEELS.
 *
 * A journey is a registry entry (`registry.ts`), loaded lazily: a recipient
 * downloads the code and fonts of the journey they were sent, not all five.
 */
export interface JourneyContext {
  story: Story;
  lang: Lang;
  copy: SharedCopy;
  sfx: SfxEngine;
  /** False when the visitor prefers reduced motion (or has not said): no
   * scripted effect may run unless this is true. */
  motionAllowed: boolean;
  /** True inside the Studio's Live tab. */
  embedded: boolean;
  /** Scatters this journey's particle shape from the centre of `element`. */
  burstAt: (element: Element | null, count?: number) => void;
  /** Opens the full-screen photo viewer on stop `index`. */
  openLightbox: (index: number) => void;
  /** Toggles playback of a voice message; returns whether it now plays. */
  voice: {
    playingId: string | null;
    toggle: (id: string, url: string) => void;
  };
  /** The scrolling element (null for the first render), for observers that
   * need it as their root. An effect that uses it must list it as a
   * dependency: it arrives one render after mount. */
  scrollEl: HTMLElement | null;
}

export interface StartProps {
  ctx: JourneyContext;
  /** Runs when the visitor begins; resolve when the opening has finished. */
  onBegin: () => Promise<void>;
}

export interface FinaleProps {
  ctx: JourneyContext;
  /** Called when the finale animation has completed. */
  onDone: () => void;
  done: boolean;
  /** The ending message + actions, to render once `done`. */
  ending: React.ReactNode;
}

export interface JourneyDefinition {
  id: string;
  /** Browser theme colour. */
  themeColor: string;
  Start: ComponentType<StartProps>;
  /** Everything in the scrolling page except the finale. */
  Page: ComponentType<{ ctx: JourneyContext; started: boolean }>;
  Finale: ComponentType<FinaleProps>;
  /** CSS class (from the journey's module) that scopes its variables. */
  rootClass: string;
  /** This journey's sound effects. There is no background music. */
  kit: SfxKit;
  /** The shape its particles take (airline: little planes). */
  particle: ParticleShape;
  /** The colours its particles are drawn in. */
  particleColors: readonly string[];
}

/** Draws one particle at the origin; the caller has translated and rotated
 * the context and set `fillStyle`. `size` is the particle's radius-ish. */
export type ParticleShape = (ctx: CanvasRenderingContext2D, size: number, colour: string, age: number) => void;
