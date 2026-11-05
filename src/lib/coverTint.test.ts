import { describe, expect, test } from "bun:test";
import { tintOf } from "./coverTint";

const pixels = (...colours: [number, number, number][]) =>
  colours.flatMap(([r, g, b]) => [r, g, b, 255]);

describe("tintOf", () => {
  test("the colourful part wins over the frame and the greys", () => {
    // A red sleeve inside a black frame with a grey label: an average would be brown.
    const cover = pixels([0, 0, 0], [0, 0, 0], [128, 128, 128], [200, 20, 20]);
    expect(tintOf(cover)).toBe("#c81414");
  });

  test("a cover with no colour keeps its own grey", () => {
    expect(tintOf(pixels([90, 90, 90], [90, 90, 90]))).toBe("#5a5a5a");
  });

  test("an all-black cover falls back to the night surface", () => {
    expect(tintOf(pixels([0, 0, 0], [10, 10, 10]))).toBe("#15151b");
  });
});
