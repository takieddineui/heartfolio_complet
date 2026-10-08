import { describe, expect, it } from "vitest";
import { extractVideoId } from "./youtube";

/**
 * The SAME 16 cases `apps/common/youtube.py`'s own test run was checked
 * against (see that work's own verification), kept in lockstep on
 * purpose: this file and that one are independent implementations of
 * one contract, and a case added to one without the other is exactly
 * how the two would quietly drift.
 */
describe("extractVideoId", () => {
  const cases: Array<[string, string | null]> = [
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PLxyz", "dQw4w9WgXcQ"],
    ["https://music.youtube.com/watch?v=dQw4w9WgXcQ&feature=share", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["", null],
    ["not a url at all", null],
    ["https://vimeo.com/12345", null],
    ["https://www.youtube.com/watch?v=short", null],
    ["https://www.youtube.com/results?search_query=x", null],
    ["https://www.youtube.com/playlist?list=PLxyz", null],
  ];

  it.each(cases)("%s -> %s", (url, expected) => {
    expect(extractVideoId(url)).toBe(expected);
  });
});
