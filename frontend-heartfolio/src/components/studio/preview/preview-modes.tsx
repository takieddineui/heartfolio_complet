"use client";

import type { ReactNode } from "react";
import styles from "./preview-modes.module.css";
import { Logo } from "@/components/brand/logo";
import {
  Calendar,
  Camera,
  Compass,
  FileText,
  Folder,
  Globe,
  Image as ImageIcon,
  Mail,
  MessageCircle,
  Music,
  Phone,
  Settings,
} from "lucide-react";
import { formatDate } from "@/lib/studio/product-modules/love-story-timeline/renderer";

/**
 * ---------------------------------------------------------------------
 * PREVIEW MODES — SEEING WHAT EACH PACK ACTUALLY IS
 * ---------------------------------------------------------------------
 * The Studio previewed one thing: the poster, flat, on its own. That is the
 * printable pack and nothing else. A customer buying the Wallpaper Pack saw
 * a poster; a customer buying Complete saw a poster and had to imagine the
 * rest.
 *
 * Three modes, and each answers a question the flat poster cannot:
 *
 *   `flat`    — the artwork itself. What is being made.
 *   `framed`  — the same artwork behind a frame on a wall. Answers "what
 *               will this look like in my house", which is the question a
 *               $30 print actually raises, and it is why every seller of
 *               printable art shows one.
 *   `device`  — the wallpaper inside a phone, tablet or desktop shell with
 *               the OS furniture drawn on top. This is the only mode that
 *               shows whether the §4 safe zones actually work: a wallpaper
 *               previewed flat looks fine even when the clock lands on
 *               someone's face.
 *
 * MOCKUPS ARE DRAWN, NOT PHOTOGRAPHED. A photographic room mockup would
 * mean shipping and colour-managing large images, and it would make the
 * artwork smaller inside the frame. These are CSS: a mat, a moulding, a
 * shadow. Honest about being a diagram rather than pretending to be a
 * photograph, which also avoids implying a physical product Heartfolio does
 * not ship.
 */

export type PreviewMode = "flat" | "framed" | "device" | "live";
export type DeviceKind = "phone" | "tablet" | "desktop";

/**
 * §3's two print mountings, matched one-for-one:
 *   `edged`     — a margin left for a moulding to sit against (a frame).
 *   `frameless` — printed edge-to-edge for a glass or acrylic mount.
 * The names deliberately match `apps/delivery/print_sizes.py`'s
 * `EDGED`/`FRAMELESS` constants rather than "framed"/"borderless" or any
 * other synonym, so a print target id and a mockup prop never need
 * translating into each other.
 */
export type FrameMounting = "edged" | "frameless";

/**
 * The frame's own colourway. Independent of `mounting`: a customer chooses
 * how the print is trimmed (edged/frameless) when they choose a pack, and
 * separately previews what it would look like in their own room — nothing
 * about "black vs wood" changes what gets printed.
 */
export type FrameFinish = "wood" | "black";

export function FramedMockup({
  children,
  mounting = "edged",
  finish = "wood",
  aspectRatio,
}: {
  children: ReactNode;
  mounting?: FrameMounting;
  finish?: FrameFinish;
  /**
   * The artwork's own width/height ratio (e.g. a Classic portrait print
   * is 540/810). Without this, `.frame`/`.glassMount` filled `.wall`'s
   * entire (roughly square) box regardless of what shape the artwork
   * actually is — a portrait print sat centred in a near-square frame,
   * which read as a large blank mat even at a tight mat percentage,
   * because most of the gap was letterboxing from the SHAPE mismatch,
   * not the mat itself. Passing this lets the frame take the artwork's
   * own proportions (same technique `.phone`/`.tablet`/`.desktop`
   * already use below for device shells), so the mat's own padding is
   * the only gap left to tune.
   */
  aspectRatio?: number;
}) {
  const shapeStyle = aspectRatio ? { aspectRatio } : undefined;

  if (mounting === "frameless") {
    return (
      <div className={styles.wall}>
        <div className={styles.glassMount} style={shapeStyle}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wall}>
      <div className={finish === "black" ? `${styles.frame} ${styles.black}` : styles.frame} style={shapeStyle}>
        <div className={styles.mat}>{children}</div>
      </div>
    </div>
  );
}

/**
 * A device shell with its OS furniture drawn over the wallpaper.
 *
 * The furniture is the entire point. §4's safe zones are reasoned numbers
 * that have never been checked on hardware, and a flat preview cannot show
 * whether the lock-screen clock is sitting on a milestone. Drawing the
 * clock, the home indicator and the dock in roughly the right places makes
 * that visible in the Studio, before purchase.
 *
 * Roughly is the honest word: these are indicative positions, not a
 * simulation of any particular OS version.
 */
/**
 * Which piece of OS furniture is drawn over the wallpaper — the two places
 * a device's own chrome can actually collide with the artwork, and they
 * sit at opposite edges of the screen. Meaningless for `desktop`, which
 * has no lock-screen concept and always shows its menu bar and dock; the
 * prop is accepted there but has no effect, rather than being a type
 * error a caller has to route around when rendering three devices in a
 * loop.
 */
export type DeviceScreen = "lock" | "home";

export function DeviceMockup({
  kind,
  screen = "lock",
  children,
}: {
  kind: DeviceKind;
  screen?: DeviceScreen;
  children: ReactNode;
}) {
  return (
    <div className={`${styles.device} ${styles[kind]}`}>
      <div className={styles.screen}>
        {children}

        {kind !== "desktop" && screen === "lock" && (
          <>
            <div className={styles.statusBar} aria-hidden="true" />
            <div className={styles.lockClock} aria-hidden="true">
              <span className={styles.clockTime} />
              <span className={styles.clockDate} />
            </div>
            <div className={styles.homeIndicator} aria-hidden="true" />
          </>
        )}

        {/*
          HOME FURNITURE SITS AT THE OPPOSITE EDGE FROM LOCK FURNITURE, on
          purpose: the clock claims the top safe zone, the icon grid and
          dock claim the bottom one. A wallpaper can pass one check and
          fail the other, which is exactly why both need to be checkable
          rather than only the one that happened to be built first.
        */}
        {kind !== "desktop" && screen === "home" && (
          <>
            <div className={styles.statusBar} aria-hidden="true" />
            {/*
              GENERIC icon-style glyphs (lucide-react), not real app logos —
              a believable home screen needs SOMETHING recognisable as an
              icon grid rather than eight blank tiles, but a literal
              Instagram/WhatsApp/etc. mark would be a trademarked logo
              rendered without permission. A camera, a message bubble, a
              gear and so on read as "this is an icon grid" just as well,
              without claiming to be any specific real app.
            */}
            <div className={styles.homeGrid} aria-hidden="true">
              <span><Camera /></span>
              <span><MessageCircle /></span>
              <span><Settings /></span>
              <span><Phone /></span>
              <span><Calendar /></span>
              <span><ImageIcon /></span>
              <span><Compass /></span>
              <span><Music /></span>
            </div>
            <div className={styles.homeDock} aria-hidden="true">
              <span><Phone /></span>
              <span><MessageCircle /></span>
              <span><Camera /></span>
              <span><Music /></span>
            </div>
            <div className={styles.homeIndicator} aria-hidden="true" />
          </>
        )}

        {kind === "desktop" && (
          <>
            <div className={styles.menuBar} aria-hidden="true" />
            {/* Same generic-glyph reasoning as the phone/tablet home grid
                above — a Finder-style icon column reads as "these are
                files", not as any specific real desktop's actual icons. */}
            <div className={styles.iconColumn} aria-hidden="true">
              <span><Folder /></span>
              <span><ImageIcon /></span>
              <span><FileText /></span>
            </div>
            <div className={styles.dock} aria-hidden="true">
              <span><Folder /></span>
              <span><Mail /></span>
              <span><Globe /></span>
              <span><Settings /></span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * §13's SECOND wallpaper kind — one milestone, filling the screen, not a
 * crop of the timeline. Its own composition mirroring `png_renderer.py`'s
 * `_render_moment_wallpaper` deliberately, field for field, rather than a
 * loose approximation: a Studio preview that draws this differently from
 * what actually gets delivered is worse than no preview at all — it is a
 * promise the file does not keep.
 *
 * Matched from the Python source:
 *   - the photo covers the full screen (CSS `background-size: cover`,
 *     same intent as `_paste_cover`'s scale-to-larger-ratio-then-crop)
 *   - a bottom scrim, ~20% of the screen height, eased rather than a hard
 *     edge — approximated here with a CSS gradient rather than the
 *     server's per-row cubic alpha curve, which is not meaningfully
 *     different at preview size
 *   - the scrim's bottom edge sits at `safeBottom` up from the true
 *     bottom, from the SAME `WALLPAPER_DEVICES` table the server's
 *     `WallpaperDevice.safe_bottom` values were copied from (see that
 *     file's own note on why the two are kept in sync)
 *   - title in white, date beneath it in a dimmer white, both centred
 *   - EN-US "Mon D, YYYY" date formatting, unconditionally — the backend
 *     comment is explicit that this is English-only today, so a preview
 *     showing a localised date would show something the file will not
 *     actually contain
 *
 * NOT reusing the `Product` renderer, deliberately: that component draws
 * the TIMELINE. A moment wallpaper is not the timeline cropped to one
 * card, it is a different composition built from one event's own fields,
 * so it needed its own small component rather than a prop on the big one.
 */
export function MomentWallpaper({
  photoUrl,
  title,
  date,
  locale,
  safeBottom,
}: {
  photoUrl: string | undefined;
  title: string;
  /** ISO date (`YYYY-MM-DD`); formatted as the milestone dates are, which
   *  is what the delivered wallpaper prints (`format_event_date`). */
  date: string;
  /** The Studio's language: the wallpaper prints the date in the order's
   *  (it was English-only on both sides until 26 Oct 2026). */
  locale: string;
  /** `WallpaperDevice.safeBottom` — the same value already passed to
   *  `DeviceMockup`'s furniture, so the caption band and the OS chrome
   *  agree on where the bottom safe zone actually is. */
  safeBottom: number;
}) {
  const formatted = formatDate(date, locale);

  return (
    <div className={styles.moment}>
      {photoUrl ? (
        <img src={photoUrl} alt="" className={styles.momentPhoto} />
      ) : (
        // A missing photo on the server falls back to a plain background
        // rather than failing a paid download — see `_render_moment_
        // wallpaper`'s own comment. Mirrored here as a plain fill, not an
        // error state, for the same reason.
        <div className={styles.momentPhotoFallback} aria-hidden="true" />
      )}
      <div className={styles.momentScrim} style={{ height: `${20}%`, bottom: `${safeBottom * 100}%` }}>
        <div className={styles.momentCaption}>
          <span className={styles.momentTitle}>{title}</span>
          <span className={styles.momentDate}>{formatted}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * §13's FIRST wallpaper kind — the whole story, composed for a screen.
 * Mirrors `png_renderer.py`'s `_render_story_wallpaper` deliberately,
 * field for field, for the identical reason `MomentWallpaper` above does:
 * a preview that draws this differently from what actually gets delivered
 * is worse than no preview at all.
 *
 * THIS REPLACES SCALING THE POSTER ONTO A DEVICE SHAPE — which is what
 * this preview used to do (rendering the `Product` timeline component,
 * built for a poster's own proportions and font sizes, squeezed into a
 * phone-shaped box) and what the Python docstring explicitly rules out:
 * "remain visually useful rather than simply shrinking the poster."
 * Squeezing a poster's dates/titles/descriptions into a phone-wallpaper
 * aspect ratio is exactly the failure `_render_story_wallpaper` was
 * written to fix — reusing `Product` here would have reintroduced the
 * same bug in the preview that the backend already moved past.
 *
 * Matched from the Python source:
 *   - photos stacked in a single full-width column (phone/tablet) or a
 *     filmstrip of equal-width cells (desktop), each CROPPED TO FILL its
 *     cell (`_paste_cover_region`'s "cropping rather than fitting") —
 *     approximated with CSS `background-size: cover`, same intent
 *   - the photo area spans from `safeTop` to a caption band that starts
 *     16% of the usable height above `safeBottom` (`caption_band = usable_h
 *     * 0.16`), not the full safe area — the names need their own room
 *   - the desktop leading inset (`safeLeading`, the icon-column safe zone)
 *     narrows the photo strip's start edge; phone/tablet have none
 *   - names joined with the SAME always-`&` rule as the backend's
 *     `join_names` (`data.py`) — deliberately NOT the poster's own
 *     `joinNames` in this product's `renderer.tsx`, which is a different,
 *     locale-aware function for a different surface (the poster header)
 *   - the ending text beneath the names, when present, matching
 *     `timeline.ending_text`
 *
 * NOT reusing the `Product` renderer, for the same reason `MomentWallpaper`
 * gives: this is a different composition built from the story's own
 * fields (photos + names, not the poster's title/dedication/date list),
 * not the timeline cropped or shrunk.
 */
export function StoryWallpaper({
  events,
  people,
  endingText,
  kind,
  safeTop,
  safeBottom,
  safeLeading,
}: {
  events: { photo?: { url?: string } }[];
  people: { name: string }[] | undefined;
  endingText: string;
  kind: DeviceKind;
  safeTop: number;
  safeBottom: number;
  safeLeading: number;
}) {
  const names = joinStoryNames(people);
  const count = Math.max(1, events.length);
  const photoAreaHeight = (1 - safeTop - safeBottom) * 0.84;
  const captionBandHeight = (1 - safeTop - safeBottom) * 0.16;
  const photos = events.length > 0 ? events : [{ photo: undefined }];

  return (
    <div className={styles.story}>
      <div
        className={kind === "desktop" ? styles.storyPhotosRow : styles.storyPhotosColumn}
        style={{
          top: `${safeTop * 100}%`,
          height: `${photoAreaHeight * 100}%`,
          insetInlineStart: kind === "desktop" ? `${safeLeading * 100}%` : 0,
        }}
      >
        {photos.map((event, index) => (
          <div
            key={index}
            className={styles.storyPhotoCell}
            style={event.photo?.url ? { backgroundImage: `url(${event.photo.url})` } : undefined}
          >
            {!event.photo?.url && <div className={styles.momentPhotoFallback} aria-hidden="true" />}
          </div>
        ))}
      </div>
      <div
        className={styles.storyCaption}
        style={{ height: `${captionBandHeight * 100}%`, bottom: `${safeBottom * 100}%` }}
      >
        <span className={styles.momentTitle}>{names}</span>
        {endingText && <span className={styles.momentDate}>{endingText}</span>}
      </div>
    </div>
  );
}

/**
 * §3's always-`&` rule (`join_names` in `data.py`), not the poster
 * header's own locale-aware `joinNames` in this product's `renderer.tsx`
 * — the two surfaces are different deliverables and the backend calls a
 * genuinely different function for each; this mirrors the wallpaper's own.
 */
function joinStoryNames(people: { name: string }[] | undefined): string {
  const names = (people ?? []).map((person) => person.name).filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  return names.join(" & ");
}


/**
 * §18d — an EXAMPLE of the live-page QR card, not a real one.
 *
 * The real card (`render_live_qr_card` in the backend's `bonuses.py`)
 * encodes the order's own signed access token, and that token does not
 * exist until checkout — an order has to be paid before it has an id
 * worth signing. There is no way to show a real, scannable code here
 * without either faking a purchase or shipping a second token-signing
 * path into the browser, so this shows the CARD DESIGN with an
 * unmistakably fake matrix, labelled as an example on the card itself
 * rather than only in a caption beside it — a customer who screenshots
 * or crops the card should still see "Example", not a code that looks
 * real and does nothing.
 *
 * THE PATTERN IS DETERMINISTIC, not random per render: a fixed matrix
 * means the mock does not flicker between renders (React state changes,
 * locale switches) in a way that reads as broken rather than static.
 * Deliberately NOT built from `qrcode`-shaped finder squares repeated
 * densely — the three corner squares are real QR grammar and are kept
 * (they are what makes it *read* as a QR code at a glance); the interior
 * is a coarse, sparse checkerboard rather than a dense pseudo-random
 * fill, so it cannot be mistaken for a real, denser, scannable symbol.
 */
export function ExampleQrCard() {
  const cells = 11;
  const sparse = [
    [4, 4], [4, 6], [5, 5], [6, 4], [6, 6],
    [4, 8], [6, 8], [8, 4], [8, 6],
  ];

  return (
    <div className={styles.qrCard}>
      <div className={styles.qrCardMark} aria-hidden="true">
        <Logo variant="mark" title={null} className={styles.qrCardMarkIcon} />
      </div>
      <div className={styles.qrCardPlate}>
        <svg viewBox={`0 0 ${cells} ${cells}`} className={styles.qrCardMatrix} aria-hidden="true">
          {/* The three finder squares — real QR grammar, what makes this
              read as a QR code rather than an abstract grid. */}
          {([[0, 0], [cells - 3, 0], [0, cells - 3]] as const).map(([fx, fy]) => (
            <g key={`${fx}-${fy}`}>
              <rect x={fx} y={fy} width={3} height={3} fill="currentColor" />
              <rect x={fx + 0.7} y={fy + 0.7} width={1.6} height={1.6} fill="var(--qr-plate, #fff)" />
            </g>
          ))}
          {sparse.map(([sx, sy]) => (
            <rect key={`${sx}-${sy}`} x={sx} y={sy} width={1} height={1} fill="currentColor" />
          ))}
        </svg>
        <span className={styles.qrCardBadge}>Example</span>
      </div>
      <p className={styles.qrCardCaption}>Your real code appears here after purchase</p>
      <p className={styles.qrCardWordmark}>HEARTFOLIO</p>
    </div>
  );
}
