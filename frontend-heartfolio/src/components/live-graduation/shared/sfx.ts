/**
 * Sound effects, synthesised with Web Audio. NO FILES and NO BACKGROUND MUSIC
 * (product decision): every journey has a small kit of short effects - a
 * stamp, a bell, a take-off - and the graduate can mute them.
 *
 * Browsers only allow audio after a user gesture, so the AudioContext is
 * created lazily by the first `play`, which every journey triggers from the
 * visitor's tap on the start screen. Nothing here ever plays on load.
 */

export type SfxKit = Record<string, (engine: SfxEngine) => void>;

export class SfxEngine {
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private kit: SfxKit = {};
  private enabled = true;

  /** Set by the shell from the creator's setting and the visitor's toggle. */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  setKit(kit: SfxKit) {
    this.kit = kit;
  }

  /** Lazily creates and resumes the context; null when unavailable or muted. */
  private ready(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.context) {
      const Ctor =
        typeof window === "undefined"
          ? undefined
          : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.context = new Ctor();
      } catch {
        return null;
      }
      const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    try {
      void this.context.resume();
    } catch {
      /* a context that cannot resume simply stays silent */
    }
    return this.context;
  }

  play(kind: string) {
    const effect = this.kit[kind];
    if (!effect || !this.ready()) return;
    try {
      effect(this);
    } catch {
      /* sound is decoration: an effect that throws must never break the page */
    }
  }

  /** A pitched note. `at` is seconds from now. */
  tone(frequency: number, at: number, duration: number, volume: number, type: OscillatorType = "sine", slideTo?: number) {
    const ctx = this.context;
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  /** Filtered noise: a thud, a hiss, an engine. */
  hiss(at: number, duration: number, volume: number, filter: BiquadFilterType, from: number, to?: number, loop = false) {
    const ctx = this.context;
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime + at;
    const source = ctx.createBufferSource();
    const biquad = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = this.noise;
    source.loop = loop;
    biquad.type = filter;
    biquad.frequency.setValueAtTime(from, t);
    if (to) biquad.frequency.linearRampToValueAtTime(to, t + duration * 0.7);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + Math.min(0.05, duration / 4));
    gain.gain.linearRampToValueAtTime(volume * 0.8, t + duration * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(biquad);
    biquad.connect(gain);
    gain.connect(ctx.destination);
    source.start(t, Math.random());
    source.stop(t + duration + 0.05);
  }

  dispose() {
    const ctx = this.context;
    this.context = null;
    if (ctx) void ctx.close().catch(() => undefined);
  }
}
