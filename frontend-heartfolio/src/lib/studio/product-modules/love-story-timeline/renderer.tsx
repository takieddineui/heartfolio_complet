import type { ProductRendererProps } from "@/types/studio";
import { Fragment } from "react";
import { DEFAULT_LAYOUT_ID } from "./layouts";
import type { TimelineEvent, TimelineValues } from "./initial-state";
import { durationKey } from "./story-types";
import styles from "./renderer.module.css";
import { FittedTimeline } from "./timeline-text-fit";

/**
 * CSS Module class lookups. Typed `string | undefined` because
 * `noUncheckedIndexedAccess` (on in this project) widens every CSS Module
 * property access — a class that is missing from the stylesheet resolves to
 * `undefined` at runtime, and the type now says so. Consumers fall back to
 * an empty class, which is what the old implicitly-`string` version already
 * did at runtime when interpolated into a template literal.
 */
const LAYOUT_CLASS: Record<string, string | undefined> = {
  "neat-stack": styles.layoutNeatStack,
  // All six compositions are built (§7); this fallback exists only for a
  // genuinely unknown/corrupted id — e.g. a saved project referencing a
  // layout that predates a future removal. Falling through to Neat Stack
  // rather than an unstyled list means that case looks like a complete,
  // different composition rather than a broken one.
  "alternating-tilt": styles.layoutAlternating,
  "overlapping-cascade": styles.layoutCascade,
  "dotted-branching": styles.layoutDotted,
  "horizontal-polaroid": styles.layoutHorizontal,
  "horizontal-circles": styles.layoutHorizontal,
};



function daysBetween(a: string, b: string): number | null {
  const start = new Date(a).getTime();
  const end = new Date(b).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
}

/** The day count in the Studio's language ("1 799" in French), not the
 *  browser's: it called `toLocaleString()` with no locale until 26 Oct 2026. */
export function formatCount(n: number, locale: string): string {
  return n.toLocaleString(locale);
}

/** A milestone's date in the Studio's language. The print writes the same
 *  string for the order's language (`date_formatting.py`), pinned to it by
 *  `locale-format-parity.test.ts`. */
export function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // A milestone is a calendar day ("2019-04-12", parsed as UTC midnight):
  // formatted in UTC, or every visitor west of UTC saw the day before.
  return d.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function LoveStoryTimelineRenderer({ values, tokens, themeSelections, locale, t }: ProductRendererProps<TimelineValues>) {
  // §11 — this was `LAYOUT_CLASS.centered`, an id from the removed
  // five-composition system. It silently evaluated to `undefined` for
  // every unrecognised value, which is a real instance of the same
  // staleness bug this whole pass exists to fix — a fallback that quietly
  // stopped falling back. `DEFAULT_LAYOUT_ID` is the real, current default.
  const layoutClass = LAYOUT_CLASS[themeSelections.layout as string] ?? LAYOUT_CLASS[DEFAULT_LAYOUT_ID];

  const events = values.autoSort
    ? [...values.events].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    : values.events;

  // `events.length >= 2` already guarantees both ends exist, but
  // `noUncheckedIndexedAccess` can't infer that from a length check —
  // binding them makes the guarantee explicit. Identical behaviour.
  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];
  const duration =
    values.showDuration && firstEvent && lastEvent && events.length >= 2
      ? daysBetween(firstEvent.date, lastEvent.date)
      : null;

  const durationMessageKey = durationKey(values.storyType);

  // §13 — frame is a delivery concern now, not a Studio preview concept:
  // the poster renders unframed. A framed presentation is shown
  // separately, in the dedicated Printable Pack mockup
  // (`preview-modes.tsx`'s `FramedMockup`), which wraps whatever artwork
  // it is given rather than needing a frame style itself.
  return (
      <div className={styles.poster} style={tokens as React.CSSProperties}>
      <header className={styles.header}>
        {/*
          §16 — joined from the people list (one or two names) rather than
          two fixed slots. The separator is always "&" — see `joinNames`.
        */}
        <p className={styles.names}>{joinNames(values.people, t)}</p>
        {values.posterTitle && <p className={styles.title}>{values.posterTitle}</p>}
        {values.subtitle && <p className={styles.subtitle}>{values.subtitle}</p>}
        {values.dedication && <p className={styles.quote}>&ldquo;{values.dedication}&rdquo;</p>}
        {/*
          §16 — duration phrasing comes from the story type. "days together"
          is right for a couple and reads as a mistake on a family history,
          which is why some types have no duration line at all.
        */}
        {duration !== null && durationMessageKey && (
          <p className={styles.duration}>
            {t(durationMessageKey, { days: formatCount(duration, locale) })}
          </p>
        )}
      </header>

      {renderComposition(themeSelections.layout as string, events, locale, layoutClass)}

      {values.endingText && <footer className={styles.footer}>{values.endingText}</footer>}
    </div>
  );
}

/**
 * Joins the story's names for the header (§16).
 *
 * Always "&" (§3), never a translated joiner. The story holds at most two
 * names (`MAX_PEOPLE`), so this is "A" or "A & B".
 */
function joinNames(
  people: { name: string }[] | undefined,
  t: (key: string, values?: Record<string, string>) => string
): string {
  /**
   * §3 — "&" and nothing else, at every count, in every locale.
   *
   * This used to translate the joiner for three or more names — "Emma,
   * James AND Sofia" in English, "ET" in French, "و" in Arabic — reasoning
   * that a plain comma list reads as a caption rather than a family. That
   * was my own earlier design choice, not something signed off against
   * this exact rule, and the rule as written does not carve out an
   * exception for three-plus names: "the separator is ALWAYS &... never
   * and/et/or any translated equivalent." Corrected to be uniform rather
   * than left as a plausible-sounding exception to an explicit rule.
   *
   * `t` is kept as a parameter for call-site compatibility, but nothing in
   * this function calls it anymore — the whole point is that no locale
   * decision is left for a translation dictionary to make.
   */
  void t;
  const names = (people ?? []).map((person) => person.name).filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  return names.join(" & ");
}

/**
 * Dispatches to a composition (§7).
 *
 * Each layout owns its own markup because the compositions are genuinely
 * different structures, not one structure with different classes — 7.1 is a
 * three-column grid, 7.3 is two columns with the spine floating behind the
 * photographs. Trying to express both through one JSX tree was what would
 * have made the CSS unreadable.
 */
function renderComposition(
  layoutId: string,
  events: TimelineEvent[],
  locale: string,
  layoutClass: string | undefined
) {
  if (layoutId === "horizontal-polaroid" || layoutId === "horizontal-circles") {
    return (
      <HorizontalComposition
        events={events}
        locale={locale}
        className={layoutClass}
        circular={layoutId === "horizontal-circles"}
      />
    );
  }
  if (layoutId === "dotted-branching") {
    return <DottedComposition events={events} locale={locale} className={layoutClass} />;
  }
  if (layoutId === "alternating-tilt") {
    return <AlternatingComposition events={events} locale={locale} className={layoutClass} />;
  }
  if (layoutId === "overlapping-cascade") {
    return <CascadeComposition events={events} locale={locale} className={layoutClass} />;
  }
  // The four not yet built fall through to Neat Stack, matching
  // compositions.py — a complete different composition beats a broken
  // version of the right one.
  return <NeatStackComposition events={events} locale={locale} className={layoutClass} />;
}

function NeatStackComposition({
  events,
  locale,
  className,
}: {
  events: TimelineEvent[];
  locale: string;
  className: string | undefined;
}) {
  return (
    <>
      {/*
        §7.1 — NEAT VERTICAL STACK.

        Three columns: photographs, spine, text. Rendered as three parallel
        lists rather than one list of rows, because the spine has to be a
        single continuous line — a per-row border would break at every gap,
        and the reference posters show one unbroken line with the hearts
        drawn on top of it.

        The lists stay index-aligned, so a milestone's photo, node and text
        sit on the same horizontal band: each list gives every milestone an
        equal share of the height, as the print gives each an equal slot.
        (They used to grow with fixed-width cards, which pushed milestones
        out of the clipped timeline at 5 and 8.) Each card sits in a cell
        that is a size container, so it can be limited by its row's height.
      */}
      <FittedTimeline
        className={`${styles.timeline} ${className ?? ""}`}
        textClassName={styles.neatEntry!}
        cellClassName={styles.neatEntry!}
      >
        <div className={styles.neatPhotos}>
          {events.map((event, i) => (
            <div key={i} className={styles.neatPhotoCell}>
              {event.photo ? (
                <span className={styles.neatPhoto}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={event.photo.url} alt="" />
                </span>
              ) : (
                // §4 makes a photo required, but a half-filled draft
                // legitimately lacks one. An empty frame holds the position
                // so the column does not reflow as photos are added.
                <span className={styles.neatPhoto} aria-hidden="true">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="" />
                </span>
              )}
            </div>
          ))}
        </div>
        <div className={styles.neatSpine} aria-hidden="true">
          {events.map((_, i) => (
            <svg key={i} className={styles.neatNode} viewBox="0 0 12 12" fill="currentColor">
              <path d="M6 11S1 7.6 1 4.4A3 3 0 0 1 6 2.3 3 3 0 0 1 11 4.4C11 7.6 6 11 6 11Z" />
            </svg>
          ))}
        </div>
        <ol className={styles.neatEntries}>
          {events.map((event, i) => (
            <li key={i} className={styles.neatEntry}>
              <p className={styles.neatDate}>{formatDate(event.date, locale)}</p>
              <p className={styles.neatTitle}>{event.title}</p>
              {event.description && (
                <p className={styles.neatDescription}>{event.description}</p>
              )}
              {locationDisplayName(event.location) && (
              <p className={styles.neatLocation}>{locationDisplayName(event.location)}</p>
            )}
            </li>
          ))}
        </ol>
      </FittedTimeline>
    </>
  );
}

/**
 * §7.3 — Overlapping Cascade.
 *
 * Two columns, with the spine absolutely positioned BEHIND the photographs
 * rather than between them. That is the structural difference from 7.1: here
 * the timeline recedes and the photographs are allowed to sit over it.
 *
 * The nodes hang off each milestone's date line rather than off the spine,
 * because the spine is a single element with no children to distribute —
 * and anchoring them to the date is what keeps a node level with the line
 * it belongs to however the text around it wraps.
 *
 * Both columns give every milestone an equal row (see `.layoutCascade`), as
 * the print gives each an equal slot, and the text is fitted to its row.
 */
function CascadeComposition({
  events,
  locale,
  className,
}: {
  events: TimelineEvent[];
  locale: string;
  className: string | undefined;
}) {
  return (
    <FittedTimeline
      className={`${styles.timeline} ${className ?? ""}`}
      textClassName={styles.cascadeEntry!}
      cellClassName={styles.cascadeEntry!}
    >
      <span className={styles.cascadeSpine} aria-hidden="true" />

      <div className={styles.cascadePhotos}>
        {events.map((event, i) => (
          <div
            key={i}
            className={styles.cascadePhotoCell}
            // Where this card sits on the diagonal: -0.5 for the first, 0.5
            // for the last, evenly between — the print's `progress - 0.5`.
            style={{ "--cascade-offset": String(i / Math.max(1, events.length - 1) - 0.5) } as React.CSSProperties}
          >
            <span className={styles.cascadePhoto}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={
                  event.photo?.url ??
                  "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="
                }
                alt=""
              />
            </span>
          </div>
        ))}
      </div>

      <ol className={styles.cascadeEntries}>
        {events.map((event, i) => (
          <li key={i} className={styles.cascadeEntry}>
            <p className={styles.neatDate}>
              <span className={styles.cascadeNode} aria-hidden="true" />
              {formatDate(event.date, locale)}
            </p>
            <p className={styles.neatTitle}>{event.title}</p>
            {event.description && <p className={styles.neatDescription}>{event.description}</p>}
            {locationDisplayName(event.location) && (
              <p className={styles.neatLocation}>{locationDisplayName(event.location)}</p>
            )}
          </li>
        ))}
      </ol>
    </FittedTimeline>
  );
}

/**
 * §7.2 — Alternating Tilt.
 *
 * Each milestone emits three grid cells — left, node, right — with the
 * photograph and the text swapping sides every row. Emitting all three per
 * milestone, rather than two columns filled independently, is what keeps a
 * photo level with its own caption when a long description makes one row
 * taller than the rest.
 */
function AlternatingComposition({
  events,
  locale,
  className,
}: {
  events: TimelineEvent[];
  locale: string;
  className: string | undefined;
}) {
  return (
    <FittedTimeline
      className={`${styles.timeline} ${className ?? ""}`}
      textClassName={styles.altText!}
      cellClassName={styles.altPhotoCell!}
    >
      {events.map((event, i) => {
        const photoOnStart = i % 2 === 0;
        // The cell is a size container for the card, so the card can be
        // limited by its ROW's height as well as its column's width — see
        // `.altPhotoCell` in the CSS.
        const photo = (
          <div key={`p${i}`} className={styles.altPhotoCell}>
            <span className={`${styles.altPhoto} ${photoOnStart ? styles.altPhotoOdd : styles.altPhotoEven}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={
                  event.photo?.url ??
                  "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="
                }
                alt=""
              />
            </span>
          </div>
        );
        const text = (
          <div
            key={`t${i}`}
            className={`${styles.altText} ${photoOnStart ? "" : styles.altTextStart}`}
          >
            <p className={styles.neatDate}>{formatDate(event.date, locale)}</p>
            <p className={styles.neatTitle}>{event.title}</p>
            {event.description && <p className={styles.neatDescription}>{event.description}</p>}
            {locationDisplayName(event.location) && (
              <p className={styles.neatLocation}>{locationDisplayName(event.location)}</p>
            )}
          </div>
        );

        return (
          <Fragment key={i}>
            {photoOnStart ? photo : text}
            <svg className={styles.altNode} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <path d="M6 11S1 7.6 1 4.4A3 3 0 0 1 6 2.3 3 3 0 0 1 11 4.4C11 7.6 6 11 6 11Z" />
            </svg>
            {photoOnStart ? text : photo}
          </Fragment>
        );
      })}
    </FittedTimeline>
  );
}

/**
 * §7.4 — Dotted Branching.
 *
 * The date is the first line of each milestone, starting on the spine and
 * running right above the title, with the page background behind it, which
 * is what produces the "interrupted line" the reference shows: the dotted
 * line runs unbroken underneath and the chip paints over it. (It used to be
 * absolutely positioned centred on the spine. The full date is wider than
 * the gutter between the photographs and the text, so it sat off the spine
 * over the cards' edge.)
 *
 * Both columns give every milestone an equal row (see `.layoutDotted`), as
 * the print gives each an equal slot, and the text is fitted to its row.
 */
function DottedComposition({
  events,
  locale,
  className,
}: {
  events: TimelineEvent[];
  locale: string;
  className: string | undefined;
}) {
  return (
    <FittedTimeline
      className={`${styles.timeline} ${className ?? ""}`}
      textClassName={styles.dottedEntry!}
      cellClassName={styles.dottedEntry!}
    >
      <span className={styles.dottedSpine} aria-hidden="true" />

      <div className={styles.dottedPhotos}>
        {events.map((event, i) => (
          <div key={i} className={styles.dottedPhotoCell}>
            <span className={styles.dottedPhoto}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={
                  event.photo?.url ??
                  "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="
                }
                alt=""
              />
            </span>
          </div>
        ))}
      </div>

      <ol className={styles.dottedEntries}>
        {events.map((event, i) => (
          <li key={i} className={styles.dottedEntry}>
            <span className={styles.dottedYear}>{formatDate(event.date, locale)}</span>
            <p className={styles.dottedLabel}>
              <svg className={styles.dottedHeart} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                <path d="M6 11S1 7.6 1 4.4A3 3 0 0 1 6 2.3 3 3 0 0 1 11 4.4C11 7.6 6 11 6 11Z" />
              </svg>
              {event.title}
            </p>
            {event.description && <p className={styles.neatDescription}>{event.description}</p>}
            {locationDisplayName(event.location) && (
              <p className={styles.neatLocation}>{locationDisplayName(event.location)}</p>
            )}
          </li>
        ))}
      </ol>
    </FittedTimeline>
  );
}

/**
 * §7.5 and §7.6 — the two landscape compositions.
 *
 * One component for both: they share their structure and differ only in how
 * a milestone is presented. 7.5 is a tilted Polaroid with the caption inside
 * its lower border; 7.6 is a circular photograph above a ticked axis with
 * the label below.
 *
 * Milestones are grid COLUMNS here, so adding one makes every milestone
 * narrower rather than making the page taller. That is why the type sizes
 * in this composition are smaller than the portrait layouts' — at eight
 * milestones a landscape page gives each barely an eighth of its width.
 */
function HorizontalComposition({
  events,
  locale,
  className,
  circular,
}: {
  events: TimelineEvent[];
  locale: string;
  className: string | undefined;
  circular: boolean;
}) {
  const placeholder =
    "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

  return (
    <FittedTimeline
      className={`${styles.timeline} ${className ?? ""}`}
      textClassName={styles.hMilestone!}
      cellClassName={styles.hMilestone!}
      fitTo="box"
      style={{ "--count": events.length } as React.CSSProperties}
    >
      {circular && <span className={styles.hAxis} aria-hidden="true" />}

      {events.map((event, i) => (
        <div key={i} className={styles.hMilestone}>
          {circular ? (
            <>
              <span className={styles.hCircle}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={event.photo?.url ?? placeholder} alt="" />
              </span>
              <span className={styles.hTick} aria-hidden="true" />
              <p className={styles.hLabel}>{event.title}</p>
              <p className={styles.hDate}>{formatDate(event.date, locale)}</p>
            </>
          ) : (
            <>
              <span className={styles.hPolaroid}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={event.photo?.url ?? placeholder} alt="" />
                {/* The caption lives INSIDE the Polaroid's lower border,
                    which is what the reference does and what distinguishes
                    7.5 from a plain row of photographs. */}
                <span className={styles.hPolaroidCaption}>{event.title}</span>
              </span>
              <p className={styles.hDate}>{formatDate(event.date, locale)}</p>
            </>
          )}
        </div>
      ))}
    </FittedTimeline>
  );
}

/**
 * §6 — the display text for a milestone location, whichever shape it is.
 *
 * A location is now `{ name, lat, lng, mapboxId? }` from a Mapbox search,
 * or a plain string for a milestone saved before that field existed (the
 * backend's `_location_field` accepts both, for the same reason). Every
 * composition renders only this — the poster has always shown a place
 * NAME, never coordinates, and that has not changed; the geography is
 * additional data for AR and future experiences, not a replacement for
 * what gets printed.
 */
function locationDisplayName(location: string | { name: string } | undefined): string {
  if (!location) return "";
  return typeof location === "string" ? location : location.name;
}
