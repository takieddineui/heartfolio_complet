import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldSchema } from "@/types/studio";

vi.mock("@/lib/studio/product-state-context", () => ({
  useProductState: () => ({ session: { module: { messages: {} } }, locale: "en", t: (key: string) => key }),
}));

import { withInferredAudioType } from "@/lib/api/assets";
import { timelineSchema as loveStoryTimelineSchema } from "@/lib/studio/product-modules/love-story-timeline/schema";
import { FieldInput } from "./field-inputs";

/**
 * THE AUDIO FIELD, two ways. Love Story Timeline's voice note is record-only
 * (a message recorded for them, not any file lying around) and stops itself
 * at 30 seconds. Graduation Keepsake's voice messages are files people SENT
 * the creator, so they can be uploaded too, up to a minute. And any media can
 * be taken back out, which a per-keepsake limit needs.
 */
let metadataSeconds: number | null = 5;
class FakeAudio {
  preload = "";
  onloadedmetadata: (() => void) | null = null;
  onerror: (() => void) | null = null;
  duration = 0;
  set src(_url: string) {
    setTimeout(() => {
      if (metadataSeconds === null) this.onerror?.();
      else {
        this.duration = metadataSeconds;
        this.onloadedmetadata?.();
      }
    }, 0);
  }
}

beforeEach(() => {
  metadataSeconds = 5;
  vi.stubGlobal("Audio", FakeAudio);
  URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const voice: FieldSchema = { id: "voice", type: "audio", label: "voice", allowUpload: true, maxSeconds: 60 };
const recordOnly: FieldSchema = { id: "audio", type: "audio", label: "audio" };

async function pick(onChange: ReturnType<typeof vi.fn>, file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return onChange;
}

describe("an audio field that allows uploads", () => {
  it("offers a file picker for audio files", () => {
    render(<FieldInput field={voice} value={null} onChange={vi.fn()} t={(k) => k} />);
    expect(document.querySelector('input[type="file"]')).toHaveAttribute("accept", "audio/*");
  });

  it("accepts a WhatsApp voice note the browser could not type, typing it from its extension", async () => {
    const onChange = vi.fn();
    render(<FieldInput field={voice} value={null} onChange={onChange} t={(k) => k} />);
    await pick(onChange, new File([new Uint8Array(10)], "PTT-20270702-WA0001.opus", { type: "" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "audio/ogg", filename: "PTT-20270702-WA0001.opus" })));
  });

  it("refuses a file longer than the field allows, at once", async () => {
    metadataSeconds = 75;
    const onChange = vi.fn();
    render(<FieldInput field={voice} value={null} onChange={onChange} t={(k) => k} />);
    await pick(onChange, new File([new Uint8Array(10)], "speech.m4a", { type: "audio/x-m4a" }));
    await waitFor(() => expect(screen.getByText("speech.m4a is longer than 60 seconds. Please choose a shorter recording.")).toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lets through a file whose length the browser cannot read: the backend probes it", async () => {
    metadataSeconds = null;
    const onChange = vi.fn();
    render(<FieldInput field={voice} value={null} onChange={onChange} t={(k) => k} />);
    await pick(onChange, new File([new Uint8Array(10)], "note.ogg", { type: "audio/ogg" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });
});

describe("Love Story Timeline's voice note stays record-only, and 30 seconds", () => {
  it("has no file picker", () => {
    render(<FieldInput field={recordOnly} value={null} onChange={vi.fn()} t={(k) => k} />);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("its recorder stops itself at 30 seconds (the backend now allows 60, for voice messages)", () => {
    const events = loveStoryTimelineSchema.sections.flatMap((s) => s.fields).find((f) => f.id === "events")!;
    const audio = events.type === "group" ? events.itemFields.find((f) => f.id === "audio") : undefined;
    expect(audio).toMatchObject({ type: "audio", maxSeconds: 30 });
    expect(audio).not.toHaveProperty("allowUpload");
  });
});

describe("media can be taken back out", () => {
  it("a single file is removed", () => {
    const onChange = vi.fn();
    render(<FieldInput field={voice} value={{ url: "blob:1", mimeType: "audio/mp4", filename: "mum.m4a" }} onChange={onChange} t={(k) => k} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove: mum.m4a" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("one photo of a gallery is removed, the others kept", () => {
    const onChange = vi.fn();
    const gallery: FieldSchema = { id: "g", type: "gallery", label: "g" };
    const items = [
      { url: "blob:1", mimeType: "image/jpeg", filename: "a.jpg" },
      { url: "blob:2", mimeType: "image/jpeg", filename: "b.jpg" },
    ];
    render(<FieldInput field={gallery} value={items} onChange={onChange} t={(k) => k} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove: a.jpg" }));
    expect(onChange).toHaveBeenCalledWith([items[1]]);
  });
});

describe("the type a browser reports is never overridden", () => {
  it.each([
    ["note.opus", "", "audio/ogg"],
    ["memo.m4a", "application/octet-stream", "audio/x-m4a"],
    ["memo.m4a", "audio/mp4", "audio/mp4"],
    ["photo.opus", "image/png", "image/png"],
    ["notes.txt", "", ""],
  ])("%s declared %j becomes %j", (name, declared, expected) => {
    expect(withInferredAudioType(new File([new Uint8Array(1)], name, { type: declared })).type).toBe(expected);
  });
});
