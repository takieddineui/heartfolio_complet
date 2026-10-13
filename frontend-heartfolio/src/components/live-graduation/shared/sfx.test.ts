import { afterEach, describe, expect, it, vi } from "vitest";
import { SfxEngine } from "./sfx";

/**
 * Sound is decoration. Whatever the browser does or refuses, the keepsake
 * must keep working, and nothing may make a sound the graduate muted or
 * before they have done anything.
 */

class FakeAudioContext {
  static created = 0;
  sampleRate = 8000;
  currentTime = 0;
  destination = {};
  constructor() {
    FakeAudioContext.created++;
  }
  createBuffer(_c: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
  createOscillator() {
    return { type: "", frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} };
  }
  createGain() {
    return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
  }
  createBufferSource() {
    return { connect() {}, start() {}, stop() {}, buffer: null, loop: false };
  }
  createBiquadFilter() {
    return { type: "", frequency: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeAudioContext.created = 0;
});

describe("SfxEngine", () => {
  it("creates no audio context until the first effect is played", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const engine = new SfxEngine();
    engine.setKit({ ding: (e) => e.tone(440, 0, 0.1, 0.1) });
    expect(FakeAudioContext.created).toBe(0);
    engine.play("ding");
    expect(FakeAudioContext.created).toBe(1);
  });

  it("makes no sound, and creates no context, when muted", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const ding = vi.fn();
    const engine = new SfxEngine();
    engine.setKit({ ding });
    engine.setEnabled(false);
    engine.play("ding");
    expect(ding).not.toHaveBeenCalled();
    expect(FakeAudioContext.created).toBe(0);
    engine.setEnabled(true);
    engine.play("ding");
    expect(ding).toHaveBeenCalledOnce();
  });

  it("ignores an effect the kit does not define", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const engine = new SfxEngine();
    engine.setKit({});
    expect(() => engine.play("nothing")).not.toThrow();
    expect(FakeAudioContext.created).toBe(0);
  });

  it("stays silent and does not throw when the browser has no Web Audio", () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    const engine = new SfxEngine();
    engine.setKit({ ding: (e) => e.tone(440, 0, 0.1, 0.1) });
    expect(() => engine.play("ding")).not.toThrow();
  });

  it("swallows an effect that throws", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const engine = new SfxEngine();
    engine.setKit({ boom: () => { throw new Error("nope"); } });
    expect(() => engine.play("boom")).not.toThrow();
  });
});
