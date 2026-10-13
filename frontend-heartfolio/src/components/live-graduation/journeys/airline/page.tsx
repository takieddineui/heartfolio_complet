"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import styles from "./airline.module.css";
import { fill } from "../../model";
import type { JourneyContext } from "../types";
import { AIRLINE_WORDS, type AirlineWords } from "./words";
import { PlaneIcon } from "./plane";

const INK = ["#2f7fd8", "#d64545", "#1f8a5f", "#7a5cd6", "#c2410c", "#0f2742", "#b8860b", "#c95ab0", "#2fae86", "#ff6b4a"];
const TILT = [-12, 8, -5, 14, -9, 6];

/** Everything in the scrolling page except the take-off (see `finale.tsx`). */
export function AirlinePage({ ctx, started }: { ctx: JourneyContext; started: boolean }) {
  const { story } = ctx;
  const words = AIRLINE_WORDS[story.lang];
  return (
    <>
      <Hero ctx={ctx} words={words} started={started} />
      {story.chapters.includes("path") ? <Path ctx={ctx} words={words} /> : null}
      {story.chapters.includes("achievements") && story.achievements.length > 0 ? (
        <Passport ctx={ctx} words={words} />
      ) : null}
      {story.chapters.includes("messages") && story.messageGroups.length > 0 ? (
        <Postcards ctx={ctx} words={words} />
      ) : null}
      {story.chapters.includes("goals") && story.goals.length > 0 ? <Itinerary ctx={ctx} words={words} /> : null}
      {story.chapters.includes("letter") && story.letter.body.length > 0 ? <Letter ctx={ctx} words={words} /> : null}
    </>
  );
}

function Chapter({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  const headingId = `airline-${id}`;
  return (
    <section className={styles.chapter} aria-labelledby={headingId}>
      <div className={styles.wrap}>
        <h2 id={headingId} className={styles.h2}>
          {title}
        </h2>
        {hint ? <p className={styles.hint}>{hint}</p> : null}
        {children}
      </div>
    </section>
  );
}

/* ── Hero: a seat by the window; the shade lifts when the page opens ──── */
function Hero({ ctx, words, started }: { ctx: JourneyContext; words: AirlineWords; started: boolean }) {
  const { story } = ctx;
  const flight = story.flight;
  const seat = flight.seat || words.defaultSeat;
  const cabin = flight.cabin || words.defaultCabin;
  return (
    <header className={styles.hero} data-started={started ? "true" : "false"}>
      <div className={`${styles.window} ${styles.rise}`} style={{ "--d": "0.1s" } as CSSProperties}>
        <div className={styles.glass}>
          {story.grad.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={story.grad.photo}
              alt={story.grad.fullName}
              width={480}
              height={640}
              decoding="async"
              fetchPriority="high"
            />
          ) : null}
          <div className={styles.shade} aria-hidden="true" />
        </div>
      </div>
      <h1 className={`${styles.heroTitle} ${styles.rise}`} style={{ "--d": "0.4s" } as CSSProperties}>
        {fill(words.welcome, { name: story.grad.name })}
      </h1>
      <p className={`${styles.heroDegree} ${styles.rise}`} style={{ "--d": "0.55s" } as CSSProperties}>
        {[story.grad.degree, story.grad.school].filter(Boolean).join(" · ")}
      </p>
      {story.grad.dateLabel ? (
        <p className={`${styles.heroMeta} ${styles.rise}`} style={{ "--d": "0.65s" } as CSSProperties}>
          {story.grad.dateLabel}
        </p>
      ) : null}
      <p className={`${styles.tagPill} ${styles.rise}`} style={{ "--d": "0.8s" } as CSSProperties}>
        <span aria-hidden="true">🔔</span> {fill(words.seatLine, { seat, cabin })}
      </p>
    </header>
  );
}

/* ── Path: the flight path; the plane glides to the stop being read ────── */
function Path({ ctx, words }: { ctx: JourneyContext; words: AirlineWords }) {
  const { story, copy, scrollEl } = ctx;
  const { path } = story;
  const flight = story.flight;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const stopRefs = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [moverY, setMoverY] = useState(0);
  const [layoutTick, setLayoutTick] = useState(0);

  const entries = useMemo(
    () => [
      { kind: "then" as const, tag: flight.fromCode || "KID" },
      ...path.stops.map((stop, i) => ({ kind: "stop" as const, index: i, tag: stop.code })),
      { kind: "now" as const, tag: "GRD" },
      { kind: "next" as const, tag: flight.toCode || "NXT" },
    ],
    [path.stops, flight.fromCode, flight.toCode]
  );

  // Which stop is being read: an observer rooted at the keepsake's own
  // scroller, waking only when a stop crosses the middle band - not a scroll
  // listener, which would do layout maths every frame on a phone.
  useEffect(() => {
    const root = scrollEl;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (observed) => {
        for (const entry of observed) {
          if (!entry.isIntersecting) continue;
          const index = stopRefs.current.indexOf(entry.target as HTMLElement);
          if (index >= 0) setActive(index);
        }
      },
      { root, rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );
    for (const node of stopRefs.current) if (node) observer.observe(node);
    return () => observer.disconnect();
  }, [scrollEl, entries.length]);

  // Photographs load after first paint and shift everything below them, so the
  // plane's target is re-measured whenever the path box changes size.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setLayoutTick((tick) => tick + 1));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const node = stopRefs.current[active];
    setMoverY(node ? node.offsetTop + 4 : 0);
  }, [active, layoutTick, entries.length]);

  const bigCard = (kind: "then" | "now" | "next", tag: string, label: string) => {
    const data =
      kind === "then"
        ? { year: path.then.year, text: path.then.text, photo: path.then.photo }
        : kind === "now"
          ? { year: path.now.year, text: path.now.text, photo: story.grad.photo }
          : { year: "", text: path.next.text, photo: path.next.photo };
    return (
      <>
        <p className={styles.tag}>
          <b>{tag}</b>
          {data.year}
        </p>
        <div className={`${styles.big} ${styles.card}`}>
          {data.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.photo} alt="" width={640} height={400} loading="lazy" decoding="async" />
          ) : null}
          <div className={styles.bigText}>
            <span className={styles.lbl}>{label}</span>
            <p>{data.text}</p>
          </div>
        </div>
      </>
    );
  };

  return (
    <Chapter id="path" title={words.path}>
      <div className={styles.path} ref={boxRef}>
        <span className={styles.pathLine} aria-hidden="true" />
        <span
          className={styles.mover}
          aria-hidden="true"
          style={{ "--y": `${moverY}px` } as CSSProperties}
        >
          <PlaneIcon />
        </span>
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {entries.map((entry, i) => (
            <li
              key={`${entry.kind}-${"index" in entry ? entry.index : 0}`}
              ref={(node) => {
                stopRefs.current[i] = node;
              }}
              className={`${styles.stop} ${entry.kind === "now" ? styles.stopNow : ""}`}
            >
              {entry.kind === "then" ? bigCard("then", entry.tag, words.then) : null}
              {entry.kind === "now" ? bigCard("now", entry.tag, words.now) : null}
              {entry.kind === "next" ? bigCard("next", entry.tag, words.next) : null}
              {entry.kind === "stop" ? (
                <>
                  <p className={styles.tag}>
                    <b>{entry.tag}</b>
                    {path.stops[entry.index]!.year}
                  </p>
                  <button
                    type="button"
                    className={`${styles.mini} ${styles.card}`}
                    onClick={() => ctx.openLightbox(entry.index)}
                    aria-label={fill(copy.openPhoto, { caption: path.stops[entry.index]!.caption })}
                  >
                    {path.stops[entry.index]!.photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={path.stops[entry.index]!.photo}
                        alt=""
                        width={148}
                        height={148}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : null}
                    <span>
                      <b>{path.stops[entry.index]!.caption}</b>
                      <small>{path.stops[entry.index]!.year}</small>
                    </span>
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </Chapter>
  );
}

/* ── Achievements: a passport, one stamp per tap ─────────────────────── */
function Passport({ ctx, words }: { ctx: JourneyContext; words: AirlineWords }) {
  const { story } = ctx;
  const items = story.achievements;
  const [stamped, setStamped] = useState<ReadonlySet<number>>(() => new Set());
  const countRef = useRef<HTMLParagraphElement | null>(null);

  const stamp = (index: number) => {
    if (stamped.has(index)) return;
    ctx.sfx.play("ach");
    const next = new Set(stamped).add(index);
    setStamped(next);
    if (next.size === items.length) {
      window.setTimeout(() => ctx.burstAt(countRef.current, 36), 300);
    }
  };

  return (
    <Chapter id="achievements" title={words.ach} hint={words.achHint}>
      <ul className={styles.stamps}>
        {items.map((item, i) => {
          const on = stamped.has(i);
          return (
            <li
              key={i}
              className={styles.stampItem}
              style={{ "--sc": INK[i % INK.length], "--r": `${TILT[i % TILT.length]}deg` } as CSSProperties}
            >
              <button
                type="button"
                className={`${styles.stamp} ${on ? styles.stampOn : ""}`}
                aria-pressed={on}
                aria-label={on ? fill(words.stampAria, { title: item.title }) : fill(words.pageAria, { n: i + 1 })}
                onClick={() => stamp(i)}
              >
                <span className={styles.stampNo} aria-hidden={on}>
                  {i + 1}
                </span>
                <span className={styles.stampInk} aria-hidden={!on}>
                  {item.place ? <small>{item.place}</small> : null}
                  <b>{item.title}</b>
                  {item.detail ? <em>{item.detail}</em> : null}
                  {story.grad.year ? <small>{story.grad.year}</small> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className={styles.count} ref={countRef} aria-live="polite">
        {fill(words.achCount, { n: stamped.size, t: items.length })}
      </p>
    </Chapter>
  );
}

/* ── Messages: postcards you turn over ───────────────────────────────── */
function Postcards({ ctx, words }: { ctx: JourneyContext; words: AirlineWords }) {
  const { story, copy } = ctx;
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set());

  const flip = (id: string) => {
    ctx.sfx.play("msg");
    setFlipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Chapter id="messages" title={words.msg} hint={words.msgHint}>
      {story.messageGroups.map((group, gi) => (
        <div className={styles.group} key={gi}>
          {group.label ? <h3>{group.label}</h3> : null}
          <ul className={styles.cards}>
            {group.people.map((person, pi) => {
              const id = `${gi}-${pi}`;
              const on = flipped.has(id);
              const playing = ctx.voice.playingId === id;
              return (
                <li key={id} className={styles.postcard} style={{ "--pc": person.color } as CSSProperties}>
                  <button type="button" className={styles.flip} aria-pressed={on} onClick={() => flip(id)}>
                    <span className={styles.inner}>
                      <span
                        className={`${styles.face} ${styles.front} ${person.drawingUrl ? styles.frontDrawn : ""}`}
                        aria-hidden={on}
                      >
                        {person.drawingUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={person.drawingUrl}
                            alt={fill(copy.drawingBy, { name: person.name })}
                            width={480}
                            height={320}
                            loading="lazy"
                            decoding="async"
                          />
                        ) : null}
                        <span className={styles.greeting}>
                          <small>{copy.greetingsFrom}</small>
                          {person.name}
                        </span>
                      </span>
                      <span className={`${styles.face} ${styles.back}`} aria-hidden={!on}>
                        <span className={styles.msgText}>
                          {person.message}
                          <b>{person.name}</b>
                        </span>
                        <span className={styles.side}>
                          <span className={styles.stampGlyph} aria-hidden="true">
                            {person.emoji}
                          </span>
                        </span>
                      </span>
                    </span>
                  </button>
                  {on && person.voiceUrl ? (
                    <button
                      type="button"
                      className={styles.voice}
                      aria-label={playing ? copy.voicePause : copy.voicePlay}
                      aria-pressed={playing}
                      onClick={() => ctx.voice.toggle(id, person.voiceUrl!)}
                    >
                      <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </Chapter>
  );
}

/* ── Goals: the itinerary ─────────────────────────────────────────────── */
function Itinerary({ ctx, words }: { ctx: JourneyContext; words: AirlineWords }) {
  return (
    <Chapter id="goals" title={words.goals}>
      <ul className={`${styles.goals} ${styles.card}`}>
        {ctx.story.goals.map((goal, i) => (
          <li key={i}>
            <span className={styles.goalCode}>{goal.code}</span>
            <span>{goal.text}</span>
            <span className={styles.goalTag}>{words.goalTag}</span>
          </li>
        ))}
      </ul>
    </Chapter>
  );
}

/* ── Letter ───────────────────────────────────────────────────────────── */
function Letter({ ctx, words }: { ctx: JourneyContext; words: AirlineWords }) {
  const { letter } = ctx.story;
  return (
    <Chapter id="letter" title={words.letter}>
      <article className={`${styles.letter} ${styles.card}`}>
        {letter.greeting ? <p className={styles.letterGreeting}>{letter.greeting}</p> : null}
        {letter.body.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
        {letter.signoff ? <p className={styles.signoff}>{letter.signoff}</p> : null}
        {letter.signatures.length > 0 ? (
          <div className={styles.sigs}>
            {letter.signatures.map((name, i) => (
              <span key={i}>{name}</span>
            ))}
          </div>
        ) : null}
      </article>
    </Chapter>
  );
}
