import { describe, expect, it } from "vitest";
import { BackendOriginError, getBackendOrigin } from "./backend-origin";

describe("getBackendOrigin", () => {
  it("returns the configured origin unchanged", () => {
    expect(getBackendOrigin({ BACKEND_API_ORIGIN: "http://api:8000" })).toBe("http://api:8000");
    expect(getBackendOrigin({ BACKEND_API_ORIGIN: "https://api.example.com" })).toBe("https://api.example.com");
  });

  it("ignores surrounding whitespace", () => {
    expect(getBackendOrigin({ BACKEND_API_ORIGIN: "  http://localhost:8000\n" })).toBe("http://localhost:8000");
  });

  it("throws when the variable is not set — there is no default", () => {
    expect(() => getBackendOrigin({})).toThrow(BackendOriginError);
    expect(() => getBackendOrigin({})).toThrow(/BACKEND_API_ORIGIN is not set/);
  });

  it("treats an empty value as unset (a Docker ARG with nothing passed is an empty string, not undefined)", () => {
    expect(() => getBackendOrigin({ BACKEND_API_ORIGIN: "" })).toThrow(/BACKEND_API_ORIGIN is not set/);
    expect(() => getBackendOrigin({ BACKEND_API_ORIGIN: "   " })).toThrow(/BACKEND_API_ORIGIN is not set/);
  });

  it("tells the reader how to fix it, and never falls back to a dead host", () => {
    let message = "";
    try {
      getBackendOrigin({});
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("http://localhost:8000");
    expect(message).toContain("http://api:8000");
    expect(message).not.toMatch(/railway/i);
  });

  it("rejects a value that is not an absolute http(s) URL, rather than building broken requests from it", () => {
    expect(() => getBackendOrigin({ BACKEND_API_ORIGIN: "api:8000" })).toThrow(BackendOriginError);
    expect(() => getBackendOrigin({ BACKEND_API_ORIGIN: "not a url" })).toThrow(/not a valid URL/);
    expect(() => getBackendOrigin({ BACKEND_API_ORIGIN: "ftp://api.example.com" })).toThrow(/http:\/\/ or https:\/\//);
  });

  it("reads process.env by default", () => {
    const previous = process.env.BACKEND_API_ORIGIN;
    try {
      process.env.BACKEND_API_ORIGIN = "http://from-process-env:1234";
      expect(getBackendOrigin()).toBe("http://from-process-env:1234");
      delete process.env.BACKEND_API_ORIGIN;
      expect(() => getBackendOrigin()).toThrow(BackendOriginError);
    } finally {
      if (previous === undefined) delete process.env.BACKEND_API_ORIGIN;
      else process.env.BACKEND_API_ORIGIN = previous;
    }
  });
});
