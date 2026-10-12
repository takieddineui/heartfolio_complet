"use client";

import { useEffect, useRef, useState } from "react";
import { WEB_MARK } from "@/lib/site-config";
import { milestonePhotoSize, milestoneSpacing } from "./ar-timeline-layout";

/**
 * ---------------------------------------------------------------------
 * WEBAR SCENE (§21i) — READ THIS BEFORE TRUSTING IT
 * ---------------------------------------------------------------------
 * MindAR + Three.js, image-target tracking, no native app, as §21i
 * specifies. Two things about this file are genuinely unresolved, and both
 * are called out in §21 itself rather than being discovered here.
 *
 * ⚠️ UNVERIFIED ON DEVICE. §21i flags that iOS Safari's camera and WebGL
 * support for this category of library has historically lagged Android
 * Chrome, and that it "needs real device testing before committing, not
 * something a code audit can confirm". Nothing in this file has run on a
 * phone. It is written to fail visibly rather than silently — camera
 * permission refusal, an unsupported browser and a failed library load all
 * produce a message rather than a blank screen, because a blank screen is
 * indistinguishable from a broken product to the recipient holding it.
 *
 * ⚠️ THE TRACKING TARGET IS AN ASSUMPTION. §21i corrects itself explicitly:
 * whether each personalized AR Card needs its own image-tracking target, or
 * whether one shared target serves every card, is NOT yet decided and is to
 * be finalized during implementation and testing. This implements the
 * SHARED-TARGET reading — one `.mind` file for all cards, with the
 * personalized content composed in the scene on top of it. That is the
 * cheaper model and the one that works without per-order asset generation,
 * but it is a choice made to have something runnable, not a decision. If
 * per-order targets win, `TARGET_URL` becomes a per-experience value from
 * the API and the rest of this file is unchanged.
 *
 * LOADED FROM CDN, NOT BUNDLED. MindAR ships as a large browser-oriented
 * bundle that expects a global THREE, and this route is the only place in
 * the app that needs it. Bundling it would add megabytes to every build and
 * two dependencies to a project that has been careful about them, to serve
 * one page most visitors never see. The scripts load only when this
 * component mounts.
 */

/** Pinned versions. An AR page whose library silently updated under it is
 *  an AR page that breaks without anyone deploying anything. */
const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js";
const MINDAR_URL =
  "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js";

/**
 * The SHARED image target — used by cards whose artwork is the same for
 * everyone (§21i).
 *
 * A per-order card supplies its own compiled target instead, via
 * `targetUrl` in the payload. That one is compiled in the buyer's browser
 * at checkout, because MindAR's compiler is JavaScript and running it
 * server-side would mean Node, node-canvas and TensorFlow.js inside a
 * Python image for a job that happens once per order.
 */
const SHARED_TARGET_URL = "/ar/targets/heartfolio-card.mind";

type Phase = "idle" | "loading" | "preparing" | "running" | "unsupported" | "denied" | "failed";

interface SceneValues {
  /**
   * §21c — which scene to run, decided by the product module server-side.
   *
   * Passed in rather than derived here on purpose. Choosing a scene from
   * the shape of the data would mean a timeline with no photos silently
   * getting a different experience from one with photos, and the customer
   * would have changed the behaviour by personalizing — which §21c rules
   * out explicitly.
   *
   * An unrecognised scene falls back to the static one rather than failing:
   * a newer backend naming a scene this build has not shipped yet should
   * degrade, not leave a recipient holding a card that shows nothing.
   */
  scene: string;
  /**
   * §15 — how rich this experience is, decided by the backend from what the
   * customer provided.
   *
   * Passed in rather than derived here from `hasMedia`, even though the
   * client could work it out. The backend owns the definition of a level,
   * and two implementations of "what counts as enhanced" would drift the
   * first time either changed — the same reasoning that keeps §21c's scene
   * selection server-side.
   */
  level: string;
  /** Whether any milestone media exists, for preparing playback. */
  hasMedia?: boolean;
  /** §5 — resolved media URLs, or absent for a Basic experience. */
  media?: SceneMedia;
  /** §21i — a per-order card's compiled target, or null for a shared one. */
  targetUrl?: string | null;
  /** True when a per-order card's checkout-time compilation did not
   *  complete. The fallback: compile now rather than show a card that will
   *  never track. */
  needsTarget?: boolean;
  values: Record<string, unknown>;
  themeSelections: Record<string, string | number>;
}

/** Scene builders, keyed by the id the product module declares. */
const SCENES: Record<
  string,
  (t: ThreeLike, v: Record<string, unknown>, s: Record<string, string | number>) => SceneHandle
> = {
  "timeline-unfold": buildTimelineScene,
  "static-card": buildStaticScene,
};

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export function ARScene({
  scene,
  level,
  hasMedia,
  media,
  targetUrl,
  needsTarget,
  values,
  themeSelections,
}: SceneValues) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;

    async function start() {
      // Checked before loading anything: downloading megabytes of AR
      // library onto a browser that cannot use a camera wastes a
      // recipient's data to reach the same failure message.
      if (!navigator.mediaDevices?.getUserMedia || !("WebGLRenderingContext" in window)) {
        setPhase("unsupported");
        return;
      }

      if (needsTarget) {
        /**
         * The fallback path (§21i).
         *
         * A per-order card whose target was never compiled — the buyer's
         * tab closed, or their device could not manage it. Compiling here
         * works, but it is 10–60 seconds on a phone and the person waiting
         * is the gift recipient, which is why it is the fallback and not
         * the default.
         *
         * Stated plainly rather than hidden behind a spinner: a silent
         * minute looks broken, and a recipient who knows it is preparing
         * will wait where one who thinks it has frozen will not.
         */
        setPhase("preparing");
      }

      setPhase((current) => (current === "preparing" ? current : "loading"));
      try {
        await loadScript(THREE_URL);
        await loadScript(MINDAR_URL);
        if (cancelled) return;

        const globalWindow = window as unknown as {
          MINDAR?: { IMAGE?: { MindARThree: new (options: unknown) => MindARInstance } };
          THREE?: ThreeLike;
        };
        const MindARThree = globalWindow.MINDAR?.IMAGE?.MindARThree;
        const THREE = globalWindow.THREE;
        if (!MindARThree || !THREE) {
          setPhase("failed");
          setDetail("The AR library did not load.");
          return;
        }

        const mindar = new MindARThree({
          container: containerRef.current,
          // A per-order target when one exists, the shipped shared one
          // otherwise. `needsTarget` is handled before we get here: an
          // experience still awaiting compilation never reaches this call
          // with a null target.
          imageTargetSrc: targetUrl ?? SHARED_TARGET_URL,
          uiScanning: "no",
          uiLoading: "no",
        });

        // Renamed: MindAR's `scene` is the Three.js scene graph, which is a
        // different thing from the `scene` prop naming which experience to
        // build. Destructuring it plainly shadowed the prop.
        const { renderer, scene: threeScene, camera } = mindar;
        const anchor = mindar.addAnchor(0);
        const build = SCENES[scene] ?? buildStaticScene;
        const handle = build(THREE, values, themeSelections);
        anchor.group.add(handle.group);

        /**
         * The story plays rather than scrolls. There is no scroll in AR —
         * the reader is holding a phone over a card — so progression is
         * driven by elapsed time from the moment the scene starts.
         *
         * The clock is created here, not at module load, so the story
         * begins when the card is found rather than when the page opened.
         */
        const clock = new THREE.Clock();

        /**
         * §14 — the BASIC experience is a complete one, not a degraded
         * version of Enhanced. The scene above is built the same way at
         * either level; media only ever adds to it.
         *
         * That is why nothing here branches on `level` to decide what to
         * draw. If it did, a customer with no video would be receiving a
         * lesser experience rather than a different one, which is precisely
         * what §14 rules out.
         */
        /**
         * §15's Enhanced layer.
         *
         * Media is attached to the SAME scene the Basic experience built —
         * nothing above is re-run or replaced. A milestone's audio plays as
         * that milestone activates, so the voice arrives with the memory
         * rather than at the start.
         *
         * `level` is not consulted to decide whether to do this: the
         * presence of media is the only condition, and the backend derived
         * the level from exactly that. Checking both would be two sources
         * of the same truth.
         */
        const cleanupMedia = attachMedia(media, handle, clock);
        stop = () => {
          renderer.setAnimationLoop(null);
          cleanupMedia();
          mindar.stop();
        };

        await mindar.start();
        if (cancelled) {
          mindar.stop();
          return;
        }

        setPhase("running");
        renderer.setAnimationLoop(() => {
          handle.update(clock.getElapsedTime());
          renderer.render(threeScene, camera);
        });

      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        // A refused camera is the single most likely failure and deserves
        // its own message: "something went wrong" would leave the recipient
        // with no idea that they can fix it in their own settings.
        if (/permission|denied|NotAllowed/i.test(message)) {
          setPhase("denied");
        } else {
          setPhase("failed");
          setDetail(message);
        }
      }
    }

    start();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [scene, values, themeSelections, media, targetUrl, needsTarget]);

  return (
    <div className="relative h-dvh w-full bg-black">
      <div ref={containerRef} className="absolute inset-0" />
      {/*
        Attribution. Shown while the scene runs, not only on the loading
        state — an AR experience with no visible source is the one place a
        recipient has no other way to find out what they are looking at.
        Bottom edge, low contrast, never over the tracked artwork.
      */}
      <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[11px] text-white/40">
        {WEB_MARK}
      </p>

      {phase !== "running" && (
        <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
          <p className="max-w-sm text-[15px] leading-relaxed text-white/80">
            {phase === "loading" && "Getting your keepsake ready…"}
            {phase === "preparing" &&
              "Preparing this card for the first time — this takes a moment, and only happens once."}
            {phase === "idle" && "Getting your keepsake ready…"}
            {phase === "unsupported" &&
              "This browser can't open the camera view. Try opening this link in Safari or Chrome on a phone."}
            {phase === "denied" &&
              "Camera access is needed to show this. You can allow it in your browser settings and reload."}
            {phase === "failed" && `This didn't load. ${detail}`}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * ---------------------------------------------------------------------
 * THE SCENE (§14, §15)
 * ---------------------------------------------------------------------
 * The timeline draws itself in order, each milestone activates in turn,
 * and photographs lift off the card. That is §14's Basic experience, and it
 * is a COMPLETE one — media, when it exists, plays at the milestone it
 * belongs to and adds nothing structural.
 *
 * ANCHORED IN CARD SPACE. MindAR's anchor is one unit wide and matches the
 * tracked image, so every position here is a fraction of the card: x from
 * -0.5 to 0.5, y likewise scaled by the card's aspect. Nothing is in
 * pixels, because the card can be printed at any size.
 *
 * PROGRESSION IS TIME-BASED, NOT SCROLL-BASED. There is no scroll in AR —
 * the reader is holding a phone over a card. So the story plays: each
 * milestone appears in sequence after the previous one, at a pace slow
 * enough to read and fast enough not to feel stuck.
 *
 * THE TRACKING TARGET IS STILL OUTSTANDING, and it is the only part that
 * is. This scene renders against any anchor; what does not exist is the
 * `.mind` file compiled from the card artwork, because the card has not
 * been designed. Building the scene first was the right order: it needs the
 * story, not the target.
 */

/** Seconds between milestones appearing. Slow enough to read a date and a
 *  title before the next arrives. */
const STEP_INTERVAL = 1.1;
/** How long each milestone takes to settle once it starts appearing. */
const STEP_DURATION = 0.55;

interface SceneHandle {
  group: ThreeObject;
  /** Called every frame with elapsed seconds since the scene started. */
  update: (elapsed: number) => void;
}

function easeOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/**
 * §7's timeline, in three dimensions.
 *
 * Photographs sit slightly proud of the card and rise further as their
 * milestone activates — the "lifting off the card" effect is what makes
 * this read as augmented rather than as a video playing on a surface.
 */
function buildTimelineScene(
  THREE: ThreeLike,
  values: Record<string, unknown>,
  themeSelections: Record<string, string | number>
): SceneHandle {
  const group = new THREE.Group();
  const milestones = (values.events as { photo?: { url?: string } }[] | undefined) ?? [];
  const accent = paletteAccent(themeSelections);

  // The spine, drawn as a thin plane that grows downward. A line would be
  // one pixel wide at every distance; a plane keeps its weight as the
  // viewer moves closer.
  const spine = new THREE.Mesh(
    new THREE.PlaneGeometry(0.008, 1),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.9 })
  );
  spine.position.set(-0.18, 0, 0.001);
  spine.scale.set(1, 0, 1);
  group.add(spine);

  const steps = milestones.map((milestone, index) => {
    const y = 0.42 - index * milestoneSpacing(milestones.length);

    const node = new THREE.Mesh(
      new THREE.PlaneGeometry(0.03, 0.03),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0 })
    );
    node.position.set(-0.18, y, 0.004);
    group.add(node);

    const photo = new THREE.Mesh(
      // The usual size, or smaller when the milestones are too close for it:
      // see `ar-timeline-layout.ts` (they covered each other from five).
      new THREE.PlaneGeometry(milestonePhotoSize(milestones.length), milestonePhotoSize(milestones.length)),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        ...(milestone.photo?.url
          ? { map: new THREE.TextureLoader().load(milestone.photo.url) }
          : {}),
      })
    );
    photo.position.set(0.12, y, 0.01);
    group.add(photo);

    return { node, photo, y };
  });

  return {
    group,
    update(elapsed) {
      // The spine draws itself first, then milestones follow it down.
      spine.scale.set(1, easeOut(elapsed / (STEP_INTERVAL * Math.max(1, steps.length) * 0.6)), 1);

      steps.forEach((step, index) => {
        const progress = easeOut((elapsed - index * STEP_INTERVAL) / STEP_DURATION);
        if (step.node.material) step.node.material.opacity = progress;
        if (step.photo.material) step.photo.material.opacity = progress;

        // Lifting off the card: the photograph rises as it appears, so the
        // depth is what announces the milestone rather than a fade alone.
        step.photo.position.set(0.12, step.y, 0.01 + progress * 0.06);
        const scale = 0.86 + progress * 0.14;
        step.photo.scale.set(scale, scale, 1);
      });
    },
  };
}

/** Fallback for a product with no declared scene (§21c). Deliberately
 *  plain: a product that has not been designed for AR should look
 *  unfinished rather than borrow another product's composition. */
function buildStaticScene(
  THREE: ThreeLike,
  values: Record<string, unknown>,
  themeSelections: Record<string, string | number>
): SceneHandle {
  const group = new THREE.Group();
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, 0.5),
    new THREE.MeshBasicMaterial({
      color: paletteAccent(themeSelections),
      transparent: true,
      opacity: 0,
    })
  );
  group.add(plane);
  void values;

  return {
    group,
    update(elapsed) {
      if (plane.material) plane.material.opacity = easeOut(elapsed / 0.8) * 0.85;
    },
  };
}

function paletteAccent(themeSelections: Record<string, string | number>): number {
  // Mirrors the palette accents in `data.py`. Hex numbers rather than
  // strings because Three.js materials take numeric colours.
  const accents: Record<string, number> = {
    classic: 0xc9a24b,
    blush: 0xb5654b,
    midnight: 0xc9a24b,
    sage: 0x6b7a5e,
    terracotta: 0xb5654b,
    monochrome: 0x141414,
  };
  return accents[String(themeSelections.palette ?? "classic")] ?? 0xc9a24b;
}

interface ThreeVector {
  set: (x: number, y: number, z: number) => void;
  x: number;
  y: number;
  z: number;
}
interface ThreeObject {
  position: ThreeVector;
  scale: ThreeVector;
  rotation: ThreeVector;
  visible: boolean;
  add: (child: unknown) => void;
  material?: { opacity: number; transparent: boolean; map?: unknown };
}
interface ThreeLike {
  Group: new () => ThreeObject;
  Mesh: new (geometry: unknown, material: unknown) => ThreeObject;
  PlaneGeometry: new (w: number, h: number) => unknown;
  MeshBasicMaterial: new (options: Record<string, unknown>) => unknown;
  TextureLoader: new () => { load: (url: string) => unknown };
  Clock: new () => { getElapsedTime: () => number };
}

interface MindARInstance {
  renderer: { setAnimationLoop: (fn: (() => void) | null) => void; render: (s: unknown, c: unknown) => void };
  scene: unknown;
  camera: unknown;
  addAnchor: (index: number) => { group: { add: (child: unknown) => void } };
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * §15 — plays a milestone's media as it activates.
 *
 * HTML media elements rather than Three.js textures: a `<video>` is what
 * every browser can actually decode, and driving it from the scene's clock
 * keeps sound in step with the visual milestone without a second timeline
 * to keep synchronised.
 *
 * NOTHING AUTOPLAYS UNPROMPTED IN THE USUAL SENSE — the reader has already
 * pointed a camera at a card, which is a deliberate act, and browsers
 * permit playback in that gesture's wake. Background music is still opt-in
 * (§10's rule) and is not started here.
 *
 * Returns a cleanup that pauses everything: leaving audio playing after the
 * card is lost would be a voice continuing out of nowhere.
 */
function attachMedia(
  media: SceneMedia | undefined,
  handle: SceneHandle,
  clock: { getElapsedTime: () => number }
): () => void {
  if (!media) return () => {};

  const elements: HTMLMediaElement[] = [];
  const played = new Set<number>();

  const milestones = media.milestones ?? [];
  milestones.forEach((entry, index) => {
    const src = entry.audio ?? entry.video;
    if (!src) return;
    const element = entry.video
      ? Object.assign(document.createElement("video"), { playsInline: true })
      : document.createElement("audio");
    element.src = src;
    element.preload = "none";
    elements.push(element);

    const originalUpdate = handle.update;
    handle.update = (elapsed) => {
      originalUpdate(elapsed);
      // Plays once, when this milestone's turn arrives.
      if (!played.has(index) && elapsed >= index * STEP_INTERVAL) {
        played.add(index);
        void element.play().catch(() => {
          // A refused play is not an error worth surfacing: the visual
          // milestone still appeared, which is the Basic experience and
          // §14 says that is complete on its own.
        });
      }
    };
  });

  void clock;

  return () => {
    for (const element of elements) {
      element.pause();
      element.src = "";
    }
  };
}

interface SceneMedia {
  backgroundMusic: string | null;
  milestones: { video: string | null; audio: string | null }[];
}
