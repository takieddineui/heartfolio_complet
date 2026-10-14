"use client";

import { useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { GIFTS } from "@/lib/studio/product-modules/reasons-i-love-you/gifts";
import {
  formatCount,
  localeOf,
  resolveSignature,
  resolveTitle,
  translatorFor,
  type ExperienceReason,
  type ReasonsExperienceData,
} from "./experience-data";
import { FINAL_FRAMES, NOTE_COLOURS, OPEN_FRAMES, RANKS, SCENES, animate, finished, takeAnimation } from "./gift-scenes";
import { ProceduralMusic } from "./procedural-music";
import { Sparkles } from "./sparkles";
import styles from "./reasons-keepsake.module.css";

/**
 * REASONS I LOVE YOU: the gift, opened one reason at a time.
 *
 * The prototype (`reasons-i-love-you.html`) is the design reference and this
 * is its port: the same four gifts, the same reveal, the same finale with the
 * signature writing itself, the same letter, and each gift's own procedural
 * instrument. What changed, and why:
 *
 *  - EVERYTHING STAYS INSIDE ITS OWN FRAME. The prototype's reveal card,
 *    sparkle canvas and toast were `position: fixed` to the window, which in the
 *    Studio's preview pane would have covered the whole Studio. Here the frame
 *    is the positioning box for all three, and the reasons scroll inside it.
 *    On the live page the frame is the viewport's height; in the Studio it is
 *    the pane's (`fill`).
 *  - REMOVED, ON PURPOSE (v1 scope): the recipient's reply, the on-page gift
 *    switcher and `?gift=` override (the sender chooses in the Studio), the
 *    localStorage event tracking, the own-song upload, the placeholder photo
 *    art and the branding switch (the line is always shown, exactly as Love
 *    Story Timeline's and Song Poster's live pages show it).
 *  - REDUCED MOTION gates the scripted effects with its own check
 *    (`useReducedMotion() === false`): no sparkle bursts at all (the prototype
 *    still fired some), and every Web Animations duration collapses to 1ms.
 *  - PHOTOS are only in the page while their reason is open, load lazily and
 *    decode off the main thread, and sit in a box with fixed proportions so
 *    nothing jumps (see `ReasonPhoto`).
 */
export interface ReasonsKeepsakeProps {
  data: ReasonsExperienceData;
  locale: string;
  /** "viewport" on the live page, "container" inside the Studio's pane. */
  fill?: "viewport" | "container";
  /** The link the share button shares. `null` in the Studio, where there is
   * no link yet: the button is shown, but does nothing. */
  shareUrl?: string | null;
  /** Called when a reason's photo fails to load: on the live page its link
   * may simply have expired (they last five minutes), and the page fetches
   * fresh ones. */
  onPhotoError?: (index: number) => void;
}

type Reveal = { kind: "reason"; index: number } | { kind: "final" } | null;

export function ReasonsKeepsake({ data, locale, fill = "viewport", shareUrl = null, onPhotoError }: ReasonsKeepsakeProps) {
  const t = useMemo(() => translatorFor(locale), [locale]);
  const motionAllowed = useReducedMotion() === false;
  const reduce = !motionAllowed;
  const gift = GIFTS[data.gift];
  const Scene = SCENES[data.gift];
  const count = data.reasons.length;

  const [opened, setOpened] = useState<ReadonlySet<number>>(() => new Set());
  const [finaleSeen, setFinaleSeen] = useState(false);
  const [afterOpen, setAfterOpen] = useState(false);
  const [reveal, setReveal] = useState<Reveal>(null);
  // The reader can mute; the sender's "Play music" switch decides whether
  // there is any music at all. Derived, so a change in the Studio applies at once.
  const [muted, setMuted] = useState(false);
  const sound = data.music && !muted;
  const [round, setRound] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const frameRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const giftRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const afterRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparkles = useRef<Sparkles | null>(null);
  const music = useRef<ProceduralMusic | null>(null);
  const busy = useRef(false);
  const closingFinal = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);

  // Reasons can be removed while the Studio preview is open; an index beyond
  // the list is not "opened".
  const openedCount = [...opened].filter((index) => index < count).length;
  const goldReady = count > 0 && openedCount === count && !finaleSeen;

  const getMusic = useCallback(() => {
    if (!music.current) music.current = new ProceduralMusic(gift);
    return music.current;
  }, [gift]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (canvas && frame && typeof window !== "undefined") sparkles.current = new Sparkles(canvas, frame);
    return () => {
      sparkles.current?.dispose();
      sparkles.current = null;
    };
  }, []);

  // Leaving the page or the Studio's preview closes the audio, not just mutes it.
  useEffect(
    () => () => {
      music.current?.dispose();
      music.current = null;
    },
    []
  );

  // The sender switching music off in the Studio stops it here too.
  useEffect(() => {
    if (!data.music) music.current?.stop();
  }, [data.music]);

  const burst = useCallback(
    (element: Element | null, particles: number) => {
      if (motionAllowed) sparkles.current?.burstAt(element, data.gift, particles);
    },
    [motionAllowed, data.gift]
  );

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2400);
  }, []);

  const startMusic = useCallback(() => {
    if (sound) void getMusic().start();
  }, [sound, getMusic]);

  const openCard = useCallback(
    async (next: Exclude<Reveal, null>) => {
      returnFocus.current = (document.activeElement as HTMLElement | null) ?? null;
      setReveal(next);
      // Wait for React to mount the card, then let it arrive.
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      const card = cardRef.current;
      card?.focus({ preventScroll: true });
      await finished(
        animate(card, next.kind === "final" ? FINAL_FRAMES : OPEN_FRAMES[data.gift], {
          duration: reduce ? 1 : 520,
          easing: "cubic-bezier(.3,.8,.3,1)",
        })
      );
    },
    [data.gift, reduce]
  );

  const special = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    startMusic();
    if (sound) getMusic().sfx("final");
    const element = giftRef.current?.querySelector('[data-part="special"]') ?? null;
    await finished(
      animate(element, [{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(0)", opacity: 0 }], {
        duration: reduce ? 1 : 700,
        easing: "ease-in",
      })
    );
    setFinaleSeen(true);
    await openCard({ kind: "final" });
    burst(cardRef.current, 50);
    const letters = cardRef.current?.querySelectorAll<HTMLElement>('[data-part="signature"] span') ?? [];
    const whole = letters.length === 1 && letters[0]!.dataset.joined !== undefined ? letters[0]! : null;
    if (whole) {
      // A joining script (see `writesLetterByLetter`): one piece, wiped in
      // from where its reading starts, so its letters stay joined.
      const from = whole.closest("[dir]")?.getAttribute("dir") === "rtl" ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)";
      const wiped = animate(whole, [{ opacity: 1, clipPath: from }, { opacity: 1, clipPath: "inset(0 0 0 0)" }], {
        duration: reduce ? 1 : Math.max(400, 110 * (whole.textContent?.length ?? 1)),
        easing: "ease-out",
      });
      if (!wiped) whole.style.opacity = "1";
      else await finished(wiped);
    }
    for (const letter of whole ? [] : letters) {
      const written = animate(letter, [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: reduce ? 1 : 260 });
      // No Web Animations here: show the letter rather than leave it at the
      // stylesheet's starting opacity of 0.
      if (!written) letter.style.opacity = "1";
      else if (!reduce) await new Promise((resolve) => setTimeout(resolve, 110));
    }
    closingFinal.current = true;
    busy.current = false;
  }, [burst, getMusic, openCard, reduce, sound, startMusic]);

  const draw = useCallback(
    async (index?: number) => {
      if (busy.current) return;
      if (goldReady) {
        void special();
        return;
      }
      const i = index ?? Array.from({ length: count }, (_, k) => k).find((k) => !opened.has(k));
      if (i === undefined || i < 0 || i >= count || opened.has(i)) return;
      busy.current = true;
      startMusic();
      if (sound) getMusic().sfx("open");
      await takeAnimation(data.gift, giftRef.current, i, reduce);
      setOpened((previous) => new Set(previous).add(i));
      await openCard({ kind: "reason", index: i });
      burst(cardRef.current, 18);
      busy.current = false;
    },
    [burst, count, data.gift, getMusic, goldReady, openCard, opened, reduce, sound, special, startMusic]
  );

  const closeCard = useCallback(() => {
    if (busy.current || !reveal) return;
    setReveal(null);
    returnFocus.current?.focus?.({ preventScroll: true });
    if (closingFinal.current) {
      closingFinal.current = false;
      setAfterOpen(true);
      window.setTimeout(() => {
        const scroller = scrollerRef.current;
        const after = afterRef.current;
        if (scroller && after) scroller.scrollTo?.({ top: after.offsetTop, behavior: reduce ? "auto" : "smooth" });
      }, 250);
    }
  }, [reduce, reveal]);

  const reopen = useCallback(
    (index: number) => {
      if (busy.current) return;
      if (sound) getMusic().sfx("open");
      void openCard({ kind: "reason", index });
    },
    [getMusic, openCard, sound]
  );

  const restart = useCallback(() => {
    music.current?.stop();
    busy.current = false;
    closingFinal.current = false;
    setOpened(new Set());
    setFinaleSeen(false);
    setAfterOpen(false);
    setReveal(null);
    // A fresh gift: the finished animations of the last reading must not
    // carry over (a cookie would still be cracked open).
    setRound((r) => r + 1);
    scrollerRef.current?.scrollTo?.({ top: 0 });
  }, []);

  const toggleSound = useCallback(() => {
    if (sound) music.current?.stop();
    else void getMusic().start();
    setMuted(sound);
  }, [getMusic, sound]);

  const title = resolveTitle(data, locale);
  const share = useCallback(async () => {
    if (!shareUrl) return;
    const payload = { title, text: t("experience.forYou", { to: data.toName }), url: shareUrl };
    if (navigator.share) {
      try {
        await navigator.share(payload);
        return;
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast(t("experience.copied"));
    } catch {
      showToast(t("experience.copyFailed"));
    }
  }, [data.toName, shareUrl, showToast, t, title]);

  useEffect(() => {
    if (!reveal) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeCard();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeCard, reveal]);

  const left = count - openedCount;
  const hint = goldReady ? t(`gifts.${data.gift}.finaleHint`) : left ? t(`gifts.${data.gift}.tap`) : "";
  const signature = resolveSignature(data);
  const chips = [...opened].filter((index) => index < count).sort((a, b) => a - b);

  return (
    <div
      ref={frameRef}
      className={styles.frame}
      data-gift={data.gift}
      data-fill={fill}
      // Its own language and direction, from the ORDER's locale: an Arabic
      // gift reads right to left even if the link's URL is in another one.
      lang={localeOf(locale)}
      dir={localeOf(locale) === "ar" ? "rtl" : "ltr"}
      style={{ "--gift-theme": gift.theme } as CSSProperties}
    >
      <div ref={scrollerRef} className={styles.scroller} data-locked={!afterOpen || undefined}>
        <section className={styles.stage}>
          <div className={styles.tag}>
            <small>{t("experience.forYou", { to: data.toName })}</small>
            <h1>{title}</h1>
            <small>{t("experience.from", { from: data.fromName })}</small>
          </div>
          <p className={styles.hint}>{hint}</p>
          <p className={styles.count}>{t("experience.of", { n: formatCount(openedCount, locale), t: formatCount(count, locale) })}</p>
          <div ref={giftRef} className={styles.gift} key={round}>
            <Scene
              count={count}
              opened={opened}
              goldReady={goldReady}
              toName={data.toName}
              tapLabel={t(`gifts.${data.gift}.tap`)}
              specialLabel={data.finaleTeaser || t("experience.teaser")}
              onDraw={(index) => void draw(index)}
              onSpecial={() => void special()}
            />
          </div>
          <div className={styles.pile}>
            {chips.map((index) => (
              <button
                key={index}
                type="button"
                aria-label={t("experience.reasonN", { n: formatCount(index + 1, locale) })}
                // A card's name ("A♥") reads left to right in every language;
                // in a right-to-left page the neutral ♥ would otherwise jump
                // in front of the rank ("♥A").
                dir={data.gift === "deck" ? "ltr" : undefined}
                onClick={() => reopen(index)}
              >
                {data.gift === "deck" ? `${RANKS[index]}♥` : formatCount(index + 1, locale)}
              </button>
            ))}
          </div>
          {data.music && (
            <div className={styles.bottom}>
              <button type="button" className={styles.mini} aria-pressed={sound} onClick={toggleSound}>
                <SoundIcon on={sound} /> {sound ? t("experience.soundOn") : t("experience.soundOff")}
              </button>
            </div>
          )}
        </section>

        <section ref={afterRef} className={styles.after} hidden={!afterOpen}>
          {data.letter && (
            <article className={styles.letter}>
              <p className={styles.greeting}>{data.letter.greeting}</p>
              {data.letter.paragraphs.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
              {data.letter.signoff && <p className={styles.signoff}>{data.letter.signoff}</p>}
              <span className={styles.signature}>{signature}</span>
            </article>
          )}
          <div className={styles.row}>
            {data.share && (
              <button type="button" className={`${styles.button} ${styles.ghost}`} onClick={() => void share()} aria-disabled={!shareUrl || undefined}>
                <ShareIcon /> {t("experience.share")}
              </button>
            )}
            <button type="button" className={`${styles.button} ${styles.ghost}`} onClick={restart}>
              <ReplayIcon /> {t("experience.again")}
            </button>
          </div>
          <p className={styles.brand}>
            <a href="https://theheartfolio.com">Made with Heartfolio · theheartfolio.com</a>
          </p>
        </section>
      </div>

      <div className={styles.reveal} data-open={reveal ? "" : undefined} onClick={closeCard} aria-hidden={!reveal}>
        {reveal && (
          <div
            ref={cardRef}
            className={`${styles.card} ${reveal.kind === "final" ? styles.final : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={reveal.kind === "final" ? data.finaleTeaser || t("experience.teaser") : t("experience.reasonN", { n: formatCount(reveal.index + 1, locale) })}
            tabIndex={-1}
            style={
              reveal.kind === "reason" && data.gift === "jar"
                ? ({ "--fc": NOTE_COLOURS[reveal.index % 10] } as CSSProperties)
                : undefined
            }
          >
            {reveal.kind === "final" ? (
              <FinalCard data={data} locale={locale} t={t} signature={signature} />
            ) : (
              <ReasonCard
                reason={data.reasons[reveal.index]}
                index={reveal.index}
                count={count}
                data={data}
                locale={locale}
                t={t}
                onPhotoError={onPhotoError}
              />
            )}
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className={styles.fx} aria-hidden="true" />
      <div className={styles.toast} data-show={toast ? "" : undefined} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}

type Translate = ReturnType<typeof translatorFor>;

function ReasonCard({
  reason,
  index,
  count,
  data,
  locale,
  t,
  onPhotoError,
}: {
  reason: ExperienceReason | undefined;
  index: number;
  count: number;
  data: ReasonsExperienceData;
  locale: string;
  t: Translate;
  onPhotoError?: (index: number) => void;
}) {
  if (!reason) return null;
  const number = t("experience.reasonN", { n: formatCount(index + 1, locale) });
  const photo = reason.photo ? <ReasonPhoto url={reason.photo.url} onError={() => onPhotoError?.(index)} /> : null;
  const memory = reason.memory ? <p className={styles.memory}>{reason.memory}</p> : null;

  if (data.gift === "deck") {
    return (
      <>
        <span className={`${styles.corner} ${styles.cornerStart}`}>
          {RANKS[index]}
          <br />♥
        </span>
        <span className={styles.suit} aria-hidden="true">
          ♥
        </span>
        <p className={styles.number}>{number}</p>
        <p className={styles.text}>{reason.text}</p>
        {photo}
        {memory}
        <span className={`${styles.corner} ${styles.cornerEnd}`}>
          {RANKS[index]}
          <br />♥
        </span>
      </>
    );
  }
  if (data.gift === "daisy") {
    return (
      <>
        <p className={styles.number}>{t("experience.lovesMe")}…</p>
        <p className={styles.text}>{reason.text}</p>
        {photo}
        {memory}
        <p className={styles.back}>{t("experience.tapToClose")}</p>
      </>
    );
  }
  if (data.gift === "cookies") {
    const lucky = [index + 1, count, ((index * 7 + 3) % 49) + 1, ((index * 13 + 11) % 49) + 1, 14, 2].map((n) => formatCount(n, locale)).join(" · ");
    return (
      <>
        <p className={styles.text}>{reason.text}</p>
        {photo}
        {memory}
        <p className={styles.lucky}>
          {t("experience.lucky")}: {lucky}
        </p>
      </>
    );
  }
  return (
    <>
      <p className={styles.number}>{number}</p>
      <p className={styles.text}>{reason.text}</p>
      {photo}
      {memory}
      <p className={styles.back}>{t("experience.tapToClose")}</p>
    </>
  );
}

function FinalCard({ data, locale, t, signature }: { data: ReasonsExperienceData; locale: string; t: Translate; signature: string }) {
  const head =
    data.gift === "deck" ? (
      <>
        <span className={`${styles.corner} ${styles.cornerStart}`}>
          Q<br />♥
        </span>
        <span className={styles.suit}>♛</span>
        <p className={styles.number}>
          {t("experience.queen")}: {data.toName}
        </p>
      </>
    ) : (
      <p className={styles.number}>{data.finaleTeaser || t("experience.teaser")}</p>
    );
  return (
    <>
      {head}
      <p className={styles.text}>{data.finaleLine}</p>
      <span className={styles.signature} data-part="signature" lang={locale}>
        {writesLetterByLetter(signature) ? (
          [...signature].map((character, i) => <span key={i}>{character === " " ? "\u00a0" : character}</span>)
        ) : (
          <span data-joined="">{signature}</span>
        )}
      </span>
      {data.gift === "deck" && (
        <span className={`${styles.corner} ${styles.cornerEnd}`}>
          Q<br />♥
        </span>
      )}
    </>
  );
}

/**
 * Whether the signature can be written one letter at a time. Not in a script
 * whose letters JOIN (Arabic): each letter in its own box is shaped alone, so
 * "ثيو" would appear as three isolated letters. Those signatures are revealed
 * as one piece instead (`special`).
 */
const JOINING_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u0870-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
export function writesLetterByLetter(signature: string): boolean {
  return !JOINING_SCRIPT.test(signature);
}

/**
 * A reason's photograph, built for a phone. It is only in the page while its
 * reason is open (one at a time, so at most one is decoded for display),
 * loads lazily, decodes off the main thread, and sits in a fixed-proportion
 * box with matching `width`/`height`, so the card never jumps when it arrives.
 * The photo is shown whole (`contain`), never cropped. There are no smaller
 * copies to choose between yet (that is the separate, flagged photo-delivery
 * task), so there is no `srcset`.
 */
export const PHOTO_BOX = { width: 800, height: 600 } as const;

function ReasonPhoto({ url, onError }: { url: string; onError: () => void }) {
  return (
    <span className={styles.photoBox}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a customer's photo behind a presigned URL, not a static asset next/image could optimise */}
      <img
        src={url}
        alt=""
        width={PHOTO_BOX.width}
        height={PHOTO_BOX.height}
        loading="lazy"
        decoding="async"
        className={styles.photo}
        onError={onError}
      />
    </span>
  );
}

function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
      {!on && <path d="M3 3l18 18" />}
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6" />
    </svg>
  );
}

function ReplayIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" />
    </svg>
  );
}
