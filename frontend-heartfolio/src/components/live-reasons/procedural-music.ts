import type { GiftDefinition, GiftId } from "@/lib/studio/product-modules/reasons-i-love-you/gifts";

/**
 * EACH GIFT'S OWN INSTRUMENT, GENERATED LIVE (Web Audio). No audio file, no
 * upload, no storage: a kalimba for the jar, a ukulele for the daisy, a
 * vibraphone for the deck and glass chimes for the cookies, played from the
 * gift's scale or chords. Ported from the prototype (`Music` in
 * `reasons-i-love-you.html`) with the patterns, envelopes and levels kept
 * exactly; only the shape changed: a class with an explicit `dispose`, so
 * leaving the page (or the Studio's preview) actually closes the audio.
 *
 * NEVER STARTS ON ITS OWN. Nothing here runs until `start()` or `sfx()` is
 * called from a tap, which is also what browsers require before audio plays.
 */
type AudioContextCtor = typeof AudioContext;

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class ProceduralMusic {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextT = 0;
  private step = 0;
  private playing = false;

  constructor(private readonly gift: GiftDefinition) {}

  get isPlaying() {
    return this.playing;
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === "undefined") return null;
    const AC: AudioContextCtor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!AC) return null;
    const c = (this.ctx = new AC());
    this.out = c.createGain();
    this.out.gain.value = 0;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 4200;
    this.out.connect(lp);
    lp.connect(c.destination);
    return c;
  }

  async start() {
    if (this.playing) return;
    const c = this.ensure();
    if (!c || !this.out) return;
    this.playing = true;
    try {
      await c.resume();
    } catch {
      /* the next tap will try again */
    }
    const t = c.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0.8, t + 1.5);
    this.nextT = t + 0.1;
    this.step = 0;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 100);
  }

  stop() {
    this.playing = false;
    const c = this.ctx;
    if (!c || !this.out) return;
    const t = c.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + 0.5);
    setTimeout(() => {
      if (!this.playing && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }, 600);
  }

  /** Closes the audio context. After this the instance is spent. */
  dispose() {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const c = this.ctx;
    this.ctx = null;
    this.out = null;
    if (c && c.state !== "closed") void c.close().catch(() => undefined);
  }

  private tick() {
    const c = this.ctx;
    if (!c) return;
    const dt = 60 / this.gift.bpm / 2;
    while (this.nextT < c.currentTime + 0.6) {
      this.play(this.nextT, this.step++);
      this.nextT += dt;
    }
  }

  private osc(f: number, t: number, dur: number, vol: number, type: OscillatorType, att = 0.005, trem?: number) {
    const c = this.ctx;
    if (!c || !this.out) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (trem) {
      const l = c.createOscillator();
      const lg = c.createGain();
      l.frequency.value = trem;
      lg.gain.value = vol * 0.45;
      l.connect(lg);
      lg.connect(g.gain);
      l.start(t);
      l.stop(t + dur);
    }
    o.connect(g);
    g.connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private play(t: number, s: number) {
    const g = this.gift;
    if (g.instrument === "kalimba" && g.scale) {
      const pat = [0, 2, 4, 2, 5, 4, 3, 1, 0, 4, 6, 4, 7, 5, 4, 2];
      if (s % 8 !== 7) {
        const m = g.scale[pat[s % 16]!]!;
        this.osc(hz(m), t, 1.1, 0.13, "sine", 0.003);
        this.osc(hz(m) * 5.4, t, 0.12, 0.025, "sine", 0.001);
      }
      if (s % 8 === 0) this.osc(hz(g.scale[0]! - 12), t, 1.6, 0.08, "sine", 0.01);
    } else if (g.instrument === "ukulele" && g.chords) {
      const ch = g.chords[Math.floor(s / 8) % 4]!;
      const pos = s % 8;
      if ([0, 3, 4, 6].includes(pos)) ch.forEach((m, k) => this.osc(hz(m), t + (pos === 3 ? 3 - k : k) * 0.014, 0.45, 0.045, "triangle", 0.002));
      if (pos === 7) this.osc(hz(ch[3]! + 12), t, 0.3, 0.035, "triangle", 0.002);
    } else if (g.instrument === "vibraphone" && g.chords) {
      const ch = g.chords[Math.floor(s / 8) % 4]!;
      const pos = s % 8;
      if (pos === 0) ch.forEach((m) => this.osc(hz(m), t, 2.6, 0.045, "sine", 0.004, 5.5));
      if (pos === 0 || pos === 5) this.osc(hz(ch[0]! - 24), t, 0.9, 0.1, "sine", 0.01);
      if ([2, 3, 6].includes(pos)) this.osc(hz(ch[(s + pos) % 4]! + 12), t, 1.4, 0.04, "sine", 0.004, 5.5);
    } else if (g.scale) {
      if (Math.random() < 0.55 || s % 4 === 0) {
        const m = g.scale[Math.floor(Math.random() * g.scale.length)]!;
        this.osc(hz(m), t + Math.random() * 0.05, 3.2, 0.05, "sine", 0.002);
        this.osc(hz(m) * 2.76, t, 0.8, 0.012, "sine", 0.001);
      }
      if (s % 16 === 0) this.osc(hz(g.scale[0]! - 24), t, 4, 0.05, "sine", 0.4);
    }
  }

  /** The small sound of a reason being opened, or of the last one. */
  sfx(kind: "open" | "final") {
    const c = this.ensure();
    if (!c) return;
    void c.resume().catch(() => undefined);
    const t = c.currentTime + 0.01;
    const blip = (f: number, at: number, d: number, v: number, type: OscillatorType = "sine", slide?: number) => {
      const o = c.createOscillator();
      const e = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t + at);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + at + d);
      e.gain.setValueAtTime(0, t + at);
      e.gain.linearRampToValueAtTime(v, t + at + 0.005);
      e.gain.exponentialRampToValueAtTime(0.0001, t + at + d);
      o.connect(e);
      e.connect(c.destination);
      o.start(t + at);
      o.stop(t + at + d + 0.05);
    };
    const crunch = (at: number, d: number, v: number) => {
      const b = c.createBuffer(1, Math.floor(c.sampleRate * d), c.sampleRate);
      const x = b.getChannelData(0);
      for (let i = 0; i < x.length; i++) x[i] = (Math.random() * 2 - 1) * (Math.random() < 0.2 ? 1 : 0.15);
      const src = c.createBufferSource();
      const f = c.createBiquadFilter();
      const e = c.createGain();
      src.buffer = b;
      f.type = "highpass";
      f.frequency.value = 1500;
      e.gain.value = v;
      src.connect(f);
      f.connect(e);
      e.connect(c.destination);
      src.start(t + at);
    };
    const effects: Record<GiftId, Record<"open" | "final", () => void>> = {
      jar: {
        open: () => {
          blip(500, 0, 0.12, 0.08, "triangle", 900);
          crunch(0.02, 0.12, 0.12);
        },
        final: () => [74, 78, 81, 86].forEach((m, k) => blip(hz(m), k * 0.1, 1.2, 0.07)),
      },
      daisy: {
        open: () => blip(900, 0, 0.3, 0.05, "sine", 500),
        final: () => [72, 76, 79, 84].forEach((m, k) => blip(hz(m), k * 0.12, 1, 0.06, "triangle")),
      },
      deck: {
        open: () => crunch(0, 0.08, 0.25),
        final: () => [62, 65, 69, 74].forEach((m, k) => blip(hz(m), k * 0.14, 1.6, 0.06)),
      },
      cookies: {
        open: () => {
          crunch(0, 0.18, 0.5);
          crunch(0.06, 0.12, 0.3);
        },
        final: () => [86, 88, 91, 93, 98].forEach((m, k) => blip(hz(m), k * 0.09, 2, 0.05)),
      },
    };
    effects[this.gift.id][kind]();
  }
}
