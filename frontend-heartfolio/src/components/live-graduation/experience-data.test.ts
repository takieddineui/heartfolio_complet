import { describe, expect, it } from "vitest";
import {
  arcadeScore,
  flightOf,
  formatDate,
  formatNumber,
  graphemes,
  personColour,
  ridgeAltitudes,
  SUMMIT_METRES,
  trailAltitudes,
  translatorFor,
  type GraduationExperienceData,
} from "./experience-data";

const base = (over: Partial<GraduationExperienceData> = {}): GraduationExperienceData => ({
  journey: "airline",
  grad: { name: "Maya", fullName: "Maya Chen", year: "2027", degree: "BA", school: "Edinburgh", date: "2027-07-02", photo: null },
  path: null,
  achievements: [{ title: "a", detail: "", place: "" }, { title: "b", detail: "", place: "" }],
  messages: null,
  goals: null,
  letter: null,
  ending: { line: "Well done", sub: "" },
  flight: { airline: "", number: "", seat: "", cabin: "", fromCode: "", fromCity: "", toCode: "", toCity: "" },
  sound: true,
  share: true,
  ...over,
});

describe("the summit's altitudes always climb (prototype bug 4)", () => {
  it.each(Array.from({ length: 12 }, (_, i) => i + 1))("with %i stops: base camp, then up, then the summit at the top", (n) => {
    const a = trailAltitudes(n);
    const climb = [a.then, ...a.stops, a.now];
    for (let i = 1; i < climb.length; i++) expect(climb[i]!, `step ${i}`).toBeGreaterThan(climb[i - 1]!);
    expect(a.now).toBe(SUMMIT_METRES);
    expect(Math.max(...a.stops)).toBeLessThan(SUMMIT_METRES);
  });

  it("the prototype's rule would have gone past the summit; this never does", () => {
    // (i + 1) x 800 m: the twelfth stop at 9,600 m, then "Summit" at 4,000 m.
    expect(12 * 800).toBeGreaterThan(SUMMIT_METRES);
    expect(Math.max(...trailAltitudes(12).stops)).toBeLessThan(SUMMIT_METRES);
  });

  it("achievement ridges sit below the summit and climb, even with ten", () => {
    const r = ridgeAltitudes(10);
    expect(r).toHaveLength(10);
    for (let i = 1; i < r.length; i++) expect(r[i]!).toBeGreaterThan(r[i - 1]!);
    expect(r[9]!).toBeLessThan(SUMMIT_METRES);
  });
});

describe("the arcade's score comes from the graduation year (prototype bug 5)", () => {
  it("year x 100 + 1,000 per achievement", () => {
    expect(arcadeScore(base())).toBe(2027 * 100 + 2000);
    expect(arcadeScore(base({ grad: { ...base().grad, year: "2031" } }))).toBe(2031 * 100 + 2000);
    expect(arcadeScore(base({ achievements: null }))).toBe(202700);
  });
});

describe("the boarding pass uses the creator's own codes, and fills only what is empty (bug 6)", () => {
  const t = translatorFor("en");
  it("defaults", () => {
    expect(flightOf(base(), t)).toEqual({
      airline: "Next Chapter Airways",
      number: "NC 2027",
      seat: "1A",
      cabin: "First Class Honours",
      fromCode: "KID",
      fromCity: "Childhood",
      toCode: "NXT",
      toCity: "What’s next",
    });
  });
  it("the creator's values", () => {
    const own = base({ flight: { airline: "Maya Air", number: "MA 1", seat: "9F", cabin: "Honours", fromCode: "LDN", fromCity: "London", toCode: "CPH", toCity: "Copenhagen" } });
    expect(flightOf(own, t)).toMatchObject({ fromCode: "LDN", toCode: "CPH", airline: "Maya Air" });
  });
  it("translated defaults in French and Arabic", () => {
    expect(flightOf(base(), translatorFor("fr")).fromCity).toBe("Enfance");
    expect(flightOf(base(), translatorFor("ar")).cabin).toBe("الدرجة الأولى");
  });
});

describe("numbers and dates in the reader's language", () => {
  it("Arabic-Indic digits for Arabic, set explicitly", () => {
    expect(formatNumber(4808, "ar")).toBe("٤٬٨٠٨");
    expect(formatNumber(4808, "en")).toBe("4,808");
    expect(formatNumber(4808, "fr").replace(/\s/g, " ")).toBe("4 808");
  });
  it("the graduation date, never shifted a day by a timezone", () => {
    expect(formatDate("2027-07-02", "en")).toBe("Jul 2, 2027");
    expect(formatDate("2027-07-02", "ar")).toContain("٢٠٢٧");
    expect(formatDate("2 July", "en")).toBe("2 July");
  });
});

describe("typing a message steps by grapheme, so an emoji is never split", () => {
  it("a family, a flag and a skin tone are each one step", () => {
    expect(graphemes("a👨‍👩‍👧‍👦🇫🇷👍🏽b")).toEqual(["a", "👨‍👩‍👧‍👦", "🇫🇷", "👍🏽", "b"]);
  });
  it("every step of an Arabic message is a whole prefix of it", () => {
    const text = "أنا فخورة بك جدًا 🎓";
    let shown = "";
    for (const part of graphemes(text)) {
      shown += part;
      expect(text.startsWith(shown)).toBe(true);
      expect(/[\uD800-\uDBFF]$/.test(shown)).toBe(false);
    }
    expect(shown).toBe(text);
  });
});

describe("a person with no colour gets a distinct one by position (prototype bug 9)", () => {
  it("never empty, never the same for neighbours", () => {
    const colours = Array.from({ length: 8 }, (_, i) => personColour({ color: "" }, i));
    expect(colours.every((c) => /^#[0-9a-f]{6}$/i.test(c))).toBe(true);
    expect(new Set(colours).size).toBe(8);
    expect(personColour({ color: "coral" }, 5)).toBe("#ff6b4a");
    expect(personColour({ color: "#000000" }, 0)).toBe(personColour({ color: "" }, 0));
  });
});
