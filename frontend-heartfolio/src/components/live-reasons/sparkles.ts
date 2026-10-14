import type { GiftId } from "@/lib/studio/product-modules/reasons-i-love-you/gifts";

/**
 * The little burst of sparks and hearts when a reason opens (the prototype's
 * `FX`). Two deliberate changes from the prototype:
 *
 *  1. THE CANVAS BELONGS TO THE EXPERIENCE'S OWN FRAME, NOT THE WINDOW. The
 *     prototype drew on a `position: fixed` canvas sized to `innerWidth`; inside
 *     the Studio's preview pane that would have covered the whole Studio. Here
 *     the canvas is sized to the frame and bursts are placed relative to it.
 *  2. IT DOES NOTHING UNDER REDUCED MOTION. The prototype still fired 8
 *     particles; this is a scripted effect, so the caller passes `enabled` from
 *     its own reduced-motion check (the global CSS rule cannot stop script).
 */
const COLOURS: Record<GiftId, string[]> = {
  jar: ["#ffd25e", "#ffb36b", "#fff3c9"],
  daisy: ["#fffef5", "#f2b705", "#ffffff"],
  deck: ["#c8102e", "#f3ecd8", "#e0a93a"],
  cookies: ["#b8322a", "#e0a93a", "#fffdf8"],
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  c: string;
  age: number;
  life: number;
  heart: boolean;
}

export class Sparkles {
  private ctx: CanvasRenderingContext2D | null = null;
  private particles: Particle[] = [];
  private running = false;
  private last = 0;
  private width = 0;
  private height = 0;
  private frameRequest = 0;
  private observer: ResizeObserver | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly frame: HTMLElement
  ) {
    try {
      this.ctx = canvas.getContext("2d");
    } catch {
      this.ctx = null;
    }
    this.size();
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.size());
      this.observer.observe(frame);
    }
  }

  private size() {
    if (!this.ctx) return;
    const rect = this.frame.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Bursts from the centre of `element`, measured against the frame. */
  burstAt(element: Element | null, gift: GiftId, count: number) {
    if (!element || !this.ctx) return;
    const frame = this.frame.getBoundingClientRect();
    const r = element.getBoundingClientRect();
    this.burst(r.left - frame.left + r.width / 2, r.top - frame.top + r.height / 2, gift, count);
  }

  private burst(x: number, y: number, gift: GiftId, count: number) {
    const colours = COLOURS[gift];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.28;
      const s = 1.5 + Math.random() * 5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 1.5,
        r: 2 + Math.random() * 4,
        c: colours[i % colours.length]!,
        age: 0,
        life: 50 + Math.random() * 50,
        heart: gift !== "cookies" && Math.random() < 0.35,
      });
    }
    if (!this.running) {
      this.running = true;
      this.last = 0;
      this.frameRequest = requestAnimationFrame((now) => this.frameStep(now));
    }
  }

  private frameStep(now: number) {
    const ctx = this.ctx;
    if (!this.running || !ctx) return;
    this.frameRequest = requestAnimationFrame((next) => this.frameStep(next));
    const f = Math.min(3, (now - (this.last || now)) / 16.7 || 1);
    this.last = now;
    ctx.clearRect(0, 0, this.width, this.height);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.age += f;
      p.vx *= 0.97;
      p.vy = p.vy * 0.97 + 0.08 * f;
      p.x += p.vx * f;
      p.y += p.vy * f;
      const alpha = 1 - p.age / p.life;
      if (alpha <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.c;
      if (p.heart) {
        ctx.font = `${p.r * 4}px serif`;
        ctx.fillText("♥", p.x, p.y);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.29);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (!this.particles.length) {
      this.running = false;
      cancelAnimationFrame(this.frameRequest);
      ctx.clearRect(0, 0, this.width, this.height);
    }
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.frameRequest);
    this.observer?.disconnect();
    this.particles = [];
  }
}
