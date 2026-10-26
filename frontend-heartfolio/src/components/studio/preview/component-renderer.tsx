"use client";

import type { ComponentRendererConfig } from "@/types/studio";
import { useProductState } from "@/lib/studio/product-state-context";
import { registerRenderer, type RendererProps } from "@/lib/studio/renderer-registry";
import { resolveShellText } from "@/lib/studio/i18n";
import { useState } from "react";
import { WALLPAPER_DEVICES } from "@/lib/studio/wallpaper-devices";
import { PreviewWatermark } from "./preview-watermark";
import {
  DeviceMockup,
  ExampleQrCard,
  FramedMockup,
  MomentWallpaper,
  StoryWallpaper,
  type DeviceKind,
  type DeviceScreen,
  type FrameFinish,
  type FrameMounting,
  type PreviewMode,
} from "./preview-modes";
import { ScaleToFit } from "./scale-to-fit";

/** Minimal shape read from `values.events` — mirrors the equally-local
 *  `Milestone` interface in `live-keepsake.tsx`, not shared, because
 *  `values` is untyped `Record<string, unknown>` everywhere it is
 *  consumed in the Studio, and each consumer casts to only the fields it
 *  actually reads. */
interface MomentEvent {
  date?: string;
  title?: string;
  photo?: { url?: string };
}

function ComponentRenderer({ config }: RendererProps) {
  const { values, tokens, themeSelections, locale, t, registerExportTarget, session } = useProductState();
  const rendererConfig = config as ComponentRendererConfig;
  const Product = rendererConfig.component;
  const [mode, setMode] = useState<PreviewMode>("flat");
  const [device, setDevice] = useState<DeviceKind>("phone");
  // Lock vs home screen (§4's two safe zones). Meaningless for desktop,
  // which has no lock-screen concept — see the note on `DeviceScreen`.
  const [screen, setScreen] = useState<DeviceScreen>("lock");
  // §13 — which of the two wallpaper kinds is shown. `"story"` is the
  // default because it is the one every wallpaper pack always includes;
  // a number selects one milestone's moment wallpaper by its position in
  // the SAME ordered list the renderer itself uses (see `orderedEvents`
  // below) — not by array index into the raw, possibly-unsorted values,
  // which would silently show the wrong photo whenever autoSort is on.
  const [wallpaperKind, setWallpaperKind] = useState<"story" | number>("story");
  // §16/§18d — two things under "Live": the actual interactive page, and
  // the QR card that links to it. Two different artifacts a Complete-pack
  // customer receives, not two views of one thing.
  const [liveView, setLiveView] = useState<"keepsake" | "qr">("keepsake");
  // §3's two print mountings. Defaults to `edged` because that is the pack
  // most customers already have (Printable and Complete both include it;
  // `frameless` is a Complete-only extra), so the first thing shown in
  // "framed" mode is the mounting they are most likely to actually own.
  const [mounting, setMounting] = useState<FrameMounting>("edged");
  const [finish, setFinish] = useState<FrameFinish>("wood");
  // §16 — undefined for a product with no Live pack concept (Where We Met
  // Map, today); the tab and the "live" mode simply do not exist for it.
  const LivePreview = session.module.livePreview?.component;

  /**
   * The preview chrome (mode tabs, device tabs) is SHELL copy, not product
   * copy — `preview.modes.*` and `preview.devices.*` live in
   * `SHELL_CHECKOUT_MESSAGES`, and no module's `messages` dictionary
   * contains them. Resolving them through the context's `t` (which reads
   * the module's own messages) therefore fell through to the raw key, and
   * the tabs rendered as "preview.modes.flat". `t` is still the right
   * resolver for the Product below — that copy really is module-owned.
   */
  const st = (key: string) => resolveShellText(key, locale);

  const poster = rendererConfig.intrinsicSize(values, themeSelections);
  /**
   * `WALLPAPER_DEVICES` — the same source the renderer uses (§4) — for
   * the device modes' own compositions (`StoryWallpaper`, `MomentWallpaper`
   * below). Neither one scales the poster itself onto a device shape: a
   * wallpaper is a genuinely different composition from the poster, built
   * from the story's own fields, not the timeline shrunk to fit a phone —
   * see `StoryWallpaper`'s own docstring in preview-modes.tsx for why that
   * used to be a real bug here, not a hypothetical one.
   */
  const deviceSize = WALLPAPER_DEVICES.find((d) => d.id === device);

  /**
   * The SAME ordering `renderer.tsx` computes for the timeline itself
   * (`values.autoSort ? [...events].sort(by date) : events`), duplicated
   * rather than imported because the module renderer does not currently
   * export it as a standalone helper. Duplicated with the exact same
   * expression, not a paraphrase, so the two cannot drift silently —
   * the Python side already learned this lesson (`layout.py`'s
   * `ordered_events` docstring says explicitly that it mirrors this
   * line). Selecting a moment by array index into the UNSORTED
   * `values.events` would show a different milestone than the one the
   * customer sees on the timeline itself whenever autoSort is on.
   */
  const orderedEvents = (
    (values.autoSort
      ? [...(values.events as MomentEvent[])].sort(
          (a, b) => new Date(a.date ?? "").getTime() - new Date(b.date ?? "").getTime()
        )
      : (values.events as MomentEvent[] | undefined)) ?? []
  );
  // `artwork` below (the poster itself, at its own intrinsic size) is only
  // ever used in "flat" and "framed" modes now — neither device-mode
  // wallpaper composition renders the poster component at all, so there is
  // no device-shaped override of `width`/`height` to compute here anymore.
  const { width, height } = poster;

  const artwork = (
    <ScaleToFit width={width} height={height}>
      {/*
        §20 — the watermark is a SIBLING of the registered export node, never
        a child of it.

        `registerExportTarget` hands the inner div to `exportTargets`, a ref
        that nothing consumes yet but that exists for a client-side export
        not yet written. Nesting the watermark inside that div would mean the
        day someone wires up a rasterizer, it silently starts appearing in
        whatever that produces — including, potentially, something a paying
        customer receives.

        Keeping it outside makes §20's "cannot leak into the delivered file"
        a property of the DOM rather than of the current absence of an
        exporter. `preview.test.tsx` asserts it.

        The wrapper is `relative` purely so the absolutely-positioned overlay
        has something to anchor to; it adds no layout of its own.
      */}
      <div style={{ width, height, position: "relative" }}>
        <div ref={(node) => registerExportTarget("default", node)} style={{ width, height }}>
          <Product values={values} tokens={tokens} themeSelections={themeSelections} locale={locale} t={t} />
        </div>
        <PreviewWatermark width={width} height={height} />
      </div>
    </ScaleToFit>
  );

  return (
    <div className="flex h-full flex-col">
      <PreviewModeTabs
        mode={mode}
        device={device}
        screen={screen}
        mounting={mounting}
        finish={finish}
        wallpaperKind={wallpaperKind}
        momentCount={orderedEvents.length}
        liveView={liveView}
        onModeChange={setMode}
        onDeviceChange={setDevice}
        onScreenChange={setScreen}
        onMountingChange={setMounting}
        onFinishChange={setFinish}
        onWallpaperKindChange={setWallpaperKind}
        onLiveViewChange={setLiveView}
        hasLivePreview={Boolean(LivePreview)}
        t={st}
      />
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        {/*
          The mockup wraps the artwork; the watermark stays INSIDE the
          artwork, over the design itself. Watermarking the mockup instead
          would leave the actual design clean in the middle of a frame —
          which is the part worth protecting (§20).
        */}
        {mode === "live" && liveView === "qr" ? (
          <div className="h-full max-w-xs overflow-hidden rounded-[var(--radius-lg)] border border-subtle">
            <ExampleQrCard />
          </div>
        ) : mode === "live" && LivePreview ? (
          /*
            §16 — a real interactive page, not a static image. It gets none
            of: `ScaleToFit` (the experience is meant to scroll at its own
            natural size, not be shrunk into a fixed poster-shaped box),
            the export-target ref (there is nothing here for a future
            rasterizer to capture — this was never going to be a file), or
            the watermark (§20's watermark exists to protect a STATIC image
            from being screenshotted and used before purchase; an
            interactive page scrolls past any single frame, so the same
            protection does not apply the same way, and a fixed watermark
            sitting over scrolling content would look like a bug, not a
            deterrent).
          */
          <div className="h-full w-full overflow-y-auto rounded-[var(--radius-lg)] border border-subtle">
            <LivePreview values={values} themeSelections={themeSelections} locale={locale} />
          </div>
        ) : mode === "framed" ? (
          <FramedMockup mounting={mounting} finish={finish} aspectRatio={poster.width / poster.height}>
            {artwork}
          </FramedMockup>
        ) : mode === "device" ? (
          <DeviceMockup kind={device} screen={screen}>
            {typeof wallpaperKind === "number" ? (
              <MomentWallpaper
                photoUrl={orderedEvents[wallpaperKind]?.photo?.url}
                title={orderedEvents[wallpaperKind]?.title ?? ""}
                date={orderedEvents[wallpaperKind]?.date ?? ""}
                locale={locale}
                safeBottom={deviceSize?.safeBottom ?? 0.1}
              />
            ) : (
              <StoryWallpaper
                events={orderedEvents}
                people={values.people as { name: string }[] | undefined}
                endingText={(values.endingText as string | undefined) ?? ""}
                kind={device}
                safeTop={deviceSize?.safeTop ?? 0.1}
                safeBottom={deviceSize?.safeBottom ?? 0.1}
                safeLeading={deviceSize?.safeLeading ?? 0}
              />
            )}
          </DeviceMockup>
        ) : (
          artwork
        )}
      </div>
    </div>
  );
}

/**
 * Mode tabs. Small, quiet, above the preview — this is a viewing control,
 * not part of the design being made, and it should not compete with it.
 */
function PreviewModeTabs({
  mode,
  device,
  screen,
  mounting,
  finish,
  wallpaperKind,
  momentCount,
  liveView,
  onModeChange,
  onDeviceChange,
  onScreenChange,
  onMountingChange,
  onFinishChange,
  onWallpaperKindChange,
  onLiveViewChange,
  hasLivePreview,
  t,
}: {
  mode: PreviewMode;
  device: DeviceKind;
  screen: DeviceScreen;
  mounting: FrameMounting;
  finish: FrameFinish;
  wallpaperKind: "story" | number;
  liveView: "keepsake" | "qr";
  /** How many milestones actually exist right now — the tab strip shows
   *  exactly this many moment pills, never a fixed count, so a project
   *  with fewer than the maximum never offers a tab for a milestone that
   *  is not there. */
  momentCount: number;
  onModeChange: (mode: PreviewMode) => void;
  onDeviceChange: (device: DeviceKind) => void;
  onScreenChange: (screen: DeviceScreen) => void;
  onMountingChange: (mounting: FrameMounting) => void;
  onFinishChange: (finish: FrameFinish) => void;
  onWallpaperKindChange: (kind: "story" | number) => void;
  onLiveViewChange: (view: "keepsake" | "qr") => void;
  hasLivePreview: boolean;
  t: (key: string) => string;
}) {
  // §16 — "live" only exists as a tab for a product that actually declared
  // a `livePreview` component. A product with no Digital pack concept
  // never sees a fourth tab it has nothing to show for.
  //
  // TEMPORARY, REVERSIBLE: "device" is deliberately left out of this list
  // (it used to read `["flat", "framed", "device", "live"]` /
  // `["flat", "framed", "device"]`) so the "On a device" tab itself does
  // not render, matching the wallpaper add-on being hidden at checkout —
  // restore it to bring the tab back. `mode` state can only ever become
  // "device" via clicking a tab built from this array (confirmed: nothing
  // else calls `setMode`, and there is no URL/deep-link mechanism reading
  // a mode), so every `mode === "device"` branch below and in
  // component-renderer.tsx is now genuinely unreachable, not just
  // hard to reach — left in place rather than removed, since this is a
  // hide, not a deletion.
  const modes: PreviewMode[] = hasLivePreview ? ["flat", "framed", "live"] : ["flat", "framed"];

  /**
   * TWO TIERS, STACKED — not one wrapping row.
   *
   * Both tablists used to sit in a single `flex-wrap` row, so selecting
   * "On a device" pushed three more pills onto the same line and the strip
   * grew sideways until it wrapped, which read as one flat list of seven
   * unrelated tabs. The devices are not siblings of the modes; they are
   * options *within* one mode, and the layout now says so: modes on their
   * own row, devices indented beneath, visible only while their parent is
   * selected.
   *
   * The sub-row SCROLLS sideways rather than wrapping. Wrapping would
   * change the strip's height as options are added, and the artwork below
   * would jump every time someone switched tabs — worse than a scroll on
   * the rare narrow viewport.
   */
  return (
    <div className="border-b border-subtle px-3 py-2">
      <div
        role="tablist"
        aria-label={t("preview.modes.label")}
        className="flex justify-center gap-1"
      >
        {modes.map((option) => (
          <button
            key={option}
            role="tab"
            type="button"
            aria-selected={mode === option}
            onClick={() => onModeChange(option)}
            className={
              mode === option
                ? "rounded-full bg-heading px-3 py-1 text-xs text-page"
                : "rounded-full px-3 py-1 text-xs text-body/60 hover:text-heading"
            }
          >
            {t(`preview.modes.${option}`)}
          </button>
        ))}
      </div>

      {/*
        Only meaningful in framed mode. Two independent controls on one
        row rather than two rows, because they answer different questions
        a customer can mix freely — "edged or frameless" is what gets
        printed (§3); "wood or black" is only how the mockup previews it
        and changes nothing about the pack. Keeping them visually distinct
        (mounting as filled pills, finish as a plain small toggle) is what
        keeps that difference legible without a second sub-row.
      */}
      {mode === "framed" && (
        <div className="mt-1.5 flex items-center justify-center gap-3">
          <div
            className="flex gap-1"
            role="tablist"
            aria-label={t("preview.mounting.label")}
          >
            {(["edged", "frameless"] as const).map((option) => (
              <button
                key={option}
                role="tab"
                type="button"
                aria-selected={mounting === option}
                onClick={() => onMountingChange(option)}
                className={
                  mounting === option
                    ? "flex-none rounded-full bg-subtle px-2.5 py-0.5 text-[11px] text-heading"
                    : "flex-none rounded-full px-2.5 py-0.5 text-[11px] text-body/60 hover:text-heading"
                }
              >
                {t(`preview.mounting.${option}`)}
              </button>
            ))}
          </div>

          {/* Only the edged mounting has a moulding to recolour — a glass
              or acrylic mount has no frame finish to choose, so the
              control is hidden rather than shown disabled. */}
          {mounting === "edged" && (
            <div
              className="flex gap-1 border-s border-subtle ps-3"
              role="tablist"
              aria-label={t("preview.finish.label")}
            >
              {(["wood", "black"] as const).map((option) => (
                <button
                  key={option}
                  role="tab"
                  type="button"
                  aria-selected={finish === option}
                  onClick={() => onFinishChange(option)}
                  className={
                    finish === option
                      ? "flex-none rounded-full bg-subtle px-2.5 py-0.5 text-[11px] text-heading"
                      : "flex-none rounded-full px-2.5 py-0.5 text-[11px] text-body/60 hover:text-heading"
                  }
                >
                  {t(`preview.finish.${option}`)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Only meaningful in device mode, and hidden rather than disabled
          elsewhere — a permanently greyed control is noise. */}
      {mode === "device" && (
        <div
          className="mt-1.5 flex justify-center gap-1 overflow-x-auto"
          role="tablist"
          aria-label={t("preview.devices.label")}
        >
          {WALLPAPER_DEVICES.map((option) => (
            <button
              key={option.id}
              role="tab"
              type="button"
              aria-selected={device === option.id}
              onClick={() => onDeviceChange(option.id as DeviceKind)}
              // `flex-none` so a long device name scrolls instead of being
              // squashed; smaller and quieter than a mode tab, because it
              // is subordinate to one.
              className={
                device === option.id
                  ? "flex-none rounded-full bg-subtle px-2.5 py-0.5 text-[11px] text-heading"
                  : "flex-none rounded-full px-2.5 py-0.5 text-[11px] text-body/60 hover:text-heading"
              }
            >
              {t(`preview.devices.${option.id}`)}
            </button>
          ))}
        </div>
      )}

      {/*
        LOCK/HOME IS ITS OWN CHECK, not a cosmetic toggle — §4's two safe
        zones sit at opposite edges of the screen, so a wallpaper can clear
        the clock at the top and still put a milestone's face behind the
        dock at the bottom. Before this, only the lock-screen furniture
        existed at all, so the second half of that check had no way to
        happen before purchase.

        Desktop has no lock-screen concept, so the control simply is not
        offered there rather than being shown disabled — there is nothing
        for it to toggle.
      */}
      {mode === "device" && device !== "desktop" && (
        <div
          className="mt-1.5 flex justify-center gap-1"
          role="tablist"
          aria-label={t("preview.screen.label")}
        >
          {(["lock", "home"] as const).map((option) => (
            <button
              key={option}
              role="tab"
              type="button"
              aria-selected={screen === option}
              onClick={() => onScreenChange(option)}
              className={
                screen === option
                  ? "flex-none rounded-full bg-subtle px-2.5 py-0.5 text-[11px] text-heading"
                  : "flex-none rounded-full px-2.5 py-0.5 text-[11px] text-body/60 hover:text-heading"
              }
            >
              {t(`preview.screen.${option}`)}
            </button>
          ))}
        </div>
      )}

      {/*
        §13 — WHICH WALLPAPER, not a cosmetic pick. "Story" and "Milestone
        N" are two genuinely different delivered files, not two ways of
        looking at one file, and a customer buying a wallpaper pack
        receives both kinds without ever having seen the moment ones
        before this existed. Applies to every device, including desktop —
        moment wallpapers are generated for all three.

        Exactly `momentCount` pills, not a fixed maximum: a project with
        fewer milestones than the cap never shows a tab for one that does
        not exist, the same principle the device/screen rows above already
        follow.
      */}
      {mode === "device" && (
        <div
          className="mt-1.5 flex justify-center gap-1 overflow-x-auto"
          role="tablist"
          aria-label={t("preview.wallpaperKind.label")}
        >
          <button
            role="tab"
            type="button"
            aria-selected={wallpaperKind === "story"}
            onClick={() => onWallpaperKindChange("story")}
            className={
              wallpaperKind === "story"
                ? "flex-none rounded-full bg-subtle px-2.5 py-0.5 text-[11px] text-heading"
                : "flex-none rounded-full px-2.5 py-0.5 text-[11px] text-body/60 hover:text-heading"
            }
          >
            {t("preview.wallpaperKind.story")}
          </button>
          {Array.from({ length: momentCount }, (_, index) => (
            <button
              key={index}
              role="tab"
              type="button"
              aria-selected={wallpaperKind === index}
              aria-label={`${t("preview.wallpaperKind.moment")} ${index + 1}`}
              onClick={() => onWallpaperKindChange(index)}
              className={
                wallpaperKind === index
                  ? "flex-none rounded-full bg-subtle px-2.5 py-0.5 text-[11px] text-heading"
                  : "flex-none rounded-full px-2.5 py-0.5 text-[11px] text-body/60 hover:text-heading"
              }
            >
              {index + 1}
            </button>
          ))}
        </div>
      )}

      {/*
        §16/§18d — the keepsake and its QR are two different artifacts a
        Complete-pack customer receives, so they get their own toggle
        rather than being two crops of one preview.
      */}
      {hasLivePreview && mode === "live" && (
        <div
          className="mt-1.5 flex justify-center gap-1"
          role="tablist"
          aria-label={t("preview.liveView.label")}
        >
          {(["keepsake", "qr"] as const).map((option) => (
            <button
              key={option}
              role="tab"
              type="button"
              aria-selected={liveView === option}
              onClick={() => onLiveViewChange(option)}
              className={
                liveView === option
                  ? "flex-none rounded-full bg-subtle px-2.5 py-0.5 text-[11px] text-heading"
                  : "flex-none rounded-full px-2.5 py-0.5 text-[11px] text-body/60 hover:text-heading"
              }
            >
              {t(`preview.liveView.${option}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

registerRenderer("component", ComponentRenderer);
