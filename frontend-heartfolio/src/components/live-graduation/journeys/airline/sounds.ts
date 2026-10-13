import type { SfxKit } from "../../shared/sfx";
import type { ParticleShape } from "../types";

/**
 * Next Chapter Airways' sound effects, ported from the prototype's kit:
 * a cabin chime on boarding, a passport-stamp thud, a soft flip for a
 * postcard, engines spooling for take-off and a two-note landing chime.
 * Synthesised; there are no audio files.
 */
export const AIRLINE_KIT: SfxKit = {
  start: (e) => {
    e.hiss(0, 0.4, 0.25, "bandpass", 1800, 4200);
    e.tone(988, 0.5, 1.4, 0.16);
    e.tone(784, 1, 1.8, 0.16);
  },
  ach: (e) => e.hiss(0, 0.18, 0.6, "lowpass", 380),
  msg: (e) => e.hiss(0, 0.12, 0.08, "highpass", 3000),
  finale: (e) => e.hiss(0, 3.2, 0.4, "lowpass", 200, 1400, true),
  win: (e) => {
    e.tone(988, 0, 1.4, 0.16);
    e.tone(784, 0.5, 1.8, 0.16);
  },
};

export const AIRLINE_PARTICLE_COLORS = ["#ff6b4a", "#ffb547", "#2f7fd8", "#ffffff"] as const;

/** A tiny paper plane; white confetti stays a plain square so the burst reads
 * as planes among confetti, as in the prototype. */
export const airlineParticle: ParticleShape = (ctx, s, colour) => {
  if (colour === "#ffffff") {
    ctx.fillRect(-s / 2, -s / 4, s, s / 2);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(s, 0);
  ctx.lineTo(-s, -s * 0.55);
  ctx.lineTo(-s * 0.45, 0);
  ctx.lineTo(-s, s * 0.55);
  ctx.closePath();
  ctx.fill();
};
