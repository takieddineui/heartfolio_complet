import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoveStoryTimelineRenderer } from "./renderer";
import { createInitialState, createInitialThemeSelections } from "./initial-state";

/**
 * Stands in for the module translator. Duration phrasing still goes
 * through it (§16) — the line differs per story type since "days
 * together" reads as a mistake on a family history. Name joining no
 * longer does: §3 requires a uniform "&" at every count and in every
 * locale, so `joinNames` needs no translator at all now (see its own
 * comment in renderer.tsx for why this reverses an earlier design).
 */
const noopTranslate = (key: string, params?: Record<string, string | number>) => {
  if (key.startsWith("storyTypes.") && key.endsWith(".duration") && params) {
    return `${params.days} days together`;
  }
  if (key === "renderer.premium.spotify") return "Spotify code linked";
  return key;
};

describe("LoveStoryTimelineRenderer (PreviewRenderer)", () => {
  it("consumes the normalized Studio state contract (values/tokens/themeSelections/locale/t) (N.3, N.4)", () => {
    render(
      <LoveStoryTimelineRenderer
        values={createInitialState()}
        tokens={{}}
        themeSelections={createInitialThemeSelections()}
        locale="en"
        t={noopTranslate}
      />
    );

    expect(screen.getByText("Emma & James")).toBeInTheDocument();
    expect(screen.getByText("We Met")).toBeInTheDocument();
    expect(screen.getByText("First Trip Together")).toBeInTheDocument();
  });

  it("reflects live edits to values immediately (no API round-trip — pure prop-driven render)", () => {
    const values = { ...createInitialState(), people: [{ name: "Alex" }, { name: "Sam" }] };
    render(
      <LoveStoryTimelineRenderer
        values={values}
        tokens={{}}
        themeSelections={createInitialThemeSelections()}
        locale="en"
        t={noopTranslate}
      />
    );
    expect(screen.getByText("Alex & Sam")).toBeInTheDocument();
  });

  it("handles minimal/edge-case state without crashing (N.5)", () => {
    // Below the §4 minimum of three on purpose: the renderer must survive a
    // half-filled draft. Validation enforces the floor at checkout, not on
    // every keystroke, so this state genuinely reaches the preview.
    const values = { ...createInitialState(), events: [{ date: "2020-01-01", title: "Only event", description: "" }] };
    expect(() =>
      render(
        <LoveStoryTimelineRenderer
          values={values}
          tokens={{}}
          themeSelections={createInitialThemeSelections()}
          locale="en"
          t={noopTranslate}
        />
      )
    ).not.toThrow();
    expect(screen.getByText("Only event")).toBeInTheDocument();
  });

  it("respects showDuration/autoSort exactly like the backend renderer's mirrored logic", () => {
    const values = {
      ...createInitialState(),
      showDuration: true,
      autoSort: false,
      events: [
        { date: "2022-01-01", title: "Later", description: "" },
        { date: "2020-01-01", title: "Earlier", description: "" },
      ],
    };
    render(
      <LoveStoryTimelineRenderer
        values={values}
        tokens={{}}
        themeSelections={createInitialThemeSelections()}
        locale="en"
        t={noopTranslate}
      />
    );
    // autoSort is false, so "Later" (as entered) stays first — the
    // duration is computed from events[0] to events[-1] in that order
    // (2022 -> 2020, i.e. backwards), clamping to 0 rather than going
    // negative. This exact quirk is intentionally mirrored by the
    // backend's layout.py (Phase 3.9) for cross-system consistency.
    expect(screen.getByText("0 days together")).toBeInTheDocument();
  });
});

describe("story types (§16)", () => {
  it("joins the two names with only an ampersand, never a translated word (§3)", () => {
    // Not "Emma and James" — §3 rules out a translated joiner.
    render(
      <LoveStoryTimelineRenderer
        values={{
          ...createInitialState(),
          storyType: "family",
          people: [{ name: "Emma" }, { name: "James" }],
        }}
        tokens={{}}
        themeSelections={createInitialThemeSelections()}
        locale="en"
        t={noopTranslate}
      />
    );
    expect(screen.getByText("Emma & James")).toBeInTheDocument();
  });

  it("uses the same ampersand in Arabic, not a translated joiner", () => {
    // The reversal: an earlier version deliberately avoided a Latin "&"
    // inside right-to-left text. §3's rule does not carve out an
    // exception, so this is uniform now too.
    render(
      <LoveStoryTimelineRenderer
        values={{
          ...createInitialState(),
          storyType: "family",
          people: [{ name: "Emma" }, { name: "James" }],
        }}
        tokens={{}}
        themeSelections={createInitialThemeSelections()}
        locale="ar"
        t={noopTranslate}
      />
    );
    expect(screen.getByText("Emma & James")).toBeInTheDocument();
  });

  it("omits the duration line for a story type that has none", () => {
    // A family history counted in "days together" would read as a bug.
    render(
      <LoveStoryTimelineRenderer
        values={{ ...createInitialState(), storyType: "family", showDuration: true }}
        tokens={{}}
        themeSelections={createInitialThemeSelections()}
        locale="en"
        t={noopTranslate}
      />
    );
    expect(screen.queryByText(/days together/)).not.toBeInTheDocument();
  });

  it("keeps the duration line for a couple", () => {
    render(
      <LoveStoryTimelineRenderer
        values={{ ...createInitialState(), storyType: "couple", showDuration: true }}
        tokens={{}}
        themeSelections={createInitialThemeSelections()}
        locale="en"
        t={noopTranslate}
      />
    );
    expect(screen.getByText(/days together/)).toBeInTheDocument();
  });

  it("renders a milestone location when one is given (§4)", () => {
    render(
      <LoveStoryTimelineRenderer
        values={{
          ...createInitialState(),
          events: [{ date: "2020-01-01", title: "We Met", description: "", location: "Lisbon" }],
        }}
        tokens={{}}
        themeSelections={createInitialThemeSelections()}
        locale="en"
        t={noopTranslate}
      />
    );
    expect(screen.getByText("Lisbon")).toBeInTheDocument();
  });
});

describe("location display (§6)", () => {
  it("shows the plain string for a legacy location", () => {
    const values = { ...createInitialState() };
    values.events[0]!.location = "Lisbon";

    render(
      <LoveStoryTimelineRenderer
        values={values}
        tokens={{}}
        themeSelections={createInitialThemeSelections()}
        locale="en"
        t={(key: string) => key}
      />
    );
    expect(screen.getByText("Lisbon")).toBeInTheDocument();
  });

  it("shows the name, not the coordinates, for a Mapbox-searched location", () => {
    // §6: the poster has always shown a place NAME, never numbers. The
    // structured form must render identically to the legacy string form.
    const values = { ...createInitialState() };
    values.events[0]!.location = { name: "Cascais, Portugal", lat: 38.69, lng: -9.42, mapboxId: "place.9" };

    render(
      <LoveStoryTimelineRenderer
        values={values}
        tokens={{}}
        themeSelections={createInitialThemeSelections()}
        locale="en"
        t={(key: string) => key}
      />
    );
    expect(screen.getByText("Cascais, Portugal")).toBeInTheDocument();
    expect(screen.queryByText(/38\.69/)).not.toBeInTheDocument();
  });
});
