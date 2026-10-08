import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemePicker } from "./theme-picker";
import type { ThemeEngineConfig, ThemeSelections } from "@/types/studio";

/**
 * The exact real-world shape this fix exists for: Song Poster's own
 * `songPosterThemes` config has a "theme" select axis and a
 * "sleevePalette" swatch axis with `visibleWhen: [{ path: "theme.theme",
 * op: "eq", value: "sleeve" }]` — built the same session as this test.
 * Mirrored here rather than importing the real config, so this test
 * doesn't silently start covering a different product's config if
 * Song Poster's own changes later; it is testing `ThemePicker`'s
 * general mechanism, not one product's specific axes.
 */
const CONFIG: ThemeEngineConfig = {
  axes: [
    {
      id: "theme",
      label: "theme.label",
      kind: "select",
      defaultOptionId: "player",
      options: [
        { id: "player", label: "theme.player" },
        { id: "sleeve", label: "theme.sleeve" },
      ],
    },
    {
      id: "sleevePalette",
      label: "palette.label",
      kind: "swatch",
      defaultOptionId: "cream",
      visibleWhen: [{ path: "theme.theme", op: "eq", value: "sleeve" }],
      options: [
        { id: "cream", label: "palette.cream", swatch: "#f1ece2" },
        { id: "red", label: "palette.red", swatch: "#b93b2c" },
      ],
    },
  ],
};

const t = (key: string) => key;

describe("ThemePicker — conditional axis visibility", () => {
  it("hides the palette axis while a non-Sleeve theme is selected", () => {
    const selections: ThemeSelections = { theme: "player" };
    render(<ThemePicker config={CONFIG} values={{}} selections={selections} onChange={vi.fn()} t={t} />);

    expect(screen.getByText("theme.label")).toBeInTheDocument();
    expect(screen.queryByText("palette.label")).not.toBeInTheDocument();
  });

  it("shows the palette axis once Sleeve is selected", () => {
    const selections: ThemeSelections = { theme: "sleeve" };
    render(<ThemePicker config={CONFIG} values={{}} selections={selections} onChange={vi.fn()} t={t} />);

    expect(screen.getByText("palette.label")).toBeInTheDocument();
  });

  it("the palette axis appears after a rerender when the theme selection changes to sleeve — the actual dynamic-appearance case the animation exists for", async () => {
    const { rerender } = render(
      <ThemePicker config={CONFIG} values={{}} selections={{ theme: "player" }} onChange={vi.fn()} t={t} />
    );
    expect(screen.queryByText("palette.label")).not.toBeInTheDocument();

    rerender(<ThemePicker config={CONFIG} values={{}} selections={{ theme: "sleeve" }} onChange={vi.fn()} t={t} />);

    await waitFor(() => expect(screen.getByText("palette.label")).toBeInTheDocument());
  });

  it("clicking a swatch still calls onChange correctly — the animation wrapper doesn't break the underlying interaction", () => {
    const onChange = vi.fn();
    render(
      <ThemePicker
        config={CONFIG}
        values={{}}
        selections={{ theme: "sleeve", sleevePalette: "cream" }}
        onChange={onChange}
        t={t}
      />
    );

    const redSwatch = screen.getByTitle("palette.red");
    redSwatch.click();

    expect(onChange).toHaveBeenCalledTimes(1);
    const updater = onChange.mock.calls[0]![0] as (prev: ThemeSelections) => ThemeSelections;
    expect(updater({ theme: "sleeve", sleevePalette: "cream" })).toMatchObject({ sleevePalette: "red" });
  });
});
