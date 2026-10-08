import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * §21i — compiling the AR tracking target in the buyer's browser.
 *
 * The properties here are choices about WHO pays a cost, and they are the
 * kind a later refactor reverses without noticing.
 */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const compiler = strip(readFileSync("src/components/commerce/ar-target-compiler.tsx", "utf8"));
const orderView = strip(readFileSync("src/components/commerce/order-status-view.tsx", "utf8"));

describe("AR target compilation", () => {
  it("runs for the buyer, on the order page", () => {
    // Not at first scan. Compilation is 10-60 seconds on a phone, and at
    // first scan the person waiting is the gift recipient.
    expect(orderView).toContain("ARTargetCompiler");
  });

  it("only mounts for an AR purchase", () => {
    // Every other order must never load a compiler it has no use for.
    expect(orderView).toContain('targetId.startsWith("ar-")');
    expect(orderView).toContain("arCardEntitlement &&");
  });

  it("reads the card through the ordinary authorised download", () => {
    // No second access path to a customer's files: same endpoint, same
    // ownership check, as clicking download.
    expect(compiler).toContain("fetchEntitlementBlob");
  });

  it("hands the compiler a blob url rather than a cross-origin one", () => {
    /**
     * The card is served from R2's own domain. A cross-origin image taints
     * the canvas the compiler draws into, and a tainted canvas cannot be
     * read back — which is the entire operation.
     */
    expect(compiler).toContain("URL.createObjectURL");
    expect(compiler).not.toContain("crossOrigin");
  });

  it("revokes the object url even when loading fails", () => {
    // Otherwise a failed compile leaks the card image for the life of the
    // page — and this page is one a customer may leave open.
    expect(compiler).toContain("finally");
    expect(compiler).toContain("URL.revokeObjectURL");
  });

  it("does not present a failure as an error", () => {
    // Nothing is broken: the fallback covers it and the first scan is
    // simply slower. There is no action the customer could take.
    expect(compiler).toContain("arTarget.deferred");
    expect(compiler).not.toMatch(/tryAgain|retry/i);
  });

  it("sends the CSRF token, since this is a write", () => {
    expect(compiler).toContain("X-CSRFToken");
    expect(compiler).toContain('credentials: "include"');
  });
});
