"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ParticleShape } from "../journeys/types";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  spin: number;
  colour: string;
  age: number;
  life: number;
}

const between = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * The particle simulation, outside React: a frame loop that runs ONLY while
 * particles exist, drawing in the keepsake frame's own coordinate space (not
 * the window's), so it is correct inside the Studio's Live tab.
 */
class ParticleSystem {
  private canvas: HTMLCanvasElement | null = null;
  private shape: ParticleShape | undefined;
  private colours: readonly string[] = [];
  private allowed = false;
  private particles: Particle[] = [];
  private frameId: number | null = null;
  private last = 0;
  private width = 0;
  private height = 0;

  configure(canvas: HTMLCanvasElement | null, shape: ParticleShape | undefined, colours: readonly string[], allowed: boolean) {
    this.canvas = canvas;
    this.shape = shape;
    this.colours = colours;
    this.allowed = allowed;
  }

  resize(width: number, height: number) {
    const canvas = this.canvas;
    if (!canvas) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    this.width = width;
    this.height = height;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.getContext("2d")?.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  size() {
    return { width: this.width, height: this.height };
  }

  clear() {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.particles = [];
    this.canvas?.getContext("2d")?.clearRect(0, 0, this.width, this.height);
  }

  burst(x: number, y: number, count: number) {
    if (!this.allowed || !this.shape || this.colours.length === 0) return;
    for (let i = 0; i < count; i++) {
      const angle = between(-Math.PI * 0.95, -Math.PI * 0.05);
      const speed = between(3, 9);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: between(5, 10),
        rotation: between(0, 6.3),
        spin: between(-0.2, 0.2),
        colour: this.colours[i % this.colours.length]!,
        age: 0,
        life: between(80, 130),
      });
    }
    if (this.frameId === null) {
      this.last = 0;
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number) => {
    const context = this.canvas?.getContext("2d");
    const shape = this.shape;
    if (!context || !shape) {
      this.frameId = null;
      return;
    }
    const step = Math.min(3, (now - (this.last || now)) / 16.67 || 1);
    this.last = now;
    context.clearRect(0, 0, this.width, this.height);
    const alive: Particle[] = [];
    for (const p of this.particles) {
      const age = p.age + step;
      const fade = 1 - age / p.life;
      if (fade <= 0) continue;
      const vy = p.vy * 0.985 + 0.14 * step;
      const next: Particle = {
        ...p,
        age,
        vx: p.vx * 0.985,
        vy,
        x: p.x + p.vx * 0.985 * step,
        y: p.y + vy * step,
        rotation: p.rotation + p.spin * step,
      };
      context.save();
      context.translate(next.x, next.y);
      context.rotate(next.rotation);
      context.globalAlpha = fade;
      context.fillStyle = next.colour;
      shape(context, next.size, next.colour, next.age);
      context.restore();
      alive.push(next);
    }
    this.particles = alive;
    if (alive.length > 0) {
      this.frameId = requestAnimationFrame(this.tick);
    } else {
      this.frameId = null;
      context.clearRect(0, 0, this.width, this.height);
    }
  };
}

/**
 * A small particle burst on a canvas that fills the keepsake's frame. The
 * journey supplies the SHAPE and the colours (little planes, stars, pixels);
 * everything else is shared.
 *
 * SCRIPTED MOTION, so it has its own reduced-motion check: the global CSS rule
 * shortens CSS animations and cannot stop script. `allowed` is false for a
 * visitor who prefers reduced motion AND while the preference is still
 * unknown, so an undecided visitor never gets a burst. When not allowed,
 * `burst` does nothing - the prototype fired a smaller burst anyway, which is
 * exactly what a reduced-motion preference is meant to prevent.
 */
export function useParticles(
  frame: HTMLElement | null,
  shape: ParticleShape | undefined,
  colours: readonly string[],
  allowed: boolean
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const system = useMemo(() => new ParticleSystem(), []);

  useEffect(() => {
    system.configure(canvasRef.current, shape, colours, allowed);
  }, [system, shape, colours, allowed]);

  useEffect(() => {
    if (!frame) return;
    const fit = () => {
      const { width, height } = frame.getBoundingClientRect();
      system.resize(width, height);
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [system, frame]);

  useEffect(() => () => system.clear(), [system]);

  /** Bursts from the centre of an element, converting to frame coordinates. */
  const burstAt = useCallback(
    (element: Element | null, count = 30) => {
      if (!element || !frame) return;
      const a = element.getBoundingClientRect();
      const f = frame.getBoundingClientRect();
      system.burst(a.left - f.left + a.width / 2, a.top - f.top + a.height / 2, count);
    },
    [system, frame]
  );

  /** Three bursts along the bottom edge: the "everyone cheers" moment. */
  const cheer = useCallback(() => {
    const { width, height } = system.size();
    [0.25, 0.5, 0.75].forEach((fraction, index) =>
      window.setTimeout(() => system.burst(width * fraction, height - 40, 34), index * 160)
    );
  }, [system]);

  const clear = useCallback(() => system.clear(), [system]);

  return { canvasRef, burstAt, cheer, clear };
}
