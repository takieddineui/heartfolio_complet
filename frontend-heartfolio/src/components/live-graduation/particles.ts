import type { JourneyId } from "@/lib/studio/product-modules/graduation-keepsake/journeys";

/**
 * The bursts of confetti (paper planes, stars, pixels, gold leaf, petals):
 * the prototype's `FX`, one shape and palette per journey.
 *
 * Two deliberate changes from the prototype, the same two Reasons I Love You
 * made to its sparkles:
 *  1. THE CANVAS BELONGS TO THE KEEPSAKE'S OWN FRAME, never the window: the
 *     prototype's `position: fixed` full-window canvas would have covered the
 *     whole Studio from inside its preview pane. Bursts are placed relative to
 *     the frame.
 *  2. NOTHING UNDER REDUCED MOTION. The prototype still fired ten particles.
 *     This is script, so the caller gates every burst on its own
 *     `useReducedMotion() === false` (a CSS rule cannot stop script).
 */
const PALETTES: Record<JourneyId, string[]> = {
  airline: ["#ff6b4a", "#ffb547", "#2f7fd8", "#ffffff"],
  space: ["#ff8a3d", "#7cf3ff", "#ffffff", "#ffe14d"],
  arcade: ["#ff4fd8", "#3df5ff", "#ffe14d", "#7cff6b"],
  museum: ["#c9a24d", "#f2d98f", "#fbf8f1"],
  summit: ["#e2553b", "#f2b56b", "#ffffff", "#6d84a3"],
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  s: number;
  rot: number;
  vr: number;
  c: string;
  age: number;
  life: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Confetti {
  private ctx: CanvasRenderingContext2D | null = null;
  private particles: Particle[] = [];
  private running = false;
  private last = 0;
  private width = 0;
  private height = 0;
  private request = 0;
  private observer: ResizeObserver | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly frame: HTMLElement,
    private readonly journey: JourneyId
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

  /** From the centre of `element`, measured against the frame. */
  burstAt(element: Element | null, count = 30) {
    if (!element) return;
    const frame = this.frame.getBoundingClientRect();
    const r = element.getBoundingClientRect();
    this.burst(r.left - frame.left + r.width / 2, r.top - frame.top + r.height / 2, count);
  }

  /** Three bursts along the bottom of the frame: the finale's cheer. */
  cheer() {
    [0.25, 0.5, 0.75].forEach((x, k) => window.setTimeout(() => this.burst(this.width * x, this.height - 40, 34), k * 160));
  }

  private burst(x: number, y: number, count: number) {
    if (!this.ctx) return;
    const colours = PALETTES[this.journey];
    for (let i = 0; i < count; i++) {
      const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);
      const sp = rand(3, 9);
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: rand(5, 10), rot: rand(0, 6.3), vr: rand(-0.2, 0.2), c: colours[i % colours.length]!, age: 0, life: rand(80, 130) });
    }
    if (!this.running) {
      this.running = true;
      this.last = 0;
      this.request = requestAnimationFrame((now) => this.step(now));
    }
  }

  private shape(ctx: CanvasRenderingContext2D, p: Particle) {
    const s = p.s;
    if (this.journey === "airline" && p.c !== "#ffffff") {
      ctx.beginPath();
      ctx.moveTo(s, 0);
      ctx.lineTo(-s, -s * 0.55);
      ctx.lineTo(-s * 0.45, 0);
      ctx.lineTo(-s, s * 0.55);
      ctx.closePath();
      ctx.fill();
    } else if (this.journey === "space") {
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.quadraticCurveTo(0, 0, s, 0);
      ctx.quadraticCurveTo(0, 0, 0, s);
      ctx.quadraticCurveTo(0, 0, -s, 0);
      ctx.quadraticCurveTo(0, 0, 0, -s);
      ctx.fill();
    } else if (this.journey === "arcade") {
      ctx.rotate(-p.rot);
      const q = Math.round(s / 3) * 3;
      ctx.fillRect(-q / 2, -q / 2, q, q);
    } else if (this.journey === "summit") {
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.4, s, 0, 0, 6.29);
      ctx.fill();
    } else {
      ctx.scale(Math.cos(p.age * 0.08), 1);
      ctx.fillRect(-s / 2, -s / 4, s, s / 2);
    }
  }

  private step(now: number) {
    const ctx = this.ctx;
    if (!this.running || !ctx) return;
    this.request = requestAnimationFrame((next) => this.step(next));
    const f = Math.min(3, (now - (this.last || now)) / 16.67 || 1);
    this.last = now;
    ctx.clearRect(0, 0, this.width, this.height);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.age += f;
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + 0.14 * f;
      p.x += p.vx * f;
      p.y += p.vy * f;
      p.rot += p.vr * f;
      const alpha = 1 - p.age / p.life;
      if (alpha <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.c;
      this.shape(ctx, p);
      ctx.restore();
    }
    if (!this.particles.length) {
      this.running = false;
      cancelAnimationFrame(this.request);
      ctx.clearRect(0, 0, this.width, this.height);
    }
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.request);
    this.observer?.disconnect();
    this.particles = [];
  }
}
