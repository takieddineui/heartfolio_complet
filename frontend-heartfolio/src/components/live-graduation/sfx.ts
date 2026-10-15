import type { JourneyId } from "@/lib/studio/product-modules/graduation-keepsake/journeys";

/**
 * SOUND EFFECTS ONLY, one kit per journey: the prototype's `SFX`, ported with
 * every tone, filter and timing kept. There is no background music in this
 * product and nothing here is an audio file: each sound is a few oscillators
 * or a burst of filtered noise, made on the spot with Web Audio. The longest
 * is a four-second filtered rumble under the rocket launch.
 *
 * The context is created on the first sound, which is always inside a tap
 * (the opening), so no browser blocks it. `dispose()` closes it when the
 * keepsake is left, including the Studio's preview.
 */
export type SoundKind = "start" | "ach" | "msg" | "tick" | "finale" | "coin" | "win";

export class JourneySounds {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  constructor(private journey: JourneyId) {}

  private ready(): AudioContext | null {
    if (!this.ctx) {
      const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as
        | typeof AudioContext
        | undefined;
      if (!AC) return null;
      try {
        this.ctx = new AC();
      } catch {
        return null;
      }
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    void this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  private tone(f: number, at: number, dur: number, vol: number, type: OscillatorType = "sine", slide?: number) {
    const c = this.ctx!;
    const t = c.currentTime + at;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hiss(at: number, dur: number, vol: number, type: BiquadFilterType, f: number, f2?: number, loop?: boolean) {
    const c = this.ctx!;
    const t = c.currentTime + at;
    const s = c.createBufferSource();
    const fl = c.createBiquadFilter();
    const g = c.createGain();
    s.buffer = this.noise;
    s.loop = Boolean(loop);
    fl.type = type;
    fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.linearRampToValueAtTime(f2, t + dur * 0.7);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.05, dur / 4));
    g.gain.linearRampToValueAtTime(vol * 0.8, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl);
    fl.connect(g);
    g.connect(c.destination);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  play(kind: SoundKind) {
    if (typeof window === "undefined" || !this.ready()) return;
    const tone = this.tone.bind(this);
    const hiss = this.hiss.bind(this);
    const kits: Record<JourneyId, Partial<Record<SoundKind, () => void>>> = {
      airline: {
        start: () => { hiss(0, 0.4, 0.25, "bandpass", 1800, 4200); tone(988, 0.5, 1.4, 0.16); tone(784, 1, 1.8, 0.16); },
        ach: () => hiss(0, 0.18, 0.6, "lowpass", 380),
        msg: () => hiss(0, 0.12, 0.08, "highpass", 3000),
        finale: () => hiss(0, 3.2, 0.4, "lowpass", 200, 1400, true),
        win: () => { tone(988, 0, 1.4, 0.16); tone(784, 0.5, 1.8, 0.16); },
      },
      space: {
        start: () => { [0, 1, 2].forEach((k) => tone(880, k, 0.15, 0.12, "square")); tone(1320, 3, 0.5, 0.14, "square"); hiss(3, 2.5, 0.35, "lowpass", 150, 900, true); },
        ach: () => { tone(660, 0, 0.1, 0.1, "square"); tone(990, 0.1, 0.25, 0.1, "square"); },
        msg: () => hiss(0, 0.8, 0.12, "bandpass", 2400),
        tick: () => tone(1200, 0, 0.03, 0.03, "square"),
        finale: () => hiss(0, 4, 0.5, "lowpass", 120, 1600, true),
        win: () => [523, 659, 784, 1046].forEach((f, k) => tone(f, k * 0.12, 0.5, 0.1, "triangle")),
      },
      arcade: {
        start: () => { tone(988, 0, 0.08, 0.1, "square"); tone(1319, 0.08, 0.3, 0.1, "square"); },
        ach: () => [523, 659, 784, 1047].forEach((f, k) => tone(f, k * 0.07, 0.12, 0.08, "square")),
        msg: () => tone(440, 0, 0.06, 0.06, "square"),
        tick: () => tone(880 + Math.random() * 200, 0, 0.025, 0.03, "square"),
        coin: () => tone(1500, 0, 0.04, 0.05, "square"),
        win: () => [523, 523, 523, 659, 784, 659, 784, 1047].forEach((f, k) => tone(f, k * 0.1, 0.14, 0.09, "square")),
      },
      museum: {
        start: () => { hiss(0, 0.15, 0.3, "highpass", 4000); hiss(0.18, 0.15, 0.3, "highpass", 4500); [523, 659, 784, 1047, 1319].forEach((f, k) => tone(f, 0.4 + k * 0.08, 1.6, 0.05, "triangle")); },
        ach: () => tone(196, 0, 1.2, 0.1, "sine"),
        msg: () => tone(1046, 0, 0.4, 0.05, "sine"),
        finale: () => hiss(0, 2, 0.15, "lowpass", 600),
        win: () => [392, 523, 659, 784].forEach((f, k) => tone(f, k * 0.15, 2, 0.06, "triangle")),
      },
      summit: {
        start: () => hiss(0, 2.4, 0.2, "bandpass", 500, 900),
        ach: () => { hiss(0, 0.5, 0.2, "bandpass", 1200, 2500); tone(320, 0, 0.12, 0.1, "triangle"); },
        msg: () => tone(220, 0, 0.15, 0.08, "triangle"),
        finale: () => hiss(0, 3, 0.18, "bandpass", 400, 900),
        win: () => [392, 494, 587, 784].forEach((f, k) => tone(f, k * 0.25, 2.4, 0.07, "sine")),
      },
    };
    kits[this.journey][kind]?.();
  }

  dispose() {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
