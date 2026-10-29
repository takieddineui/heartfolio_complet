"use client";

import { useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import {
  arcadeScore,
  flightOf,
  formatDate,
  formatNumber,
  graphemes,
  localeOf,
  personColour,
  ridgeAltitudes,
  SUMMIT_METRES,
  trailAltitudes,
  translatorFor,
  type ExperiencePerson,
  type GraduationExperienceData,
  type Media,
} from "./experience-data";
import { Confetti } from "./particles";
import { cx, Icon, Jet, Photo, Plane, Rocket, ROMAN, STAMP_INKS, STAMP_TILTS, SummitFinale, SummitPeaks, tilt, TROPHIES } from "./scenes";
import { JourneySounds, type SoundKind } from "./sfx";
import { LiveColophon } from "@/components/live/live-colophon";

/**
 * GRADUATION KEEPSAKE: one graduation story told as one of five journeys.
 *
 * The prototype (`graduation.html`) is the design reference and this is its
 * port: the same five openings, chapters, interactions, finales and sound
 * kits. What changed, and why:
 *
 *  - EVERYTHING STAYS INSIDE ITS OWN FRAME. The prototype set its journey on
 *    <html>, locked <body> scrolling, set the theme colour, and fixed eight
 *    layers to the window (start screen, controls, altimeter, sheets,
 *    lightbox, toast, banner, confetti). In the Studio's preview pane those
 *    would have restyled and covered the whole Studio. Here the page scrolls
 *    inside the frame's own scroller and every overlay is positioned against
 *    the frame.
 *  - THE PLANE AND THE ALTIMETER FOLLOW THE SCROLL through one passive,
 *    frame-throttled listener on the frame's OWN scroller (never the window):
 *    the first scroll listener on a live page, documented in CLAUDE.md with
 *    why it is the right tool here and how it is kept cheap.
 *  - REMOVED, ON PURPOSE (v1 scope): the graduate's reply and reactions, the
 *    event tracking, the on-page journey switcher and `?journey=`, the
 *    placeholder photo art, the branding switch (always shown, like every
 *    live page), and setting the browser's theme colour.
 *  - THE PROTOTYPE'S BUGS ARE FIXED (see `experience-data.ts` and the CSS for
 *    the layout ones): voice playback follows the recording to its end
 *    (it stopped at 10 seconds), captions show on every journey, the path's
 *    labels count correctly on space, arcade and summit, the airline uses the
 *    creator's own codes, the score uses the graduation year, no control is
 *    nested inside another, typing stops when its sheet closes, and reduced
 *    motion fires no confetti at all.
 *  - REDUCED MOTION is checked here (`useReducedMotion() === false`): no
 *    confetti, text appears whole instead of typed, and every scripted
 *    animation runs in a millisecond.
 */
export interface GraduationKeepsakeProps {
  data: GraduationExperienceData;
  locale: string;
  /** "viewport" on the live page, "container" inside the Studio's pane. */
  fill?: "viewport" | "container";
  /** What the share button shares. `null` in the Studio: shown, inert. */
  shareUrl?: string | null;
  /** A photo, drawing or voice message failed to load: on the live page its
   * five-minute link may have expired, and the page fetches fresh ones. */
  onMediaError?: () => void;
}

type Screen = "start" | "page";
type Finale = "idle" | "busy" | "done";
type VoiceState = { id: string; playing: boolean; progress: number } | null;

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
/** Back to the top at once (`scrollTo` with "instant": a plain `scrollTop = 0`
 * would follow the scroller's smooth-scrolling CSS). */
const toTop = (element: HTMLElement | null) => {
  if (!element) return;
  if (typeof element.scrollTo === "function") element.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  else element.scrollTop = 0;
};
/** `element.animate`, or nothing where the Web Animations API is missing (an
 * old browser, a test's DOM): the step is skipped, never a crash. */
const animateEl = (element: Element | null | undefined, frames: Keyframe[], options: KeyframeAnimationOptions) =>
  element && typeof element.animate === "function" ? element.animate(frames, options) : null;
const finished = (animation: Animation | null | undefined) => (animation ? animation.finished.then(() => undefined, () => undefined) : Promise.resolve());

export function GraduationKeepsake({ data, locale, fill = "viewport", shareUrl = null, onMediaError }: GraduationKeepsakeProps) {
  const j = data.journey;
  const t = useMemo(() => translatorFor(locale), [locale]);
  const W = useCallback((key: string, params?: Record<string, string | number>) => t(`words.${j}.${key}`, params), [t, j]);
  const code = localeOf(locale);
  const dir = code === "ar" ? "rtl" : "ltr";
  const fmt = useCallback((n: number) => formatNumber(n, locale), [locale]);
  const motionAllowed = useReducedMotion() === false;
  const reduce = !motionAllowed;
  const ms = useCallback((full: number) => (reduce ? 1 : full), [reduce]);

  const [screen, setScreen] = useState<Screen>("start");
  const [startGone, setStartGone] = useState(false);
  const [countText, setCountText] = useState("");
  const [muted, setMuted] = useState(false);
  const soundOn = data.sound && !muted;
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(() => new Set());
  const [turned, setTurned] = useState<ReadonlySet<string>>(() => new Set());
  const [decoded, setDecoded] = useState<Readonly<Record<string, string>>>({});
  const [decodedDone, setDecodedDone] = useState<ReadonlySet<string>>(() => new Set());
  const [sheet, setSheet] = useState<{ g: number; i: number } | null>(null);
  const [sheetText, setSheetText] = useState("");
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [finale, setFinale] = useState<Finale>("idle");
  const [score, setScore] = useState<number | null>(null);
  const [summitFlag, setSummitFlag] = useState(false);
  const [flame, setFlame] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [unlock, setUnlock] = useState<{ title: string; i: number } | null>(null);
  const [voice, setVoice] = useState<VoiceState>(null);

  const frameRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startRef = useRef<HTMLElement>(null);
  const pathRef = useRef<HTMLDivElement>(null);
  const moverRef = useRef<HTMLSpanElement>(null);
  const altRef = useRef<HTMLDivElement>(null);
  const stubRef = useRef<HTMLSpanElement>(null);
  const passMainRef = useRef<HTMLSpanElement>(null);
  const pressRef = useRef<HTMLButtonElement>(null);
  const bowRef = useRef<HTMLDivElement>(null);
  const ribLRef = useRef<HTMLDivElement>(null);
  const ribRRef = useRef<HTMLDivElement>(null);
  const peaksRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);
  const achCountRef = useRef<HTMLParagraphElement>(null);
  const jetRef = useRef<SVGGElement>(null);
  const rocketRef = useRef<SVGSVGElement>(null);
  const sunRef = useRef<HTMLDivElement>(null);
  const curtainLRef = useRef<HTMLDivElement>(null);
  const curtainRRef = useRef<HTMLDivElement>(null);
  const holdFillRef = useRef<HTMLElement>(null);
  const sheetCloseRef = useRef<HTMLButtonElement>(null);
  const lightboxCloseRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const sounds = useRef<JourneySounds | null>(null);
  const confetti = useRef<Confetti | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const alive = useRef(true);
  /** Bumped by "start again" and on unmount: every running sequence (typing,
   * the opening, a finale) checks it and stops. */
  const generation = useRef(0);
  const starting = useRef(false);
  /** The open message sheet's typing; bumped when the sheet closes or another
   * opens, so only the sheet on screen ever types. */
  const sheetToken = useRef(0);
  /** The voice playing now, read by handlers without a stale closure. */
  const voiceRef = useRef<VoiceState>(null);
  const holdState = useRef<{ raf: number; t0: number; done: boolean } | null>(null);

  const play = useCallback(
    (kind: SoundKind) => {
      if (!soundOn) return;
      if (!sounds.current) sounds.current = new JourneySounds(j);
      sounds.current.play(kind);
    },
    [soundOn, j]
  );
  const burst = useCallback((element: Element | null, count = 30) => {
    if (motionAllowed) confetti.current?.burstAt(element, count);
  }, [motionAllowed]);

  useEffect(() => {
    alive.current = true;
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (canvas && frame) confetti.current = new Confetti(canvas, frame, j);
    return () => {
      alive.current = false;
      generation.current += 1;
      confetti.current?.dispose();
      confetti.current = null;
      sounds.current?.dispose();
      sounds.current = null;
      if (audio.current) {
        audio.current.pause();
        audio.current.removeAttribute("src");
        audio.current = null;
      }
      if (holdState.current) cancelAnimationFrame(holdState.current.raf);
      sheetToken.current += 1;
    };
  }, [j]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => alive.current && setToast(null), 2600);
  }, []);

  /* ── voice messages ────────────────────────────────────────────────
     One audio element for the whole keepsake. Playback runs to the end of the
     RECORDING (`ended`); the prototype stopped every message at its stored
     `durationSec`, or at 10 seconds when there was none, so a real minute-long
     message was cut off. */
  const setVoiceState = useCallback((next: VoiceState | ((current: VoiceState) => VoiceState)) => {
    setVoice((current) => {
      const value = typeof next === "function" ? next(current) : next;
      voiceRef.current = value;
      return value;
    });
  }, []);

  const stopVoice = useCallback(() => {
    audio.current?.pause();
    setVoiceState(null);
  }, [setVoiceState]);

  const playVoice = useCallback(
    (id: string, url: string, restart = false) => {
      if (!audio.current) {
        const element = new Audio();
        element.preload = "none";
        element.addEventListener("timeupdate", () => {
          const progress = element.duration ? element.currentTime / element.duration : 0;
          setVoiceState((current) => (current ? { ...current, progress } : current));
        });
        element.addEventListener("ended", () => setVoiceState(null));
        element.addEventListener("error", () => {
          setVoiceState(null);
          onMediaError?.();
        });
        audio.current = element;
      }
      const element = audio.current;
      const current = voiceRef.current;
      if (!restart && current?.id === id && current.playing) {
        element.pause();
        setVoiceState({ ...current, playing: false });
        return;
      }
      if (restart || current?.id !== id) {
        element.src = url;
      }
      // Called inside the tap that asked for it (the museum's audio guide
      // included), so iOS Safari, which only plays media started by a tap,
      // allows it.
      void element.play().catch(() => setVoiceState(null));
      setVoiceState({ id, playing: true, progress: !restart && current?.id === id ? current.progress : 0 });
    },
    [onMediaError, setVoiceState]
  );

  /* ── the opening ─────────────────────────────────────────────────── */
  const begin = useCallback(async () => {
    if (starting.current || screen !== "start") return;
    starting.current = true;
    const gen = generation.current;
    play("start");
    if (j === "airline") {
      await finished(animateEl(stubRef.current, 
        [{ transform: "none" }, { transform: "rotate(4deg) translateY(6px)", offset: 0.3 }, { transform: "rotate(24deg) translate(30px, 120cqh)" }],
        { duration: ms(1100), easing: "cubic-bezier(.5,0,.8,.4)", fill: "forwards" }
      ));
      animateEl(passMainRef.current, [{ opacity: 1 }, { opacity: 0, transform: "translateY(-30px)" }], { duration: ms(500), fill: "forwards" });
    } else if (j === "space") {
      for (const n of [3, 2, 1]) {
        if (gen !== generation.current) return;
        setCountText(fmt(n));
        await wait(reduce ? 50 : 1000);
      }
      setCountText(t("journeys.space.liftoff"));
      await wait(reduce ? 50 : 700);
    } else if (j === "arcade") {
      const press = pressRef.current;
      if (press) press.style.animation = "none";
      for (let k = 0; k < 6; k++) {
        if (press) press.style.visibility = k % 2 ? "visible" : "hidden";
        await wait(reduce ? 0 : 90);
      }
      await wait(reduce ? 0 : 300);
    } else if (j === "museum") {
      animateEl(bowRef.current, [{ opacity: 1 }, { opacity: 0, transform: "translateY(60px) scale(.5)" }], { duration: ms(500), fill: "forwards" });
      animateEl(ribLRef.current, [{ transform: "none" }, { transform: "rotate(70deg)" }], { duration: ms(900), easing: "cubic-bezier(.5,0,.5,1.3)", fill: "forwards" });
      await finished(animateEl(ribRRef.current, [{ transform: "none" }, { transform: "rotate(-70deg)" }], { duration: ms(900), easing: "cubic-bezier(.5,0,.5,1.3)", fill: "forwards" }));
      burst(startRef.current?.querySelector(`.${cx("ribbonWrap")}`) ?? null, 30);
      await wait(reduce ? 0 : 500);
    } else {
      await finished(animateEl(peaksRef.current, [{ transform: "none" }, { transform: "translateY(30%) scale(1.3)" }], { duration: ms(1500), easing: "ease-in", fill: "forwards" }));
    }
    if (gen !== generation.current || !alive.current) return;
    setScreen("page");
    toTop(scrollerRef.current);
    if (j === "airline") {
      play("win");
      animateEl(shadeRef.current, [{ transform: "none" }, { transform: "translateY(-100%)" }], { duration: ms(1400), delay: reduce ? 0 : 500, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
    }
    await finished(animateEl(startRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: ms(700), fill: "forwards" }));
    if (gen !== generation.current || !alive.current) return;
    setStartGone(true);
    starting.current = false;
  }, [screen, play, j, ms, reduce, fmt, t, burst]);

  /* ── the plane down the path and the summit's altimeter ──────────────
     ONE passive listener on the keepsake's OWN scroller, never the window,
     and at most one update per frame: the handler only schedules, and the
     frame does the measuring. The live page's other rule (an observer, never
     a scroll listener) cannot serve a value that changes with every pixel of
     scrolling, which is exactly what a live altimeter is. Under reduced
     motion the plane stays put and the altimeter still reads correctly. */
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || screen !== "page") return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const box = pathRef.current;
      const mover = moverRef.current;
      if (box && mover && motionAllowed) {
        const s = scroller.getBoundingClientRect();
        const r = box.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, (s.height * 0.55 - (r.top - s.top)) / Math.max(1, r.height)));
        mover.style.transform = `translateY(${(p * Math.max(0, r.height - 34)).toFixed(1)}px)`;
      }
      const alt = altRef.current;
      if (alt) {
        const range = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
        const p = Math.min(1, Math.max(0, scroller.scrollTop / range));
        alt.textContent = t("journeys.summit.altitude", { n: fmt(Math.round(p * SUMMIT_METRES)) });
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [screen, motionAllowed, t, fmt]);

  /* ── achievements ────────────────────────────────────────────────── */
  const achievements = data.achievements ?? [];
  const revealedCount = [...revealed].filter((i) => i < achievements.length).length;
  const reveal = (i: number, button: HTMLElement) => {
    if (revealed.has(i)) return;
    // Functional: two tiles tapped before a re-render must both count.
    let complete = false;
    setRevealed((current) => {
      const next = new Set(current).add(i);
      complete = [...next].filter((k) => k < achievements.length).length === achievements.length;
      return next;
    });
    play("ach");
    if (j === "arcade") {
      setUnlock({ title: achievements[i]!.title, i });
      window.setTimeout(() => alive.current && setUnlock((u) => (u?.i === i ? null : u)), 2200);
    }
    animateEl(button, [{ transform: "scale(1)" }, { transform: "scale(.94)" }, { transform: "scale(1)" }], { duration: ms(260) });
    window.setTimeout(() => complete && burst(achCountRef.current, 36), 300);
  };

  /* ── messages ────────────────────────────────────────────────────── */
  const typeInto = useCallback(
    async (full: string, write: (text: string) => void, tick: boolean, isCurrent: () => boolean) => {
      if (reduce) {
        write(full);
        return true;
      }
      const parts = graphemes(full);
      let shown = "";
      for (let k = 0; k < parts.length; k++) {
        if (!isCurrent() || !alive.current) return false;
        shown += parts[k];
        write(shown);
        if (tick && k % 3 === 0) play("tick");
        await wait(parts[k] === " " ? 18 : 26);
      }
      return true;
    },
    [reduce, play]
  );

  const turn = async (key: string, card: HTMLElement, voiceId: string | null) => {
    if (card.dataset.busy) return;
    card.dataset.busy = "1";
    play("msg");
    await finished(animateEl(card, [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: ms(170), easing: "ease-in" }));
    setTurned((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    // Turning a card back over silences its voice message.
    if (voiceId && turned.has(key) && voiceRef.current?.id === voiceId) stopVoice();
    await finished(animateEl(card, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: ms(210), easing: "ease-out" }));
    delete card.dataset.busy;
  };

  const decode = async (key: string, person: ExperiencePerson) => {
    if (key in decoded) return;
    const gen = generation.current;
    play("msg");
    setDecoded((d) => ({ ...d, [key]: t("journeys.space.decoding") }));
    await wait(reduce ? 0 : 800);
    if (!alive.current || gen !== generation.current) return;
    const complete = await typeInto(
      `${person.message}\n— ${person.name}`,
      (text) => setDecoded((d) => ({ ...d, [key]: text })),
      true,
      () => gen === generation.current
    );
    if (complete) setDecodedDone((done) => new Set(done).add(key));
  };

  const openMessage = (g: number, i: number, person: ExperiencePerson, trigger: HTMLElement) => {
    stopVoice();
    play("msg");
    returnFocus.current = trigger;
    const mine = ++sheetToken.current; // any earlier sheet stops typing
    setSheet({ g, i });
    if (j === "arcade") {
      setSheetText("");
      void typeInto(person.message, setSheetText, true, () => mine === sheetToken.current);
    } else setSheetText(person.message);
    // The museum's audio guide starts by itself: right here, inside the tap.
    if (j === "museum" && person.voice) playVoice(`${g}-${i}`, person.voice.url, true);
  };

  const closeSheet = () => {
    sheetToken.current += 1; // the typing stops with the sheet (the prototype kept ticking)
    stopVoice();
    setSheet(null);
    returnFocus.current?.focus();
  };

  useEffect(() => {
    if (sheet) sheetCloseRef.current?.focus();
  }, [sheet]);
  useEffect(() => {
    if (lightbox !== null) lightboxCloseRef.current?.focus();
  }, [lightbox]);

  /* ── finales ─────────────────────────────────────────────────────── */
  const runFinale = async () => {
    if (finale !== "idle") return;
    setFinale("busy");
    const gen = generation.current;
    if (j === "airline") {
      play("finale");
      await finished(animateEl(jetRef.current, 
        [{ transform: "translate(40px,150px)" }, { transform: "translate(260px,150px)", offset: 0.45 }, { transform: "translate(420px,90px) rotate(-12deg)", offset: 0.75 }, { transform: "translate(640px,-80px) rotate(-18deg)" }],
        { duration: ms(2600), easing: "cubic-bezier(.5,0,.6,1)", fill: "forwards" }
      ));
    } else if (j === "space") {
      play("finale");
      setFlame(true);
      const height = frameRef.current?.clientHeight ?? 800;
      await finished(animateEl(rocketRef.current, 
        [{ transform: "translateY(0)" }, { transform: "translateY(6px)", offset: 0.1 }, { transform: "translateY(0)", offset: 0.2 }, { transform: `translateY(-${Math.round(height * 1.3)}px)` }],
        { duration: ms(2400), easing: "cubic-bezier(.6,0,.9,.6)", fill: "forwards" }
      ));
    } else if (j === "arcade") {
      const total = arcadeScore(data);
      const duration = ms(1800);
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        const step = () => {
          if (!alive.current || gen !== generation.current) return resolve();
          const p = Math.min(1, (performance.now() - t0) / duration);
          setScore(Math.round(total * p));
          if (Math.random() < 0.5) play("coin");
          if (p < 1) requestAnimationFrame(step);
          else resolve();
        };
        step();
      });
    } else if (j === "museum") {
      play("finale");
      animateEl(curtainLRef.current, [{ transform: "none" }, { transform: "translateX(-100%)" }], { duration: ms(1600), easing: "cubic-bezier(.6,0,.3,1)", fill: "forwards" });
      await finished(animateEl(curtainRRef.current, [{ transform: "none" }, { transform: "translateX(100%)" }], { duration: ms(1600), easing: "cubic-bezier(.6,0,.3,1)", fill: "forwards" }));
    } else {
      play("finale");
      await finished(animateEl(sunRef.current, [{ transform: "translateY(160px)" }, { transform: "translateY(-60px)" }], { duration: ms(2400), easing: "cubic-bezier(.3,0,.2,1)", fill: "forwards" }));
      setSummitFlag(true);
    }
    if (gen !== generation.current || !alive.current) return;
    setFinale("done");
    play("win");
    if (motionAllowed) confetti.current?.cheer();
  };

  /* Space: press and hold to launch. The pointer is captured, so sliding off
     the button or lifting the finger anywhere cancels; Enter or Space launches
     straight away for anyone using a keyboard. */
  const holdStart = (event: PointerEvent<HTMLButtonElement>) => {
    if (finale !== "idle") return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* a pointer that cannot be captured still holds; release still cancels */
    }
    const duration = reduce ? 200 : 1600;
    const state = { raf: 0, t0: performance.now(), done: false };
    holdState.current = state;
    let lastTick = -1;
    const step = () => {
      const p = Math.min(1, (performance.now() - state.t0) / duration);
      if (holdFillRef.current) holdFillRef.current.style.width = `${p * 100}%`;
      const tenth = Math.floor(p * 10);
      if (tenth !== lastTick) {
        lastTick = tenth;
        play("tick");
      }
      if (p >= 1) {
        state.done = true;
        holdState.current = null;
        void runFinale();
        return;
      }
      state.raf = requestAnimationFrame(step);
    };
    step();
  };
  const holdEnd = () => {
    const state = holdState.current;
    if (!state || state.done) return;
    cancelAnimationFrame(state.raf);
    holdState.current = null;
    const fillEl = holdFillRef.current;
    if (fillEl) {
      const from = fillEl.style.width || "0%";
      void finished(animateEl(fillEl, [{ width: from }, { width: "0%" }], { duration: ms(250) })).then(() => {
        if (fillEl) fillEl.style.width = "0%";
      });
    }
  };
  const holdKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void runFinale();
    }
  };

  /* ── start again, share, sound ───────────────────────────────────── */
  const again = () => {
    generation.current += 1;
    starting.current = false;
    stopVoice();
    setScreen("start");
    setStartGone(false);
    setCountText("");
    setRevealed(new Set());
    setTurned(new Set());
    setDecoded({});
    setDecodedDone(new Set());
    sheetToken.current += 1;
    setSheet(null);
    setLightbox(null);
    setFinale("idle");
    setScore(null);
    setSummitFlag(false);
    setFlame(false);
    setUnlock(null);
    toTop(scrollerRef.current);
  };

  const share = async () => {
    if (!shareUrl) return; // the Studio: no link exists before purchase
    const payload = { title: `${data.grad.fullName} · ${data.grad.year}`, text: data.ending.sub, url: shareUrl };
    if (navigator.share) {
      try {
        await navigator.share(payload);
        return;
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast(t("ui.copied"));
    } catch {
      showToast(t("ui.copyFailed"));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (lightbox !== null) {
        setLightbox(null);
        returnFocus.current?.focus();
      } else if (sheet) closeSheet();
    }
    if (lightbox !== null && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      const forward = (event.key === "ArrowRight") !== (dir === "rtl");
      const n = data.path?.stops.length ?? 1;
      setLightbox((i) => (i === null ? i : (i + (forward ? 1 : -1) + n) % n));
    }
  };

  /* ── what is drawn ───────────────────────────────────────────────── */
  const g = data.grad;
  const flight = flightOf(data, t);
  const photoError = () => onMediaError?.();
  const sectionHeading = (id: string, title: string) => ({ id: `gk-${id}`, "aria-label": title });

  const startScreen = () => {
    const welcome = (name: string) => W("welcome", { name });
    if (j === "airline") {
      return (
        <div className={cx("startBody")}>
          <div className={cx("gateTop")}>
            <b>{welcome(g.name)}</b>
            <span>{flight.airline} · {g.school}</span>
          </div>
          <button type="button" className={cx("pass")} onClick={() => void begin()} aria-label={W("start")}>
            <span ref={passMainRef} className={cx("passMain")}>
              <span className={cx("airlineRow")}><span>{flight.airline}</span><Plane /></span>
              <span className={cx("route")}>
                <span><span className={cx("code")}>{flight.fromCode}</span><span className={cx("city")}>{flight.fromCity}</span></span>
                <span className={cx("arrow")}><Plane /></span>
                <span className={cx("to")}><span className={cx("code")}>{flight.toCode}</span><span className={cx("city")}>{flight.toCity}</span></span>
              </span>
              <span className={cx("g3")}>
                <span className={cx("w")}><small>{t("journeys.airline.passenger")}</small><b>{g.fullName.toLocaleUpperCase(code)}</b></span>
                <span><small>{t("journeys.airline.flight")}</small><b>{flight.number}</b></span>
                <span><small>{t("journeys.airline.seat")}</small><b>{flight.seat}</b></span>
                <span><small>{t("journeys.airline.boarding")}</small><b>{formatDate(g.date, locale)}</b></span>
                <span className={cx("w")}><small>{t("journeys.airline.cabin")}</small><b>{flight.cabin}</b></span>
                <span className={cx("w")}><small>{t("journeys.airline.gate")}</small><b>{g.school}</b></span>
              </span>
            </span>
            <span ref={stubRef} className={cx("passStub")}>
              <span className={cx("barcode")} style={{ display: "block" }} />
              <span className={cx("tear")} style={{ display: "block" }}>{W("start")}</span>
            </span>
          </button>
        </div>
      );
    }
    if (j === "space") {
      return (
        <div className={cx("startBody")}>
          <div className={cx("patch")} aria-hidden="true">🚀</div>
          <h1>{welcome(g.fullName)}</h1>
          <p className={cx("sub")}>{g.school} · {g.year}</p>
          <div className={cx("count", countText.length > 2 && "countWord")} aria-live="assertive">{countText}</div>
          {!countText && <button type="button" className={cx("stBtn")} onClick={() => void begin()}>{W("start")}</button>}
        </div>
      );
    }
    if (j === "arcade") {
      return (
        <div className={cx("startBody")}>
          <p className={cx("logo")}>{t("journeys.arcade.logo")}</p>
          <p className={cx("player")}>{welcome(g.name.toLocaleUpperCase(code))} · {g.year}</p>
          <button ref={pressRef} type="button" className={cx("press")} onClick={() => void begin()}>{W("start")}</button>
          <p className={cx("coins")}>{t("journeys.arcade.credit")} · {g.school}</p>
        </div>
      );
    }
    if (j === "museum") {
      return (
        <div className={cx("startBody")}>
          <p className={cx("placard")}>
            <small>{t("journeys.museum.nowOpen", { school: g.school })}</small>
            {welcome(g.fullName)}
          </p>
          <div className={cx("ribbonWrap")} aria-hidden="true">
            <div className={cx("posts")}><i /><i /></div>
            <div ref={ribLRef} className={cx("rib", "ribL")} />
            <div ref={ribRRef} className={cx("rib", "ribR")} />
            <div ref={bowRef} className={cx("bow")} />
          </div>
          <button type="button" className={cx("stBtn")} onClick={() => void begin()}>{W("start")}</button>
        </div>
      );
    }
    return (
      <>
        <div ref={peaksRef} className={cx("peaks")} aria-hidden="true"><SummitPeaks /></div>
        <div className={cx("startBody")}>
          <div className={cx("sign")}>
            {g.fullName}
            <small>{t("journeys.summit.sign", { degree: g.degree, year: g.year })}</small>
          </div>
          <button type="button" className={cx("stBtn")} onClick={() => void begin()}>🥾 {W("start")}</button>
        </div>
      </>
    );
  };

  const hero = () => {
    const photo = <Photo media={g.photo} alt={g.fullName} eager onError={photoError} />;
    return (
      <header className={cx("hero")}>
        {j === "airline" ? (
          <div className={cx("hframe", "rv")} style={{ "--d": ".1s" } as CSSProperties}>
            <div className={cx("glass")}>
              {photo}
              <div ref={shadeRef} className={cx("shade")} />
            </div>
          </div>
        ) : (
          <div className={cx("hframe", "rv")} style={{ "--d": ".1s" } as CSSProperties}>{photo}</div>
        )}
        {j === "museum" ? (
          <div className={cx("wallLabel", "rv")} style={{ "--d": ".5s" } as CSSProperties}>
            <b>{g.fullName}</b>
            <span>{g.degree}</span>
            <span>{g.school}, {g.year}</span>
            {data.path?.then.year && <span><i>{t("journeys.museum.medium", { from: data.path.then.year, to: g.year })}</i></span>}
          </div>
        ) : (
          <>
            <h1 className={cx("rv")} style={{ "--d": ".4s" } as CSSProperties}>{W("welcome", { name: g.name })}</h1>
            <p className={cx("deg", "rv")} style={{ "--d": ".55s" } as CSSProperties}>{g.degree} · {g.school}</p>
            <p className={cx("meta", "rv")} style={{ "--d": ".65s" } as CSSProperties}>{formatDate(g.date, locale)}</p>
          </>
        )}
        {j === "airline" && <p className={cx("tagpill", "rv")} style={{ "--d": ".8s" } as CSSProperties}>🔔 {flight.seat} · {flight.cabin}</p>}
        {j === "space" && <p className={cx("tagpill", "rv")} style={{ "--d": ".8s" } as CSSProperties}>{t("journeys.space.status", { year: g.year })}</p>}
        {j === "arcade" && (
          <div className={cx("stats", "rv")} style={{ "--d": ".8s" } as CSSProperties}>
            <span>{t("journeys.arcade.level")}</span><span>{g.year}</span>
            <span>{t("journeys.arcade.xp")}</span><span><i className={cx("bar")} /> {t("journeys.arcade.max")}</span>
            <span>{t("journeys.arcade.class")}</span><span>{g.degree}</span>
          </div>
        )}
      </header>
    );
  };

  const pathChapter = () => {
    const P = data.path;
    if (!P) return null;
    const n = P.stops.length;
    const alts = trailAltitudes(n);
    const metres = (value: number) => t("journeys.summit.metres", { n: fmt(value) });
    const stage = (value: number) => <bdi dir="ltr">{`${fmt(value)}-${fmt(1)}`}</bdi>;
    const tags = {
      then: { airline: flight.fromCode, space: "T-0", arcade: W("then"), museum: "", summit: metres(alts.then) }[j],
      now: { airline: "GRD", space: t("journeys.space.stage", { n: fmt(n + 1) }), arcade: stage(n + 2), museum: "", summit: metres(alts.now) }[j],
      next: { airline: flight.toCode, space: t("journeys.space.nextTag"), arcade: W("next"), museum: "", summit: W("next") }[j],
    };
    const stopTag = (stop: (typeof P.stops)[number], i: number) =>
      ({ airline: stop.code, space: t("journeys.space.stage", { n: fmt(i + 1) }), arcade: stage(i + 2), museum: "", summit: metres(alts.stops[i] ?? 0) })[j];
    const mover = { airline: <Plane />, space: "🛰️", arcade: "🕹️", museum: null, summit: "🥾" }[j];
    const big = (kind: "then" | "now" | "next", year: string, text: string, photo: Media, extra?: string) => (
      <div className={cx("stop", extra)}>
        <p className={cx("tag")}><b>{tags[kind]}</b>{year}</p>
        <div className={cx("big", "card")}>
          <Photo media={photo} alt="" onError={photoError} />
          <div className={cx("tx")}>
            <span className={cx("lbl")}>{W(kind)}</span>
            <p className={cx("ut")}>{text}</p>
          </div>
        </div>
        <div className={cx("wl")}><b>{W(kind)}</b>{year}<br /><i className={cx("ut")}>{text}</i></div>
      </div>
    );
    return (
      <section className={cx("ch")} {...sectionHeading("path", W("path"))}>
        <div className={cx("wrap")}>
          <h2 className={cx("h2")}>{W("path")}</h2>
          <div ref={pathRef} className={cx("path")}>
            <span className={cx("pathLine")} />
            {mover && <span ref={moverRef} className={cx("mover")} aria-hidden="true">{mover}</span>}
            {big("then", P.then.year, P.then.text, P.then.photo)}
            {P.stops.map((stop, i) => (
              <div key={i} className={cx("stop")}>
                <p className={cx("tag")}><b>{stopTag(stop, i)}</b>{stop.year}</p>
                <button
                  type="button"
                  className={cx("mini", "card")}
                  aria-label={t("ui.openPhoto", { caption: `${stop.year} · ${stop.caption}` })}
                  onClick={(event) => {
                    returnFocus.current = event.currentTarget;
                    setLightbox(i);
                  }}
                >
                  <Photo media={stop.photo} alt="" onError={photoError} />
                  <span><b className={cx("ut")}>{stop.caption}</b><small>{stop.year}</small></span>
                </button>
                <div className={cx("wl")}><b className={cx("ut")}>{stop.caption}</b>{stop.year}<br /><i>{t("journeys.museum.exhibit", { n: fmt(i + 1) })}</i></div>
              </div>
            ))}
            {big("now", P.now.year, P.now.text, g.photo, "now")}
            {big("next", "", P.next.text, P.next.photo)}
          </div>
        </div>
      </section>
    );
  };

  const achievementsChapter = () => {
    if (!data.achievements) return null;
    const ridges = ridgeAltitudes(achievements.length);
    const label = (i: number) =>
      ({
        airline: fmt(i + 1),
        space: "◌",
        arcade: "🔒",
        museum: code === "ar" ? fmt(i + 1) : ROMAN[i] ?? fmt(i + 1),
        summit: t("journeys.summit.metres", { n: fmt(ridges[i] ?? 0) }),
      })[j];
    const inner = (a: (typeof achievements)[number], i: number) => {
      const title = <b className={cx("ut")}>{a.title}</b>;
      const detail = a.detail && <em className={cx("ut")}>{a.detail}</em>;
      if (j === "airline") return <>{a.place && <small>{a.place}</small>}{title}{detail}<small>{g.year}</small></>;
      if (j === "space") return <>{title}{detail}</>;
      if (j === "summit") return <><span className={cx("flag")} />{title}{detail}</>;
      return <><span className={cx("tro")}>{TROPHIES[i % 10]}</span>{title}{detail}</>;
    };
    return (
      <section className={cx("ch")} {...sectionHeading("achievements", W("ach"))}>
        <div className={cx("wrap")}>
          <h2 className={cx("h2")}>{W("ach")}</h2>
          <p className={cx("hint")}>{W("achHint")}</p>
          <div className={cx("achs")}>
            {achievements.map((a, i) => {
              const on = revealed.has(i);
              return (
                <button
                  key={i}
                  type="button"
                  className={cx("ach", on && "achOn")}
                  style={tilt(STAMP_TILTS[i % STAMP_TILTS.length]!, STAMP_INKS[i % STAMP_INKS.length]!)}
                  aria-pressed={on}
                  aria-label={on ? undefined : `${W("ach")} ${fmt(i + 1)}`}
                  onClick={(event) => reveal(i, event.currentTarget)}
                >
                  <span className={cx("q")} aria-hidden={on}>{label(i)}</span>
                  <span className={cx("rv2")} aria-hidden={!on}>{inner(a, i)}</span>
                </button>
              );
            })}
          </div>
          <p ref={achCountRef} className={cx("countLine")} aria-live="polite">{W("achCount", { n: fmt(revealedCount), t: fmt(achievements.length) })}</p>
        </div>
      </section>
    );
  };

  const voiceRow = (id: string, person: ExperiencePerson, colour: string) => {
    if (!person.voice) return null;
    const current = voice?.id === id;
    const playing = current && voice.playing;
    return (
      <div className={cx("voice")} style={{ "--pc": colour } as CSSProperties}>
        <button
          type="button"
          className={cx("vb")}
          aria-label={`${playing ? t("ui.voicePause") : t("ui.voicePlay")}: ${person.name}`}
          aria-pressed={playing}
          onClick={() => playVoice(id, person.voice!.url)}
        >
          <Icon name={playing ? "pause" : "play"} />
        </button>
        <div className={cx("vmeta")}>
          <span className={cx("vprog")} style={{ "--p": `${Math.round((current ? voice.progress : 0) * 100)}%` } as CSSProperties}><i /></span>
          {person.voiceCaption && <span className={cx("vcap", "ut")}>“{person.voiceCaption}”</span>}
        </div>
      </div>
    );
  };

  const messagesChapter = () => {
    if (!data.messages) return null;
    let position = 0;
    return (
      <section className={cx("ch")} {...sectionHeading("messages", W("msg"))}>
        <div className={cx("wrap")}>
          <h2 className={cx("h2")}>{W("msg")}</h2>
          <p className={cx("hint")}>{W("msgHint")}</p>
          {data.messages.map((group, gi) => (
            <div key={gi} className={cx("mgroup")}>
              <h3 className={cx("ut")}>{group.label}</h3>
              <div className={cx(j === "summit" ? "stones" : "mlist")}>
                {group.people.map((person, i) => {
                  const index = position++;
                  const colour = personColour(person, index);
                  const key = `${gi}-${i}`;
                  const style = { "--pc": colour } as CSSProperties;
                  if (j === "airline") {
                    const on = turned.has(key);
                    return (
                      <div key={key} className={cx("item")}>
                        <button
                          type="button"
                          className={cx("pc", on && "pcOn")}
                          style={style}
                          aria-pressed={on}
                          aria-label={on ? undefined : `${t("journeys.airline.greetings")} ${person.name}`}
                          onClick={(event) => void turn(key, event.currentTarget, person.voice ? key : null)}
                        >
                          <span className={cx("pcFace", "pcFront", person.drawing && "pcDrawn")}>
                            {person.drawing && <Photo media={person.drawing} alt="" onError={photoError} />}
                            <span className={cx("gr")}><small>{t("journeys.airline.greetings")}</small>{person.name}</span>
                          </span>
                          <span className={cx("pcFace", "pcBack")}>
                            <span className={cx("msgt", "ut")}>{person.message}<b>{person.name}</b></span>
                            <span className={cx("stp")} aria-hidden="true">{person.emoji || "✉️"}</span>
                          </span>
                        </button>
                        {on && voiceRow(key, person, colour)}
                      </div>
                    );
                  }
                  if (j === "space") {
                    const text = decoded[key];
                    return (
                      <div key={key} className={cx("item")}>
                        <button
                          type="button"
                          className={cx("txCard", text !== undefined && "txOn")}
                          aria-label={text === undefined ? `${t("journeys.space.decode")}: ${person.name}` : undefined}
                          onClick={() => void decode(key, person)}
                        >
                          <span className={cx("hd")}><span>◉ {person.name.toLocaleUpperCase(code)}</span><span aria-hidden="true">{person.emoji}</span></span>
                          <span className={cx("wave")} aria-hidden="true" />
                          <span className={cx("txBody", "ut")} aria-live="polite">{text ?? `${t("journeys.space.decode")} ${dir === "rtl" ? "◂" : "▸"}`}</span>
                        </button>
                        {decodedDone.has(key) && voiceRow(key, person, "#ff8a3d")}
                      </div>
                    );
                  }
                  return (
                    <button
                      key={key}
                      type="button"
                      className={cx("who", "card")}
                      style={style}
                      aria-haspopup="dialog"
                      aria-label={t("ui.readMessage", { name: person.name })}
                      onClick={(event) => openMessage(gi, i, person, event.currentTarget)}
                    >
                      <span className={cx("av")} aria-hidden="true">{j === "museum" ? fmt(index + 1) : person.emoji || "🙂"}</span>
                      <span>
                        <b>{j === "arcade" ? person.name.toLocaleUpperCase(code) : person.name}</b>
                        <small>{j === "arcade" ? t("journeys.arcade.talk") : j === "museum" ? `🎧 ${t("journeys.museum.listen")}` : "✉"}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  };

  const goalsChapter = () =>
    data.goals && (
      <section className={cx("ch")} {...sectionHeading("goals", W("goals"))}>
        <div className={cx("wrap")}>
          <h2 className={cx("h2")}>{W("goals")}</h2>
          <ul className={cx("goals", "card")}>
            {data.goals.map((goal, i) => (
              <li key={i}>
                <span className={cx("c")}>{j === "arcade" ? <bdi dir="ltr">Q{fmt(i + 1)}</bdi> : goal.code}</span>
                <span className={cx("ut")}>{goal.text}</span>
                <span className={cx("s")}>{W("goalTag")}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    );

  const letterChapter = () => {
    const L = data.letter;
    if (!L) return null;
    return (
      <section className={cx("ch")} {...sectionHeading("letter", W("letter"))}>
        <div className={cx("wrap")}>
          <h2 className={cx("h2")}>{W("letter")}</h2>
          <div className={cx("letter", "card")}>
            <p className={cx("g", "ut")}>{L.greeting}</p>
            {L.paragraphs.map((p, i) => <p key={i} className={cx("ut")}>{p}</p>)}
            {L.signoff && <p className={cx("so", "ut")}>{L.signoff}</p>}
            <div className={cx("sigs")}>{L.signatures.map((s, i) => <span key={i}>{s}</span>)}</div>
          </div>
        </div>
      </section>
    );
  };

  const finaleSection = () => {
    const done = finale === "done";
    const scene = {
      airline: <><Jet jetRef={jetRef} /><button type="button" className={cx("finAct")} disabled={finale !== "idle"} onClick={() => void runFinale()}>✈ {W("finale")}</button></>,
      space: (
        <>
          <Rocket rocketRef={rocketRef} flame={flame} />
          <button type="button" className={cx("finAct")} disabled={finale !== "idle"} onPointerDown={holdStart} onPointerUp={holdEnd} onPointerCancel={holdEnd} onLostPointerCapture={holdEnd} onKeyDown={holdKey} onContextMenu={(e) => e.preventDefault()}>
            <i ref={holdFillRef} className={cx("holdFill")} />
            <span>{W("finale")}</span>
          </button>
        </>
      ),
      arcade: (
        <>
          {score !== null && <div className={cx("tally")}><small>{t("journeys.arcade.score")}</small><bdi>{fmt(score)}</bdi></div>}
          <button type="button" className={cx("finAct")} disabled={finale !== "idle"} onClick={() => void runFinale()}>{W("finale")}</button>
        </>
      ),
      museum: <><div ref={curtainLRef} className={cx("curtain", "curtainL")} /><div ref={curtainRRef} className={cx("curtain", "curtainR")} /><button type="button" className={cx("finAct")} disabled={finale !== "idle"} onClick={() => void runFinale()}>{W("finale")}</button></>,
      summit: <><SummitFinale sunRef={sunRef} flag={summitFlag} /><button type="button" className={cx("finAct")} disabled={finale !== "idle"} onClick={() => void runFinale()}>⛰ {W("finale")}</button></>,
    }[j];
    return (
      <section className={cx("finale", `f${j[0]!.toUpperCase()}${j.slice(1)}`, done && "finDone")} aria-label={W("finale")}>
        {scene}
        <div className={cx("finMsg")} aria-hidden={!done}>
          <h2 className={cx(j !== "arcade" && "ut")}>{j === "arcade" ? t("journeys.arcade.levelComplete") : data.ending.line}</h2>
          {(j === "arcade" ? data.ending.line : data.ending.sub) && <p className={cx("ut")}>{j === "arcade" ? data.ending.line : data.ending.sub}</p>}
          <div className={cx("actions")}>
            {data.share && (
              <button type="button" className={cx("btn", "btnGhost")} onClick={() => void share()} tabIndex={done ? 0 : -1}>
                <Icon name="share" /> {t("ui.share")}
              </button>
            )}
            <button type="button" className={cx("btn", "btnGhost")} onClick={again} tabIndex={done ? 0 : -1}>
              <Icon name="replay" /> {j === "arcade" ? t("journeys.arcade.newGame") : t("ui.again")}
            </button>
          </div>
          <LiveColophon locale={locale} className={cx("brand")} tabIndex={done ? 0 : -1} />
        </div>
      </section>
    );
  };

  const sheetPerson = sheet ? data.messages?.[sheet.g]?.people[sheet.i] : undefined;
  const sheetIndex = sheet && data.messages ? data.messages.slice(0, sheet.g).reduce((sum, group) => sum + group.people.length, 0) + sheet.i : 0;
  const stops = data.path?.stops ?? [];
  const lbStop = lightbox !== null ? stops[lightbox] : undefined;

  return (
    <div
      ref={frameRef}
      className={cx("frame")}
      data-j={j}
      data-screen={screen}
      data-fill={fill}
      dir={dir}
      lang={code}
      onKeyDown={onKeyDown}
    >
      <div ref={scrollerRef} className={cx("scroller")} aria-hidden={screen === "start"}>
        <main>
          {hero()}
          {pathChapter()}
          {achievementsChapter()}
          {messagesChapter()}
          {goalsChapter()}
          {letterChapter()}
          {finaleSection()}
        </main>
      </div>

      {screen === "page" && (
        <div className={cx("ctl")}>
          {data.sound && (
            <button type="button" className={cx("ib")} aria-pressed={!muted} aria-label={muted ? t("ui.soundOff") : t("ui.soundOn")} onClick={() => setMuted((m) => !m)}>
              <Icon name={muted ? "off" : "on"} />
            </button>
          )}
          {data.share && (
            <button type="button" className={cx("ib")} aria-label={t("ui.share")} onClick={() => void share()}>
              <Icon name="share" />
            </button>
          )}
        </div>
      )}
      {j === "summit" && <div ref={altRef} className={cx("alt")} aria-hidden="true">{t("journeys.summit.altitude", { n: fmt(0) })}</div>}

      <canvas ref={canvasRef} className={cx("fx")} aria-hidden="true" />

      {!startGone && (
        <section ref={startRef} className={cx("start", `s${j[0]!.toUpperCase()}${j.slice(1)}`)} aria-label={W("start")}>
          {startScreen()}
          {data.sound && (
            <div className={cx("startFoot")}>
              <button type="button" className={cx("chip")} aria-pressed={!muted} onClick={() => setMuted((m) => !m)}>
                <Icon name={muted ? "off" : "on"} /> {muted ? t("ui.soundOff") : t("ui.soundOn")}
              </button>
            </div>
          )}
        </section>
      )}

      {sheet && sheetPerson && (
        <div className={cx("sheetBg")} onClick={(event) => event.target === event.currentTarget && closeSheet()}>
          <div className={cx("sheet")} role="dialog" aria-modal="true" aria-label={t("ui.readMessage", { name: sheetPerson.name })} style={{ "--pc": personColour(sheetPerson, sheetIndex) } as CSSProperties}>
            <button ref={sheetCloseRef} type="button" className={cx("sheetX")} aria-label={t("ui.close")} onClick={closeSheet}>
              <Icon name="close" />
            </button>
            <div className={cx("mHead")}>
              <span className={cx("av")} aria-hidden="true">{j === "museum" ? "🎧" : sheetPerson.emoji || "🙂"}</span>
              <b>{j === "arcade" ? sheetPerson.name.toLocaleUpperCase(code) : sheetPerson.name}</b>
            </div>
            <p className={cx("mText", "ut")}>{sheetText}</p>
            {sheetPerson.drawing && (
              <div className={cx("mDraw")}><Photo media={sheetPerson.drawing} alt="" onError={photoError} /></div>
            )}
            {voiceRow(`${sheet.g}-${sheet.i}`, sheetPerson, personColour(sheetPerson, sheetIndex))}
          </div>
        </div>
      )}

      {lightbox !== null && lbStop && (
        <div className={cx("lb")} role="dialog" aria-modal="true" aria-label={`${lbStop.year} · ${lbStop.caption}`}>
          <button ref={lightboxCloseRef} type="button" className={cx("ib", "lbX")} aria-label={t("ui.close")} onClick={() => { setLightbox(null); returnFocus.current?.focus(); }}>
            <Icon name="close" />
          </button>
          {stops.length > 1 && (
            <button type="button" className={cx("lbNav", "lbPrev")} aria-label={t("ui.prevPhoto")} onClick={() => setLightbox((i) => (i === null ? i : (i - 1 + stops.length) % stops.length))}>
              <Icon name="left" />
            </button>
          )}
          <figure>
            <Photo media={lbStop.photo} alt={lbStop.caption} eager onError={photoError} />
            <figcaption>{lbStop.year} · {lbStop.caption}</figcaption>
          </figure>
          {stops.length > 1 && (
            <button type="button" className={cx("lbNav", "lbNext")} aria-label={t("ui.nextPhoto")} onClick={() => setLightbox((i) => (i === null ? i : (i + 1) % stops.length))}>
              <Icon name="right" />
            </button>
          )}
        </div>
      )}

      <div className={cx("toast", toast && "toastShow")} role="status" aria-live="polite">{toast}</div>
      {j === "arcade" && <div className={cx("unlock", unlock && "unlockShow")} aria-live="polite">
        {unlock && (
          <>
            <span style={{ fontSize: "1.8rem" }} aria-hidden="true">{TROPHIES[unlock.i % 10]}</span>
            <span><b>{t("journeys.arcade.unlocked")}</b>{unlock.title}</span>
          </>
        )}
      </div>}
    </div>
  );
}
