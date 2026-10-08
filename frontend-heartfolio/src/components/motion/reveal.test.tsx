import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RevealItem } from "./reveal";

/**
 * `RevealItem` gained an `as` prop so `live-keepsake.tsx`'s ending
 * section could keep its dedication/endingText/colophon as real `<p>`
 * elements instead of becoming `<div>`s purely to get the stagger
 * animation — this proves both halves: the new prop actually renders
 * the requested tag, and every one of `RevealItem`'s SEVEN existing
 * callers (the marketing sections, `create-page-content.tsx`,
 * `product-view.tsx`, and now `live-keepsake.tsx` itself) still gets a
 * plain `<div>` when the prop isn't passed at all.
 */
describe("RevealItem", () => {
  it("renders a <div> by default, unchanged from before the as prop existed", () => {
    const { container } = render(<RevealItem>Hello</RevealItem>);
    expect(container.querySelector("div")).not.toBeNull();
    expect(container.querySelector("p")).toBeNull();
  });

  it("renders a <p> when as=\"p\" is passed", () => {
    const { container } = render(<RevealItem as="p">Hello</RevealItem>);
    expect(container.querySelector("p")).not.toBeNull();
    expect(container.querySelector("div")).toBeNull();
  });

  it("renders a <span> when as=\"span\" is passed", () => {
    const { container } = render(<RevealItem as="span">Hello</RevealItem>);
    expect(container.querySelector("span")).not.toBeNull();
  });

  it("renders a real <h2>, not a styled <span>, when as=\"h2\" is passed", () => {
    // Added specifically for checkout-flow.tsx's payment-result
    // screens — a collapsed <span> where a heading belongs is exactly
    // the kind of silent accessibility regression this test exists to
    // catch, at the one moment a screen reader heading matters most:
    // confirming whether a payment actually succeeded.
    const { container } = render(<RevealItem as="h2">Payment successful</RevealItem>);
    const heading = container.querySelector("h2");
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe("Payment successful");
  });

  it("renders a real <h1> when as=\"h1\" is passed", () => {
    const { container } = render(<RevealItem as="h1">Title</RevealItem>);
    expect(container.querySelector("h1")).not.toBeNull();
  });
});
