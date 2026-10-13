import { describe, expect, it } from "vitest";
import { buildStory, fill, mediaUrl, resolveLang } from "./model";

const base = {
  gradName: "Maya",
  gradFullName: "Maya Chen",
  gradDate: "2027-07-02",
  stops: [{ year: "2010", caption: "School", photo: { url: "https://x/1.jpg" }, code: "sch" }],
  achievements: [{ title: "Honours" }],
  messageGroups: [{ label: "Home", people: [{ name: "Mum", message: "Proud", color: "blue", emoji: "home" }] }],
  goals: [{ text: "Build", code: "cph" }],
  letterBody: [{ text: "Hello" }],
};

describe("buildStory", () => {
  it("reads the Studio's flat values and the live payload's {url} media the same way", () => {
    const story = buildStory(base, "en");
    expect(story.grad.fullName).toBe("Maya Chen");
    expect(story.grad.year).toBe(2027);
    expect(story.path.stops[0]).toMatchObject({ caption: "School", photo: "https://x/1.jpg", code: "SCH" });
  });

  it("derives the year and a readable date in the keepsake's language", () => {
    expect(buildStory(base, "en").grad.dateLabel).toBe("2 July 2027");
    expect(buildStory({ ...base, language: "fr" }, "en").grad.dateLabel).toBe("2 juillet 2027");
    expect(buildStory({ ...base, gradDate: "nope" }, "en").grad).toMatchObject({ year: null, dateLabel: "" });
  });

  it("the creator's language wins over the site's, and falls back to the site's, then English", () => {
    expect(buildStory({ ...base, language: "ar" }, "en").lang).toBe("ar");
    expect(buildStory({ ...base, language: "ar" }, "en").dir).toBe("rtl");
    expect(buildStory(base, "fr").lang).toBe("fr");
    expect(buildStory(base, "de-DE").lang).toBe("en");
    expect(resolveLang("xx", "ar-MA")).toBe("ar");
  });

  it("a switched-off chapter is absent from the story, in a fixed order", () => {
    expect(buildStory(base, "en").chapters).toEqual(["path", "achievements", "messages", "goals", "letter"]);
    expect(buildStory({ ...base, showAchievements: false, showLetter: false }, "en").chapters).toEqual([
      "path",
      "messages",
      "goals",
    ]);
  });

  it("drops items with nothing in them, so half-typed forms draw no empty slots", () => {
    const story = buildStory(
      {
        ...base,
        stops: [{ year: "", caption: "" }, ...base.stops],
        achievements: [{ title: "" }, { title: "Real" }],
        goals: [{ text: " " }],
        messageGroups: [{ label: "Empty", people: [{ name: "", message: "" }] }],
      },
      "en"
    );
    expect(story.path.stops).toHaveLength(1);
    expect(story.achievements).toEqual([{ title: "Real", detail: "", place: "" }]);
    expect(story.goals).toEqual([]);
    expect(story.messageGroups).toEqual([]);
  });

  it("never lets a stored colour or emoji reach the page: ids resolve through the allowlist", () => {
    const story = buildStory(
      { ...base, messageGroups: [{ label: "x", people: [{ name: "A", message: "m", color: "red;x:url(//e)", emoji: "<img onerror=1>" }] }] },
      "en"
    );
    const person = story.messageGroups[0]!.people[0]!;
    expect(person.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(person.emoji).toBe("❤️");
  });

  it("caps achievements at ten", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ title: `t${i}` }));
    expect(buildStory({ ...base, achievements: many }, "en").achievements).toHaveLength(10);
  });

  it("accepts a code only when it is exactly three letters", () => {
    const story = buildStory({ ...base, flightFromCode: "kid", flightToCode: "NEXT" }, "en");
    expect(story.flight).toMatchObject({ fromCode: "KID", toCode: "" });
  });

  it("is forgiving of garbage and never throws", () => {
    expect(() => buildStory({}, "en")).not.toThrow();
    expect(() => buildStory({ stops: "x", messageGroups: [null, { people: 3 }], achievements: [1] }, "en")).not.toThrow();
  });

  it("defaults the three options on", () => {
    expect(buildStory({}, "en").options).toEqual({ sound: true, share: true, branding: true });
    expect(buildStory({ soundEnabled: false }, "en").options.sound).toBe(false);
  });
});

describe("helpers", () => {
  it("fill substitutes known variables and leaves unknown ones", () => {
    expect(fill("Welcome aboard, {name}", { name: "Maya" })).toBe("Welcome aboard, Maya");
    expect(fill("{n} of {t}", { n: 2, t: 5 })).toBe("2 of 5");
    expect(fill("{missing}", {})).toBe("{missing}");
  });

  it("mediaUrl reads {url}, a bare string, and nothing else", () => {
    expect(mediaUrl({ url: "a" })).toBe("a");
    expect(mediaUrl("b")).toBe("b");
    expect(mediaUrl({ url: "" })).toBeUndefined();
    expect(mediaUrl(null)).toBeUndefined();
    expect(mediaUrl({ assetId: "x" })).toBeUndefined();
  });
});
